import uuid
from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Medicine(models.Model):
    model_id = models.PositiveIntegerField(null=True, blank=True, unique=True)
    name = models.CharField(max_length=200)
    strength = models.CharField(max_length=80, blank=True)
    category = models.CharField(max_length=100)
    form = models.CharField(max_length=80, blank=True)
    base_unit = models.CharField(max_length=30, default="unit")
    active = models.BooleanField(default=True)
    class Meta:
        ordering = ["name", "id"]


class Supplier(models.Model):
    external_id = models.PositiveIntegerField(null=True, blank=True, unique=True)
    name = models.CharField(max_length=200)
    contact_email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=15, choices=[(x, x) for x in ["active", "review", "suspended"]], default="active")
    class Meta:
        ordering = ["name", "id"]


class SupplierOffer(models.Model):
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name="offers")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="offers")
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    lead_time_days = models.PositiveIntegerField(default=7)
    lead_time_std = models.FloatField(default=0)
    pack_size = models.PositiveIntegerField(default=1)
    minimum_order = models.PositiveIntegerField(default=1)
    active = models.BooleanField(default=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["medicine", "supplier"], name="unique_offer"),
            models.CheckConstraint(condition=Q(unit_cost__gte=0) & Q(lead_time_days__gte=1) & Q(lead_time_std__gte=0) & Q(pack_size__gte=1) & Q(minimum_order__gte=1), name="valid_offer")]


class Batch(models.Model):
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name="batches")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, null=True, blank=True)
    number = models.CharField(max_length=100)
    received_at = models.DateField()
    expiry_date = models.DateField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    quantity = models.PositiveIntegerField(default=0)
    quarantined = models.BooleanField(default=False)
    source = models.CharField(max_length=20, default="operational")
    class Meta:
        constraints = [models.UniqueConstraint(fields=["medicine", "number"], name="unique_medicine_batch"),
            models.CheckConstraint(condition=Q(expiry_date__gte=F("received_at")) & Q(unit_cost__gte=0), name="valid_batch")]


class DataState(models.Model):
    """Serializes operational writes and versions decision inputs."""
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    revision = models.PositiveBigIntegerField(default=0)


class StockMovement(models.Model):
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT, related_name="movements")
    kind = models.CharField(max_length=15, choices=[(x, x) for x in ["receipt", "dispense", "adjustment", "disposal"]])
    quantity = models.IntegerField()
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    reason = models.CharField(max_length=300)
    key = models.UUIDField(default=uuid.uuid4, unique=True)
    fingerprint = models.CharField(max_length=64)
    class Meta:
        ordering = ["-occurred_at", "-id"]
        constraints = [models.CheckConstraint(condition=~Q(quantity=0), name="nonzero_movement")]


class DailyDemand(models.Model):
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name="demand_history")
    date = models.DateField()
    quantity = models.PositiveIntegerField()
    stockout = models.BooleanField(default=False)
    # Closing balance that day (from the dataset); used for the stock-value trend.
    closing_stock = models.PositiveIntegerField(null=True, blank=True)
    complete = models.BooleanField(default=True)
    holiday = models.BooleanField(default=False)
    season = models.CharField(max_length=50)
    source = models.CharField(max_length=20, default="operational")
    class Meta:
        ordering = ["date"]
        constraints = [models.UniqueConstraint(fields=["medicine", "date"], name="unique_daily_demand")]


class CalendarDay(models.Model):
    date = models.DateField(unique=True)
    holiday = models.BooleanField(default=False)
    season = models.CharField(max_length=50)


class SupplierDelivery(models.Model):
    """Completed-order observations, separate from live orders/inventory."""
    source_key = models.CharField(max_length=100, unique=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="deliveries")
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT)
    order_date = models.DateField()
    promised_date = models.DateField()
    actual_date = models.DateField()
    ordered = models.PositiveIntegerField()
    delivered = models.PositiveIntegerField()
    rejected = models.PositiveIntegerField(default=0)
    unit_price = models.DecimalField(max_digits=12, decimal_places=4)
    market_price = models.DecimalField(max_digits=12, decimal_places=4)
    # Preserve the rounded source features used to train the exported scorecard.
    fulfillment_rate = models.FloatField()
    price_variance_pct = models.FloatField()
    defect_rate = models.FloatField()
    source = models.CharField(max_length=20, default="operational")
    class Meta:
        constraints = [models.CheckConstraint(condition=Q(ordered__gt=0) & Q(rejected__lte=F("delivered")) & Q(market_price__gt=0) & Q(actual_date__gte=F("order_date")), name="valid_delivery")]


class Policy(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    lead_time_buffer = models.PositiveIntegerField(default=3)
    service_level = models.FloatField(default=95)
    expiry_window = models.PositiveIntegerField(default=90)
    review_period = models.PositiveIntegerField(default=14)
    version = models.PositiveIntegerField(default=1)


class DecisionSnapshot(models.Model):
    kind = models.CharField(max_length=30)
    subject = models.CharField(max_length=50)
    as_of = models.DateField()
    signature = models.CharField(max_length=64)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["kind", "subject", "as_of", "signature"], name="unique_snapshot")]


class Recommendation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT)
    offer = models.ForeignKey(SupplierOffer, on_delete=models.PROTECT)
    status = models.CharField(max_length=15, choices=[(x, x) for x in ["pending", "approved", "rejected", "superseded"]], default="pending")
    quantity = models.PositiveIntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    revision = models.PositiveBigIntegerField()
    as_of = models.DateField()
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    reason = models.CharField(max_length=300, blank=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["medicine"], condition=Q(status="pending"), name="one_pending_recommendation")]


class PurchaseOrder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recommendation = models.OneToOneField(Recommendation, on_delete=models.PROTECT, null=True)
    offer = models.ForeignKey(SupplierOffer, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    received_units = models.PositiveIntegerField(default=0)
    rejected_units = models.PositiveIntegerField(default=0)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    placed_at = models.DateField()
    expected_at = models.DateField()
    completed_at = models.DateField(null=True)
    status = models.CharField(max_length=20, default="pending", choices=[(x, x) for x in ["pending", "partial", "delivered", "cancelled"]])
    key = models.UUIDField(unique=True, default=uuid.uuid4)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    class Meta:
        constraints = [models.CheckConstraint(condition=Q(quantity__gt=0) & Q(received_units__lte=F("quantity")) & Q(rejected_units__lte=F("received_units")), name="valid_order_quantities")]


class Notification(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    event_key = models.CharField(max_length=150)
    kind = models.CharField(max_length=20)
    severity = models.CharField(max_length=15, default="warning")
    title = models.CharField(max_length=200)
    message = models.TextField()
    link = models.CharField(max_length=200)
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "event_key"], name="unique_user_event")]


class AuditEvent(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    action = models.CharField(max_length=50)
    entity = models.CharField(max_length=100)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class Report(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    kind = models.CharField(max_length=30)
    format = models.CharField(max_length=3)
    filters = models.JSONField()
    row_count = models.PositiveIntegerField()
    content = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)


class ImportRun(models.Model):
    digest = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=100)
    rows = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
