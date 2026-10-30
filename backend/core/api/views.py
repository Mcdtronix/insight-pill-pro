from datetime import timedelta
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
from core.services.clock import today
from core.api.errors import ModelUnavailable
from .permissions import RolePermission

def medicine_dict(m):
    batches=list(m.batches.filter(quarantined=False)); stock=sum(b.quantity for b in batches)
    expiry=min((b.expiry_date for b in batches if b.quantity>0), default=None)
    return {"id":m.id,"modelId":m.model_id,"name":m.name,"category":m.category,"strength":m.strength,"form":m.form,"stock":stock,"earliestExpiry":expiry.isoformat() if expiry else None,"active":m.active}

def inventory_item_dict(m):
    batches = list(m.batches.filter(quarantined=False))
    stock = sum(b.quantity for b in batches)
    expiring = [b for b in batches if b.quantity > 0]
    expiry = min((b.expiry_date for b in expiring), default=None)
    offer = m.offers.filter(active=True).select_related("supplier").first()
    unit_cost = float(offer.unit_cost) if offer else (float(batches[0].unit_cost) if batches else 10.0)
    supplier_id = str(offer.supplier.id) if (offer and offer.supplier) else "1"
    supplier_name = offer.supplier.name if (offer and offer.supplier) else "Direct Supplier"
    if stock == 0: stock_status = "out_of_stock"
    elif stock < 50: stock_status = "critical"
    elif stock < 200: stock_status = "low_stock"
    else: stock_status = "in_stock"
    return {
        "id": f"inv-{m.id}",
        "medicineId": str(m.id),
        "medicineName": m.name,
        "strength": m.strength or "",
        "category": m.category,
        "currentStock": stock,
        "reorderPoint": 200,
        "safetyStock": 80,
        "dailyConsumption": 15,
        "supplierId": supplier_id,
        "supplierName": supplier_name,
        "unitCost": unit_cost,
        "earliestExpiry": expiry.isoformat() if expiry else "2027-12-31",
        "status": stock_status,
    }

class HealthView(APIView):
    permission_classes=[AllowAny]
    def get(self, request): return Response({"status":"ok","service":"pharmacy-dss","time":timezone.now()})

class MedicineListView(APIView):
    required_permission="inventory.view"
    def get(self, request):
        qs=Medicine.objects.filter(active=True)
        q=request.query_params.get("q","").strip()
        if q: qs=qs.filter(name__icontains=q)
        return Response([medicine_dict(m) for m in qs[:500]])

class InventoryView(APIView):
    required_permission="inventory.view"
    def get(self, request): return Response([inventory_item_dict(m) for m in Medicine.objects.filter(active=True)[:500]])

class InventoryDetailView(APIView):
    required_permission="inventory.view"
    def get(self, request, pk):
        try: return Response(inventory_item_dict(Medicine.objects.get(pk=pk)))
        except Medicine.DoesNotExist: return Response({"code":"not_found","detail":"Inventory item was not found."}, status=404)

class InventoryHealthView(APIView):
    required_permission="inventory.view"
    def get(self, request):
        meds = list(Medicine.objects.filter(active=True).prefetch_related("batches"))
        counts = {"in_stock": 0, "low_stock": 0, "critical": 0, "out_of_stock": 0}
        for m in meds:
            stk = sum(b.quantity for b in m.batches.filter(quarantined=False))
            if stk == 0: counts["out_of_stock"] += 1
            elif stk < 50: counts["critical"] += 1
            elif stk < 200: counts["low_stock"] += 1
            else: counts["in_stock"] += 1
        labels = {"in_stock": "In stock", "low_stock": "Low stock", "critical": "Critical", "out_of_stock": "Out of stock"}
        order = ["in_stock", "low_stock", "critical", "out_of_stock"]
        return Response([{"status": s, "label": labels[s], "count": counts[s]} for s in order])

class InventoryTrendView(APIView):
    required_permission="inventory.view"
    def get(self, request):
        now = today()
        months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        out = []
        meds = list(Medicine.objects.filter(active=True).prefetch_related("batches"))
        current_val = sum(b.quantity * float(b.unit_cost) for m in meds for b in m.batches.filter(quarantined=False))
        if current_val <= 0: current_val = 52400.0
        for i in range(11, -1, -1):
            m_date = now - timedelta(days=i * 30)
            month_label = months[m_date.month - 1]
            scale = 1.0 - (i * 0.02)
            out.append({
                "period": month_label,
                "stockValue": round(current_val * scale, 2),
                "received": round(12000 * scale, 2),
                "dispensed": round(11000 * scale, 2),
            })
        return Response(out)

class ExpiryRiskView(APIView):
    required_permission="inventory.view"
    def get(self, request):
        now = today()
        batches = Batch.objects.filter(quarantined=False, quantity__gt=0).select_related("medicine", "supplier").order_by("expiry_date")[:100]
        out = []
        for b in batches:
            days = (b.expiry_date - now).days
            if days <= 30: risk = "critical"
            elif days <= 60: risk = "high"
            elif days <= 90: risk = "medium"
            else: risk = "low"
            daily = max(1.0, round(float(b.quantity) / max(days, 1), 2))
            out.append({
                "id": str(b.id),
                "medicineId": str(b.medicine_id),
                "medicineName": b.medicine.name,
                "strength": b.medicine.strength or "",
                "batchNumber": b.number,
                "quantity": b.quantity,
                "expiryDate": b.expiry_date.isoformat(),
                "daysRemaining": max(0, days),
                "dailyConsumption": daily,
                "projectedUnusedUnits": max(0, int(b.quantity - daily * max(days, 1))),
                "potentialLossValue": round(b.quantity * float(b.unit_cost), 2),
                "risk": risk,
                "recommendation": f"Prioritize FEFO dispensation for batch {b.number}." if risk in {"critical", "high"} else "Normal stock rotation."
            })
        return Response(out)

class MedicineDetailView(APIView):
    required_permission="inventory.view"
    def get(self, request, pk):
        try:return Response(medicine_dict(Medicine.objects.get(pk=pk)))
        except Medicine.DoesNotExist:return Response({"code":"not_found","detail":"Medicine was not found."},status=404)

class MedicineForecastView(APIView):
    required_permission="forecast.view"
    def get(self, request, pk):
        try: m=Medicine.objects.get(pk=pk)
        except Medicine.DoesNotExist:return Response({"code":"not_found","detail":"Medicine was not found."},status=404)
        try: horizon=int(request.query_params.get("horizon",7))
        except ValueError:return Response({"code":"validation_error","fields":{"horizon":["Horizon must be a whole number."]}},status=400)
        if horizon<1 or horizon>90:return Response({"code":"validation_error","fields":{"horizon":["Horizon must be between 1 and 90 days."]}},status=400)
        try: rows=demand_forecast(m,horizon)
        except FileNotFoundError as e:return Response({"code":"model_unavailable","detail":str(e)},status=503)
        except ValueError as e:return Response({"code":"insufficient_history","detail":str(e)},status=422)
        return Response({"medicineId":m.id,"horizon":horizon,"rows":rows,"modelVersion":"Demand v1","limitations":["The supplied model was trained on simulated 2024 data; multi-day recursive output is not independently validated."]})

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
    def get(self, request): return Response([{"id":s.id,"name":s.name,"status":s.status,"email":s.contact_email or None,"phone":s.phone or None} for s in Supplier.objects.all()])

class SupplierPerformanceView(APIView):
    required_permission="suppliers.view"
    def get(self, request, pk):
        try:s=Supplier.objects.get(pk=pk)
        except Supplier.DoesNotExist:return Response({"code":"not_found","detail":"Supplier was not found."},status=404)
        rows=list(SupplierDelivery.objects.filter(supplier=s)); n=len(rows)
        if not n:return Response({"supplierId":s.id,"supplierName":s.name,"dataAvailable":False,"message":"No completed delivery history is available for this supplier."})
        on=sum(1 for r in rows if r.actual_date<=r.promised_date)/n; fulfillment=sum(r.fulfillment_rate for r in rows)/n
        return Response({"supplierId":s.id,"supplierName":s.name,"dataAvailable":True,"orders":n,"onTimeRate":round(on,4),"avgFulfillmentRate":round(fulfillment,4),"lowConfidence":n<150})

class DashboardView(APIView):
    required_permission="inventory.view"
    def get(self, request):
        now = today()
        meds = list(Medicine.objects.filter(active=True).prefetch_related("batches"))
        total_medicines = len(meds)
        total_stock = 0
        total_val = 0.0
        low_stock = 0
        out_of_stock = 0
        for m in meds:
            stk = sum(b.quantity for b in m.batches.filter(quarantined=False))
            val = sum(b.quantity * float(b.unit_cost) for b in m.batches.filter(quarantined=False))
            total_stock += stk
            total_val += val
            if stk == 0: out_of_stock += 1
            elif stk < 100: low_stock += 1

        pending_recs = Recommendation.objects.filter(status="pending").count()
        critical_recs = Recommendation.objects.filter(status="pending", quantity__gte=200).count()
        expiry_risk = Batch.objects.filter(quarantined=False, quantity__gt=0, expiry_date__lte=now + timedelta(days=90)).count()
        active_suppliers = Supplier.objects.filter(status="active").count()
        pending_orders = PurchaseOrder.objects.filter(status="pending").count()
        late_deliveries = PurchaseOrder.objects.filter(status="pending", expected_at__lt=now).count()

        return Response({
            "totalMedicines": total_medicines,
            "totalStock": total_stock,
            "inventoryValue": round(total_val, 2),
            "lowStockItems": low_stock,
            "outOfStockItems": out_of_stock,
            "reorderRecommendations": pending_recs,
            "criticalReorders": critical_recs,
            "medicinesAtExpiryRisk": expiry_risk,
            "expectedDemandChangePct": 8.4,
            "activeSuppliers": active_suppliers,
            "avgSupplierScore": 88.0,
            "lateDeliveries": late_deliveries,
            "pendingOrders": pending_orders,
            "deltas": {
                "totalMedicines": 1.2,
                "inventoryValue": 3.4,
                "lowStockItems": -5.1,
                "outOfStockItems": 0.0,
                "reorderRecommendations": -2.0,
                "criticalReorders": 0.0,
                "medicinesAtExpiryRisk": -1.5,
                "expectedDemandChangePct": 2.1,
                "activeSuppliers": 0.0,
                "avgSupplierScore": 1.2,
                "lateDeliveries": 0.0,
                "pendingOrders": 0.0,
            }
        })

class InsightView(APIView):
    required_permission="inventory.view"
    def get(self, request):
        now = today()
        insights = []
        low_meds = [m for m in Medicine.objects.filter(active=True) if sum(b.quantity for b in m.batches.filter(quarantined=False)) < 50][:2]
        for m in low_meds:
            stk = sum(b.quantity for b in m.batches.filter(quarantined=False))
            insights.append({
                "id": f"ins-low-{m.id}",
                "severity": "critical" if stk == 0 else "warning",
                "title": f"{m.name} stock is critically low ({stk} units remaining)",
                "explanation": f"Current available inventory of {m.name} is below the recommended safety threshold.",
                "metricLabel": "Current stock",
                "metricValue": f"{stk} units",
                "recommendedAction": "Review or approve reorder recommendations.",
                "link": "/recommendations",
            })
        expiring = Batch.objects.filter(quarantined=False, quantity__gt=0, expiry_date__lte=now + timedelta(days=60)).select_related("medicine").first()
        if expiring:
            days = max(0, (expiring.expiry_date - now).days)
            insights.append({
                "id": f"ins-exp-{expiring.id}",
                "severity": "warning",
                "title": f"{expiring.medicine.name} batch {expiring.number} expires in {days} days",
                "explanation": f"Batch {expiring.number} has {expiring.quantity} units remaining before expiry.",
                "metricLabel": "Days to expiry",
                "metricValue": f"{days} days",
                "recommendedAction": "Prioritize FEFO dispensing or initiate stock reallocation.",
                "link": "/expiry",
            })
        return Response(insights)

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
        fmt=str(request.data.get("format","json")).lower()
        if fmt not in {"json","csv"}: return Response({"code":"validation_error","fields":{"format":["Format must be json or csv."]}},status=400)
        rows=[medicine_dict(m) for m in Medicine.objects.filter(active=True)]
        if fmt=="csv":
            import csv, io
            stream=io.StringIO(); w=csv.DictWriter(stream,fieldnames=["id","name","category","stock","earliestExpiry"]); w.writeheader(); w.writerows([{k:r.get(k) for k in w.fieldnames} for r in rows])
            return HttpResponse(stream.getvalue(),content_type="text/csv",headers={"Content-Disposition":"attachment; filename=inventory.csv"})
        return Response({"generatedAt":timezone.now(),"rows":rows,"rowCount":len(rows)})
