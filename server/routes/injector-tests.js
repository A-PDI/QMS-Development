'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');
const injectorTestBench = require('../services/injectorTestBench');
const { generateInjectorComparisonPdf } = require('../services/injectorReportPdf');

function requireAdmin(req, res, next) {
  if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
  next();
}

function parseTests(testsJson) {
  try {
    const t = JSON.parse(testsJson || '[]');
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

// GET /api/injector-tests — list synced injectors, one row per tested injector
router.get('/', (req, res, next) => {
  try {
    const { q, result, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let sql = `SELECT r.id, r.report_id, r.slot_position, r.serial_number, r.part_number, r.old_code,
                      r.injector_brand, r.injector_type, r.overall_result, r.inspection_id,
                      r.inspection_item_index, r.created_at,
                      rep.external_id AS report_external_id, rep.job_number, rep.report_datetime,
                      rep.machine_name, rep.customer_name
               FROM injector_test_results r
               JOIN injector_test_reports rep ON rep.id = r.report_id
               WHERE 1=1`;
    const params = [];
    if (q) {
      sql += ' AND (r.serial_number LIKE ? OR r.part_number LIKE ? OR rep.job_number LIKE ?)';
      const s = `%${q}%`;
      params.push(s, s, s);
    }
    if (result === 'PASS' || result === 'FAIL') {
      sql += ' AND r.overall_result = ?';
      params.push(result);
    }
    sql += ' ORDER BY rep.report_datetime DESC, r.slot_position ASC';

    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as count FROM');
    const total = db.get(countSql, params).count;
    const rows = db.all(sql + ' LIMIT ? OFFSET ?', [...params, parseInt(limit, 10), offset]);
    res.json({ injectors: rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) { next(err); }
});

// GET /api/injector-tests/sync-status
router.get('/sync-status', (req, res, next) => {
  try {
    const status = injectorTestBench.getSyncStatus();
    const totals = db.get(
      `SELECT (SELECT COUNT(*) FROM injector_test_reports) AS reports,
              (SELECT COUNT(*) FROM injector_test_results) AS injectors`,
      []
    );
    res.json({ ...status, totalReports: totals.reports, totalInjectors: totals.injectors });
  } catch (err) { next(err); }
});

// POST /api/injector-tests/sync — manually trigger a sync now
router.post('/sync', requireAdmin, async (req, res, next) => {
  try {
    const summary = await injectorTestBench.syncNow();
    res.json({ ok: true, ...summary });
  } catch (err) {
    if (err.code === 'NOT_CONFIGURED') return next(new AppError(err.message, 400, 'NOT_CONFIGURED'));
    next(new AppError(`Sync failed: ${err.message}`, 502, 'SYNC_FAILED'));
  }
});

// POST /api/injector-tests/create-inspection — create one multi-item Fuel
// Injector inspection per synced report among the selected injectors, with
// the Dimensional Inspection section pre-populated from bench results.
router.post('/create-inspection', requireAdmin, (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.result_ids) ? req.body.result_ids : [];
    if (ids.length === 0) return next(new AppError('result_ids is required', 400, 'VALIDATION_ERROR'));

    const placeholders = ids.map(() => '?').join(',');
    const rows = db.all(
      `SELECT r.*, rep.job_number, rep.report_datetime, rep.actuator_code
       FROM injector_test_results r JOIN injector_test_reports rep ON rep.id = r.report_id
       WHERE r.id IN (${placeholders})`,
      ids
    );
    if (rows.length === 0) return next(new AppError('No matching injector results found', 404, 'NOT_FOUND'));

    const template = db.get(
      "SELECT * FROM inspection_templates WHERE form_no = 'PDI-IQI-012' AND active = 1 ORDER BY version DESC LIMIT 1",
      []
    );
    if (!template) return next(new AppError('Fuel Injector inspection template (PDI-IQI-012) not found', 404, 'NOT_FOUND'));
    const baseSections = JSON.parse(template.sections || '{}');

    // `WHERE id IN (...)` doesn't preserve the caller's selection order —
    // re-sort rows to match the order the admin picked them in, so item
    // tabs on the resulting inspection line up with what was selected.
    const orderIndex = new Map(ids.map((id, idx) => [id, idx]));
    rows.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    const byReport = new Map();
    for (const r of rows) {
      if (r.inspection_id) continue; // already used — skip, don't double-link
      if (!byReport.has(r.report_id)) byReport.set(r.report_id, []);
      byReport.get(r.report_id).push(r);
    }

    const created = [];
    const skippedAlreadyLinked = rows.filter(r => r.inspection_id).map(r => r.id);
    const now = new Date().toISOString();

    for (const [, group] of byReport) {
      const { items, perInjectorValues } = injectorTestBench.buildSharedDimensionalSection(group);
      const adminSections = {
        ...baseSections,
        dimensional: { title: 'C. DIMENSIONAL INSPECTION — Flow Test', section_type: 'dimensional', items },
      };
      const itemsData = group.map((r, idx) => ({
        receiving: {},
        visual: {},
        dimensional: perInjectorValues[idx],
      }));

      const partNumbers = new Set(group.map(r => r.part_number).filter(Boolean));
      const partNumber = partNumbers.size === 1 ? [...partNumbers][0] : (group[0].actuator_code || null);
      const serials = group.map(r => r.serial_number).filter(Boolean).join(', ');
      const dateReceived = (group[0].report_datetime || now).slice(0, 10);

      const inspectionId = uuidv4();
      db.run(
        `INSERT INTO inspections
          (id, template_id, component_type, form_no, part_number, description, date_received,
           lot_serial_no, status, item_count, created_by, created_at, updated_at, section_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
        [
          inspectionId, template.id, template.component_type, template.form_no,
          partNumber, `Auto-created from injector test bench report ${group[0].job_number || group[0].report_id}`,
          dateReceived, serials, group.length, req.user.id, now, now,
          JSON.stringify({ __admin_sections: adminSections, __items: itemsData }),
        ]
      );

      group.forEach((r, idx) => {
        db.run(
          'UPDATE injector_test_results SET inspection_id = ?, inspection_item_index = ?, updated_at = ? WHERE id = ?',
          [inspectionId, idx, now, r.id]
        );
      });

      created.push(inspectionId);
    }

    res.status(201).json({ created, skippedAlreadyLinked });
  } catch (err) { next(err); }
});

// POST /api/injector-tests/report/pdf — landscape multi-injector comparison PDF
router.post('/report/pdf', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.result_ids) ? req.body.result_ids : [];
    if (ids.length === 0) return next(new AppError('result_ids is required', 400, 'VALIDATION_ERROR'));

    const placeholders = ids.map(() => '?').join(',');
    const rows = db.all(
      `SELECT r.*, rep.job_number FROM injector_test_results r
       JOIN injector_test_reports rep ON rep.id = r.report_id
       WHERE r.id IN (${placeholders})`,
      ids
    );
    if (rows.length === 0) return next(new AppError('No matching injector results found', 404, 'NOT_FOUND'));

    const injectors = rows.map(r => ({
      serial_number: r.serial_number,
      part_number: r.part_number,
      overall_result: r.overall_result,
      tests: parseTests(r.tests_json),
    }));

    const buffer = await generateInjectorComparisonPdf(injectors);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Injector_Comparison_${Date.now()}.pdf"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

module.exports = router;
