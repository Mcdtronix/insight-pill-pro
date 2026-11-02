"""Export every application record to a portable snapshot file.

    python manage.py export_data                       # -> pharminsight-data-<timestamp>.json.gz
    python manage.py export_data -o snapshot.json.gz

Works on SQLite or PostgreSQL. Load it elsewhere with `manage.py import_data`.
"""
import gzip
import json
from pathlib import Path

from django.core import serializers
from django.core.management.base import BaseCommand
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection
from django.utils import timezone

from core.management.datatransfer import FORMAT, digest, label, latest_migrations, transfer_models


class Command(BaseCommand):
    help = "Export users and all pharmacy data to a gzipped JSON snapshot."

    def add_arguments(self, parser):
        parser.add_argument("-o", "--output", help="Output file (default: pharminsight-data-<timestamp>.json.gz)")

    def handle(self, *args, output=None, **options):
        stamp = timezone.localtime().strftime("%Y%m%d-%H%M%S")
        path = Path(output or f"pharminsight-data-{stamp}.json.gz")

        objects, counts = [], {}
        for model in transfer_models():
            # Primary-key order keeps the file stable between runs.
            queryset = model._default_manager.order_by("pk")
            records = serializers.serialize("python", queryset, use_natural_foreign_keys=True)
            objects += records
            counts[label(model)] = len(records)

        snapshot = {
            "format": FORMAT,
            "created": timezone.now().isoformat(),
            "source": connection.vendor,
            "migrations": latest_migrations(connection),
            "counts": counts,
            "sha256": digest(objects),
            "objects": objects,
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            json.dump(snapshot, handle, cls=DjangoJSONEncoder)

        for name, count in counts.items():
            if count:
                self.stdout.write(f"  {name:<28} {count:>7}")
        size_kb = path.stat().st_size / 1024
        self.stdout.write(self.style.SUCCESS(f"Exported {sum(counts.values())} records to {path} ({size_kb:,.0f} KB)."))
