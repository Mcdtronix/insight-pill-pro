"""
Pharmacy Insight Hub — Live Model Demonstration & What-If Inference Engine
Designed for Computer Science Project Defenses & Examiner Scenarios.

Usage:
    .\\env\\Scripts\\python.exe ml/demo_inference.py
"""

import os
import sys
import json
import warnings
from pathlib import Path
import numpy as np

warnings.filterwarnings("ignore", category=UserWarning)

BASE_DIR = Path(__file__).resolve().parent

# Artifact Paths
DEMAND_MODEL_PATH = BASE_DIR / "Demand" / "forecast_model_v1.pkl"
DEMAND_CAT_ENC_PATH = BASE_DIR / "Demand" / "category_encoder_v1.pkl"
DEMAND_SEASON_ENC_PATH = BASE_DIR / "Demand" / "season_encoder_v1.pkl"
DEMAND_META_PATH = BASE_DIR / "Demand" / "model_metadata_v1.json"

REORDER_MODEL_PATH = BASE_DIR / "Reorder" / "reorder_risk_model_v1.pkl"
REORDER_META_PATH = BASE_DIR / "Reorder" / "model_metadata_reorder_risk_v1.json"

SUPPLIER_KMEANS_PATH = BASE_DIR / "supplier" / "supplier_kmeans_v1.pkl"
SUPPLIER_SCALER_PATH = BASE_DIR / "supplier" / "supplier_scaler_v1.pkl"
SUPPLIER_META_PATH = BASE_DIR / "supplier" / "model_metadata_supplier_v1.json"


import joblib

def load_artifact(path):
    if not path.exists():
        raise FileNotFoundError(f"Missing artifact: {path.name}")
    return joblib.load(path)


def load_json(path):
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def safe_input(prompt, default=""):
    try:
        val = input(prompt).strip()
        return val if val else default
    except (EOFError, KeyboardInterrupt):
        return default


def print_banner(title):
    width = 72
    print("\n" + "=" * width)
    print(f" {title.center(width - 2)} ")
    print("=" * width)


def demo_demand_forecast(preset=None):
    print_banner("MODEL 1: DEMAND FORECASTING (RANDOM FOREST REGRESSOR)")
    model = load_artifact(DEMAND_MODEL_PATH)
    cat_enc = load_artifact(DEMAND_CAT_ENC_PATH)
    season_enc = load_artifact(DEMAND_SEASON_ENC_PATH)
    meta = load_json(DEMAND_META_PATH)

    categories = list(cat_enc.classes_)
    seasons = list(season_enc.classes_)

    print(f"• Algorithm: Random Forest Regressor ({meta.get('hyperparameters', {}).get('n_estimators', 750)} trees, max depth {meta.get('hyperparameters', {}).get('max_depth', 9)})")
    print(f"• Trained Metrics: MAE = {meta.get('test_metrics', {}).get('MAE', 21.3):.2f} units | MAPE = {meta.get('test_metrics', {}).get('MAPE', 33.7):.1f}%")
    print("\nAvailable Categories:", ", ".join(categories))
    print("Available Seasons:", ", ".join(seasons))

    if preset:
        choice = preset
        print(f"\n[Running Preset Scenario {choice}]")
    else:
        print("\n--- Choose Input Mode ---")
        print("1. Scenario A: Baseline Normal Day (Antibiotic in Dry Season)")
        print("2. Scenario B: High Consumption Spike (Analgesic in Rainy Season)")
        print("3. Manual Feature Entry (Interactive)")
        choice = safe_input("\nEnter choice [1-3, default 1]: ").strip() or "1"

    if choice == "1":
        med_id = 1
        cat_str = "Antibiotic"
        season_str = "Dry Season" if "Dry Season" in seasons else seasons[0]
        dow = 2  # Wednesday
        month = 4
        is_wknd = 0
        is_hol = 0
        lag1 = 45.0
        lag7 = 42.0
        lag14 = 40.0
        lag30 = 38.0
        roll7 = 43.0
        roll30 = 40.0
        std7 = 3.5
    elif choice == "2":
        med_id = 2
        cat_str = "Analgesic/Antipyretic" if "Analgesic/Antipyretic" in categories else categories[0]
        season_str = "Rainy Season" if "Rainy Season" in seasons else seasons[-1]
        dow = 0  # Monday
        month = 11
        is_wknd = 0
        is_hol = 0
        lag1 = 120.0
        lag7 = 110.0
        lag14 = 95.0
        lag30 = 80.0
        roll7 = 108.0
        roll30 = 92.0
        std7 = 12.8
    else:
        print("\nEnter custom parameters:")
        med_id = int(safe_input("Medicine ID [e.g. 1]: ").strip() or 1)
        cat_str = safe_input(f"Category [{categories[0]}]: ").strip() or categories[0]
        season_str = safe_input(f"Season [{seasons[0]}]: ").strip() or seasons[0]
        dow = int(safe_input("Day of week [0=Mon, 6=Sun, default 2]: ").strip() or 2)
        month = int(safe_input("Month [1-12, default 6]: ").strip() or 6)
        is_wknd = 1 if dow >= 5 else 0
        is_hol = int(safe_input("Is public holiday [0/1, default 0]: ").strip() or 0)
        lag1 = float(safe_input("Yesterday's demand (Lag 1) [e.g. 50]: ").strip() or 50)
        lag7 = float(safe_input("Last week's demand (Lag 7) [e.g. 48]: ").strip() or 48)
        lag14 = float(safe_input("2 weeks ago demand (Lag 14) [e.g. 45]: ").strip() or 45)
        lag30 = float(safe_input("30 days ago demand (Lag 30) [e.g. 42]: ").strip() or 42)
        roll7 = float(safe_input("7-day rolling mean [e.g. 47]: ").strip() or 47)
        roll30 = float(safe_input("30-day rolling mean [e.g. 44]: ").strip() or 44)
        std7 = float(safe_input("7-day demand std deviation [e.g. 5.0]: ").strip() or 5.0)

    cat_code = cat_enc.transform([cat_str])[0]
    season_code = season_enc.transform([season_str])[0]

    # Exactly 14 features in model order
    features = np.array([[
        med_id, cat_code, season_code, dow, month,
        is_wknd, is_hol, lag1, lag7, lag14, lag30,
        roll7, roll30, std7
    ]], dtype=float)

    pred = model.predict(features)[0]

    print("\n" + "-" * 50)
    print("INPUT VECTOR:")
    print(f"  • Category: {cat_str} (encoded: {cat_code}) | Season: {season_str} (encoded: {season_code})")
    print(f"  • Historical Lags: Lag-1={lag1}, Lag-7={lag7}, Lag-14={lag14}, Lag-30={lag30}")
    print(f"  • Rolling Statistics: 7-day Mean={roll7}, 30-day Mean={roll30}, 7-day StdDev={std7}")
    print("-" * 50)
    print(f"\n>>> PREDICTED CONSUMPTION: {max(0.0, pred):.1f} units/day")
    print("-" * 50)


def demo_reorder_risk(preset=None):
    print_banner("MODEL 2: STOCKOUT RISK / REORDER TRIGGER (RANDOM FOREST CLASSIFIER)")
    model = load_artifact(REORDER_MODEL_PATH)
    meta = load_json(REORDER_META_PATH)

    threshold = meta.get("decision_threshold", 0.12461645022709879)
    print(f"• Algorithm: Random Forest Classifier ({meta.get('hyperparameters', {}).get('n_estimators', 300)} trees)")
    print(f"• Decision Threshold: {threshold:.4f} (Calibrated for ~80% Recall of true stockouts)")
    print(f"• Validation ROC-AUC: {meta.get('test_metrics', {}).get('roc_auc', 0.963):.4f} | PR-AUC: {meta.get('test_metrics', {}).get('pr_auc', 0.81):.4f}")

    if preset:
        choice = preset
        print(f"\n[Running Preset Scenario {choice}]")
    else:
        print("\n--- Choose Input Mode ---")
        print("1. Scenario A: Safe Buffer (Stock=400, Demand=15/day, LeadTime=5d) -> Low Risk")
        print("2. Scenario B: The 'Deceptive' Critical Point (Stock=70, Demand=12/day, LeadTime=7d ± 3d) -> Stockout Imminent")
        print("3. Manual Feature Entry (Interactive)")
        choice = safe_input("\nEnter choice [1-3, default 2]: ").strip() or "2"

    if choice == "1":
        current_stock = 400.0
        avg_demand = 15.0
        demand_std = 3.0
        lead_time = 5.0
        lead_time_std = 1.0
        reorder_placed = 0
        cat_name = "Analgesic/Antipyretic"
    elif choice == "2":
        current_stock = 70.0
        avg_demand = 12.0
        demand_std = 4.0
        lead_time = 7.0
        lead_time_std = 3.0
        reorder_placed = 0
        cat_name = "Antibiotic"
    else:
        print("\nEnter custom parameters:")
        current_stock = float(safe_input("Current stock level (units) [e.g. 50]: ").strip() or 50)
        avg_demand = float(safe_input("Average daily demand [e.g. 10]: ").strip() or 10)
        demand_std = float(safe_input("Demand std deviation [e.g. 3.0]: ").strip() or 3.0)
        lead_time = float(safe_input("Supplier lead time (days) [e.g. 7]: ").strip() or 7)
        lead_time_std = float(safe_input("Lead time variability (days) [e.g. 2.0]: ").strip() or 2.0)
        reorder_placed = int(safe_input("Order already in-flight [0=No, 1=Yes, default 0]: ").strip() or 0)
        cat_name = safe_input("Category [e.g. Antibiotic]: ").strip() or "Antibiotic"

    # Derived features according to training pipeline
    days_remaining = current_stock / max(avg_demand, 0.001)
    demand_cv = demand_std / max(avg_demand, 0.001)
    lead_time_margin = days_remaining - lead_time
    lead_time_cv = lead_time_std / max(lead_time, 0.001)

    # 10 category one-hot indicators
    categories_order = [
        "cat_Analgesic/Antipyretic", "cat_Antibiotic", "cat_Antidiabetic",
        "cat_Antihypertensive", "cat_Antimalarial", "cat_Antiretroviral",
        "cat_Antituberculosis", "cat_Gastrointestinal", "cat_Respiratory",
        "cat_Supplement"
    ]
    cat_indicators = [1.0 if f"cat_{cat_name}" == col else 0.0 for col in categories_order]

    # Full 21 ordered features
    feature_row = [
        1, current_stock, avg_demand, demand_std, lead_time, lead_time_std,
        days_remaining, reorder_placed, demand_cv, lead_time_margin, lead_time_cv
    ] + cat_indicators

    x = np.array([feature_row], dtype=float)
    probs = model.predict_proba(x)[0]
    stockout_prob = probs[1]
    is_at_risk = stockout_prob >= threshold

    print("\n" + "-" * 50)
    print("ENGINEERED DECISION FEATURES:")
    print(f"  • Days of Stock Remaining: {days_remaining:.1f} days")
    print(f"  • Lead Time Margin: {lead_time_margin:.1f} days ({days_remaining:.1f}d - {lead_time:.1f}d lead time)")
    print(f"  • Demand CV: {demand_cv:.2f} | Lead Time CV: {lead_time_cv:.2f}")
    print("-" * 50)
    print(f"MODEL RAW OUTPUT:")
    print(f"  • P(No Stockout): {probs[0]:.4f} ({probs[0]*100:.1f}%)")
    print(f"  • P(Stockout):    {stockout_prob:.4f} ({stockout_prob*100:.1f}%)")
    print(f"  • Decision Threshold: {threshold:.4f}")
    print("-" * 50)
    
    if is_at_risk:
        print(">>> DECISION: [HIGH STOCKOUT RISK] -> TRIGGER AUTOMATED REORDER")
        print(f"    Reason: Risk score {stockout_prob:.4f} >= threshold {threshold:.4f}.")
        suggested_reorder = int(max(0, (lead_time + 5) * avg_demand - current_stock + 100))
        print(f"    Recommended Action: Procure {suggested_reorder} units immediately.")
    else:
        print(">>> DECISION: [STOCK LEVEL SAFE] -> NO ORDER REQUIRED")
        print(f"    Reason: Risk score {stockout_prob:.4f} < threshold {threshold:.4f}.")
    print("-" * 50)


def demo_supplier_evaluation(preset=None):
    print_banner("MODEL 3: SUPPLIER PERFORMANCE & K-MEANS TIER CLUSTERING")
    kmeans = load_artifact(SUPPLIER_KMEANS_PATH)
    scaler = load_artifact(SUPPLIER_SCALER_PATH)
    meta = load_json(SUPPLIER_META_PATH)

    weights = meta.get("weights", {"on_time_rate": 0.35, "avg_fulfillment_rate": 0.3, "avg_price_variance_pct": 0.2, "avg_defect_rate": 0.15})
    print(f"• Algorithm: Multi-Factor Weighted Scoring + K-Means ({kmeans.n_clusters} Clusters/Tiers)")
    print(f"• Weights: On-Time Delivery ({weights['on_time_rate']*100:.0f}%), Fulfillment ({weights['avg_fulfillment_rate']*100:.0f}%), Price Variance ({weights['avg_price_variance_pct']*100:.0f}%), Defect Rate ({weights['avg_defect_rate']*100:.0f}%)")

    if preset:
        on_time = 0.92
        fulfillment = 0.98
        price_var = 2.5
        defect = 0.01
        print("\n[Running Baseline Supplier: On-Time=92%, Fulfillment=98%, PriceVar=2.5%, Defect=1%]")
    else:
        print("\n--- Enter Supplier Performance Metrics ---")
        on_time = float(safe_input("On-time delivery rate (0.0 to 1.0) [e.g. 0.92]: ").strip() or 0.92)
        fulfillment = float(safe_input("Fulfillment rate (0.0 to 1.0) [e.g. 0.98]: ").strip() or 0.98)
        price_var = float(safe_input("Price variance percentage (e.g. 2.5 for 2.5%): ").strip() or 2.5)
        defect = float(safe_input("Defect rate (0.0 to 0.10) [e.g. 0.01 for 1%]: ").strip() or 0.01)

    # 4 score features
    raw_vec = np.array([[on_time, fulfillment, price_var, defect]], dtype=float)
    scaled_vec = scaler.transform(raw_vec)
    cluster = kmeans.predict(scaled_vec)[0]

    # Weighted overall score (0-100)
    score = (
        on_time * weights["on_time_rate"] * 100 +
        fulfillment * weights["avg_fulfillment_rate"] * 100 +
        max(0, 100 - price_var * 10) * weights["avg_price_variance_pct"] +
        max(0, 100 - defect * 1000) * weights["avg_defect_rate"]
    )

    tier_labels = {
        0: "Tier 1: Preferred / High-Reliability Partner",
        1: "Tier 2: Standard Commercial Supplier",
        2: "Tier 3: Elevated Risk / Requires Supervision"
    }

    print("\n" + "-" * 50)
    print(f"COMPUTED COMPOSITE SCORE: {score:.1f} / 100")
    print(f"K-MEANS CLUSTER ASSIGNMENT: Cluster #{cluster} -> {tier_labels.get(cluster, f'Cluster {cluster}')}")
    print("-" * 50)


def main():
    if "--demand" in sys.argv:
        demo_demand_forecast(preset="1")
        return
    if "--reorder" in sys.argv:
        demo_reorder_risk(preset="2")
        return
    if "--supplier" in sys.argv:
        demo_supplier_evaluation(preset="default")
        return
    if "--all" in sys.argv:
        demo_demand_forecast(preset="1")
        demo_reorder_risk(preset="2")
        demo_supplier_evaluation(preset="default")
        return

    while True:
        print_banner("PHARMACY INSIGHT HUB — ML DECISION ENGINE DEMONSTRATOR")
        print("Select model demonstration:")
        print("  [1] Model 1: Medicine Demand Forecasting (Optuna-Tuned Random Forest)")
        print("  [2] Model 2: Reorder Stockout Risk Classifier (Calibrated Cutoff T=0.1246)")
        print("  [3] Model 3: Supplier Performance Scoring & K-Means Tiering")
        print("  [4] Exit")
        choice = safe_input("\nEnter choice [1-4]: ", default="4").strip()

        if choice == "1":
            demo_demand_forecast()
        elif choice == "2":
            demo_reorder_risk()
        elif choice == "3":
            demo_supplier_evaluation()
        elif choice == "4":
            print("\nExiting demonstration suite. Good luck with your project defense!\n")
            break
        else:
            print("\nInvalid choice. Please select 1-4.")


if __name__ == "__main__":
    main()
