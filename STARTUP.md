# PDI Inspection Management System — Setup & Deployment Guide

---

## Prerequisites

- **Node.js 22.5.0 or later** (required for built-in SQLite)
- **npm 10+**
- A **Microsoft 365 / Azure account** with permission to register Entra ID apps

---

## Part 1: Azure App Registration (one-time setup)

Authentication uses Microsoft Entra ID (formerly Azure AD). Employees sign in with their existing M365 accounts — no passwords are stored in the app.

1. Go to [portal.azure.com](https://portal.azure.com) and sign in as an admin
2. Search for **Microsoft Entra ID** → **App registrations** → **+ New registration**
3. Fill in:
   - **Name:** `PDI Inspection App`
   - **Supported account types:** *Accounts in this organizational directory only (Single tenant)*
   - **Redirect URI:** Select **Single-page application (SPA)**, enter the app URL
     - Development: `http://localhost:5173`
     - Production: `https://inspection.yourcompany.com`
4. Click **Register**
5. On the Overview page, note the:
   - **Application (client) ID**
   - **Directory (tenant) ID**
6. Go to **Authentication** → under *Implicit grant and hybrid flows*, check **ID tokens**
7. Go to **API permissions** → confirm `User.Read` (Microsoft Graph) is listed

---

## Part 2: Local Development

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

**Server (`server/.env`):**
```env
NODE_ENV=development
PORT=3001
CLIENT_URL=http://localhost:5173
JWT_SECRET=any-long-random-string-for-dev
ENTRA_TENANT_ID=your-tenant-id
ENTRA_CLIENT_ID=your-client-id
DB_ADAPTER=sqlite
SQLITE_PATH=./data/inspection.db
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=25
```

**Client (`client/.env`):**
```env
VITE_ENTRA_TENANT_ID=your-tenant-id
VITE_ENTRA_CLIENT_ID=your-client-id
```

### 3. Seed the database (first time only)

```bash
cd server
npm run seed
```

This creates the 6 inspection templates. User accounts are created automatically on first sign-in via Microsoft.

### 4. Run

Open two terminals:

```bash
# Terminal 1 — Backend (http://localhost:3001)
cd server && npm run dev

# Terminal 2 — Frontend (http://localhost:5173)
cd client && npm run dev
```

Navigate to `http://localhost:5173` and click **Sign in with Microsoft**.

---

## Part 3: Windows Server Production Deployment

### 1. Install Node.js 22 on the server

Download from [nodejs.org](https://nodejs.org) and install.

### 2. Install PM2 (process manager)

```powershell
npm install -g pm2
```

### 3. Copy the application files

Copy the entire `InspectionApp` folder to the server (e.g. `C:\PDIApp\`).

### 4. Install dependencies

```powershell
cd C:\PDIApp\server
npm install --omit=dev

cd C:\PDIApp\client
npm install
```

### 5. Configure environment

Create `C:\PDIApp\server\.env` from `server/.env.production.example`. Key values:

- `NODE_ENV=production`
- `JWT_SECRET` — generate a strong random string:
  ```powershell
  [Convert]::ToBase64String((1..48 | % { Get-Random -Maximum 256 }))
  ```
- `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID` — from your Azure app registration
- `CLIENT_URL` — the public URL (e.g. `https://inspection.yourcompany.com`)
- `SQLITE_PATH=C:\PDIApp\data\inspection.db`
- `UPLOAD_DIR=C:\PDIApp\uploads`

Create the required directories:
```powershell
mkdir C:\PDIApp\data
mkdir C:\PDIApp\uploads
mkdir C:\PDIApp\logs
```

### 6. Seed the database (first time only)

```powershell
cd C:\PDIApp\server
node --experimental-sqlite db/seed.js
```

### 7. Build the frontend

The Entra client credentials are baked into the build at build time. Create `C:\PDIApp\client\.env`:

```env
VITE_ENTRA_TENANT_ID=your-tenant-id
VITE_ENTRA_CLIENT_ID=your-client-id
```

Then build:

```powershell
cd C:\PDIApp\client
npm run build
```

The built files land in `C:\PDIApp\client\dist\`. Express serves them automatically.

### 8. Start with PM2

```powershell
cd C:\PDIApp
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

### 9. (Optional) Expose via IIS reverse proxy

If you have IIS on port 80/443, install **IIS URL Rewrite** and **Application Request Routing (ARR)**, then add a `web.config` to your IIS site:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxyToNode" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:3001/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

Enable proxy in ARR: IIS Manager → server node → Application Request Routing → Proxy → Enable Proxy.

---

## User Roles

| Role         | Capabilities |
|--------------|-------------|
| `inspector`  | Create and fill inspections |
| `qc_manager` | Inspect + approve/reject submitted inspections |
| `admin`      | Full access including user management |

Users are auto-provisioned with the `inspector` role on first sign-in. An admin can change roles in the **Admin** panel.

---

## Inspection Forms

| Form No.     | Component             |
|--------------|-----------------------|
| PDI-IQI-001  | Piston                |
| PDI-IQI-002  | Cylinder Liner        |
| PDI-IQI-003  | Piston Pin            |
| PDI-IQI-004  | Piston Ring           |
| PDI-IQI-005  | Cylinder Head Visual  |
| PDI-IQI-006  | Cylinder Head Dim.    |

---

## PM2 Quick Reference

```powershell
pm2 status                   # view running processes
pm2 logs pdi-inspection      # tail logs
pm2 restart pdi-inspection   # restart after .env change
pm2 reload pdi-inspection    # zero-downtime reload
```
