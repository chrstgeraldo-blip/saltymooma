# Saltbread POS & Tracker — PRD

## Overview
Mobile app for a home baker selling saltbread variants. Tracks revenue, expenses, and a Pre-Order (PO) system, with a dashboard for at-a-glance insights.

## Key Features
- **Auth**: Email/password (JWT). Demo user seeded: `baker@saltbread.com` / `baker123`.
- **Dashboard**: KPIs (Revenue, Expenses, Profit, Active PO), 7-day revenue vs expenses trend chart, top-selling variants, expenses by category, quick actions.
- **Orders (PO)**: Create with customer, delivery date, items (product + qty), notes. Filter list by status chips: All / Pending / In Progress / Completed / Cancelled. Detail view with status update grid; completing sets `completed_at` and contributes to revenue.
- **Expenses**: Log by category (Raw Materials, Packaging, Transport, Utilities, Other). Filter by category chip. Delete supported.
- **Products**: 7 saltbread variants pre-seeded (Plain, Choco, Cream Cheese, Egg Mayo, Umami Abon, Kaya Butter, Triple Choco). Add/edit/delete with image URL, price, active toggle.

## Tech
- **Backend**: FastAPI + Motor (MongoDB) + JWT (PyJWT + bcrypt). All routes under `/api`.
- **Frontend**: Expo Router (SDK 54) tabs, expo-image, expo-secure-store, expo-linear-gradient, @expo/vector-icons.
- **Currency**: IDR (Rp), tabular-nums formatting.

## Endpoints (summary)
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST /api/products`, `PATCH/DELETE /api/products/{id}`
- `GET/POST /api/orders`, `GET /api/orders/{id}`, `PATCH /api/orders/{id}/status`, `DELETE /api/orders/{id}`
- `GET /api/expenses/categories`, `GET/POST /api/expenses`, `DELETE /api/expenses/{id}`
- `GET /api/dashboard/summary`

## Test Credentials
See `/app/memory/test_credentials.md`.
