'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/quality-alerts
router.get('/', (req, res, next) => {
  try {
    const { acknowledged, part_number, limit = 100 } = req.query;

    let sql = `SELECT
      qa.id, qa.inspection_id, qa.part_number, qa.supplier, qa.alert_type,
      qa.triggered_by, u1.name AS triggered_by_name,
      qa.acknowledged_by, u2.name AS acknowledged_by_name, qa.acknowledged_at,
      qa.notes, qa.created_at,
      i.form_no, i.component_type
     FROM quality_alerts qa
     LEFT JOIN users u1 ON qa.triggered_by = u1.id
     LEFT JOIN users u2 ON qa.acknowledged_by = u2.id
     LEFT JOIN inspections i ON qa.inspection_id = i.id
     WHERE 1=1`;

    const params = [];

    if (acknowledged === 'true') {
      sql += ' AND qa.acknowledged_at IS NOT NULL';
    } else if (acknowledged === 'false') {
      sql += ' AND qa.acknowledged_at IS NULL';
    }

    if (part_number) {
      sql += ' AND qa.part_number = ?';
      params.push(part_number);
    }

    sql += ' ORDER BY qa.created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const alerts = db.all(sql, params);
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// GET /api/quality-alerts/count
router.get('/count', (req, res, next) => {
  try {
    const result = db.get(
      'SELECT COUNT(*) as unacknowledged FROM quality_alerts WHERE acknowledged_at IS NULL',
      []
    );
    res.json({ unacknowledged: result.unacknowledged });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/quality-alerts/:id/acknowledge
router.patch('/:id/acknowledge', (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return next(new AppError('Invalid alert id', 400, 'VALIDATION_ERROR'));
    }

    const alert = db.get('SELECT id FROM quality_alerts WHERE id = ?', [req.params.id]);
    if (!alert) {
      return next(new AppError('Alert not found', 404, 'NOT_FOUND'));
    }

    const now = new Date().toISOString();
    db.run(
      'UPDATE quality_alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?',
      [req.user.id, now, req.params.id]
    );

    const updated = db.get(
      `SELECT
        qa.id, qa.inspection_id, qa.part_number, qa.supplier, qa.alert_type,
        qa.triggered_by, u1.name AS triggered_by_name,
        qa.acknowledged_by, u2.name AS acknowledged_by_name, qa.acknowledged_at,
        qa.notes, qa.created_at,
        i.form_no, i.component_type
       FROM quality_alerts qa
       LEFT JOIN users u1 ON qa.triggered_by = u1.id
       LEFT JOIN users u2 ON qa.acknowledged_by = u2.id
       LEFT JOIN inspections i ON qa.inspection_id = i.id
       WHERE qa.id = ?`,
      [req.params.id]
    );

    res.json({ alert: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
