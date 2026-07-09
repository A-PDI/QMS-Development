'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/adapter');

// GET /api/dashboard/stats
router.get('/stats', (req, res, next) => {
  try {
    const total_inspections = db.get('SELECT COUNT(*) as count FROM inspections', []).count;
    // Open = not yet finalized: drafts plus partially-complete inspections.
    const open_inspections = db.get("SELECT COUNT(*) as count FROM inspections WHERE status IN ('draft', 'partially_complete')", []).count;

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

    // Recent inspections — most recently updated
    const recent_inspections = db.all(
      `SELECT id, form_no, part_number, component_type, supplier, date_received,
              inspector_name, lot_size, sample_size, po_number, lot_serial_no,
              disposition, status, created_at, updated_at, completed_at
       FROM inspections ORDER BY updated_at DESC LIMIT 10`,
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

// GET /api/dashboard/alerts — past-due and short-duration inspections for admin panels
router.get('/alerts', (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const past_due = db.all(
      `SELECT i.id, i.form_no, i.part_number, i.due_date, u.name AS assigned_to_name
       FROM inspections i
       LEFT JOIN users u ON i.assigned_to = u.id
       WHERE i.status NOT IN ('complete') AND i.due_date IS NOT NULL AND i.due_date < ?
       ORDER BY i.due_date ASC
       LIMIT 20`,
      [today]
    );

    const short_duration = db.all(
      `SELECT id, form_no, part_number, component_type, inspector_name, created_at,
         CAST((julianday(completed_at) - julianday(created_at)) * 24 * 60 AS INTEGER) AS duration_minutes
       FROM inspections
       WHERE status = 'complete' AND completed_at IS NOT NULL
         AND (julianday(completed_at) - julianday(created_at)) * 24 * 60 < 15
       ORDER BY completed_at DESC
       LIMIT 20`,
      []
    );

    res.json({ past_due, short_duration });
  } catch (err) { next(err); }
});

// ─── Fire Ring eligibility ───────────────────────────────────────────────────
// Mirrors client helpers in client/src/lib/utils.js. An inspection is eligible
// for the "Add Fire Ring" action when it is a complete cylinder-head inspection
// whose Fire Ring (groove_specs) section has no per-cylinder values entered yet.

function parseJSON(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value || 'null') ?? fallback; } catch { return fallback; }
}

function effectiveSections(templateSections, sectionData) {
  if (sectionData && sectionData.__admin_sections && typeof sectionData.__admin_sections === 'object') {
    return sectionData.__admin_sections;
  }
  return templateSections || {};
}

function sectionItems(sectionData) {
  if (Array.isArray(sectionData?.__items) && sectionData.__items.length > 0) {
    return sectionData.__items;
  }
  const legacy = {};
  for (const k of Object.keys(sectionData || {})) {
    if (k.startsWith('__')) continue;
    legacy[k] = sectionData[k];
  }
  return [legacy];
}

function findGrooveKey(sections) {
  for (const [key, section] of Object.entries(sections || {})) {
    if (section && section.section_type === 'groove_specs') return key;
  }
  return null;
}

function entryItemIds(section) {
  return (section?.items || [])
    .filter(it => it.entry === true || (it.entry === undefined && /wire protrusion/i.test(it.measurement || '')))
    .map(it => it.id);
}

function fireRingHasValues(items, grooveKey, section) {
  const ids = entryItemIds(section);
  for (const item of items) {
    const data = item && item[grooveKey];
    if (!data || !Array.isArray(data.measurements)) continue;
    for (const m of data.measurements) {
      if (!ids.includes(m.id)) continue;
      if (Array.isArray(m.cylinders) && m.cylinders.some(c => String(c == null ? '' : c).trim() !== '')) return true;
    }
  }
  return false;
}

// GET /api/dashboard/fire-ring-eligible — complete cylinder-head inspections
// with an empty Fire Ring section, awaiting Fire Ring Protrusion measurements.
router.get('/fire-ring-eligible', (req, res, next) => {
  try {
    const rows = db.all(
      `SELECT i.id, i.template_id, i.form_no, i.part_number, i.po_number, i.lot_serial_no,
              i.inspector_name, i.component_type, i.completed_at, i.section_data,
              t.sections AS template_sections
       FROM inspections i
       JOIN inspection_templates t ON t.id = i.template_id
       WHERE i.status = 'complete' AND i.component_type = 'cylinder_head'
       ORDER BY i.completed_at DESC`,
      []
    );

    const inspections = [];
    for (const row of rows) {
      const sd = parseJSON(row.section_data, {});
      const templateSections = parseJSON(row.template_sections, {});
      const sections = effectiveSections(templateSections, sd);
      const grooveKey = findGrooveKey(sections);
      if (!grooveKey) continue;
      if (fireRingHasValues(sectionItems(sd), grooveKey, sections[grooveKey])) continue;
      inspections.push({
        id: row.id,
        template_id: row.template_id,
        form_no: row.form_no,
        part_number: row.part_number,
        po_number: row.po_number,
        lot_serial_no: row.lot_serial_no,
        inspector_name: row.inspector_name,
        component_type: row.component_type,
        completed_at: row.completed_at,
      });
    }

    res.json({ inspections });
  } catch (err) { next(err); }
});

module.exports = router;
