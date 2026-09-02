"""Seed dummy orders + expenses for dashboard/production visualization testing.

Every record it writes is tagged DUMMY_TAG so the script is re-runnable and
trivially reversible:  python seed_dummy.py --clean

Writes directly to Mongo (not the API) because `completed_at` is stamped with
datetime.now() by PATCH /orders/{id}/status and cannot be backdated over HTTP —
backdating is exactly what the revenue trend needs.
"""
import os
import sys
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

DUMMY_TAG = "[DUMMY]"
random.seed(42)  # reproducible

BACKEND_DIR = Path(__file__).resolve().parent.parent  # backend/scripts/ -> backend/
load_dotenv(BACKEND_DIR / ".env")

try:
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
except KeyError as exc:
    sys.exit(f"Missing {exc} — expected it in {BACKEND_DIR / '.env'}")

CUSTOMERS = [
    ("Andi Pratama", "081234567801"), ("Siti Rahayu", "081234567802"),
    ("Budi Santoso", "081234567803"), ("Dewi Lestari", "081234567804"),
    ("Rizky Ramadhan", "081234567805"), ("Putri Anggraini", "081234567806"),
    ("Agus Wijaya", "081234567807"), ("Maya Kusuma", "081234567808"),
    ("Fajar Nugroho", "081234567809"), ("Rina Melati", "081234567810"),
    ("Hendra Gunawan", "081234567811"), ("Lia Permata", "081234567812"),
]
NOTES = [
    "Tolong dipisah packingnya", "Untuk arisan RT", "Jangan terlalu manis",
    "Ambil sendiri jam 3 sore", "Titip di satpam kalau tidak ada orang",
    "Untuk acara kantor", None, None, None,
]
EXPENSES = [
    ("Raw Materials", ["Tepung terigu 25kg", "Butter & margarin", "Telur 10kg",
                       "Gula & garam", "Ragi instan", "Keju cream 2kg"], 150_000, 850_000),
    ("Packaging",     ["Paper bag 200pcs", "Stiker label", "Box kemasan", "Plastik wrap"],
                       50_000, 300_000),
    ("Transport",     ["Bensin motor", "Ongkir bahan baku", "Grab delivery"], 20_000, 120_000),
    ("Utilities",     ["Token listrik", "Gas LPG 3kg", "Air PDAM"], 30_000, 200_000),
    ("Other",         ["Servis oven", "Alat baking baru"], 50_000, 400_000),
]


DEMO_USERS = [
    ("baker@saltbread.com",   "Baker Owner",   "owner",   "baker123"),
    ("admin@saltbread.com",   "Admin PO",      "admin",   "admin123"),
    ("kasir@saltbread.com",   "Kasir Counter", "cashier", "kasir123"),
]


def ensure_users():
    """Idempotently guarantee one account per role so both sides of the
    permission boundary can be exercised. Existing passwords are left alone."""
    import bcrypt
    for email, name, role, password in DEMO_USERS:
        existing = db.users.find_one({"email": email})
        if existing:
            # Backfill role on accounts created before roles existed.
            if existing.get("role") != role:
                db.users.update_one({"email": email}, {"$set": {"role": role}})
                print(f"Set role={role} on existing {email}")
            continue
        db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": email,
            "name": name,
            "role": role,
            "password_hash": bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
            "created_at": datetime.now(timezone.utc),
        })
        print(f"Created {role}: {email} / {password}")


def clean():
    o = db.orders.delete_many({"notes": {"$regex": r"\[DUMMY\]"}}).deleted_count
    e = db.expenses.delete_many({"description": {"$regex": r"\[DUMMY\]"}}).deleted_count
    print(f"Removed {o} dummy orders, {e} dummy expenses.")


def make_items(products):
    """1-3 distinct variants, home-bakery sized quantities."""
    items = []
    for p in random.sample(products, random.randint(1, 3)):
        qty = random.choice([5, 6, 8, 10, 10, 12, 15, 20, 24, 30])
        items.append({
            "product_id": p["id"], "product_name": p["name"],
            "quantity": qty, "unit_price": p["price"],
            "subtotal": p["price"] * qty,
        })
    return items


def build_order(products, delivery_date, status, created_at, completed_at=None):
    name, phone = random.choice(CUSTOMERS)
    items = make_items(products)
    note = random.choice(NOTES)
    return {
        "id": str(uuid.uuid4()),
        "customer_name": name,
        "customer_phone": phone,
        "delivery_date": delivery_date.isoformat(),
        "items": items,
        "total": float(sum(i["subtotal"] for i in items)),
        "status": status,
        # tag lives in notes so it survives an API round-trip and is greppable
        "notes": f"{note} {DUMMY_TAG}" if note else DUMMY_TAG,
        "created_at": created_at,
        "completed_at": completed_at,
    }


def seed():
    products = list(db.products.find({}, {"_id": 0}))
    if not products:
        sys.exit("No products found — start the backend once to seed variants first.")

    today = datetime.now(timezone.utc).date()
    orders, expenses = [], []

    # --- Past 7 days + today: COMPLETED -> drives revenue, trend, top variants ---
    now = datetime.now(timezone.utc)
    for back in range(7, -1, -1):
        day = today - timedelta(days=back)
        for _ in range(random.randint(2, 4)):
            # midday UTC keeps .date() on the intended day in Asia/Jakarta (UTC+7)
            done = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc) \
                   + timedelta(hours=random.randint(3, 9), minutes=random.randint(0, 59))
            done = min(done, now - timedelta(hours=1))  # never stamp a future completion
            orders.append(build_order(
                products, day, "completed",
                created_at=done - timedelta(days=random.randint(1, 3)),
                completed_at=done,
            ))

    # --- Today + next 7 days: PENDING / IN_PROGRESS -> drives Production + Active PO ---
    for ahead in range(0, 8):
        day = today + timedelta(days=ahead)
        for _ in range(random.randint(2, 3)):
            status = "in_progress" if ahead <= 1 and random.random() < 0.5 else "pending"
            orders.append(build_order(
                products, day, status,
                created_at=datetime.now(timezone.utc) - timedelta(days=random.randint(0, 4)),
            ))

    # --- A couple of cancelled ones so every status chip has data ---
    for ahead in (2, 4):
        day = today + timedelta(days=ahead)
        orders.append(build_order(
            products, day, "cancelled",
            created_at=datetime.now(timezone.utc) - timedelta(days=2),
        ))

    # --- Expenses across the past 7 days + today -> second trend series ---
    for back in range(7, -1, -1):
        day = today - timedelta(days=back)
        for _ in range(random.randint(1, 3)):
            cat, descs, lo, hi = random.choice(EXPENSES)
            expenses.append({
                "id": str(uuid.uuid4()),
                "amount": float(random.randrange(lo, hi, 5_000)),
                "category": cat,
                "description": f"{random.choice(descs)} {DUMMY_TAG}",
                "date": day.isoformat(),
                "created_at": datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc),
            })

    db.orders.insert_many(orders)
    db.expenses.insert_many(expenses)

    completed = [o for o in orders if o["status"] == "completed"]
    active = [o for o in orders if o["status"] in ("pending", "in_progress")]
    print(f"Inserted {len(orders)} orders ({len(completed)} completed, "
          f"{len(active)} active, {len(orders)-len(completed)-len(active)} cancelled)")
    print(f"Inserted {len(expenses)} expenses")
    print(f"Revenue seeded : Rp {sum(o['total'] for o in completed):,.0f}")
    print(f"Expenses seeded: Rp {sum(e['amount'] for e in expenses):,.0f}")


if __name__ == "__main__":
    clean()  # always clear prior dummy data first -> re-runnable, no duplicates
    if "--clean" not in sys.argv:
        ensure_users()
        seed()
