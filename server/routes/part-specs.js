'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

// GET /api/part-specs?template_id=&part_number=
router.get('/', (req, res, next) => {
  try {
    const { template_id, part_number } = req.query;
    let sql = `SELECT ps.*, t.form_no, t.title as template_title, t.component_type
               FROM part_specs ps JOIN inspection_templates t ON t.id = ps.template_id WHERE 1=1`;
    const params = [];
    if (template_id) { sql += ' AND ps.template_id = ?'; params.push(template_id); }
    if (part_number) { sql += ' AND ps.part_number = ?'; params.push(part_number); }
    sql += ' ORDER BY ps.part_number ASC';
    const specs = db.all(sql, params);
    specs.forEach(s => { s.spec_data = JSON.parse(s.spec_data || '{}'); });
    res.json({ specs });
  } catch (err) { next(err); }
});

// POST /api/part-specs
router.post('/', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const { template_id, part_number, description, spec_data } = req.body;
    if (!template_id || !part_number) return next(new AppError('template_id and part_number are required', 400));

    const template = db.get('SELECT id FROM inspection_templates WHERE id = ?', [template_id]);
    if (!template) return next(new AppError('Template not found', 404));

    const id = uuidv4();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO part_specs (id, template_id, part_number, description, spec_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, template_id, part_number, description || null, JSON.stringify(spec_data || {}), now, now]
    );
    const spec = db.get('SELECT * FROM part_specs WHERE id = ?', [id]);
    spec.spec_data = JSON.parse(spec.spec_data || '{}');
    res.status(201).json({ spec });
  } catch (err) { next(err); }
});

// PATCH /api/part-specs/:id
router.patch('/:id', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const existing = db.get('SELECT id FROM part_specs WHERE id = ?', [req.params.id]);
    if (!existing) return next(new AppError('Part spec not found', 404));

    const now = new Date().toISOString();
    const updates = [];
    const values = [];
    if (req.body.part_number !== undefined) { updates.push('part_number = ?'); values.push(req.body.part_number); }
    if (req.body.description !== undefined) { updates.push('description = ?'); values.push(req.body.description); }
    if (req.body.spec_data !== undefined) { updates.push('spec_data = ?'); values.push(JSON.stringify(req.body.spec_data)); }
    if (updates.length === 0) return res.json({ spec: existing });
    updates.push('updated_at = ?'); values.push(now); values.push(req.params.id);
    db.run(`UPDATE part_specs SET ${updates.join(', ')} WHERE id = ?`, values);
    const spec = db.get('SELECT * FROM part_specs WHERE id = ?', [req.params.id]);
    spec.spec_data = JSON.parse(spec.spec_data || '{}');
    res.json({ spec });
  } catch (err) { next(err); }
});

// DELETE /api/part-specs/:id
router.delete('/:id', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    db.run('DELETE FROM part_specs WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
