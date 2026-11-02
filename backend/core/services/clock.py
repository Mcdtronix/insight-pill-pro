"""Single source of "today" for decision logic.

When DSS_DEMO_DATE is set (debug only), the system behaves as if that date is
today. This lets the 2024 datasets be demonstrated as a live pharmacy.
"""
from datetime import date

from django.conf import settings
from django.utils import timezone


def today() -> date:
    if settings.DSS_DEMO_DATE:
        return date.fromisoformat(settings.DSS_DEMO_DATE)
    return timezone.localdate()


def is_demo() -> bool:
    return bool(settings.DSS_DEMO_DATE)
