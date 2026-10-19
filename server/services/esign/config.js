'use strict';
/**
 * E-sign settings, read from the environment on every call so tests (and a
 * restart after editing server/.env) see the current values.
 *
 * See server/.env.example for what each one does.
 */

const path = require('path');

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || String(v).trim() === '' ? fallback : String(v).trim();
}

function int(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback) {
  const v = str(name, '');
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function uploadRoot() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
}

module.exports = {
  /** Folder holding every envelope's files: <UPLOAD_DIR>/esign/<envelopeId>/ */
  storageDir: () => path.join(uploadRoot(), 'esign'),

  /** Base URL signers open their link on (no trailing slash). */
  publicUrl: () => str('ESIGN_PUBLIC_URL', str('CLIENT_URL', 'http://localhost:5173')).replace(/\/+$/, ''),

  detectorUrl: () => str('ESIGN_DETECTOR_URL', 'http://127.0.0.1:8765').replace(/\/+$/, ''),
  detectorKey: () => str('ESIGN_DETECTOR_API_KEY', ''),
  detectorTimeoutMs: () => int('ESIGN_DETECTOR_TIMEOUT_MS', 120000),
  detectorEnabled: () => bool('ESIGN_DETECTOR_ENABLED', true),

  expiryDays: () => Math.max(1, int('ESIGN_EXPIRY_DAYS', 30)),
  /** How long after completion a signer's link still downloads the signed copy. */
  downloadDays: () => Math.max(1, int('ESIGN_DOWNLOAD_DAYS', 30)),
  maxPdfMb: () => Math.max(1, int('ESIGN_MAX_PDF_MB', parseInt(process.env.MAX_FILE_SIZE_MB || '25', 10) || 25)),
  maxPages: () => Math.max(1, int('ESIGN_MAX_PAGES', 50)),
  /** Completed PDFs larger than this are linked in the e-mail instead of attached. */
  maxAttachMb: () => Math.max(1, int('ESIGN_MAX_ATTACH_MB', 10)),
  timeZone: () => str('ESIGN_TIME_ZONE', str('INJECTOR_TIME_ZONE', 'America/Denver')),

  p12Path: () => str('ESIGN_P12_PATH', ''),
  p12Passphrase: () => str('ESIGN_P12_PASSPHRASE', ''),
  sealName: () => str('ESIGN_SEAL_NAME', 'Performance Diesel Inc.'),
  sealLocation: () => str('ESIGN_SEAL_LOCATION', 'St. George, UT'),
  sealContact: () => str('ESIGN_SEAL_CONTACT', ''),

  smtp: () => ({
    host: str('SMTP_HOST', ''),
    port: int('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: str('SMTP_USER', ''),
    pass: str('SMTP_PASS', ''),
    from: str('SMTP_FROM', ''),
    /** 'smtp' (default when SMTP_HOST is set), 'json' (log only — dev/tests). */
    transport: str('ESIGN_MAIL_TRANSPORT', ''),
  }),

  isProduction: () => process.env.NODE_ENV === 'production',
};
