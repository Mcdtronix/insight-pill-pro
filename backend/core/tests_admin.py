from django.contrib import admin
from django.test import SimpleTestCase
from . import models

class AdminRegistrationTests(SimpleTestCase):
    def test_all_domain_models_are_registered(self):
        expected = [
            models.Medicine, models.Supplier, models.SupplierOffer, models.Batch,
            models.DataState, models.StockMovement, models.DailyDemand,
            models.CalendarDay, models.SupplierDelivery, models.Policy,
            models.DecisionSnapshot, models.Recommendation, models.PurchaseOrder,
            models.Notification, models.AuditEvent, models.Report, models.ImportRun,
        ]
        for model in expected:
            self.assertIn(model, admin.site._registry, model.__name__)

    def test_admin_branding_is_configured(self):
        self.assertEqual(admin.site.site_header, "Pharmacy Decision Support Administration")
