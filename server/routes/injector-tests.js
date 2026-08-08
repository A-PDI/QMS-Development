'use strict';
/**
 * Injector Test Bench routes (mounted at /api/injector-tests).
 *
 *   GET  /                              → list all synced injectors (1 per line)
 *   GET  /settings                      → CarbonZapp settings (masked key, last sync)
 *   PUT  /settings                      → save the CarbonZapp API key
 *   POST /sync                          → "Sync Now" — import test records ONLY
 *   POST /reports/preview               → selected comparison data (JSON only)
 *   POST /reports/custom                → Custom Report PDF for selected injectors
 *                                          (optional vendor_name; bench brand fallback)
 *   POST /reports/inspection            → create/refresh inspection record(s)
 *   POST /reports/shipment-evaluation   → Shipment Evaluation PDF (supplier_evaluation;
 *                                          requires vendor_name)
 *   POST /reports/customer, /report     → legacy aliases of /reports/custom
 *
 * EVERY route in this file is restricted to the ADMIN role (see requireAdmin) —
 * the client hides the page and blocks the route for everyone else, and this is
 * the matching server-side enforcement.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');
const carbonzapp = require('../services/carbonzapp');
const {
  REPORT_TYPES,
  loadSelectedInjectors,
  validateSelection,
  buildCustomerReport,
  buildReportPreview,
  buildShipmentEvaluationReport,
  generateInspectionReports,
} = require('../services/injectorReports');

// Roles allowed to reach the Injector Tests feature: the ADMIN role only.
// Matches the `roles` restriction on the sidebar item in client/src/lib/nav.js
// so the UI and the API agree (qc_manager keeps the other admin pages).
const ADMIN_ROLES = ['admin'];

// Upper bound on one report request — a guard against a runaway selection
// tying the server up generating a thousand-column PDF.
const MAX_INJECTORS_PER_REPORT = 500;

function requireAdmin(req, res, next) {
  if (!ADMIN_ROLES.includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
  next();
}

// ── List injectors ─────────────────────────────────────────────────────────
router.get('/', requireAdmin, (req, res, next) => {
  try {
    const { search, part_number, serial_number, status } = req.query;
    let sql = `SELECT id, report_ext_id, slot_position, part_number, serial_number,
                      brand, injector_type, machine_name, machine_sn, test_datetime, ext_status,
                      overall_pass, steps_total, steps_passed, steps_failed, inspection_id, synced_at
               FROM injector_test_reports
              WHERE (serial_number IS NULL OR UPPER(TRIM(serial_number)) NOT LIKE 'R%')
                AND (job_number IS NULL OR UPPER(job_number) NOT LIKE '%RMA%')`;
    const params = [];
    if (search) {
      sql += ' AND (part_number LIKE ? OR serial_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }
    if (part_number) {
      sql += ' AND part_number LIKE ?';
      params.push(`%${part_number}%`);
    }
    if (serial_number) {
      sql += ' AND serial_number LIKE ?';
      params.push(`%${serial_number}%`);
    }
    if (status === 'pass') sql += ' AND overall_pass = 1';
    else if (status === 'fail') sql += ' AND overall_pass = 0';
    else if (status === 'unscored') sql += ' AND overall_pass IS NULL';

    // One continuous list, newest test first. Remaining keys only make equal
    // timestamps deterministic.
    sql += ' ORDER BY datetime(test_datetime) DESC, part_number ASC, serial_number ASC, report_ext_id ASC, slot_position ASC';
    const injectors = db.all(sql, params);
    const lastSync = carbonzapp.getSetting('carbonzapp_last_sync');
    res.json({ injectors, lastSync, hasApiKey: !!carbonzapp.getApiKey() });
  } catch (err) { next(err); }
});

// ── Settings ────────────────────────────────────────────────────────────────
router.get('/settings', requireAdmin, (req, res, next) => {
  try {
    const key = carbonzapp.getApiKey();
    const masked = key ? `••••••••${key.slice(-4)}` : null;
    res.json({
      hasApiKey: !!key,
      apiKeyMasked: masked,
      apiKeyFromEnv: !!process.env.CARBONZAPP_API_KEY,
      lastSync: carbonzapp.getSetting('carbonzapp_last_sync'),
      exclusions: {
        serialStartsWith: 'R',
        jobContains: 'RMA',
      },
      fullSyncFrom: carbonzapp.fullSyncDateFrom(),
    });
  } catch (err) { next(err); }
});

router.put('/settings', requireAdmin, (req, res, next) => {
  try {
    const { api_key } = req.body;
    if (typeof api_key !== 'string' || api_key.trim().length < 8) {
      return next(new AppError('A valid API key is required.', 400, 'VALIDATION_ERROR'));
    }
    carbonzapp.setSetting('carbonzapp_api_key', api_key.trim());
    const key = carbonzapp.getApiKey();
    res.json({ ok: true, apiKeyMasked: key ? `••••••••${key.slice(-4)}` : null });
  } catch (err) { next(err); }
});

// ── Test connection ─────────────────────────────────────────────────────────
router.post('/test-connection', requireAdmin, async (req, res, next) => {
  try {
    const result = await carbonzapp.testConnection({});
    res.json({ ok: true, ...result });
  } catch (err) {
    return mapCarbonzappError(err, next);
  }
});

// ── Sync Now ──────────────────────────────────────────────────────────────
router.post('/sync', requireAdmin, async (req, res, next) => {
  try {
    // `allow_large_prune` confirms a full resync that would remove more than
    // half of the stored records (the safety rule in carbonzapp.syncNow).
    const { full_resync, allow_large_prune } = req.body || {};
    const result = await carbonzapp.syncNow({
      fullResync: !!full_resync,
      allowLargePrune: !!allow_large_prune,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    return mapCarbonzappError(err, next);
  }
});

// ── Clear all synced reports + auto-created inspections ─────────────────────
// Removes every synced injector row and the inspections that were auto-created
// from the bench (manually-completed inspections are preserved). Resets the
// last-sync marker so the next sync is a full re-import.
router.delete('/', requireAdmin, (req, res, next) => {
  try {
    const result = carbonzapp.clearAllReports();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// Translate CarbonZapp service errors into clean HTTP responses with a code
// the client can act on.
function mapCarbonzappError(err, next) {
  console.error('[InjectorTests] CarbonZapp error:', err.code || '', err.message);
  const map = {
    NO_API_KEY: 400,
    CARBONZAPP_HTTP_ERROR: 502,
    CARBONZAPP_TIMEOUT: 504,
    CARBONZAPP_NETWORK: 502,
    CARBONZAPP_BAD_RESPONSE: 502,
  };
  const status = map[err.code] || 500;
  return next(new AppError(err.message, status, err.code || 'CARBONZAPP_ERROR'));
}

// ── Manual report generation ───────────────────────────────────────────────
// Synchronisation imports test records only; reports are produced here for the
// injectors the user explicitly selected.

/**
 * Resolve + validate a report request body. Throws an AppError the caller can
 * hand straight to next().
 */
function resolveSelection(req, opts = {}) {
  const { injector_ids } = req.body || {};
  if (!Array.isArray(injector_ids) || injector_ids.length === 0) {
    throw new AppError('Select at least one injector.', 400, 'VALIDATION_ERROR');
  }
  if (injector_ids.length > MAX_INJECTORS_PER_REPORT) {
    throw new AppError(
      `Select at most ${MAX_INJECTORS_PER_REPORT} injectors for one report.`,
      400, 'VALIDATION_ERROR'
    );
  }
  const injectors = loadSelectedInjectors(injector_ids);
  if (injectors.length === 0) {
    throw new AppError('No matching injectors found. Refresh the list and try again.', 404, 'NOT_FOUND');
  }
  const validation = validateSelection(injectors, opts);
  if (!validation.ok) {
    throw new AppError(validation.message, 400, 'VALIDATION_ERROR');
  }
  return { injectors, validation };
}

/** Stream a generated PDF, passing any non-blocking warnings in a header. */
function sendPdf(res, buffer, filename, warnings = []) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Report-Filename', filename);
  if (warnings.length) {
    // Header-safe: the client decodes and shows this as a warning toast.
    res.setHeader('X-Report-Warnings', encodeURIComponent(warnings.join(' ')));
  }
  res.setHeader('Access-Control-Expose-Headers', 'X-Report-Filename, X-Report-Warnings');
  res.send(buffer);
}

/**
 * Log the full failure server-side and return a safe message to the user —
 * bench/API details and stack traces never leave the server.
 */
function reportFailure(err, { type, count, user }, next) {
  console.error(
    `[InjectorReports] ${type} report failed for ${count} injector(s) ` +
    `(user=${user?.id || 'unknown'}, role=${user?.role || 'unknown'}): ${err.message}`,
    err.stack
  );
  if (err instanceof AppError) return next(err);
  return next(new AppError(
    'The report could not be generated. Please try again; if it keeps failing, contact support.',
    500, 'REPORT_GENERATION_FAILED'
  ));
}

// Preview the Custom Report comparison data. This endpoint never generates a
// PDF and never creates or updates an inspection.
router.post('/reports/preview', requireAdmin, (req, res, next) => {
  try {
    const { injectors, validation } = resolveSelection(req);
    res.json({
      ok: true,
      preview: buildReportPreview(injectors),
      warnings: validation.warnings,
    });
  } catch (err) {
    return reportFailure(err, { type: 'preview', count: 0, user: req.user }, next);
  }
});

// Custom Report comparison PDF (internal/legacy route id remains customer).
async function handleCustomReport(req, res, next) {
  let count = 0;
  try {
    const vendorName = String((req.body && req.body.vendor_name) || '').trim();
    if (vendorName.length > 120) {
      throw new AppError('The vendor name is too long (120 characters maximum).', 400, 'VALIDATION_ERROR');
    }
    const { injectors, validation } = resolveSelection(req);
    count = injectors.length;
    const { buffer, filename } = await buildCustomerReport(injectors, { vendorName });
    console.log(`[InjectorReports] custom report: ${count} injector(s) → ${filename} (user=${req.user?.id})`);
    sendPdf(res, buffer, filename, validation.warnings);
  } catch (err) {
    return reportFailure(err, { type: REPORT_TYPES.CUSTOMER, count, user: req.user }, next);
  }
}

router.post('/reports/custom', requireAdmin, handleCustomReport);
// Legacy paths kept so existing clients keep working.
router.post('/reports/customer', requireAdmin, handleCustomReport);
router.post('/report', requireAdmin, handleCustomReport);

// Inspection report — creates/refreshes the Fuel Injector inspection record(s)
// for the selection and returns their ids so the client can download each PDF
// from /api/inspections/:id/pdf.
router.post('/reports/inspection', requireAdmin, (req, res, next) => {
  let count = 0;
  try {
    const { injectors, validation } = resolveSelection(req);
    count = injectors.length;
    const result = generateInspectionReports(injectors, { actor: req.user });
    console.log(
      `[InjectorReports] inspection report: ${count} injector(s) → ` +
      `${result.created} created, ${result.updated} updated (user=${req.user?.id})`
    );
    res.json({ ok: true, ...result, warnings: validation.warnings });
  } catch (err) {
    return reportFailure(err, { type: REPORT_TYPES.INSPECTION, count, user: req.user }, next);
  }
});

// Shipment Evaluation Report (internal type: supplier_evaluation).
// Requires a vendor name — it identifies the shipment on both report headers.
async function handleShipmentEvaluation(req, res, next) {
  let count = 0;
  try {
    const vendorName = String((req.body && req.body.vendor_name) || '').trim();
    if (!vendorName) {
      throw new AppError('A vendor name is required for the Shipment Evaluation Report.', 400, 'VALIDATION_ERROR');
    }
    if (vendorName.length > 120) {
      throw new AppError('The vendor name is too long (120 characters maximum).', 400, 'VALIDATION_ERROR');
    }
    const { injectors, validation } = resolveSelection(req);
    count = injectors.length;
    const { buffer, filename } = await buildShipmentEvaluationReport(injectors, { vendorName });
    console.log(`[InjectorReports] shipment evaluation: ${count} injector(s) → ${filename} (user=${req.user?.id})`);
    sendPdf(res, buffer, filename, validation.warnings);
  } catch (err) {
    return reportFailure(err, { type: REPORT_TYPES.SUPPLIER_EVALUATION, count, user: req.user }, next);
  }
}

router.post('/reports/shipment-evaluation', requireAdmin, handleShipmentEvaluation);
router.post('/reports/supplier-evaluation', requireAdmin, handleShipmentEvaluation);

module.exports = router;
module.exports.ADMIN_ROLES = ADMIN_ROLES;
module.exports.MAX_INJECTORS_PER_REPORT = MAX_INJECTORS_PER_REPORT;
