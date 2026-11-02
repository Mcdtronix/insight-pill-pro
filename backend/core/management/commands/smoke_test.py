"""Read-only smoke test of the API against the real database.

Used by the deploy pipeline before a release goes live:

    python manage.py smoke_test

It signs in (in-process, no password needed) as an active admin/manager/pharmacist,
calls the endpoints every main page depends on, and checks each answers 200 with JSON.
Everything runs inside a transaction that is always rolled back, so a page that
writes as a side effect (for example a notification) leaves no trace.
"""
import time

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from rest_framework.test import APIClient

ENDPOINTS = (
    "/api/dashboard/kpis/",
    "/api/dashboard/insights/",
    "/api/medicines/",
    "/api/inventory/",
    "/api/inventory/health/",
    "/api/inventory/trend/",
    "/api/inventory/expiry-risk/",
    "/api/recommendations/",
    "/api/suppliers/",
    "/api/notifications/",
    "/api/lab/models/",
)
ROLE_PREFERENCE = ("admin", "manager", "pharmacist")


class _Rollback(Exception):
    pass


class Command(BaseCommand):
    help = "Call the main API endpoints as a real user, read-only, and fail on any error."

    def add_arguments(self, parser):
        parser.add_argument("--allow-empty", action="store_true",
                            help="Pass (with a warning) when there is no user to test with, e.g. a fresh database.")

    def handle(self, *args, allow_empty=False, **options):
        user = self._pick_user()
        if user is None:
            if allow_empty:
                self.stdout.write(self.style.WARNING("No active admin/manager/pharmacist yet: authenticated checks skipped."))
                return
            raise CommandError("No active admin, manager or pharmacist account to test with.")

        host = next((h for h in settings.ALLOWED_HOSTS if h and "*" not in h and not h.startswith(".")), "localhost")
        client = APIClient(HTTP_HOST=host)
        client.force_authenticate(user=user)
        failures = []

        try:
            with transaction.atomic():
                for url in self._urls():
                    started = time.monotonic()
                    try:
                        response = client.get(url, secure=True)
                        ok = response.status_code == 200 and response.get("Content-Type", "").startswith("application/json")
                        detail = str(response.status_code)
                    except Exception as exc:  # report every endpoint, not just the first failure
                        ok, detail = False, f"{type(exc).__name__}: {exc}"
                    elapsed = (time.monotonic() - started) * 1000
                    mark = self.style.SUCCESS("ok  ") if ok else self.style.ERROR("FAIL")
                    self.stdout.write(f"  {mark} {url:<38} {detail:>4}  {elapsed:7.0f} ms")
                    if not ok:
                        failures.append(f"{url} -> {detail}")
                raise _Rollback
        except _Rollback:
            pass

        if failures:
            raise CommandError("Smoke test failed: " + "; ".join(failures))
        self.stdout.write(self.style.SUCCESS(f"Smoke test passed as {user.get_username()} ({user.role})."))

    @staticmethod
    def _pick_user():
        users = get_user_model().objects.filter(is_active=True)
        for role in ROLE_PREFERENCE:
            user = users.filter(role=role).order_by("id").first()
            if user:
                return user
        return users.filter(is_superuser=True).order_by("id").first()

    @staticmethod
    def _urls():
        from core.models import Medicine

        urls = list(ENDPOINTS)
        medicine = Medicine.objects.filter(active=True).order_by("id").first()
        if medicine:
            urls += [f"/api/medicines/{medicine.id}/", f"/api/medicines/{medicine.id}/forecast/"]
        return urls
