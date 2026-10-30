"""Decision engine tests on the imported demo dataset (as at 31 Dec 2024)."""
import io

import numpy as np
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from core.models import Batch, Medicine, PurchaseOrder, Recommendation
from core.services import engine, lab
from core.services.ml import _load, forest_regress

DEMO_DATE = "2024-12-31"


@override_settings(DSS_DEMO_DATE=DEMO_DATE)
class DecisionEngineTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("import_datasets", as_of=DEMO_DATE, stdout=io.StringIO())
        cls.pharmacist = User.objects.create_user(username="ph@t.test", email="ph@t.test", password="x", role="pharmacist")
        cls.staff = User.objects.create_user(username="st@t.test", email="st@t.test", password="x", role="staff")

    def setUp(self):
        self.client = APIClient()

    def test_fast_forest_prediction_is_identical(self):
        model = _load("Demand", "forecast_model_v1.pkl")
        x = lab._demand_test_frame()[lab.DEMAND_FEATURES].head(25)
        np.testing.assert_allclose(forest_regress(model, x), model.predict(x), rtol=0, atol=1e-9)

    def test_run_checks_every_medicine_and_orders_out_of_stock(self):
        result = engine.run(save=True)
        self.assertEqual(result["checked"], 20)
        by_name = {r["medicineName"]: r for r in result["results"]}
        for name in ("Ciprofloxacin", "Hydrochlorothiazide"):
            self.assertEqual(by_name[name]["action"], "order")
            self.assertEqual(by_name[name]["priority"], "critical")
            self.assertGreater(by_name[name]["quantity"], 0)
        self.assertEqual(Recommendation.objects.filter(status="pending").count(), result["reorder"])
        for r in result["results"]:
            self.assertEqual([s["step"] for s in r["chain"]], [1, 2, 3, 4, 5, 6])

    def test_rerun_supersedes_instead_of_duplicating(self):
        engine.run(save=True)
        first = Recommendation.objects.filter(status="pending").count()
        engine.run(save=True)
        self.assertEqual(Recommendation.objects.filter(status="pending").count(), first)
        self.assertEqual(Recommendation.objects.filter(status="superseded").count(), first)

    def test_pharmacist_approval_creates_purchase_order(self):
        engine.run(save=True)
        rec = Recommendation.objects.get(medicine__model_id=6, status="pending")
        self.client.force_authenticate(self.pharmacist)
        response = self.client.post(f"/api/recommendations/{rec.id}/approve/", {"quantity": 8000}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "approved")
        po = PurchaseOrder.objects.get(recommendation=rec)
        self.assertEqual(po.placed_at.isoformat(), DEMO_DATE)
        self.assertEqual((po.expected_at - po.placed_at).days, rec.offer.lead_time_days)

    def test_open_order_leads_to_expedite_not_duplicate(self):
        engine.run(save=True)
        rec = Recommendation.objects.get(medicine__model_id=6, status="pending")
        self.client.force_authenticate(self.pharmacist)
        self.client.post(f"/api/recommendations/{rec.id}/approve/", {}, format="json")
        coartem = engine.run(model_ids=[6], save=True)["results"][0]
        self.assertEqual(coartem["onOrder"], rec.quantity)
        self.assertEqual(coartem["action"], "expedite")
        self.assertFalse(Recommendation.objects.filter(medicine__model_id=6, status="pending").exists())

    def test_staff_cannot_approve_or_dispense(self):
        engine.run(save=True)
        rec = Recommendation.objects.filter(status="pending").first()
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.post(f"/api/recommendations/{rec.id}/approve/", {}).status_code, 403)
        self.assertEqual(self.client.post("/api/decisions/dispense/", {"medicineId": 1, "quantity": 5}).status_code, 403)

    def test_dispense_uses_earliest_expiry_first(self):
        med = Medicine.objects.get(model_id=1)
        batches = list(Batch.objects.filter(medicine=med).order_by("expiry_date"))
        first_qty, second_qty = batches[0].quantity, batches[1].quantity
        self.client.force_authenticate(self.pharmacist)
        response = self.client.post("/api/decisions/dispense/", {"medicineId": 1, "quantity": first_qty + 10},
                                    format="json")
        self.assertEqual(response.status_code, 201)
        batches = list(Batch.objects.filter(medicine=med).order_by("expiry_date"))
        self.assertEqual(batches[0].quantity, 0)
        self.assertEqual(batches[1].quantity, second_qty - 10)
        self.assertEqual(sum(b.quantity for b in batches), 5285 - first_qty - 10)

    def test_dispense_more_than_stock_is_refused(self):
        self.client.force_authenticate(self.pharmacist)
        response = self.client.post("/api/decisions/dispense/", {"medicineId": 4, "quantity": 1}, format="json")
        self.assertEqual(response.status_code, 409)
