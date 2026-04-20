'use strict';
const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireAdminOrQC(req, res, next) {
  if (!['admin', 'qc_manager'].includes(req.user?.role)) {
    return next(new AppError('Unauthorized', 403));
  }
  next();
}

function buildQueryFilters(filters) {
  let sql = 'WHERE 1=1';
  const params = [];

  if (filters.date_from) {
    sql += ' AND created_at >= ?';
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    sql += ' AND created_at <= ?';
    params.push(filters.date_to);
  }
  if (filters.component_type) {
    sql += ' AND component_type = ?';
    params.push(filters.component_type);
  }
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.disposition) {
    sql += ' AND disposition = ?';
    params.push(filters.disposition);
  }
  if (filters.assigned_to) {
    sql += ' AND assigned_to = ?';
    params.push(filters.assigned_to);
  }
  if (filters.template_id) {
    sql += ' AND template_id = ?';
    params.push(filters.template_id);
  }

  return { sql, params };
}

// POST /api/reports/query
router.post('/query', (req, res, next) => {
  try {
    const { date_from, date_to, component_type, status, disposition, assigned_to, template_id, group_by } = req.body;

    const filters = { date_from, date_to, component_type, status, disposition, assigned_to, template_id };
    const { sql: filterSql, params: filterParams } = buildQueryFilters(filters);

    // Get totals
    const totalsSql = `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
      SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
      SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
      SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
     FROM inspections ${filterSql}`;

    const totals = db.get(totalsSql, filterParams);

    // Build group_by query
    let groupBySql, groupByLabel;
    const groupByParams = [...filterParams];

    if (group_by === 'component_type') {
      groupBySql = `SELECT
        component_type as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY component_type
       ORDER BY label ASC`;
      groupByLabel = 'component_type';
    } else if (group_by === 'disposition') {
      groupBySql = `SELECT
        COALESCE(disposition, 'Pending') as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY disposition
       ORDER BY label ASC`;
      groupByLabel = 'disposition';
    } else if (group_by === 'status') {
      groupBySql = `SELECT
        status as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY status
       ORDER BY label ASC`;
      groupByLabel = 'status';
    } else if (group_by === 'month') {
      groupBySql = `SELECT
        strftime('%Y-%m', created_at) as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY strftime('%Y-%m', created_at)
       ORDER BY label DESC`;
      groupByLabel = 'month';
    } else if (group_by === 'week') {
      groupBySql = `SELECT
        strftime('%Y-W%W', created_at) as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY strftime('%Y-W%W', created_at)
       ORDER BY label DESC`;
      groupByLabel = 'week';
    } else if (group_by === 'assigned_to') {
      groupBySql = `SELECT
        COALESCE(u.name, 'Unassigned') as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections
       LEFT JOIN users u ON assigned_to = u.id
       ${filterSql}
       GROUP BY assigned_to
       ORDER BY label ASC`;
      groupByLabel = 'assigned_to';
    } else {
      // No group_by, return all as one row
      groupBySql = `SELECT
        'All' as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}`;
      groupByLabel = 'all';
    }

    const rows = db.all(groupBySql, groupByParams);

    res.json({
      rows,
      totals,
      filters_applied: filters,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/export/excel
router.post('/export/excel', (req, res, next) => {
  try {
    const { date_from, date_to, component_type, status, disposition, assigned_to, template_id, group_by } = req.body;

    const filters = { date_from, date_to, component_type, status, disposition, assigned_to, template_id };
    const { sql: filterSql, params: filterParams } = buildQueryFilters(filters);

    // Get totals
    const totalsSql = `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
      SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
      SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
      SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
     FROM inspections ${filterSql}`;

    const totals = db.get(totalsSql, filterParams);

    // Build group_by query for summary
    let groupBySql;
    const groupByParams = [...filterParams];

    if (group_by === 'component_type') {
      groupBySql = `SELECT
        component_type as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY component_type
       ORDER BY label ASC`;
    } else if (group_by === 'disposition') {
      groupBySql = `SELECT
        COALESCE(disposition, 'Pending') as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY disposition
       ORDER BY label ASC`;
    } else if (group_by === 'status') {
      groupBySql = `SELECT
        status as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY status
       ORDER BY label ASC`;
    } else if (group_by === 'month') {
      groupBySql = `SELECT
        strftime('%Y-%m', created_at) as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY strftime('%Y-%m', created_at)
       ORDER BY label DESC`;
    } else if (group_by === 'week') {
      groupBySql = `SELECT
        strftime('%Y-W%W', created_at) as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY strftime('%Y-W%W', created_at)
       ORDER BY label DESC`;
    } else if (group_by === 'assigned_to') {
      groupBySql = `SELECT
        COALESCE(u.name, 'Unassigned') as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections
       LEFT JOIN users u ON assigned_to = u.id
       ${filterSql}
       GROUP BY assigned_to
       ORDER BY label ASC`;
    } else {
      groupBySql = `SELECT
        'All' as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}`;
    }

    const rows = db.all(groupBySql, groupByParams);

    // Get detail rows
    const detailSql = `SELECT
      i.id, i.form_no, i.component_type, i.part_number, i.supplier, i.po_number,
      i.inspector_name, i.disposition, i.status, u.name as assigned_to_name,
      i.due_date, i.started_at, i.completed_at, i.created_at
     FROM inspections i
     LEFT JOIN users u ON i.assigned_to = u.id
     ${filterSql}
     ORDER BY i.created_at DESC`;

    const details = db.all(detailSql, filterParams);

    // Create workbook
    const workbook = new ExcelJS.Workbook();

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Label', key: 'label', width: 20 },
      { header: 'Count', key: 'count', width: 12 },
      { header: 'Pass', key: 'pass', width: 12 },
      { header: 'Fail', key: 'fail', width: 12 },
      { header: 'Accepted', key: 'accepted', width: 12 },
    ];
    summarySheet.addRows(rows);

    // Detail sheet
    const detailSheet = workbook.addWorksheet('Detail');
    detailSheet.columns = [
      { header: 'ID', key: 'id', width: 36 },
      { header: 'Form No', key: 'form_no', width: 12 },
      { header: 'Component Type', key: 'component_type', width: 20 },
      { header: 'Part Number', key: 'part_number', width: 15 },
      { header: 'Supplier', key: 'supplier', width: 20 },
      { header: 'PO Number', key: 'po_number', width: 15 },
      { header: 'Inspector', key: 'inspector_name', width: 20 },
      { header: 'Disposition', key: 'disposition', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Assigned To', key: 'assigned_to_name', width: 20 },
      { header: 'Due Date', key: 'due_date', width: 15 },
      { header: 'Started At', key: 'started_at', width: 20 },
      { header: 'Completed At', key: 'completed_at', width: 20 },
      { header: 'Created At', key: 'created_at', width: 20 },
    ];
    detailSheet.addRows(details);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inspection-report.xlsx"');

    workbook.xlsx.write(res).then(() => {
      res.end();
    }).catch(err => next(err));
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/export/pdf
router.post('/export/pdf', (req, res, next) => {
  try {
    const { date_from, date_to, component_type, status, disposition, assigned_to, template_id, group_by } = req.body;

    const filters = { date_from, date_to, component_type, status, disposition, assigned_to, template_id };
    const { sql: filterSql, params: filterParams } = buildQueryFilters(filters);

    // Get totals
    const totalsSql = `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
      SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
      SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
      SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
     FROM inspections ${filterSql}`;

    const totals = db.get(totalsSql, filterParams);

    // Build group_by query
    let groupBySql;
    const groupByParams = [...filterParams];

    if (group_by === 'component_type') {
      groupBySql = `SELECT
        component_type as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY component_type
       ORDER BY label ASC`;
    } else if (group_by === 'disposition') {
      groupBySql = `SELECT
        COALESCE(disposition, 'Pending') as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY disposition
       ORDER BY label ASC`;
    } else if (group_by === 'status') {
      groupBySql = `SELECT
        status as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY status
       ORDER BY label ASC`;
    } else if (group_by === 'month') {
      groupBySql = `SELECT
        strftime('%Y-%m', created_at) as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY strftime('%Y-%m', created_at)
       ORDER BY label DESC`;
    } else if (group_by === 'week') {
      groupBySql = `SELECT
        strftime('%Y-W%W', created_at) as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}
       GROUP BY strftime('%Y-W%W', created_at)
       ORDER BY label DESC`;
    } else if (group_by === 'assigned_to') {
      groupBySql = `SELECT
        COALESCE(u.name, 'Unassigned') as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections
       LEFT JOIN users u ON assigned_to = u.id
       ${filterSql}
       GROUP BY assigned_to
       ORDER BY label ASC`;
    } else {
      groupBySql = `SELECT
        'All' as label,
        COUNT(*) as count,
        SUM(CASE WHEN disposition = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN disposition = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN disposition = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted
       FROM inspections ${filterSql}`;
    }

    const rows = db.all(groupBySql, groupByParams);

    // Create PDF
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="inspection-report.pdf"');
    doc.pipe(res);

    // Header
    doc.fontSize(24).font('Helvetica-Bold').text('PDI Inspection Report', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(` `, { align: 'center' });

    // Date range
    const dateRange = [];
    if (date_from) dateRange.push(date_from);
    if (date_to) dateRange.push(date_to);
    if (dateRange.length > 0) {
      doc.fontSize(10).text(`Date Range: ${dateRange.join(' to ')}`, { align: 'center' });
    }
    doc.text(' ', { align: 'center' });

    // Summary table
    doc.fontSize(12).font('Helvetica-Bold').text('Summary by ' + (group_by || 'All'), { underline: true });
    doc.fontSize(10).font('Helvetica');

    const tableData = [];
    tableData.push(['Label', 'Count', 'Pass', 'Fail', 'Accepted']);
    for (const row of rows) {
      tableData.push([
        String(row.label),
        String(row.count || 0),
        String(row.pass || 0),
        String(row.fail || 0),
        String(row.accepted || 0),
      ]);
    }

    doc.fontSize(9);
    const colWidth = 100;
    let startY = doc.y;
    for (let i = 0; i < tableData.length; i++) {
      const row = tableData[i];
      for (let j = 0; j < row.length; j++) {
        doc.text(row[j], 50 + j * colWidth, startY, { width: colWidth - 5 });
      }
      startY += 20;
    }

    // Totals section
    doc.fontSize(12).font('Helvetica-Bold').text('Totals', { underline: true });
    doc.fontSize(10).font('Helvetica');
    doc.text(`Total Inspections: ${totals.total}`);
    doc.text(`Complete: ${totals.complete}, Draft: ${totals.draft}`);
    doc.text(`Pass: ${totals.pass}, Fail: ${totals.fail}, Accepted: ${totals.accepted}`);

    doc.end();
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/saved
router.get('/saved', (req, res, next) => {
  try {
    const sql = req.user.role === 'admin'
      ? 'SELECT id, name, created_by, config_json, created_at, updated_at FROM saved_reports ORDER BY updated_at DESC'
      : 'SELECT id, name, created_by, config_json, created_at, updated_at FROM saved_reports WHERE created_by = ? ORDER BY updated_at DESC';

    const params = req.user.role === 'admin' ? [] : [req.user.id];
    const reports = db.all(sql, params);

    for (const r of reports) {
      r.config_json = JSON.parse(r.config_json || '{}');
    }

    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/saved
router.post('/saved', (req, res, next) => {
  try {
    const { name, config_json } = req.body;
    if (!name) {
      return next(new AppError('name is required', 400, 'VALIDATION_ERROR'));
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    db.run(
      'INSERT INTO saved_reports (id, name, created_by, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, req.user.id, JSON.stringify(config_json || {}), now, now]
    );

    const report = db.get('SELECT id, name, created_by, config_json, created_at, updated_at FROM saved_reports WHERE id = ?', [id]);
    report.config_json = JSON.parse(report.config_json || '{}');
    res.status(201).json({ report });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/reports/saved/:id
router.patch('/saved/:id', (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return next(new AppError('Invalid report id', 400, 'VALIDATION_ERROR'));
    }

    const report = db.get('SELECT * FROM saved_reports WHERE id = ?', [req.params.id]);
    if (!report) {
      return next(new AppError('Report not found', 404, 'NOT_FOUND'));
    }

    if (req.user.role !== 'admin' && report.created_by !== req.user.id) {
      return next(new AppError('Not allowed to update this report', 403));
    }

    const updates = [];
    const values = [];
    const now = new Date().toISOString();

    if (req.body.name !== undefined) {
      updates.push('name = ?');
      values.push(req.body.name);
    }
    if (req.body.config_json !== undefined) {
      updates.push('config_json = ?');
      values.push(JSON.stringify(req.body.config_json));
    }

    if (updates.length === 0) {
      report.config_json = JSON.parse(report.config_json || '{}');
      return res.json({ report });
    }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(req.params.id);

    db.run(`UPDATE saved_reports SET ${updates.join(', ')} WHERE id = ?`, values);

    const updated = db.get('SELECT id, name, created_by, config_json, created_at, updated_at FROM saved_reports WHERE id = ?', [req.params.id]);
    updated.config_json = JSON.parse(updated.config_json || '{}');
    res.json({ report: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reports/saved/:id
router.delete('/saved/:id', (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return next(new AppError('Invalid report id', 400, 'VALIDATION_ERROR'));
    }

    const report = db.get('SELECT * FROM saved_reports WHERE id = ?', [req.params.id]);
    if (!report) {
      return next(new AppError('Report not found', 404, 'NOT_FOUND'));
    }

    if (req.user.role !== 'admin' && report.created_by !== req.user.id) {
      return next(new AppError('Not allowed to delete this report', 403));
    }

    db.run('DELETE FROM saved_reports WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
