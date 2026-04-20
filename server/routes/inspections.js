'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');
const { generateInspectionPdf } = require('../services/pdf');

function logActivity(inspectionId, actionType, user) {
  try {
    if (actionType === 'edited') {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recent = db.get(
        `SELECT id FROM inspection_activity_log WHERE inspection_id = ? AND action_type = 'edited' AND created_at > ? LIMIT 1`,
        [inspectionId, cutoff]
      );
      if (recent) return;
    }
    db.run(
      `INSERT INTO inspection_activity_log (id, inspection_id, action_type, actor_name, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), inspectionId, actionType, user?.name || null, user?.id || null, new Date().toISOString()]
    );
  } catch (_) {}
}

router.get('/', (req, res, next) => {
  try {
    const { status, component_type, inspector_name, date_from, date_to, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql = `SELECT id, template_id, component_type, form_no, part_number, po_number, supplier, lot_serial_no, date_received, inspector_name, lot_size, sample_size, disposition, status, created_at, completed_at, due_date, assigned_to, assigned_at FROM inspections WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (component_type) { sql += ' AND component_type = ?'; params.push(component_type); }
    if (inspector_name) { sql += ' AND inspector_name = ?'; params.push(inspector_name); }
    if (date_from) { sql += ' AND date_received >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND date_received <= ?'; params.push(date_to); }
    if (search) {
      sql += ' AND (part_number LIKE ? OR po_number LIKE ? OR inspector_name LIKE ? OR lot_serial_no LIKE ?)';
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

router.post('/', (req, res, next) => {
  try {
    const { template_id, part_number, supplier, po_number, description, date_received, inspector_name, lot_size, aql_level, sample_size, lot_serial_no, signature } = req.body;
    if (!template_id) return next(new AppError('template_id is required', 400, 'VALIDATION_ERROR'));
    const template = db.get('SELECT * FROM inspection_templates WHERE id = ?', [template_id]);
    if (!template) return next(new AppError('Template not found', 404, 'NOT_FOUND'));
    const inspectionId = uuidv4();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO inspections (id, template_id, component_type, form_no, part_number, supplier, po_number, description, date_received, inspector_name, lot_size, aql_level, sample_size, lot_serial_no, signature, status, created_by, created_at, updated_at, section_data, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      [inspectionId, template_id, template.component_type, template.form_no, part_number || null, supplier || null, po_number || null, description || null, date_received || null, inspector_name || null, lot_size || null, aql_level || null, sample_size || null, lot_serial_no || null, signature || null, req.user.id, now, now, JSON.stringify({}), now]
    );
    logActivity(inspectionId, 'started', req.user);
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [inspectionId]);
    inspection.section_data = JSON.parse(inspection.section_data || '{}');
    res.status(201).json({ inspection });
  } catch (err) { next(err); }
});

router.get('/assigned', (req, res, next) => {
  try {
    const inspections = db.all(
      `SELECT id, form_no, component_type, part_number, po_number, supplier, status, disposition, due_date, assigned_at, started_at, completed_at FROM inspections WHERE assigned_to = ? AND status != 'complete' ORDER BY due_date ASC, created_at ASC`,
      [req.user.id]
    );
    res.json({ inspections });
  } catch (err) { next(err); }
});

router.get('/alerts', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const today = new Date().toISOString().split('T')[0];
    const pastDue = db.all(
      `SELECT i.id, i.form_no, i.component_type, i.part_number, i.status, i.due_date, i.started_at, i.completed_at, u.name as assigned_to_name FROM inspections i LEFT JOIN users u ON i.assigned_to = u.id WHERE i.due_date < ? AND i.status = 'draft' ORDER BY i.due_date ASC`,
      [today]
    );
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const shortDuration = db.all(
      `SELECT i.id, i.form_no, i.component_type, i.part_number, i.status, i.due_date, i.started_at, i.completed_at, u.name as assigned_to_name FROM inspections i LEFT JOIN users u ON i.assigned_to = u.id WHERE i.completed_at IS NOT NULL AND julianday(i.completed_at) - julianday(i.started_at) < 0.0208 AND i.completed_at > ? ORDER BY i.completed_at DESC`,
      [sevenDaysAgo]
    );
    res.json({ past_due: pastDue, short_duration: shortDuration });
  } catch (err) { next(err); }
});

router.get('/:id', (req, res, next) => {
  try {
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    inspection.section_data = JSON.parse(inspection.section_data || '{}');
    res.json({ inspection });
  } catch (err) { next(err); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    const now = new Date().toISOString();
    const updates = [];
    const values = [];
    const headerFields = ['part_number', 'supplier', 'po_number', 'description', 'date_received', 'inspector_name', 'lot_size', 'aql_level', 'sample_size', 'lot_serial_no', 'signature'];
    for (const field of headerFields) {
      if (req.body[field] !== undefined) { updates.push(`${field} = ?`); values.push(req.body[field]); }
    }
    if (req.body.section_data !== undefined) { updates.push('section_data = ?'); values.push(JSON.stringify(req.body.section_data)); }
    if (req.body.disposition !== undefined) { updates.push('disposition = ?'); values.push(req.body.disposition); }
    if (req.body.disposition_notes !== undefined) { updates.push('disposition_notes = ?'); values.push(req.body.disposition_notes); }
    if (updates.length > 0 && !inspection.started_at) { updates.push('started_at = ?'); values.push(now); }
    if (updates.length === 0) { inspection.section_data = JSON.parse(inspection.section_data || '{}'); return res.json({ inspection }); }
    updates.push('updated_at = ?'); values.push(now); values.push(id);
    db.run(`UPDATE inspections SET ${updates.join(', ')} WHERE id = ?`, values);
    logActivity(id, 'edited', req.user);
    const updated = db.get('SELECT * FROM inspections WHERE id = ?', [id]);
    updated.section_data = JSON.parse(updated.section_data || '{}');
    res.json({ inspection: updated });
  } catch (err) { next(err); }
});

router.post('/:id/complete', (req, res, next) => {
  try {
    const { id } = req.params;
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    if (inspection.status === 'complete') return next(new AppError('Already completed', 400));
    const now = new Date().toISOString();
    const disp = req.body.disposition || inspection.disposition;
    const dispNotes = req.body.disposition_notes || inspection.disposition_notes;
    if ((disp === 'ACCEPTED' || disp === 'FAIL') && !(dispNotes && dispNotes.trim())) {
      return next(new AppError('An explanation is required for FAIL or ACCEPTED dispositions', 400, 'VALIDATION_ERROR'));
    }
    db.run(`UPDATE inspections SET status = 'complete', completed_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
    logActivity(id, 'completed', req.user);
    if (disp === 'ACCEPTED') {
      try {
        db.run(
          `INSERT INTO quality_alerts (id, inspection_id, part_number, supplier, alert_type, triggered_by, created_at) VALUES (?, ?, ?, ?, 'accepted_disposition', ?, ?)`,
          [uuidv4(), id, inspection.part_number || null, inspection.supplier || null, req.user.id, now]
        );
      } catch (_) {}
    }
    const updated = db.get('SELECT * FROM inspections WHERE id = ?', [id]);
    updated.section_data = JSON.parse(updated.section_data || '{}');
    res.json({ inspection: updated });
  } catch (err) { next(err); }
});

router.patch('/:id/assign', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const { id } = req.params;
    const { assigned_to, due_date } = req.body;
    if (!assigned_to) return next(new AppError('assigned_to is required', 400, 'VALIDATION_ERROR'));
    const inspection = db.get('SELECT id FROM inspections WHERE id = ?', [id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    const user = db.get('SELECT id FROM users WHERE id = ?', [assigned_to]);
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'));
    const now = new Date().toISOString();
    db.run(`UPDATE inspections SET assigned_to = ?, assigned_at = ?, assigned_by = ?, due_date = ?, updated_at = ? WHERE id = ?`, [assigned_to, now, req.user.id, due_date || null, now, id]);
    logActivity(id, 'assigned', req.user);
    const updated = db.get('SELECT * FROM inspections WHERE id = ?', [id]);
    updated.section_data = JSON.parse(updated.section_data || '{}');
    res.json({ inspection: updated });
  } catch (err) { next(err); }
});

router.post('/:id/log-activity', (req, res, next) => {
  try {
    const { action_type } = req.body;
    const allowed = ['emailed', 'printed', 'edited', 'viewed'];
    if (!allowed.includes(action_type)) return next(new AppError('Invalid action_type', 400));
    logActivity(req.params.id, action_type, req.user);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const inspection = db.get('SELECT id FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    db.run('DELETE FROM inspections WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/pdf', async (req, res, next) => {
  try {
    const { id } = req.params;
    const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [id]);
    if (!inspection) return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    const template = db.get('SELECT * FROM inspection_templates WHERE id = ?', [inspection.template_id]);
    if (!template) return next(new AppError('Template not found', 404, 'NOT_FOUND'));
    inspection.section_data = JSON.parse(inspection.section_data || '{}');
    template.header_schema = JSON.parse(template.header_schema || '[]');
    template.sections = JSON.parse(template.sections || '{}');
    const attachments = db.all('SELECT id, file_name, file_path, mime_type, section_key, item_id FROM inspection_attachments WHERE inspection_id = ? ORDER BY uploaded_at ASC', [id]);
    const pdfBuffer = await generateInspectionPdf(inspection, template, attachments);
    logActivity(id, 'printed', req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="inspection-${id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

module.exports = router;
