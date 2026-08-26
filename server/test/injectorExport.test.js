'use strict';
/**
 * The Custom Report as an Excel workbook: the report grid the preview shows and
 * the PDF prints, plus the flat data behind it.
 */

const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');

const { db, resetInjectorData } = require('./helpers/testEnv');
const { benchBatch } = require('./helpers/benchData');
const carbonzapp = require('../services/carbonzapp');
const { loadSelectedInjectors } = require('../services/injectorReports');
const {
  SUMMARY_COLUMNS,
  buildExportModel,
  buildInjectorWorkbook,
  exportFilename,
  specificationOf,
  failedStepLabels,
} = require('../services/injectorExport');

/**
 * Four injectors: SN001 passes, SN002 fails Peak Torque - Return, SN003 passes,
 * SN004 is interrupted by a bench error at Peak Torque (a DNF, not a failure).
 */
function seed() {
  resetInjectorData();
  carbonzapp.upsertReports(benchBatch(4, {
    job: 'Production',
    prefix: 'SN',
    customise: (i) => {
      if (i === 1) return { flow: { IVM06_RETURN: 120 } };
      if (i === 3) return { errorOn: 'IVM06', flow: { IVM06: 0, IVM06_RETURN: 0 } };
      return {};
    },
  }));
  const ids = db.all('SELECT id FROM injector_test_reports ORDER BY slot_position', []).map((r) => r.id);
  return loadSelectedInjectors(ids);
}

const rowFor = (model, serial) => model.rows.find((r) => r.serialNumber === serial);

// ── The shared model ────────────────────────────────────────────────────────
test('the export model carries one row per injector with its scored result', () => {
  const model = buildExportModel(seed());

  assert.deepStrictEqual(model.rows.map((r) => r.serialNumber), ['SN001', 'SN002', 'SN003', 'SN004']);
  assert.deepStrictEqual(model.rows.map((r) => r.index), [1, 2, 3, 4], 'rows are numbered in export order');
  assert.deepStrictEqual(model.rows.map((r) => r.result), ['PASS', 'FAIL', 'PASS', 'DNF']);
  assert.strictEqual(rowFor(model, 'SN002').failedSteps, 'Peak Torque - Return');
  assert.strictEqual(rowFor(model, 'SN004').failedSteps, '', 'an interrupted run failed no test step');
  assert.strictEqual(rowFor(model, 'SN001').partNumber, '6513589PX');
  assert.strictEqual(rowFor(model, 'SN001').testDate, '2026-06-30');
});

test('the model summarises the batch the exports print at the top', () => {
  const model = buildExportModel(seed());
  assert.deepStrictEqual(
    { ...model.summary, serialNumbers: undefined, brands: undefined },
    {
      total: 4, passed: 2, failed: 1, dnf: 1, untested: 0,
      partNumbers: ['6513589PX'],
      dateFrom: '2026-06-30', dateTo: '2026-06-30',
      serialNumbers: undefined, brands: undefined,
    }
  );
});

test('every tank of every customer-facing step becomes one detail row', () => {
  const model = buildExportModel(seed());
  const forSN002 = model.stepRows.filter((r) => r.serialNumber === 'SN002');

  assert.deepStrictEqual(forSN002.map((r) => r.stepName),
    ['Peak HP', 'Peak Torque - Delivery', 'Peak Torque - Return']);
  assert.deepStrictEqual(forSN002.map((r) => r.outcome), ['pass', 'pass', 'fail']);
  assert.strictEqual(forSN002[2].measured, '120');
  assert.strictEqual(forSN002[2].specification, '0.0 - 80.0');
  assert.strictEqual(forSN002[0].unit, 'mm3/STRK');
  assert.ok(model.stepRows.every((r) => r.stepCode !== 'FLW'), 'the internal flush step is never exported');
});

test('a bench error is reported as a note, not as a step name', () => {
  const model = buildExportModel(seed());
  const interrupted = model.stepRows.filter((r) => r.serialNumber === 'SN004');
  const peakTorque = interrupted.find((r) => r.stepName === 'Peak Torque - Delivery');

  assert.ok(peakTorque, 'the step keeps its mapped name');
  assert.strictEqual(peakTorque.note, 'Out of Range');
  assert.strictEqual(peakTorque.outcome, 'dnf');
  assert.ok(interrupted.every((r) => !/error/i.test(r.stepName)), 'no step name carries bench error text');
});

test('how the injectors were selected leaves no trace on the model', () => {
  const model = buildExportModel(seed());
  assert.ok(!('filters' in model), 'no filter description is carried');
  assert.ok(!('criteria' in model), 'no filter criteria are carried');
  assert.ok(model.rows.every((row) => !('matchedSteps' in row)), 'no row records why it was picked');
  assert.ok(
    !SUMMARY_COLUMNS.some((column) => /filter/i.test(column.header)),
    'no exported column is about the filter'
  );
});

test('a green band with no numeric range falls back to the bench spec text', () => {
  assert.strictEqual(specificationOf({ min_green: 0, max_green: 80 }), '0.0 - 80.0');
  assert.strictEqual(specificationOf({ spec: '8.5 +/- 4.5 mm3/STRK' }), '8.5 +/- 4.5 mm3/STRK');
  assert.strictEqual(specificationOf(null), '');
});

test('failed step labels list every point an injector actually failed', () => {
  const injectors = seed();
  const bySerial = Object.fromEntries(injectors.map((i) => [i.serial_number, i]));
  assert.deepStrictEqual(failedStepLabels(bySerial.SN002), ['Peak Torque - Return']);
  assert.deepStrictEqual(failedStepLabels(bySerial.SN001), []);
});

// ── Excel ───────────────────────────────────────────────────────────────────
test('the workbook holds the injectors, their steps and a summary', async () => {
  const model = buildExportModel(seed());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildInjectorWorkbook(model));

  assert.deepStrictEqual(workbook.worksheets.map((w) => w.name),
    ['Comparison', 'Injectors', 'Test Steps', 'Summary']);

  const sheet = workbook.getWorksheet('Injectors');
  assert.strictEqual(sheet.rowCount, 5, 'a header row plus four injectors');
  // Reading a saved workbook back gives columns by position, not by key.
  const headers = sheet.getRow(1).values.slice(1);
  assert.deepStrictEqual(headers.slice(0, 4), ['#', 'Part Number', 'Serial Number', 'Result']);
  const cell = (rowNumber, header) => sheet.getRow(rowNumber).values[headers.indexOf(header) + 1];
  assert.strictEqual(cell(3, 'Serial Number'), 'SN002');
  assert.strictEqual(cell(3, 'Result'), 'FAIL');
  assert.strictEqual(cell(3, 'Failed Test Steps'), 'Peak Torque - Return');
  assert.ok(sheet.autoFilter, 'the sheet is filterable as delivered');
  assert.strictEqual(sheet.views[0].state, 'frozen', 'the header row stays visible');
  assert.strictEqual(sheet.views[0].ySplit, 1);

  const steps = workbook.getWorksheet('Test Steps');
  assert.strictEqual(steps.rowCount, 1 + 4 * 3, 'three measurement points per injector');
  const stepHeaders = steps.getRow(1).values.slice(1);
  assert.strictEqual(steps.getRow(2).values[stepHeaders.indexOf('Test Step') + 1], 'Peak HP');

  const summary = workbook.getWorksheet('Summary');
  const text = summary.getRows(1, summary.rowCount).map((r) => r.values.join(' ')).join('\n');
  assert.match(text, /Injectors Exported\s+4/);
  assert.match(text, /Part Numbers\s+6513589PX/);
});

// ── The report grid ─────────────────────────────────────────────────────────
/** The Comparison sheet as a plain array-of-arrays, for readable assertions. */
async function comparisonGrid(injectors) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildInjectorWorkbook(buildExportModel(injectors)));
  const sheet = workbook.getWorksheet('Comparison');
  return sheet.getRows(1, sheet.rowCount).map((row) => row.values.slice(1));
}

test('the Comparison sheet is the report: steps down, injectors across', async () => {
  const grid = await comparisonGrid(seed());

  assert.deepStrictEqual(grid[0].slice(0, 3), ['Test Step', 'Specification', 'Unit']);
  assert.deepStrictEqual(grid[0].slice(3), [
    '6513589PX\nSN SN001', '6513589PX\nSN SN002', '6513589PX\nSN SN003', '6513589PX\nSN SN004',
  ], 'one column per injector, headed by part number and serial');

  assert.deepStrictEqual(grid.slice(1, -1).map((row) => row[0]),
    ['Peak HP', 'Peak Torque - Delivery', 'Peak Torque - Return']);
  assert.deepStrictEqual(grid[1].slice(0, 3), ['Peak HP', '220.0 - 240.0', 'mm3/STRK']);

  const overall = grid[grid.length - 1];
  assert.strictEqual(overall[0], 'Overall Result');
  assert.deepStrictEqual(overall.slice(3), ['PASS', 'FAIL', 'PASS', 'DNF']);
});

test('a plain reading is written as a number so the sheet can be charted', async () => {
  const grid = await comparisonGrid(seed());
  const peakHp = grid[1];

  assert.strictEqual(peakHp[3], 230, 'a lone numeric reading is a number, not text');
  assert.strictEqual(typeof peakHp[3], 'number');

  // The interrupted injector's Peak Torque reads as text, not a coerced zero.
  const peakTorque = grid[2];
  assert.strictEqual(typeof peakTorque[6], 'string');
  assert.match(String(peakTorque[6]), /No Test|Error/i);
});

test('the Comparison sheet columns follow the order the injectors were given', async () => {
  const injectors = seed();
  const reordered = [injectors[2], injectors[0], injectors[3], injectors[1]];
  const grid = await comparisonGrid(reordered);

  assert.deepStrictEqual(
    grid[0].slice(3).map((h) => String(h).split('SN ')[1]),
    ['SN003', 'SN001', 'SN004', 'SN002'],
    'the arranged order is the column order'
  );
  assert.deepStrictEqual(grid[grid.length - 1].slice(3), ['PASS', 'PASS', 'DNF', 'FAIL']);
});

test('the workbook grid, the preview and the printed report show the same rows', async () => {
  const injectors = seed();
  const model = buildExportModel(injectors);
  const grid = await comparisonGrid(injectors);

  // The Comparison sheet is built from the preview model, so the step rows and
  // the per-injector results must line up exactly.
  assert.deepStrictEqual(
    grid.slice(1, -1).map((row) => row[0]),
    model.comparison.rows.map((row) => row.label)
  );
  assert.deepStrictEqual(
    grid[grid.length - 1].slice(3),
    model.comparison.injectors.map((injector) => injector.result)
  );
});

test('no sheet mentions the filters that found the injectors', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildInjectorWorkbook(buildExportModel(seed())));
  for (const sheet of workbook.worksheets) {
    const text = sheet.getRows(1, sheet.rowCount).map((r) => r.values.join(' ')).join('\n');
    assert.ok(!/filter/i.test(text), `the ${sheet.name} sheet mentions a filter`);
  }
});

// ── Filenames ───────────────────────────────────────────────────────────────
test('the workbook filename matches the Custom Report PDF it accompanies', () => {
  const model = buildExportModel(seed());
  assert.strictEqual(exportFilename(model), 'CustomReport_6513589_4.xlsx');
  assert.strictEqual(exportFilename(buildExportModel([])), 'CustomReport_Injectors_0.xlsx');
});
