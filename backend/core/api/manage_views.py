"""Record management: medicines, suppliers, supplier offers, batches (with expiry
dates), users, and the patient-safe dispense flow.

Who may do what (core.api.permissions):
  view lists ........................ anyone who can see inventory / suppliers
  receive, quarantine, dispose stock  inventory.edit   (admin, manager, pharmacist)
  add / edit medicines .............. catalogue.edit   (admin, manager)
  add / edit suppliers and offers ... suppliers.edit   (admin, manager)
  add / edit users .................. settings.manage  (admin)

Every change writes an AuditEvent with the actor, so the audit trail stays complete.
"""
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from core.models import AuditEvent, Batch, DailyDemand, Medicine, StockMovement, Supplier, SupplierOffer
from core.services import stock
from core.services.clock import today


def _audit(user, action, entity, **details):
    AuditEvent.objects.create(actor=user, action=action, entity=entity, details=details)


def _invalid(fields):
    return Response({"code": "validation_error", "detail": next(iter(fields.values()))[0], "fields": fields}, status=400)


def _not_found(what):
    return Response({"code": "not_found", "detail": f"{what} was not found."}, status=404)


def _get(model, pk):
    try:
        return model.objects.get(pk=pk)
    except (model.DoesNotExist, ValueError, TypeError):
        return None


def _bool(value):
    return value in (True, "true", "1", 1)


# ================================================================ medicines
class MedicineIn(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    strength = serializers.CharField(max_length=80, allow_blank=True, required=False, default="")
    category = serializers.CharField(max_length=100)
    form = serializers.CharField(max_length=80, allow_blank=True, required=False, default="")
    baseUnit = serializers.CharField(max_length=30, required=False, default="unit", source="base_unit")
    active = serializers.BooleanField(required=False, default=True)

    def validate_name(self, value):
        return value.strip()


def medicine_row(m, as_of, window, history):
    batches = list(m.batches.all())
    summary = {stock.SAFE: 0, stock.SHORT_DATED: 0, stock.EXPIRED: 0, stock.QUARANTINED: 0}
    safe_dates = []
    for b in batches:
        if b.quantity <= 0:
            continue
        state = stock.batch_status(b, as_of, window)
        summary[state] = summary.get(state, 0) + b.quantity
        if state in (stock.SAFE, stock.SHORT_DATED):
            safe_dates.append(b.expiry_date)
    on_hand = sum(b.quantity for b in batches)
    return {
        "id": str(m.id), "modelId": m.model_id, "name": m.name, "strength": m.strength, "category": m.category,
        "form": m.form, "baseUnit": m.base_unit, "active": m.active,
        "onHand": on_hand, "dispensable": summary[stock.SAFE] + summary[stock.SHORT_DATED],
        "shortDatedUnits": summary[stock.SHORT_DATED], "expiredUnits": summary[stock.EXPIRED],
        "quarantinedUnits": summary[stock.QUARANTINED],
        "batchCount": sum(1 for b in batches if b.quantity > 0),
        "earliestSafeExpiry": min(safe_dates).isoformat() if safe_dates else None,
        "offerCount": m.offer_count,
        # The forecasting models were trained on the original catalogue (model ids)
        # and need 30 days of demand history before they can predict.
        "forecastReady": m.model_id is not None and history.get(m.id, 0) >= 30,
    }


class MedicineListView(APIView):
    required_permission = {"GET": "inventory.view", "POST": "catalogue.edit"}

    def get(self, request):
        as_of, window = today(), stock.expiry_window_days()
        qs = Medicine.objects.annotate(offer_count=Count("offers", filter=Q(offers__active=True))) \
            .prefetch_related("batches")
        if not _bool(request.query_params.get("includeInactive", "true")):
            qs = qs.filter(active=True)
        history = dict(DailyDemand.objects.filter(date__lte=as_of).values_list("medicine_id")
                       .annotate(n=Count("id")).values_list("medicine_id", "n"))
        return Response([medicine_row(m, as_of, window, history) for m in qs.order_by("name", "id")])

    def post(self, request):
        data = MedicineIn(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if Medicine.objects.filter(name__iexact=v["name"], strength__iexact=v.get("strength", "")).exists():
            return _invalid({"name": ["A medicine with this name and strength already exists."]})
        m = Medicine.objects.create(**v)
        _audit(request.user, "medicine.create", f"medicine:{m.id}", name=m.name)
        m.offer_count = 0
        return Response(medicine_row(m, today(), stock.expiry_window_days(), {}), status=201)


class MedicineEditView(APIView):
    required_permission = {"PATCH": "catalogue.edit"}

    def patch(self, request, pk):
        m = _get(Medicine, pk)
        if m is None:
            return _not_found("Medicine")
        data = MedicineIn(m, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        changed = {}
        for field, value in data.validated_data.items():
            if getattr(m, field) != value:
                changed[field] = [getattr(m, field), value]
                setattr(m, field, value)
        if changed:
            m.save()
            _audit(request.user, "medicine.update", f"medicine:{m.id}", changes=changed)
        m.offer_count = m.offers.filter(active=True).count()
        history = {m.id: DailyDemand.objects.filter(medicine=m, date__lte=today()).count()}
        return Response(medicine_row(m, today(), stock.expiry_window_days(), history))


# ================================================================ suppliers
class SupplierIn(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    contactEmail = serializers.EmailField(required=False, allow_blank=True, default="", source="contact_email")
    phone = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")
    status = serializers.ChoiceField(choices=["active", "review", "suspended"], required=False, default="active")


def supplier_row(s):
    return {"id": str(s.id), "externalId": s.external_id, "name": s.name, "contactEmail": s.contact_email,
            "phone": s.phone, "status": s.status, "offerCount": getattr(s, "offer_count", None)}


class SupplierManageListView(APIView):
    required_permission = {"GET": "suppliers.view", "POST": "suppliers.edit"}

    def get(self, request):
        qs = Supplier.objects.annotate(offer_count=Count("offers", filter=Q(offers__active=True)))
        return Response([supplier_row(s) for s in qs.order_by("name", "id")])

    def post(self, request):
        data = SupplierIn(data=request.data)
        data.is_valid(raise_exception=True)
        if Supplier.objects.filter(name__iexact=data.validated_data["name"].strip()).exists():
            return _invalid({"name": ["A supplier with this name already exists."]})
        s = Supplier.objects.create(**data.validated_data)
        _audit(request.user, "supplier.create", f"supplier:{s.id}", name=s.name)
        s.offer_count = 0
        return Response(supplier_row(s), status=201)


class SupplierEditView(APIView):
    required_permission = {"PATCH": "suppliers.edit"}

    def patch(self, request, pk):
        s = _get(Supplier, pk)
        if s is None:
            return _not_found("Supplier")
        data = SupplierIn(s, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        changed = {f: [getattr(s, f), v] for f, v in data.validated_data.items() if getattr(s, f) != v}
        for f, (_, v) in changed.items():
            setattr(s, f, v)
        if changed:
            s.save()
            _audit(request.user, "supplier.update", f"supplier:{s.id}", changes=changed)
        s.offer_count = s.offers.filter(active=True).count()
        return Response(supplier_row(s))


# =================================================================== offers
class OfferIn(serializers.Serializer):
    medicineId = serializers.PrimaryKeyRelatedField(queryset=Medicine.objects.all(), source="medicine")
    supplierId = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all(), source="supplier")
    unitCost = serializers.DecimalField(max_digits=12, decimal_places=4, min_value=0, source="unit_cost")
    leadTimeDays = serializers.IntegerField(min_value=1, max_value=365, source="lead_time_days")
    packSize = serializers.IntegerField(min_value=1, required=False, default=1, source="pack_size")
    minimumOrder = serializers.IntegerField(min_value=1, required=False, default=1, source="minimum_order")
    active = serializers.BooleanField(required=False, default=True)


def offer_row(o):
    return {"id": str(o.id), "medicineId": str(o.medicine_id), "medicineName": o.medicine.name,
            "supplierId": str(o.supplier_id), "supplierName": o.supplier.name, "unitCost": float(o.unit_cost),
            "leadTimeDays": o.lead_time_days, "packSize": o.pack_size, "minimumOrder": o.minimum_order,
            "active": o.active}


class OfferListView(APIView):
    required_permission = {"GET": "suppliers.view", "POST": "suppliers.edit"}

    def get(self, request):
        qs = SupplierOffer.objects.select_related("medicine", "supplier").order_by("medicine__name", "supplier__name")
        if request.query_params.get("medicine"):
            qs = qs.filter(medicine_id=request.query_params["medicine"])
        if request.query_params.get("supplier"):
            qs = qs.filter(supplier_id=request.query_params["supplier"])
        return Response([offer_row(o) for o in qs])

    def post(self, request):
        data = OfferIn(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if SupplierOffer.objects.filter(medicine=v["medicine"], supplier=v["supplier"]).exists():
            return _invalid({"supplierId": ["This supplier already has an offer for this medicine. Edit that offer."]})
        o = SupplierOffer.objects.create(**v)
        _audit(request.user, "offer.create", f"offer:{o.id}", medicine=o.medicine.name, supplier=o.supplier.name)
        return Response(offer_row(o), status=201)


class OfferEditView(APIView):
    required_permission = {"PATCH": "suppliers.edit"}

    def patch(self, request, pk):
        o = _get(SupplierOffer, pk)
        if o is None:
            return _not_found("Offer")
        data = OfferIn(o, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        v = {k: x for k, x in data.validated_data.items() if k not in ("medicine", "supplier")}
        changed = {f: [str(getattr(o, f)), str(x)] for f, x in v.items() if getattr(o, f) != x}
        for f, x in v.items():
            setattr(o, f, x)
        if changed:
            o.save()
            _audit(request.user, "offer.update", f"offer:{o.id}", changes=changed)
        return Response(offer_row(o))


# ================================================================== batches
class BatchIn(serializers.Serializer):
    medicineId = serializers.PrimaryKeyRelatedField(queryset=Medicine.objects.filter(active=True), source="medicine")
    supplierId = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all(), source="supplier",
                                                    required=False, allow_null=True)
    batchNumber = serializers.CharField(max_length=100, source="number")
    receivedAt = serializers.DateField(source="received_at", required=False)
    expiryDate = serializers.DateField(source="expiry_date")
    quantity = serializers.IntegerField(min_value=1, max_value=10_000_000)
    unitCost = serializers.DecimalField(max_digits=12, decimal_places=4, min_value=0, source="unit_cost")

    def validate_batchNumber(self, value):
        value = value.strip().upper()
        if not value:
            raise serializers.ValidationError("Enter the batch number printed on the pack.")
        return value

    def validate(self, attrs):
        as_of = today()
        received = attrs.setdefault("received_at", as_of)
        expiry = attrs["expiry_date"]
        if received > as_of:
            raise serializers.ValidationError({"receivedAt": ["The received date cannot be in the future."]})
        if expiry <= as_of:
            raise serializers.ValidationError({"expiryDate": [
                "This stock is already expired. Do not receive it: return it to the supplier."]})
        if expiry <= received:
            raise serializers.ValidationError({"expiryDate": ["The expiry date must be after the received date."]})
        if Batch.objects.filter(medicine=attrs["medicine"], number__iexact=attrs["number"]).exists():
            raise serializers.ValidationError({"batchNumber": [
                "This batch number is already recorded for this medicine. Add the units to it instead."]})
        return attrs


class BatchListView(APIView):
    """GET: batches with their safety status. POST: receive a new batch (with its expiry date)."""
    required_permission = {"GET": "inventory.view", "POST": "inventory.edit"}

    def get(self, request):
        as_of, window = today(), stock.expiry_window_days()
        qs = Batch.objects.select_related("medicine", "supplier").order_by("expiry_date", "id")
        params = request.query_params
        if params.get("medicine"):
            qs = qs.filter(medicine_id=params["medicine"])
        if not _bool(params.get("includeEmpty", "false")):
            qs = qs.filter(quantity__gt=0)
        rows = [stock.batch_dict(b, as_of, window) for b in qs]
        if params.get("status"):
            wanted = set(params["status"].split(","))
            rows = [r for r in rows if r["status"] in wanted]
        return Response(rows)

    @transaction.atomic
    def post(self, request):
        data = BatchIn(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        qty = v.pop("quantity")
        b = Batch.objects.create(quantity=qty, source="operational", **v)
        StockMovement.objects.create(batch=b, kind="receipt", quantity=qty, occurred_at=timezone.now(),
                                     actor=request.user, reason="Goods received", fingerprint="receipt")
        _audit(request.user, "batch.receive", f"batch:{b.id}", medicine=b.medicine.name, batch=b.number,
               quantity=qty, expiry=b.expiry_date.isoformat())
        return Response(stock.batch_dict(b), status=201)


class BatchEditView(APIView):
    """Quarantine / release a batch, or correct a mistyped expiry date. A reason is required."""
    required_permission = {"PATCH": "inventory.edit"}

    @transaction.atomic
    def patch(self, request, pk):
        b = Batch.objects.select_for_update(of=("self",)).select_related("medicine", "supplier").filter(pk=pk).first()
        if b is None:
            return _not_found("Batch")
        reason = str(request.data.get("reason", "")).strip()
        if not reason:
            return _invalid({"reason": ["Give a reason; it is kept in the audit trail."]})
        changes = {}
        if "quarantined" in request.data:
            q = _bool(request.data["quarantined"])
            if q != b.quarantined:
                changes["quarantined"] = [b.quarantined, q]
                b.quarantined = q
        if "expiryDate" in request.data:
            field = serializers.DateField()
            try:
                expiry = field.to_internal_value(request.data["expiryDate"])
            except serializers.ValidationError:
                return _invalid({"expiryDate": ["Enter a valid date."]})
            if expiry <= b.received_at:
                return _invalid({"expiryDate": ["The expiry date must be after the received date."]})
            if expiry != b.expiry_date:
                changes["expiryDate"] = [b.expiry_date.isoformat(), expiry.isoformat()]
                b.expiry_date = expiry
        if changes:
            b.save(update_fields=["quarantined", "expiry_date"])
            _audit(request.user, "batch.update", f"batch:{b.id}", batch=b.number, reason=reason[:300], changes=changes)
        return Response(stock.batch_dict(b))


class BatchDisposeView(APIView):
    """Write off the units left in a batch (expired, damaged or recalled stock)."""
    required_permission = "inventory.edit"

    @transaction.atomic
    def post(self, request, pk):
        b = Batch.objects.select_for_update(of=("self",)).select_related("medicine", "supplier").filter(pk=pk).first()
        if b is None:
            return _not_found("Batch")
        reason = str(request.data.get("reason", "")).strip()
        if not reason:
            return _invalid({"reason": ["Give a reason, for example 'Expired'."]})
        try:
            qty = int(request.data.get("quantity", b.quantity))
        except (TypeError, ValueError):
            return _invalid({"quantity": ["Enter a whole number."]})
        if qty < 1 or qty > b.quantity:
            return _invalid({"quantity": [f"Enter between 1 and {b.quantity:,} units."]})
        b.quantity -= qty
        b.save(update_fields=["quantity"])
        StockMovement.objects.create(batch=b, kind="disposal", quantity=-qty, occurred_at=timezone.now(),
                                     actor=request.user, reason=reason[:300], fingerprint="disposal")
        _audit(request.user, "batch.dispose", f"batch:{b.id}", batch=b.number, quantity=qty, reason=reason[:300])
        return Response(stock.batch_dict(b))


class BatchLookupView(APIView):
    """'Is this pack safe to give?' — look a batch up by the number printed on the pack."""
    required_permission = "inventory.view"

    def get(self, request):
        number = str(request.query_params.get("number", "")).strip()
        if not number:
            return _invalid({"number": ["Enter a batch number."]})
        qs = Batch.objects.select_related("medicine", "supplier").filter(number__iexact=number)
        as_of, window = today(), stock.expiry_window_days()
        return Response({"number": number.upper(), "asOf": as_of.isoformat(),
                         "matches": [stock.batch_dict(b, as_of, window) for b in qs]})


# ================================================================= dispense
def _dispense_input(request):
    try:
        medicine = Medicine.objects.get(pk=int(request.data.get("medicineId")))
        qty = int(request.data.get("quantity"))
    except (Medicine.DoesNotExist, TypeError, ValueError):
        return None, None, _invalid({"medicineId": ["Choose a medicine and enter a whole-number quantity."]})
    if qty < 1:
        return None, None, _invalid({"quantity": ["Quantity must be at least 1."]})
    if not medicine.active:
        return None, None, _invalid({"medicineId": ["This medicine is no longer active."]})
    return medicine, qty, None


class DispensePreviewView(APIView):
    """Show exactly which batches would be used, and what is held back, before anything changes."""
    required_permission = "inventory.view"

    def post(self, request):
        medicine, qty, error = _dispense_input(request)
        if error:
            return error
        alloc = stock.allocate(medicine, qty)
        body = alloc.to_dict()
        if not alloc.ok:
            body["refusal"] = stock.refuse_reason(alloc).detail
        return Response(body)


class DispenseToPatientView(APIView):
    required_permission = "inventory.edit"

    def post(self, request):
        medicine, qty, error = _dispense_input(request)
        if error:
            return error
        reason = str(request.data.get("reference", "")).strip() or "Dispensed to patient"
        try:
            return Response(stock.dispense(medicine, qty, request.user, reason), status=201)
        except stock.StockRuleError as e:
            return Response({"code": e.code, "detail": e.detail}, status=409)


# ==================================================================== users
ROLES = [r for r, _ in User.Role.choices]


class UserIn(serializers.Serializer):
    email = serializers.EmailField()
    firstName = serializers.CharField(max_length=150, source="first_name")
    lastName = serializers.CharField(max_length=150, source="last_name", required=False, allow_blank=True, default="")
    role = serializers.ChoiceField(choices=ROLES)
    active = serializers.BooleanField(source="is_active", required=False, default=True)
    password = serializers.CharField(write_only=True, required=False, min_length=8, trim_whitespace=False)


def user_row(u):
    return {"id": str(u.id), "email": u.email or u.username, "firstName": u.first_name, "lastName": u.last_name,
            "name": u.get_full_name() or u.username, "role": u.role, "active": u.is_active,
            "isSuperuser": u.is_superuser,
            "lastLogin": u.last_login.isoformat() if u.last_login else None, "dateJoined": u.date_joined.isoformat()}


def _check_password(password, user):
    try:
        validate_password(password, user)
    except DjangoValidationError as e:
        return _invalid({"password": list(e.messages)})
    return None


class UserListView(APIView):
    required_permission = "settings.manage"

    def get(self, request):
        return Response([user_row(u) for u in User.objects.order_by("-is_active", "role", "first_name", "username")])

    @transaction.atomic
    def post(self, request):
        data = UserIn(data=request.data)
        data.is_valid(raise_exception=True)
        v = dict(data.validated_data)
        email = v.pop("email").lower().strip()
        password = v.pop("password", None)
        if not password:
            return _invalid({"password": ["Set a first password for the new user."]})
        if User.objects.filter(Q(username__iexact=email) | Q(email__iexact=email)).exists():
            return _invalid({"email": ["A user with this email already exists."]})
        user = User(username=email, email=email, **v)
        error = _check_password(password, user)
        if error:
            return error
        user.set_password(password)
        user.save()
        _audit(request.user, "user.create", f"user:{user.id}", email=email, role=user.role)
        return Response(user_row(user), status=201)


class UserEditView(APIView):
    required_permission = "settings.manage"

    @transaction.atomic
    def patch(self, request, pk):
        user = User.objects.select_for_update().filter(pk=pk).first()
        if user is None:
            return _not_found("User")
        data = UserIn(user, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        v = dict(data.validated_data)
        password = v.pop("password", None)
        if "email" in v:
            email = v.pop("email").lower().strip()
            if email != (user.email or "").lower():
                if User.objects.filter(Q(username__iexact=email) | Q(email__iexact=email)).exclude(pk=user.pk).exists():
                    return _invalid({"email": ["A user with this email already exists."]})
                v["email"] = v["username"] = email

        deactivating = "is_active" in v and not v["is_active"]
        removes_admin = user.role == "admin" and user.is_active and (
            v.get("role", "admin") != "admin" or deactivating)
        if user.pk == request.user.pk and (removes_admin or deactivating):
            return _invalid({"role": ["You cannot remove your own admin access or deactivate yourself."]})
        if removes_admin:
            others = User.objects.filter(role="admin", is_active=True).exclude(pk=user.pk).count()
            if others == 0:
                return _invalid({"role": ["This is the last active admin. Make someone else an admin first."]})

        changed = {f: [getattr(user, f), x] for f, x in v.items() if getattr(user, f) != x}
        for f, x in v.items():
            setattr(user, f, x)
        if password:
            error = _check_password(password, user)
            if error:
                return error
            user.set_password(password)
            changed["password"] = ["", "reset"]
        if changed:
            user.save()
            _audit(request.user, "user.update", f"user:{user.id}", changes={
                k: x if k != "password" else "reset" for k, x in changed.items()})
        return Response(user_row(user))
