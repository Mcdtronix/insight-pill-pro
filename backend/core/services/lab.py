"""Model Lab: run each decision model on user inputs, explain it, and re-test it.

Every model is used exactly as exported from Colab. Feature recipes copy the
training notebooks line for line, so evaluation here reproduces the reported
test metrics. Explanations use the tree path decomposition of Saabas (2014):
for a tree ensemble, prediction = baseline + sum of per-feature contributions,
exactly, which makes "why did the model say this?" answerable live.
"""
import json
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from django.conf import settings
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score, mean_absolute_error,
                             mean_squared_error, precision_score, recall_score, roc_auc_score)

from core.models import Batch, DailyDemand, Medicine, SupplierOffer
from core.services.ml import _load

# ----------------------------------------------------------------- constants
DEMAND_FEATURES = ["medicine_id", "category_enc", "season_enc", "day_of_week", "month", "is_weekend",
                   "is_public_holiday", "lag_1", "lag_7", "lag_14", "lag_30", "rolling_mean_7",
                   "rolling_mean_30", "rolling_std_7"]
FEATURE_LABELS = {
    "medicine_id": "Medicine identity", "category_enc": "Medicine category", "season_enc": "Season",
    "day_of_week": "Day of week", "month": "Month", "is_weekend": "Weekend", "is_public_holiday": "Public holiday",
    "lag_1": "Demand yesterday", "lag_7": "Demand 7 days ago", "lag_14": "Demand 14 days ago",
    "lag_30": "Demand 30 days ago", "rolling_mean_7": "7-day average demand",
    "rolling_mean_30": "30-day average demand", "rolling_std_7": "7-day demand variability",
    "current_stock_level": "Current stock", "avg_daily_demand": "Average daily demand",
    "demand_std_dev": "Demand variability (std)", "lead_time_days": "Supplier lead time",
    "lead_time_variability": "Lead time variability", "days_of_stock_remaining": "Days of stock left",
    "reorder_already_placed": "Order already placed", "demand_cv": "Demand volatility (CV)",
    "lead_time_margin": "Stock days minus lead time", "lead_time_cv": "Lead time volatility (CV)",
}
SEASONS = ["Dry/Cold Season", "Rainy Season", "Transition Season"]
SUPPLIER_FEATURES = ["on_time_rate", "avg_fulfillment_rate", "avg_price_variance_pct", "avg_defect_rate"]
TIER_ORDER = ["Preferred", "Acceptable", "At-Risk"]


class LabInputError(ValueError):
    """Raised with a {field: [message]} dict when user input is invalid."""
    def __init__(self, fields):
        super().__init__("Invalid input")
        self.fields = fields


def _data(name):
    path = Path(settings.DATA_ROOT) / name
    if not path.exists():
        raise FileNotFoundError(f"Dataset is missing: {name}. Copy the CSV files into ml/data.")
    return path


@lru_cache(maxsize=8)
def _meta(folder, name):
    return json.loads((Path(settings.MODEL_ROOT) / folder / name).read_text(encoding="utf-8"))


def _number(data, field, errors, lo=None, hi=None, integer=False, default=None):
    raw = data.get(field, default)
    if raw is None or raw == "":
        errors[field] = ["This field is required."]
        return None
    try:
        value = int(raw) if integer else float(raw)
    except (TypeError, ValueError):
        errors[field] = ["Enter a number."]
        return None
    if not np.isfinite(value):
        errors[field] = ["Enter a finite number."]
    elif lo is not None and value < lo:
        errors[field] = [f"Must be at least {lo}."]
    elif hi is not None and value > hi:
        errors[field] = [f"Must be at most {hi}."]
    return value


# -------------------------------------------------------------- explanation
def explain_forest(forest, row, class_index=None):
    """Exact Saabas decomposition for a fitted sklearn random forest and one row.

    Returns (baseline, contributions) with baseline + sum(contributions) equal to
    the forest's prediction (probability of class_index for classifiers).
    """
    x = np.asarray(row, dtype=np.float32)  # sklearn trees compare in float32
    total_bias, total = 0.0, np.zeros(x.shape[0])
    for est in forest.estimators_:
        tree = est.tree_
        values = tree.value[:, 0, :]
        if class_index is None:
            node_val = values[:, 0]
        else:
            node_val = values[:, class_index] / values.sum(axis=1)
        node = 0
        total_bias += node_val[0]
        while tree.children_left[node] != -1:
            feat = tree.feature[node]
            nxt = tree.children_left[node] if x[feat] <= tree.threshold[node] else tree.children_right[node]
            total[feat] += node_val[nxt] - node_val[node]
            node = nxt
    n = len(forest.estimators_)
    return total_bias / n, total / n


def _contributions(names, values, contribs, top=8):
    names = list(names)
    rows = [{"feature": f, "label": FEATURE_LABELS.get(f, f.replace("cat_", "Category: ")), "value": _clean(v),
             "contribution": round(float(c), 4)} for f, v, c in zip(names, values, contribs)]
    rows.sort(key=lambda r: abs(r["contribution"]), reverse=True)
    shown, rest = rows[:top], rows[top:]
    shown = [r for r in shown if abs(r["contribution"]) > 1e-9]
    if rest:
        # Keep the breakdown exact: baseline + all rows shown = prediction.
        shown.append({"feature": "other", "label": f"{len(rest)} other factors", "value": None,
                      "contribution": round(float(sum(contribs[names.index(r['feature'])] for r in rest)), 4)})
    return shown


def _clean(v):
    v = float(v)
    return int(v) if v.is_integer() else round(v, 4)


# ================================================================ model cards
def model_cards():
    demand = _meta("Demand", "model_metadata_v1.json")
    reorder = _meta("Reorder", "model_metadata_reorder_risk_v1.json")
    supplier = _meta("supplier", "model_metadata_supplier_v1.json")
    return [
        {"key": "demand", "name": demand["model_name"], "algorithm": demand["algorithm"], "version": demand["version"],
         "trainedOn": demand["trained_on"], "task": "Regression: units dispensed per day",
         "trainingRows": demand["n_training_rows"], "testRows": demand["n_test_rows"],
         "testMetrics": {k: round(v, 3) for k, v in demand["test_metrics"].items()},
         "features": demand["feature_columns"], "limitations": demand["known_limitations"]},
        {"key": "reorder", "name": reorder["model_name"], "algorithm": reorder["algorithm"],
         "version": reorder["version"], "trainedOn": reorder["trained_on"],
         "task": "Binary classification: will stock run out before the next delivery?",
         "trainingRows": reorder["n_training_rows"], "testRows": reorder["n_test_rows"],
         "threshold": round(reorder["decision_threshold"], 4),
         "testMetrics": {k: round(v, 3) for k, v in reorder["test_metrics"].items()},
         "features": reorder["feature_columns"], "limitations": reorder["known_limitations"]},
        {"key": "supplier", "name": supplier["model_name"], "algorithm": supplier["approach"],
         "version": supplier["version"], "trainedOn": supplier["trained_on"],
         "task": "Unsupervised scoring and tiering of suppliers",
         "trainingRows": supplier["n_orders_used"], "testRows": None, "weights": supplier["weights"],
         "testMetrics": {k: round(v, 3) for k, v in supplier["validation_metrics"].items()},
         "features": supplier["score_features"], "limitations": supplier["known_limitations"]},
        {"key": "expiry", "name": "Batch Expiry Risk", "algorithm": "Transparent depletion rule",
         "version": "rule-v1", "trainedOn": None,
         "task": "Will a batch still hold unused stock on its expiry date?",
         "trainingRows": None, "testRows": None, "testMetrics": {},
         "features": ["current_batch_stock", "days_to_expiry", "avg_monthly_consumption_rate"],
         "limitations": ["A learned classifier has not yet been trained; the rule is used as the benchmark "
                         "any classifier must beat.",
                         "Assumes the batch is consumed at the medicine's average rate until it expires."]},
    ]


# ============================================================ Model 1: demand
def demand_context(model_id, on_date):
    """Build model inputs for one medicine and date from stored demand history."""
    med = Medicine.objects.filter(model_id=model_id).first()
    if not med:
        raise LabInputError({"medicineId": ["Unknown medicine."]})
    history = list(DailyDemand.objects.filter(medicine=med, date__lt=on_date).order_by("-date")
                   .values_list("date", "quantity")[:30])
    if len(history) < 30:
        raise LabInputError({"date": ["Choose a date with at least 30 days of earlier history (from 31 Jan 2024)."]})
    q = [h[1] for h in history]  # q[0] = yesterday
    today_row = DailyDemand.objects.filter(medicine=med, date=on_date).values("quantity", "season", "holiday").first()
    season = today_row["season"] if today_row else DailyDemand.objects.filter(medicine=med).latest("date").season
    return {
        "medicineId": model_id, "medicineName": f"{med.name} {med.strength}".strip(), "category": med.category,
        "date": on_date.isoformat(), "season": season, "isPublicHoliday": bool(today_row and today_row["holiday"]),
        "lag1": q[0], "lag7": q[6], "lag14": q[13], "lag30": q[29],
        "rollingMean7": round(float(np.mean(q[:7])), 2), "rollingMean30": round(float(np.mean(q[:30])), 2),
        "rollingStd7": round(float(np.std(q[:7], ddof=1)), 2),
        "actual": today_row["quantity"] if today_row else None,
    }


def demand_predict(data):
    errors = {}
    model_id = _number(data, "medicineId", errors, 1, 20, integer=True)
    try:
        on_date = date.fromisoformat(str(data.get("date", "")))
    except ValueError:
        errors["date"] = ["Enter a date as YYYY-MM-DD."]
        on_date = None
    season = data.get("season")
    if season not in SEASONS:
        errors["season"] = ["Choose a valid season."]
    fields = {"lag1": "lag_1", "lag7": "lag_7", "lag14": "lag_14", "lag30": "lag_30",
              "rollingMean7": "rolling_mean_7", "rollingMean30": "rolling_mean_30", "rollingStd7": "rolling_std_7"}
    nums = {col: _number(data, key, errors, 0, 5000) for key, col in fields.items()}
    if errors:
        raise LabInputError(errors)
    med = Medicine.objects.filter(model_id=model_id).first()
    if not med:
        raise LabInputError({"medicineId": ["Unknown medicine."]})

    model = _load("Demand", "forecast_model_v1.pkl")
    category = _load("Demand", "category_encoder_v1.pkl").transform([med.category])[0]
    season_code = _load("Demand", "season_encoder_v1.pkl").transform([season])[0]
    row = {"medicine_id": model_id, "category_enc": category, "season_enc": season_code,
           "day_of_week": on_date.weekday(), "month": on_date.month, "is_weekend": int(on_date.weekday() >= 5),
           "is_public_holiday": int(bool(data.get("isPublicHoliday"))), **nums}
    x = pd.DataFrame([[row[c] for c in DEMAND_FEATURES]], columns=DEMAND_FEATURES, dtype=float)
    prediction = float(model.predict(x)[0])
    base, contribs = explain_forest(model, x.iloc[0].to_numpy())
    display = dict(row, category_enc=med.category, season_enc=season,
                   day_of_week=on_date.strftime("%A"))
    actual = DailyDemand.objects.filter(medicine=med, date=on_date).values_list("quantity", flat=True).first()
    return {
        "prediction": round(max(0.0, prediction), 2), "unit": "units", "baseline": round(base, 2),
        "actual": actual, "error": round(abs(prediction - actual), 2) if actual is not None else None,
        "contributions": [dict(c, value=display[c["feature"]] if c["feature"] in ("category_enc", "season_enc", "day_of_week") else c["value"])
                          for c in _contributions(DEMAND_FEATURES, x.iloc[0].to_numpy(), contribs)],
        "modelVersion": "Demand v1",
    }


@lru_cache(maxsize=1)
def _demand_test_frame():
    """Rebuild the notebook's features and its per-medicine chronological test split."""
    df = pd.read_csv(_data("demand_transactions.csv"), parse_dates=["transaction_date"])
    df = df.sort_values(["medicine_id", "transaction_date"]).reset_index(drop=True)
    fe = df.copy()
    fe["day_of_week"] = fe.transaction_date.dt.dayofweek
    fe["month"] = fe.transaction_date.dt.month
    fe["is_weekend"] = fe.day_of_week.isin([5, 6]).astype(int)
    grp = fe.groupby("medicine_id")["quantity_dispensed"]
    for lag in [1, 7, 14, 30]:
        fe[f"lag_{lag}"] = grp.shift(lag)
    fe["rolling_mean_7"] = grp.shift(1).rolling(7).mean().reset_index(level=0, drop=True)
    fe["rolling_mean_30"] = grp.shift(1).rolling(30).mean().reset_index(level=0, drop=True)
    fe["rolling_std_7"] = grp.shift(1).rolling(7).std().reset_index(level=0, drop=True)
    fe["category_enc"] = _load("Demand", "category_encoder_v1.pkl").transform(fe["category"])
    fe["season_enc"] = _load("Demand", "season_encoder_v1.pkl").transform(fe["season_period"])
    fe = fe.dropna().reset_index(drop=True)
    test_idx = []
    for _, g in fe.groupby("medicine_id"):
        test_idx.extend(g.index[int(len(g) * 0.85):])
    test = fe.loc[test_idx].reset_index(drop=True)
    model = _load("Demand", "forecast_model_v1.pkl")
    test["prediction"] = model.predict(test[DEMAND_FEATURES])
    return test


def demand_evaluate(model_id=None):
    test = _demand_test_frame()
    y, p = test.quantity_dispensed.to_numpy(), test.prediction.to_numpy()
    mask = y != 0
    naive = test.lag_1.to_numpy()
    by_cat = (test.assign(err=np.abs(y - p)).groupby("category")
              .agg(mae=("err", "mean"), avgDemand=("quantity_dispensed", "mean"), n=("err", "size"))
              .sort_values("mae", ascending=False).reset_index())
    pick = test[test.medicine_id == (model_id or 6)]
    return {
        "testRows": int(len(test)),
        "period": [test.transaction_date.min().date().isoformat(), test.transaction_date.max().date().isoformat()],
        "metrics": {"MAE": round(mean_absolute_error(y, p), 2), "RMSE": round(float(np.sqrt(mean_squared_error(y, p))), 2),
                    "MAPE": round(float(np.mean(np.abs((y[mask] - p[mask]) / y[mask])) * 100), 2)},
        "baseline": {"name": "Naive (yesterday's demand)", "MAE": round(mean_absolute_error(y, naive), 2)},
        "improvementPct": round((1 - mean_absolute_error(y, p) / mean_absolute_error(y, naive)) * 100, 1),
        "byCategory": [{"category": r.category, "mae": round(r.mae, 2), "avgDemand": round(r.avgDemand, 1), "n": int(r.n)}
                       for r in by_cat.itertuples()],
        "series": {"medicineId": int(model_id or 6), "medicineName": str(pick.medicine_name.iloc[0]) if len(pick) else None,
                   "points": [{"date": d.date().isoformat(), "actual": int(a), "predicted": round(float(q), 1),
                               "stockout": bool(s)}
                              for d, a, q, s in zip(pick.transaction_date, pick.quantity_dispensed, pick.prediction,
                                                    pick.stockout_flag)]},
    }


# ========================================================== Model 2: reorder
def _reorder_meta():
    return _meta("Reorder", "model_metadata_reorder_risk_v1.json")


def reorder_context(model_id):
    """Current position of a medicine, as the stockout model needs it, from the database."""
    from core.services.clock import today
    med = Medicine.objects.filter(model_id=model_id).first()
    if not med:
        raise LabInputError({"medicineId": ["Unknown medicine."]})
    as_of = today()
    recent = list(DailyDemand.objects.filter(medicine=med, date__lte=as_of, date__gt=as_of - timedelta(days=30))
                  .values_list("quantity", flat=True))
    stock = sum(Batch.objects.filter(medicine=med, quarantined=False).values_list("quantity", flat=True))
    offer = (SupplierOffer.objects.filter(medicine=med, active=True).order_by("lead_time_days").first())
    return {
        "medicineId": model_id, "medicineName": f"{med.name} {med.strength}".strip(), "category": med.category,
        "asOf": as_of.isoformat(), "currentStock": int(stock),
        "avgDailyDemand": round(float(np.mean(recent)), 2) if recent else 0.0,
        "demandStdDev": round(float(np.std(recent, ddof=1)), 2) if len(recent) > 1 else 0.0,
        "leadTimeDays": int(offer.lead_time_days) if offer else 21,
        "leadTimeVariability": round(float(offer.lead_time_std), 2) if offer else 2.0,
        "reorderAlreadyPlaced": False,
        "supplierName": offer.supplier.name if offer else None,
    }


def _reorder_row(model_id, category, stock, demand, std, lead, lead_var, placed):
    meta = _reorder_meta()
    days_left = stock / max(demand, 0.1)  # the dataset treats zero demand as 0.1 units a day
    row = {c: 0.0 for c in meta["feature_columns"]}
    row.update(medicine_id=model_id, current_stock_level=stock, avg_daily_demand=demand, demand_std_dev=std,
               lead_time_days=lead, lead_time_variability=lead_var, days_of_stock_remaining=days_left,
               reorder_already_placed=int(placed), demand_cv=(std / demand) if demand > 0 else 0.0,
               lead_time_margin=days_left - lead, lead_time_cv=lead_var / lead)
    if f"cat_{category}" in row:
        row[f"cat_{category}"] = 1.0
    return pd.DataFrame([row])[meta["feature_columns"]].astype(float)


def reorder_predict(data):
    errors = {}
    model_id = _number(data, "medicineId", errors, 1, 20, integer=True)
    stock = _number(data, "currentStock", errors, 0, 1_000_000)
    demand = _number(data, "avgDailyDemand", errors, 0, 10_000)
    std = _number(data, "demandStdDev", errors, 0, 10_000)
    lead = _number(data, "leadTimeDays", errors, 1, 365)
    lead_var = _number(data, "leadTimeVariability", errors, 0, 100)
    if errors:
        raise LabInputError(errors)
    med = Medicine.objects.filter(model_id=model_id).first()
    if not med:
        raise LabInputError({"medicineId": ["Unknown medicine."]})
    meta = _reorder_meta()
    model = _load("Reorder", "reorder_risk_model_v1.pkl")
    x = _reorder_row(model_id, med.category, stock, demand, std, lead, lead_var, bool(data.get("reorderAlreadyPlaced")))
    proba = float(model.predict_proba(x)[0, 1])
    base, contribs = explain_forest(model, x.iloc[0].to_numpy(), class_index=1)
    threshold = meta["decision_threshold"]
    days_left = float(x.iloc[0]["days_of_stock_remaining"])
    level = "high" if proba >= 0.5 else "elevated" if proba >= threshold else "low"
    return {
        "probability": round(proba, 4), "threshold": round(threshold, 4), "alert": proba >= threshold,
        "riskLevel": level, "baseline": round(base, 4),
        "daysOfStockLeft": round(days_left, 1), "leadTimeMargin": round(days_left - lead, 1),
        "contributions": _contributions(meta["feature_columns"], x.iloc[0].to_numpy(), contribs),
        "modelVersion": "Reorder v1",
    }


@lru_cache(maxsize=1)
def _reorder_test_frame():
    meta = _reorder_meta()
    df = pd.read_csv(_data("reorder_risk_dataset.csv"), parse_dates=["check_date"])
    df = df.sort_values("check_date").reset_index(drop=True)
    fe = df.copy()
    fe["demand_cv"] = (fe["demand_std_dev"] / fe["avg_daily_demand"].replace(0, np.nan)).fillna(0)
    fe["lead_time_margin"] = fe["days_of_stock_remaining"] - fe["lead_time_days"]
    fe["lead_time_cv"] = fe["lead_time_variability"] / fe["lead_time_days"]
    fe = pd.concat([fe, pd.get_dummies(fe["category"], prefix="cat", drop_first=True)], axis=1)
    test = fe.iloc[int(len(fe) * 0.85):].reset_index(drop=True)
    model = _load("Reorder", "reorder_risk_model_v1.pkl")
    test["proba"] = model.predict_proba(test[meta["feature_columns"]].astype(float))[:, 1]
    return test


def reorder_evaluate(threshold=None):
    meta = _reorder_meta()
    t = threshold if threshold is not None else meta["decision_threshold"]
    test = _reorder_test_frame()
    y, p = test.stockout_occurred.to_numpy(), test.proba.to_numpy()
    pred = (p >= t).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    by_cat = []
    for cat, g in test.groupby("category"):
        pos = int(g.stockout_occurred.sum())
        caught = int(((g.proba >= t) & (g.stockout_occurred == 1)).sum())
        by_cat.append({"category": cat, "checks": int(len(g)), "stockouts": pos, "caught": caught,
                       "recall": round(caught / pos, 3) if pos else None})
    return {
        "testRows": int(len(test)), "positives": int(y.sum()), "threshold": round(t, 4),
        "period": [test.check_date.min().date().isoformat(), test.check_date.max().date().isoformat()],
        "metrics": {"precision": round(precision_score(y, pred, zero_division=0), 3),
                    "recall": round(recall_score(y, pred, zero_division=0), 3),
                    "f1": round(f1_score(y, pred, zero_division=0), 3),
                    "rocAuc": round(roc_auc_score(y, p), 3), "prAuc": round(average_precision_score(y, p), 3)},
        "baseline": {"name": "Always predict 'no stockout'", "prAuc": round(float(y.mean()), 3), "recall": 0.0},
        "confusion": {"tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn)},
        "byCategory": sorted(by_cat, key=lambda r: -r["stockouts"]),
    }


# ========================================================= Model 3: supplier
def _supplier_assets():
    return (_load("supplier", "supplier_scaler_v1.pkl"), _load("supplier", "supplier_kmeans_v1.pkl"),
            _meta("supplier", "supplier_weights_v1.json"))


@lru_cache(maxsize=1)
def _scorecard():
    return pd.read_csv(Path(settings.MODEL_ROOT) / "supplier" / "supplier_scorecard_v1.csv")


@lru_cache(maxsize=1)
def _tier_map():
    """K-Means cluster ids are arbitrary; map them to tiers via the exported scorecard."""
    scaler, kmeans, _ = _supplier_assets()
    card = _scorecard()
    clusters = kmeans.predict(_kmeans_input(scaler, card[SUPPLIER_FEATURES]))
    mapping = pd.Series(card.tier.values, index=clusters)
    return {int(c): mapping[c].mode().iloc[0] if isinstance(mapping[c], pd.Series) else mapping[c] for c in set(clusters)}


def _kmeans_input(scaler, frame):
    norm = scaler.transform(frame[SUPPLIER_FEATURES])
    norm[:, 2] = 1 - norm[:, 2]
    norm[:, 3] = 1 - norm[:, 3]
    return norm


def supplier_score_rows(frame):
    """Score and tier any number of suppliers given their four aggregate metrics."""
    scaler, kmeans, weights = _supplier_assets()
    norm = scaler.transform(frame[SUPPLIER_FEATURES])
    clipped = np.clip(norm, 0, 1)
    parts = np.column_stack([weights["on_time_rate"] * clipped[:, 0],
                             weights["avg_fulfillment_rate"] * clipped[:, 1],
                             weights["avg_price_variance_pct"] * (1 - clipped[:, 2]),
                             weights["avg_defect_rate"] * (1 - clipped[:, 3])])
    tiers = [_tier_map()[int(c)] for c in kmeans.predict(_kmeans_input(scaler, frame))]
    outside = ((norm < 0) | (norm > 1)).any(axis=1)
    return parts, tiers, outside


def supplier_score(data):
    errors = {}
    values = {
        "on_time_rate": _number(data, "onTimeRate", errors, 0, 1),
        "avg_fulfillment_rate": _number(data, "fulfillmentRate", errors, 0, 1),
        "avg_price_variance_pct": _number(data, "priceVariancePct", errors, -100, 100),
        "avg_defect_rate": _number(data, "defectRate", errors, 0, 1),
    }
    orders = _number(data, "orders", errors, 1, 100_000, integer=True, default=200)
    if errors:
        raise LabInputError(errors)
    parts, tiers, outside = supplier_score_rows(pd.DataFrame([values]))
    score = float(parts[0].sum())
    card = _scorecard().sort_values("score", ascending=False)
    rank = int((card.score > score).sum()) + 1
    labels = ["On-time delivery", "Order fulfilment", "Price vs market", "Defect rate"]
    return {
        "score": round(score, 4), "tier": tiers[0], "rank": rank, "of": len(card) + 1,
        "lowConfidence": orders < 150, "outsideTrainingRange": bool(outside[0]),
        "contributions": [{"feature": f, "label": l, "value": round(values[f], 4), "contribution": round(float(c), 4)}
                          for f, l, c in zip(SUPPLIER_FEATURES, labels, parts[0])],
        "scorecard": [{"name": r.supplier_name, "score": round(r.score, 4), "tier": r.tier,
                       "orders": int(r.n_orders), "lowConfidence": bool(r.low_confidence)} for r in card.itertuples()],
    }


def supplier_evaluate():
    """Recompute every supplier's score from the raw orders and compare with the exported scorecard."""
    df = pd.read_csv(_data("supplier_performance.csv"))
    agg = df.groupby(["supplier_id", "supplier_name"]).agg(
        n_orders=("order_id", "count"),
        on_time_rate=("delivery_delay_days", lambda x: (x <= 0).mean()),
        avg_fulfillment_rate=("quantity_fulfillment_rate", "mean"),
        avg_price_variance_pct=("price_variance_pct", "mean"),
        avg_defect_rate=("defect_rate", "mean")).reset_index()
    parts, tiers, _ = supplier_score_rows(agg)
    agg["score"], agg["tier"] = parts.sum(axis=1), tiers
    card = _scorecard().set_index("supplier_id")
    rows = []
    for r in agg.sort_values("score", ascending=False).itertuples():
        ref = card.loc[r.supplier_id]
        rows.append({"name": r.supplier_name, "orders": int(r.n_orders), "onTimeRate": round(r.on_time_rate, 3),
                     "fulfillmentRate": round(r.avg_fulfillment_rate, 3),
                     "priceVariancePct": round(r.avg_price_variance_pct, 2), "defectRate": round(r.avg_defect_rate, 4),
                     "score": round(r.score, 4), "tier": r.tier, "exportedScore": round(float(ref.score), 4),
                     "exportedTier": ref.tier, "lowConfidence": bool(r.n_orders < 150)})
    meta = _meta("supplier", "model_metadata_supplier_v1.json")
    return {
        "suppliers": rows,
        "reproduced": all(abs(r["score"] - r["exportedScore"]) < 1e-6 and r["tier"] == r["exportedTier"] for r in rows),
        "validation": {k: round(v, 3) for k, v in meta["validation_metrics"].items()},
        "orders": int(len(df)),
    }


# =========================================================== Model 4: expiry
def expiry_rule(stock, days_to_expiry, monthly_use):
    daily = monthly_use / 30.0
    days_to_deplete = stock / daily if daily > 0 else float("inf")
    unused = max(0.0, stock - daily * days_to_expiry)
    return days_to_deplete, unused


def expiry_predict(data):
    errors = {}
    stock = _number(data, "batchStock", errors, 0, 10_000_000)
    days = _number(data, "daysToExpiry", errors, 0, 3650)
    monthly = _number(data, "monthlyConsumption", errors, 0, 10_000_000)
    unit_cost = _number(data, "unitCost", errors, 0, 100_000, default=0)
    if errors:
        raise LabInputError(errors)
    deplete, unused = expiry_rule(stock, days, monthly)
    at_risk = unused > 0
    share = unused / stock if stock else 0.0
    level = "low" if not at_risk else "high" if share >= 0.25 or days <= 60 else "medium"
    need = stock / days * 30 if days > 0 else None
    return {
        "atRisk": at_risk, "riskLevel": level, "daysToDeplete": None if deplete == float("inf") else round(deplete, 1),
        "unusedUnits": int(round(unused)), "unusedShare": round(share, 4),
        "valueAtRisk": round(unused * unit_cost, 2),
        "monthlyUseNeeded": round(need, 1) if need is not None else None,
        "explanation": ("Stock lasts about {d} days but the batch expires in {e} days."
                        .format(d="unlimited" if deplete == float("inf") else round(deplete), e=int(days))),
        "modelVersion": "rule-v1",
    }


def expiry_context():
    """Current batches with the inputs the rule needs (FEFO order: earliest expiry first)."""
    from core.services.clock import today
    as_of = today()
    out = []
    for b in Batch.objects.filter(quarantined=False, quantity__gt=0).select_related("medicine").order_by("expiry_date"):
        recent = DailyDemand.objects.filter(medicine=b.medicine, date__lte=as_of, date__gt=as_of - timedelta(days=30))
        monthly = sum(recent.values_list("quantity", flat=True))
        out.append({"batchId": b.id, "batchNumber": b.number, "medicineName": f"{b.medicine.name} {b.medicine.strength}".strip(),
                    "batchStock": b.quantity, "daysToExpiry": max(0, (b.expiry_date - as_of).days),
                    "monthlyConsumption": monthly, "unitCost": float(b.unit_cost)})
    return out


def expiry_evaluate():
    df = pd.read_csv(_data("batch_expiry_dataset.csv"))
    unused = np.maximum(0, df.current_batch_stock - df.avg_monthly_consumption_rate / 30.0 * df.days_to_expiry)
    pred = (unused > 0).astype(int).to_numpy()
    y = df.at_risk_label.to_numpy()
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "rows": int(len(df)), "positives": int(y.sum()),
        "metrics": {"accuracy": round(float((pred == y).mean()), 4), "precision": round(precision_score(y, pred), 3),
                    "recall": round(recall_score(y, pred), 3), "f1": round(f1_score(y, pred), 3)},
        "confusion": {"tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn)},
        "note": "The rule has no trained parameters, so the whole dataset is a fair test set.",
    }


def preload():
    """Warm every model so the first click in a demo is fast."""
    _load("Demand", "forecast_model_v1.pkl"); _load("Demand", "category_encoder_v1.pkl")
    _load("Demand", "season_encoder_v1.pkl"); _load("Reorder", "reorder_risk_model_v1.pkl")
    _supplier_assets(); _tier_map()
