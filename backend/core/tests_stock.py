"""Stock safety and record management.

Answers, as tests, the questions a pharmacist or examiner will ask:
  * Can an expired (or quarantined) product ever be given to a patient?   -> never
  * How is expiry recorded?          -> per batch, validated when stock is received
  * Who may add users, medicines, suppliers and batches?  -> by role, audited
"""
import uuid
from datetime import date, timedelta

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditEvent, Batch, Medicine, StockMovement, Supplier, SupplierOffer
from core.services import stock

TODAY = date(2024, 12, 31)


def day(offset):
    return (TODAY + timedelta(days=offset)).isoformat()


@override_settings(DSS_DEMO_DATE=TODAY.isoformat())
class StockSafetyBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(username="ad@t.test", email="ad@t.test", password="x", role="admin")
        cls.manager = User.objects.create_user(username="mg@t.test", email="mg@t.test", password="x", role="manager")
        cls.pharmacist = User.objects.create_user(username="ph@t.test", email="ph@t.test", password="x", role="pharmacist")
        cls.staff = User.objects.create_user(username="st@t.test", email="st@t.test", password="x", role="staff")
        cls.supplier = Supplier.objects.create(name="Cipla Zimbabwe")
        cls.med = Medicine.objects.create(name="Amoxicillin", strength="500mg", category="Antibiotic")
        mk = lambda number, expiry, qty, **kw: Batch.objects.create(  # noqa: E731
            medicine=cls.med, supplier=cls.supplier, number=number, received_at=date(2024, 1, 1),
            expiry_date=date.fromisoformat(expiry), unit_cost=1, quantity=qty, **kw)
        cls.expired = mk("EXP-1", day(-10), 50)            # expired 10 days ago
        cls.today_expiry = mk("EXP-0", day(0), 20)         # expires today -> already unusable
        cls.short = mk("SHORT-1", day(30), 40)             # inside the 90-day window
        cls.long = mk("LONG-1", day(400), 100)
        cls.quarantined = mk("QUA-1", day(200), 25, quarantined=True)

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client


class ExpiredStockIsNeverDispensedTests(StockSafetyBase):
    def test_batch_status_rules(self):
        self.assertEqual(stock.batch_status(self.expired), stock.EXPIRED)
        self.assertEqual(stock.batch_status(self.today_expiry), stock.EXPIRED)
        self.assertEqual(stock.batch_status(self.short), stock.SHORT_DATED)
        self.assertEqual(stock.batch_status(self.long), stock.SAFE)
        self.assertEqual(stock.batch_status(self.quarantined), stock.QUARANTINED)

    def test_fefo_skips_expired_and_quarantined_batches(self):
        alloc = stock.allocate(self.med, 60)
        self.assertEqual([(b.number, n) for b, n in alloc.lines], [("SHORT-1", 40), ("LONG-1", 20)])
        self.assertEqual((alloc.available, alloc.expired_units, alloc.quarantined_units), (140, 70, 25))

    def test_dispense_never_touches_expired_stock(self):
        response = self.client_for(self.pharmacist).post(
            "/api/dispense/", {"medicineId": self.med.id, "quantity": 45}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.expired.refresh_from_db(); self.today_expiry.refresh_from_db(); self.quarantined.refresh_from_db()
        self.assertEqual((self.expired.quantity, self.today_expiry.quantity, self.quarantined.quantity), (50, 20, 25))
        self.assertEqual(Batch.objects.get(number="SHORT-1").quantity, 0)
        self.assertEqual(Batch.objects.get(number="LONG-1").quantity, 95)
        self.assertTrue(any("expired units were held back" in w for w in response.json()["warnings"]))

    def test_request_larger_than_safe_stock_is_refused_and_changes_nothing(self):
        response = self.client_for(self.pharmacist).post(
            "/api/dispense/", {"medicineId": self.med.id, "quantity": 200}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertIn("safe to dispense", response.json()["detail"])
        self.assertEqual(Batch.objects.get(number="LONG-1").quantity, 100)
        self.assertFalse(StockMovement.objects.filter(kind="dispense").exists())

    def test_only_expired_stock_left_gives_a_clear_refusal(self):
        Batch.objects.filter(number__in=["SHORT-1", "LONG-1"]).update(quantity=0)
        response = self.client_for(self.pharmacist).post(
            "/api/dispense/", {"medicineId": self.med.id, "quantity": 1}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "expired_stock")
        self.assertIn("expired", response.json()["detail"])

    def test_engine_what_if_dispense_follows_the_same_rule(self):
        self.med.model_id = 999
        self.med.save()
        Batch.objects.filter(number__in=["SHORT-1", "LONG-1"]).update(quantity=0)
        response = self.client_for(self.pharmacist).post(
            "/api/decisions/dispense/", {"medicineId": 999, "quantity": 5}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "expired_stock")

    def test_preview_shows_the_plan_without_changing_stock(self):
        response = self.client_for(self.staff).post(
            "/api/dispense/preview/", {"medicineId": self.med.id, "quantity": 10}, format="json")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["canDispense"])
        self.assertEqual(body["lines"][0]["batchNumber"], "SHORT-1")
        self.assertEqual(body["lines"][0]["status"], "short_dated")
        self.assertEqual(Batch.objects.get(number="SHORT-1").quantity, 40)

    def test_staff_can_check_but_not_dispense(self):
        response = self.client_for(self.staff).post(
            "/api/dispense/", {"medicineId": self.med.id, "quantity": 1}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_batch_lookup_answers_is_this_pack_safe(self):
        body = self.client_for(self.staff).get("/api/batches/lookup/", {"number": "exp-1"}).json()
        self.assertEqual(body["matches"][0]["status"], "expired")
        self.assertFalse(body["matches"][0]["dispensable"])
        self.assertEqual(self.client_for(self.staff).get("/api/batches/lookup/", {"number": "nope"}).json()["matches"], [])


class StockMovementRulesTests(StockSafetyBase):
    def move(self, batch, kind, quantity):
        return self.client_for(self.pharmacist).post("/api/inventory/movements/", {
            "batchId": batch.id, "kind": kind, "quantity": quantity, "reason": "test", "key": str(uuid.uuid4())},
            format="json")

    def test_cannot_dispense_from_an_expired_or_quarantined_batch(self):
        self.assertEqual(self.move(self.expired, "dispense", 1).json()["code"], "expired_batch")
        self.assertEqual(self.move(self.quarantined, "dispense", 1).json()["code"], "quarantined_batch")

    def test_a_batch_can_never_go_below_zero(self):
        # Before the fix this was checked against the medicine's TOTAL stock.
        response = self.move(self.short, "dispense", 41)
        self.assertEqual(response.status_code, 409)
        self.short.refresh_from_db()
        self.assertEqual(self.short.quantity, 40)

    def test_expired_stock_can_be_disposed_of(self):
        response = self.client_for(self.pharmacist).post(
            f"/api/batches/{self.expired.id}/dispose/", {"reason": "Expired"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.expired.refresh_from_db()
        self.assertEqual(self.expired.quantity, 0)
        self.assertTrue(StockMovement.objects.filter(batch=self.expired, kind="disposal", quantity=-50).exists())


class ReceivingStockWithExpiryTests(StockSafetyBase):
    def receive(self, **overrides):
        body = {"medicineId": self.med.id, "supplierId": self.supplier.id, "batchNumber": "new-77",
                "expiryDate": day(365), "quantity": 120, "unitCost": "0.85"}
        body.update(overrides)
        return self.client_for(self.pharmacist).post("/api/batches/", body, format="json")

    def test_receiving_a_batch_records_expiry_movement_and_audit(self):
        response = self.receive()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body["batchNumber"], body["expiryDate"], body["receivedAt"]), ("NEW-77", day(365), day(0)))
        self.assertEqual(body["status"], "safe")
        batch = Batch.objects.get(number="NEW-77")
        self.assertTrue(StockMovement.objects.filter(batch=batch, kind="receipt", quantity=120).exists())
        self.assertTrue(AuditEvent.objects.filter(action="batch.receive", actor=self.pharmacist).exists())

    def test_already_expired_stock_cannot_be_received(self):
        response = self.receive(expiryDate=day(0))
        self.assertEqual(response.status_code, 400)
        self.assertIn("already expired", response.json()["detail"])

    def test_expiry_must_follow_receipt_and_receipt_cannot_be_future(self):
        self.assertEqual(self.receive(receivedAt=day(1)).status_code, 400)
        self.assertEqual(self.receive(receivedAt=day(-5), expiryDate=day(-6)).status_code, 400)

    def test_duplicate_batch_number_is_rejected(self):
        self.assertEqual(self.receive(batchNumber="long-1").status_code, 400)

    def test_staff_cannot_receive_stock(self):
        client = self.client_for(self.staff)
        self.assertEqual(client.post("/api/batches/", {}, format="json").status_code, 403)

    def test_quarantine_and_expiry_correction_need_a_reason_and_are_audited(self):
        client = self.client_for(self.pharmacist)
        self.assertEqual(client.patch(f"/api/batches/{self.long.id}/", {"quarantined": True}, format="json").status_code, 400)
        response = client.patch(f"/api/batches/{self.long.id}/",
                                {"quarantined": True, "expiryDate": day(300), "reason": "Recall notice 12/24"},
                                format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.json()["status"], response.json()["expiryDate"]), ("quarantined", day(300)))
        self.assertTrue(AuditEvent.objects.filter(action="batch.update", entity=f"batch:{self.long.id}").exists())


class CatalogueManagementTests(StockSafetyBase):
    def test_manager_adds_medicine_supplier_and_offer(self):
        client = self.client_for(self.manager)
        med = client.post("/api/manage/medicines/", {"name": "Metformin", "strength": "500mg",
                                                     "category": "Antidiabetic", "form": "Tablet"}, format="json")
        self.assertEqual(med.status_code, 201, med.content)
        self.assertFalse(med.json()["forecastReady"])
        sup = client.post("/api/manage/suppliers/", {"name": "Varichem", "contactEmail": "orders@varichem.co.zw"},
                          format="json")
        self.assertEqual(sup.status_code, 201, sup.content)
        offer = {"medicineId": med.json()["id"], "supplierId": sup.json()["id"], "unitCost": "0.12", "leadTimeDays": 10}
        self.assertEqual(client.post("/api/manage/offers/", offer, format="json").status_code, 201)
        self.assertEqual(client.post("/api/manage/offers/", offer, format="json").status_code, 400)  # duplicate

    def test_new_medicine_can_be_stocked_and_dispensed_without_a_forecast_model(self):
        new = Medicine.objects.create(name="Metformin", strength="500mg", category="Antidiabetic")
        client = self.client_for(self.pharmacist)
        self.assertEqual(client.post("/api/batches/", {"medicineId": new.id, "batchNumber": "MF1", "expiryDate": day(500),
                                                       "quantity": 30, "unitCost": "0.1"}, format="json").status_code, 201)
        response = client.post("/api/dispense/", {"medicineId": new.id, "quantity": 10}, format="json")
        self.assertEqual(response.status_code, 201)
        row = next(r for r in client.get("/api/manage/medicines/").json() if r["name"] == "Metformin")
        self.assertEqual((row["onHand"], row["dispensable"]), (20, 20))

    def test_medicine_list_separates_safe_expired_and_quarantined_units(self):
        row = next(r for r in self.client_for(self.staff).get("/api/manage/medicines/").json() if r["name"] == "Amoxicillin")
        self.assertEqual((row["onHand"], row["dispensable"], row["shortDatedUnits"], row["expiredUnits"],
                          row["quarantinedUnits"]), (235, 140, 40, 70, 25))
        self.assertEqual(row["earliestSafeExpiry"], day(30))

    def test_pharmacist_cannot_edit_catalogue_or_suppliers(self):
        client = self.client_for(self.pharmacist)
        self.assertEqual(client.post("/api/manage/medicines/", {"name": "X", "category": "Y"}, format="json").status_code, 403)
        self.assertEqual(client.post("/api/manage/suppliers/", {"name": "X"}, format="json").status_code, 403)
        self.assertEqual(client.get("/api/manage/suppliers/").status_code, 200)

    def test_editing_an_offer_or_expiry_refreshes_cached_plans(self):
        from core.services import insights
        offer = SupplierOffer.objects.create(medicine=self.med, supplier=self.supplier, unit_cost=1, lead_time_days=7)
        before = insights._signature(TODAY)
        self.client_for(self.manager).patch(f"/api/manage/offers/{offer.id}/", {"unitCost": "2.5"}, format="json")
        self.assertNotEqual(insights._signature(TODAY), before)
        before = insights._signature(TODAY)
        Batch.objects.filter(pk=self.long.pk).update(expiry_date=date(2026, 1, 1))
        self.assertNotEqual(insights._signature(TODAY), before)


class UserManagementTests(StockSafetyBase):
    def setUp(self):
        # The login rate limit (10/min) is counted in the cache, which outlives a test.
        # Start each sign-in test with a clean count so test order and speed never matter.
        from django.core.cache import cache
        cache.clear()

    def test_admin_adds_a_user_who_can_then_sign_in(self):
        client = self.client_for(self.admin)
        response = client.post("/api/manage/users/", {"email": "Tendai@PGH.co.zw", "firstName": "Tendai",
                                                      "lastName": "Moyo", "role": "pharmacist",
                                                      "password": "Harare#Pharm2024"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["email"], "tendai@pgh.co.zw")
        login = APIClient().post("/api/auth/login/", {"email": "tendai@pgh.co.zw", "password": "Harare#Pharm2024"},
                                 format="json")
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["user"]["role"], "pharmacist")

    def test_weak_password_and_duplicate_email_are_rejected(self):
        client = self.client_for(self.admin)
        weak = client.post("/api/manage/users/", {"email": "a@b.zw", "firstName": "A", "role": "staff",
                                                  "password": "password"}, format="json")
        self.assertEqual(weak.status_code, 400)
        dup = client.post("/api/manage/users/", {"email": "ph@t.test", "firstName": "A", "role": "staff",
                                                 "password": "Harare#Pharm2024"}, format="json")
        self.assertEqual(dup.status_code, 400)

    def test_only_admins_manage_users(self):
        self.assertEqual(self.client_for(self.manager).get("/api/manage/users/").status_code, 403)

    def test_deactivated_user_cannot_sign_in(self):
        self.client_for(self.admin).patch(f"/api/manage/users/{self.staff.id}/", {"active": False}, format="json")
        login = APIClient().post("/api/auth/login/", {"email": "st@t.test", "password": "x"}, format="json")
        # Refused as a bad sign-in, not merely rate-limited (429 would hide the real result).
        self.assertIn(login.status_code, (401, 403), login.content)

    def test_admin_cannot_lock_themselves_out_or_remove_the_last_admin(self):
        client = self.client_for(self.admin)
        self.assertEqual(client.patch(f"/api/manage/users/{self.admin.id}/", {"active": False}, format="json").status_code, 400)
        self.assertEqual(client.patch(f"/api/manage/users/{self.admin.id}/", {"role": "staff"}, format="json").status_code, 400)
        self.assertEqual(client.patch(f"/api/manage/users/{self.admin.id}/", {"firstName": "Rudo"}, format="json").status_code, 200)
        other = User.objects.create_user(username="ad2@t.test", email="ad2@t.test", password="x", role="admin")
        self.assertEqual(client.patch(f"/api/manage/users/{other.id}/", {"role": "manager"}, format="json").status_code, 200)
