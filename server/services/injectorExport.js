'use strict';
/**
 * Excel and PDF export of a selected set of injector test records.
 *
 * The Excel form of the Custom Report. Choosing PDF gives the printed report
 * (services/pdf.js); choosing Excel gives this workbook, which carries the same
 * report plus the flat data behind it:
 *
 *   Comparison  the report itself — test steps down, injectors across, in the
 *               order the user arranged them. Identical to what the preview
 *               shows and the PDF prints, because it is built from the same
 *               model (injectorReports.buildReportPreview).
 *   Injectors   one row per injector: its result and the steps it failed
 *   Test Steps  one row per injector and measurement point, for pivoting
 *   Summary     the totals for the injectors in the file
 *
 *   buildExportModel()      pure data model (no exceljs)
 *   buildInjectorWorkbook() → .xlsx Buffer
 *
 * The page's filters decide WHICH injectors reach this module and nothing else.
 * They never appear in, or alter, what is written out: two workbooks of the
 * same injectors are identical whether they were found by a part-number filter,
 * by a failed-test-step filter, or by ticking the rows by hand.
 */

const ExcelJS = require('exceljs');

const {
  isFlushStep,
  stepLabel,
  stepResultValue,
  stepErrorInfo,
} = require('./injectorSteps');
const {
  PASS,
  FAIL,
  DNF,
  measurementOutcome,
  injectorOutcome,
} = require('./injectorResult');
const { measurementPoints } = require('./injectorFilters');
const { numericPartNumbers } = require('./pdf');
// The report grid comes from the same builder the on-screen preview uses, so
// the Comparison sheet cannot drift from the preview or the printed report.
const { buildReportPreview } = require('./injectorReports');

// Displayed name for each overall result.
const RESULT_LABELS = {
  [PASS]: 'PASS',
  [FAIL]: 'FAIL',
  [DNF]: 'DNF',
  unknown: 'No result',
};

// Columns of the summary sheet / PDF table. `width` is the Excel column width;
// `pdfWidth` is a relative weight used to share out the PDF table width (0 =
// not shown in the PDF, which is narrower than a spreadsheet). `pdfHeader`
// shortens a header that would not fit on one line in the printed table —
// the spreadsheet keeps the full name, where column width is the reader's.
const SUMMARY_COLUMNS = [
  { key: 'index', header: '#', width: 6, pdfWidth: 4, align: 'right' },
  { key: 'partNumber', header: 'Part Number', width: 18, pdfWidth: 15 },
  { key: 'serialNumber', header: 'Serial Number', width: 18, pdfWidth: 14 },
  { key: 'result', header: 'Result', width: 12, pdfWidth: 8, align: 'center', colored: true },
  { key: 'stepsPassed', header: 'Steps Passed', pdfHeader: 'Passed', width: 13, pdfWidth: 7, align: 'right' },
  { key: 'stepsFailed', header: 'Steps Failed', pdfHeader: 'Failed', width: 13, pdfWidth: 7, align: 'right' },
  { key: 'stepsTotal', header: 'Steps Total', pdfHeader: 'Total', width: 12, pdfWidth: 7, align: 'right' },
  { key: 'failedSteps', header: 'Failed Test Steps', width: 40, pdfWidth: 28 },
  { key: 'testDate', header: 'Test Date', width: 12, pdfWidth: 10 },
  { key: 'testTime', header: 'Test Time', width: 10, pdfWidth: 0 },
  { key: 'brand', header: 'Brand', width: 16, pdfWidth: 0 },
  { key: 'injectorType', header: 'Injector Type', width: 16, pdfWidth: 0 },
  { key: 'machineName', header: 'Test Bench', width: 18, pdfWidth: 0 },
  { key: 'machineSn', header: 'Bench Serial', width: 15, pdfWidth: 0 },
  { key: 'reportExtId', header: 'Bench Report ID', width: 26, pdfWidth: 0 },
  { key: 'slotPosition', header: 'Slot', width: 7, pdfWidth: 0, align: 'right' },
];

// Columns of the per-step detail sheet.
const STEP_COLUMNS = [
  { key: 'partNumber', header: 'Part Number', width: 18 },
  { key: 'serialNumber', header: 'Serial Number', width: 18 },
  { key: 'testDate', header: 'Test Date', width: 12 },
  { key: 'stepCode', header: 'Step Code', width: 12 },
  { key: 'stepName', header: 'Test Step', width: 26 },
  { key: 'specification', header: 'Specification', width: 20 },
  { key: 'unit', header: 'Unit', width: 12 },
  { key: 'measured', header: 'Measured', width: 18 },
  { key: 'outcome', header: 'Result', width: 10, colored: true },
  { key: 'note', header: 'Bench Note', width: 30 },
];

/** Trailing part of an ISO timestamp: "2026-06-30T13:40:56Z" → "13:40". */
function timeOf(value) {
  const m = /\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/.exec(String(value == null ? '' : value));
  return m ? m[1] : '';
}

/** Date part of a test timestamp ("2026-06-30"), or ''. */
function dateOf(value) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value == null ? '' : value).trim());
  if (m) return m[1];
  const parsed = Date.parse(String(value == null ? '' : value));
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

/** Distinct non-empty values, in first-seen order. */
function distinct(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const s = value == null ? '' : String(value).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** "220 - 240" from a tank's green band, else its own spec text. */
function specificationOf(tank) {
  if (!tank) return '';
  const min = Number(tank.min_green);
  const max = Number(tank.max_green);
  if (Number.isFinite(min) && Number.isFinite(max)) {
    const bound = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
    return `${bound(min)} - ${bound(max)}`;
  }
  return String(tank.spec || '').trim();
}

/** Labels of the measurement points this injector failed. */
function failedStepLabels(injector) {
  return measurementPoints(injector).filter((p) => p.outcome === FAIL).map((p) => p.label);
}

/**
 * One flat row per injector — the summary sheet and the PDF table both read
 * from this, so they can never drift apart.
 */
function summaryRow(injector, index) {
  const outcome = injectorOutcome(injector);
  const failed = failedStepLabels(injector);
  return {
    index: index + 1,
    id: injector.id,
    partNumber: injector.part_number || '',
    serialNumber: injector.serial_number || '',
    result: RESULT_LABELS[outcome] || RESULT_LABELS.unknown,
    outcome,
    stepsPassed: Number(injector.steps_passed || 0),
    stepsFailed: Number(injector.steps_failed || 0),
    stepsTotal: Number(injector.steps_total || 0),
    failedSteps: failed.join(', '),
    testDate: dateOf(injector.test_datetime),
    testTime: timeOf(injector.test_datetime),
    brand: injector.brand || '',
    injectorType: injector.injector_type || '',
    machineName: injector.machine_name || '',
    machineSn: injector.machine_sn || '',
    reportExtId: injector.report_ext_id || '',
    slotPosition: injector.slot_position == null ? '' : Number(injector.slot_position),
  };
}

/**
 * One row per injector × measurement. Every tank of every customer-facing step
 * gets its own row, so Peak Torque contributes both its Delivery and its Return
 * reading — the same split the reports and the step filter use.
 */
function stepRowsFor(injector) {
  const rows = [];
  const steps = (Array.isArray(injector.tests) ? injector.tests : []).filter((t) => !isFlushStep(t));
  for (const step of steps) {
    const err = stepErrorInfo(step);
    const tanks = [
      { role: 'primary', tank: step.primary },
      { role: 'secondary', tank: step.secondary },
    ].filter((t) => t.tank);
    if (!tanks.length) continue;
    for (const { role, tank } of tanks) {
      rows.push({
        injectorId: injector.id,
        partNumber: injector.part_number || '',
        serialNumber: injector.serial_number || '',
        testDate: dateOf(injector.test_datetime),
        stepCode: step.code || '',
        stepName: stepLabel(step, role, tank.tank_name),
        specification: specificationOf(tank),
        unit: tank.unit || '',
        measured: stepResultValue(step, tank),
        outcome: measurementOutcome(step, tank),
        note: err.errored ? err.description : '',
      });
    }
  }
  return rows;
}

/** Headline counts for the exported selection. */
function summarise(injectors = []) {
  const outcomes = injectors.map(injectorOutcome);
  const dates = distinct(injectors.map((i) => dateOf(i.test_datetime))).sort();
  return {
    total: injectors.length,
    passed: outcomes.filter((o) => o === PASS).length,
    failed: outcomes.filter((o) => o === FAIL).length,
    dnf: outcomes.filter((o) => o === DNF).length,
    untested: outcomes.filter((o) => o !== PASS && o !== FAIL && o !== DNF).length,
    partNumbers: distinct(injectors.map((i) => i.part_number)),
    serialNumbers: distinct(injectors.map((i) => i.serial_number)),
    brands: distinct(injectors.map((i) => i.brand)),
    dateFrom: dates[0] || '',
    dateTo: dates.length ? dates[dates.length - 1] : '',
  };
}

/**
 * Everything both exporters need, in one pure call.
 *
 * The model is built from the injectors alone. How they were chosen — a
 * filter, or hand-picked rows — is deliberately not an input, so it cannot
 * show up in or change the exported file.
 *
 * @param injectors  hydrated injector rows (with their `tests` array)
 * @param opts.title     document title
 * @param opts.vendorName  optional vendor for the PDF banner
 */
function buildExportModel(injectors = [], opts = {}) {
  const list = Array.isArray(injectors) ? injectors : [];

  return {
    title: String(opts.title || 'Injector Test Results').trim(),
    vendorName: String(opts.vendorName || '').trim(),
    generatedAt: opts.generatedAt || new Date().toISOString(),
    summary: summarise(list),
    comparison: buildReportPreview(list),
    columns: SUMMARY_COLUMNS,
    rows: list.map(summaryRow),
    stepColumns: STEP_COLUMNS,
    stepRows: list.flatMap(stepRowsFor),
  };
}

// ── Excel ────────────────────────────────────────────────────────────────────

const XLSX_HEADER_FILL = 'FF1D2B4F';   // pdi navy
const XLSX_PASS = 'FF1E7A45';
const XLSX_FAIL = 'FFB03225';
const XLSX_DNF = 'FFB07520';

/** Font colour for a result cell, or null to leave it alone. */
function resultFontColor(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'pass') return XLSX_PASS;
  if (v === 'fail') return XLSX_FAIL;
  if (v === 'dnf') return XLSX_DNF;
  return null;
}

/** Style a worksheet's first row as a navy header and freeze it. */
function styleHeader(sheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_HEADER_FILL } };
  header.alignment = { vertical: 'middle' };
  header.height = 20;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * The report grid: test steps down the page, one column per injector in the
 * order the user arranged them, exactly as the preview and the printed report
 * lay it out.
 *
 * A reading that is a plain number is written as a NUMBER, not text, so the
 * sheet can be charted and compared — the one thing a spreadsheet gives the
 * quality department that the PDF cannot.
 */
function addComparisonSheet(workbook, model) {
  const grid = model.comparison || { injectors: [], rows: [] };
  const sheet = workbook.addWorksheet('Comparison');

  sheet.columns = [
    { header: 'Test Step', key: 'step', width: 26 },
    { header: 'Specification', key: 'spec', width: 18 },
    { header: 'Unit', key: 'unit', width: 12 },
    ...grid.injectors.map((injector, index) => ({
      // Two lines per column head, the same identity the PDF prints.
      header: `${injector.partNumber || '—'}\nSN ${injector.serialNumber || '—'}`,
      key: `inj${index}`,
      width: 16,
    })),
  ];

  for (const row of grid.rows) {
    const added = sheet.addRow({
      step: row.label,
      spec: row.specification || '—',
      unit: row.unit || '',
      ...Object.fromEntries(row.values.map((cell, index) => {
        const text = (cell.lines || []).filter(Boolean).join(' / ') || '—';
        const numeric = Number(text);
        // Only a lone, plain reading becomes a number; "No Test / Excess
        // Return" and other multi-line cells stay as the text they read as.
        const value = text !== '—' && text !== '' && Number.isFinite(numeric) ? numeric : text;
        return [`inj${index}`, value];
      })),
    });
    added.getCell('step').font = { bold: true };
    row.values.forEach((cell, index) => {
      const argb = resultFontColor(cell.status);
      if (argb) added.getCell(`inj${index}`).font = { color: { argb }, bold: cell.status === FAIL };
      added.getCell(`inj${index}`).alignment = { horizontal: 'right' };
    });
  }

  // Closing roll-up row, as on the report.
  const result = sheet.addRow({
    step: 'Overall Result',
    spec: '',
    unit: '',
    ...Object.fromEntries(grid.injectors.map((injector, index) => [`inj${index}`, injector.result || '—'])),
  });
  result.font = { bold: true };
  grid.injectors.forEach((injector, index) => {
    const argb = resultFontColor(injector.result);
    if (argb) result.getCell(`inj${index}`).font = { bold: true, color: { argb } };
    result.getCell(`inj${index}`).alignment = { horizontal: 'right' };
  });

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_HEADER_FILL } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 30;
  // Keep the step names and the header in view while scrolling a wide batch.
  sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];
  return sheet;
}

/**
 * The Custom Report as an Excel workbook: the report grid first, then the flat
 * data behind it (see the module header for what each sheet holds).
 */
async function buildInjectorWorkbook(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PDI Quality Management System';
  workbook.created = new Date(model.generatedAt);

  addComparisonSheet(workbook, model);

  // ── Injectors ──────────────────────────────────────────────────────────
  const sheet = workbook.addWorksheet('Injectors');
  sheet.columns = model.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  for (const row of model.rows) {
    const added = sheet.addRow(row);
    for (const column of model.columns) {
      const cell = added.getCell(column.key);
      if (column.align) cell.alignment = { horizontal: column.align };
      if (!column.colored) continue;
      const argb = resultFontColor(row.outcome);
      if (argb) cell.font = { bold: true, color: { argb } };
    }
  }
  styleHeader(sheet);
  // Column headers double as the filter row so the sheet is usable as-is.
  if (model.rows.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: model.rows.length + 1, column: model.columns.length },
    };
  }

  // ── Test Steps ─────────────────────────────────────────────────────────
  const steps = workbook.addWorksheet('Test Steps');
  steps.columns = model.stepColumns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  for (const row of model.stepRows) {
    const added = steps.addRow({ ...row, outcome: String(row.outcome || '').toUpperCase() });
    const argb = resultFontColor(row.outcome);
    if (argb) added.getCell('outcome').font = { bold: true, color: { argb } };
  }
  styleHeader(steps);
  if (model.stepRows.length) {
    steps.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: model.stepRows.length + 1, column: model.stepColumns.length },
    };
  }

  // ── Summary ────────────────────────────────────────────────────────────
  // Describes the injectors in the file — never how they were selected.
  const meta = workbook.addWorksheet('Summary');
  meta.columns = [
    { header: 'Field', key: 'label', width: 24 },
    { header: 'Value', key: 'value', width: 70 },
  ];
  meta.addRow({ label: 'Report', value: model.title });
  meta.addRow({ label: 'Generated', value: String(model.generatedAt).slice(0, 19).replace('T', ' ') });
  meta.addRow({ label: 'Injectors Exported', value: model.summary.total });
  meta.addRow({ label: 'Passed', value: model.summary.passed });
  meta.addRow({ label: 'Failed', value: model.summary.failed });
  meta.addRow({ label: 'DNF', value: model.summary.dnf });
  if (model.summary.untested) meta.addRow({ label: 'No Result', value: model.summary.untested });
  meta.addRow({ label: 'Part Numbers', value: model.summary.partNumbers.join(', ') || '—' });
  meta.addRow({
    label: 'Test Dates',
    value: model.summary.dateFrom
      ? (model.summary.dateFrom === model.summary.dateTo
        ? model.summary.dateFrom
        : `${model.summary.dateFrom} to ${model.summary.dateTo}`)
      : '—',
  });
  styleHeader(meta);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Filesystem-safe filename stem for the workbook. Mirrors the Custom Report
 * PDF's name so the two formats of one report sit side by side in a folder.
 */
function exportFilename(model, extension = 'xlsx') {
  const part = numericPartNumbers(model.summary.partNumbers)[0] || 'Injectors';
  const safe = String(part).replace(/[^a-zA-Z0-9._-]/g, '_') || 'Injectors';
  return `CustomReport_${safe}_${model.summary.total}.${extension}`;
}

module.exports = {
  SUMMARY_COLUMNS,
  STEP_COLUMNS,
  RESULT_LABELS,
  buildExportModel,
  buildInjectorWorkbook,
  exportFilename,
  summaryRow,
  stepRowsFor,
  specificationOf,
  failedStepLabels,
};
