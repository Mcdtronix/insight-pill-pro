"""Decision engine: combines the four models into one reorder decision per medicine.

For every medicine, as at the demo/real "today":

  1. Supplier (Model 3)  Score each supplier from its delivered orders and pick the
                          best-tier, best-scoring supplier offering this medicine.
                          Its lead time L drives everything below.
  2. Forecast (Model 1)  Forecast daily demand for the next L + review-period days.
  3. Policy maths        Safety stock  SS = z * sigma_d * sqrt(L)
                          Reorder point ROP = forecast demand over L + SS
                          Order-up-to   S   = forecast demand over (L + review) + SS
  4. Expiry (Model 4)    Simulate first-expiry-first-out use of each batch against
                          the forecast. Units that will expire unused do not count
                          as usable stock.
  5. Risk (Model 2)      Probability of a stockout before the next delivery.
  6. Decision            Reorder when usable position <= ROP or the risk model alerts.
                          Quantity = order-up-to gap, at least the Economic Order
                          Quantity, capped at 90 days of forecast demand.

Every intermediate value is stored in the recommendation's payload so the UI can
show exactly how the decision was reached. A pharmacist must approve it.
"""
import math
import time
from datetime import timedelta
from decimal import Decimal

import numpy as np
import pandas as pd
from django.db import transaction
from django.db.models import Sum

from core.models import (AuditEvent, Batch, CalendarDay, DailyDemand, DataState, Medicine, Policy, PurchaseOrder,
                         Recommendation, SupplierDelivery, SupplierOffer)
from core.services.clock import today
from core.services.lab import (DEMAND_FEATURES, SUPPLIER_FEATURES, _reorder_meta, _reorder_row,
                               explain_forest, supplier_score_rows)
from core.services.ml import _load, forest_regress

# Assumptions not present in the datasets. Shown with every decision.
ORDERING_COST_USD = 25.0      # administrative cost of placing one order
HOLDING_RATE = 0.20           # yearly holding cost as a share of unit cost
MAX_COVER_DAYS = 90           # never order more than this many days of forecast demand
Z_BY_SERVICE_LEVEL = {90.0: 1.2816, 95.0: 1.6449, 97.5: 1.96, 99.0: 2.3263}
TIER_RANK = {"Preferred": 0, "Acceptable": 1, "At-Risk": 2}
SEASON_BY_MONTH = {1: "Rainy Season", 2: "Rainy Season", 3: "Rainy Season", 4: "Transition Season",
                   5: "Transition Season", 6: "Dry/Cold Season", 7: "Dry/Cold Season", 8: "Dry/Cold Season",
                   9: "Dry/Cold Season", 10: "Transition Season", 11: "Rainy Season", 12: "Rainy Season"}


# ------------------------------------------------------------------ step 1
def supplier_scores(as_of):
    """Model 3 on live delivery history: score and tier every supplier."""
    rows = list(SupplierDelivery.objects.filter(actual_date__lte=as_of).values(
        "supplier_id", "supplier__name", "actual_date", "promised_date", "fulfillment_rate",
        "price_variance_pct", "defect_rate"))
    if not rows:
        return {}
    df = pd.DataFrame(rows)
    df["on_time"] = (df.actual_date <= df.promised_date).astype(float)
    agg = df.groupby(["supplier_id", "supplier__name"]).agg(
        n_orders=("on_time", "size"), on_time_rate=("on_time", "mean"),
        avg_fulfillment_rate=("fulfillment_rate", "mean"), avg_price_variance_pct=("price_variance_pct", "mean"),
        avg_defect_rate=("defect_rate", "mean")).reset_index()
    parts, tiers, _ = supplier_score_rows(agg)
    out = {}
    for row, part, tier in zip(agg.itertuples(), parts, tiers):
        out[int(row.supplier_id)] = {"name": row.supplier__name, "score": round(float(part.sum()), 4), "tier": tier,
                                     "orders": int(row.n_orders), "lowConfidence": bool(row.n_orders < 150),
                                     "onTimeRate": round(float(row.on_time_rate), 3)}
    return out


def choose_offer(offers, scores):
    """Best tier first, then highest score, then shortest lead time."""
    def key(o):
        s = scores.get(o.supplier_id, {"tier": "At-Risk", "score": 0})
        return (TIER_RANK.get(s["tier"], 3), -s["score"], o.lead_time_days)
    ranked = sorted(offers, key=key)
    return ranked[0] if ranked else None, ranked


# ------------------------------------------------------------------ step 2
def forecast_many(histories, start, horizon, holidays):
    """Model 1, recursively, for many medicines at once (one model call per day).

    histories: {model_id: (category_code, [last 30 quantities, oldest first])}
    Returns {model_id: [daily forecasts]}.
    """
    model = _load("Demand", "forecast_model_v1.pkl")
    season_enc = _load("Demand", "season_encoder_v1.pkl")
    season_codes = {s: int(season_enc.transform([s])[0]) for s in season_enc.classes_}
    ids = list(histories)
    vals = {mid: list(map(float, histories[mid][1])) for mid in ids}
    out = {mid: [] for mid in ids}
    for i in range(1, horizon + 1):
        d = start + timedelta(days=i)
        rows = []
        for mid in ids:
            v = vals[mid]
            w7, w30 = v[-7:], v[-30:]
            rows.append([mid, histories[mid][0], season_codes[SEASON_BY_MONTH[d.month]], d.weekday(), d.month,
                         int(d.weekday() >= 5), int((d.month, d.day) in holidays), v[-1], v[-7], v[-14], v[-30],
                         np.mean(w7), np.mean(w30), np.std(w7, ddof=1)])
        preds = np.maximum(0.0, forest_regress(model, np.asarray(rows, dtype=float)))
        for mid, y in zip(ids, preds):
            vals[mid].append(float(y))
            out[mid].append(float(y))
    return out


def demand_stats(recent):
    """Mean and std of daily demand, ignoring stockout days.

    On a stockout day nothing could be dispensed, so the recorded zero hides the true
    demand (censoring). Uses the last 30 days without stockouts, widening to 60 days
    when fewer than 10 clean days remain. Returns (mean, std, stockout days in last 30).
    """
    last30 = recent[-30:]
    censored = sum(1 for _, s in last30 if s)
    clean = [q for q, s in last30 if not s]
    if len(clean) < 10:
        clean = [q for q, s in recent if not s]
    if len(clean) < 5:
        clean = [q for q, _ in last30]
    arr = np.array(clean, dtype=float)
    return float(arr.mean()), float(arr.std(ddof=1)) if len(arr) > 1 else 0.0, censored


# ------------------------------------------------------------------ step 4
def fefo_expiry(batches, daily_forecast, as_of):
    """Use batches earliest-expiry-first against the forecast.

    Returns (units expected to expire unused, at-risk batch detail, per-batch outcome for every batch).
    """
    remaining = [[b, b.quantity] for b in sorted(batches, key=lambda b: (b.expiry_date, b.id))]
    expiring, detail, per_batch = 0, [], []
    day = 0
    avg = float(np.mean(daily_forecast)) if daily_forecast else 0.0
    for b, qty in remaining:
        days_left = (b.expiry_date - as_of).days
        # demand available to this batch: from `day` until it expires
        usable_days = max(0, days_left - day)
        demand = _demand_between(daily_forecast, avg, day, day + usable_days)
        used = min(qty, demand)
        unused = qty - used
        if unused > 0:
            expiring += unused
            detail.append({"batch": b.number, "expiryDate": b.expiry_date.isoformat(), "daysToExpiry": days_left,
                           "units": int(qty), "expectedUnused": int(round(unused))})
        per_batch.append({"batchId": b.id, "batch": b.number, "expiryDate": b.expiry_date.isoformat(),
                          "daysToExpiry": days_left, "units": int(qty), "expectedUsed": int(round(used)),
                          "expectedUnused": int(round(unused)), "unitCost": float(b.unit_cost),
                          "startsInDays": int(day)})
        day += _days_to_consume(daily_forecast, avg, day, used)
    return int(round(expiring)), detail, per_batch


def _demand_between(fc, avg, a, b):
    if b <= a:
        return 0.0
    within = sum(fc[a:min(b, len(fc))])
    beyond = max(0, b - max(a, len(fc))) * avg
    return within + beyond


def _days_to_consume(fc, avg, start, units):
    total, d = 0.0, start
    while total < units and d < start + 3650:
        total += fc[d] if d < len(fc) else avg
        d += 1
        if avg <= 0 and d >= len(fc):
            return 3650
    return d - start


# ------------------------------------------------------------------- engine
def run(model_ids=None, user=None, save=True):
    started = time.perf_counter()
    as_of = today()
    policy, _ = Policy.objects.get_or_create(id=1)
    z = Z_BY_SERVICE_LEVEL.get(float(policy.service_level), 1.6449)
    meds = list(Medicine.objects.filter(active=True, model_id__isnull=False).order_by("model_id"))
    if model_ids:
        meds = [m for m in meds if m.model_id in set(model_ids)]
    scores = supplier_scores(as_of)
    holidays = {(d.date.month, d.date.day) for d in CalendarDay.objects.filter(holiday=True)}
    category_enc = _load("Demand", "category_encoder_v1.pkl")
    reorder_model = _load("Reorder", "reorder_risk_model_v1.pkl")
    threshold = _reorder_meta()["decision_threshold"]

    plans, histories = {}, {}
    for m in meds:
        recent = list(DailyDemand.objects.filter(medicine=m, date__lte=as_of).order_by("-date")
                      .values_list("quantity", "stockout")[:60])[::-1]
        hist = [q for q, _ in recent[-30:]]
        if len(hist) < 30:
            continue
        offers = list(SupplierOffer.objects.filter(medicine=m, active=True).select_related("supplier"))
        offer, ranked = choose_offer(offers, scores)
        if offer is None:
            continue
        lead = int(offer.lead_time_days) + int(policy.lead_time_buffer)
        plans[m.model_id] = {"medicine": m, "offer": offer, "ranked": ranked, "lead": lead, "history": hist,
                             "demand_stats": demand_stats(recent)}
        histories[m.model_id] = (int(category_enc.transform([m.category])[0]), hist)

    horizon = min(MAX_COVER_DAYS, max([p["lead"] + policy.review_period for p in plans.values()] or [1]))
    forecasts = forecast_many(histories, as_of, horizon, holidays) if histories else {}

    results, rows_for_risk = [], []
    for mid, p in plans.items():
        m, offer, lead = p["medicine"], p["offer"], p["lead"]
        fc = forecasts[mid]
        mean_30, std_30, censored_days = p["demand_stats"]
        demand_lead = float(sum(fc[:lead]))
        demand_cycle = float(sum(fc[:lead + policy.review_period]))
        daily_fc = demand_cycle / (lead + policy.review_period)
        safety = z * std_30 * math.sqrt(lead)
        rop = demand_lead + safety
        order_up_to = demand_cycle + safety

        batches = list(Batch.objects.filter(medicine=m, quarantined=False, quantity__gt=0))
        on_hand = sum(b.quantity for b in batches)
        expiring, expiry_detail, per_batch = fefo_expiry(batches, fc, as_of)
        open_pos = PurchaseOrder.objects.filter(offer__medicine=m, status__in=["pending", "partial"])
        on_order = int(sum(po.quantity - po.received_units for po in open_pos))
        usable = on_hand - expiring
        position = usable + on_order

        x = _reorder_row(mid, m.category, on_hand, mean_30, std_30, offer.lead_time_days, offer.lead_time_std,
                         bool(open_pos))
        rows_for_risk.append((mid, x))
        p.update(fc=fc, mean_30=mean_30, std_30=std_30, demand_lead=demand_lead, demand_cycle=demand_cycle,
                 daily_fc=daily_fc, censored_days=censored_days, safety=safety, rop=rop, order_up_to=order_up_to, on_hand=on_hand,
                 expiring=expiring, expiry_detail=expiry_detail, per_batch=per_batch, on_order=on_order, usable=usable,
                 position=position, risk_x=x)

    if rows_for_risk:
        frame = pd.concat([x for _, x in rows_for_risk], ignore_index=True)
        probas = reorder_model.predict_proba(frame)[:, 1]
        for (mid, x), prob in zip(rows_for_risk, probas):
            base, contribs = explain_forest(reorder_model, x.iloc[0].to_numpy(), class_index=1)
            top = sorted(zip(x.columns, contribs), key=lambda t: -abs(t[1]))[:3]
            plans[mid].update(prob=float(prob), risk_drivers=[{"feature": f, "contribution": round(float(c), 4)}
                                                              for f, c in top])

    for mid, p in plans.items():
        results.append(_decide(p, policy, threshold, scores, as_of))

    created = _save(results, plans, as_of, user) if save else 0
    return {"asOf": as_of.isoformat(), "checked": len(results), "reorder": sum(r["reorder"] for r in results),
            "created": created, "durationMs": int((time.perf_counter() - started) * 1000),
            "assumptions": {"serviceLevel": policy.service_level, "z": z, "leadTimeBufferDays": policy.lead_time_buffer,
                            "reviewPeriodDays": policy.review_period, "orderingCostUsd": ORDERING_COST_USD,
                            "holdingRate": HOLDING_RATE, "maxCoverDays": MAX_COVER_DAYS},
            "results": results}


def _decide(p, policy, threshold, scores, as_of):
    m, offer = p["medicine"], p["offer"]
    unit = float(offer.unit_cost)
    prob, alert = p["prob"], p["prob"] >= threshold
    below_rop = p["position"] <= p["rop"]
    # A risk alert only triggers a NEW order when nothing is already on the way.
    # If an order is open, another one would arrive just as late: expedite instead.
    expedite = alert and p["on_order"] > 0 and not below_rop
    reorder = below_rop or (alert and p["on_order"] == 0)
    annual = p["daily_fc"] * 365
    eoq = math.sqrt(2 * annual * ORDERING_COST_USD / (HOLDING_RATE * unit)) if unit > 0 and annual > 0 else 0.0
    gap = max(0.0, p["order_up_to"] - p["position"])
    cap = p["daily_fc"] * MAX_COVER_DAYS
    qty = 0
    if reorder:
        qty = max(gap, min(eoq, cap))
        qty = max(int(offer.minimum_order), int(math.ceil(qty / offer.pack_size) * offer.pack_size))
    stockout_before_delivery = p["usable"] < p["demand_lead"]
    if expedite:
        priority = "high"
    elif not reorder:
        priority = "low"
    elif p["on_hand"] == 0 or (prob >= 0.5 and stockout_before_delivery):
        priority = "critical"
    elif alert:
        priority = "high"
    else:
        priority = "medium"
    days_to_rop = 0 if p["position"] <= p["rop"] else int((p["position"] - p["rop"]) / max(p["daily_fc"], 1e-6))
    sup = scores.get(offer.supplier_id, {})

    reasons = []
    if p["on_hand"] == 0:
        reasons.append(f"{m.name} is out of stock.")
    elif below_rop:
        reasons.append(f"Usable stock of {p['position']:,.0f} units is at or below the reorder point of {p['rop']:,.0f}.")
    if alert:
        reasons.append(f"The stockout model gives a {prob:.0%} chance of running out before the next delivery "
                       f"(alert threshold {threshold:.1%}).")
    if p["expiring"]:
        reasons.append(f"{p['expiring']:,} units are expected to expire before use and were not counted as stock.")
    if expedite:
        reasons.append(f"{p['on_order']:,} units are already on order, but current stock may run out before they "
                       f"arrive. Ask {offer.supplier.name} to expedite the open order rather than ordering again.")
    elif reorder:
        reasons.append(f"Forecast demand over the next {p['lead']} days ({offer.lead_time_days}-day lead time "
                       f"+ {policy.lead_time_buffer} buffer days) is {p['demand_lead']:,.0f} units. "
                       f"Order {qty:,} units from {offer.supplier.name} ({sup.get('tier', 'unscored')} supplier, "
                       f"score {sup.get('score', 0):.2f}).")
    else:
        reasons.append(f"Usable stock of {p['position']:,.0f} units covers the reorder point of {p['rop']:,.0f}; "
                       f"no order is needed yet.")

    chain = [
        {"step": 1, "model": "Supplier scoring (Model 3)", "summary": f"Chose {offer.supplier.name}",
         "details": {"options": [{"supplier": o.supplier.name, "tier": scores.get(o.supplier_id, {}).get("tier"),
                                  "score": scores.get(o.supplier_id, {}).get("score"),
                                  "leadTimeDays": o.lead_time_days, "unitCost": float(o.unit_cost),
                                  "lowConfidence": scores.get(o.supplier_id, {}).get("lowConfidence")}
                                 for o in p["ranked"]],
                     "rule": "Best tier first, then highest score, then shortest lead time."}},
        {"step": 2, "model": "Demand forecast (Model 1)",
         "summary": f"{p['demand_lead']:,.0f} units over the next {p['lead']} days",
         "details": {"leadTimeDays": p["lead"], "supplierLeadTime": offer.lead_time_days,
                     "bufferDays": policy.lead_time_buffer, "forecastLeadTime": round(p["demand_lead"], 1),
                     "forecastCycle": round(p["demand_cycle"], 1), "forecastDailyAvg": round(p["daily_fc"], 1),
                     "recentDailyAvg": round(p["mean_30"], 1), "stockoutDaysLast30": p["censored_days"],
                     "next14Days": [round(v, 1) for v in p["fc"][:14]]}},
        {"step": 3, "model": "Inventory policy", "summary": f"Reorder point {p['rop']:,.0f} units",
         "details": {"safetyStock": round(p["safety"]), "reorderPoint": round(p["rop"]),
                     "orderUpTo": round(p["order_up_to"]), "demandStd30": round(p["std_30"], 1),
                     "formula": "SS = z x std x sqrt(L); ROP = forecast over L + SS"}},
        {"step": 4, "model": "Expiry risk (Model 4)",
         "summary": f"{p['expiring']:,} units likely to expire unused" if p["expiring"] else "No stock expected to expire",
         "details": {"onHand": int(p["on_hand"]), "expiringUnits": int(p["expiring"]), "usable": int(p["usable"]),
                     "onOrder": int(p["on_order"]), "batches": p["expiry_detail"]}},
        {"step": 5, "model": "Stockout risk (Model 2)", "summary": f"{prob:.0%} risk ({'alert' if alert else 'no alert'})",
         "details": {"probability": round(prob, 4), "threshold": round(threshold, 4), "alert": alert,
                     "drivers": p["risk_drivers"]}},
        {"step": 6, "model": "Decision",
         "summary": f"Order {qty:,} units" if reorder else "Expedite the open order" if expedite else "No order needed",
         "details": {"reorder": reorder, "expedite": expedite, "belowReorderPoint": below_rop, "riskAlert": alert,
                     "onOrder": int(p["on_order"]), "quantity": qty,
                     "eoq": round(eoq), "orderUpToGap": round(gap), "maxCover": round(cap)}},
    ]
    return {
        "medicineId": m.id, "modelId": m.model_id, "medicineName": m.name, "strength": m.strength,
        "reorder": reorder, "action": "order" if reorder else "expedite" if expedite else "none",
        "priority": priority, "quantity": qty, "unitCost": unit,
        "estimatedCost": round(qty * unit, 2), "supplierId": offer.supplier_id, "supplierName": offer.supplier.name,
        "offerId": offer.id, "leadTimeDays": offer.lead_time_days, "currentStock": int(p["on_hand"]),
        "usableStock": int(p["usable"]), "onOrder": int(p["on_order"]), "reorderPoint": round(p["rop"]),
        "safetyStock": round(p["safety"]), "predictedDemand": round(p["demand_lead"]),
        "stockoutProbability": round(prob, 4), "stockoutRisk": "critical" if prob >= 0.5 else "high" if alert else "low",
        "daysUntilReorderPoint": days_to_rop, "expiringUnits": int(p["expiring"]),
        "rationale": " ".join(reasons), "chain": chain, "asOf": as_of.isoformat(),
        "category": m.category, "recentDailyAvg": round(p["mean_30"], 2), "forecastDailyAvg": round(p["daily_fc"], 2),
        "demandStd": round(p["std_30"], 2), "stockoutDaysLast30": p["censored_days"], "stockoutAlert": alert, "batches": p["per_batch"],
        "supplierTier": sup.get("tier"), "supplierScore": sup.get("score"),
    }


@transaction.atomic
def _save(results, plans, as_of, user):
    state, _ = DataState.objects.select_for_update().get_or_create(id=1)
    state.revision += 1
    state.save(update_fields=["revision"])
    medicine_ids = [r["medicineId"] for r in results]
    Recommendation.objects.filter(medicine_id__in=medicine_ids, status="pending").update(status="superseded")
    created = 0
    for r in results:
        if not r["reorder"]:
            continue
        Recommendation.objects.create(
            medicine_id=r["medicineId"], offer_id=r["offerId"], quantity=r["quantity"],
            unit_cost=Decimal(str(r["unitCost"])), revision=state.revision, as_of=as_of, payload=r,
            reason=r["rationale"][:300])
        created += 1
        if r["priority"] == "critical":
            _notify(f"reorder:{r['medicineId']}:{as_of}:{state.revision}", "reorder", "critical",
                    f"Reorder {r['medicineName']} now",
                    f"{r['stockoutProbability']:.0%} stockout risk. Suggested order: {r['quantity']:,} units "
                    f"from {r['supplierName']}.", "/recommendations")
    AuditEvent.objects.create(actor=user if getattr(user, "is_authenticated", False) else None,
                              action="decision_engine_run", entity="recommendation",
                              details={"asOf": as_of.isoformat(), "checked": len(results), "created": created,
                                       "revision": state.revision})
    return created


def _notify(key, kind, severity, title, message, link):
    """One notification per user who can act on recommendations."""
    from accounts.models import User
    from core.models import Notification
    for user in User.objects.filter(is_active=True, role__in=["admin", "manager", "pharmacist"]):
        Notification.objects.get_or_create(user=user, event_key=key[:150], defaults={
            "kind": kind, "severity": severity, "title": title[:200], "message": message, "link": link})


# ------------------------------------------------------- what-if: dispense
@transaction.atomic
def dispense(model_id, quantity, user):
    """Record a dispense of `quantity` units, first-expiry-first-out across batches."""
    from core.models import StockMovement
    med = Medicine.objects.get(model_id=model_id)
    batches = list(Batch.objects.select_for_update().filter(medicine=med, quarantined=False, quantity__gt=0)
                   .order_by("expiry_date", "id"))
    available = sum(b.quantity for b in batches)
    if quantity > available:
        raise ValueError(f"Only {available:,} units of {med.name} are in stock.")
    left, now = quantity, pd.Timestamp.now(tz="UTC").to_pydatetime()
    for b in batches:
        if left == 0:
            break
        take = min(left, b.quantity)
        b.quantity -= take
        b.save(update_fields=["quantity"])
        StockMovement.objects.create(batch=b, kind="dispense", quantity=-take, occurred_at=now, actor=user,
                                     reason="What-if dispense (demo)", fingerprint="demo")
        left -= take
    AuditEvent.objects.create(actor=user, action="dispense", entity=f"medicine:{med.id}",
                              details={"quantity": quantity})
    return {"medicineId": med.id, "modelId": model_id, "medicineName": med.name,
            "dispensed": quantity, "stockLeft": available - quantity}
