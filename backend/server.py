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
from datetime import datetime, timedelta, timezone
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
@api_router.get("/dashboard/summary")
async def dashboard_summary(user=Depends(get_current_user)):
    # Revenue = sum of completed orders' totals
    completed_orders = await db.orders.find({"status": "completed"}, {"_id": 0}).to_list(5000)
    all_orders = await db.orders.find({}, {"_id": 0}).to_list(5000)
    expenses = await db.expenses.find({}, {"_id": 0}).to_list(5000)

    total_revenue = sum(o["total"] for o in completed_orders)
    total_expenses = sum(e["amount"] for e in expenses)
    profit = total_revenue - total_expenses

    # Active POs = pending + in_progress
    active_po = sum(1 for o in all_orders if o["status"] in ("pending", "in_progress"))
    completed_count = len(completed_orders)

    # Trend: last 7 days revenue & expenses
    today = datetime.now(timezone.utc).date()
    trend = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        d_str = d.isoformat()
        rev = 0.0
        for o in completed_orders:
            ca = o.get("completed_at")
            if ca:
                if isinstance(ca, str):
                    try: cd = datetime.fromisoformat(ca.replace("Z","")).date().isoformat()
                    except: cd = None
                else:
                    cd = ca.date().isoformat() if hasattr(ca, "date") else None
                if cd == d_str:
                    rev += o["total"]
        exp = sum(e["amount"] for e in expenses if e.get("date") == d_str)
        trend.append({"date": d_str, "revenue": rev, "expenses": exp})

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
        "trend": trend,
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
