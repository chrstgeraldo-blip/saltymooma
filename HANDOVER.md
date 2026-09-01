# SaltyMooma — Project Handover

> Written to bring a new session up to speed quickly. Read the **Traps** section before
> changing anything — most of it is non-obvious and was learned the hard way.
>
> `memory/PRD.md` predates the POS, roles and stock work. It is **stale**; this file supersedes it.

---

## 1. What this is

A management app for a home baker in Indonesia (currency IDR) who takes **pre-orders** and is
now **opening a physical store**. Two revenue channels:

- **Preorders** — customer orders ahead for a delivery date. Baked to order. Revenue is
  recognised when the order is marked *completed*.
- **Counter sales (POS)** — walk-in sales from bread already baked. Revenue is recognised
  instantly.

It is a single-tenant app for one business, used by three kinds of people (see Roles).

---

## 2. Stack

| | |
|---|---|
| Backend | FastAPI + Motor (async MongoDB), one file: `backend/server.py` (~1,030 lines) |
| Database | MongoDB Atlas. Collections: `users`, `products`, `orders`, `sales`, `stock_movements`, `expenses`, `counters` |
| Auth | JWT (PyJWT + bcrypt), 30-day tokens, `Authorization: Bearer` |
| Frontend | Expo SDK 54, React Native 0.81, TypeScript, expo-router. Targets **iOS, Android and Web** |
| Tests | pytest against a *running* server — 58 tests, 2 xdist workers |

**Target hardware:** an Android tablet at the counter (decided), owner's phone, and the web
build for the owner's laptop.

---

## 3. Roles — the core access model

| Capability | owner | admin | cashier |
|---|---|---|---|
| Dashboard, revenue, expenses | ✓ | — | — |
| Staff management | ✓ | — | — |
| Products — create / edit / delete | ✓ | — | — |
| Products — view | ✓ | ✓ | ✓ |
| Preorders — create, list, status | ✓ | ✓ | — |
| Production (bake sheet) | ✓ | ✓ | — |
| Stock — record in / waste | ✓ | ✓ | ✓ |
| Till, sales list, void own sale | ✓ | ✓ | ✓ |
| Void anyone's sale | ✓ | ✓ | — |
| Delete an order | ✓ | — | — |

Enforced by two FastAPI dependencies in `server.py`: `require_owner` and `require_staff`
(owner *or* admin). **The API is the boundary** — hiding a tab is UX only, and every role
restriction has a test asserting the 403.

**Navigation follows role** (`app/index.tsx` routes on login):

- **owner** → `/(tabs)/dashboard` — Dashboard, Orders, Production, Expenses, Products
- **admin** → `/(tabs)/orders` — Orders, Production, Products (read-only). Till + Settings
  buttons live in the Orders header because admins have no dashboard to reach them from.
- **cashier** → `/(pos)/sell` — Sell, Stock, Sales. Never enters `(tabs)`.

Demo accounts (created by `backend/scripts/seed_dummy.py`):

| Role | Email | Password |
|---|---|---|
| owner | `baker@saltbread.com` | `baker123` |
| admin | `admin@saltbread.com` | `admin123` |
| cashier | `kasir@saltbread.com` | `kasir123` |

---

## 4. Features

### Auth & staff
Login only — **there is no public registration**. Accounts exist because an owner created them
via Settings. Any user can change their own password. Owner cannot delete themselves or the
last owner. `SECRET_KEY` has no fallback: the server refuses to boot without it.

### Preorders (`/(tabs)/orders`, `order/new`, `order/[id]`)
Customer name, phone, delivery date (calendar picker), line items, notes. **Prices are read
server-side from the catalogue** — the client cannot dictate them. Items snapshot
`product_name` and `unit_price`, so later price changes never rewrite history. Status:
`pending → in_progress → completed`, or `cancelled`. Completing stamps `completed_at`.

### Production (`/(tabs)/production`)
The daily bake sheet. `GET /orders/production-summary?date=` aggregates every **non-cancelled**
order for a delivery date into total pieces plus a per-variant breakdown, sorted most-baked
first. Date navigator slides with the selection; inline status changes; tap-to-call the customer.

### Counter POS (`/(pos)/sell`)
Responsive: ≥768px gets a product grid with a persistent cart beside it; narrower gets a
bottom bar that opens the cart as a sheet. Tiles show remaining stock. Charge sheet supports
**cash / QRIS / transfer**, with quick-cash buttons derived from the total and a live change
preview. Completion shows a receipt with the change as the largest element on screen.

### Stock (`/(pos)/stock`)
Per-product counts for the trading day: added, sold, waste, on-hand. Cashier taps **+** to log
what bakers hand over and **trash** to record waste. Every movement is attributed to a user
and visible via `GET /stock/movements`.

### Sales log (`/(pos)/sales`)
Day navigator, takings total (live sales only), and **void** with a two-step confirm. Voided
sales stay visible, struck through — a financial correction must remain auditable.

### Expenses (`/(tabs)/expenses`) — owner only
Amount, category (Raw Materials / Packaging / Transport / Utilities / Other), date.

### Dashboard (`/(tabs)/dashboard`) — owner only
Revenue / expenses / profit / active PO, profit margin, average order value. Range chips
(All Time, This Week, This Month, Custom with a calendar). Period-over-period comparison
against the previous equal-length window. Revenue-vs-expenses chart with **adaptive
granularity** and tappable bars. Revenue split by channel (preorder vs counter). Top variants
across both channels; expenses by category.

---

## 5. Architecture decisions worth knowing

These are the "why"s that are expensive to rediscover.

**Sales are a separate collection, not Orders with a flag.** A counter sale consumes bread
already baked; a preorder *creates demand to bake*. If sales lived in `orders` with
`delivery_date = today`, the bake sheet would tell the baker to make bread that was already
sold — silently, every day. There is a test named
`test_sale_never_reaches_the_production_sheet` guarding exactly this. `LineItem` is shared by
both, so the item shape has one definition.

**Stock is derived, never stored as a running total.** Bread is perishable, so each trading day
starts at zero. `on_hand = manual movements − sold`, where `sold` comes straight from the sales
collection. Consequence: **voiding a sale returns its stock automatically**, with no
compensating entry that could be wrong. `stock_movements` holds only manual changes.

**Receipt numbers are sequential per day** (`260901-0042`), allocated with an atomic
`findOneAndUpdate` + `$inc` on a `counters` doc. Counting documents would race the moment a
second device is at the counter. A UUID is unusable when a customer phones about a receipt.

**Void, never delete, for sales.** Corrections must stay visible.

**Revenue recognition differs by channel and that is deliberate** — preorders on
`completed_at`, counter sales on `created_at`. Both flow through one helper, `_window_totals`,
so the period comparison can never drift from the headline numbers.

**Chart granularity is chosen server-side** — daily ≤31 days, weekly ≤182, monthly beyond. A
year renders as 12 bars, not 365. The backend also emits a display `label` per bucket so the
client never re-derives date formatting.

**`useFetch` is key-aware** (`src/hooks/use-fetch.ts`). The loading flag rises only when the
query *key* changes, so switching a filter shows a skeleton while merely re-focusing a tab
refreshes silently. On failure it drops stale data if it belonged to a different key, so a
screen never shows results labelled with the wrong query.

**Reusable pieces — use these rather than writing new ones:** `useFetch`, `Skeleton` /
`SkeletonCardList`, `ErrorNotice`, `CalendarField` / `CalendarGrid`, `src/lib/date.ts`
(local-date helpers), `src/lib/theme.ts` (tokens + `formatIDR` + `STATUS_META`),
`src/lib/api.ts` (error normalisation).

---

## 6. Traps — read before editing

1. **Tests run 2 xdist workers against one shared backend.** Never assert exact
   before/after deltas on global totals or on *today's* data. Use an isolated far-future date,
   or assert invariants. This bug was hit three separate times. See
   `test_cancelling_removes_it_from_the_bake_sheet` and `test_sales_feed_dashboard_revenue`
   for the two patterns to copy.

2. **`EXPO_PUBLIC_*` is inlined at bundle time.** After editing `frontend/.env` you must fully
   restart `expo start` — a hot reload will not pick it up. Use `--clear` if a stale value sticks.

3. **Metro caches its file map.** Creating a *new* file or directory under `src/` while the dev
   server is running gives `Unable to resolve module` with a 500 on the bundle. Restart with
   `npx expo start --clear`.

4. **react-native-web `Modal` does not reliably unmount on `visible={false}`.** It left the
   charge sheet on screen after every completed sale. The fix is `if (!visible) return null;`
   in the component before rendering `<Modal>`. Apply this to any new modal.

5. **`backend/scripts/seed_dummy.py` writes to the live Atlas database.** It deletes
   `[DUMMY]`-tagged records and creates accounts with known passwords. Never point it at
   production without adding a guard first.

6. **FastAPI route order is load-bearing.** `/orders/production-summary` is declared *before*
   `/orders/{order_id}`. Move it after and FastAPI matches `production-summary` as an order ID
   and 404s.

7. **`isOwner` vs `isStaff`.** `isOwner` is strictly `role === "owner"`. It was once
   `role !== "cashier"`, which silently promoted admins to owners the moment a third role
   existed. Use `isStaff` for owner-or-admin.

8. **Day bucketing is UTC**, so the trading day rolls at **07:00 WIB**. If the shop opens
   earlier, the first hour of sales lands on the previous day's stock and revenue. **Unresolved
   — needs the client's opening time.** The fix is a configured shop offset applied across
   stock, sales and dashboard *together*; a partial fix would create a split brain.

9. **Never use `toISOString().slice(0,10)`** for dates — it converts to UTC and returns
   yesterday for any local time before 07:00 at UTC+7. This caused two real bugs (a wrong
   dashboard range, and new orders defaulting to yesterday). Use `toISODate` from
   `src/lib/date.ts`.

---

## 7. State of the repository

**Branch `dev-jevon`. Everything from the POS / roles / stock work is UNCOMMITTED** — 19
changed or new paths, including the whole `frontend/app/(pos)/` directory. Commit before
doing anything destructive.

```bash
# backend  (terminal 1)
cd backend && source venv/Scripts/activate     # Git Bash; venv/Scripts, not venv/bin
uvicorn server:app --reload --host 0.0.0.0 --port 8000

# frontend (terminal 2)
cd frontend && npx expo start --clear

# tests (needs the backend running)
cd backend && source venv/Scripts/activate
EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/ -q

# demo data — re-runnable, reversible with --clean
python backend/scripts/seed_dummy.py
```

MongoDB is **Atlas (cloud)** — there is no local database to start, despite what `README.md`
says in places. `yarn` is not installed; use `npx expo` / `npm`.

---

## 8. Deployment plan (agreed, not yet executed)

Decisions already made by the owner: cloud hosting; if the connection drops the till stops
selling (accepted); **paid managed backups**; deploy the Android APK, the web build and the
owner's phone app.

**Free tiers are not sufficient, for two specific reasons:** free backend tiers *sleep*
(Render spins down after ~15 min idle, 30–60 s cold start — the first customer of the day
would wait), and **Atlas M0 has no backups at all** (capacity is fine; a year at 100 sales/day
is well under 512 MB).

| Component | Choice | Approx cost |
|---|---|---|
| Backend | Railway (Hobby) or Render (Starter), always-on, HTTPS | ~$5–7/mo |
| Database | Atlas entry paid tier (currently "Flex") for automated backups | ~$8–10/mo |
| Web | `npx expo export -p web` → static, on Cloudflare Pages / Vercel / Netlify | $0 |
| Android APK | EAS Build free tier, `apk` profile, sideloaded (no Play Store) | $0 |
| | **Total** | **~$13–17/mo** |

*Verify current pricing — it moves.*

Backend service config: root directory `backend`, start command
`uvicorn server:app --host 0.0.0.0 --port $PORT`, env vars `MONGO_URL`, `DB_NAME`,
`SECRET_KEY`, health check `/api/`.

**Do not put the FastAPI backend on Vercel** — serverless means cold starts plus a new Motor
connection pool per invocation against Atlas. Vercel is for the web frontend only.

### Pre-deployment checklist (none of this is done yet)

1. **Separate the production database** (distinct `DB_NAME`) and guard `seed_dummy.py` against it.
2. **Rotate `SECRET_KEY`** — the dev value is in a local file and in chat history.
3. **Bootstrap owner password** — the startup seed creates `baker123` on any empty database.
   Read it from an env var, or change it immediately after first login.
4. **Tighten CORS** — currently `allow_origins=["*"]` with `allow_credentials=True`, a
   combination browsers reject anyway.
5. **Add indexes** — there are none. ~10 `create_index` calls in the existing startup hook:
   `users.email` (unique), `orders.delivery_date`, `orders.status`, `orders.completed_at`,
   `sales.created_at`, `stock_movements.date`, `expenses.date`, plus `id` per collection.
6. **Split `requirements.txt`** — 27 packages listed, 9 imported. `pandas`, `numpy`, `boto3`,
   `jq`, `typer`, `passlib`, `python-jose`, `requests-oauthlib`, `python-multipart` are unused
   and add hundreds of MB to every deploy.
7. **App identity** — `frontend/app.json` still has the scaffold name `"frontend"` and bundle
   ID `com.emergent.homebakerdashboard.m255qz`. Change before the first build; the bundle ID
   is painful to change once installed on the client's devices.
8. **HTTPS is mandatory** — Android 9+ blocks cleartext in release builds, so the current
   LAN-IP setup cannot ship. Build the APK against the production HTTPS URL.

---

## 9. Known gaps and future features

### Do first — a real gap opened by the role work
**Preorder pickup at the counter.** Cashiers no longer have `/orders` access, so when a
customer collects a preorder the cashier cannot look it up. The clean fix is a narrow
POS flow (today's collectable orders → mark complete → receipt) rather than handing cashiers
the whole order book back. Walk-in collection is a daily event, so this matters before launch.

### High value
- **Receipt printing.** Design already settled: receipt *content* is a backend concern (shared
  by counter sales and preorder pickups); *transport* is client-side behind one interface.
  Phase 1 is a share-sheet image/PDF (zero native deps, works on web). Phase 2 is ESC/POS over
  BLE, which forces an Expo Dev Client build. **Buy and verify the printer first** — many cheap
  58 mm printers sold locally are Bluetooth *Classic*, which BLE libraries cannot talk to at all.
  58 mm = 32 chars/line, 80 mm = 48.
- **Dashboard aggregation rewrite.** `/dashboard/summary` loads three `to_list(5000)` queries
  into memory and aggregates in Python. At ~100 sales/day that passes 5,000 orders in under two
  months, after which it silently truncates and reports **wrong numbers with no error**. Wants
  a Mongo aggregation pipeline with `$match` on the range. This is the known scaling cliff.
- **Timezone**, per trap #8.
- **Waste-vs-baked reporting.** The data already exists in `stock_movements`; nothing surfaces
  "how much are we over-baking", which is the number that decides tomorrow's batch size.

### Medium
- **Offline queue for the till** — explicitly deferred (the owner accepted that selling stops),
  but the shop losing internet mid-day is a real scenario. Sales are append-only, so a local
  queue is feasible; receipt numbering is the hard part.
- **Pagination** — orders are capped at `to_list(1000)` with no paging, and the Orders tab
  renders all of them.
- **Void/soft-delete for orders and expenses** — both are hard-deleted today. For financial
  records, void beats delete; the `sales` collection already models this well.
- **Shift open/close reconciliation** — count the drawer at open and close. `payment_method`
  is already recorded on every sale specifically to make this possible later.
- **Per-channel average order value** — AOV currently spans both channels, which mixes a
  3-piece walk-in with a 40-piece preorder.
- **Client-side email validation on the add-staff form** — login has it, this doesn't, so a
  typo costs a server round trip.

### Lower
- Payment integration (QRIS is recorded but not integrated).
- Customer records / repeat-customer history — orders currently store a name and phone as free text.
- Multi-store support — the whole app is single-tenant with no `store_id` anywhere.
- Product photo upload — `image_url` is a text field pointing at Unsplash today.
