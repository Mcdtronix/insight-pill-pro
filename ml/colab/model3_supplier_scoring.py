"""Explainable supplier scorecard. Run from Colab with --data and --output.

Scores describe the supplied synthetic records, not actual supplier performance.
No supervised accuracy is claimed. Optional clustering requires scikit-learn.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

WEIGHTS = {"on_time": 0.4, "fulfillment": 0.3, "price": 0.2, "quality": 0.1}


def score_suppliers(data, as_of, weights=None, window_days=365):
    weights = WEIGHTS if weights is None else weights
    if set(weights) != set(WEIGHTS) or any(v < 0 for v in weights.values()) or not np.isclose(sum(weights.values()), 1):
        raise ValueError("Weights must be nonnegative, sum to one and match the four criteria.")
    if window_days <= 0:
        raise ValueError("window_days must be positive")
    df = data.copy()
    required = ["order_id", "supplier_id", "supplier_name", "order_date", "promised_delivery_date", "actual_delivery_date", "order_quantity", "delivered_quantity", "rejected_units", "unit_price", "market_avg_price"]
    if not set(required).issubset(df):
        raise ValueError(f"Missing columns: {set(required) - set(df)}")
    if df[required].isna().any().any() or df.order_id.duplicated().any():
        raise ValueError("Missing required values or duplicate order IDs")
    for col in ["order_date", "promised_delivery_date", "actual_delivery_date"]:
        df[col] = pd.to_datetime(df[col], errors="raise")
    for col in ["order_quantity", "delivered_quantity", "rejected_units", "unit_price", "market_avg_price"]:
        df[col] = pd.to_numeric(df[col], errors="raise")
        if not np.isfinite(df[col]).all():
            raise ValueError(f"Nonfinite {col}")
    if not ((df.order_quantity > 0) & (df.delivered_quantity >= 0) & (df.rejected_units >= 0) & (df.rejected_units <= df.delivered_quantity) & (df.unit_price >= 0) & (df.market_avg_price > 0)).all():
        raise ValueError("Invalid quantities/prices")
    if ((df.actual_delivery_date < df.order_date) | (df.promised_delivery_date < df.order_date)).any():
        raise ValueError("Delivery dates precede order dates")
    end = pd.Timestamp(as_of)
    start = end - pd.Timedelta(days=window_days)
    # Completed-order retrospective score. Never use outcomes after the cutoff.
    df = df[(df.actual_delivery_date <= end) & (df.actual_delivery_date > start)].copy()
    if df.empty:
        raise ValueError("No completed orders in the scoring window")
    df["delay"] = (df.actual_delivery_date - df.promised_delivery_date).dt.days
    df["lead"] = (df.actual_delivery_date - df.order_date).dt.days
    df["accepted"] = df.delivered_quantity - df.rejected_units
    df["capped_delivered"] = np.minimum(df.delivered_quantity, df.order_quantity)
    df["price_ratio"] = df.unit_price / df.market_avg_price
    rows = []
    for sid, g in df.groupby("supplier_id"):
        # Fixed benchmark transform: zero premium -> 1; >=50% premium -> 0.
        # Discounts receive no bonus beyond 1. Weights/bounds are policy choices.
        price_score = np.clip(1 - max(0, g.price_ratio.median() - 1) / 0.5, 0, 1)
        delivered = g.delivered_quantity.sum()
        components = {
            "on_time": float((g.delay <= 0).mean()),
            "fulfillment": float(g.capped_delivered.sum() / g.order_quantity.sum()),
            "price": float(price_score),
            "quality": float(g.accepted.sum() / delivered) if delivered else 0.0,
        }
        score = 100 * sum(weights[k] * components[k] for k in weights)
        n = len(g)
        rows.append({"supplier_id": int(sid), "supplier_name": g.supplier_name.iloc[0],
                     "orders": n, "as_of": str(end.date()), "window_days": window_days,
                     **components, "score": score,
                     "tier": "insufficient_history" if n < 10 else "preferred" if score >= 85 else "acceptable" if score >= 70 else "review",
                     "avg_lead_time_days": float(g.lead.mean()),
                     "lead_time_std_days": float(g.lead.std(ddof=0)),
                     "median_price_ratio": float(g.price_ratio.median()),
                     **{f"contribution_{k}": 100 * weights[k] * components[k] for k in weights}})
    return pd.DataFrame(rows).sort_values(["score", "supplier_id"], ascending=[False, True]).reset_index(drop=True)


def run(data_path, output, as_of, clusters=False):
    path, out = Path(data_path), Path(output)
    out.mkdir(parents=True, exist_ok=True)
    raw = pd.read_csv(path)
    scores = score_suppliers(raw, as_of)
    scores.to_csv(out / "supplier_scores.csv", index=False)
    scenarios = []
    for criterion in WEIGHTS:
        for factor in [0.8, 1.2]:
            weights = {k: v * (factor if k == criterion else 1) for k, v in WEIGHTS.items()}
            total = sum(weights.values())
            weights = {k: v / total for k, v in weights.items()}
            frame = score_suppliers(raw, as_of, weights)
            frame["rank"] = frame.score.rank(ascending=False, method="min")
            frame["scenario"] = f"{criterion}_x{factor}"
            scenarios.append(frame[["supplier_id", "score", "rank", "scenario"]])
    sensitivity = pd.concat(scenarios, ignore_index=True)
    sensitivity.to_csv(out / "weight_sensitivity.csv", index=False)
    sensitivity.groupby("supplier_id")["rank"].agg(["min", "max"]).to_csv(out / "rank_ranges.csv")
    end = pd.Timestamp(as_of)
    previous = score_suppliers(raw, end - pd.Timedelta(days=180), window_days=180)
    recent = score_suppliers(raw, end, window_days=180)
    previous.merge(recent, on="supplier_id", suffixes=("_previous", "_recent")).to_csv(out / "period_comparison.csv", index=False)
    meta = {"model": "supplier_scorecard", "version": "1.0", "data_source": "synthetic",
            "as_of": as_of, "weights": WEIGHTS, "price_premium_zero_score": 0.5,
            "minimum_orders": 10, "tier_thresholds": {"preferred": 85, "acceptable": 70},
            "window_days": 365, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "limitations": ["Completed orders only; open overdue orders require a separate operational alert.",
                            "Only 12 synthetic suppliers; clustering is exploratory.",
                            "Scores are not calibrated probabilities or real organisation ratings."]}
    if clusters:
        from sklearn.cluster import KMeans
        from sklearn.metrics import silhouette_score
        from sklearn.preprocessing import StandardScaler
        import joblib
        x = scores[list(WEIGHTS)]
        scaler = StandardScaler().fit(x)
        z = scaler.transform(x)
        candidates = []
        for k in range(2, min(5, len(scores))):
            estimator = KMeans(n_clusters=k, random_state=42, n_init=20).fit(z)
            if 1 < len(set(estimator.labels_)) < len(scores):
                candidates.append((silhouette_score(z, estimator.labels_), k, estimator))
        if not candidates:
            raise ValueError("No meaningful cluster solution")
        silhouette, k, estimator = max(candidates, key=lambda c: c[0])
        scores["cluster_id"] = estimator.labels_
        scores.to_csv(out / "exploratory_clusters.csv", index=False)
        joblib.dump({"scaler": scaler, "model": estimator, "features": list(WEIGHTS)}, out / "exploratory_clusters.joblib")
        meta["clustering"] = {"k": k, "silhouette": silhouette, "note": "Cluster IDs do not define supplier quality tiers."}
    (out / "scorecard_policy.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(scores[["supplier_id", "score", "tier"]].to_string(index=False))
    return scores


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--as-of", default="2024-12-31")
    p.add_argument("--clusters", action="store_true")
    a = p.parse_args()
    run(a.data, a.output, a.as_of, a.clusters)
