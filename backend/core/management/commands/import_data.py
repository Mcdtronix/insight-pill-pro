"""Load a snapshot made by `export_data` into this database.

    python manage.py import_data snapshot.json.gz            # into an empty database
    python manage.py import_data snapshot.json.gz --replace  # wipe app data first
    python manage.py import_data snapshot.json.gz --dry-run  # validate, change nothing

All of it runs in ONE transaction: the database ends up with exactly the snapshot,
or (on any error) exactly what it had before. Row counts are verified before commit,
and PostgreSQL ID sequences are reset so new records do not collide with copied ones.
"""
import gzip
import json
from pathlib import Path

from django.core import serializers
from django.core.management.base import BaseCommand, CommandError
from django.core.management.color import no_style
from django.db import connection, transaction

from core.management.datatransfer import FORMAT, digest, label, latest_migrations, transfer_models


class _DryRun(Exception):
    pass


class Command(BaseCommand):
    help = "Import a snapshot made by export_data, in a single verified transaction."

    def add_arguments(self, parser):
        parser.add_argument("snapshot", help="Path to a .json.gz file made by export_data")
        parser.add_argument("--replace", action="store_true", help="Delete existing application data first")
        parser.add_argument("--dry-run", action="store_true", help="Run the whole import, then roll it back")

    def handle(self, *args, snapshot, replace=False, dry_run=False, **options):
        data = self._read(Path(snapshot))
        models = transfer_models()
        self._check_migrations(data["migrations"])

        existing = {label(m): m._default_manager.count() for m in models}
        if any(existing.values()) and not replace:
            busy = ", ".join(f"{k} ({v})" for k, v in existing.items() if v)
            raise CommandError(f"Target database already has data: {busy}. Use --replace to overwrite it.")

        try:
            with transaction.atomic():
                if replace:
                    self._wipe(models)
                loaded = self._load(data["objects"])
                self._reset_sequences(models)
                self._verify(models, data["counts"], loaded)
                if dry_run:
                    raise _DryRun
        except _DryRun:
            self.stdout.write(self.style.WARNING("Dry run: every check passed, nothing was changed."))
            return

        for name, count in data["counts"].items():
            if count:
                self.stdout.write(f"  {name:<28} {count:>7}")
        self.stdout.write(self.style.SUCCESS(
            f"Imported {sum(data['counts'].values())} records from a {data['source']} snapshot made {data['created']}."))

    # ------------------------------------------------------------------ steps --

    def _read(self, path):
        if not path.is_file():
            raise CommandError(f"Snapshot not found: {path}")
        try:
            with gzip.open(path, "rt", encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError) as exc:
            raise CommandError(f"Not a readable snapshot: {exc}") from exc
        if data.get("format") != FORMAT:
            raise CommandError(f"Unsupported snapshot format: {data.get('format')!r} (expected {FORMAT})")
        if digest(data["objects"]) != data["sha256"]:
            raise CommandError("Snapshot checksum mismatch: the file is corrupt or was edited.")
        return data

    def _check_migrations(self, source):
        target = latest_migrations(connection)
        for app, name in source.items():
            if target.get(app, "") < name:
                raise CommandError(
                    f"This database is behind the snapshot for '{app}' (has {target.get(app) or 'nothing'}, "
                    f"snapshot needs {name}). Run `manage.py migrate` first.")
            if target.get(app) != name:
                self.stdout.write(self.style.WARNING(
                    f"'{app}' schema is newer here ({target[app]}) than in the snapshot ({name}); "
                    "new fields will take their defaults."))

    def _wipe(self, models):
        # Children before parents, so PROTECT foreign keys never block a delete.
        for model in reversed(models):
            deleted, _ = model._default_manager.all().delete()
            if deleted:
                self.stdout.write(f"  removed {deleted:>7} existing rows via {label(model)}")

    def _load(self, objects):
        loaded = {}
        for item in serializers.deserialize("python", objects, handle_forward_references=True):
            item.save()  # raw save: keeps primary keys and original timestamps
            name = label(type(item.object))
            loaded[name] = loaded.get(name, 0) + 1
        return loaded

    @staticmethod
    def _reset_sequences(models):
        statements = connection.ops.sequence_reset_sql(no_style(), models)
        with connection.cursor() as cursor:
            for sql in statements:
                cursor.execute(sql)

    @staticmethod
    def _verify(models, expected, loaded):
        problems = []
        for model in models:
            name = label(model)
            want = expected.get(name, 0)
            have = model._default_manager.count()
            if have != want or loaded.get(name, 0) != want:
                problems.append(f"{name}: expected {want}, loaded {loaded.get(name, 0)}, found {have}")
        if problems:
            raise CommandError("Verification failed, nothing was saved: " + "; ".join(problems))
