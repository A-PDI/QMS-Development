'use strict';
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const jwksClient = require('jwks-rsa');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');
const authMiddleware = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '8h';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// ── Microsoft Entra ID token verifier ────────────────────────────────────────
// Lazily initialised so the server still boots when Entra vars are absent
// (useful during local dev with AUTH_MODE=local).
let _jwksClient = null;

function getJwksClient() {
  if (!_jwksClient) {
    const tenantId = process.env.ENTRA_TENANT_ID;
    if (!tenantId) throw new AppError('ENTRA_TENANT_ID is not configured', 501, 'NOT_CONFIGURED');
    _jwksClient = jwksClient({
      jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000, // 10 minutes
      rateLimit: true,
    });
  }
  return _jwksClient;
}

function verifyMicrosoftToken(idToken) {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  if (!tenantId || !clientId) {
    return Promise.reject(new AppError('Entra authentication is not configured on this server', 501, 'NOT_CONFIGURED'));
  }

  const client = getJwksClient();

  return new Promise((resolve, reject) => {
    function getKey(header, callback) {
      client.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key.getPublicKey());
      });
    }

    jwt.verify(
      idToken,
      getKey,
      {
        audience: clientId,
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      }
    );
  });
}

// ── POST /api/auth/login  (local password auth — kept for admin fallback) ────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email)    return next(new AppError('Email is required', 400, 'VALIDATION_ERROR'));
    if (!password) return next(new AppError('Password is required', 400, 'VALIDATION_ERROR'));

    const user = db.get('SELECT * FROM users WHERE email = ? AND active = 1', [email]);
    const INVALID = new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    if (!user) return next(INVALID);

    if (!user.password_hash) {
      return next(new AppError('This account uses Microsoft sign-in. Please use the "Sign in with Microsoft" button.', 401, 'USE_ENTRA'));
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return next(INVALID);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions || null },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/entra  (Microsoft Entra ID / M365 sign-in) ────────────────
// The frontend (MSAL) acquires a Microsoft ID token, then POSTs it here.
// We validate it against Microsoft's public keys, then upsert the user in our
// local DB and issue our own short-lived JWT for subsequent API calls.
router.post('/entra', async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return next(new AppError('idToken is required', 400, 'VALIDATION_ERROR'));
    }

    let decoded;
    try {
      decoded = await verifyMicrosoftToken(idToken);
    } catch (err) {
      if (err instanceof AppError) return next(err);
      if (err.name === 'TokenExpiredError') {
        return next(new AppError('Microsoft token has expired. Please sign in again.', 401, 'TOKEN_EXPIRED'));
      }
      return next(new AppError('Invalid Microsoft token', 401, 'TOKEN_INVALID'));
    }

    // Extract user identity from token claims
    // preferred_username is the UPN (typically the M365 email address)
    const email = (decoded.preferred_username || decoded.email || '').toLowerCase().trim();
    const name  = decoded.name || email;

    if (!email) {
      return next(new AppError('Could not read email from Microsoft token', 400, 'TOKEN_MISSING_CLAIM'));
    }

    // Upsert: find existing user by email or create with default inspector role
    let user = db.get('SELECT * FROM users WHERE email = ? AND active = 1', [email]);

    if (!user) {
      // Auto-provision new user — admin can adjust role later in Admin panel
      const id = uuidv4();
      db.run(
        'INSERT INTO users (id, name, email, role, active) VALUES (?, ?, ?, ?, 1)',
        [id, name, email, 'inspector']
      );
      user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    } else {
      // Keep name in sync with Entra directory
      db.run('UPDATE users SET name = ? WHERE id = ?', [name, user.id]);
      user = db.get('SELECT * FROM users WHERE id = ?', [user.id]);
    }

    if (!user) {
      return next(new AppError('Failed to provision user account', 500, 'USER_PROVISION_FAILED'));
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions || null },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      permissions: u.permissions || null,
    },
  });
});

module.exports = router;
