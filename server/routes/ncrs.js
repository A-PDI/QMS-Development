'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

function nextNcrNumber() {
  const row = db.get(`SELECT ncr_number FROM ncrs ORDER BY created_at DESC LIMIT 1`, []);
  if (!row) return 'NCR-0001';
  const match = (row.ncr_number || '').match(/(\d+)$/);
  const next = match ? parseInt(match[1]) + 1 : 1;
  return `NCR-${String(next).padStart(4, '0')}`;
}

// GET /api/ncrs
router.get('/', (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql = `SELECT n.*, i.form_no, i.component_type FROM ncrs n LEFT JOIN inspections i ON i.id = n.inspection_id WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND n.status = ?'; params.push(status); }
    if (search) {
      sql += ' AND (n.part_number LIKE ? OR n.ncr_number LIKE ? OR n.supplier LIKE ? OR n.po_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    sql += ' ORDER BY n.created_at DESC';
    const countSql = sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as count FROM');
    const total = db.get(countSql, params).count;
    const ncrs = db.all(sql + ` LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    res.json({ ncrs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// POST /api/ncrs
router.post('/', (req, res, next) => {
  try {
    const {
      inspection_id, part_number, supplier, po_number,
      description_of_defect, quantity_affected, severity,
      ncr_disposition, corrective_action_required, corrective_action_due_date,
    } = req.body;
    if (!description_of_defect) return next(new AppError('description_of_defect is required', 400));

    const id = uuidv4();
    const ncr_number = nextNcrNumber();
    const now = new Date().toISOString();

    // Pull part info from inspection if not provided
    let partNumber = part_number, supplierVal = supplier, poNumber = po_number;
    if (inspection_id) {
      const insp = db.get('SELECT part_number, supplier, po_number FROM inspections WHERE id = ?', [inspection_id]);
      if (insp) {
        partNumber = partNumber || insp.part_number;
        supplierVal = supplierVal || insp.supplier;
        poNumber = poNumber || insp.po_number;
      }
    }

    db.run(
      `INSERT INTO ncrs (id, ncr_number, inspection_id, part_number, supplier, po_number,
         description_of_defect, quantity_affected, severity, ncr_disposition,
         corrective_action_required, corrective_action_due_date,
         status, created_by, created_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [
        id, ncr_number, inspection_id || null, partNumber || null, supplierVal || null, poNumber || null,
        description_of_defect, quantity_affected || null, severity || 'major',
        ncr_disposition || 'pending', corrective_action_required ? 1 : 0,
        corrective_action_due_date || null, req.user.id, req.user.name || null, now, now,
      ]
    );

    const ncr = db.get('SELECT * FROM ncrs WHERE id = ?', [id]);
    res.status(201).json({ ncr });
  } catch (err) { next(err); }
});

// GET /api/ncrs/:id
router.get('/:id', (req, res, next) => {
  try {
    const ncr = db.get(
      `SELECT n.*, i.form_no, i.component_type, i.inspector_name FROM ncrs n
       LEFT JOIN inspections i ON i.id = n.inspection_id WHERE n.id = ?`,
      [req.params.id]
    );
    if (!ncr) return next(new AppError('NCR not found', 404, 'NOT_FOUND'));
    res.json({ ncr });
  } catch (err) { next(err); }
});

// PATCH /api/ncrs/:id
router.patch('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const ncr = db.get('SELECT id, status FROM ncrs WHERE id = ?', [id]);
    if (!ncr) return next(new AppError('NCR not found', 404, 'NOT_FOUND'));

    const now = new Date().toISOString();
    const fields = [
      'part_number', 'supplier', 'po_number', 'description_of_defect',
      'quantity_affected', 'severity', 'ncr_disposition',
      'corrective_action_required', 'corrective_action_due_date', 'status',
    ];
    const updates = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    // Handle close
    if (req.body.status === 'closed' && ncr.status !== 'closed') {
      updates.push('closed_at = ?'); values.push(now);
    }
    if (updates.length === 0) return res.json({ ncr });
    updates.push('updated_at = ?'); values.push(now); values.push(id);
    db.run(`UPDATE ncrs SET ${updates.join(', ')} WHERE id = ?`, values);

    const updated = db.get('SELECT * FROM ncrs WHERE id = ?', [id]);
    res.json({ ncr: updated });
  } catch (err) { next(err); }
});

// DELETE /api/ncrs/:id
router.delete('/:id', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    db.run('DELETE FROM ncrs WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
