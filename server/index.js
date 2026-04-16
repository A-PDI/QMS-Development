'use strict';

// ── Environment & validation ──────────────────────────────────────────────────
require('dotenv').config();

const REQUIRED_ENV = ['JWT_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`[Startup] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  const REQUIRED_PROD = ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'CLIENT_URL'];
  const missingProd = REQUIRED_PROD.filter(k => !process.env[k]);
  if (missingProd.length > 0) {
    console.error(`[Startup] Missing required production environment variables: ${missingProd.join(', ')}`);
    process.exit(1);
  }
}

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const path    = require('path');
const fs      = require('fs');

const authMiddleware = require('./middleware/auth');
const { errorHandler } = require('./middleware/error');

const authRoutes      = require('./routes/auth');
const templatesRoutes = require('./routes/templates');
const inspectionsRoutes = require('./routes/inspections');
const attachmentsRoutes = require('./routes/attachments');
const dashboardRoutes = require('./routes/dashboard');
const ncrsRoutes      = require('./routes/ncrs');
const partSpecsRoutes = require('./routes/part-specs');
const adminRoutes     = require('./routes/admin');

const app        = express();
const PORT       = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const IS_PROD    = process.env.NODE_ENV === 'production';

// ── Security headers (helmet) ─────────────────────────────────────────────────
// In production Express serves the built SPA, so we allow inline scripts that
// Vite injects; in dev, CSP is relaxed further for HMR.
app.use(
  helmet({
    contentSecurityPolicy: IS_PROD
      ? {
          directives: {
            defaultSrc:  ["'self'"],
            scriptSrc:   ["'self'", "'unsafe-inline'"],   // Vite build inlines a tiny loader
            styleSrc:    ["'self'", "'unsafe-inline'"],
            imgSrc:      ["'self'", 'data:', 'blob:'],
            connectSrc:  ["'self'", 'https://login.microsoftonline.com'],
            frameSrc:    ["'self'", 'https://login.microsoftonline.com'],
            fontSrc:     ["'self'", 'data:'],
            objectSrc:   ["'none'"],
            upgradeInsecureRequests: [],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false, // Required for some MSAL redirect scenarios
  })
);

// ── CORS ─────────────────────────────────────────────────────────────────────
// In production the SPA is served from the same origin as the API, so CORS is
// only needed for local dev (Vite dev server on :5173 → API on :3001).
const allowedOrigins = IS_PROD
  ? [CLIENT_URL]
  : [CLIENT_URL, 'http://localhost:5173', 'http://localhost:3000'];

app.use(cors({ origin: allowedOrigins, credentials: true }));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Upload directory ──────────────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Applies only to authentication endpoints to prevent brute-force attacks.
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // max 20 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.', code: 'RATE_LIMITED' },
  skip: (req) => req.path === '/entra', // Microsoft handles its own rate limiting
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRateLimit, authRoutes);

app.use('/api/templates',   authMiddleware, templatesRoutes);
app.use('/api/inspections', authMiddleware, inspectionsRoutes);
app.use('/api/attachments', authMiddleware, attachmentsRoutes);
app.use('/api/dashboard',   authMiddleware, dashboardRoutes);
app.use('/api/ncrs',        authMiddleware, ncrsRoutes);
app.use('/api/part-specs',  authMiddleware, partSpecsRoutes);
app.use('/api/admin',       authMiddleware, adminRoutes);

// Users list
app.get('/api/users', authMiddleware, (req, res, next) => {
  try {
    const db = require('./db/adapter');
    const users = db.all('SELECT id, name, email, role FROM users WHERE active = 1 ORDER BY name ASC', []);
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// Health check
app.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV || 'development' })
);

// ── Static file serving (production) ─────────────────────────────────────────
// In production, Express serves the Vite-built React SPA. The client dist folder
// sits at ../client/dist relative to this server directory.
if (IS_PROD) {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // Serve React app for all non-API routes (SPA client-side routing)
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    console.warn('[Startup] client/dist not found — run "npm run build" in the client directory first.');
  }
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`PDI Inspection server running on port ${PORT}`);
  console.log(`Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`Auth        : Microsoft Entra ID`);
  console.log(`DB adapter  : ${process.env.DB_ADAPTER || 'sqlite'}`);
  if (IS_PROD) {
    console.log(`Client URL  : ${CLIENT_URL}`);
    console.log(`Entra tenant: ${process.env.ENTRA_TENANT_ID}`);
  }
});

module.exports = app;
