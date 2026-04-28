"use strict";
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const db = require("../db/adapter");
const { AppError } = require("../middleware/error");
const { generateInspectionPdf } = require("../services/pdf");

function logActivity(inspectionId, actionType, user) {
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
      `INSERT INTO inspection_activity_log (id, inspection_id, action_type, actor_name, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), inspectionId, actionType, user?.name || null, user?.id || null, new Date().toISOString()]
    );
  } catch (_) {}
}

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
      page = 1,
      limit = 20,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql = `SELECT id, template_id, component_type, form_no, part_number, po_number, supplier, lot_serial_no, date_received, inspector_name, lot_size, sample_size, disposition, status, created_at, completed_at, due_date, assigned_to, assigned_at FROM inspections WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (component_type) { sql += ' AND component_type = ?'; params.push(component_type); }
    if (inspector_name) { sql += ' AND inspector_name = ?'; params.push(inspector_name); }
    if (date_from) { sql += ' AND date_received >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND date_received <= ?'; params.push(date_to); }
    if (search) {
      sql +=
        " AND (part_number LIKE ? OR po_number LIKE ? OR inspector_name LIKE ? OR lot_serial_no LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    sql += ' ORDER BY created_at DESC';
    const countSql = sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as count FROM');
    const total = db.get(countSql, params).count;
    const inspections = db.all(sql + ` LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    res.json({ inspections, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// GET /api/inspections/assigned — inspections assigned to the current user
router.get('/assigned', (req, res, next) => {
  try {
    const inspections = db.all(
      `SELECT id, template_id, component_type, form_no, part_number, po_number, supplier, lot_serial_no, date_received, inspector_name, lot_size, sample_size, disposition, status, created_at, completed_at, due_date, assigned_to, assigned_at
       FROM inspections
       WHERE assigned_to = ? AND status != 'complete'
       ORDER BY due_date ASC, created_at DESC`,
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
    const template = db.get('SELECT * FROM inspection_templates WHERE id = ?', [template_id]);
    if (!template) return next(new AppError('Template not found', 404, 'NOT_FOUND'));
    if (assigned_to) {
      const assignee = db.get('SELECT id FROM users WHERE id = ? AND active = 1', [assigned_to]);
      if (!assignee) return next(new AppError('Assigned user not found', 404, 'NOT_FOUND'));
    }
    const inspectionId = uuidv4();
    const now = new Date().toISOString();
    db.run(`INSERT INTO inspections (id, template_id, component_type, form_no, part_number, supplier, po_number, description, date_received, inspector_name, lot_size, aql_level, sample_size, lot_serial_no, signature, status, created_by, assigned_to, assigned_at, assigned_by, due_date, created_at, updated_at, section_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [inspectionId, template_id, template.component_type, template.form_no,
       part_number || null, supplier || null, po_number || null, description || null,
       date_received || null, inspector_name || null, lot_size || null, aql_level || null,
       sample_size || null, lot_serial_no || null, signature || null,
       req.user.id, assigned_to || null, assigned_to ? now : null,
       assigned_to ? req.user.id : null, due_date || null, now, now, JSON.stringify({})]
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
      'SELECT id, action_type, actor_name, created_at FROM inspection_activity_log WHERE inspection_id = ? ORDER BY created_at DESC LIMIT 50',
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
router.patch('/:id', (req, res, next) => {
  try {
    const existing = db.get('SELECT id, status FROM inspections WHERE id = ?', [req.params.id]);
    if (!existing) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));

    const updates = [];
    const values = [];
    const scalarFields = [
      'part_number', 'supplier', 'po_number', 'description', 'date_received',
      'inspector_name', 'lot_size', 'aql_level', 'sample_size', 'lot_serial_no',
      'signature', 'disposition', 'status', 'due_date',
    ];
    for (const f of scalarFields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (req.body.section_data !== undefined) {
      updates.push('section_data = ?');
      values.push(JSON.stringify(req.body.section_data));
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
router.post('/:id/complete', (req, res, next) => {
  try {
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    if (inspection.status === 'complete') return next(new AppError('Inspection already complete', 400, 'VALIDATION_ERROR'));

    const now = new Date().toISOString();
    const { disposition } = req.body;
    db.run(
      `UPDATE inspections SET status = 'complete', completed_at = ?, updated_at = ?${disposition ? ', disposition = ?' : ''} WHERE id = ?`,
      disposition ? [now, now, disposition, req.params.id] : [now, now, req.params.id]
    );
    logActivity(req.params.id, 'completed', req.user);

    // Trigger quality alert if disposition is fail/reject
    const finalDisposition = disposition || inspection.disposition;
    if (finalDisposition && (finalDisposition.includes('fail') || finalDisposition.includes('reject'))) {
      try {
        db.run(
          `INSERT INTO quality_alerts (id, inspection_id, part_number, supplier, alert_type, triggered_by, created_at)
           VALUES (?, ?, ?, ?, 'inspection_failure', ?, ?)`,
          [uuidv4(), req.params.id, inspection.part_number, inspection.supplier, req.user.id, now]
        );
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
    const pdfBuffer = await generateInspectionPdf({ inspection, template });
    const filename = `${inspection.form_no || 'inspection'}-${inspection.part_number || inspection.id}.pdf`
      .replace(/[^a-zA-Z0-9._-]/g, '_');
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
