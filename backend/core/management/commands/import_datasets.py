"""Load the four project CSV datasets into the database.

Usage:
    python manage.py import_datasets            # first load
    python manage.py import_datasets --reset    # wipe simulated data, then reload

What is imported, and how:
- Medicines (20) and their full daily demand history, from demand_transactions.csv.
- Suppliers (12), completed deliveries and per-medicine supplier offers,
  from supplier_performance.csv. Deliveries that arrive after the "as of" date
  are skipped, so the system never sees the future.
- Current stock as at the "as of" date. The total per medicine is the closing
  stock in demand_transactions.csv on that date. It is split across three real
  batches from batch_expiry_dataset.csv that are still valid on that date (the
  20th, 60th and 95th percentile by expiry) in a 15% / 35% / 50% ratio, so the
  oldest stock is smallest.

reorder_risk_dataset.csv has no operational table. It stays in ml/data for
model evaluation. All imported rows are marked source="simulated".
"""
import hashlib
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import pandas as pd
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import (AuditEvent, Batch, CalendarDay, DailyDemand, DecisionSnapshot, ImportRun, Medicine,
                         Notification, Policy, PurchaseOrder, Recommendation, StockMovement, Supplier,
                         SupplierDelivery, SupplierOffer)

FILES = {
    "demand": "demand_transactions.csv",
    "supplier": "supplier_performance.csv",
    "batch": "batch_expiry_dataset.csv",
    "reorder": "reorder_risk_dataset.csv",
}
SOURCE = "simulated"
BATCH_SHARES = (0.15, 0.35, 0.50)
# Which still-valid batches to stock, as positions in expiry order. The very earliest
# batches in the file expire within days of the snapshot, which would flag every
# medicine; the 20th percentile gives a realistic mix of near and far expiries.
BATCH_POSITIONS = (0.20, 0.60, 0.95)
STRENGTH = re.compile(r"\s(\d[\d./]*\s?(?:mg|mcg|g|ml|IU)(?:/\s?ml)?)", re.IGNORECASE)


def split_name(full_name):
    """'Amoxicillin 500mg Capsules' -> ('Amoxicillin Capsules', '500mg')."""
    match = STRENGTH.search(full_name)
    if not match:
        return full_name.strip(), ""
    strength = match.group(1).replace(" ", "")
    name = (full_name[:match.start()] + full_name[match.end():]).strip()
    return re.sub(r"\s{2,}", " ", name), strength


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Command(BaseCommand):
    help = "Import the demand, supplier and batch CSV datasets as a demonstration pharmacy."

    def add_arguments(self, parser):
        parser.add_argument("--data-dir", default=str(settings.DATA_ROOT),
                            help="Folder holding the four CSV files (default: ml/data).")
        parser.add_argument("--as-of", default=settings.DSS_DEMO_DATE or "2024-12-31",
                            help="Stock snapshot date (default: DSS_DEMO_DATE or 2024-12-31).")
        parser.add_argument("--reset", action="store_true",
                            help="Delete existing operational data before importing.")

    def handle(self, *args, **opts):
        data_dir = Path(opts["data_dir"])
        paths = {k: data_dir / v for k, v in FILES.items()}
        missing = [str(p) for p in paths.values() if not p.exists()]
        if missing:
            raise CommandError("Missing dataset file(s):\n  " + "\n  ".join(missing))
        try:
            as_of = date.fromisoformat(opts["as_of"])
        except ValueError:
            raise CommandError("--as-of must be a date like 2024-12-31")

        if Medicine.objects.exists() and not opts["reset"]:
            raise CommandError("The database already holds medicines. Re-run with --reset to replace them.")

        demand = pd.read_csv(paths["demand"], parse_dates=["transaction_date"])
        supplier = pd.read_csv(paths["supplier"], parse_dates=["order_date", "promised_delivery_date", "actual_delivery_date"])
        batches = pd.read_csv(paths["batch"], parse_dates=["manufacture_date", "expiry_date"])
        self._validate(demand, supplier, batches, as_of)

        with transaction.atomic():
            if opts["reset"]:
                self._reset()
            meds = self._medicines(demand)
            n_demand = self._demand(demand, meds)
            sups = self._suppliers(supplier)
            n_deliv, n_future = self._deliveries(supplier, meds, sups, as_of)
            n_offers = self._offers(supplier, meds, sups, as_of)
            n_batches, stock = self._batches(demand, batches, supplier, meds, sups, as_of)
            Policy.objects.get_or_create(id=1)
            for key, path in paths.items():
                ImportRun.objects.update_or_create(digest=file_digest(path),
                                                   defaults={"name": path.name, "rows": sum(1 for _ in path.open()) - 1})
            AuditEvent.objects.create(actor=None, action="import_datasets", entity="dataset",
                                      details={"as_of": as_of.isoformat(), "medicines": len(meds),
                                               "demand_rows": n_demand, "deliveries": n_deliv,
                                               "batches": n_batches})

        out_of_stock = [m.name for m in meds.values() if stock[m.model_id] == 0]
        self.stdout.write(self.style.SUCCESS(f"Imported dataset as at {as_of}:"))
        self.stdout.write(f"  Medicines:          {len(meds)}")
        self.stdout.write(f"  Daily demand rows:  {n_demand}")
        self.stdout.write(f"  Suppliers:          {len(sups)}")
        self.stdout.write(f"  Supplier offers:    {n_offers}")
        self.stdout.write(f"  Deliveries:         {n_deliv} (skipped {n_future} arriving after {as_of})")
        self.stdout.write(f"  Stock batches:      {n_batches}")
        self.stdout.write(f"  Out of stock:       {', '.join(out_of_stock) or 'none'}")
        if not settings.DSS_DEMO_DATE:
            self.stdout.write(self.style.WARNING(
                f"DSS_DEMO_DATE is not set. Add DSS_DEMO_DATE={as_of} to backend/.env so 'today' matches this data."))

    # ------------------------------------------------------------------ checks
    def _validate(self, demand, supplier, batches, as_of):
        need = {
            "demand": (demand, ["transaction_date", "medicine_id", "medicine_name", "category", "quantity_dispensed",
                                "unit_price", "closing_stock", "stockout_flag", "season_period", "is_public_holiday"]),
            "supplier": (supplier, ["order_id", "supplier_id", "supplier_name", "supplier_type", "order_date",
                                    "promised_delivery_date", "actual_delivery_date", "order_quantity",
                                    "delivered_quantity", "quantity_fulfillment_rate", "unit_price",
                                    "market_avg_price", "price_variance_pct", "rejected_units", "defect_rate",
                                    "medicine_id"]),
            "batch": (batches, ["batch_id", "medicine_id", "manufacture_date", "expiry_date", "current_batch_stock"]),
        }
        for name, (frame, cols) in need.items():
            lost = [c for c in cols if c not in frame.columns]
            if lost:
                raise CommandError(f"{FILES[name]} is missing columns: {', '.join(lost)}")
            if frame[cols].isnull().any().any():
                raise CommandError(f"{FILES[name]} has empty cells in required columns.")
        if (demand.quantity_dispensed < 0).any() or (demand.closing_stock < 0).any():
            raise CommandError("demand_transactions.csv has negative quantities.")
        if not (demand.transaction_date == pd.Timestamp(as_of)).any():
            raise CommandError(f"No demand rows exist for the as-of date {as_of}.")

    def _reset(self):
        # Delete in dependency order. Users are kept.
        for model in (Notification, PurchaseOrder, Recommendation, DecisionSnapshot, StockMovement, Batch,
                      SupplierDelivery, SupplierOffer, DailyDemand, CalendarDay, Supplier, Medicine, ImportRun):
            model.objects.all().delete()
        self.stdout.write("Existing operational data removed.")

    # ----------------------------------------------------------------- loaders
    def _medicines(self, demand):
        meds = {}
        info = demand.drop_duplicates("medicine_id").sort_values("medicine_id")
        for row in info.itertuples():
            name, strength = split_name(row.medicine_name)
            meds[int(row.medicine_id)] = Medicine.objects.create(
                model_id=int(row.medicine_id), name=name, strength=strength, category=row.category)
        return meds

    def _demand(self, demand, meds):
        CalendarDay.objects.bulk_create(
            [CalendarDay(date=r.transaction_date.date(), holiday=bool(r.is_public_holiday), season=r.season_period)
             for r in demand.drop_duplicates("transaction_date").itertuples()],
            ignore_conflicts=True)
        rows = [DailyDemand(medicine=meds[int(r.medicine_id)], date=r.transaction_date.date(),
                            quantity=int(r.quantity_dispensed), stockout=bool(r.stockout_flag),
                            closing_stock=int(r.closing_stock),
                            complete=True, holiday=bool(r.is_public_holiday), season=r.season_period,
                            source=SOURCE)
                for r in demand.itertuples()]
        DailyDemand.objects.bulk_create(rows, batch_size=1000)
        return len(rows)

    def _suppliers(self, supplier):
        sups = {}
        for row in supplier.drop_duplicates("supplier_id").sort_values("supplier_id").itertuples():
            sups[int(row.supplier_id)] = Supplier.objects.create(external_id=int(row.supplier_id),
                                                                 name=row.supplier_name, status="active")
        return sups

    def _deliveries(self, supplier, meds, sups, as_of):
        done = supplier[supplier.actual_delivery_date <= pd.Timestamp(as_of)]
        rows = [SupplierDelivery(
            source_key=f"sim-order-{int(r.order_id)}", supplier=sups[int(r.supplier_id)],
            medicine=meds[int(r.medicine_id)], order_date=r.order_date.date(),
            promised_date=r.promised_delivery_date.date(), actual_date=r.actual_delivery_date.date(),
            ordered=int(r.order_quantity), delivered=int(r.delivered_quantity), rejected=int(r.rejected_units),
            unit_price=Decimal(str(r.unit_price)), market_price=Decimal(str(r.market_avg_price)),
            fulfillment_rate=float(r.quantity_fulfillment_rate), price_variance_pct=float(r.price_variance_pct),
            defect_rate=float(r.defect_rate), source=SOURCE)
            for r in done.itertuples()]
        SupplierDelivery.objects.bulk_create(rows, batch_size=1000)
        return len(rows), len(supplier) - len(done)

    def _offers(self, supplier, meds, sups, as_of):
        """One offer per medicine-supplier pair, priced and timed from that pair's delivered orders."""
        done = supplier[supplier.actual_delivery_date <= pd.Timestamp(as_of)].copy()
        done["lead_days"] = (done.actual_delivery_date - done.order_date).dt.days
        count = 0
        for (mid, sid), g in done.groupby(["medicine_id", "supplier_id"]):
            SupplierOffer.objects.create(
                medicine=meds[int(mid)], supplier=sups[int(sid)],
                unit_cost=Decimal(str(round(g.unit_price.mean(), 4))),
                lead_time_days=max(1, int(round(g.lead_days.mean()))),
                lead_time_std=round(float(g.lead_days.std(ddof=1)) if len(g) > 1 else 0.0, 2))
            count += 1
        return count

    def _batches(self, demand, batches, supplier, meds, sups, as_of):
        ts = pd.Timestamp(as_of)
        snapshot = demand[demand.transaction_date == ts].set_index("medicine_id")
        main_supplier = supplier.groupby("medicine_id").supplier_id.agg(lambda s: s.value_counts().idxmax())
        valid = batches[(batches.manufacture_date <= ts) & (batches.expiry_date > ts)]
        created, stock = 0, {}
        for mid, med in meds.items():
            total = int(snapshot.loc[mid, "closing_stock"])
            unit_cost = Decimal(str(snapshot.loc[mid, "unit_price"]))
            stock[mid] = total
            pool = valid[valid.medicine_id == mid].sort_values(["expiry_date", "batch_id"]).reset_index(drop=True)
            if pool.empty:
                raise CommandError(f"No batch in {FILES['batch']} is valid on {as_of} for {med.name}.")
            last = len(pool) - 1
            picks = pool.iloc[sorted({int(q * last) for q in BATCH_POSITIONS})]
            shares = BATCH_SHARES[-len(picks):]
            shares = [s / sum(shares) for s in shares]
            quantities = [int(total * s) for s in shares]
            quantities[-1] += total - sum(quantities)
            sup = sups.get(int(main_supplier.get(mid, 0)))
            for (row, qty) in zip(picks.itertuples(), quantities):
                Batch.objects.create(
                    medicine=med, supplier=sup, number=f"B{int(row.batch_id):05d}",
                    received_at=row.manufacture_date.date(), expiry_date=row.expiry_date.date(),
                    unit_cost=unit_cost, quantity=qty, source=SOURCE)
                created += 1
        return created, stock
