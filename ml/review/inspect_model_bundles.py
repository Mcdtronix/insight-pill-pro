"""Read-only audit of the user's trusted, locally exported model bundles.

Run in an isolated environment with scikit-learn==1.6.1. This loads pickle/joblib
artifacts explicitly supplied by the project owner; do not use on unknown files.
Writes review results only. Does not train, alter models, or implement a backend.
"""
import argparse
import hashlib
import json
import platform
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import scipy
import sklearn
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score,
                             mean_absolute_error, mean_squared_error, precision_score,
                             recall_score, roc_auc_score, silhouette_score)


def native(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(type(value).__name__)


def run(root, datasets, output):
    root, datasets, output = Path(root), Path(datasets), Path(output)
    output.mkdir(parents=True, exist_ok=True)
    report = {"environment": {"python": platform.python_version(), "sklearn": sklearn.__version__,
                              "numpy": np.__version__, "pandas": pd.__version__, "scipy": scipy.__version__, "joblib": joblib.__version__},
              "files": [], "artifacts": {}, "checks": {}}
    if sklearn.__version__ != "1.6.1":
        raise RuntimeError("This audit requires the artifact's scikit-learn version, 1.6.1")
    for folder in ["Demand", "Reorder", "supplier"]:
        for path in sorted((root / folder).iterdir()):
            if not path.is_file():
                continue
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            copy = root / "colab" / folder / path.name
            report["files"].append({"path": str(path), "bytes": path.stat().st_size, "sha256": digest,
                                    "duplicate": str(copy) if copy.exists() else None,
                                    "duplicate_identical": hashlib.sha256(copy.read_bytes()).hexdigest() == digest if copy.exists() else None})
    objects = {}
    paths = {"demand": "Demand/forecast_model_v1.pkl", "category_encoder": "Demand/category_encoder_v1.pkl",
             "season_encoder": "Demand/season_encoder_v1.pkl", "reorder": "Reorder/reorder_risk_model_v1.pkl",
             "supplier_scaler": "supplier/supplier_scaler_v1.pkl", "supplier_kmeans": "supplier/supplier_kmeans_v1.pkl"}
    for name, rel in paths.items():
        with warnings.catch_warnings(record=True) as found:
            warnings.simplefilter("always")
            obj = joblib.load(root / rel)
        objects[name] = obj
        details = {"type": f"{type(obj).__module__}.{type(obj).__name__}",
                   "load_warnings": [str(w.message) for w in found]}
        for attr in ["n_features_in_", "feature_names_in_", "classes_", "n_outputs_", "n_clusters", "n_samples_seen_", "data_min_", "data_max_", "cluster_centers_", "clip"]:
            if hasattr(obj, attr):
                details[attr] = getattr(obj, attr)
        if hasattr(obj, "estimators_"):
            details["tree_count"] = len(obj.estimators_)
            details["total_nodes"] = sum(t.tree_.node_count for t in obj.estimators_)
        if name in ["demand", "reorder"]:
            details["parameters"] = obj.get_params(deep=False)
            details["parameters"].pop("estimator", None)
        report["artifacts"][name] = details

    demand_meta = json.loads((root / "Demand/model_metadata_v1.json").read_text())
    reorder_meta = json.loads((root / "Reorder/model_metadata_reorder_risk_v1.json").read_text())
    supplier_meta = json.loads((root / "supplier/model_metadata_supplier_v1.json").read_text())
    for name, meta in [("demand", demand_meta), ("reorder", reorder_meta)]:
        obj = objects[name]
        declared = meta["feature_columns"]
        actual = list(obj.feature_names_in_) if hasattr(obj, "feature_names_in_") else None
        report["checks"][name + "_feature_contract"] = {"declared_count": len(declared), "actual_count": int(obj.n_features_in_),
            "names_equal": declared == actual if actual else None,
            "parameters_equal": {key: obj.get_params()[key] == value for key, value in meta["hyperparameters"].items()}}

    scorecard = pd.read_csv(root / "supplier/supplier_scorecard_v1.csv")
    cols = supplier_meta["score_features"]
    weights = json.loads((root / "supplier/supplier_weights_v1.json").read_text())
    scaled = objects["supplier_scaler"].transform(scorecard[cols])
    benefit = scaled.copy()
    benefit[:, 2:] = 1 - benefit[:, 2:]
    calculated = benefit @ np.array([weights[c] for c in cols])
    scorecard["reconstructed_score"] = calculated
    mappings = {}
    for candidate, values in [("raw_minmax", scaled), ("cost_inverted_minmax", benefit)]:
        with warnings.catch_warnings(record=True) as found:
            labels = objects["supplier_kmeans"].predict(values)
        assigned = scorecard.assign(cluster=labels)
        cluster_map = {str(int(k)): sorted(g.tier.unique().tolist()) for k, g in assigned.groupby("cluster")}
        scorecard[candidate + "_cluster"] = labels
        mappings[candidate] = {"cluster_to_tiers": cluster_map,
                               "all_clusters_single_tier": all(len(v) == 1 for v in cluster_map.values()),
                               "silhouette": float(silhouette_score(values, labels)) if 1 < len(set(labels)) < len(labels) else None,
                               "warnings": [str(w.message) for w in found]}
    report["checks"]["supplier"] = {"score_max_abs_difference": float(np.max(abs(calculated - scorecard.score))),
        "weights_match_metadata": weights == supplier_meta["weights"], "weight_sum": sum(weights.values()),
        "rows": len(scorecard), "order_count_sum": int(scorecard.n_orders.sum()), "tier_counts": scorecard.tier.value_counts().to_dict(),
        "cluster_input_candidates": mappings}
    scorecard.to_csv(output / "supplier_reconstruction.csv", index=False)

    if (datasets / "supplier_performance.csv").exists():
        source = pd.read_csv(datasets / "supplier_performance.csv", parse_dates=["order_date", "actual_delivery_date"])
        agg = source.groupby("supplier_id").agg(n_orders=("order_id", "size"),
                on_time_rate=("delivery_delay_days", lambda s: (s <= 0).mean()),
                avg_fulfillment_rate=("quantity_fulfillment_rate", "mean"),
                avg_price_variance_pct=("price_variance_pct", "mean"), avg_defect_rate=("defect_rate", "mean"))
        observed = scorecard.set_index("supplier_id").loc[agg.index]
        report["checks"]["supplier_source"] = {"order_date_range": [str(source.order_date.min().date()), str(source.order_date.max().date())],
              "actual_delivery_range": [str(source.actual_delivery_date.min().date()), str(source.actual_delivery_date.max().date())],
              "aggregate_max_differences": {c: float(np.max(abs(agg[c] - observed[c]))) for c in agg}}

    if (datasets / "demand_transactions.csv").exists():
        d = pd.read_csv(datasets / "demand_transactions.csv", parse_dates=["transaction_date"]).sort_values(["medicine_id", "transaction_date"]).reset_index(drop=True)
        d["day_of_week"] = d.transaction_date.dt.dayofweek
        d["month"] = d.transaction_date.dt.month
        d["is_weekend"] = d.day_of_week.isin([5, 6]).astype(int)
        g = d.groupby("medicine_id").quantity_dispensed
        for lag in [1, 7, 14, 30]:
            d[f"lag_{lag}"] = g.shift(lag)
        for window in [7, 30]:
            d[f"rolling_mean_{window}"] = g.transform(lambda s: s.shift(1).rolling(window).mean())
        d["rolling_std_7"] = g.transform(lambda s: s.shift(1).rolling(7).std())
        d["category_enc"] = objects["category_encoder"].transform(d.category)
        d["season_enc"] = objects["season_encoder"].transform(d.season_period)
        d = d.dropna(subset=demand_meta["feature_columns"])
        # Reconstruct the split visible in the earlier PDF, not an independent evaluation.
        test = pd.concat([g.iloc[int(len(g) * .85):] for _, g in d.groupby("medicine_id")])
        x = test[demand_meta["feature_columns"]]
        prediction = objects["demand"].predict(x)
        mask = test.quantity_dispensed.to_numpy() != 0
        observed = test.quantity_dispensed.to_numpy()
        metrics = {"MAE": float(mean_absolute_error(observed, prediction)), "RMSE": float(np.sqrt(mean_squared_error(observed, prediction))),
                   "MAPE": float(np.mean(abs((observed[mask] - prediction[mask]) / observed[mask])) * 100)}
        report["checks"]["demand_prediction"] = {"finite": bool(np.isfinite(prediction).all()), "nonnegative": bool((prediction >= 0).all()),
            "n": len(test), "test_date_range": [str(test.transaction_date.min().date()), str(test.transaction_date.max().date())],
            "reconstructed_metrics": metrics, "reported_metrics": demand_meta["test_metrics"],
            "metric_differences": {k: metrics[k] - demand_meta["test_metrics"][k] for k in metrics},
            "note": "Reconstruction from earlier notebook's split. This does not establish an untouched test or multi-step forecast validity."}
        (output / "demand_smoke_example.json").write_text(json.dumps({"input": x.iloc[0].to_dict(), "prediction": float(prediction[0])}, indent=2, default=native))

    if (datasets / "reorder_risk_dataset.csv").exists():
        d = pd.read_csv(datasets / "reorder_risk_dataset.csv", parse_dates=["check_date"]).sort_values("check_date").reset_index(drop=True)
        d["demand_cv"] = (d.demand_std_dev / d.avg_daily_demand.replace(0, np.nan)).fillna(0)
        d["lead_time_margin"] = d.days_of_stock_remaining - d.lead_time_days
        d["lead_time_cv"] = d.lead_time_variability / d.lead_time_days
        for col in reorder_meta["feature_columns"]:
            if col.startswith("cat_"):
                d[col] = (d.category == col[4:]).astype(int)
        test = d.iloc[int(len(d) * .85):]
        x = test[reorder_meta["feature_columns"]]
        class_index = list(objects["reorder"].classes_).index(1)
        proba = objects["reorder"].predict_proba(x)[:, class_index]
        pred = (proba >= reorder_meta["decision_threshold"]).astype(int)
        y = test.stockout_occurred
        metrics = {"precision": float(precision_score(y, pred, zero_division=0)), "recall": float(recall_score(y, pred)),
                   "f1": float(f1_score(y, pred)), "roc_auc": float(roc_auc_score(y, proba)), "pr_auc": float(average_precision_score(y, proba))}
        report["checks"]["reorder_prediction"] = {"finite": bool(np.isfinite(proba).all()), "n": len(test),
            "reconstructed_metrics": metrics, "reported_metrics": reorder_meta["test_metrics"],
            "metric_differences": {k: metrics[k] - reorder_meta["test_metrics"][k] for k in metrics},
            "confusion_tn_fp_fn_tp": confusion_matrix(y, pred, labels=[0,1]).ravel().tolist(),
            "default_0_5_recall": float(recall_score(y, proba >= .5)),
            "labels_changed_from_0_5": int(np.sum(pred != (proba >= .5))),
            "observed_categories": sorted(d.category.unique()),
            "n_zero_demand": int((d.avg_daily_demand == 0).sum()),
            "note": "Diagnostic reconstruction only. Exact feature code and tie ordering require the final notebook."}
        threshold = reorder_meta["decision_threshold"]
        near = np.flatnonzero(abs(proba - threshold) < 1e-12)
        boundary = [{"risk_check_id": int(test.iloc[i].risk_check_id), "label": int(y.iloc[i]),
                     "score": float(proba[i]), "difference_from_threshold": float(proba[i] - threshold)} for i in near]
        # Check deterministic accumulation on the same fitted trees, without rewriting the artifact.
        objects["reorder"].set_params(n_jobs=1)
        serial = objects["reorder"].predict_proba(x)[:, class_index]
        report["checks"]["reorder_threshold_precision"] = {
            "within_1e_12_of_threshold": boundary,
            "serial_max_score_difference": float(np.max(abs(serial - proba))),
            "serial_recall": float(recall_score(y, serial >= threshold)),
            "serial_boundary_scores": [float(serial[i]) for i in near],
            "diagnostic_rounded_12dp_recall": float(recall_score(y, np.round(proba, 12) >= round(threshold, 12))),
            "note": "Rounding is diagnostic only, not an approved deployment policy or modification of the saved threshold."}
        (output / "reorder_smoke_example.json").write_text(json.dumps({"input": x.iloc[0].to_dict(), "risk_score": float(proba[0]),
                "threshold": reorder_meta["decision_threshold"], "at_risk": bool(pred[0])}, indent=2, default=native))
    report["checks"]["uploaded_files_unchanged"] = all(hashlib.sha256(Path(item["path"]).read_bytes()).hexdigest() == item["sha256"] for item in report["files"])
    (output / "artifact_audit.json").write_text(json.dumps(report, indent=2, default=native), encoding="utf-8")
    print(json.dumps({"environment": report["environment"], "checks": report["checks"]}, indent=2, default=native))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--root", default="ml")
    p.add_argument("--datasets", required=True)
    p.add_argument("--output", default="docs/model-review")
    a = p.parse_args()
    run(a.root, a.datasets, a.output)
