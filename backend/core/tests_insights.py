"""Page data must come from data and models, in the shape the frontend expects."""
import base64
import io

from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from core.models import Medicine
from core.services import engine, insights

DEMO_DATE = "2024-12-31"


@override_settings(DSS_DEMO_DATE=DEMO_DATE)
class InsightServicesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("import_datasets", as_of=DEMO_DATE, stdout=io.StringIO())
        cls.user = User.objects.create_user(username="p@t.test", email="p@t.test", password="x", role="pharmacist")

    def setUp(self):
        insights._cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_stockout_days_are_excluded_from_demand_statistics(self):
        recent = [(100, False)] * 10 + [(0, True)] * 20  # 20-day stockout at the end
        mean, _, censored = engine.demand_stats(recent)
        self.assertEqual(censored, 20)
        self.assertEqual(mean, 100.0)

    def test_inventory_uses_engine_reorder_points_not_constants(self):
        items = self.client.get("/api/inventory/").json()
        self.assertEqual(len(items), 20)
        self.assertGreater(len({i["reorderPoint"] for i in items}), 10)
        statuses = {i["medicineName"]: i["status"] for i in items}
        self.assertEqual(statuses["Ciprofloxacin"], "out_of_stock")
        self.assertIsNone(next(i for i in items if i["medicineName"] == "Ciprofloxacin")["earliestExpiry"])

    def test_forecast_matches_frontend_contract(self):
        med = Medicine.objects.get(model_id=6)
        body = self.client.get(f"/api/medicines/{med.id}/forecast/?horizon=14").json()
        for key in ("series", "totalForecastDemand", "changeVsPreviousPeriodPct", "metrics"):
            self.assertIn(key, body)
        future = [p for p in body["series"] if p["forecast"] is not None]
        self.assertEqual(len(future), 14)
        self.assertTrue(all(p["lower"] <= p["forecast"] <= p["upper"] for p in future))

    def test_dashboard_has_no_placeholder_values(self):
        kpis = self.client.get("/api/dashboard/kpis/").json()
        self.assertEqual(kpis["outOfStockItems"], 2)
        self.assertNotEqual(kpis["expectedDemandChangePct"], 8.4)
        self.assertNotEqual(kpis["avgSupplierScore"], 88.0)

    def test_trend_is_monthly_history(self):
        trend = self.client.get("/api/inventory/trend/").json()
        self.assertEqual(len(trend), 12)
        self.assertEqual(trend[-1]["period"], "Dec 2024")

    def test_reports_return_real_csv_and_pdf(self):
        for fmt, magic in (("csv", b"medicineId"), ("pdf", b"%PDF")):
            body = self.client.post("/api/reports/generate/", {"type": "inventory", "format": fmt},
                                    format="json").json()
            self.assertTrue(base64.b64decode(body["contentBase64"]).startswith(magic))
            self.assertEqual(body["rows"], 20)

    def test_search_finds_medicines_and_suppliers(self):
        body = self.client.get("/api/search/?q=cipla").json()
        self.assertEqual(body["suppliers"][0]["label"], "Cipla Zimbabwe")

    def test_health_reports_demo_date(self):
        body = APIClient().get("/api/health/").json()
        self.assertEqual(body["today"], DEMO_DATE)
        self.assertTrue(body["demo"])
