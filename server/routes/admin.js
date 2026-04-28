'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

function requireAdmin(req, res, next) {
  if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
  next();
}

function requireAdminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return next(new AppError('Unauthorized', 403));
  next();
}

// ── Templates ────────────────────────────────────────────────────────────────

router.get('/templates', (req, res, next) => {
  try {
    const templates = db.all(
      'SELECT id, form_no, title, component_type, disposition_type, revision, active, created_at FROM inspection_templates ORDER BY component_type, form_no',
      []
    );
    res.json({ templates });
  } catch (err) { next(err); }
});

router.get('/templates/:id', (req, res, next) => {
  try {
    const t = db.get('SELECT * FROM inspection_templates WHERE id = ?', [req.params.id]);
    if (!t) return next(new AppError('Template not found', 404));
    t.sections = JSON.parse(t.sections || '{}');
    t.header_schema = JSON.parse(t.header_schema || '[]');
    res.json({ template: t });
  } catch (err) { next(err); }
});

router.post('/templates', requireAdmin, (req, res, next) => {
  try {
    const { form_no, title, component_type, disposition_type, revision, header_schema, sections } = req.body;
    if (!form_no || !title || !component_type) return next(new AppError('form_no, title, component_type are required', 400));
    const id = uuidv4();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO inspection_templates (id, form_no, title, component_type, disposition_type, revision, form_type, header_schema, sections, active, created_at, version)
       VALUES (?, ?, ?, ?, ?, ?, 'iqi_standard', ?, ?, 1, ?, 1)`,
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

// POST /api/admin/templates/:id/version — create a new version of an existing template
router.post('/templates/:id/version', requireAdmin, (req, res, next) => {
  try {
    const parent = db.get('SELECT * FROM inspection_templates WHERE id = ?', [req.params.id]);
    if (!parent) return next(new AppError('Template not found', 404));
    const { title, revision, header_schema, sections } = req.body;
    const newId = uuidv4();
    const now = new Date().toISOString();
    const newVersion = (parent.version || 1) + 1;
    db.run(
      `INSERT INTO inspection_templates (id, form_no, title, component_type, disposition_type, revision, form_type, header_schema, sections, active, created_at, version, parent_template_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        newId, parent.form_no,
        title || parent.title,
        parent.component_type,
        parent.disposition_type,
        revision || parent.revision,
        parent.form_type,
        JSON.stringify(header_schema || JSON.parse(parent.header_schema || '[]')),
        JSON.stringify(sections || JSON.parse(parent.sections || '{}')),
        now, newVersion, parent.id,
      ]
    );
    // Deactivate old template
    db.run('UPDATE inspection_templates SET active = 0 WHERE id = ?', [parent.id]);
    const t = db.get('SELECT * FROM inspection_templates WHERE id = ?', [newId]);
    t.sections = JSON.parse(t.sections || '{}');
    t.header_schema = JSON.parse(t.header_schema || '[]');
    res.status(201).json({ template: t });
  } catch (err) { next(err); }
});

router.delete('/templates/:id', requireAdminOnly, (req, res, next) => {
  try {
    const t = db.get('SELECT id FROM inspection_templates WHERE id = ?', [req.params.id]);
    if (!t) return next(new AppError('Template not found', 404));
    db.run('UPDATE inspection_templates SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Part Specs ────────────────────────────────────────────────────────────────

router.get('/templates/:id/part-specs', requireAdmin, (req, res, next) => {
  try {
    const specs = db.all('SELECT * FROM part_specs WHERE template_id = ? ORDER BY part_number', [req.params.id]);
    res.json({ specs });
  } catch (err) { next(err); }
});

router.put('/templates/:id/part-specs/:partNumber', requireAdmin, (req, res, next) => {
  try {
    const { spec_data, description } = req.body;
    const now = new Date().toISOString();
    const existing = db.get('SELECT id FROM part_specs WHERE template_id = ? AND part_number = ?', [req.params.id, req.params.partNumber]);
    if (existing) {
      db.run('UPDATE part_specs SET spec_data = ?, description = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(spec_data || {}), description || null, now, existing.id]);
    } else {
      db.run('INSERT INTO part_specs (id, template_id, part_number, description, spec_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), req.params.id, req.params.partNumber, description || null, JSON.stringify(spec_data || {}), now, now]);
    }
    const spec = db.get('SELECT * FROM part_specs WHERE template_id = ? AND part_number = ?', [req.params.id, req.params.partNumber]);
    if (spec) spec.spec_data = JSON.parse(spec.spec_data || '{}');
    res.json({ spec });
  } catch (err) { next(err); }
});

router.delete('/templates/:id/part-specs/:partNumber', requireAdmin, (req, res, next) => {
  try {
    db.run('DELETE FROM part_specs WHERE template_id = ? AND part_number = ?', [req.params.id, req.params.partNumber]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', requireAdmin, (req, res, next) => {
  try {
    const { include_inactive } = req.query;
    let sql = 'SELECT id, name, email, role, active, permissions, created_at FROM users';
    if (!include_inactive) sql += ' WHERE active = 1';
    sql += ' ORDER BY name';
    const users = db.all(sql, []);
    res.json({ users });
  } catch (err) { next(err); }
});

router.post('/users', requireAdmin, async (req, res, next) => {
  try {
    const { name, email, role, password, active, permTabs, usePermissions } = req.body;
    if (!name || !email || !password) return next(new AppError('name, email, and password are required', 400));
    const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return next(new AppError('Email already in use', 409));
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const now = new Date().toISOString();
    const permissions = usePermissions && Array.isArray(permTabs)
      ? JSON.stringify({ tabs: permTabs })
      : null;
    db.run(
      `INSERT INTO users (id, name, email, role, password_hash, active, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, role || 'inspector', hash, active ?? 1, permissions, now]
    );
    const user = db.get('SELECT id, name, email, role, active, permissions, created_at FROM users WHERE id = ?', [id]);
    res.status(201).json({ user });
  } catch (err) { next(err); }
});

router.patch('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = db.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!existing) return next(new AppError('User not found', 404));
    const updates = [];
    const values = [];
    const { name, email, role, password, active, permTabs, usePermissions } = req.body;
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (role !== undefined) { updates.push('role = ?'); values.push(role); }
    if (active !== undefined) { updates.push('active = ?'); values.push(active); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      values.push(hash);
    }
    if (usePermissions !== undefined) {
      const permissions = usePermissions && Array.isArray(permTabs)
        ? JSON.stringify({ tabs: permTabs })
        : null;
      updates.push('permissions = ?');
      values.push(permissions);
    }
    if (updates.length === 0) return res.json({ ok: true });
    values.push(req.params.id);
    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    const user = db.get('SELECT id, name, email, role, active, permissions, created_at FROM users WHERE id = ?', [req.params.id]);
    res.json({ user });
  } catch (err) { next(err); }
});

module.exports = router;