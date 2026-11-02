"""Shared helpers for the export_data / import_data commands.

The snapshot is a gzipped JSON file:

    {
      "format":     "pharminsight-data/1",
      "created":    "2026-11-02T20:00:00+02:00",
      "source":     "sqlite",
      "migrations": {"accounts": "0001_initial", "core": "0002_..."},
      "counts":     {"accounts.user": 7, "core.medicine": 20, ...},
      "sha256":     "<digest of the objects array>",
      "objects":    [ Django serializer records, parents before children ]
    }

Login sessions, JWT tokens, admin history and Django's own permission/content-type
tables are not copied: they are rebuilt by migrate or by users signing in again.
"""
import hashlib
import json

from django.apps import apps
from django.core.serializers import sort_dependencies
from django.core.serializers.json import DjangoJSONEncoder
from django.db.migrations.recorder import MigrationRecorder

FORMAT = "pharminsight-data/1"
APP_LABELS = ("accounts", "core")
EXTRA_MODELS = ("auth.group",)


def transfer_models():
    """Models to copy, parents before children (safe insert order)."""
    models = [apps.get_model(label) for label in EXTRA_MODELS]
    for label in APP_LABELS:
        models += [m for m in apps.get_app_config(label).get_models() if not m._meta.proxy]
    ordered = sort_dependencies([(None, models)], allow_cycles=False)
    return [m for m in ordered if m in models]


def label(model):
    return model._meta.label_lower


def latest_migrations(connection):
    """{app: newest applied migration} for the apps whose data we copy."""
    applied = MigrationRecorder(connection).applied_migrations()
    latest = {}
    for app, name in applied:
        if app in APP_LABELS and name > latest.get(app, ""):
            latest[app] = name
    return latest


def digest(objects):
    raw = json.dumps(objects, cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
