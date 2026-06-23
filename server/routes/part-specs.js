'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

// GET /api/part-specs/lookup?q=&template_id=&limit=
// Returns a deduped list of known part numbers for autocomplete. Sources are
// the curated part_specs catalogue (authoritative description + template) plus
// part numbers already used on past inspections (so recently-entered parts are
// suggested even before a spec row exists). part_specs wins on conflicts.
router.get('/lookup', (req, res, next) => {
  try {
    const { q, template_id } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const like = q ? `%${String(q).trim()}%` : null;

    // 1) Curated catalogue (authoritative)
    let psSql = `SELECT ps.part_number, ps.description, ps.template_id,
                        t.form_no, t.title AS template_title, t.component_type
                 FROM part_specs ps
                 JOIN inspection_templates t ON t.id = ps.template_id
                 WHERE ps.part_number IS NOT NULL AND ps.part_number <> ''`;
    const psParams = [];
    if (template_id) { psSql += ' AND ps.template_id = ?'; psParams.push(template_id); }
    if (like) { psSql += ' AND (ps.part_number LIKE ? OR ps.description LIKE ?)'; psParams.push(like, like); }
    psSql += ' ORDER BY ps.part_number ASC';
    const catalogue = db.all(psSql, psParams);

    // 2) Distinct part numbers seen on inspections (most recent description wins)
    let inSql = `SELECT i.part_number, i.description, i.template_id,
                        t.form_no, t.title AS template_title, t.component_type,
                        MAX(i.created_at) AS last_used
                 FROM inspections i
                 JOIN inspection_templates t ON t.id = i.template_id
                 WHERE i.part_number IS NOT NULL AND i.part_number <> ''`;
    const inParams = [];
    if (template_id) { inSql += ' AND i.template_id = ?'; inParams.push(template_id); }
    if (like) { inSql += ' AND (i.part_number LIKE ? OR i.description LIKE ?)'; inParams.push(like, like); }
    inSql += ' GROUP BY i.part_number, i.template_id ORDER BY last_used DESC';
    const history = db.all(inSql, inParams);

    // Merge: keyed by part_number; catalogue entries are authoritative.
    const byPart = new Map();
    for (const row of catalogue) {
      byPart.set(row.part_number, {
        part_number: row.part_number,
        description: row.description || '',
        template_id: row.template_id,
        form_no: row.form_no,
        template_title: row.template_title,
        component_type: row.component_type,
        source: 'catalogue',
      });
    }
    for (const row of history) {
      if (byPart.has(row.part_number)) continue;
      byPart.set(row.part_number, {
        part_number: row.part_number,
        description: row.description || '',
        template_id: row.template_id,
        form_no: row.form_no,
        template_title: row.template_title,
        component_type: row.component_type,
        source: 'history',
      });
    }

    const results = Array.from(byPart.values())
      .sort((a, b) => a.part_number.localeCompare(b.part_number))
      .slice(0, limit);

    res.json({ results });
  } catch (err) { next(err); }
});

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
  } catch (err) {
    if (/UNIQUE constraint/i.test(err?.message || '')) {
      return next(new AppError('That part number already exists for this product type', 409));
    }
    next(err);
  }
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
    if (req.body.template_id !== undefined) {
      // Allow re-assigning the product type (template) of an existing part.
      const tmpl = db.get('SELECT id FROM inspection_templates WHERE id = ?', [req.body.template_id]);
      if (!tmpl) return next(new AppError('Template not found', 404));
      updates.push('template_id = ?'); values.push(req.body.template_id);
    }
    if (updates.length === 0) return res.json({ spec: existing });
    updates.push('updated_at = ?'); values.push(now); values.push(req.params.id);
    db.run(`UPDATE part_specs SET ${updates.join(', ')} WHERE id = ?`, values);
    const spec = db.get('SELECT * FROM part_specs WHERE id = ?', [req.params.id]);
    spec.spec_data = JSON.parse(spec.spec_data || '{}');
    res.json({ spec });
  } catch (err) {
    if (/UNIQUE constraint/i.test(err?.message || '')) {
      return next(new AppError('That part number already exists for this product type', 409));
    }
    next(err);
  }
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
