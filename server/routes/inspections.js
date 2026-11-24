"use strict";
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const db = require("../db/adapter");
const { AppError } = require("../middleware/error");
const { generateInspectionPdf } = require("../services/pdf");
const { evaluateForSave, describeInvalid } = require("../services/dimensionalEvaluation");

// Roles allowed to perform admin-only inspection actions. Matches requireAdmin
// in routes/admin.js and ADMIN_ROLES in client/src/lib/nav.js.
const ADMIN_ROLES = ['admin', 'qc_manager'];

// Statuses that count as a closed inspection report. 'complete' is the current
// terminal status; the rest are legacy values that the sqlite.js data migration
// folds into 'complete' and that the client still labels "Complete".
const CLOSED_STATUSES = ['complete', 'submitted', 'approved', 'rejected'];

// Upper bound on the reopen reason stored in the activity log.
const REOPEN_REASON_MAX = 500;

function requireAdmin(req, res, next) {
  if (!ADMIN_ROLES.includes(req.user?.role)) return next(new AppError('Unauthorized', 403, 'FORBIDDEN'));
  next();
}

function logActivity(inspectionId, actionType, user, notes = null) {
  try {
    if (actionType === "edited") {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recent = db.get(
        `SELECT id FROM inspection_activity_log WHERE inspection_id = ? AND action_type = 'edited' AND created_at > ? LIMIT 1`,
        [inspectionId, cutoff],
      );
      if (recent) return;
    }
    db.run(
      `INSERT INTO inspection_activity_log (id, inspection_id, action_type, actor_name, actor_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), inspectionId, actionType, user?.name || null, user?.id || null, notes || null, new Date().toISOString()]
    );
  } catch (_) {}
}

// Part description shown on inspection lists: the description recorded on the
// inspection, or else the catalogue description of its part number on the
// same form (exact part number first, then case/whitespace-insensitive — the
// same match findPartSpec uses). Expects the inspections table aliased as `i`.
//
// The exact and case-insensitive matches are separate subqueries on purpose:
// the SQLite bundled with older Node 22 releases (production runs 22.11.0)
// rejects a subquery whose ORDER BY refers to the outer row's columns with
// "no such column", although newer SQLite accepts it. Keep `i.` columns out
// of any ORDER BY here.
const PART_DESCRIPTION_SQL = `COALESCE(
  NULLIF(TRIM(i.description), ''),
  (SELECT TRIM(ps.description) FROM part_specs ps
   WHERE ps.template_id = i.template_id
     AND ps.part_number = i.part_number
     AND TRIM(COALESCE(ps.description, '')) <> ''
   LIMIT 1),
  (SELECT TRIM(ps.description) FROM part_specs ps
   WHERE ps.template_id = i.template_id
     AND UPPER(TRIM(ps.part_number)) = UPPER(TRIM(i.part_number))
     AND TRIM(COALESCE(ps.description, '')) <> ''
   ORDER BY ps.updated_at DESC
   LIMIT 1)
)`;

// Columns returned for each row of an inspection list.
const LIST_FIELDS_SQL = [
  'id', 'template_id', 'component_type', 'form_no', 'part_number', 'po_number', 'supplier',
  'lot_serial_no', 'date_received', 'inspector_name', 'lot_size', 'sample_size', 'disposition',
  'status', 'item_count', 'created_at', 'completed_at', 'due_date', 'assigned_to', 'assigned_at',
].map((field) => `i.${field}`).join(', ');
const LIST_COLUMNS = `${LIST_FIELDS_SQL}, ${PART_DESCRIPTION_SQL} AS part_description`;

// GET /api/inspections — list with filters and pagination
router.get('/', (req, res, next) => {
  try {
    const {
      status,
      component_type,
      inspector_name,
      date_from,
      date_to,
      search,
      exclude_disposition,
      sort_by,
      sort_dir,
      page = 1,
      limit = 20,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ' WHERE 1=1';
    const params = [];
    if (status) { where += ' AND i.status = ?'; params.push(status); }
    if (component_type) { where += ' AND i.component_type = ?'; params.push(component_type); }
    if (inspector_name) { where += ' AND i.inspector_name = ?'; params.push(inspector_name); }
    if (date_from) { where += ' AND i.date_received >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND i.date_received <= ?'; params.push(date_to); }
    if (search) {
      // Part description matches the one recorded on the inspection or the
      // catalogue description of its part number on the same form.
      where += ` AND (i.part_number LIKE ? OR i.po_number LIKE ? OR i.inspector_name LIKE ? OR i.lot_serial_no LIKE ?
        OR i.description LIKE ?
        OR (i.template_id, UPPER(TRIM(i.part_number))) IN (
          SELECT ps.template_id, UPPER(TRIM(ps.part_number)) FROM part_specs ps WHERE ps.description LIKE ?
        ))`;
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s);
    }
    // Comma-separated disposition codes to leave out (e.g. the NCR inspection
    // picker skips PASS). Case-insensitive; inspections with no disposition yet
    // are always kept.
    if (exclude_disposition) {
      const codes = String(exclude_disposition).split(',')
        .map((code) => code.trim().toUpperCase()).filter(Boolean).slice(0, 10);
      if (codes.length) {
        where += ` AND UPPER(TRIM(COALESCE(i.disposition, ''))) NOT IN (${codes.map(() => '?').join(', ')})`;
        params.push(...codes);
      }
    }
    // Sorting — whitelist columns to avoid SQL injection.
    const SORTABLE = {
      component_type: 'component_type',
      part_number: 'part_number',
      po_number: 'po_number',
      lot_serial_no: 'lot_serial_no',
      inspector_name: 'inspector_name',
      date_received: 'date_received',
      created_at: 'created_at',
      status: 'status',
      disposition: 'disposition',
      item_count: 'item_count',
    };
    const sortCol = SORTABLE[sort_by] || 'created_at';
    const sortDir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    // Stable secondary ordering so equal values keep a deterministic order.
    const orderBy = `ORDER BY i.${sortCol} ${sortDir}, i.created_at DESC`;
    const total = db.get(`SELECT COUNT(*) as count FROM inspections i${where}`, params).count;
    // Page first, then look up the part description for that page's rows only
    // (otherwise it is computed for every row an OFFSET skips).
    const inspections = db.all(
      `SELECT ${LIST_COLUMNS} FROM (
         SELECT ${LIST_FIELDS_SQL}, i.description FROM inspections i${where} ${orderBy} LIMIT ? OFFSET ?
       ) i ${orderBy}`,
      [...params, parseInt(limit), offset]
    );
    res.json({ inspections, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// GET /api/inspections/assigned — inspections assigned to the current user
router.get('/assigned', (req, res, next) => {
  try {
    const inspections = db.all(
      `SELECT ${LIST_COLUMNS}
       FROM inspections i
       WHERE i.assigned_to = ? AND i.status != 'complete'
       ORDER BY i.due_date ASC, i.created_at DESC`,
      [req.user.id]
    );
    res.json({ inspections });
  } catch (err) { next(err); }
});

// POST /api/inspections — create new inspection
router.post('/', (req, res, next) => {
  try {
    const { template_id, part_number, supplier, po_number, description, date_received, inspector_name, lot_size, aql_level, sample_size, lot_serial_no, signature, assigned_to, due_date } = req.body;
    if (!template_id) return next(new AppError('template_id is required', 400, 'VALIDATION_ERROR'));
    // Number of items being inspected (clamped to a sane range).
    let itemCount = parseInt(req.body.item_count, 10);
    if (!Number.isFinite(itemCount) || itemCount < 1) itemCount = 1;
    if (itemCount > 100) itemCount = 100;
    const template = db.get('SELECT * FROM inspection_templates WHERE id = ?', [template_id]);
    if (!template) return next(new AppError('Template not found', 404, 'NOT_FOUND'));
    if (assigned_to) {
      const assignee = db.get('SELECT id FROM users WHERE id = ? AND active = 1', [assigned_to]);
      if (!assignee) return next(new AppError('Assigned user not found', 404, 'NOT_FOUND'));
    }
    const inspectionId = uuidv4();
    const now = new Date().toISOString();
    // Optional initial section_data — lets a one-off Miscellaneous inspection
    // persist its on-the-fly section structure (stored under __admin_sections)
    // at creation time. Only accept a plain object; anything else falls back to {}.
    let initialSectionData = {};
    if (req.body.section_data && typeof req.body.section_data === 'object' && !Array.isArray(req.body.section_data)) {
      initialSectionData = req.body.section_data;
    }
    db.run(`INSERT INTO inspections (id, template_id, component_type, form_no, part_number, supplier, po_number, description, date_received, inspector_name, lot_size, aql_level, sample_size, lot_serial_no, signature, status, item_count, created_by, assigned_to, assigned_at, assigned_by, due_date, created_at, updated_at, section_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [inspectionId, template_id, template.component_type, template.form_no,
       part_number || null, supplier || null, po_number || null, description || null,
       date_received || null, inspector_name || null, lot_size || null, aql_level || null,
       sample_size || null, lot_serial_no || null, signature || null, itemCount,
       req.user.id, assigned_to || null, assigned_to ? now : null,
       assigned_to ? req.user.id : null, due_date || null, now, now, JSON.stringify(initialSectionData)]
    );
    logActivity(inspectionId, assigned_to ? 'assigned' : 'started', req.user);
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [inspectionId]);
    inspection.section_data = JSON.parse(inspection.section_data || '{}');
    res.status(201).json({ inspection });
  } catch (err) {
    next(err);
  }
});

// GET /api/inspections/:id — fetch single inspection with template
router.get('/:id', (req, res, next) => {
  try {
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    inspection.section_data = JSON.parse(inspection.section_data || '{}');
    const template = db.get('SELECT * FROM inspection_templates WHERE id = ?', [inspection.template_id]);
    if (template) {
      template.sections = JSON.parse(template.sections || '{}');
      template.header_schema = JSON.parse(template.header_schema || '[]');
    }
    const attachments = db.all(
      'SELECT id, file_name, mime_type, file_size_bytes, section_key, item_id, uploaded_at FROM inspection_attachments WHERE inspection_id = ? ORDER BY uploaded_at ASC',
      [req.params.id]
    );
    const activity = db.all(
      'SELECT id, action_type, actor_name, notes, created_at FROM inspection_activity_log WHERE inspection_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.params.id]
    );
    // Fetch part specs for the part number + template
    let partSpec = null;
    if (inspection.part_number && inspection.template_id) {
      const ps = db.get(
        'SELECT * FROM part_specs WHERE template_id = ? AND part_number = ?',
        [inspection.template_id, inspection.part_number]
      );
      if (ps) {
        ps.spec_data = JSON.parse(ps.spec_data || '{}');
        partSpec = ps;
      }
    }
    res.json({ inspection, template, attachments, activity, partSpec });
  } catch (err) { next(err); }
});

// PATCH /api/inspections/:id — update inspection fields + section data
router.patch('/:id', async (req, res, next) => {
  try {
    const existing = db.get(
      'SELECT id, status, template_id, part_number, section_data FROM inspections WHERE id = ?',
      [req.params.id]
    );
    if (!existing) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));

    const updates = [];
    const values = [];
    const scalarFields = [
      'part_number', 'supplier', 'po_number', 'description', 'date_received',
      'inspector_name', 'lot_size', 'aql_level', 'sample_size', 'lot_serial_no',
      'signature', 'disposition', 'status', 'due_date', 'item_count',
    ];
    for (const f of scalarFields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (req.body.section_data !== undefined) {
      // Dimensional points with a configured spec get their Pass/Fail from the
      // shared evaluation rules — the same ones the inspection form applies —
      // so a stored result always agrees with its measurement.
      let sectionData = req.body.section_data;
      if (sectionData && typeof sectionData === 'object' && !Array.isArray(sectionData)) {
        const partNumber = req.body.part_number !== undefined ? req.body.part_number : existing.part_number;
        sectionData = (await evaluateForSave({ inspection: existing, sectionData, partNumber })).sectionData;
      }
      updates.push('section_data = ?');
      values.push(JSON.stringify(sectionData));
    }
    // Assignment fields
    if (req.body.assigned_to !== undefined) {
      if (req.body.assigned_to) {
        const assignee = db.get('SELECT id FROM users WHERE id = ? AND active = 1', [req.body.assigned_to]);
        if (!assignee) return next(new AppError('Assigned user not found', 404, 'NOT_FOUND'));
      }
      const now = new Date().toISOString();
      updates.push('assigned_to = ?', 'assigned_at = ?', 'assigned_by = ?');
      values.push(
        req.body.assigned_to || null,
        req.body.assigned_to ? now : null,
        req.body.assigned_to ? req.user.id : null
      );
    }
    if (updates.length === 0) return res.json({ ok: true });
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(req.params.id);
    db.run(`UPDATE inspections SET ${updates.join(', ')} WHERE id = ?`, values);

    // Log activity
    if (req.body.section_data !== undefined) {
      logActivity(req.params.id, 'edited', req.user);
    }
    if (req.body.assigned_to !== undefined) {
      logActivity(req.params.id, req.body.assigned_to ? 'assigned' : 'unassigned', req.user);
    }

    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    inspection.section_data = JSON.parse(inspection.section_data || '{}');
    res.json({ inspection });
  } catch (err) { next(err); }
});

// DELETE /api/inspections/:id
router.delete('/:id', (req, res, next) => {
  try {
    const inspection = db.get('SELECT id FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    db.run('DELETE FROM inspections WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/inspections/:id/complete — mark inspection complete + trigger quality alerts
router.post('/:id/complete', async (req, res, next) => {
  try {
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    if (inspection.status === 'complete') return next(new AppError('Inspection already complete', 400, 'VALIDATION_ERROR'));

    // Re-apply the dimensional evaluation to what is stored before closing the
    // record, and refuse to close it while a reading against a configured spec
    // is not a number (it could not be judged Pass or Fail).
    let storedData;
    try { storedData = JSON.parse(inspection.section_data || '{}'); } catch (_) { storedData = {}; }
    const evaluation = await evaluateForSave({ inspection, sectionData: storedData, partNumber: inspection.part_number });
    if (evaluation.invalid.length > 0) {
      const itemCount = Array.isArray(storedData.__items) ? storedData.__items.length : 1;
      return next(new AppError(
        `Cannot complete: enter a valid number for ${describeInvalid(evaluation.invalid, itemCount)}.`,
        400, 'INVALID_MEASUREMENT'
      ));
    }

    const now = new Date().toISOString();
    if (evaluation.changed) {
      db.run('UPDATE inspections SET section_data = ? WHERE id = ?', [JSON.stringify(evaluation.sectionData), req.params.id]);
    }
    const { disposition } = req.body;
    db.run(
      `UPDATE inspections SET status = 'complete', completed_at = ?, updated_at = ?${disposition ? ', disposition = ?' : ''} WHERE id = ?`,
      disposition ? [now, now, disposition, req.params.id] : [now, now, req.params.id]
    );
    logActivity(req.params.id, 'completed', req.user);

    // Trigger quality alert if disposition is fail/reject. An inspection that
    // was reopened and completed again reuses the alert already raised for it,
    // so long as nobody has acknowledged it yet.
    const finalDisposition = disposition || inspection.disposition;
    if (finalDisposition && (finalDisposition.includes('fail') || finalDisposition.includes('reject'))) {
      try {
        const openAlert = db.get(
          `SELECT id FROM quality_alerts WHERE inspection_id = ? AND alert_type = 'inspection_failure' AND acknowledged_at IS NULL LIMIT 1`,
          [req.params.id]
        );
        if (!openAlert) {
          db.run(
            `INSERT INTO quality_alerts (id, inspection_id, part_number, supplier, alert_type, triggered_by, created_at)
             VALUES (?, ?, ?, ?, 'inspection_failure', ?, ?)`,
            [uuidv4(), req.params.id, inspection.part_number, inspection.supplier, req.user.id, now]
          );
        }
      } catch (_) {}
    }

    const updated = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    updated.section_data = JSON.parse(updated.section_data || '{}');
    res.json({ inspection: updated });
  } catch (err) { next(err); }
});

// POST /api/inspections/:id/review — submit for review (alias for complete with review status)
router.post('/:id/review', (req, res, next) => {
  try {
    const inspection = db.get('SELECT id FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    const now = new Date().toISOString();
    db.run(`UPDATE inspections SET status = 'review', updated_at = ? WHERE id = ?`, [now, req.params.id]);
    logActivity(req.params.id, 'submitted_for_review', req.user);
    const updated = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    updated.section_data = JSON.parse(updated.section_data || '{}');
    res.json({ inspection: updated });
  } catch (err) { next(err); }
});

// POST /api/inspections/:id/reopen — admin-only: return a completed and closed
// inspection to the editable 'draft' state so it can be corrected and completed
// again. The recorded measurements, disposition and attachments are left
// untouched — reopening unlocks the record, it does not erase it. A reason is
// required and is kept in the activity log as the audit trail for the reopen.
router.post('/:id/reopen', requireAdmin, (req, res, next) => {
  try {
    const inspection = db.get('SELECT id, status FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    if (!CLOSED_STATUSES.includes(inspection.status)) {
      return next(new AppError('Only a completed inspection can be reopened', 400, 'VALIDATION_ERROR'));
    }

    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) return next(new AppError('A reason is required to reopen an inspection', 400, 'VALIDATION_ERROR'));
    if (reason.length > REOPEN_REASON_MAX) {
      return next(new AppError(`Reason must be ${REOPEN_REASON_MAX} characters or fewer`, 400, 'VALIDATION_ERROR'));
    }

    // Clearing completed_at keeps the dashboard's open/completed counts honest —
    // a reopened inspection is no longer "completed this month".
    const now = new Date().toISOString();
    db.run(
      `UPDATE inspections SET status = 'draft', completed_at = NULL, updated_at = ? WHERE id = ?`,
      [now, req.params.id]
    );
    logActivity(req.params.id, 'reopened', req.user, reason);

    const updated = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    updated.section_data = JSON.parse(updated.section_data || '{}');
    res.json({ inspection: updated });
  } catch (err) { next(err); }
});

// GET /api/inspections/:id/pdf — generate and stream PDF
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    inspection.section_data = JSON.parse(inspection.section_data || '{}');
    const template = db.get('SELECT * FROM inspection_templates WHERE id = ?', [inspection.template_id]);
    if (template) {
      template.sections = JSON.parse(template.sections || '{}');
      template.header_schema = JSON.parse(template.header_schema || '[]');
    }
    const attachments = db.all(
      'SELECT id, file_name, mime_type, file_path, section_key, item_id, uploaded_at FROM inspection_attachments WHERE inspection_id = ? ORDER BY uploaded_at ASC',
      [req.params.id]
    );
    const pdfBuffer = await generateInspectionPdf(inspection, template, attachments);
    // Filename format: QC_<Part#>_<Serial#>.pdf
    const sanitise = (v, fallback) => {
      const s = String(v ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
      return s || fallback;
    };
    const partPart   = sanitise(inspection.part_number, 'NoPart');
    const serialPart = sanitise(inspection.lot_serial_no, 'NoSerial');
    const filename = `QC_${partPart}_${serialPart}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

// POST /api/inspections/:id/log-activity — manual activity log entry
router.post('/:id/log-activity', (req, res, next) => {
  try {
    const { action_type } = req.body;
    if (!action_type) return next(new AppError('action_type is required', 400, 'VALIDATION_ERROR'));
    const inspection = db.get('SELECT id FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    logActivity(req.params.id, action_type, req.user);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
