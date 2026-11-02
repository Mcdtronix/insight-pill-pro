from datetime import timedelta
from pathlib import Path
from django.conf import settings
from django.db import connection
from django.db import transaction
from django.db.models import Sum, F
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from core.models import Medicine, Batch, StockMovement, Recommendation, Supplier, Notification, Report, PurchaseOrder, SupplierDelivery, AuditEvent
from core.services.ml import demand_forecast
from core.services.clock import today, is_demo
from core.services import insights
from core.api.errors import ModelUnavailable
from .permissions import RolePermission

def medicine_dict(m, plan=None):
    batches=list(m.batches.filter(quarantined=False)); stock=sum(b.quantity for b in batches)
    expiry=min((b.expiry_date for b in batches if b.quantity>0), default=None)
    out={"id":m.id,"modelId":m.model_id,"name":m.name,"category":m.category,"strength":m.strength,"form":m.form,"stock":stock,"earliestExpiry":expiry.isoformat() if expiry else None,"active":m.active}
    if plan:
        out.update(unitCost=plan["unitCost"], supplierId=str(plan["supplierId"]), supplierName=plan["supplierName"])
    return out

# Files the decision engine cannot run without. Checked by /api/health/ so a release
# with missing models never goes live.
REQUIRED_MODEL_FILES = (
    ("Demand", "forecast_model_v1.pkl"), ("Demand", "category_encoder_v1.pkl"),
    ("Demand", "season_encoder_v1.pkl"), ("Reorder", "reorder_risk_model_v1.pkl"),
    ("supplier", "supplier_kmeans_v1.pkl"), ("supplier", "supplier_scaler_v1.pkl"),
)


class HealthView(APIView):
    """Liveness, database and model check used by the deploy pipeline and monitoring."""
    permission_classes=[AllowAny]
    authentication_classes=[]

    def get(self, request):
        checks={"database":"ok","models":"ok"}
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1"); cursor.fetchone()
        except Exception:
            checks["database"]="unavailable"
        root=Path(settings.MODEL_ROOT)
        if not all((root/folder/name).is_file() for folder, name in REQUIRED_MODEL_FILES):
            checks["models"]="missing"
        healthy=all(v=="ok" for v in checks.values())
        body={"status":"ok" if healthy else "error","service":"pharmacy-dss",**checks,
              "time":timezone.now(),"today":today().isoformat(),"demo":is_demo()}
        response=Response(body, status=200 if healthy else 503)
        response["Cache-Control"]="no-store"
        return response

class MedicineListView(APIView):
    required_permission="inventory.view"
    def get(self, request):
        qs=Medicine.objects.filter(active=True)
        q=request.query_params.get("q","").strip()
        if q: qs=qs.filter(name__icontains=q)
        plans=insights.current_plans()
        return Response([medicine_dict(m, plans.get(m.id)) for m in qs[:500]])

class InventoryView(APIView):
    required_permission="inventory.view"
    def get(self, request): return Response(insights.inventory_items())

class InventoryDetailView(APIView):
    required_permission="inventory.view"
    def get(self, request, pk):
        plans=insights.current_plans()
        try: m=Medicine.objects.get(pk=pk)
        except Medicine.DoesNotExist: return Response({"code":"not_found","detail":"Inventory item was not found."}, status=404)
        if m.id not in plans: return Response({"code":"not_found","detail":"No stock plan exists for this medicine."}, status=404)
        return Response(insights.inventory_item(m, plans[m.id]))

class InventoryHealthView(APIView):
    required_permission="inventory.view"
    def get(self, request): return Response(insights.inventory_health())

class InventoryTrendView(APIView):
    required_permission="inventory.view"
    def get(self, request): return Response(insights.inventory_trend())

class ExpiryRiskView(APIView):
    required_permission="expiry.view"
    def get(self, request): return Response(insights.expiry_batches())

class MedicineDetailView(APIView):
    required_permission="inventory.view"
    def get(self, request, pk):
        try:m=Medicine.objects.get(pk=pk)
        except Medicine.DoesNotExist:return Response({"code":"not_found","detail":"Medicine was not found."},status=404)
        return Response(medicine_dict(m, insights.current_plans().get(m.id)))


class MedicineTransactionsView(APIView):
    required_permission="inventory.view"
    def get(self, request, pk):
        try:m=Medicine.objects.get(pk=pk)
        except Medicine.DoesNotExist:return Response({"code":"not_found","detail":"Medicine was not found."},status=404)
        return Response(insights.transactions(m))

class MedicineForecastView(APIView):
    required_permission="forecast.view"
    def get(self, request, pk):
        try: m=Medicine.objects.get(pk=pk)
        except Medicine.DoesNotExist:return Response({"code":"not_found","detail":"Medicine was not found."},status=404)
        try: horizon=int(request.query_params.get("horizon",7))
        except ValueError:return Response({"code":"validation_error","fields":{"horizon":["Horizon must be a whole number."]}},status=400)
        if horizon<1 or horizon>90:return Response({"code":"validation_error","fields":{"horizon":["Horizon must be between 1 and 90 days."]}},status=400)
        try: return Response(insights.forecast(m, horizon))
        except FileNotFoundError as e:return Response({"code":"model_unavailable","detail":str(e)},status=503)
        except ValueError as e:return Response({"code":"insufficient_history","detail":str(e)},status=422)

class StockMovementView(APIView):
    required_permission="inventory.edit"
    @transaction.atomic
    def post(self, request):
        d=request.data; required=["batchId","kind","quantity","reason","key"]
        missing=[x for x in required if x not in d]
        if missing:return Response({"code":"validation_error","fields":{x:["This field is required."] for x in missing}},status=400)
        try: batch=Batch.objects.select_for_update().get(pk=d["batchId"]); qty=int(d["quantity"])
        except (Batch.DoesNotExist,ValueError,TypeError): return Response({"code":"validation_error","detail":"Batch or quantity is invalid."},status=400)
        kind=d["kind"]
        if kind not in {"receipt","dispense","adjustment","disposal"}: return Response({"code":"validation_error","fields":{"kind":["Movement kind is invalid."]}},status=400)
        if qty==0:return Response({"code":"validation_error","fields":{"quantity":["Quantity must not be zero."]}},status=400)
        if kind in {"dispense","disposal"} and qty>0: qty=-qty
        if kind=="receipt" and qty<0: return Response({"code":"validation_error","fields":{"quantity":["Receipt quantity must be positive."]}},status=400)
        current=sum(x.quantity for x in batch.medicine.batches.filter(quarantined=False))
        if kind in {"dispense","disposal"} and current < abs(qty): return Response({"code":"insufficient_stock","detail":"Insufficient available stock for this movement."},status=409)
        try: mv=StockMovement.objects.create(batch=batch,kind=kind,quantity=qty,occurred_at=timezone.now(),actor=request.user,reason=str(d["reason"])[:300],key=d["key"],fingerprint=str(d.get("fingerprint",""))[:64])
        except Exception: return Response({"code":"duplicate_movement","detail":"This movement key has already been processed."},status=409)
        for b in batch.medicine.batches.all():
            b.quantity=max(0,b.quantity + (qty if b.pk==batch.pk else 0))
            if b.pk==batch.pk:b.save(update_fields=["quantity"])
        return Response({"id":mv.id,"medicine":medicine_dict(batch.medicine)},status=201)

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def recommendation_dict(r):
    """A recommendation in the shape the frontend expects, built from the engine's stored payload."""
    p = r.payload or {}
    po = PurchaseOrder.objects.filter(recommendation=r).first()
    unit = float(r.unit_cost)
    prob = p.get("stockoutProbability", 0.0)
    return {
        "id": str(r.id), "medicineId": str(r.medicine_id), "medicineName": r.medicine.name,
        "strength": r.medicine.strength or "", "currentStock": p.get("currentStock", 0),
        "usableStock": p.get("usableStock"), "onOrder": p.get("onOrder", 0),
        "reorderPoint": p.get("reorderPoint", 0), "predictedDemand": p.get("predictedDemand", 0),
        "safetyStock": p.get("safetyStock", 0), "suggestedQuantity": r.quantity,
        "supplierId": str(r.offer.supplier_id), "supplierName": r.offer.supplier.name,
        "leadTimeDays": r.offer.lead_time_days, "unitCost": unit, "estimatedCost": round(r.quantity * unit, 2),
        "priority": p.get("priority", "medium"), "confidence": round(prob * 100),
        "stockoutProbability": prob, "stockoutRisk": p.get("stockoutRisk", "low"),
        "daysUntilReorderPoint": p.get("daysUntilReorderPoint", 0), "expiringUnits": p.get("expiringUnits", 0),
        "status": r.status, "rationale": r.reason or p.get("rationale", ""), "chain": p.get("chain", []),
        "asOf": r.as_of.isoformat(), "decidedAt": r.decided_at.isoformat() if r.decided_at else None,
        "decidedBy": (r.decided_by.get_full_name() or r.decided_by.email) if r.decided_by else None,
        "purchaseOrderId": str(po.id) if po else None,
    }


class RecommendationListView(APIView):
    required_permission="recommendations.view"
    def get(self, request):
        qs = (Recommendation.objects.exclude(status="superseded")
              .select_related("medicine", "offer__supplier", "decided_by").order_by("-created_at")[:500])
        rows = [recommendation_dict(r) for r in qs]
        rows.sort(key=lambda x: (x["status"] != "pending", PRIORITY_ORDER.get(x["priority"], 9)))
        return Response(rows)

class RecommendationDetailView(APIView):
    required_permission="recommendations.view"
    def get(self, request, pk):
        try: r=Recommendation.objects.select_related("medicine","offer__supplier").get(pk=pk)
        except Recommendation.DoesNotExist:return Response({"code":"not_found","detail":"Recommendation was not found."},status=404)
        return Response(recommendation_dict(r))

class RecommendationActionView(APIView):
    required_permission="recommendations.approve"
    @transaction.atomic
    def post(self, request, pk, action):
        try:r=Recommendation.objects.select_for_update().select_related("medicine","offer__supplier").get(pk=pk)
        except Recommendation.DoesNotExist:return Response({"code":"not_found","detail":"Recommendation was not found."},status=404)
        if r.status != "pending": return Response({"code":"conflict","detail":"Recommendation is no longer pending."},status=409)
        if action not in {"approve", "reject"}: return Response({"code":"validation_error","detail":"Action is invalid."},status=400)
        now = timezone.now()
        if action == "reject":
            r.status, r.decided_by, r.decided_at = "rejected", request.user, now
            r.save(update_fields=["status","decided_by","decided_at"])
            AuditEvent.objects.create(actor=request.user, action="reject_recommendation", entity=f"recommendation:{r.id}",
                                      details={"medicine": r.medicine.name})
            return Response(recommendation_dict(r))
        try: qty=int(request.data.get("quantity", r.quantity))
        except (TypeError, ValueError): return Response({"code":"validation_error","fields":{"quantity":["Enter a whole number."]}},status=400)
        if qty < 1: return Response({"code":"validation_error","fields":{"quantity":["Quantity must be at least 1."]}},status=400)
        offer = r.offer
        placed = today()
        po=PurchaseOrder.objects.create(recommendation=r, offer=offer, quantity=qty, unit_cost=offer.unit_cost,
                                        placed_at=placed, expected_at=placed + timedelta(days=offer.lead_time_days),
                                        created_by=request.user)
        if qty != r.quantity:
            r.quantity = qty
        r.status, r.decided_by, r.decided_at = "approved", request.user, now
        r.save(update_fields=["status","decided_by","decided_at","quantity"])
        AuditEvent.objects.create(actor=request.user, action="approve_recommendation", entity=f"recommendation:{r.id}",
                                  details={"medicine": r.medicine.name, "quantity": qty, "purchaseOrder": str(po.id)})
        return Response(recommendation_dict(r))

class SupplierListView(APIView):
    required_permission="suppliers.view"
    def get(self, request): return Response(insights.supplier_rows())

class SupplierPerformanceView(APIView):
    required_permission="suppliers.view"
    def get(self, request, pk):
        try:s=Supplier.objects.get(pk=pk)
        except Supplier.DoesNotExist:return Response({"code":"not_found","detail":"Supplier was not found."},status=404)
        return Response(insights.supplier_performance(s))

class DashboardView(APIView):
    required_permission="inventory.view"
    def get(self, request): return Response(insights.dashboard_kpis())

class InsightView(APIView):
    required_permission="inventory.view"
    def get(self, request): return Response(insights.insights())


class SearchView(APIView):
    required_permission="inventory.view"
    def get(self, request): return Response(insights.search(request.query_params.get("q","")))

class NotificationView(APIView):
    permission_classes=[IsAuthenticated]
    def get(self, request):
        qs = Notification.objects.filter(user=request.user).order_by("-created_at")[:100]
        return Response([
            {
                "id": str(n.id),
                "type": n.kind,
                "severity": n.severity,
                "title": n.title,
                "message": n.message,
                "read": n.read,
                "link": n.link or "",
                "createdAt": n.created_at.isoformat()
            }
            for n in qs
        ])
    def post(self, request):
        Notification.objects.filter(user=request.user, read=False).update(read=True)
        return Response({"status": "ok", "ok": True})

class NotificationReadView(APIView):
    permission_classes=[IsAuthenticated]
    def post(self, request, pk):
        updated = Notification.objects.filter(user=request.user, pk=pk).update(read=True)
        if not updated:
            return Response({"code": "not_found", "detail": "Notification was not found."}, status=404)
        return Response({"ok": True})

class ReportView(APIView):
    required_permission="reports.view"
    def post(self, request):
        d=request.data
        fmt=str(d.get("format","csv")).lower()
        if fmt not in {"csv","pdf"}: return Response({"code":"validation_error","fields":{"format":["Format must be csv or pdf."]}},status=400)
        kind=str(d.get("type","inventory"))
        if kind not in insights.REPORT_TITLES: return Response({"code":"validation_error","fields":{"type":["Unknown report type."]}},status=400)
        end=insights.parse_date(d.get("to"), today()); start=insights.parse_date(d.get("from"), end - timedelta(days=30))
        if start>end: return Response({"code":"validation_error","fields":{"from":["The start date must fall before the end date."]}},status=400)
        return Response(insights.build_report(kind, start, end, d.get("category") or None, d.get("supplierId") or None, fmt))
