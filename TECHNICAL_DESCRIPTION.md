# PDI Inspection Management System — Technical Description

**Document Date:** 2026-04-20  
**Application Version:** Current (pre-development baseline)  
**Purpose:** Complete technical reference for the app in its current state, written before new features are added.

---

## 1. Application Overview

The **PDI Incoming Quality Inspection (IQI) Management System** is a full-stack web application for managing manufacturing quality inspections. It enables PDI quality inspectors to document dimensional and visual inspections of engine components, route them through a multi-step approval workflow, generate PDF reports, and track non-conformance events.

### Primary Use Cases

- Inspectors create and fill standardized inspection forms for one of six engine component types (pistons, cylinder liners, piston pins, piston rings, cylinder heads visual, cylinder heads dimensional).
- Quality managers review submitted inspections and either approve or reject them with notes.
- Administrators manage user accounts, roles, and access levels.
- Any authenticated user can view the dashboard for high-level statistics and recent activity.

### Supported Component Types & Forms

| Form Number  | Component Type        | Inspection Type                  |
|--------------|-----------------------|----------------------------------|
| PDI-IQI-001  | Piston                | Standard IQI (Visual + Dimensional) |
| PDI-IQI-002  | Cylinder Liner        | Standard IQI (Visual + Dimensional) |
| PDI-IQI-003  | Piston Pin            | Standard IQI (Visual + Dimensional) |
| PDI-IQI-004  | Piston Ring           | Standard IQI (Visual + Dimensional) |
| PDI-IQI-005  | Cylinder Head         | Visual Checklist                 |
| PDI-IQI-006  | Cylinder Head         | Dimensional Measurements         |

---

## 2. Technology Stack

### Frontend

| Technology | Version | Role |
|------------|---------|------|
| React | 18.3.1 | UI framework |
| Vite | 5.x | Dev server + production bundler |
| React Router | 6.25.1 | Client-side routing (SPA) |
| @tanstack/react-query | 5.51.1 | Server state, caching, cache invalidation |
| Axios | 1.7.2 | HTTP client with JWT interceptor |
| @azure/msal-react | 5.2.1 | Microsoft Entra ID (Azure AD) sign-in |
| React Hook Form | 7.52.1 | Form state management |
| Zod | 3.23.8 | Schema/validation library |
| Tailwind CSS | 3.4.7 | Utility-first CSS framework |
| Recharts | 2.12.7 | Dashboard charts |
| lucide-react | 0.408.0 | Icon library |
| date-fns | 3.6.0 | Date formatting utilities |

### Backend

| Technology | Version | Role |
|------------|---------|------|
| Node.js | 22.5+ | Runtime (required for built-in sqlite module) |
| Express | 4.19.2 | HTTP framework |
| SQLite (built-in) | Node 22 | Database (no external driver needed) |
| JSON Web Token (jsonwebtoken) | 9.0.2 | Session token signing/verification |
| jwks-rsa | 3.1.0 | Microsoft Entra token verification via JWKS |
| bcryptjs | 2.4.3 | Password hashing |
| Multer | 1.4.5 | Multipart file upload handling |
| PDFKit | 0.15.0 | Server-side PDF generation |
| Helmet | 8.1.0 | HTTP security headers |
| cors | 2.8.5 | Cross-origin request policy |
| express-rate-limit | 8.3.2 | Auth endpoint rate limiting |
| uuid | 10.0.0 | UUID generation for inspection IDs |
| dotenv | 16.4.5 | Environment variable loading |

### Infrastructure

| Tool | Role |
|------|------|
| PM2 | Process management on Windows Server (ecosystem.config.cjs) |
| IIS (optional) | Reverse proxy on Windows Server |
| Render.com | Cloud deployment target (render.yaml) |

---

## 3. Project Directory Structure

```
InspectionApp/
├── STARTUP.md                        # Comprehensive deployment and setup guide
├── TECHNICAL_DESCRIPTION.md          # This document
├── ecosystem.config.cjs              # PM2 process manager config (Windows Server)
├── render.yaml                       # Render.com deployment blueprint
├── .gitignore
│
├── client/                           # React SPA (Vite)
│   ├── package.json
│   ├── vite.config.js                # Dev server port 5173, /api proxy to :3001
│   ├── tailwind.config.js            # PDI brand color palette
│   ├── postcss.config.js
│   ├── index.html                    # SPA entry point
│   ├── .env.example                  # VITE_ENTRA_TENANT_ID, VITE_ENTRA_CLIENT_ID
│   ├── public/
│   │   └── pdi-logo.png
│   └── src/
│       ├── main.jsx                  # App bootstrap: QueryClient, MsalProvider, ToastProvider
│       ├── App.jsx                   # React Router route definitions
│       ├── index.css                 # Global styles
│       │
│       ├── lib/
│       │   ├── api.js                # Axios instance + 401 JWT interceptor
│       │   ├── auth.js               # getToken/setToken/clearAuth (localStorage)
│       │   ├── constants.js          # Form types, role names, disposition types
│       │   ├── msalConfig.js         # MSAL PublicClientApplication singleton
│       │   └── utils.js             # cn(), formatDate(), etc.
│       │
│       ├── contexts/
│       │   └── ToastContext.jsx      # Global toast notification context + provider
│       │
│       ├── hooks/
│       │   ├── useInspections.js     # React Query wrappers: list, get, create, update, submit, approve, reject
│       │   ├── useAttachments.js     # Upload, list, delete attachments
│       │   ├── useNCRs.js            # NCR CRUD
│       │   ├── useTemplates.js       # Fetch inspection templates
│       │   ├── usePartSpecs.js       # Part specifications by template
│       │   └── useToast.js           # useContext wrapper for toast
│       │
│       ├── components/
│       │   ├── Layout.jsx            # App shell: sidebar + header + user menu
│       │   ├── Sidebar.jsx           # Navigation links (Dashboard, Inspections, NCRs, Admin)
│       │   ├── FileGrid.jsx          # Responsive file attachment display grid
│       │   ├── FileUploadZone.jsx    # Drag-and-drop file upload UI
│       │   ├── StatusBadge.jsx       # Colored status pill (draft/submitted/approved/rejected)
│       │   ├── AuthImage.jsx         # Image display with authenticated fetch
│       │   │
│       │   ├── inspection/           # Inspection section renderers
│       │   │   ├── SectionVisual.jsx             # Pass/Fail/N checklist with remarks
│       │   │   ├── SectionReceiving.jsx          # Receiving checklist section
│       │   │   ├── SectionChecklist.jsx          # Generic pass/fail checklist
│       │   │   ├── SectionDimensional.jsx        # Measurement table with spec columns
│       │   │   ├── SectionCamshaftBore.jsx       # Cylinder head camshaft bore inputs
│       │   │   ├── SectionFireRingProtrusion.jsx # Fire ring protrusion measurement
│       │   │   ├── SectionValveRecession.jsx     # Valve recession measurement
│       │   │   ├── SectionGeneralMeasurements.jsx# Generic dimension measurement table
│       │   │   ├── SectionVacuumTest.jsx         # Vacuum test section
│       │   │   ├── PFNToggle.jsx                 # Three-way Pass/Fail/N toggle button
│       │   │   └── ItemAttachment.jsx            # Item-level attachment display
│       │   │
│       │   └── ui/                   # Base UI components (shadcn-style)
│       │       ├── button.jsx
│       │       ├── card.jsx
│       │       ├── dialog.jsx
│       │       ├── input.jsx
│       │       ├── label.jsx
│       │       ├── select.jsx
│       │       ├── textarea.jsx
│       │       ├── badge.jsx
│       │       ├── separator.jsx
│       │       └── toast.jsx
│       │
│       └── pages/
│           ├── Login.jsx             # Entra sign-in + email/password fallback form
│           ├── Dashboard.jsx         # Stats cards, recent inspections, by-component charts
│           ├── InspectionList.jsx    # Paginated list with status/component/date filters
│           ├── NewInspection.jsx     # Template selection to create new inspection
│           ├── InspectionForm.jsx    # Edit/fill inspection (header + sections + attachments)
│           ├── InspectionDetail.jsx  # Read-only view, submit/approve/reject actions
│           ├── NCRList.jsx           # Non-conformance report list
│           ├── NCRDetail.jsx         # NCR detail view
│           ├── Admin.jsx             # User management (roles, active status)
│           └── NotFound.jsx          # 404 page
│
└── server/                           # Express API backend
    ├── package.json
    ├── index.js                      # App setup: middleware, routes, static serving, health check
    ├── .env                          # Runtime secrets (not committed)
    ├── .env.example
    ├── .env.production.example
    ├── API_ENDPOINTS.txt             # Complete API reference documentation
    ├── README_BUILD.txt              # Build notes
    ├── reinstall.bat                 # Windows node_modules cleanup script
    │
    ├── assets/
    │   └── pdi-logo.png             # Used in PDF generation
    │
    ├── db/
    │   ├── adapter.js               # Low-level DB wrapper: get(), all(), run(), transaction()
    │   ├── sqlite.js                # SQLite connection, schema creation, migrations
    │   ├── bootstrap.js             # First-boot seed: copies seed.db if no DB exists
    │   ├── seed.js                  # Schema initialization + 6 templates + admin user
    │   ├── snapshot.js              # Database backup utility
    │   └── seed/
    │       ├── inspection.db        # Pre-seeded SQLite DB (templates + sample data)
    │       └── uploads/             # Sample attachment files
    │
    ├── middleware/
    │   ├── auth.js                  # JWT verification, req.user injection
    │   ├── error.js                 # Global error handler + AppError class
    │   └── upload.js               # Multer: 25 MB max, 20 files max, uuid directories
    │
    ├── routes/
    │   ├── auth.js                  # POST /login, /entra; GET /me
    │   ├── templates.js             # GET /templates, /templates/:id
    │   ├── inspections.js           # Inspection CRUD + submit/approve/reject/pdf
    │   ├── attachments.js           # Upload, list, download, delete files
    │   ├── dashboard.js             # GET /stats
    │   ├── ncrs.js                  # NCR CRUD
    │   ├── part-specs.js            # Part specs by template
    │   └── admin.js                 # User role and active status management
    │
    ├── services/
    │   └── pdf.js                   # generateInspectionPdf() via PDFKit
    │
    ├── data/
    │   ├── inspection.db            # Live SQLite database
    │   └── .gitkeep
    │
    └── uploads/                     # File attachment storage
        ├── <uuid>/                  # One directory per inspection UUID
        └── .gitkeep
```

---

## 4. Database Schema

The application uses a single SQLite database file (`server/data/inspection.db`). WAL (Write-Ahead Logging) mode is enabled for concurrent read safety. Foreign key enforcement is on. All timestamps are stored as ISO 8601 strings.

### Table: `users`

Stores all application user accounts, whether provisioned via Entra or local login.

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  role          TEXT NOT NULL DEFAULT 'inspector',   -- inspector | qc_manager | admin
  password_hash TEXT,                                -- NULL for Entra-only users
  active        INTEGER NOT NULL DEFAULT 1,          -- 0 = disabled
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Notes:**
- On first Entra sign-in, the user is auto-provisioned with `role = 'inspector'`.
- `active = 0` prevents login without deleting the record.
- The admin seed user is created from the `ADMIN_PASSWORD` env var with `role = 'admin'`.

---

### Table: `inspection_templates`

Pre-seeded, read-only in production. Defines the structure of each inspection form type.

```sql
CREATE TABLE inspection_templates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  component_type   TEXT NOT NULL,                    -- e.g. 'Piston', 'Cylinder Liner'
  form_no          TEXT NOT NULL,                    -- e.g. 'PDI-IQI-001'
  title            TEXT NOT NULL,
  form_type        TEXT NOT NULL,                    -- iqi_standard | checklist | cylinder_head_dimensional
  disposition_type TEXT NOT NULL DEFAULT 'pass_fail',-- pass_fail | accept_reject | conditional
  header_schema    TEXT NOT NULL DEFAULT '[]',       -- JSON array of header field names
  sections         TEXT NOT NULL DEFAULT '{}'        -- JSON object: section definitions
);
```

**`sections` JSON structure (example for iqi_standard):**
```json
{
  "A": {
    "title": "Section A: Receiving",
    "section_type": "pfn_checklist",
    "items": [
      { "id": "A1", "text": "Verify P.O. Number" },
      { "id": "A2", "text": "Check packaging condition" }
    ]
  },
  "B": {
    "title": "Section B: Visual",
    "section_type": "pfn_checklist",
    "items": [...]
  },
  "C": {
    "title": "Section C: Dimensional",
    "section_type": "dimensional",
    "items": [
      { "id": "C1", "name": "Overall Length", "location": "...", "spec": "..." }
    ]
  }
}
```

**Section Types:**
- `pfn_checklist` — Each item has a Pass / Fail / N (Not Inspected) toggle and a remarks field.
- `pass_fail_checklist` — Simpler yes/no checklist.
- `dimensional` — Table of measurement name, location, specification, and actual measurement input.
- `checklist` — Generic checklist items.

---

### Table: `inspections`

Core table. Each row is one inspection record in the workflow.

```sql
CREATE TABLE inspections (
  id               TEXT PRIMARY KEY,                 -- UUID v4
  template_id      INTEGER REFERENCES inspection_templates(id),
  component_type   TEXT NOT NULL,
  form_no          TEXT NOT NULL,
  part_number      TEXT,
  supplier         TEXT,
  po_number        TEXT,
  description      TEXT,
  date_received    TEXT,
  inspector_name   TEXT,
  lot_size         TEXT,
  aql_level        TEXT,
  sample_size      TEXT,
  lot_serial_no    TEXT,
  signature        TEXT,
  disposition      TEXT,                             -- ACCEPT | REJECT | CONDITIONAL | PASS | FAIL
  status           TEXT NOT NULL DEFAULT 'draft',   -- draft | submitted | approved | rejected | complete
  section_data     TEXT NOT NULL DEFAULT '{}',      -- JSON: filled-in inspection values
  created_by       INTEGER REFERENCES users(id),
  submitted_by     INTEGER REFERENCES users(id),
  submitted_at     TEXT,
  reviewed_by      INTEGER REFERENCES users(id),
  reviewed_at      TEXT,
  review_notes     TEXT,
  completed_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**`section_data` JSON structure (stored per-section):**
```json
{
  "A": {
    "A1": { "value": "pass", "remarks": "" },
    "A2": { "value": "fail", "remarks": "Damaged corner" }
  },
  "C": {
    "C1": { "actual": "152.3" }
  }
}
```

**Status Transition Flow:**

```
draft → submitted → approved → complete
                 ↘ rejected
```

The `complete` status is set when an approved inspection is finalized. The `completed_at` timestamp is recorded at that point.

---

### Table: `inspection_attachments`

One row per uploaded file. Files are stored on disk in `uploads/<inspection_uuid>/`.

```sql
CREATE TABLE inspection_attachments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id   TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  uploaded_by     INTEGER REFERENCES users(id),
  file_name       TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  mime_type       TEXT,
  file_size_bytes INTEGER,
  section_key     TEXT,                              -- Optional: pins file to a section
  item_id         TEXT,                              -- Optional: pins file to a specific item
  uploaded_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

### Table: `inspection_notes`

Free-text comments on an inspection by any user or system.

```sql
CREATE TABLE inspection_notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id),
  note_type     TEXT NOT NULL DEFAULT 'internal',   -- internal | system | review
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

### Table: `inspection_activity_log`

Audit trail of all actions taken on an inspection. Edits are throttled to one log entry per 5 minutes per inspection to avoid log flooding.

```sql
CREATE TABLE inspection_activity_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL,                      -- started | edited | submitted | approved | rejected
  actor_name    TEXT,
  actor_id      INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

### Table: `ncrs`

Non-Conformance Reports linked to inspections.

```sql
CREATE TABLE ncrs (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_number                   TEXT UNIQUE NOT NULL,  -- Auto-generated, e.g. NCR-2024-0001
  inspection_id                TEXT REFERENCES inspections(id),
  part_number                  TEXT,
  supplier                     TEXT,
  po_number                    TEXT,
  description_of_defect        TEXT NOT NULL,
  quantity_affected            INTEGER,
  severity                     TEXT NOT NULL DEFAULT 'minor',    -- minor | major
  status                       TEXT NOT NULL DEFAULT 'open',     -- open | closed
  disposition                  TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  corrective_action_required   TEXT,
  corrective_action_due_date   TEXT,
  created_by                   INTEGER REFERENCES users(id),
  created_by_name              TEXT,
  closed_at                    TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

### Table: `part_specs`

Optional reference data: stores known specifications for part numbers per template.

```sql
CREATE TABLE part_specs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES inspection_templates(id),
  part_number TEXT NOT NULL,
  description TEXT,
  spec_data   TEXT NOT NULL DEFAULT '{}',           -- JSON: spec fields
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(template_id, part_number)
);
```

---

## 5. API Endpoints

All endpoints except `/api/auth/*` and `/health` require a valid JWT in the `Authorization: Bearer <token>` header.

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | None | Email/password login; returns `{ token }` |
| POST | `/api/auth/entra` | None | Microsoft Entra ID token exchange; returns `{ token }` |
| GET | `/api/auth/me` | JWT | Returns current user object |

### Inspections

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/inspections` | JWT | Paginated list. Query: `status`, `component_type`, `search`, `page`, `limit` (default 20) |
| POST | `/api/inspections` | JWT | Create new inspection. Body: `{ template_id, part_number, ... }` |
| GET | `/api/inspections/:id` | JWT | Single inspection with sections, attachments, notes, activity |
| PATCH | `/api/inspections/:id` | JWT | Update header fields, section_data, or disposition |
| POST | `/api/inspections/:id/submit` | JWT | Transition `draft → submitted` |
| POST | `/api/inspections/:id/approve` | qc_manager+ | Transition `submitted → approved`. Body: `{ notes }` |
| POST | `/api/inspections/:id/reject` | qc_manager+ | Transition `submitted → rejected`. Body: `{ notes }` |
| GET | `/api/inspections/:id/pdf` | JWT | Download PDF report (Content-Type: application/pdf) |

### Attachments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/attachments/:inspectionId` | JWT | Upload files (multipart/form-data). Max 25 MB, 20 files |
| GET | `/api/attachments/:inspectionId` | JWT | List all attachments for an inspection |
| GET | `/api/attachments/download/:id` | JWT | Stream file download |
| DELETE | `/api/attachments/:id` | JWT | Delete attachment (file + DB record) |

### Templates

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/templates` | JWT | List all 6 inspection form templates |
| GET | `/api/templates/:id` | JWT | Template detail with full section schema |

### Part Specifications

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/part-specs` | JWT | List specs. Query: `template_id`, `part_number` |
| POST | `/api/part-specs` | JWT | Create or update spec (upsert by template_id + part_number) |

### Non-Conformance Reports (NCRs)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/ncrs` | JWT | List NCRs. Query: `status`, `severity`, `search` |
| POST | `/api/ncrs` | JWT | Create new NCR |
| GET | `/api/ncrs/:id` | JWT | NCR detail |
| PATCH | `/api/ncrs/:id` | JWT | Update NCR fields or status |

### Dashboard

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/dashboard/stats` | JWT | Counts (total, pending, approved, rejected), by-component breakdown, recent activity |

### Administration

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/users` | admin | List all users |
| PATCH | `/api/admin/users/:id` | admin | Update user role or active status |

### System

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | None | Health check; probes SQLite connectivity |

### Error Response Format

All errors return JSON:
```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE"
}
```

Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `FILE_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL_ERROR`.

---

## 6. Authentication & Authorization

### Microsoft Entra ID Flow (Production)

1. Browser loads `/login` — MSAL `PublicClientApplication` is initialized from `VITE_ENTRA_*` env vars.
2. User clicks **Sign in with Microsoft**.
3. MSAL performs OAuth 2.0 authorization code flow; acquires an Entra ID token.
4. Frontend POSTs the ID token to `POST /api/auth/entra`.
5. Server verifies token signature against Microsoft's JWKS endpoint (via `jwks-rsa`).
6. Server upserts the user in the `users` table (creates with `role = 'inspector'` on first sign-in).
7. Server issues a short-lived app JWT (8-hour expiry, signed with `JWT_SECRET`).
8. Frontend stores JWT as `pdi_token` in `localStorage`; all subsequent API calls include it as `Authorization: Bearer`.
9. On JWT expiry (401 response), the Entra session is silently re-exchanged for a new JWT — no user interaction required.

### Email/Password Fallback (Development/Demo)

- Active when `VITE_ENTRA_CLIENT_ID` environment variable is blank.
- `MsalProvider` is not mounted; the login page shows an email/password form.
- Backend `POST /api/auth/login` compares the submitted password against the bcrypt hash.
- Seeds a default admin account (`admin@pdi.com`) with password from the `ADMIN_PASSWORD` env var.

### Role-Based Access

| Role | Permissions |
|------|-------------|
| `inspector` | Create inspections, upload attachments, view all inspections and NCRs |
| `qc_manager` | All inspector permissions + approve/reject submitted inspections |
| `admin` | All qc_manager permissions + user management (role assignment, active/inactive) |

Role is enforced on both the frontend (UI elements conditionally rendered) and the backend (middleware checks `req.user.role` before sensitive operations).

### JWT Details

- Stored in: `localStorage` key `pdi_token`
- Expiry: 8 hours
- Payload: `{ userId, email, role, name }`
- Cleared on: logout, 401 response from API, or explicit `clearAuth()` call

---

## 7. Frontend Architecture

### Routing (`App.jsx`)

```
/login                    → Login.jsx (public)
/                         → Dashboard.jsx (protected)
/inspections              → InspectionList.jsx (protected)
/inspections/new          → NewInspection.jsx (protected)
/inspections/:id          → InspectionDetail.jsx (protected)
/inspections/:id/edit     → InspectionForm.jsx (protected)
/ncrs                     → NCRList.jsx (protected)
/ncrs/:id                 → NCRDetail.jsx (protected)
/admin                    → Admin.jsx (admin only)
*                         → NotFound.jsx
```

Protected routes redirect to `/login` if `getToken()` returns null.

### State Management

**Server state** is managed exclusively by React Query (`@tanstack/react-query`):
- `useInspections()` — paginated inspection list with filters
- `useInspection(id)` — single inspection detail
- `useTemplates()` — all form templates
- `useNCRs()` — NCR list
- `useAttachments(inspectionId)` — file list for an inspection
- `usePartSpecs(templateId)` — specs for a template

Mutations (create, update, submit, approve, reject) call `invalidateQueries` on success to keep the UI in sync.

**UI/local state** is managed with `useState` in individual components. No global client state store (no Redux/Zustand).

**Notifications** are dispatched via `ToastContext` — a React context that renders a floating toast stack.

### API Client (`lib/api.js`)

An Axios instance configured with:
- `baseURL: '/api'`
- Request interceptor: attaches `Authorization: Bearer <token>` from localStorage
- Response interceptor: on 401, calls `clearAuth()` and redirects to `/login`

### Inspection Form Data Flow

1. `InspectionForm.jsx` fetches the inspection record and its template via React Query.
2. Header fields (part number, supplier, etc.) are held in local component state.
3. Section data is held in a `sectionData` state object, keyed by section letter.
4. Each section renders its appropriate component (`SectionVisual`, `SectionDimensional`, etc.), which receives its slice of `sectionData` and an `onChange` callback.
5. On "Save", the component PATCHes the full `section_data` JSON plus header fields to `/api/inspections/:id`.
6. On "Submit", it calls the submit mutation, which POSTs to `/api/inspections/:id/submit`.

### PDF Export

- Triggered by button in `InspectionDetail.jsx`.
- Client makes a `GET /api/inspections/:id/pdf` request with `responseType: 'blob'`.
- Backend generates the PDF server-side with PDFKit and streams it in the response.
- Client creates a temporary object URL and triggers a browser download.

---

## 8. Backend Architecture

### Express App Setup (`server/index.js`)

Middleware applied in order:
1. `helmet()` — security headers (CSP, HSTS, X-Frame-Options, etc.)
2. `cors()` — allows `CLIENT_URL` in production, localhost origins in development
3. `express.json()` — JSON body parsing
4. `express-rate-limit` on `/api/auth/*` — 20 requests per 15 minutes per IP
5. `trust proxy` — set when `TRUST_PROXY=1` (for IIS / Cloudflare)
6. Route handlers (see Section 5)
7. Static file serving of `client/dist` (for production single-server deployment)
8. Catch-all: returns `index.html` for client-side routes (SPA fallback)
9. Global error handler middleware (`middleware/error.js`)

### Database Layer (`db/`)

- **`adapter.js`** — thin wrapper over Node.js 22's built-in `sqlite` module. Provides: `get(sql, params)`, `all(sql, params)`, `run(sql, params)`, `transaction(fn)`. All methods return Promises.
- **`sqlite.js`** — manages the single database connection. Creates all tables if they don't exist. Runs idempotent column-addition migrations on startup. Sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`.
- **`bootstrap.js`** — on first boot, if `SQLITE_PATH` does not exist, copies `db/seed/inspection.db` to the target path (brings templates and sample data).
- **`seed.js`** — programmatic schema init and seeding of the 6 inspection templates.

### Middleware

**`middleware/auth.js`**

Extracts the Bearer token from `Authorization` header, verifies it with `jwt.verify(token, JWT_SECRET)`, and attaches the decoded payload to `req.user`. Returns 401 if missing or invalid.

Role guards are inline in route handlers:
```js
if (req.user.role !== 'qc_manager' && req.user.role !== 'admin') {
  throw new AppError('Forbidden', 403, 'FORBIDDEN');
}
```

**`middleware/error.js`**

Global Express error handler. Catches all errors thrown or passed via `next(err)`. Returns:
```json
{ "error": "<message>", "code": "<CODE>" }
```
with the appropriate HTTP status code. Distinguishes `AppError` (controlled) from unexpected errors (500).

**`middleware/upload.js`**

Multer disk storage configuration:
- Destination: `UPLOAD_DIR/<inspectionId>/<filename>` (directory created if needed)
- File size limit: 25 MB (from `MAX_FILE_SIZE_MB` env var)
- Max files per request: 20
- Field name: `files` (multipart form field)

### PDF Generation (`services/pdf.js`)

`generateInspectionPdf(inspection, template, attachments)` uses PDFKit to build a multi-page PDF:
- Header: PDI logo, form number, component type, inspection header fields
- Sections: rendered according to section type (checklist items, measurement tables)
- Attachments: listed at the end with file names and upload timestamps
- Disposition and reviewer signature block
- Returned as a Buffer, streamed directly to the HTTP response

---

## 9. Environment Configuration

### Server `.env` Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | `production` or `development` |
| `PORT` | No | Express listen port (default: `3001`) |
| `CLIENT_URL` | Yes (prod) | Allowed CORS origin (e.g. `https://inspection.pdi.com`) |
| `JWT_SECRET` | Yes | Minimum 32 characters; 64+ recommended for production |
| `ENTRA_TENANT_ID` | Prod only | Azure AD tenant ID |
| `ENTRA_CLIENT_ID` | Prod only | Azure app registration client ID |
| `DB_ADAPTER` | No | Always `sqlite` (only adapter implemented) |
| `SQLITE_PATH` | No | Path to SQLite file (default: `./data/inspection.db`) |
| `UPLOAD_DIR` | No | Path for uploaded files (default: `./uploads`) |
| `MAX_FILE_SIZE_MB` | No | Max individual file size in MB (default: `25`) |
| `TRUST_PROXY` | No | Set to `1` if behind a reverse proxy (IIS, Cloudflare) |
| `ADMIN_PASSWORD` | Dev only | Password for seeded `admin@pdi.com` account |

### Client `.env` Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_ENTRA_TENANT_ID` | Prod only | Azure AD tenant ID (blank = disable Entra, enable email login) |
| `VITE_ENTRA_CLIENT_ID` | Prod only | Azure app registration client ID |

---

## 10. Deployment

### Development Mode

```bash
# Start backend (hot reload via Node --watch)
cd server && npm run dev      # → http://localhost:3001

# Start frontend (Vite HMR)
cd client && npm run dev      # → http://localhost:5173
# Vite proxies /api/* → http://localhost:3001
```

### Production — Windows Server

1. Install Node.js 22.5+, PM2 (`npm install -g pm2`)
2. Copy `InspectionApp/` to deployment directory (e.g., `C:\PDIApp\`)
3. Create `server/.env` with production values
4. First time only: `cd server && node db/seed.js` to initialize DB
5. Build React SPA: `cd client && npm run build` (outputs `client/dist/`)
6. Start with PM2: `pm2 start ecosystem.config.cjs --env production`
7. (Optional) Configure IIS as a reverse proxy with URL Rewrite + ARR

### Production — Render.com (Cloud)

- Configured via `render.yaml` (Blueprint deployment)
- Build command: `cd server && npm ci --omit=dev && cd ../client && npm ci && npm run build`
- Start command: `cd server && npm start`
- 1 GB persistent disk for SQLite + uploads
- Starter plan ($7/month)

### PM2 Configuration (`ecosystem.config.cjs`)

```js
{
  name: 'inspection-app',
  script: 'index.js',
  cwd: './server',
  instances: 1,              // Single instance required for SQLite
  node_args: '--experimental-sqlite',
  watch: false,
  env_production: {
    NODE_ENV: 'production',
    PORT: 3001
  }
}
```

---

## 11. Security

| Feature | Implementation |
|---------|----------------|
| Authentication | JWT (8h) + Microsoft Entra ID |
| Password Storage | bcryptjs hash with salt |
| SQL Injection | Parameterized queries (prepared statements) |
| CORS | Restricted to `CLIENT_URL` in production |
| HTTP Security Headers | Helmet (CSP, HSTS, X-Frame-Options, X-Content-Type) |
| Rate Limiting | 20 auth requests per 15 min per IP |
| File Upload | 25 MB cap, stored outside web root, no execution permissions |
| Entra Token Verification | Microsoft JWKS via `jwks-rsa` |
| Reverse Proxy Support | `TRUST_PROXY=1` for accurate IP-based rate limiting |

---

## 12. Known Limitations & Constraints (Pre-Development)

The following are known gaps and constraints in the current codebase, as of the pre-development baseline:

- **Single writer constraint:** SQLite with WAL mode supports one concurrent writer. PM2 is configured for `instances: 1` to enforce this.
- **No real-time updates:** There is no WebSocket or SSE layer. Users must manually refresh to see updates from other users.
- **Local file storage only:** Attachments are stored on the local filesystem. There is no S3/blob storage integration.
- **No email notifications:** There is no notification system for workflow events (submission, approval, rejection).
- **No password reset flow:** Users who forget their email/password credentials have no self-service reset path.
- **Admin-only user creation:** There is no user registration flow. Admin must create or Entra must auto-provision users.
- **Part specs are optional and manual:** The `part_specs` table exists but has no bulk import mechanism.
- **PDF report is basic:** The PDF output from PDFKit does not include rendered section images or attachment thumbnails.
- **No search within section data:** The inspection list search only covers header fields (part number, supplier, etc.), not section values.
- **No bulk operations:** There is no batch approve, bulk export, or multi-select capability.
- **No audit export:** The `inspection_activity_log` table exists but there is no UI or export endpoint for it.

---

*End of Technical Description — PDI Inspection Management System baseline, 2026-04-20*
