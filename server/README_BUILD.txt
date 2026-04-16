PDI INSPECTION APP - NODE.JS/EXPRESS BACKEND
==============================================

This is a complete, production-ready Node.js/Express backend for the PDI Incoming Quality Inspection tracking system.

DIRECTORY STRUCTURE:
server/
  index.js                - Main application entry point
  package.json            - Dependencies and scripts
  .env.example            - Environment variables template
  
  db/
    adapter.js            - Database adapter pattern (router to sqlite/mssql)
    sqlite.js             - SQLite database implementation with schema initialization
    seed.js               - Database seeding (admin user + 6 inspection templates)
  
  middleware/
    auth.js               - JWT authentication middleware
    error.js              - Centralized error handling
    upload.js             - Multer file upload middleware
  
  routes/
    auth.js               - POST /login, GET /me authentication endpoints
    templates.js          - GET /templates, GET /templates/:id
    inspections.js        - Full CRUD for inspections + submit/approve/reject/pdf
    attachments.js        - File upload/download/delete endpoints
    dashboard.js          - GET /dashboard/stats
  
  services/
    pdf.js                - PDF generation using PDFKit
  
  data/                   - SQLite database file (created at runtime)
  uploads/                - File attachment storage (created at runtime)

FEATURES:
- SQLite database with WAL mode and foreign key constraints
- JWT authentication (24h tokens)
- bcryptjs password hashing
- Multer file uploads (25MB limit per file)
- PDFKit PDF report generation
- 6 inspection templates (Piston, Cylinder Liner, Piston Pin, Piston Ring, Cylinder Head Visual, Cylinder Head Dimensional)
- Paginated inspection list with search/filters
- Status workflow: draft -> submitted -> approved/rejected
- Role-based access (admin, qc_manager, inspector)
- CORS enabled for development

GETTING STARTED:
1. npm install
2. cp .env.example .env (and customize if needed)
3. npm run seed (creates admin user + templates)
4. npm start (or npm run dev for watch mode)

DEFAULT ADMIN USER:
  Email: admin@pdi.com
  Password: changeme (override with ADMIN_PASSWORD env var)

API ENDPOINTS:
  POST   /api/auth/login                       - Login
  GET    /api/auth/me                          - Get current user
  GET    /api/users                            - List active users
  GET    /api/templates                        - List inspection templates
  GET    /api/templates/:id                    - Get template with sections
  GET    /api/inspections                      - List inspections (paginated, searchable)
  POST   /api/inspections                      - Create inspection
  GET    /api/inspections/:id                  - Get inspection detail
  PATCH  /api/inspections/:id                  - Update inspection data
  POST   /api/inspections/:id/submit           - Submit for review
  POST   /api/inspections/:id/approve          - Approve inspection
  POST   /api/inspections/:id/reject           - Reject inspection
  GET    /api/inspections/:id/pdf              - Generate PDF report
  GET    /api/attachments/:inspectionId        - List attachments
  POST   /api/attachments/:inspectionId        - Upload attachment
  GET    /api/attachments/download/:id         - Download attachment
  DELETE /api/attachments/:id                  - Delete attachment
  GET    /api/dashboard/stats                  - Dashboard statistics

TECH STACK:
- Express 4.x
- node:sqlite (built-in Node.js 22 SQLite — no compilation required)
- jsonwebtoken (JWT auth)
- bcryptjs (password hashing)
- multer (file uploads)
- pdfkit (PDF generation)
- cors, dotenv, uuid

All files validated and ready for production.
