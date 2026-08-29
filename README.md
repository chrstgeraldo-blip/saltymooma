# SaltyMooma

SaltyMooma is a full-stack application consisting of a cross-platform mobile/web frontend and an asynchronous Python REST API backend.

---

## 🛠 Tech Stack

- **Frontend:**
  - **Framework:** [React Native](https://reactnative.dev/) (v0.81) with [Expo](https://expo.dev/) (SDK 54) & [TypeScript](https://www.typescriptlang.org/)
  - **Navigation:** [Expo Router](https://docs.expo.dev/router/introduction/) (file-based routing)
  - **Platforms:** iOS, Android, and Web (`react-native-web`)
  - **UI & Animations:** `react-native-reanimated`, `expo-linear-gradient`, `@expo/vector-icons`

- **Backend:**
  - **Framework:** [FastAPI](https://fastapi.tiangolo.com/) (Python 3.10+) running on [Uvicorn](https://www.uvicorn.org/)
  - **Database:** [MongoDB](https://www.mongodb.com/) via [Motor](https://motor.readthedocs.io/) (async MongoDB driver)
  - **Authentication:** OAuth2 Password Bearer with JWT (`pyjwt`, `bcrypt`)
  - **Validation:** [Pydantic v2](https://docs.pydantic.dev/)

---

## 📋 Prerequisites

Before running the project, make sure you have installed:
1. **Node.js** (v18 or v20+ recommended) & **Yarn** (or **npm**)
2. **Python** (v3.10+ recommended)
3. **MongoDB** (Running locally on `mongodb://localhost:27017` or a cloud [MongoDB Atlas](https://www.mongodb.com/atlas) URI)
4. *(Optional for mobile testing)* **Expo Go** app on your physical iOS/Android device, or Android Studio / Xcode for emulators/simulators.

---

## 🚀 Step-by-Step Setup & Running Guide

### 1. Start MongoDB
Ensure your MongoDB service is running locally, or have your MongoDB Atlas connection string ready.

If using local MongoDB on Windows:
```powershell
# Verify MongoDB service is running (or start it via Windows Services)
net start MongoDB
```

---

### 2. Backend Setup & Run

Open a terminal and navigate to the `backend` directory:

```bash
cd backend
```

#### Step 2.1: Create and Activate Virtual Environment
- **Windows (PowerShell):**
  ```powershell
  python -m venv venv
  .\venv\Scripts\Activate.ps1
  ```
- **macOS / Linux:**
  ```bash
  python3 -m venv venv
  source venv/bin/activate
  ```

#### Step 2.2: Install Dependencies
```bash
pip install -r requirements.txt
```

#### Step 2.3: Configure Environment Variables
Create a `.env` file inside the `backend/` directory:
```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=saltymooma
SECRET_KEY=saltbread-dev-secret-please-change
```

#### Step 2.4: Run the Backend Server
```bash
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```
- **Backend API Base URL:** `http://localhost:8000`
- **Interactive Swagger Documentation:** `http://localhost:8000/docs`
- **ReDoc Documentation:** `http://localhost:8000/redoc`

---

### 3. Frontend Setup & Run

Open a separate terminal and navigate to the `frontend` directory:

```bash
cd frontend
```

#### Step 3.1: Install Dependencies
```bash
yarn install
# or: npm install
```

#### Step 3.2: Configure Environment Variables
Create a `.env` file inside the `frontend/` directory:
```env
# For Web browser testing on your local machine:
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000

# Note: If testing on a physical phone via Expo Go, replace localhost with your computer's LAN IP address (e.g., http://192.168.1.50:8000):
# EXPO_PUBLIC_BACKEND_URL=http://<YOUR_LOCAL_IP>:8000
```

#### Step 3.3: Start the Expo Development Server
```bash
yarn start
# or: npx expo start
```

#### Step 3.4: Choose How to View the App
When Expo starts in your terminal, press:
- **`w`** — Open in your **Web Browser** (`http://localhost:8081`)
- **`a`** — Launch on connected **Android emulator** / device
- **`i`** — Launch on **iOS simulator** (macOS only)
- **Expo Go App** — Scan the terminal QR code with your mobile camera / Expo Go app.

---

## 📁 Project Structure

```
saltymooma/
├── backend/
│   ├── server.py           # FastAPI entry point, routers, auth & models
│   ├── requirements.txt    # Python package dependencies
│   └── tests/              # Backend test suite
├── frontend/
│   ├── app/                # Expo Router screen pages & layouts
│   ├── src/
│   │   ├── lib/            # API client and authentication context
│   │   ├── hooks/          # Custom React hooks
│   │   └── utils/          # Helper utilities
│   ├── package.json        # Frontend dependencies & scripts
│   └── metro.config.js     # Metro bundler config
└── README.md
```
