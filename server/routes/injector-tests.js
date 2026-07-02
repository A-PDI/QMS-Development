'use strict';
/**
 * Injector Test Bench routes (mounted at /api/injector-tests).
 *
 *   GET  /               → list all synced injectors (1 per line)
 *   GET  /settings       → current CarbonZapp settings (masked key, last sync)
 *   PUT  /settings       → save the CarbonZapp API key
 *   POST /sync           → "Sync Now" — pull new reports from the bench
 *   POST /report         → custom landscape comparison PDF for selected injectors
 */

const express = require('express');
const router = express.Router();
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');
const carbonzapp = require('../services/carbonzapp');
const { generateInjectorComparisonPdf } = require('../services/pdf');

function requireAdmin(req, res, next) {
  if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
  next();
}

// ── List injectors ─────────────────────────────────────────────────────────
router.get('/', requireAdmin, (req, res, next) => {
  try {
    const { search } = req.query;
    let sql = `SELECT id, report_ext_id, slot_position, part_number, serial_number, job_number,
                      brand, injector_type, machine_name, machine_sn, test_datetime, ext_status,
                      overall_pass, steps_total, steps_passed, steps_failed, inspection_id, synced_at
               FROM injector_test_reports WHERE 1=1`;
    const params = [];
    if (search) {
      sql += ' AND (part_number LIKE ? OR serial_number LIKE ? OR job_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    sql += ' ORDER BY test_datetime DESC, part_number ASC, slot_position ASC';
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

// ── Sync Now ──────────────────────────────────────────────────────────────
router.post('/sync', requireAdmin, async (req, res, next) => {
  try {
    const { full_resync } = req.body || {};
    const result = await carbonzapp.syncNow({ fullResync: !!full_resync });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'NO_API_KEY') return next(new AppError(err.message, 400, 'NO_API_KEY'));
    if (err.code === 'CARBONZAPP_HTTP_ERROR') return next(new AppError(err.message, 502, 'CARBONZAPP_ERROR'));
    next(err);
  }
});

// ── Custom comparison report (landscape PDF) ───────────────────────────────
router.post('/report', requireAdmin, async (req, res, next) => {
  try {
    const { injector_ids } = req.body || {};
    if (!Array.isArray(injector_ids) || injector_ids.length === 0) {
      return next(new AppError('Select at least one injector.', 400, 'VALIDATION_ERROR'));
    }
    // Preserve the caller's selection order.
    const placeholders = injector_ids.map(() => '?').join(',');
    const rows = db.all(
      `SELECT * FROM injector_test_reports WHERE id IN (${placeholders})`,
      injector_ids
    );
    if (rows.length === 0) return next(new AppError('No matching injectors found.', 404, 'NOT_FOUND'));

    const byId = new Map(rows.map(r => [r.id, r]));
    const ordered = injector_ids.map(id => byId.get(id)).filter(Boolean);

    const injectors = ordered.map((r) => {
      const rj = JSON.parse(r.report_json || '{}');
      return {
        part_number: r.part_number,
        serial_number: r.serial_number,
        job_number: r.job_number,
        brand: r.brand,
        injector_type: r.injector_type,
        machine_name: r.machine_name,
        machine_sn: r.machine_sn,
        test_datetime: r.test_datetime,
        tests: Array.isArray(rj.tests) ? rj.tests : [],
      };
    });

    const pdfBuffer = await generateInjectorComparisonPdf(injectors);
    const sanitise = (v, fallback) => {
      const s = String(v ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
      return s || fallback;
    };
    const partPart = sanitise(injectors[0]?.part_number, 'Injectors');
    const filename = `InjectorReport_${partPart}_${injectors.length}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

module.exports = router;
