'use strict';
/**
 * Injector Test Bench routes (mounted at /api/injector-tests).
 *
 *   GET  /                              → list synced injectors (1 per line),
 *                                          filtered by part/serial/result/date
 *                                          and by test-step outcome
 *   GET  /steps                         → test-step catalog for the filter UI
 *   GET  /settings                      → CarbonZapp settings (masked key, last sync)
 *   PUT  /settings                      → save the CarbonZapp API key
 *   POST /sync                          → "Sync Now" — import test records ONLY
 *   POST /export/xlsx                   → selected injectors as an Excel workbook
 *   POST /export/pdf                    → selected injectors as a PDF listing
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
const {
  normaliseCriteria,
  describeCriteria,
  needsStepData,
  matchesStepCriteria,
  matchedStepLabels,
  stepCatalog,
} = require('../services/injectorFilters');
const {
  buildExportModel,
  buildInjectorWorkbook,
  buildInjectorListPdf,
  exportFilename,
} = require('../services/injectorExport');

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

// ── Injector list querying ─────────────────────────────────────────────────
// Records excluded from the feature entirely (repair serials and RMA jobs).
// Applied to every read so no query can surface them.
const BASE_EXCLUSIONS = `(serial_number IS NULL OR UPPER(TRIM(serial_number)) NOT LIKE 'R%')
                     AND (job_number IS NULL OR UPPER(job_number) NOT LIKE '%RMA%')`;

// Summary columns shown in the list. `report_json` is added only when a step
// filter is active — parsing it for every row is wasted work otherwise.
const LIST_COLUMNS = `id, report_ext_id, slot_position, part_number, serial_number,
                      brand, injector_type, machine_name, machine_sn, test_datetime, ext_status,
                      overall_pass, result_status, steps_total, steps_passed, steps_failed, inspection_id, synced_at`;

// One continuous list, newest test first. Remaining keys only make equal
// timestamps deterministic.
const LIST_ORDER = ` ORDER BY datetime(test_datetime) DESC, part_number ASC,
                     serial_number ASC, report_ext_id ASC, slot_position ASC`;

/**
 * SQL fragment + params for everything that can be filtered in the database.
 * Multi-value part/serial filters match a record when ANY of the given values
 * is contained in the column, so "all injectors of part number(s) X, Y" is one
 * query rather than one per part.
 */
function buildListFilters(criteria) {
  let sql = '';
  const params = [];

  const anyLike = (column, tokens) => {
    if (!tokens.length) return;
    sql += ` AND (${tokens.map(() => `${column} LIKE ?`).join(' OR ')})`;
    params.push(...tokens.map((t) => `%${t}%`));
  };

  if (criteria.search) {
    sql += ' AND (part_number LIKE ? OR serial_number LIKE ?)';
    params.push(`%${criteria.search}%`, `%${criteria.search}%`);
  }
  anyLike('part_number', criteria.partNumbers);
  anyLike('serial_number', criteria.serialNumbers);

  if (criteria.statuses.length) {
    // 'unknown' covers both the literal value and rows that were never scored.
    const clauses = criteria.statuses.map((status) => (
      status === 'unknown'
        ? "(result_status IS NULL OR result_status = 'unknown')"
        : 'result_status = ?'
    ));
    sql += ` AND (${clauses.join(' OR ')})`;
    params.push(...criteria.statuses.filter((s) => s !== 'unknown'));
  }
  if (criteria.dateFrom) {
    sql += ' AND date(test_datetime) >= date(?)';
    params.push(criteria.dateFrom);
  }
  if (criteria.dateTo) {
    sql += ' AND date(test_datetime) <= date(?)';
    params.push(criteria.dateTo);
  }
  return { sql, params };
}

/**
 * Run the row-level query, then apply any test-step criteria in JavaScript —
 * individual steps live inside the stored report JSON, which SQL cannot reach.
 *
 * Returns { injectors, total } where `total` counts every importable record,
 * so the UI can say "42 of 1,203".
 */
function queryInjectors(criteria) {
  const { sql: filterSql, params } = buildListFilters(criteria);
  const withSteps = needsStepData(criteria);
  const columns = withSteps ? `${LIST_COLUMNS}, report_json` : LIST_COLUMNS;

  const rows = db.all(
    `SELECT ${columns} FROM injector_test_reports WHERE ${BASE_EXCLUSIONS}${filterSql}${LIST_ORDER}`,
    params
  );
  const totalRow = db.get(`SELECT COUNT(*) AS c FROM injector_test_reports WHERE ${BASE_EXCLUSIONS}`, []);

  if (!withSteps) return { injectors: rows, total: totalRow ? totalRow.c : rows.length };

  const injectors = [];
  for (const row of rows) {
    const hydrated = carbonzapp.hydrateInjectorRow(row);
    if (!matchesStepCriteria(hydrated, criteria)) continue;
    // The step JSON stays on the server; the row carries only the labels that
    // explain why it matched, which is what the list shows next to it.
    const { report_json: _json, tests: _tests, ...summary } = hydrated;
    injectors.push({ ...summary, matched_steps: matchedStepLabels(hydrated, criteria) });
  }
  return { injectors, total: totalRow ? totalRow.c : injectors.length };
}

/**
 * The same query, hydrated with the stored test steps — what the exporters
 * need. Used when an export is driven by the ACTIVE FILTERS rather than by an
 * explicit list of ids, so a 3,000-row export does not have to be requested
 * with 3,000 ids in the body.
 */
function loadFilteredInjectors(criteria) {
  const { sql: filterSql, params } = buildListFilters(criteria);
  const rows = db.all(
    `SELECT ${LIST_COLUMNS}, report_json FROM injector_test_reports
      WHERE ${BASE_EXCLUSIONS}${filterSql}${LIST_ORDER}`,
    params
  );
  return rows
    .map(carbonzapp.hydrateInjectorRow)
    .filter((injector) => matchesStepCriteria(injector, criteria));
}

// ── List injectors ─────────────────────────────────────────────────────────
router.get('/', requireAdmin, (req, res, next) => {
  try {
    const criteria = normaliseCriteria(req.query || {});
    const { injectors, total } = queryInjectors(criteria);
    const lastSync = carbonzapp.getSetting('carbonzapp_last_sync');
    res.json({
      injectors,
      total,
      filtered: injectors.length,
      criteria,
      lastSync,
      hasApiKey: !!carbonzapp.getApiKey(),
    });
  } catch (err) { next(err); }
});

// ── Test-step catalog ──────────────────────────────────────────────────────
// Every measurement point present in the synced data, with how many injectors
// passed / failed / did not finish it. Drives the step filter picker, so the
// user only ever sees steps that actually exist in their data.
router.get('/steps', requireAdmin, (req, res, next) => {
  try {
    const rows = db.all(
      `SELECT id, report_json FROM injector_test_reports WHERE ${BASE_EXCLUSIONS}`,
      []
    );
    const steps = stepCatalog(rows.map(carbonzapp.hydrateInjectorRow));
    res.json({ steps, injectorCount: rows.length });
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

/** Stream a generated file, passing any non-blocking warnings in a header. */
function sendFile(res, buffer, filename, contentType, warnings = []) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Report-Filename', filename);
  if (warnings.length) {
    // Header-safe: the client decodes and shows this as a warning toast.
    res.setHeader('X-Report-Warnings', encodeURIComponent(warnings.join(' ')));
  }
  res.setHeader('Access-Control-Expose-Headers', 'X-Report-Filename, X-Report-Warnings');
  res.send(buffer);
}

/** Stream a generated PDF. */
function sendPdf(res, buffer, filename, warnings = []) {
  sendFile(res, buffer, filename, 'application/pdf', warnings);
}

/**
 * Log the full failure server-side and return a safe message to the user —
 * bench/API details and stack traces never leave the server.
 */
function reportFailure(err, { type, count, user, noun = 'report' }, next) {
  console.error(
    `[InjectorReports] ${type} ${noun} failed for ${count} injector(s) ` +
    `(user=${user?.id || 'unknown'}, role=${user?.role || 'unknown'}): ${err.message}`,
    err.stack
  );
  if (err instanceof AppError) return next(err);
  return next(new AppError(
    `The ${noun} could not be generated. Please try again; if it keeps failing, contact support.`,
    500, 'REPORT_GENERATION_FAILED'
  ));
}

// ── Export the selected injectors ──────────────────────────────────────────
// An export is a RECORD LIST, not an engineering report: it says which
// injectors were selected, how each scored and which test steps it failed.
// Two consequences follow, and both differ from the report routes above:
//   • a record with no bench results is still exportable — it simply lists as
//     "No result" — so the report-blocking validation is not applied here
//   • the row-per-injector layout scales far better than a column-per-injector
//     PDF, hence the much higher cap
const MAX_INJECTORS_PER_EXPORT = 5000;

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Resolve what to export. An explicit `injector_ids` selection always wins;
 * otherwise the request's `filters` are applied, which lets the client export
 * a whole filtered set without sending thousands of ids.
 */
function resolveExportSelection(req) {
  const body = req.body || {};
  const criteria = normaliseCriteria(body.filters || {});
  const ids = Array.isArray(body.injector_ids) ? body.injector_ids : [];

  if (ids.length > MAX_INJECTORS_PER_EXPORT) {
    throw new AppError(
      `Select at most ${MAX_INJECTORS_PER_EXPORT} injectors for one export.`,
      400, 'VALIDATION_ERROR'
    );
  }

  // `use_filters` lets the client ask for the whole filtered set explicitly,
  // rather than it being inferred from an empty selection.
  const fromFilters = ids.length === 0 && (body.use_filters === true || describeCriteria(criteria).length > 0);
  const injectors = fromFilters ? loadFilteredInjectors(criteria) : loadSelectedInjectors(ids);

  if (!fromFilters && ids.length === 0) {
    throw new AppError(
      'Select at least one injector, or apply a filter, to export.',
      400, 'VALIDATION_ERROR'
    );
  }
  if (injectors.length === 0) {
    throw new AppError('No matching injectors found. Refresh the list and try again.', 404, 'NOT_FOUND');
  }
  if (injectors.length > MAX_INJECTORS_PER_EXPORT) {
    throw new AppError(
      `That filter matches ${injectors.length} injectors — narrow it to ${MAX_INJECTORS_PER_EXPORT} or fewer.`,
      400, 'VALIDATION_ERROR'
    );
  }

  // Missing serial/part numbers do not block an export; they are surfaced as
  // the same non-blocking warnings the reports use.
  const { warnings } = validateSelection(injectors);
  return { injectors, criteria, warnings, fromFilters };
}

/** Build the shared export model for one request. */
function exportModelFor(req) {
  const { injectors, criteria, warnings, fromFilters } = resolveExportSelection(req);
  const model = buildExportModel(injectors, {
    criteria,
    title: String((req.body && req.body.title) || 'Injector Test Results').slice(0, 120),
    vendorName: String((req.body && req.body.vendor_name) || '').slice(0, 120),
  });
  return { model, warnings, fromFilters };
}

router.post('/export/xlsx', requireAdmin, async (req, res, next) => {
  let count = 0;
  try {
    const { model, warnings } = exportModelFor(req);
    count = model.summary.total;
    const buffer = await buildInjectorWorkbook(model);
    const filename = exportFilename(model, 'xlsx');
    console.log(`[InjectorExport] xlsx: ${count} injector(s) → ${filename} (user=${req.user?.id})`);
    sendFile(res, buffer, filename, XLSX_CONTENT_TYPE, warnings);
  } catch (err) {
    return reportFailure(err, { type: 'export/xlsx', count, user: req.user, noun: 'export' }, next);
  }
});

router.post('/export/pdf', requireAdmin, async (req, res, next) => {
  let count = 0;
  try {
    const { model, warnings } = exportModelFor(req);
    count = model.summary.total;
    const buffer = await buildInjectorListPdf(model);
    const filename = exportFilename(model, 'pdf');
    console.log(`[InjectorExport] pdf: ${count} injector(s) → ${filename} (user=${req.user?.id})`);
    sendPdf(res, buffer, filename, warnings);
  } catch (err) {
    return reportFailure(err, { type: 'export/pdf', count, user: req.user, noun: 'export' }, next);
  }
});

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
