"""Tests for the operational tools the deploy pipeline relies on:
health check, smoke test, and the export_data / import_data transfer."""
import gzip
import io
import json
import shutil
import tempfile
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditEvent, DailyDemand, Medicine, Supplier

DEMO_DATE = "2024-12-31"


class HealthCheckTests(TestCase):
    def test_healthy_when_database_and_models_are_present(self):
        response = APIClient().get("/api/health/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual((body["status"], body["database"], body["models"]), ("ok", "ok", "ok"))
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_unhealthy_when_model_files_are_missing(self):
        empty = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, empty, ignore_errors=True)
        with self.settings(MODEL_ROOT=empty):
            response = APIClient().get("/api/health/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["models"], "missing")
        self.assertNotIn(empty, response.content.decode())


@override_settings(DSS_DEMO_DATE=DEMO_DATE)
class SmokeTestCommandTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("import_datasets", as_of=DEMO_DATE, stdout=io.StringIO())

    def test_fails_without_a_user_unless_allowed(self):
        with self.assertRaises(CommandError):
            call_command("smoke_test", stdout=io.StringIO())
        out = io.StringIO()
        call_command("smoke_test", allow_empty=True, stdout=out)
        self.assertIn("skipped", out.getvalue())

    def test_passes_on_demo_data_and_writes_nothing(self):
        User.objects.create_user(username="m@t.test", email="m@t.test", password="x", role="manager")
        before = AuditEvent.objects.count()
        out = io.StringIO()
        call_command("smoke_test", stdout=out)
        self.assertIn("Smoke test passed", out.getvalue())
        self.assertNotIn("FAIL", out.getvalue())
        self.assertEqual(AuditEvent.objects.count(), before)


@override_settings(DSS_DEMO_DATE=DEMO_DATE)
class DataTransferTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("import_datasets", as_of=DEMO_DATE, stdout=io.StringIO())
        User.objects.create_user(username="ph@t.test", email="ph@t.test", password="secret-x1", role="pharmacist")

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.snapshot = self.tmp / "snap.json.gz"
        call_command("export_data", output=str(self.snapshot), stdout=io.StringIO())

    def counts(self):
        return (User.objects.count(), Medicine.objects.count(), Supplier.objects.count(), DailyDemand.objects.count())

    def test_round_trip_restores_every_record(self):
        expected = self.counts()
        Medicine.objects.filter(pk=Medicine.objects.first().pk).update(name="Changed")
        call_command("import_data", str(self.snapshot), replace=True, stdout=io.StringIO())
        self.assertEqual(self.counts(), expected)
        self.assertFalse(Medicine.objects.filter(name="Changed").exists())
        # Password hashes travel with the users, so existing logins keep working.
        self.assertTrue(User.objects.get(username="ph@t.test").check_password("secret-x1"))
        # Sequences were reset: a new row does not collide with a copied one.
        AuditEvent.objects.create(action="after-import", entity="test")

    def test_refuses_to_overwrite_without_replace(self):
        with self.assertRaisesMessage(CommandError, "--replace"):
            call_command("import_data", str(self.snapshot), stdout=io.StringIO())

    def test_dry_run_changes_nothing(self):
        Medicine.objects.filter(pk=Medicine.objects.first().pk).update(name="Kept")
        call_command("import_data", str(self.snapshot), replace=True, dry_run=True, stdout=io.StringIO())
        self.assertTrue(Medicine.objects.filter(name="Kept").exists())

    def test_tampered_snapshot_is_rejected_before_any_change(self):
        with gzip.open(self.snapshot, "rt", encoding="utf-8") as handle:
            data = json.load(handle)
        data["objects"][0]["fields"]["role"] = "admin"
        with gzip.open(self.snapshot, "wt", encoding="utf-8") as handle:
            json.dump(data, handle)
        before = self.counts()
        with self.assertRaisesMessage(CommandError, "checksum"):
            call_command("import_data", str(self.snapshot), replace=True, stdout=io.StringIO())
        self.assertEqual(self.counts(), before)
