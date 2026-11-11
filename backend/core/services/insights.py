"""Read-side services: every number the screens show, computed from data and models.

All pages share one source of truth: the decision engine's current plan for each
medicine (reorder point, safety stock, risk, FEFO expiry). The plan is cached and
recomputed automatically whenever stock, purchase orders or the date change.
"""
import base64
import csv
import hashlib
import io
import json
import threading
from datetime import date, timedelta

import numpy as np
import pandas as pd
from django.db.models import Q
from django.utils import timezone

from core.models import (Batch, CalendarDay, DailyDemand, Medicine, Policy, PurchaseOrder, Recommendation, StockMovement,
                         Supplier, SupplierDelivery, SupplierOffer)
from core.services import engine
from core.services.clock import today
from core.services.lab import SUPPLIER_FEATURES, _demand_test_frame, _meta, supplier_score_rows
from core.services.ml import _load

_lock = threading.Lock()
_cache = {}


# ------------------------------------------------------------ shared plan
def _signature(as_of):
    # Everything the engine reads: a change to any of it must produce a fresh plan.
    parts = [as_of.isoformat(),
             list(Batch.objects.order_by("id").values_list("id", "quantity", "quarantined", "expiry_date")),
             list(SupplierOffer.objects.order_by("id").values_list("id", "unit_cost", "lead_time_days", "lead_time_std",
                                                                   "pack_size", "minimum_order", "active")),
             list(Supplier.objects.order_by("id").values_list("id", "status")),
             list(Medicine.objects.order_by("id").values_list("id", "active", "category")),
             list(PurchaseOrder.objects.order_by("id").values_list("id", "quantity", "received_units", "status")),
             list(Policy.objects.values_list("service_level", "lead_time_buffer", "review_period")),
             Medicine.objects.count(), SupplierDelivery.objects.count()]
    return hashlib.sha256(json.dumps(parts, default=str).encode()).hexdigest()


def current_plans():
    """{medicine pk: engine result}, recomputed only when inputs change."""
    as_of = today()
    sig = _signature(as_of)
    with _lock:
        if sig not in _cache:
            run = engine.run(save=False)
            _cache.clear()
            _cache[sig] = {r["medicineId"]: r for r in run["results"]}
        return _cache[sig]


def stock_status(r):
    if r["currentStock"] == 0:
        return "out_of_stock"
    position = r["usableStock"] + r["onOrder"]
    if position <= r["safetyStock"] or r["stockoutProbability"] >= 0.5:
        return "critical"
    if position <= r["reorderPoint"] or r["stockoutAlert"]:
        return "low_stock"
    if r["expiringUnits"] > 0:
        return "expiring"
    return "in_stock"


def _earliest_expiry(r):
    dates = [b["expiryDate"] for b in r["batches"] if b["units"] > 0]
    return min(dates) if dates else None


# -------------------------------------------------------------- inventory
def inventory_item(m, r):
    return {
        "id": f"inv-{m.id}", "medicineId": str(m.id), "medicineName": m.name, "strength": m.strength or "",
        "category": m.category, "currentStock": r["currentStock"], "reorderPoint": r["reorderPoint"],
        "safetyStock": r["safetyStock"], "dailyConsumption": round(r["recentDailyAvg"], 1),
        "supplierId": str(r["supplierId"]), "supplierName": r["supplierName"], "unitCost": r["unitCost"],
        "earliestExpiry": _earliest_expiry(r), "status": stock_status(r),
        "stockoutProbability": r["stockoutProbability"], "onOrder": r["onOrder"],
    }


def inventory_items():
    plans = current_plans()
    return [inventory_item(m, plans[m.id]) for m in Medicine.objects.filter(active=True) if m.id in plans]


def inventory_health():
    counts = {"in_stock": 0, "low_stock": 0, "critical": 0, "out_of_stock": 0, "expiring": 0}
    for r in current_plans().values():
        counts[stock_status(r)] += 1
    labels = {"in_stock": "In stock", "low_stock": "Below reorder point", "critical": "Critical",
              "out_of_stock": "Out of stock", "expiring": "Expiry risk"}
    return [{"status": s, "label": labels[s], "count": counts[s]} for s in labels if counts[s] or s != "expiring"]


def _unit_prices():
    prices = {}
    for mid, cost in Batch.objects.order_by("id").values_list("medicine_id", "unit_cost"):
        prices.setdefault(mid, float(cost))
    return prices


def inventory_trend(months=12):
    """Monthly stock value, value received and value dispensed, from daily demand history."""
    as_of = today()
    rows = list(DailyDemand.objects.filter(date__lte=as_of).values("medicine_id", "date", "quantity", "closing_stock"))
    if not rows:
        return []
    df = pd.DataFrame(rows).sort_values(["medicine_id", "date"])
    df["price"] = df.medicine_id.map(_unit_prices()).fillna(0.0)
    df["prev"] = df.groupby("medicine_id").closing_stock.shift(1)
    df["received"] = (df.closing_stock - df.prev + df.quantity).clip(lower=0).fillna(0)
    df["month"] = pd.to_datetime(df.date).dt.to_period("M")
    out = []
    for period, g in list(df.groupby("month"))[-months:]:
        last = g.sort_values("date").groupby("medicine_id").tail(1)
        out.append({"period": period.strftime("%b %Y"),
                    "stockValue": round(float((last.closing_stock * last.price).sum()), 2),
                    "received": round(float((g.received * g.price).sum()), 2),
                    "dispensed": round(float((g.quantity * g.price).sum()), 2)})
    return out


def transactions(m, limit=60):
    """Recorded stock movements plus daily dispensing and receipts derived from the history."""
    as_of = today()
    out = [{"id": f"mv-{mv.id}", "date": mv.occurred_at.date().isoformat(), "type": mv.kind,
            "quantity": mv.quantity, "batch": mv.batch.number, "reference": mv.reason}
           for mv in StockMovement.objects.filter(batch__medicine=m).select_related("batch")[:limit]]
    hist = list(DailyDemand.objects.filter(medicine=m, date__lte=as_of, date__gt=as_of - timedelta(days=60))
                .order_by("date").values("date", "quantity", "closing_stock"))
    prev = None
    for h in hist:
        if h["quantity"]:
            out.append({"id": f"dd-{h['date']}", "date": h["date"].isoformat(), "type": "dispense",
                        "quantity": -h["quantity"], "batch": "FEFO", "reference": "Daily dispensing total"})
        if prev is not None and h["closing_stock"] is not None:
            received = h["closing_stock"] - prev + h["quantity"]
            if received > 0:
                out.append({"id": f"rc-{h['date']}", "date": h["date"].isoformat(), "type": "receipt",
                            "quantity": received, "batch": "—", "reference": "Delivery received"})
        prev = h["closing_stock"]
    out.sort(key=lambda t: t["date"], reverse=True)
    return out[:limit]


# --------------------------------------------------------------- forecast
_residual_bands = {}


def _band(category):
    """Empirical 80% interval: 10th and 90th percentile of held-out errors for the category."""
    if not _residual_bands:
        test = _demand_test_frame()
        resid = test.quantity_dispensed - test.prediction
        for cat, r in resid.groupby(test.category):
            _residual_bands[cat] = (float(np.percentile(r, 10)), float(np.percentile(r, 90)))
        _residual_bands["_all"] = (float(np.percentile(resid, 10)), float(np.percentile(resid, 90)))
    return _residual_bands.get(category, _residual_bands["_all"])


def forecast(m, horizon):
    as_of = today()
    hist = list(DailyDemand.objects.filter(medicine=m, date__lte=as_of).order_by("-date")
                .values_list("date", "quantity")[:max(30, horizon)])[::-1]
    if len(hist) < 30:
        raise ValueError("At least 30 days of demand history are required for a forecast.")
    cat_code = int(_load("Demand", "category_encoder_v1.pkl").transform([m.category])[0])
    holidays = {(d.date.month, d.date.day) for d in CalendarDay.objects.filter(holiday=True)}
    fc = engine.forecast_many({m.model_id: (cat_code, [q for _, q in hist[-30:]])}, as_of, horizon, holidays)[m.model_id]
    lo, hi = _band(m.category)
    series = [{"date": d.isoformat(), "actual": q, "forecast": None, "lower": None, "upper": None}
              for d, q in hist[-30:]]
    for i, y in enumerate(fc, start=1):
        series.append({"date": (as_of + timedelta(days=i)).isoformat(), "actual": None, "forecast": round(y, 1),
                       "lower": round(max(0.0, y + lo), 1), "upper": round(y + hi, 1)})
    previous = sum(q for _, q in hist[-horizon:])
    total = float(sum(fc))
    meta = _meta("Demand", "model_metadata_v1.json")
    return {
        "medicineId": str(m.id), "medicineName": f"{m.name} {m.strength}".strip(), "horizonDays": horizon,
        "series": series, "totalForecastDemand": round(total), "previousPeriodDemand": int(previous),
        "changeVsPreviousPeriodPct": round((total / previous - 1) * 100, 1) if previous else 0.0,
        "metrics": {"algorithm": "Random Forest regression (tuned)", "version": meta["version"],
                    "trainedAt": meta["trained_on"], "horizonDays": 1, "mae": round(meta["test_metrics"]["MAE"], 2),
                    "rmse": round(meta["test_metrics"]["RMSE"], 2), "mape": round(meta["test_metrics"]["MAPE"], 2)},
        "interval": "80% band from the model's held-out errors for this category",
        "limitations": ["Accuracy was measured one day ahead. Longer horizons feed predictions back in as inputs "
                        "and are less certain.", "Trained on simulated 2024 data."],
        "asOf": as_of.isoformat(),
    }


# --------------------------------------------------------------- suppliers
def supplier_rows():
    as_of = today()
    scores = engine.supplier_scores(as_of)
    rows = list(SupplierDelivery.objects.filter(actual_date__lte=as_of).values(
        "supplier_id", "order_date", "promised_date", "actual_date", "price_variance_pct", "defect_rate"))
    df = pd.DataFrame(rows)
    open_po = PurchaseOrder.objects.filter(status__in=["pending", "partial"])
    out = []
    for s in Supplier.objects.all():
        g = df[df.supplier_id == s.id] if len(df) else df
        sc = scores.get(s.id, {})
        lead = (pd.to_datetime(g.actual_date) - pd.to_datetime(g.order_date)).dt.days if len(g) else pd.Series(dtype=float)
        recent = g[pd.to_datetime(g.actual_date) > pd.Timestamp(as_of - timedelta(days=365))] if len(g) else g
        tier = sc.get("tier")
        out.append({
            "id": str(s.id), "name": s.name, "contactEmail": s.contact_email, "phone": s.phone,
            "overallScore": round(sc.get("score", 0) * 100, 1), "tier": tier, "orders": sc.get("orders", 0),
            "lowConfidence": sc.get("lowConfidence", True),
            "onTimeDeliveryPct": round(float((g.actual_date <= g.promised_date).mean() * 100), 1) if len(g) else 0.0,
            "priceConsistencyPct": round(float((g.price_variance_pct <= 0).mean() * 100), 1) if len(g) else 0.0,
            "qualityPct": round(float((1 - g.defect_rate.mean()) * 100), 2) if len(g) else 0.0,
            "defectRatePct": round(float(g.defect_rate.mean() * 100), 2) if len(g) else 0.0,
            "avgLeadTimeDays": round(float(lead.mean()), 1) if len(lead) else 0.0,
            "leadTimeVarianceDays": round(float(lead.std()), 1) if len(lead) > 1 else 0.0,
            "openOrders": open_po.filter(offer__supplier=s).count(),
            "lateDeliveries": int((recent.actual_date > recent.promised_date).sum()) if len(recent) else 0,
            "status": s.status if s.status != "active" else ("review" if tier == "At-Risk" else "active"),
        })
    out.sort(key=lambda r: -r["overallScore"])
    return out


def supplier_performance(s, months=12):
    as_of = today()
    rows = list(SupplierDelivery.objects.filter(supplier=s, actual_date__lte=as_of).values(
        "source_key", "order_date", "promised_date", "actual_date", "ordered", "delivered", "unit_price",
        "fulfillment_rate", "price_variance_pct", "defect_rate"))
    trend, orders = [], []
    if rows:
        df = pd.DataFrame(rows)
        df["month"] = pd.to_datetime(df.actual_date).dt.to_period("M")
        df["on_time"] = (df.actual_date <= df.promised_date).astype(float)
        df["lead"] = (pd.to_datetime(df.actual_date) - pd.to_datetime(df.order_date)).dt.days
        monthly = df.groupby("month").agg(
            on_time_rate=("on_time", "mean"), avg_fulfillment_rate=("fulfillment_rate", "mean"),
            avg_price_variance_pct=("price_variance_pct", "mean"), avg_defect_rate=("defect_rate", "mean"),
            lead=("lead", "mean")).tail(months)
        parts, _, _ = supplier_score_rows(monthly[SUPPLIER_FEATURES])
        for (period, row), part in zip(monthly.iterrows(), parts):
            trend.append({"period": period.strftime("%b %y"), "score": round(float(part.sum()) * 100, 1),
                          "onTime": round(row.on_time_rate * 100, 1), "leadTime": round(row.lead, 1)})
        for r in df.sort_values("actual_date", ascending=False).head(15).itertuples():
            orders.append({"id": r.source_key, "placedAt": r.order_date.isoformat(),
                           "expectedAt": r.promised_date.isoformat(), "receivedAt": r.actual_date.isoformat(),
                           "items": int(r.delivered), "value": round(r.delivered * float(r.unit_price), 2),
                           "status": "late" if r.actual_date > r.promised_date else "delivered"})
    for po in PurchaseOrder.objects.filter(offer__supplier=s, status__in=["pending", "partial"]):
        orders.insert(0, {"id": f"PO-{str(po.id)[:8]}", "placedAt": po.placed_at.isoformat(),
                          "expectedAt": po.expected_at.isoformat(), "receivedAt": None, "items": po.quantity,
                          "value": round(po.quantity * float(po.unit_cost), 2), "status": "pending"})
    return {"supplierId": str(s.id), "trend": trend, "orders": orders}


# ------------------------------------------------------------------ expiry
EXPIRY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def expiry_batches():
    plans = current_plans()
    meds = {m.id: m for m in Medicine.objects.filter(id__in=plans)}
    out = []
    for mid, r in plans.items():
        m = meds[mid]
        for b in r["batches"]:
            if b["units"] <= 0:
                continue
            unused, days = b["expectedUnused"], max(0, b["daysToExpiry"])
            if unused > 0 and days <= 30:
                risk = "critical"
            elif unused > 0 and (days <= 90 or unused / b["units"] >= 0.25):
                risk = "high"
            elif unused > 0:
                risk = "medium"
            else:
                risk = "low"
            if unused > 0:
                advice = (f"About {unused:,} units will not be used before expiry. Dispense this batch first, move "
                          f"stock to a busier site, or reduce the next order.")
            else:
                advice = ("In use now; it will be used up before it expires." if b["startsInDays"] == 0 else
                          f"Will be used up before expiry if dispensed first (its turn comes in about "
                          f"{b['startsInDays']} days).")
            out.append({
                "id": str(b["batchId"]), "medicineId": str(mid), "medicineName": m.name, "strength": m.strength or "",
                "batchNumber": b["batch"], "quantity": b["units"], "expiryDate": b["expiryDate"],
                "daysRemaining": days, "dailyConsumption": round(r["forecastDailyAvg"], 1),
                "projectedUnusedUnits": unused, "potentialLossValue": round(unused * b["unitCost"], 2),
                "risk": risk, "recommendation": advice,
            })
    out.sort(key=lambda x: (EXPIRY_ORDER[x["risk"]], x["daysRemaining"]))
    return out


# --------------------------------------------------------------- dashboard
def dashboard_kpis():
    as_of = today()
    plans = current_plans()
    statuses = [stock_status(r) for r in plans.values()]
    value = sum(b.quantity * float(b.unit_cost) for b in Batch.objects.filter(quarantined=False))
    prices = _unit_prices()
    month_ago = as_of - timedelta(days=30)
    old_value = sum((closing or 0) * prices.get(mid, 0) for mid, closing in
                    DailyDemand.objects.filter(date=month_ago).values_list("medicine_id", "closing_stock"))
    recent = sum(r["recentDailyAvg"] for r in plans.values())
    ahead = sum(r["forecastDailyAvg"] for r in plans.values())
    suppliers = supplier_rows()
    pending = Recommendation.objects.filter(status="pending")
    return {
        "totalMedicines": len(plans), "totalStock": sum(r["currentStock"] for r in plans.values()),
        "inventoryValue": round(value, 2),
        "lowStockItems": sum(s in ("low_stock", "critical") for s in statuses),
        "outOfStockItems": statuses.count("out_of_stock"),
        "reorderRecommendations": pending.count(),
        "criticalReorders": sum(1 for r in pending if (r.payload or {}).get("priority") == "critical"),
        "medicinesAtExpiryRisk": sum(1 for r in plans.values() if r["expiringUnits"] > 0),
        "expectedDemandChangePct": round((ahead / recent - 1) * 100, 1) if recent else 0.0,
        "activeSuppliers": sum(1 for s in suppliers if s["status"] == "active"),
        "avgSupplierScore": round(float(np.mean([s["overallScore"] for s in suppliers])), 1) if suppliers else 0.0,
        "lateDeliveries": PurchaseOrder.objects.filter(status__in=["pending", "partial"], expected_at__lt=as_of).count(),
        "pendingOrders": PurchaseOrder.objects.filter(status__in=["pending", "partial"]).count(),
        "deltas": {"inventoryValue": round((value / old_value - 1) * 100, 1)} if old_value else {},
        "asOf": as_of.isoformat(),
    }


def insights():
    plans = current_plans()
    out = []
    urgent = sorted((r for r in plans.values() if stock_status(r) in ("critical", "out_of_stock")),
                    key=lambda r: -r["stockoutProbability"])
    for r in urgent[:3]:
        out.append({"id": f"ins-risk-{r['medicineId']}", "severity": "critical",
                    "title": f"{r['medicineName']}: {r['stockoutProbability']:.0%} stockout risk",
                    "explanation": r["rationale"], "metricLabel": "Usable stock vs reorder point",
                    "metricValue": f"{r['usableStock'] + r['onOrder']:,} / {r['reorderPoint']:,}",
                    "recommendedAction": "Run the decision engine and review the reorder recommendation.",
                    "link": "/recommendations"})
    expiring = [b for b in expiry_batches() if b["risk"] != "low"]
    if expiring:
        b = expiring[0]
        out.append({"id": f"ins-exp-{b['id']}", "severity": "warning",
                    "title": f"{b['medicineName']} batch {b['batchNumber']}: {b['projectedUnusedUnits']:,} units may expire",
                    "explanation": b["recommendation"], "metricLabel": "Value at risk",
                    "metricValue": f"${b['potentialLossValue']:,.2f}", "recommendedAction": "Dispense this batch first.",
                    "link": "/expiry"})
    rising = sorted(plans.values(), key=lambda r: -(r["forecastDailyAvg"] / max(r["recentDailyAvg"], 1e-6)))
    if rising and rising[0]["recentDailyAvg"] > 0:
        r = rising[0]
        change = (r["forecastDailyAvg"] / r["recentDailyAvg"] - 1) * 100
        if change > 10:
            out.append({"id": f"ins-dem-{r['medicineId']}", "severity": "info",
                        "title": f"Demand for {r['medicineName']} expected to rise {change:.0f}%",
                        "explanation": f"Forecast {r['forecastDailyAvg']:.0f} units a day against {r['recentDailyAvg']:.0f} "
                                       f"over the last 30 days.", "metricLabel": "Forecast daily demand",
                        "metricValue": f"{r['forecastDailyAvg']:.0f} units", "recommendedAction": "Check the forecast.",
                        "link": "/forecasting"})
    weak = [r for r in plans.values() if r.get("supplierTier") == "At-Risk"]
    if weak:
        names = ", ".join(sorted({r["medicineName"] for r in weak}))
        out.append({"id": "ins-sup-atrisk", "severity": "warning",
                    "title": f"{len(weak)} medicines can only be bought from At-Risk suppliers",
                    "explanation": f"{names}. Consider qualifying another supplier.",
                    "metricLabel": "Medicines affected", "metricValue": str(len(weak)),
                    "recommendedAction": "Review supplier options.", "link": "/suppliers"})
    return out


# ------------------------------------------------------------------ search
def search(term):
    term = term.strip()
    if len(term) < 2:
        return {"medicines": [], "suppliers": [], "recommendations": []}
    scores = engine.supplier_scores(today())
    return {
        "medicines": [{"id": str(m.id), "label": f"{m.name} {m.strength}".strip(), "sub": m.category}
                      for m in Medicine.objects.filter(Q(name__icontains=term) | Q(category__icontains=term))[:8]],
        "suppliers": [{"id": str(s.id), "label": s.name, "sub": f"{scores.get(s.id, {}).get('tier', 'Unscored')} supplier"}
                      for s in Supplier.objects.filter(name__icontains=term)[:5]],
        "recommendations": [{"id": str(r.id), "label": f"Reorder {r.medicine.name}",
                             "sub": f"{r.quantity:,} units · {(r.payload or {}).get('priority', '')}"}
                            for r in Recommendation.objects.filter(status="pending", medicine__name__icontains=term)
                            .select_related("medicine")[:5]],
    }


# ----------------------------------------------------------------- reports
REPORT_TITLES = {"inventory": "Inventory position", "stock_movement": "Stock movements",
                 "demand_forecast": "Demand forecast", "reorder": "Reorder decisions",
                 "supplier_performance": "Supplier performance", "expiry_risk": "Expiry risk"}


def _report_rows(kind, start, end, category, supplier_id):
    plans = current_plans()
    meds = {m.id: m for m in Medicine.objects.all()}

    def keep(mid=None, sup=None):
        return ((not category or (mid in meds and meds[mid].category == category)) and
                (not supplier_id or sup is None or str(sup) == str(supplier_id)))

    if kind == "inventory":
        return [{k: v for k, v in inventory_item(meds[mid], r).items() if k not in ("id",)}
                for mid, r in plans.items() if keep(mid, r["supplierId"])]
    if kind == "stock_movement":
        rows = []
        for d in DailyDemand.objects.filter(date__gte=start, date__lte=end).select_related("medicine").order_by("date"):
            if keep(d.medicine_id):
                rows.append({"date": d.date.isoformat(), "medicine": d.medicine.name, "dispensed": d.quantity,
                             "closingStock": d.closing_stock, "stockoutDay": d.stockout})
        for mv in StockMovement.objects.filter(occurred_at__date__gte=start, occurred_at__date__lte=end) \
                .select_related("batch__medicine"):
            if keep(mv.batch.medicine_id):
                rows.append({"date": mv.occurred_at.date().isoformat(), "medicine": mv.batch.medicine.name,
                             "dispensed": -mv.quantity if mv.quantity < 0 else 0, "closingStock": None,
                             "stockoutDay": False})
        return rows
    if kind == "demand_forecast":
        return [{"medicine": r["medicineName"], "category": r["category"], "recentDailyAvg": r["recentDailyAvg"],
                 "forecastDailyAvg": r["forecastDailyAvg"], "leadTimeDays": r["leadTimeDays"],
                 "forecastLeadTimeDemand": r["predictedDemand"],
                 "changePct": round((r["forecastDailyAvg"] / r["recentDailyAvg"] - 1) * 100, 1) if r["recentDailyAvg"] else None}
                for mid, r in plans.items() if keep(mid)]
    if kind == "reorder":
        rows = []
        for rec in Recommendation.objects.exclude(status="superseded").filter(as_of__gte=start, as_of__lte=end) \
                .select_related("medicine", "offer__supplier", "decided_by"):
            if keep(rec.medicine_id, rec.offer.supplier_id):
                p = rec.payload or {}
                rows.append({"asOf": rec.as_of.isoformat(), "medicine": rec.medicine.name, "priority": p.get("priority"),
                             "quantity": rec.quantity, "unitCost": float(rec.unit_cost),
                             "estimatedCost": round(rec.quantity * float(rec.unit_cost), 2),
                             "supplier": rec.offer.supplier.name, "stockoutProbability": p.get("stockoutProbability"),
                             "status": rec.status,
                             "decidedBy": (rec.decided_by.get_full_name() or rec.decided_by.email) if rec.decided_by else ""})
        return rows
    if kind == "supplier_performance":
        return [{k: v for k, v in s.items() if k not in ("contactEmail", "phone")}
                for s in supplier_rows() if not supplier_id or s["id"] == str(supplier_id)]
    if kind == "expiry_risk":
        return [{k: v for k, v in b.items() if k not in ("id", "medicineId")}
                for b in expiry_batches() if keep(int(b["medicineId"]))]
    raise ValueError("Unknown report type.")


def _pdf(title, columns, rows, subtitle):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24)
    styles = getSampleStyleSheet()
    cell = styles["BodyText"].clone("cell", fontSize=7, leading=8.5)
    data = [[Paragraph(f"<b>{c}</b>", cell) for c in columns]]
    data += [[Paragraph("" if r.get(c) is None else str(r.get(c)), cell) for c in columns] for r in rows[:2000]]
    table = Table(data, repeatRows=1)
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                               ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF0")),
                               ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    doc.build([Paragraph(title, styles["Title"]), Paragraph(subtitle, styles["Normal"]), Spacer(1, 10), table])
    return buffer.getvalue()


def build_report(kind, start, end, category=None, supplier_id=None, fmt="csv"):
    if kind not in REPORT_TITLES:
        raise ValueError("Unknown report type.")
    rows = _report_rows(kind, start, end, category, supplier_id)
    columns = list(rows[0].keys()) if rows else ["message"]
    if not rows:
        rows = [{"message": "No records match these filters."}]
    title = f"{REPORT_TITLES[kind]} report"
    subtitle = (f"Parirenyatwa Group of Hospitals Pharmacy · {start} to {end} · generated "
                f"{timezone.localtime():%d %b %Y %H:%M} · data as at {today():%d %b %Y} (simulated dataset)")
    if fmt == "pdf":
        content, mime, ext = _pdf(title, columns, rows, subtitle), "application/pdf", "pdf"
    else:
        stream = io.StringIO()
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        content, mime, ext = stream.getvalue().encode("utf-8"), "text/csv", "csv"
    return {"generatedAt": timezone.now().isoformat(), "rows": 0 if columns == ["message"] else len(rows),
            "filename": f"{kind}-{start}-to-{end}.{ext}", "mimeType": mime,
            "contentBase64": base64.b64encode(content).decode("ascii"), "columns": columns, "preview": rows[:5]}


def parse_date(value, fallback):
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return fallback
