from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timedelta, timezone, date
import jwt
import bcrypt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

SECRET_KEY = os.environ.get('SECRET_KEY', 'saltbread-dev-secret-please-change')
ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 days

app = FastAPI()
api_router = APIRouter(prefix="/api")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# ---------- Utils ----------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), hashed.encode())
    except Exception:
        return False

def create_token(email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": email, "iat": now, "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: str
    email: EmailStr
    name: str

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class Product(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    price: float
    image_url: Optional[str] = None
    active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ProductCreate(BaseModel):
    name: str
    price: float
    image_url: Optional[str] = None

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    image_url: Optional[str] = None
    active: Optional[bool] = None

class OrderItem(BaseModel):
    product_id: str
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float

class OrderItemIn(BaseModel):
    product_id: str
    quantity: int

OrderStatus = Literal["pending", "in_progress", "completed", "cancelled"]

class Order(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customer_name: str
    customer_phone: Optional[str] = None
    delivery_date: str  # ISO date string
    items: List[OrderItem]
    total: float
    status: OrderStatus = "pending"
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None

class OrderCreate(BaseModel):
    customer_name: str
    customer_phone: Optional[str] = None
    delivery_date: str
    items: List[OrderItemIn]
    notes: Optional[str] = None

class OrderStatusUpdate(BaseModel):
    status: OrderStatus

class Expense(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    amount: float
    category: str
    description: Optional[str] = None
    date: str  # ISO date string
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ExpenseCreate(BaseModel):
    amount: float
    category: str
    description: Optional[str] = None
    date: Optional[str] = None

EXPENSE_CATEGORIES = ["Raw Materials", "Packaging", "Transport", "Utilities", "Other"]

DEFAULT_VARIANTS = [
    {"name": "Plain",         "price": 15000, "image_url": "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600"},
    {"name": "Choco",         "price": 18000, "image_url": "https://images.unsplash.com/photo-1564354273277-c6d4b8532100?w=600"},
    {"name": "Cream Cheese",  "price": 20000, "image_url": "https://images.unsplash.com/photo-1608198093002-ad4e005484ec?w=600"},
    {"name": "Egg Mayo",      "price": 19000, "image_url": "https://images.unsplash.com/photo-1550507992-eb63ffee0847?w=600"},
    {"name": "Umami Abon",    "price": 22000, "image_url": "https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=600"},
    {"name": "Kaya Butter",   "price": 20000, "image_url": "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600"},
    {"name": "Triple Choco",  "price": 23000, "image_url": "https://images.unsplash.com/photo-1600353068867-5b4b3f9c07f8?w=600"},
]

# ---------- Auth Routes ----------
@api_router.post("/auth/register", response_model=TokenOut, status_code=201)
async def register(body: RegisterIn):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email,
        "name": body.name,
        "password_hash": hash_password(body.password),
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(doc)
    token = create_token(email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user_id, "email": email, "name": body.name},
    }

@api_router.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_token(email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user["id"], "email": user["email"], "name": user["name"]},
    }

@api_router.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "name": user["name"]}

# ---------- Products ----------
@api_router.get("/products", response_model=List[Product])
async def list_products(user=Depends(get_current_user)):
    items = await db.products.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return items

@api_router.post("/products", response_model=Product, status_code=201)
async def create_product(body: ProductCreate, user=Depends(get_current_user)):
    p = Product(**body.dict()).dict()
    await db.products.insert_one(p.copy())
    return p

@api_router.patch("/products/{product_id}", response_model=Product)
async def update_product(product_id: str, body: ProductUpdate, user=Depends(get_current_user)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    await db.products.update_one({"id": product_id}, {"$set": updates})
    doc = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Product not found")
    return doc

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, user=Depends(get_current_user)):
    r = await db.products.delete_one({"id": product_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"ok": True}

# ---------- Orders ----------
@api_router.get("/orders", response_model=List[Order])
async def list_orders(status_filter: Optional[str] = None, user=Depends(get_current_user)):
    q = {}
    if status_filter and status_filter != "all":
        q["status"] = status_filter
    items = await db.orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items

@api_router.get("/orders/production-summary")
async def production_summary(date: str, user=Depends(get_current_user)):
    """
    Aggregate all non-cancelled orders for a given delivery_date (YYYY-MM-DD).
    Returns total pieces to bake, per-variant quantities, and the full order list.
    """
    try:
        datetime.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    orders = await db.orders.find(
        {"delivery_date": date, "status": {"$ne": "cancelled"}},
        {"_id": 0}
    ).sort("created_at", 1).to_list(500)

    # Aggregate variant quantities across all matched orders
    variant_totals: dict = {}
    for order in orders:
        for item in order.get("items", []):
            name = item["product_name"]
            variant_totals[name] = variant_totals.get(name, 0) + item["quantity"]

    variants_sorted = sorted(
        [{"product_name": k, "quantity": v} for k, v in variant_totals.items()],
        key=lambda x: x["quantity"],
        reverse=True,
    )
    total_pieces = sum(v["quantity"] for v in variants_sorted)

    return {
        "date": date,
        "total_pieces": total_pieces,
        "order_count": len(orders),
        "variants": variants_sorted,
        "orders": orders,
    }

@api_router.post("/orders", response_model=Order, status_code=201)
async def create_order(body: OrderCreate, user=Depends(get_current_user)):
    if not body.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")
    order_items = []
    total = 0.0
    for it in body.items:
        prod = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not prod:
            raise HTTPException(status_code=400, detail=f"Product {it.product_id} not found")
        subtotal = prod["price"] * it.quantity
        total += subtotal
        order_items.append(OrderItem(
            product_id=prod["id"], product_name=prod["name"],
            quantity=it.quantity, unit_price=prod["price"], subtotal=subtotal,
        ))
    order = Order(
        customer_name=body.customer_name, customer_phone=body.customer_phone,
        delivery_date=body.delivery_date, items=order_items, total=total,
        notes=body.notes,
    ).dict()
    await db.orders.insert_one(order.copy())
    return order

@api_router.get("/orders/{order_id}", response_model=Order)
async def get_order(order_id: str, user=Depends(get_current_user)):
    doc = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    return doc

@api_router.patch("/orders/{order_id}/status", response_model=Order)
async def update_order_status(order_id: str, body: OrderStatusUpdate, user=Depends(get_current_user)):
    updates = {"status": body.status}
    if body.status == "completed":
        updates["completed_at"] = datetime.now(timezone.utc)
    await db.orders.update_one({"id": order_id}, {"$set": updates})
    doc = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    return doc

@api_router.delete("/orders/{order_id}")
async def delete_order(order_id: str, user=Depends(get_current_user)):
    r = await db.orders.delete_one({"id": order_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")
    return {"ok": True}

# ---------- Expenses ----------
@api_router.get("/expenses/categories")
async def expense_categories(user=Depends(get_current_user)):
    return EXPENSE_CATEGORIES

@api_router.get("/expenses", response_model=List[Expense])
async def list_expenses(category: Optional[str] = None, user=Depends(get_current_user)):
    q = {}
    if category and category != "all":
        q["category"] = category
    items = await db.expenses.find(q, {"_id": 0}).sort("date", -1).to_list(1000)
    return items

@api_router.post("/expenses", response_model=Expense, status_code=201)
async def create_expense(body: ExpenseCreate, user=Depends(get_current_user)):
    if body.category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    date_str = body.date or datetime.now(timezone.utc).date().isoformat()
    exp = Expense(
        amount=body.amount, category=body.category,
        description=body.description, date=date_str,
    ).dict()
    await db.expenses.insert_one(exp.copy())
    return exp

@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(get_current_user)):
    r = await db.expenses.delete_one({"id": expense_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"ok": True}

# ---------- Dashboard ----------
def _in_window(date_str: Optional[str], d_from: Optional[date], d_to: Optional[date]) -> bool:
    if not date_str:
        return False
    try:
        d = datetime.fromisoformat(date_str).date()
    except Exception:
        return False
    if d_from and d < d_from:
        return False
    if d_to and d > d_to:
        return False
    return True


def _window_totals(completed_orders: list, expenses: list,
                   d_from: Optional[date], d_to: Optional[date]) -> dict:
    """Revenue/expense/profit for one date window. Shared by the current and
    previous periods so the comparison can't drift from the headline numbers."""
    orders = [o for o in completed_orders
              if _in_window(_completed_date_str(o.get("completed_at")), d_from, d_to)]
    exps = [e for e in expenses if _in_window(e.get("date"), d_from, d_to)]
    revenue = sum(o["total"] for o in orders)
    spend = sum(e["amount"] for e in exps)
    return {
        "orders": orders,
        "expenses": exps,
        "total_revenue": revenue,
        "total_expenses": spend,
        "profit": revenue - spend,
    }


def _pct_change(current: float, previous: float) -> Optional[float]:
    """None when there's no baseline — growth from zero has no percentage."""
    if not previous:
        return None
    return round((current - previous) / previous * 100, 1)


def _bucket_start(d: date, granularity: str) -> date:
    """Snap a date to the first day of its bucket."""
    if granularity == "month":
        return d.replace(day=1)
    if granularity == "week":
        return d - timedelta(days=d.weekday())  # Monday
    return d


def _next_bucket(d: date, granularity: str) -> date:
    if granularity == "month":
        return (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    if granularity == "week":
        return d + timedelta(days=7)
    return d + timedelta(days=1)


def _bucket_label(d: date, granularity: str) -> str:
    """Display label. Owned here so the client never re-derives formatting."""
    if granularity == "month":
        return d.strftime("%b %y")   # "Aug 26"
    if granularity == "week":
        return d.strftime("%d %b")   # "31 Aug"
    return d.strftime("%m-%d")       # "08-31"


def _pick_granularity(span_days: int) -> str:
    """Keep the bar count readable regardless of how long the range is."""
    if span_days <= 31:
        return "day"
    if span_days <= 182:
        return "week"
    return "month"


def _completed_date_str(ca) -> Optional[str]:
    if not ca:
        return None
    if isinstance(ca, str):
        try:
            return datetime.fromisoformat(ca.replace("Z", "")).date().isoformat()
        except Exception:
            return None
    if hasattr(ca, "date"):
        return ca.date().isoformat()
    return None


@api_router.get("/dashboard/summary")
async def dashboard_summary(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user=Depends(get_current_user),
):
    # Parse range (inclusive)
    today = datetime.now(timezone.utc).date()
    try:
        d_from = datetime.fromisoformat(from_date).date() if from_date else None
        d_to = datetime.fromisoformat(to_date).date() if to_date else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")
    if d_from and d_to and d_from > d_to:
        d_from, d_to = d_to, d_from

    completed_orders_all = await db.orders.find({"status": "completed"}, {"_id": 0}).to_list(5000)
    all_orders = await db.orders.find({}, {"_id": 0}).to_list(5000)
    expenses_all = await db.expenses.find({}, {"_id": 0}).to_list(5000)

    ranged = bool(d_from or d_to)
    if ranged:
        current = _window_totals(completed_orders_all, expenses_all, d_from, d_to)
    else:
        current = _window_totals(completed_orders_all, expenses_all, None, None)

    completed_orders = current["orders"]
    expenses = current["expenses"]
    total_revenue = current["total_revenue"]
    total_expenses = current["total_expenses"]
    profit = current["profit"]

    # Active POs are a "right now" figure: pending/in_progress orders have no
    # completion date to filter on, so this stays deliberately un-ranged.
    active_po = sum(1 for o in all_orders if o["status"] in ("pending", "in_progress"))
    completed_count = len(completed_orders)

    # Derived rates. None rather than 0 when undefined, so the client can show
    # a dash instead of implying a real 0%.
    profit_margin = round(profit / total_revenue * 100, 1) if total_revenue else None
    avg_order_value = round(total_revenue / completed_count, 2) if completed_count else None

    # Previous equal-length window, for period-over-period comparison. Only
    # meaningful for a closed range — "All Time" has nothing before it.
    comparison = None
    if d_from and d_to:
        span = (d_to - d_from).days + 1
        prev_to = d_from - timedelta(days=1)
        prev_from = prev_to - timedelta(days=span - 1)
        prev = _window_totals(completed_orders_all, expenses_all, prev_from, prev_to)
        comparison = {
            "from": prev_from.isoformat(),
            "to": prev_to.isoformat(),
            "total_revenue": prev["total_revenue"],
            "total_expenses": prev["total_expenses"],
            "profit": prev["profit"],
            "revenue_change_pct": _pct_change(total_revenue, prev["total_revenue"]),
            "expenses_change_pct": _pct_change(total_expenses, prev["total_expenses"]),
            "profit_change_pct": _pct_change(profit, prev["profit"]),
        }

    # Roll daily totals up once, then bucket. Avoids re-scanning every order per day.
    rev_by_day: dict = {}
    orders_by_day: dict = {}
    for o in completed_orders:
        ds = _completed_date_str(o.get("completed_at"))
        if ds:
            rev_by_day[ds] = rev_by_day.get(ds, 0.0) + o["total"]
            orders_by_day[ds] = orders_by_day.get(ds, 0) + 1
    exp_by_day: dict = {}
    for e in expenses:
        ds = e.get("date")
        if ds:
            exp_by_day[ds] = exp_by_day.get(ds, 0.0) + e["amount"]

    # Trend window: the explicit range, else the full span of real data ("All Time").
    if ranged:
        start = d_from or (d_to - timedelta(days=6))
        end = d_to or today
    else:
        known = sorted(set(rev_by_day) | set(exp_by_day))
        end = today
        if known:
            try:
                start = min(datetime.fromisoformat(known[0]).date(), end)
            except ValueError:
                start = end - timedelta(days=6)
        else:
            start = end - timedelta(days=6)

    # Long ranges bucket into weeks/months instead of hundreds of daily bars.
    granularity = _pick_granularity((end - start).days + 1)

    buckets: dict = {}
    ordered: List[date] = []
    cur = _bucket_start(start, granularity)
    while cur <= end:
        buckets[cur] = {"revenue": 0.0, "expenses": 0.0, "order_count": 0}
        ordered.append(cur)
        cur = _next_bucket(cur, granularity)

    for source, key in (
        (rev_by_day, "revenue"),
        (exp_by_day, "expenses"),
        (orders_by_day, "order_count"),
    ):
        for ds, amount in source.items():
            try:
                d = datetime.fromisoformat(ds).date()
            except ValueError:
                continue
            if start <= d <= end:
                b = buckets.get(_bucket_start(d, granularity))
                if b is not None:
                    b[key] += amount

    trend = [
        {
            "date": b.isoformat(),
            "label": _bucket_label(b, granularity),
            # inclusive end of this bucket, so the client can caption a tap
            "end_date": min(_next_bucket(b, granularity) - timedelta(days=1), end).isoformat(),
            "revenue": buckets[b]["revenue"],
            "expenses": buckets[b]["expenses"],
            "order_count": buckets[b]["order_count"],
        }
        for b in ordered
    ]

    # Top variants
    variant_counts = {}
    for o in completed_orders:
        for it in o["items"]:
            variant_counts.setdefault(it["product_name"], {"quantity": 0, "revenue": 0.0})
            variant_counts[it["product_name"]]["quantity"] += it["quantity"]
            variant_counts[it["product_name"]]["revenue"] += it["subtotal"]
    top_variants = sorted(
        [{"name": k, **v} for k, v in variant_counts.items()],
        key=lambda x: x["quantity"], reverse=True,
    )[:5]

    # Expenses by category
    exp_by_cat = {}
    for e in expenses:
        exp_by_cat[e["category"]] = exp_by_cat.get(e["category"], 0) + e["amount"]

    return {
        "total_revenue": total_revenue,
        "total_expenses": total_expenses,
        "profit": profit,
        "active_po": active_po,
        "completed_orders": completed_count,
        "profit_margin": profit_margin,
        "avg_order_value": avg_order_value,
        "comparison": comparison,
        "trend": trend,
        "granularity": granularity,
        "top_variants": top_variants,
        "expenses_by_category": [{"category": k, "amount": v} for k, v in exp_by_cat.items()],
    }

@api_router.get("/")
async def root():
    return {"message": "Saltbread API"}

# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    # Seed products if empty
    count = await db.products.count_documents({})
    if count == 0:
        for v in DEFAULT_VARIANTS:
            p = Product(**v).dict()
            await db.products.insert_one(p.copy())
        logger.info("Seeded default saltbread variants.")

    # Seed demo user if empty
    ucount = await db.users.count_documents({})
    if ucount == 0:
        demo = {
            "id": str(uuid.uuid4()),
            "email": "baker@saltbread.com",
            "name": "Baker Owner",
            "password_hash": hash_password("baker123"),
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(demo)
        logger.info("Seeded demo user baker@saltbread.com / baker123")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
