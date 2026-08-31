"""Saltbread backend API tests - covers auth, products, orders, expenses, dashboard."""
import os
import pytest
import requests
from datetime import date

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://home-baker-dashboard.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "baker@saltbread.com"
DEMO_PASSWORD = "baker123"


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

    def test_register_duplicate(self):
        r = requests.post(f"{API}/auth/register",
                          json={"email": DEMO_EMAIL, "password": "x", "name": "X"}, timeout=15)
        assert r.status_code == 409


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
        if d["total_revenue"]:
            assert d["profit_margin"] == pytest.approx(
                d["profit"] / d["total_revenue"] * 100, abs=0.05)
            assert d["avg_order_value"] == pytest.approx(
                d["total_revenue"] / d["completed_orders"], abs=0.01)
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
