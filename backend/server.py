from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
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

# No fallback: a missing key would silently sign tokens with a value that is
# public in this repo's history, making every session forgeable.
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not set. Add it to backend/.env before starting the server."
    )
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
    # Accounts created before roles existed are the original owner.
    user["role"] = user.get("role") or "owner"
    return user


def require_owner(user=Depends(get_current_user)):
    """Guards anything financial or administrative. Only the owner sees revenue,
    costs or margins, manages the catalogue, or manages other accounts."""
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    return user


def require_staff(user=Depends(get_current_user)):
    """Guards the preorder book and the bake sheet. Admins run operations —
    everything the owner does except the money — while cashiers stay on the
    till and never touch preorders."""
    if user.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Staff access required")
    return user

# ---------- Models ----------
Role = Literal["owner", "admin", "cashier"]

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class StaffCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Role = "cashier"

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class UserOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: Role = "owner"

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

class LineItem(BaseModel):
    """Shared by preorders and counter sales. Values are snapshotted at the time
    of sale so later price or name changes never rewrite history."""
    product_id: str
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float

class LineItemIn(BaseModel):
    product_id: str
    quantity: int

OrderStatus = Literal["pending", "in_progress", "completed", "cancelled"]

class Order(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customer_name: str
    customer_phone: Optional[str] = None
    delivery_date: str  # ISO date string
    items: List[LineItem]
    total: float
    status: OrderStatus = "pending"
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None

class OrderCreate(BaseModel):
    customer_name: str
    customer_phone: Optional[str] = None
    delivery_date: str
    items: List[LineItemIn]
    notes: Optional[str] = None

class OrderStatusUpdate(BaseModel):
    status: OrderStatus

PaymentMethod = Literal["cash", "qris", "transfer"]

class Sale(BaseModel):
    """A walk-in counter sale. Deliberately NOT an Order: it has no delivery
    date and no status lifecycle, it is born complete, and — critically — it
    consumes bread that is already baked, so it must never reach the
    production summary the way a preorder does."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    receipt_no: str
    items: List[LineItem]
    subtotal: float
    discount: float = 0.0
    total: float
    payment_method: PaymentMethod
    amount_tendered: Optional[float] = None
    change: Optional[float] = None
    cashier_id: str
    cashier_name: str
    # Sales are an append-only ledger: corrections void, they never delete.
    voided: bool = False
    voided_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SaleCreate(BaseModel):
    items: List[LineItemIn]
    payment_method: PaymentMethod
    discount: float = 0.0
    amount_tendered: Optional[float] = None

StockReason = Literal["stock_in", "waste"]

class StockMovement(BaseModel):
    """A manual change to counter stock. Sales are NOT recorded here — sold
    quantity is derived from the sales collection, so voiding a sale returns
    its stock automatically and there is one source of truth for what sold."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: str  # ISO date, the trading day this belongs to
    product_id: str
    product_name: str
    quantity: int  # signed: positive added, negative removed
    reason: StockReason
    note: Optional[str] = None
    user_id: str
    user_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StockMovementCreate(BaseModel):
    product_id: str
    quantity: int  # always positive; the reason decides the direction
    reason: StockReason = "stock_in"
    note: Optional[str] = None

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
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"],
            "role": user.get("role") or "owner",
        },
    }

@api_router.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}

@api_router.patch("/auth/password")
async def change_password(body: PasswordChange, user=Depends(get_current_user)):
    """Any signed-in user may change their own password. Needed because the
    bootstrap owner ships with a known seed password."""
    doc = await db.users.find_one({"email": user["email"]})
    if not doc or not verify_password(body.current_password, doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    await db.users.update_one(
        {"id": doc["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}}
    )
    return {"ok": True}

# ---------- Staff (owner only) ----------
@api_router.get("/users", response_model=List[UserOut])
async def list_users(owner=Depends(require_owner)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(100)
    for u in users:
        u["role"] = u.get("role") or "owner"
    return users

@api_router.post("/users", response_model=UserOut, status_code=201)
async def create_user(body: StaffCreate, owner=Depends(require_owner)):
    """Replaces public registration — accounts exist only because an owner made them."""
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": body.name,
        "role": body.role,
        "password_hash": hash_password(body.password),
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(doc)
    return {"id": doc["id"], "email": email, "name": body.name, "role": body.role}

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, owner=Depends(require_owner)):
    if user_id == owner["id"]:
        raise HTTPException(status_code=400, detail="You cannot remove your own account")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Never leave the business with no one who can administer it.
    if (target.get("role") or "owner") == "owner":
        owners = await db.users.count_documents({"role": {"$ne": "cashier"}})
        if owners <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last owner")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}

# ---------- Products ----------
@api_router.get("/products", response_model=List[Product])
async def list_products(include_inactive: bool = False, user=Depends(get_current_user)):
    """Defaults to sellable products only, so order forms and the POS grid can
    use this endpoint directly. Management passes include_inactive to see
    everything (otherwise a deactivated variant could never be turned back on)."""
    q = {} if include_inactive else {"active": {"$ne": False}}
    items = await db.products.find(q, {"_id": 0}).sort("name", 1).to_list(500)
    return items

@api_router.post("/products", response_model=Product, status_code=201)
async def create_product(body: ProductCreate, user=Depends(require_owner)):
    p = Product(**body.dict()).dict()
    await db.products.insert_one(p.copy())
    return p

@api_router.patch("/products/{product_id}", response_model=Product)
async def update_product(product_id: str, body: ProductUpdate, user=Depends(require_owner)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    await db.products.update_one({"id": product_id}, {"$set": updates})
    doc = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Product not found")
    return doc

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, user=Depends(require_owner)):
    r = await db.products.delete_one({"id": product_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"ok": True}

# ---------- Orders ----------
@api_router.get("/orders", response_model=List[Order])
async def list_orders(status_filter: Optional[str] = None, user=Depends(require_staff)):
    q = {}
    if status_filter and status_filter != "all":
        q["status"] = status_filter
    items = await db.orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items

@api_router.get("/orders/production-summary")
async def production_summary(date: str, user=Depends(require_staff)):
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
async def create_order(body: OrderCreate, user=Depends(require_staff)):
    if not body.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")
    order_items = []
    total = 0.0
    for it in body.items:
        prod = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not prod:
            raise HTTPException(status_code=400, detail=f"Product {it.product_id} not found")
        # Enforced here too: hiding it in the form is not the guarantee.
        if prod.get("active") is False:
            raise HTTPException(
                status_code=400, detail=f"{prod['name']} is no longer available"
            )
        subtotal = prod["price"] * it.quantity
        total += subtotal
        order_items.append(LineItem(
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
async def get_order(order_id: str, user=Depends(require_staff)):
    doc = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    return doc

@api_router.patch("/orders/{order_id}/status", response_model=Order)
async def update_order_status(order_id: str, body: OrderStatusUpdate, user=Depends(require_staff)):
    updates = {"status": body.status}
    if body.status == "completed":
        updates["completed_at"] = datetime.now(timezone.utc)
    await db.orders.update_one({"id": order_id}, {"$set": updates})
    doc = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    return doc

@api_router.delete("/orders/{order_id}")
async def delete_order(order_id: str, user=Depends(require_owner)):
    r = await db.orders.delete_one({"id": order_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")
    return {"ok": True}

# ---------- Sales (counter / POS) ----------
@api_router.get("/sales", response_model=List[Sale])
async def list_sales(
    date_str: Optional[str] = None,
    include_voided: bool = False,
    user=Depends(get_current_user),
):
    """Defaults to today — the counter's working view. Cashiers need this to
    look up a receipt, so it is not owner-gated."""
    d = _parse_day(date_str)
    q: dict = {"created_at": _day_bounds(d)}
    if not include_voided:
        q["voided"] = {"$ne": True}
    return await db.sales.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api_router.post("/sales", response_model=Sale, status_code=201)
async def create_sale(body: SaleCreate, user=Depends(get_current_user)):
    if not body.items:
        raise HTTPException(status_code=400, detail="Add at least one item")
    if body.discount < 0:
        raise HTTPException(status_code=400, detail="Discount cannot be negative")

    items: List[LineItem] = []
    subtotal = 0.0
    for it in body.items:
        if it.quantity < 1:
            raise HTTPException(status_code=400, detail="Quantity must be at least 1")
        prod = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not prod:
            raise HTTPException(status_code=400, detail=f"Product {it.product_id} not found")
        if prod.get("active") is False:
            raise HTTPException(status_code=400, detail=f"{prod['name']} is no longer available")
        line = prod["price"] * it.quantity
        subtotal += line
        items.append(LineItem(
            product_id=prod["id"], product_name=prod["name"],
            quantity=it.quantity, unit_price=prod["price"], subtotal=line,
        ))

    if body.discount > subtotal:
        raise HTTPException(status_code=400, detail="Discount cannot exceed the subtotal")
    total = subtotal - body.discount

    # Change is only meaningful for cash, and must cover the total.
    change = None
    tendered = body.amount_tendered
    if body.payment_method == "cash":
        if tendered is None:
            raise HTTPException(status_code=400, detail="Enter the amount received")
        if tendered < total:
            raise HTTPException(status_code=400, detail="Amount received is less than the total")
        change = round(tendered - total, 2)
    else:
        tendered = None

    sale = Sale(
        receipt_no=await next_receipt_no(),
        items=items, subtotal=subtotal, discount=body.discount, total=total,
        payment_method=body.payment_method, amount_tendered=tendered, change=change,
        cashier_id=user["id"], cashier_name=user["name"],
    ).dict()
    await db.sales.insert_one(sale.copy())
    return sale


@api_router.get("/sales/{sale_id}", response_model=Sale)
async def get_sale(sale_id: str, user=Depends(get_current_user)):
    doc = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sale not found")
    return doc


@api_router.post("/sales/{sale_id}/void", response_model=Sale)
async def void_sale(sale_id: str, user=Depends(get_current_user)):
    """Voids rather than deletes: a sale is a financial record, so a correction
    must stay visible. Cashiers may only void their own mistakes."""
    doc = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sale not found")
    if user["role"] not in ("owner", "admin") and doc["cashier_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You can only void your own sales")
    if doc.get("voided"):
        raise HTTPException(status_code=400, detail="This sale is already voided")
    await db.sales.update_one(
        {"id": sale_id},
        {"$set": {"voided": True, "voided_at": datetime.now(timezone.utc)}},
    )
    return await db.sales.find_one({"id": sale_id}, {"_id": 0})


# ---------- Counter stock ----------
@api_router.get("/stock")
async def stock_levels(date_str: Optional[str] = None, user=Depends(get_current_user)):
    """Counter stock for one trading day.

    Stock is derived, never stored as a running total: bread is perishable, so
    each day genuinely starts at zero and a day with no movements simply has
    none. `sold` comes straight from the sales collection, which means voiding
    a sale hands its stock back with no compensating entry to get wrong.
    """
    d = _parse_day(date_str)
    day = d.isoformat()

    movements = await db.stock_movements.find({"date": day}, {"_id": 0}).to_list(2000)
    sales = await db.sales.find(
        {"created_at": _day_bounds(d), "voided": {"$ne": True}}, {"_id": 0}
    ).to_list(2000)
    products = await db.products.find({"active": {"$ne": False}}, {"_id": 0}).sort("name", 1).to_list(500)

    added: dict = {}
    removed: dict = {}
    for m in movements:
        bucket = added if m["quantity"] > 0 else removed
        bucket[m["product_id"]] = bucket.get(m["product_id"], 0) + abs(m["quantity"])

    sold: dict = {}
    for sale in sales:
        for it in sale["items"]:
            sold[it["product_id"]] = sold.get(it["product_id"], 0) + it["quantity"]

    items = []
    for p in products:
        a = added.get(p["id"], 0)
        w = removed.get(p["id"], 0)
        s = sold.get(p["id"], 0)
        items.append({
            "product_id": p["id"],
            "product_name": p["name"],
            "price": p["price"],
            "image_url": p.get("image_url"),
            "baked": a,
            "wasted": w,
            "sold": s,
            # May go negative — that is a real signal the count is wrong, not
            # something to clamp away.
            "on_hand": a - w - s,
        })

    return {
        "date": day,
        "items": items,
        "total_baked": sum(i["baked"] for i in items),
        "total_sold": sum(i["sold"] for i in items),
        "total_wasted": sum(i["wasted"] for i in items),
        "total_on_hand": sum(i["on_hand"] for i in items),
    }


@api_router.get("/stock/movements", response_model=List[StockMovement])
async def stock_movements(date_str: Optional[str] = None, user=Depends(get_current_user)):
    """The audit trail behind the numbers — every manual change, attributed."""
    day = _parse_day(date_str).isoformat()
    return await db.stock_movements.find({"date": day}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/stock", response_model=StockMovement, status_code=201)
async def record_stock(body: StockMovementCreate, user=Depends(get_current_user)):
    """Counter staff record what the bakers hand over, and what gets thrown
    away. The reason decides the direction, so a client cannot accidentally
    add stock while meaning to remove it."""
    if body.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than zero")
    prod = await db.products.find_one({"id": body.product_id}, {"_id": 0})
    if not prod:
        raise HTTPException(status_code=400, detail="Product not found")

    signed = body.quantity if body.reason == "stock_in" else -body.quantity
    doc = StockMovement(
        date=datetime.now(timezone.utc).date().isoformat(),
        product_id=prod["id"], product_name=prod["name"],
        quantity=signed, reason=body.reason, note=body.note,
        user_id=user["id"], user_name=user["name"],
    ).dict()
    await db.stock_movements.insert_one(doc.copy())
    return doc


# ---------- Expenses ----------
@api_router.get("/expenses/categories")
async def expense_categories(user=Depends(require_owner)):
    return EXPENSE_CATEGORIES

@api_router.get("/expenses", response_model=List[Expense])
async def list_expenses(category: Optional[str] = None, user=Depends(require_owner)):
    q = {}
    if category and category != "all":
        q["category"] = category
    items = await db.expenses.find(q, {"_id": 0}).sort("date", -1).to_list(1000)
    return items

@api_router.post("/expenses", response_model=Expense, status_code=201)
async def create_expense(body: ExpenseCreate, user=Depends(require_owner)):
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
async def delete_expense(expense_id: str, user=Depends(require_owner)):
    r = await db.expenses.delete_one({"id": expense_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"ok": True}

# ---------- Dashboard ----------
def _day_bounds(d: date) -> dict:
    """UTC day window. Consistent with the rest of the app's date bucketing —
    see the timezone note in the README before changing it."""
    return {
        "$gte": datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc),
        "$lt": datetime.combine(d + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc),
    }


def _parse_day(value: Optional[str]) -> date:
    day = value or datetime.now(timezone.utc).date().isoformat()
    try:
        return datetime.fromisoformat(day).date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")


async def next_receipt_no() -> str:
    """Human-readable, sequential, per-day: 260901-0042.

    A UUID is unusable when a customer phones about a receipt. Allocated with an
    atomic $inc rather than counting documents, because counting races the
    moment a second device is at the counter.
    """
    key = datetime.now(timezone.utc).strftime("%y%m%d")
    doc = await db.counters.find_one_and_update(
        {"_id": f"receipt:{key}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"{key}-{doc['seq']:04d}"


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


def _window_totals(completed_orders: list, sales: list, expenses: list,
                   d_from: Optional[date], d_to: Optional[date]) -> dict:
    """Revenue/expense/profit for one date window, across both revenue channels.
    Shared by the current and previous periods so the comparison can't drift
    from the headline numbers.

    Preorder revenue is recognised on completion (`completed_at`); a counter
    sale is instantaneous, so it is recognised at `created_at`.
    """
    orders = [o for o in completed_orders
              if _in_window(_completed_date_str(o.get("completed_at")), d_from, d_to)]
    counter = [s for s in sales
               if _in_window(_completed_date_str(s.get("created_at")), d_from, d_to)]
    exps = [e for e in expenses if _in_window(e.get("date"), d_from, d_to)]

    preorder_revenue = sum(o["total"] for o in orders)
    counter_revenue = sum(s["total"] for s in counter)
    revenue = preorder_revenue + counter_revenue
    spend = sum(e["amount"] for e in exps)
    return {
        "orders": orders,
        "sales": counter,
        "expenses": exps,
        "preorder_revenue": preorder_revenue,
        "counter_revenue": counter_revenue,
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
    user=Depends(require_owner),
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
    sales_all = await db.sales.find({"voided": {"$ne": True}}, {"_id": 0}).to_list(5000)
    expenses_all = await db.expenses.find({}, {"_id": 0}).to_list(5000)

    ranged = bool(d_from or d_to)
    if ranged:
        current = _window_totals(completed_orders_all, sales_all, expenses_all, d_from, d_to)
    else:
        current = _window_totals(completed_orders_all, sales_all, expenses_all, None, None)

    completed_orders = current["orders"]
    sales = current["sales"]
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
    transactions = completed_count + len(sales)
    avg_order_value = round(total_revenue / transactions, 2) if transactions else None

    # Previous equal-length window, for period-over-period comparison. Only
    # meaningful for a closed range — "All Time" has nothing before it.
    comparison = None
    if d_from and d_to:
        span = (d_to - d_from).days + 1
        prev_to = d_from - timedelta(days=1)
        prev_from = prev_to - timedelta(days=span - 1)
        prev = _window_totals(completed_orders_all, sales_all, expenses_all, prev_from, prev_to)
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
    sales_by_day: dict = {}
    for o in completed_orders:
        ds = _completed_date_str(o.get("completed_at"))
        if ds:
            rev_by_day[ds] = rev_by_day.get(ds, 0.0) + o["total"]
            orders_by_day[ds] = orders_by_day.get(ds, 0) + 1
    for sale in sales:
        ds = _completed_date_str(sale.get("created_at"))
        if ds:
            rev_by_day[ds] = rev_by_day.get(ds, 0.0) + sale["total"]
            sales_by_day[ds] = sales_by_day.get(ds, 0) + 1
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
        buckets[cur] = {"revenue": 0.0, "expenses": 0.0, "order_count": 0, "sale_count": 0}
        ordered.append(cur)
        cur = _next_bucket(cur, granularity)

    for source, key in (
        (rev_by_day, "revenue"),
        (exp_by_day, "expenses"),
        (orders_by_day, "order_count"),
        (sales_by_day, "sale_count"),
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
            "sale_count": buckets[b]["sale_count"],
        }
        for b in ordered
    ]

    # Top variants
    variant_counts = {}
    for txn in [*completed_orders, *sales]:
        for it in txn["items"]:
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
        "revenue_by_channel": [
            {"channel": "preorder", "amount": current["preorder_revenue"], "count": completed_count},
            {"channel": "counter", "amount": current["counter_revenue"], "count": len(sales)},
        ],
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
            "role": "owner",
            "password_hash": hash_password("baker123"),
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(demo)
        logger.warning(
            "Bootstrapped owner baker@saltbread.com with the default seed password. "
            "Change it from Settings before real use."
        )

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
