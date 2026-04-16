'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/adapter');

// GET /api/dashboard/stats
router.get('/stats', (req, res, next) => {
  try {
    const total_inspections = db.get('SELECT COUNT(*) as count FROM inspections', []).count;
    const open_inspections = db.get("SELECT COUNT(*) as count FROM inspections WHERE status = 'draft'", []).count;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    const completed_this_month = db.get(
      `SELECT COUNT(*) as count FROM inspections WHERE status = 'complete' AND completed_at >= ? AND completed_at <= ?`,
      [monthStart, monthEnd]
    ).count;

    const open_ncrs = db.get(`SELECT COUNT(*) as count FROM ncrs WHERE status = 'open'`, []).count;

    const byType = db.all(
      'SELECT component_type, COUNT(*) as count FROM inspections GROUP BY component_type ORDER BY count DESC',
      []
    );

    const byStatus = db.all(
      'SELECT status, COUNT(*) as count FROM inspections GROUP BY status ORDER BY status',
      []
    );

    // Recent activity from the log table — top 10
    const recentActivity = db.all(
      `SELECT l.action_type, l.actor_name, l.created_at,
              i.id, i.form_no, i.part_number, i.component_type
       FROM inspection_activity_log l
       JOIN inspections i ON i.id = l.inspection_id
       ORDER BY l.created_at DESC
       LIMIT 10`,
      []
    );

    // Recent inspections (for list when card is clicked — kept for compat)
    const recent_inspections = db.all(
      `SELECT id, form_no, part_number, component_type, supplier, date_received,
              inspector_name, lot_size, sample_size, po_number, lot_serial_no,
              disposition, status, created_at, completed_at
       FROM inspections ORDER BY created_at DESC LIMIT 5`,
      []
    );

    res.json({
      total_inspections,
      open_inspections,
      completed_this_month,
      open_ncrs,
      by_component_type: byType,
      by_status: byStatus,
      recent_activity: recentActivity,
      recent_inspections,
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/chart?period=month|week|year&range=3|6|12
router.get('/chart', (req, res, next) => {
  try {
    const { period = 'month', range = '6' } = req.query;
    const rangeNum = parseInt(range) || 6;

    let dateTrunc, since;
    if (period === 'week') {
      since = new Date(Date.now() - rangeNum * 7 * 24 * 3600 * 1000).toISOString();
      dateTrunc = `strftime('%Y-W%W', created_at)`;
    } else if (period === 'year') {
      since = new Date(Date.now() - rangeNum * 365 * 24 * 3600 * 1000).toISOString();
      dateTrunc = `strftime('%Y', created_at)`;
    } else {
      // month (default)
      since = new Date(Date.now() - rangeNum * 30 * 24 * 3600 * 1000).toISOString();
      dateTrunc = `strftime('%Y-%m', created_at)`;
    }

    const rows = db.all(
      `SELECT ${dateTrunc} as period, component_type, COUNT(*) as count
       FROM inspections
       WHERE created_at >= ?
       GROUP BY period, component_type
       ORDER BY period ASC`,
      [since]
    );

    res.json({ rows, period, range: rangeNum });
  } catch (err) { next(err); }
});

module.exports = router;
