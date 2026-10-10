"""Synthetic expiry classification experiment with outcome-mature date splits.

No production approval is implied by export. Test data never selects the model
or operating threshold. The exported estimator stays fitted on training only.
"""
import argparse
import hashlib
import json
import platform
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix,
                             f1_score, precision_score, recall_score, roc_auc_score,
                             precision_recall_curve)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

NUMERIC = ["current_batch_stock", "days_to_expiry", "avg_monthly_consumption_rate", "coverage_gap_days", "zero_consumption"]
CATEGORICAL = ["category", "storage_condition"]
FEATURES = NUMERIC + CATEGORICAL


def features(raw):
    """Import this exact function into Django; do not duplicate feature logic."""
    d = raw.copy()
    required = ["current_batch_stock", "days_to_expiry", "avg_monthly_consumption_rate"] + CATEGORICAL
    if not set(required).issubset(d) or d[required].isna().any().any():
        raise ValueError("Missing required expiry inputs")
    for col in required[:3]:
        d[col] = pd.to_numeric(d[col], errors="raise")
        if not np.isfinite(d[col]).all() or (d[col] < 0).any():
            raise ValueError(f"Invalid {col}; already expired stock uses a separate rule")
    daily = d.avg_monthly_consumption_rate / 30.0
    d["zero_consumption"] = (daily == 0).astype(int)
    # Finite cap for the experimental estimator; deterministic fallback handles zero demand.
    depletion = np.divide(d.current_batch_stock, daily, out=np.full(len(d), 36500.0), where=daily.to_numpy() > 0)
    depletion = np.where(d.current_batch_stock == 0, 0, depletion)
    d["coverage_gap_days"] = np.minimum(depletion, 36500.0) - d.days_to_expiry
    return d[FEATURES]


def rule_prediction(raw):
    unused = np.maximum(0, raw.current_batch_stock - raw.avg_monthly_consumption_rate / 30.0 * raw.days_to_expiry)
    return (unused > 0).astype(int).to_numpy()


def split_data(d):
    dates = np.sort(d.check_date.unique())
    if len(dates) < 10:
        raise ValueError("Too few distinct assessment dates")
    val_start, test_start = pd.Timestamp(dates[int(len(dates) * .6)]), pd.Timestamp(dates[int(len(dates) * .8)])
    # Expiry is a conservative proxy for outcome availability. Real data needs resolved_at.
    train = d[(d.check_date < val_start) & (d.expiry_date < val_start)].copy()
    val = d[(d.check_date >= val_start) & (d.check_date < test_start) & (d.expiry_date < test_start)].copy()
    test = d[d.check_date >= test_start].copy()
    for name, frame in [("train", train), ("validation", val), ("test", test)]:
        if len(frame) < 20 or frame.at_risk_label.nunique() != 2:
            raise ValueError(f"{name}: insufficient mature examples from both classes")
    return train, val, test, val_start, test_start


def make_pipeline(estimator):
    numeric = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scale", StandardScaler())])
    category = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    return Pipeline([("prepare", ColumnTransformer([("num", numeric, NUMERIC), ("cat", category, CATEGORICAL)])), ("model", estimator)])


def metrics(y, pred, proba=None):
    result = {"n": len(y), "positives": int(np.sum(y)),
              "precision": float(precision_score(y, pred, zero_division=0)),
              "recall": float(recall_score(y, pred, zero_division=0)),
              "f1": float(f1_score(y, pred, zero_division=0)),
              "confusion_matrix_tn_fp_fn_tp": confusion_matrix(y, pred, labels=[0, 1]).ravel().tolist()}
    if proba is not None:
        result.update(average_precision=float(average_precision_score(y, proba)) if len(set(y)) == 2 else None,
                      roc_auc=float(roc_auc_score(y, proba)) if len(set(y)) == 2 else None,
                      brier=float(brier_score_loss(y, proba)))
    return result


def run(data_path, output, recall_target=.85):
    if not 0 < recall_target <= 1:
        raise ValueError("recall target must be in (0, 1]")
    path, out = Path(data_path), Path(output)
    out.mkdir(parents=True, exist_ok=True)
    d = pd.read_csv(path, parse_dates=["check_date", "expiry_date", "manufacture_date"])
    if d.isna().any().any() or d.batch_id.duplicated().any() or not d.at_risk_label.isin([0, 1]).all():
        raise ValueError("Missing values, repeated batches, or nonbinary labels")
    actual_days = (d.expiry_date - d.check_date).dt.days
    if not (actual_days == d.days_to_expiry).all() or (actual_days < 0).any():
        raise ValueError("Incorrect assessment-time days_to_expiry")
    if ((d.manufacture_date > d.check_date) | (d.current_batch_stock > d.batch_quantity_received)).any():
        raise ValueError("Invalid batch chronology or stock")
    features(d)  # Full input validation; no fitted statistics.
    train, val, test, val_start, test_start = split_data(d)
    candidates = {
        "logistic_regression": LogisticRegression(class_weight="balanced", max_iter=3000, random_state=42),
        "random_forest": RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=10, class_weight="balanced", random_state=42, n_jobs=-1),
    }
    fitted, validation = {}, {}
    for name, estimator in candidates.items():
        model = make_pipeline(estimator).fit(features(train), train.at_risk_label)
        p = model.predict_proba(features(val))[:, 1]
        fitted[name] = model
        validation[name] = metrics(val.at_risk_label, p >= .5, p)
    winner = max(validation, key=lambda name: validation[name]["average_precision"])
    model = fitted[winner]
    vp = model.predict_proba(features(val))[:, 1]
    precision, recall, thresholds = precision_recall_curve(val.at_risk_label, vp)
    eligible = np.flatnonzero(recall[:-1] >= recall_target)
    if not len(eligible):
        raise ValueError("No validation threshold meets the recall target")
    selected = eligible[np.argmax(precision[:-1][eligible])]
    threshold = float(thresholds[selected])
    tp = model.predict_proba(features(test))[:, 1]
    test_pred = (tp >= threshold).astype(int)
    test_result = metrics(test.at_risk_label, test_pred, tp)
    rule_result = metrics(test.at_risk_label, rule_prediction(test))
    validation["selected_threshold"] = metrics(val.at_risk_label, vp >= threshold, vp)
    validation["rule"] = metrics(val.at_risk_label, rule_prediction(val))
    result = test[["batch_id", "medicine_id", "category", "storage_condition", "check_date", "at_risk_label"]].copy()
    result["risk_score"] = tp
    result["predicted"] = test_pred
    result["rule_predicted"] = rule_prediction(test)
    result.to_csv(out / "test_predictions.csv", index=False)
    segments = []
    for column in ["category", "storage_condition"]:
        for value, g in result.groupby(column):
            segments.append({"segment": column, "value": str(value), **metrics(g.at_risk_label, g.predicted, g.risk_score)})
    (out / "segment_metrics.json").write_text(json.dumps(segments, indent=2), encoding="utf-8")
    splits = {}
    for name, frame in [("train", train), ("validation", val), ("test", test)]:
        splits[name] = {"n": len(frame), "positives": int(frame.at_risk_label.sum()), "start": str(frame.check_date.min().date()), "end": str(frame.check_date.max().date())}
        frame[["batch_id", "check_date", "expiry_date"]].to_csv(out / f"{name}_ids.csv", index=False)
    joblib.dump(model, out / "expiry_candidate.joblib")
    reloaded = joblib.load(out / "expiry_candidate.joblib")
    np.testing.assert_allclose(tp, reloaded.predict_proba(features(test))[:, 1])
    card = {"model": "expiry_risk", "version": "1.0", "algorithm": winner,
            "data_source": "synthetic", "production_approved": False,
            "label_provenance": "Supplied synthetic at_risk_label; generator/outcome history unavailable",
            "threshold": threshold, "validation_recall_target": recall_target,
            "features": FEATURES, "feature_schema": "expiry-v1", "splits": splits,
            "validation_start": str(val_start.date()), "test_start": str(test_start.date()),
            "purged_unmatured_rows": len(d) - len(train) - len(val) - len(test),
            "synthetic_evaluation_outcome_cutoff": str((test.expiry_date.max() + pd.Timedelta(days=1)).date()),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "versions": {"python": platform.python_version(), "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__},
            "validation": validation, "test": test_result, "test_rule": rule_result,
            "limitations": ["Future-dated synthetic outcomes are not observed real outcomes.", "Model remains fitted on training only; do not refit after threshold selection without new validation.", "Scores are not calibrated probabilities.", "One batch per row; no receipt dates or concurrent batch allocation history.", "Rule agreement can reflect a synthetic labelling mechanism; not proof of clinical or operational validity."]}
    (out / "metadata.json").write_text(json.dumps(card, indent=2), encoding="utf-8")
    print(json.dumps({"selected": winner, "threshold": threshold, "splits": splits, "test": test_result, "rule": rule_result}, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--recall-target", type=float, default=.85)
    a = p.parse_args()
    run(a.data, a.output, a.recall_target)
