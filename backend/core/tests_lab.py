"""Model Lab tests: the exported models must reproduce their reported metrics,
explanations must add up exactly, and access must follow role permissions."""
import json
from pathlib import Path

import numpy as np
from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.services import lab
from core.services.ml import _load


def _meta(folder, name):
    return json.loads((Path(settings.MODEL_ROOT) / folder / name).read_text(encoding="utf-8"))


class ReproducesReportedMetricsTests(TestCase):
    def test_demand_model_matches_colab_test_metrics(self):
        reported = _meta("Demand", "model_metadata_v1.json")["test_metrics"]
        result = lab.demand_evaluate()
        self.assertEqual(result["testRows"], 1020)
        self.assertAlmostEqual(result["metrics"]["MAE"], reported["MAE"], places=1)
        self.assertAlmostEqual(result["metrics"]["RMSE"], reported["RMSE"], places=1)
        self.assertLess(result["metrics"]["MAE"], result["baseline"]["MAE"])

    def test_reorder_model_matches_colab_test_metrics(self):
        reported = _meta("Reorder", "model_metadata_reorder_risk_v1.json")["test_metrics"]
        result = lab.reorder_evaluate()
        self.assertAlmostEqual(result["metrics"]["recall"], reported["recall"], places=2)
        self.assertAlmostEqual(result["metrics"]["precision"], reported["precision"], places=2)
        self.assertAlmostEqual(result["metrics"]["prAuc"], reported["pr_auc"], places=2)

    def test_supplier_scores_match_exported_scorecard(self):
        self.assertTrue(lab.supplier_evaluate()["reproduced"])

    def test_expiry_rule_agreement(self):
        self.assertAlmostEqual(lab.expiry_evaluate()["metrics"]["accuracy"], 0.9553, places=4)


class ExplanationTests(TestCase):
    def test_demand_explanation_sums_to_prediction(self):
        frame = lab._demand_test_frame().head(5)
        model = _load("Demand", "forecast_model_v1.pkl")
        for i in range(len(frame)):
            base, contribs = lab.explain_forest(model, frame[lab.DEMAND_FEATURES].iloc[i].to_numpy())
            self.assertAlmostEqual(base + contribs.sum(), frame.prediction.iloc[i], places=4)

    def test_reorder_explanation_sums_to_probability(self):
        frame = lab._reorder_test_frame().head(5)
        model = _load("Reorder", "reorder_risk_model_v1.pkl")
        cols = lab._reorder_meta()["feature_columns"]
        for i in range(len(frame)):
            base, contribs = lab.explain_forest(model, frame[cols].astype(float).iloc[i].to_numpy(), class_index=1)
            self.assertAlmostEqual(base + contribs.sum(), frame.proba.iloc[i], places=5)

    def test_shown_contributions_always_add_up(self):
        names = [f"f{i}" for i in range(12)]
        contribs = np.linspace(-1, 1, 12)
        rows = lab._contributions(names, np.zeros(12), contribs, top=4)
        self.assertAlmostEqual(sum(r["contribution"] for r in rows), contribs.sum(), places=3)


class LabAccessAndValidationTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def login(self, role):
        user = User.objects.create_user(username=f"{role}@t.test", email=f"{role}@t.test", password="x", role=role)
        self.client.force_authenticate(user)

    def test_staff_cannot_use_lab(self):
        self.login("staff")
        self.assertEqual(self.client.get("/api/lab/models/").status_code, 403)

    def test_pharmacist_sees_four_model_cards(self):
        self.login("pharmacist")
        response = self.client.get("/api/lab/models/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([c["key"] for c in response.json()], ["demand", "reorder", "supplier", "expiry"])

    def test_invalid_input_returns_field_errors(self):
        self.login("pharmacist")
        response = self.client.post("/api/lab/reorder/predict/", {"medicineId": 99, "currentStock": -5}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("currentStock", response.json()["fields"])

    def test_supplier_score_without_database(self):
        self.login("pharmacist")
        response = self.client.post("/api/lab/supplier/predict/", {
            "onTimeRate": 0.25, "fulfillmentRate": 0.9, "priceVariancePct": -8, "defectRate": 0.01, "orders": 400,
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tier"], "Preferred")

    def test_expiry_rule_flags_slow_batch(self):
        self.login("pharmacist")
        response = self.client.post("/api/lab/expiry/predict/", {
            "batchStock": 3000, "daysToExpiry": 60, "monthlyConsumption": 900, "unitCost": 0.35}, format="json")
        body = response.json()
        self.assertTrue(body["atRisk"])
        self.assertEqual(body["unusedUnits"], 1200)
