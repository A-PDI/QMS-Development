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
  // Refuse to boot with a short/placeholder JWT secret in production.
  if ((process.env.JWT_SECRET || '').length < 32) {
    console.error('[Startup] JWT_SECRET must be at least 32 characters long in production.');
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
const drawingsRoutes = require('./routes/drawings');
const qualityAlertsRoutes = require('./routes/quality-alerts');
const reportsRoutes = require('./routes/reports');

const app        = express();
const PORT       = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const IS_PROD    = process.env.NODE_ENV === 'production';

// In production the app typically runs behind an IIS / Cloudflare / nginx reverse
// proxy. We trust the first hop so req.ip reflects the real client for the rate
// limiter. TRUST_PROXY can be overridden (e.g. "2" for nested proxies, or a
// comma-separated CIDR list) — see https://expressjs.com/en/guide/behind-proxies.html
if (IS_PROD) {
  const trust = process.env.TRUST_PROXY || 1;
  app.set('trust proxy', isNaN(Number(trust)) ? trust : Number(trust));
}

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
app.use('/api/drawings', authMiddleware, drawingsRoutes);
app.use('/api/quality-alerts', authMiddleware, qualityAlertsRoutes);
app.use('/api/reports', authMiddleware, reportsRoutes);

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

// Health check — probes the DB so IIS / PM2 / uptime monitors can detect a
// broken database connection rather than just a running Node process.
app.get('/health', (req, res) => {
  const base = { timestamp: new Date().toISOString(), env: process.env.NODE_ENV || 'development' };
  try {
    const db = require('./db/adapter');
    const row = db.get('SELECT 1 AS ok', []);
    if (!row || row.ok !== 1) throw new Error('db probe returned unexpected result');
    return res.json({ status: 'ok', db: 'ok', ...base });
  } catch (err) {
    return res.status(503).json({ status: 'degraded', db: 'error', error: err.message, ...base });
  }
});

// ── Static file serving ──────────────────────────────────────────────────────
// In production, Express always serves the Vite-built React SPA.
// In development, Express serves it too *if* client/dist exists — this lets you
// run the whole app on a single port (3001) for demos via a tunnel (ngrok etc.)
// without running the Vite dev server. Normal local dev still works: if
// client/dist doesn't exist, Express only serves /api and you use Vite on 5173.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
const serveClient = IS_PROD || fs.existsSync(clientDist);

if (serveClient) {
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // Serve React app for all non-API routes (SPA client-side routing)
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    if (!IS_PROD) {
      console.log('[Startup] Serving built client from client/dist (demo / single-port mode).');
    }
  } else if (IS_PROD) {
    console.warn('[Startup] client/dist not found — run "npm run build" in the client directory first.');
  }
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Startup] Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
