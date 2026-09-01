"""Saltbread backend API tests - covers auth, products, orders, expenses, dashboard."""
import os
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://home-baker-dashboard.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "baker@saltbread.com"
DEMO_PASSWORD = "baker123"
CASHIER_EMAIL = "kasir@saltbread.com"
CASHIER_PASSWORD = "kasir123"
ADMIN_EMAIL = "admin@saltbread.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data and data["user"]["email"] == DEMO_EMAIL
    return data["access_token"]


@pytest.fixture(scope="session")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _login_headers(email, password, expected_role):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"run backend/scripts/seed_dummy.py to create {email}"
    assert r.json()["user"]["role"] == expected_role
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_h():
    """Seeded by backend/scripts/seed_dummy.py."""
    return _login_headers(ADMIN_EMAIL, ADMIN_PASSWORD, "admin")


@pytest.fixture(scope="session")
def cashier_h():
    """Seeded by backend/scripts/seed_dummy.py."""
    r = requests.post(f"{API}/auth/login",
                      json={"email": CASHIER_EMAIL, "password": CASHIER_PASSWORD}, timeout=15)
    assert r.status_code == 200, "run backend/scripts/seed_dummy.py to create the cashier"
    assert r.json()["user"]["role"] == "cashier"
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


# ---------- Auth ----------
class TestAuth:
    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me(self, h):
        r = requests.get(f"{API}/auth/me", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == DEMO_EMAIL

    def test_me_unauthorized(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_owner_has_role(self, h):
        assert requests.get(f"{API}/auth/me", headers=h, timeout=15).json()["role"] == "owner"

    def test_public_registration_is_gone(self):
        """Accounts must only exist because an owner created them."""
        r = requests.post(f"{API}/auth/register",
                          json={"email": "intruder@x.com", "password": "hunter2", "name": "X"},
                          timeout=15)
        assert r.status_code == 404


# ---------- Roles ----------
# One table describing who may read what, so a permission change is a one-line
# edit here rather than a hunt through separate tests.
OWNER_ONLY = ["/dashboard/summary", "/expenses", "/expenses/categories", "/users"]
STAFF_ONLY = ["/orders", "/orders/production-summary?date=2026-01-01"]
EVERYONE = ["/products", "/stock", "/sales"]


class TestRoles:
    @pytest.mark.parametrize("path", OWNER_ONLY)
    def test_money_and_admin_are_owner_only(self, h, admin_h, cashier_h, path):
        assert requests.get(f"{API}{path}", headers=h, timeout=15).status_code == 200
        assert requests.get(f"{API}{path}", headers=admin_h, timeout=15).status_code == 403,             f"{path} leaked to an admin"
        assert requests.get(f"{API}{path}", headers=cashier_h, timeout=15).status_code == 403,             f"{path} leaked to a cashier"

    @pytest.mark.parametrize("path", STAFF_ONLY)
    def test_preorders_are_staff_only(self, h, admin_h, cashier_h, path):
        """Admins run the preorder book; the counter never touches it."""
        assert requests.get(f"{API}{path}", headers=h, timeout=15).status_code == 200
        assert requests.get(f"{API}{path}", headers=admin_h, timeout=15).status_code == 200
        assert requests.get(f"{API}{path}", headers=cashier_h, timeout=15).status_code == 403,             f"{path} leaked to a cashier"

    @pytest.mark.parametrize("path", EVERYONE)
    def test_counter_operations_open_to_all_roles(self, h, admin_h, cashier_h, path):
        for headers, who in ((h, "owner"), (admin_h, "admin"), (cashier_h, "cashier")):
            assert requests.get(f"{API}{path}", headers=headers, timeout=15).status_code == 200,                 f"{path} denied to {who}"

    def test_only_the_owner_writes_the_catalogue(self, admin_h, cashier_h):
        for headers in (admin_h, cashier_h):
            r = requests.post(f"{API}/products", headers=headers,
                              json={"name": "Rogue", "price": 1}, timeout=15)
            assert r.status_code == 403

    def test_only_the_owner_creates_accounts(self, admin_h, cashier_h):
        for headers in (admin_h, cashier_h):
            r = requests.post(f"{API}/users", headers=headers,
                              json={"email": "x@y.com", "password": "secret1", "name": "X"}, timeout=15)
            assert r.status_code == 403

    def test_admin_can_run_the_preorder_book(self, admin_h):
        prods = requests.get(f"{API}/products", headers=admin_h, timeout=15).json()
        plain = next(p for p in prods if p["name"] == "Plain")
        created = requests.post(f"{API}/orders", headers=admin_h, timeout=15, json={
            "customer_name": "TEST_AdminOrder",
            "delivery_date": (date.today() + timedelta(days=3652)).isoformat(),
            "items": [{"product_id": plain["id"], "quantity": 2}],
        })
        assert created.status_code == 201, created.text
        oid = created.json()["id"]
        assert requests.patch(f"{API}/orders/{oid}/status", headers=admin_h,
                              json={"status": "in_progress"}, timeout=15).status_code == 200
        # deleting is destructive, so it stays with the owner
        assert requests.delete(f"{API}/orders/{oid}", headers=admin_h, timeout=15).status_code == 403

    def test_owner_can_create_and_remove_staff(self, h):
        email = "temp-staff@saltbread.com"
        created = requests.post(f"{API}/users", headers=h, timeout=15,
                                json={"email": email, "password": "secret1",
                                      "name": "Temp", "role": "admin"})
        assert created.status_code == 201, created.text
        uid = created.json()["id"]
        assert created.json()["role"] == "admin"

        dupe = requests.post(f"{API}/users", headers=h, timeout=15,
                             json={"email": email, "password": "secret1", "name": "Temp"})
        assert dupe.status_code == 409

        assert requests.delete(f"{API}/users/{uid}", headers=h, timeout=15).status_code == 200

    def test_owner_can_create_and_remove_staff(self, h):
        email = "temp-staff@saltbread.com"
        requests.delete(f"{API}/users/none", headers=h, timeout=15)  # noop, keeps test isolated
        created = requests.post(f"{API}/users", headers=h, timeout=15,
                                json={"email": email, "password": "secret1",
                                      "name": "Temp", "role": "cashier"})
        assert created.status_code == 201, created.text
        uid = created.json()["id"]
        assert created.json()["role"] == "cashier"

        dupe = requests.post(f"{API}/users", headers=h, timeout=15,
                             json={"email": email, "password": "secret1", "name": "Temp"})
        assert dupe.status_code == 409

        assert requests.delete(f"{API}/users/{uid}", headers=h, timeout=15).status_code == 200

    def test_owner_cannot_delete_self(self, h):
        me = requests.get(f"{API}/auth/me", headers=h, timeout=15).json()
        r = requests.delete(f"{API}/users/{me['id']}", headers=h, timeout=15)
        assert r.status_code == 400


# ---------- Products ----------
class TestProducts:
    def test_seeded_variants(self, h):
        r = requests.get(f"{API}/products", headers=h, timeout=15)
        assert r.status_code == 200
        items = r.json()
        names = {p["name"] for p in items}
        expected = {"Plain", "Choco", "Cream Cheese", "Egg Mayo", "Umami Abon", "Kaya Butter", "Triple Choco"}
        assert expected.issubset(names), f"Missing: {expected - names}"
        assert len(items) >= 7

    def test_product_crud(self, h):
        # Create
        r = requests.post(f"{API}/products", headers=h,
                          json={"name": "TEST_Variant", "price": 12345.0}, timeout=15)
        assert r.status_code == 201
        pid = r.json()["id"]
        assert r.json()["price"] == 12345.0

        # Update
        r = requests.patch(f"{API}/products/{pid}", headers=h, json={"price": 9999.0}, timeout=15)
        assert r.status_code == 200
        assert r.json()["price"] == 9999.0

        # Delete
        r = requests.delete(f"{API}/products/{pid}", headers=h, timeout=15)
        assert r.status_code == 200

        # Verify deletion via update 404
        r = requests.patch(f"{API}/products/{pid}", headers=h, json={"price": 1.0}, timeout=15)
        assert r.status_code == 404


# ---------- Orders ----------
class TestOrders:
    order_id = None

    def test_create_order(self, h):
        r = requests.get(f"{API}/products", headers=h, timeout=15)
        prods = r.json()
        plain = next(p for p in prods if p["name"] == "Plain")
        choco = next(p for p in prods if p["name"] == "Choco")
        payload = {
            "customer_name": "TEST_Customer",
            "customer_phone": "0812",
            "delivery_date": date.today().isoformat(),
            "items": [
                {"product_id": plain["id"], "quantity": 2},
                {"product_id": choco["id"], "quantity": 1},
            ],
            "notes": "test",
        }
        r = requests.post(f"{API}/orders", headers=h, json=payload, timeout=15)
        assert r.status_code == 201, r.text
        data = r.json()
        expected_total = plain["price"] * 2 + choco["price"] * 1
        assert data["total"] == expected_total
        assert len(data["items"]) == 2
        assert data["items"][0]["subtotal"] == plain["price"] * 2
        assert data["status"] == "pending"
        TestOrders.order_id = data["id"]

    def test_list_orders_and_filter(self, h):
        r = requests.get(f"{API}/orders", headers=h, timeout=15)
        assert r.status_code == 200
        assert any(o["id"] == TestOrders.order_id for o in r.json())

        r = requests.get(f"{API}/orders?status_filter=pending", headers=h, timeout=15)
        assert r.status_code == 200
        assert all(o["status"] == "pending" for o in r.json())

    def test_get_order(self, h):
        r = requests.get(f"{API}/orders/{TestOrders.order_id}", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == TestOrders.order_id

    def test_status_flow(self, h):
        for s in ["in_progress", "completed"]:
            r = requests.patch(f"{API}/orders/{TestOrders.order_id}/status",
                               headers=h, json={"status": s}, timeout=15)
            assert r.status_code == 200
            assert r.json()["status"] == s
        # completed_at set
        r = requests.get(f"{API}/orders/{TestOrders.order_id}", headers=h, timeout=15)
        assert r.json()["completed_at"] is not None

    def test_cleanup(self, h):
        if TestOrders.order_id:
            requests.delete(f"{API}/orders/{TestOrders.order_id}", headers=h, timeout=15)


# ---------- Product availability ----------
class TestProductAvailability:
    def test_inactive_is_hidden_and_unorderable(self, h):
        """A deactivated variant must vanish from order forms AND be refused
        server-side, since the form is not the guarantee."""
        created = requests.post(f"{API}/products", headers=h, timeout=15,
                                json={"name": "TEST_Retired", "price": 5000.0})
        assert created.status_code == 201
        pid = created.json()["id"]
        try:
            listed = lambda **kw: [p["id"] for p in requests.get(
                f"{API}/products", headers=h, params=kw, timeout=15).json()]
            assert pid in listed(), "new product should be sellable"

            r = requests.patch(f"{API}/products/{pid}", headers=h,
                               json={"active": False}, timeout=15)
            assert r.status_code == 200 and r.json()["active"] is False

            assert pid not in listed(), "inactive product still offered for sale"
            assert pid in listed(include_inactive="true"), "management cannot reactivate it"

            order = requests.post(f"{API}/orders", headers=h, timeout=15, json={
                "customer_name": "TEST_Availability",
                "delivery_date": date.today().isoformat(),
                "items": [{"product_id": pid, "quantity": 1}],
            })
            assert order.status_code == 400, "inactive product was accepted into an order"
        finally:
            requests.delete(f"{API}/products/{pid}", headers=h, timeout=15)


# ---------- Production ----------
class TestProductionSummary:
    def test_rejects_bad_date(self, h):
        r = requests.get(f"{API}/orders/production-summary",
                         params={"date": "31-08-2026"}, headers=h, timeout=15)
        assert r.status_code == 400

    def test_totals_match_the_orders_it_returns(self, h):
        """The bake sheet must equal the sum of the orders behind it."""
        today = date.today().isoformat()
        r = requests.get(f"{API}/orders/production-summary",
                         params={"date": today}, headers=h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["date"] == today
        assert d["order_count"] == len(d["orders"])

        expected = {}
        for o in d["orders"]:
            assert o["delivery_date"] == today
            assert o["status"] != "cancelled", "cancelled orders must not be baked"
            for item in o["items"]:
                expected[item["product_name"]] = expected.get(item["product_name"], 0) + item["quantity"]

        assert {v["product_name"]: v["quantity"] for v in d["variants"]} == expected
        assert d["total_pieces"] == sum(expected.values())
        # sorted most-baked first so the sheet reads top-down
        quantities = [v["quantity"] for v in d["variants"]]
        assert quantities == sorted(quantities, reverse=True)

    def test_cancelling_removes_it_from_the_bake_sheet(self, h):
        # A far-future date no other test (or seeded data) writes to, so the
        # suite's parallel workers can't move these totals underneath us.
        day = (date.today() + timedelta(days=3650)).isoformat()
        prods = requests.get(f"{API}/products", headers=h, timeout=15).json()
        plain = next(p for p in prods if p["name"] == "Plain")

        summary = lambda: requests.get(f"{API}/orders/production-summary",
                                       params={"date": day}, headers=h, timeout=15).json()
        assert summary()["total_pieces"] == 0

        created = requests.post(f"{API}/orders", headers=h, timeout=15, json={
            "customer_name": "TEST_Cancelled",
            "delivery_date": day,
            "items": [{"product_id": plain["id"], "quantity": 7}],
        })
        assert created.status_code == 201
        oid = created.json()["id"]
        try:
            assert summary()["total_pieces"] == 7

            requests.patch(f"{API}/orders/{oid}/status", headers=h,
                           json={"status": "cancelled"}, timeout=15)
            assert summary()["total_pieces"] == 0, "cancelled order still on the bake sheet"
        finally:
            requests.delete(f"{API}/orders/{oid}", headers=h, timeout=15)


# ---------- Sales (counter / POS) ----------
class TestSales:
    def _plain(self, h):
        prods = requests.get(f"{API}/products", headers=h, timeout=15).json()
        return next(p for p in prods if p["name"] == "Plain")

    def test_cash_sale_computes_totals_and_change(self, h):
        plain = self._plain(h)
        r = requests.post(f"{API}/sales", headers=h, timeout=15, json={
            "items": [{"product_id": plain["id"], "quantity": 3}],
            "payment_method": "cash",
            "amount_tendered": 50000,
        })
        assert r.status_code == 201, r.text
        d = r.json()
        try:
            assert d["subtotal"] == plain["price"] * 3
            assert d["total"] == d["subtotal"]
            assert d["change"] == 50000 - d["total"]
            assert d["payment_method"] == "cash"
            assert d["voided"] is False
            # priced server-side from the catalogue, not from the client
            assert d["items"][0]["unit_price"] == plain["price"]
        finally:
            requests.post(f"{API}/sales/{d['id']}/void", headers=h, timeout=15)

    def test_receipt_numbers_are_unique_and_sequential(self, h):
        """A UUID is unusable when a customer phones about a receipt, and
        counting documents would race across two counter devices."""
        plain = self._plain(h)
        made = []
        try:
            for _ in range(3):
                r = requests.post(f"{API}/sales", headers=h, timeout=15, json={
                    "items": [{"product_id": plain["id"], "quantity": 1}],
                    "payment_method": "qris",
                })
                assert r.status_code == 201
                made.append(r.json())
            nums = [m["receipt_no"] for m in made]
            assert len(set(nums)) == 3, f"duplicate receipt numbers: {nums}"
            seqs = [int(n.split("-")[1]) for n in nums]
            assert seqs == sorted(seqs) and seqs[-1] - seqs[0] == 2
        finally:
            for m in made:
                requests.post(f"{API}/sales/{m['id']}/void", headers=h, timeout=15)

    def test_cash_must_cover_the_total(self, h):
        plain = self._plain(h)
        r = requests.post(f"{API}/sales", headers=h, timeout=15, json={
            "items": [{"product_id": plain["id"], "quantity": 2}],
            "payment_method": "cash", "amount_tendered": 1000,
        })
        assert r.status_code == 400

    def test_non_cash_carries_no_change(self, h):
        plain = self._plain(h)
        r = requests.post(f"{API}/sales", headers=h, timeout=15, json={
            "items": [{"product_id": plain["id"], "quantity": 1}],
            "payment_method": "qris", "amount_tendered": 99999,
        })
        assert r.status_code == 201
        d = r.json()
        try:
            assert d["change"] is None and d["amount_tendered"] is None
        finally:
            requests.post(f"{API}/sales/{d['id']}/void", headers=h, timeout=15)

    def test_discount_cannot_exceed_subtotal(self, h):
        plain = self._plain(h)
        r = requests.post(f"{API}/sales", headers=h, timeout=15, json={
            "items": [{"product_id": plain["id"], "quantity": 1}],
            "payment_method": "qris", "discount": 999999,
        })
        assert r.status_code == 400

    def test_void_is_reversible_not_destructive(self, h):
        plain = self._plain(h)
        d = requests.post(f"{API}/sales", headers=h, timeout=15, json={
            "items": [{"product_id": plain["id"], "quantity": 1}],
            "payment_method": "cash", "amount_tendered": 20000,
        }).json()
        voided = requests.post(f"{API}/sales/{d['id']}/void", headers=h, timeout=15)
        assert voided.status_code == 200 and voided.json()["voided"] is True
        # the record survives - a financial correction must stay visible
        assert requests.get(f"{API}/sales/{d['id']}", headers=h, timeout=15).status_code == 200
        assert requests.post(f"{API}/sales/{d['id']}/void", headers=h, timeout=15).status_code == 400

    def test_cashier_can_sell(self, cashier_h):
        prods = requests.get(f"{API}/products", headers=cashier_h, timeout=15).json()
        plain = next(p for p in prods if p["name"] == "Plain")
        r = requests.post(f"{API}/sales", headers=cashier_h, timeout=15, json={
            "items": [{"product_id": plain["id"], "quantity": 1}],
            "payment_method": "cash", "amount_tendered": 20000,
        })
        assert r.status_code == 201, "the counter must be able to take money"
        d = r.json()
        assert d["cashier_name"] == "Kasir Counter"
        requests.post(f"{API}/sales/{d['id']}/void", headers=cashier_h, timeout=15)

    def test_sale_never_reaches_the_production_sheet(self, h):
        """The invariant that justifies a separate collection: a counter sale
        consumes bread already baked, so it must not create demand to bake."""
        # A sale carries no delivery date, so it must be absent from *every*
        # bake sheet. Checking an isolated day also keeps the suite's parallel
        # workers from moving today's totals underneath us.
        day = (date.today() + timedelta(days=3651)).isoformat()
        plain = self._plain(h)
        sheet = lambda: requests.get(f"{API}/orders/production-summary",
                                     params={"date": day}, headers=h, timeout=15).json()
        assert sheet()["total_pieces"] == 0
        d = requests.post(f"{API}/sales", headers=h, timeout=15, json={
            "items": [{"product_id": plain["id"], "quantity": 25}],
            "payment_method": "cash", "amount_tendered": 500000,
        }).json()
        try:
            assert sheet()["total_pieces"] == 0, "a counter sale leaked into the bake sheet"
            assert sheet()["order_count"] == 0
        finally:
            requests.post(f"{API}/sales/{d['id']}/void", headers=h, timeout=15)

    def test_sales_feed_dashboard_revenue(self, h):
        """Counter takings must reach the owner's revenue, split by channel.

        Asserted as invariants rather than exact before/after deltas: the suite
        runs two xdist workers against one backend, so global totals move
        underneath any test that assumes exclusive access.
        """
        plain = self._plain(h)
        d = requests.post(f"{API}/sales", headers=h, timeout=15, json={
            "items": [{"product_id": plain["id"], "quantity": 4}],
            "payment_method": "qris",
        }).json()
        try:
            after = requests.get(f"{API}/dashboard/summary", headers=h, timeout=15).json()
            channels = {c["channel"]: c for c in after["revenue_by_channel"]}
            assert set(channels) == {"preorder", "counter"}
            assert channels["counter"]["amount"] >= d["total"], "sale missing from counter revenue"
            assert channels["counter"]["count"] >= 1
            # the headline must equal the sum of its parts
            assert after["total_revenue"] == pytest.approx(
                sum(c["amount"] for c in channels.values()))
        finally:
            requests.post(f"{API}/sales/{d['id']}/void", headers=h, timeout=15)

        # A voided sale stops counting as takings (the dashboard applies the
        # same voided filter as this listing).
        listed = requests.get(f"{API}/sales", headers=h, timeout=15).json()
        assert all(x["id"] != d["id"] for x in listed), "voided sale still counted"


# ---------- Counter stock ----------
class TestStock:
    def _pick(self, h, name):
        prods = requests.get(f"{API}/products", headers=h, timeout=15).json()
        return next(p for p in prods if p["name"] == name)

    def _row(self, h, product_id):
        d = requests.get(f"{API}/stock", headers=h, timeout=15).json()
        return next(i for i in d["items"] if i["product_id"] == product_id)

    def test_stock_in_then_sale_reduces_on_hand(self, h):
        """The whole point: bakers hand bread over, the counter sells it, and
        on_hand reflects both without anyone maintaining a running total."""
        prod = self._pick(h, "Egg Mayo")
        before = self._row(h, prod["id"])["on_hand"]

        added = requests.post(f"{API}/stock", headers=h, timeout=15,
                              json={"product_id": prod["id"], "quantity": 12, "reason": "stock_in"})
        assert added.status_code == 201, added.text
        assert added.json()["quantity"] == 12
        assert self._row(h, prod["id"])["on_hand"] == before + 12

        sale = requests.post(f"{API}/sales", headers=h, timeout=15, json={
            "items": [{"product_id": prod["id"], "quantity": 5}],
            "payment_method": "qris",
        }).json()
        row = self._row(h, prod["id"])
        assert row["sold"] >= 5
        assert row["on_hand"] == before + 12 - 5

        # Voiding hands the stock back with no compensating entry.
        requests.post(f"{API}/sales/{sale['id']}/void", headers=h, timeout=15)
        assert self._row(h, prod["id"])["on_hand"] == before + 12

        requests.post(f"{API}/stock", headers=h, timeout=15,
                      json={"product_id": prod["id"], "quantity": 12, "reason": "waste"})

    def test_waste_is_stored_negative(self, h):
        prod = self._pick(h, "Kaya Butter")
        before = self._row(h, prod["id"])["on_hand"]
        r = requests.post(f"{API}/stock", headers=h, timeout=15,
                          json={"product_id": prod["id"], "quantity": 3, "reason": "waste"})
        assert r.status_code == 201
        # client sends a positive number; the reason decides the direction
        assert r.json()["quantity"] == -3
        row = self._row(h, prod["id"])
        assert row["wasted"] >= 3
        assert row["on_hand"] == before - 3
        requests.post(f"{API}/stock", headers=h, timeout=15,
                      json={"product_id": prod["id"], "quantity": 3, "reason": "stock_in"})

    def test_rejects_non_positive_quantity(self, h):
        prod = self._pick(h, "Plain")
        for q in (0, -5):
            r = requests.post(f"{API}/stock", headers=h, timeout=15,
                              json={"product_id": prod["id"], "quantity": q, "reason": "stock_in"})
            assert r.status_code == 400

    def test_stock_starts_at_zero_on_an_untouched_day(self, h):
        """Perishable: a past day with no movements has no carried-over stock."""
        day = (date.today() - timedelta(days=3650)).isoformat()
        d = requests.get(f"{API}/stock", headers=h, params={"date_str": day}, timeout=15).json()
        assert d["date"] == day
        assert d["total_baked"] == 0 and d["total_sold"] == 0
        assert all(i["on_hand"] == 0 for i in d["items"])

    def test_cashier_can_record_stock(self, cashier_h):
        prods = requests.get(f"{API}/products", headers=cashier_h, timeout=15).json()
        prod = next(p for p in prods if p["name"] == "Triple Choco")
        r = requests.post(f"{API}/stock", headers=cashier_h, timeout=15,
                          json={"product_id": prod["id"], "quantity": 6, "reason": "stock_in"})
        assert r.status_code == 201, "the counter must be able to log what bakers deliver"
        assert r.json()["user_name"] == "Kasir Counter"
        requests.post(f"{API}/stock", headers=cashier_h, timeout=15,
                      json={"product_id": prod["id"], "quantity": 6, "reason": "waste"})

    def test_movements_are_attributed(self, h):
        prod = self._pick(h, "Cream Cheese")
        requests.post(f"{API}/stock", headers=h, timeout=15,
                      json={"product_id": prod["id"], "quantity": 2,
                            "reason": "stock_in", "note": "morning batch"})
        log = requests.get(f"{API}/stock/movements", headers=h, timeout=15).json()
        mine = [m for m in log if m["product_id"] == prod["id"] and m["note"] == "morning batch"]
        assert mine, "movement missing from the audit trail"
        assert mine[0]["user_name"] and mine[0]["reason"] == "stock_in"
        requests.post(f"{API}/stock", headers=h, timeout=15,
                      json={"product_id": prod["id"], "quantity": 2, "reason": "waste"})


# ---------- Expenses ----------
class TestExpenses:
    expense_id = None

    def test_categories(self, h):
        r = requests.get(f"{API}/expenses/categories", headers=h, timeout=15)
        assert r.status_code == 200
        cats = r.json()
        assert set(cats) == {"Raw Materials", "Packaging", "Transport", "Utilities", "Other"}

    def test_create_invalid_category(self, h):
        r = requests.post(f"{API}/expenses", headers=h,
                          json={"amount": 100, "category": "Bogus"}, timeout=15)
        assert r.status_code == 400

    def test_create_expense(self, h):
        r = requests.post(f"{API}/expenses", headers=h,
                          json={"amount": 50000, "category": "Raw Materials",
                                "description": "TEST_flour", "date": date.today().isoformat()},
                          timeout=15)
        assert r.status_code == 201
        data = r.json()
        assert data["amount"] == 50000
        assert data["category"] == "Raw Materials"
        TestExpenses.expense_id = data["id"]

    def test_filter_expenses(self, h):
        r = requests.get(f"{API}/expenses?category=Raw Materials", headers=h, timeout=15)
        assert r.status_code == 200
        assert all(e["category"] == "Raw Materials" for e in r.json())

    def test_delete_expense(self, h):
        r = requests.delete(f"{API}/expenses/{TestExpenses.expense_id}", headers=h, timeout=15)
        assert r.status_code == 200
        r = requests.delete(f"{API}/expenses/{TestExpenses.expense_id}", headers=h, timeout=15)
        assert r.status_code == 404


# ---------- Dashboard ----------
class TestDashboard:
    def test_summary(self, h):
        r = requests.get(f"{API}/dashboard/summary", headers=h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ["total_revenue", "total_expenses", "profit", "active_po", "trend",
                  "granularity", "top_variants", "expenses_by_category"]:
            assert k in d
        # No range = span the data that exists, bucketed to stay readable.
        assert len(d["trend"]) >= 1
        assert d["granularity"] in ("day", "week", "month")
        for point in d["trend"]:
            assert {"date", "label", "revenue", "expenses"} <= set(point)
        assert d["profit"] == d["total_revenue"] - d["total_expenses"]

    def test_all_time_has_no_comparison(self, h):
        """There is no period before "all time" to compare against."""
        r = requests.get(f"{API}/dashboard/summary", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["comparison"] is None

    def test_ranged_comparison_is_previous_equal_window(self, h):
        r = requests.get(
            f"{API}/dashboard/summary",
            params={"from_date": "2026-08-25", "to_date": "2026-08-31"},
            headers=h, timeout=15,
        )
        assert r.status_code == 200
        c = r.json()["comparison"]
        # 7-day window -> the 7 days immediately before it
        assert c["from"] == "2026-08-18"
        assert c["to"] == "2026-08-24"
        assert c["profit"] == c["total_revenue"] - c["total_expenses"]

    def test_derived_rates(self, h):
        r = requests.get(f"{API}/dashboard/summary", headers=h, timeout=15)
        d = r.json()
        # AOV spans every revenue-bearing transaction, not preorders alone —
        # otherwise opening the store would inflate it against a stale divisor.
        transactions = sum(c["count"] for c in d["revenue_by_channel"])
        if d["total_revenue"]:
            assert d["profit_margin"] == pytest.approx(
                d["profit"] / d["total_revenue"] * 100, abs=0.05)
            assert d["avg_order_value"] == pytest.approx(
                d["total_revenue"] / transactions, abs=0.01)
        else:
            # undefined rather than a misleading zero
            assert d["profit_margin"] is None
            assert d["avg_order_value"] is None

    def test_trend_points_carry_bucket_detail(self, h):
        """Each bar must be able to explain itself when tapped."""
        r = requests.get(f"{API}/dashboard/summary", headers=h, timeout=15)
        d = r.json()
        total = sum(p["order_count"] for p in d["trend"])
        assert total == d["completed_orders"]
        for p in d["trend"]:
            assert p["end_date"] >= p["date"]

    @pytest.mark.parametrize("from_date,to_date,granularity,max_buckets", [
        ("2026-08-01", "2026-08-31", "day",   31),   # a month stays daily
        ("2026-06-01", "2026-08-31", "week",  15),   # a quarter rolls up to weeks
        ("2025-09-01", "2026-08-31", "month", 13),   # a year rolls up to months
    ])
    def test_trend_granularity_scales_with_range(self, h, from_date, to_date, granularity, max_buckets):
        """Long ranges must not return one bar per day - the chart becomes unreadable."""
        r = requests.get(
            f"{API}/dashboard/summary",
            params={"from_date": from_date, "to_date": to_date},
            headers=h, timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["granularity"] == granularity
        assert 0 < len(d["trend"]) <= max_buckets
