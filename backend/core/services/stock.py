"""Stock safety rules: what may be given to a patient, and from which batch.

Every route that takes stock out for a patient (the dispense screen, the decision
engine's what-if, the stock-movement API) goes through this module, so the rules
live in exactly one place:

* A batch is EXPIRED on and after its expiry date. It can never be dispensed.
* A QUARANTINED batch (recall, damage, query) can never be dispensed.
* Stock is allocated first-expiry-first-out across the remaining SAFE batches.
* A batch inside the policy's expiry window is SHORT-DATED: it can be dispensed,
  and is dispensed first, but the pharmacist is warned.

"Today" comes from core.services.clock, so demo mode (31 Dec 2024) is respected.
"""
from dataclasses import dataclass, field
from datetime import date

from django.db import transaction
from django.utils import timezone

from core.models import AuditEvent, Batch, Medicine, Policy, StockMovement
from core.services.clock import today

EXPIRED = "expired"
QUARANTINED = "quarantined"
SHORT_DATED = "short_dated"
SAFE = "safe"
EMPTY = "empty"

STATUS_LABELS = {
    EXPIRED: "Expired — do not dispense",
    QUARANTINED: "Quarantined — do not dispense",
    SHORT_DATED: "Short-dated — dispense first",
    SAFE: "Safe to dispense",
    EMPTY: "No stock left",
}


class StockRuleError(ValueError):
    """A dispense or movement that breaks a stock-safety rule. `code` goes to the API."""

    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def expiry_window_days():
    policy = Policy.objects.filter(id=1).first()
    return int(policy.expiry_window) if policy else 90


def batch_status(batch, as_of=None, window=None):
    """Safety status of one batch on a given day."""
    as_of = as_of or today()
    if batch.quarantined:
        return QUARANTINED
    if batch.expiry_date <= as_of:
        return EXPIRED
    if batch.quantity <= 0:
        return EMPTY
    window = expiry_window_days() if window is None else window
    if (batch.expiry_date - as_of).days <= window:
        return SHORT_DATED
    return SAFE


def batch_dict(batch, as_of=None, window=None):
    as_of = as_of or today()
    status = batch_status(batch, as_of, window)
    return {
        "id": str(batch.id), "medicineId": str(batch.medicine_id), "medicineName": batch.medicine.name,
        "strength": batch.medicine.strength or "", "batchNumber": batch.number,
        "supplierId": str(batch.supplier_id) if batch.supplier_id else None,
        "supplierName": batch.supplier.name if batch.supplier_id else None,
        "receivedAt": batch.received_at.isoformat(), "expiryDate": batch.expiry_date.isoformat(),
        "daysToExpiry": (batch.expiry_date - as_of).days, "quantity": batch.quantity,
        "unitCost": float(batch.unit_cost), "quarantined": batch.quarantined,
        "status": status, "statusLabel": STATUS_LABELS[status],
        "dispensable": status in (SAFE, SHORT_DATED),
    }


@dataclass
class Allocation:
    """Which batches a dispense would draw from, and what was held back and why."""
    medicine: Medicine
    requested: int
    as_of: date
    lines: list = field(default_factory=list)          # [(batch, units)]
    available: int = 0                                  # safe + short-dated units
    expired_units: int = 0
    quarantined_units: int = 0
    warnings: list = field(default_factory=list)

    @property
    def ok(self):
        return self.available >= self.requested

    def to_dict(self):
        window = expiry_window_days()
        return {
            "medicineId": str(self.medicine.id), "modelId": self.medicine.model_id,
            "medicineName": self.medicine.name, "asOf": self.as_of.isoformat(),
            "requested": self.requested, "available": self.available, "canDispense": self.ok,
            "expiredUnits": self.expired_units, "quarantinedUnits": self.quarantined_units,
            "lines": [{**batch_dict(b, self.as_of, window), "take": units} for b, units in self.lines],
            "warnings": self.warnings,
        }


def allocate(medicine, quantity, as_of=None, lock=False):
    """Plan a dispense first-expiry-first-out across batches that are safe to give."""
    as_of = as_of or today()
    qs = Batch.objects.filter(medicine=medicine, quantity__gt=0).select_related("medicine", "supplier")
    if lock:
        qs = qs.select_for_update(of=("self",))  # lock batches only; supplier is an optional join
    alloc = Allocation(medicine=medicine, requested=quantity, as_of=as_of)
    window = expiry_window_days()
    safe = []
    for b in qs.order_by("expiry_date", "id"):
        status = batch_status(b, as_of, window)
        if status == EXPIRED:
            alloc.expired_units += b.quantity
        elif status == QUARANTINED:
            alloc.quarantined_units += b.quantity
        else:
            safe.append(b)
    alloc.available = sum(b.quantity for b in safe)

    left = quantity
    for b in safe:
        if left <= 0:
            break
        take = min(left, b.quantity)
        alloc.lines.append((b, take))
        left -= take

    if alloc.expired_units:
        alloc.warnings.append(f"{alloc.expired_units:,} expired units were held back and must be disposed of.")
    if alloc.quarantined_units:
        alloc.warnings.append(f"{alloc.quarantined_units:,} quarantined units were held back.")
    for b, _ in alloc.lines:
        days = (b.expiry_date - as_of).days
        if days <= window:
            alloc.warnings.append(f"Batch {b.number} expires in {days} days — counsel the patient on the date.")
    return alloc


def refuse_reason(alloc):
    """Plain-language reason a dispense cannot go ahead."""
    held = alloc.expired_units + alloc.quarantined_units
    name = alloc.medicine.name
    if alloc.available == 0 and alloc.expired_units:
        return StockRuleError("expired_stock", f"All remaining {name} stock is expired ({alloc.expired_units:,} units). "
                                               "Nothing can be dispensed. Dispose of the expired batches and receive new stock.")
    if alloc.available == 0 and held:
        return StockRuleError("no_dispensable_stock", f"All remaining {name} stock is quarantined. Nothing can be dispensed.")
    if held:
        return StockRuleError("insufficient_stock", f"Only {alloc.available:,} units of {name} are safe to dispense. "
                                                    f"{held:,} more units are expired or quarantined and were held back.")
    return StockRuleError("insufficient_stock", f"Only {alloc.available:,} units of {name} are in stock.")


def dispense(medicine, quantity, user, reason="Dispensed to patient"):
    """Take `quantity` units out for a patient: safe batches only, earliest expiry first.

    Runs in its own transaction with the batches locked, so two pharmacists can never
    dispense the same units. Raises StockRuleError when safe stock is not enough;
    nothing is changed in that case.
    """
    if quantity < 1:
        raise StockRuleError("validation_error", "Quantity must be at least 1.")
    with transaction.atomic():
        alloc = allocate(medicine, quantity, lock=True)
        if not alloc.ok:
            raise refuse_reason(alloc)
        now = timezone.now()
        for b, take in alloc.lines:
            b.quantity -= take
            b.save(update_fields=["quantity"])
            StockMovement.objects.create(batch=b, kind="dispense", quantity=-take, occurred_at=now, actor=user,
                                         reason=(reason or "Dispensed to patient")[:300], fingerprint="dispense")
        AuditEvent.objects.create(actor=user, action="dispense", entity=f"medicine:{medicine.id}",
                                  details={"quantity": quantity, "batches": [b.number for b, _ in alloc.lines]})
    result = alloc.to_dict()
    result.update(dispensed=quantity, stockLeft=alloc.available - quantity)
    return result
