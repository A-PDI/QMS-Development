'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

function requireAdmin(req, res, next) {
  if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
  next();
}

// ── Templates ────────────────────────────────────────────────────────────────

// GET /api/admin/templates
router.get('/templates', (req, res, next) => {
  try {
    const templates = db.all(
      'SELECT id, form_no, title, component_type, disposition_type, revision, active, created_at FROM inspection_templates ORDER BY component_type, form_no',
      []
    );
    res.json({ templates });
  } catch (err) { next(err); }
});

// GET /api/admin/templates/:id (full with sections)
router.get('/templates/:id', (req, res, next) => {
  try {
    const t = db.get('SELECT * FROM inspection_templates WHERE id = ?', [req.params.id]);
    if (!t) return next(new AppError('Template not found', 404));
    t.sections = JSON.parse(t.sections || '{}');
    t.header_schema = JSON.parse(t.header_schema || '[]');
    res.json({ template: t });
  } catch (err) { next(err); }
});

// POST /api/admin/templates
router.post('/templates', requireAdmin, (req, res, next) => {
  try {
    const { form_no, title, component_type, disposition_type, revision, header_schema, sections } = req.body;
    if (!form_no || !title || !component_type) return next(new AppError('form_no, title, component_type are required', 400));
    const id = uuidv4();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO inspection_templates (id, form_no, title, component_type, disposition_type, revision, form_type, header_schema, sections, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'iqi_standard', ?, ?, 1, ?)`,
      [
        id, form_no, title, component_type,
        disposition_type || 'pass_fail', revision || '',
        JSON.stringify(header_schema || []),
        JSON.stringify(sections || {}), now,
      ]
    );
    const t = db.get('SELECT * FROM inspection_templates WHERE id = ?', [id]);
    t.sections = JSON.parse(t.sections || '{}');
    t.header_schema = JSON.parse(t.header_schema || '[]');
    res.status(201).json({ template: t });
  } catch (err) { next(err); }
});

// PATCH /api/admin/templates/:id
router.patch('/templates/:id', requireAdmin, (req, res, next) => {
  try {
    const existing = db.get('SELECT id FROM inspection_templates WHERE id = ?', [req.params.id]);
    if (!existing) return next(new AppError('Template not found', 404));
    const updates = [];
    const values = [];
    const fields = ['form_no', 'title', 'component_type', 'disposition_type', 'revision', 'active'];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (req.body.sections !== undefined) { updates.push('sections = ?'); values.push(JSON.stringify(req.body.sections)); }
    if (req.body.header_schema !== undefined) { updates.push('header_schema = ?'); values.push(JSON.stringify(req.body.header_schema)); }
    if (updates.length === 0) return res.json({ ok: true });
    values.push(req.params.id);
    db.run(`UPDATE inspection_templates SET ${updates.join(', ')} WHERE id = ?`, values);
    const t = db.get('SELECT * FROM inspection_templates WHERE id = ?', [req.params.id]);
    t.sections = JSON.parse(t.sections || '{}');
    t.header_schema = JSON.parse(t.header_schema || '[]');
    res.json({ template: t });
  } catch (err) { next(err); }
});

module.exports = router;
