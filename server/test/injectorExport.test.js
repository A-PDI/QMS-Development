'use strict';
/**
 * Excel and PDF export of a selected set of injector test records.
 *
 * The two formats are built from ONE model, so these tests assert the model
 * once and then check that each format actually carries it.
 */

const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');

const { db, extractPdfText, resetInjectorData } = require('./helpers/testEnv');
const { benchBatch } = require('./helpers/benchData');
const carbonzapp = require('../services/carbonzapp');
const { loadSelectedInjectors } = require('../services/injectorReports');
const {
  SUMMARY_COLUMNS,
  buildExportModel,
  buildInjectorWorkbook,
  buildInjectorListPdf,
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

  assert.deepStrictEqual(workbook.worksheets.map((w) => w.name), ['Injectors', 'Test Steps', 'Summary']);

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

test('no sheet mentions the filters that found the injectors', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildInjectorWorkbook(buildExportModel(seed())));
  for (const sheet of workbook.worksheets) {
    const text = sheet.getRows(1, sheet.rowCount).map((r) => r.values.join(' ')).join('\n');
    assert.ok(!/filter/i.test(text), `the ${sheet.name} sheet mentions a filter`);
  }
});

// ── PDF ─────────────────────────────────────────────────────────────────────
test('the PDF listing prints the totals and every injector, and no filter', async () => {
  const buffer = await buildInjectorListPdf(buildExportModel(seed()));
  assert.strictEqual(buffer.subarray(0, 4).toString(), '%PDF');

  const text = extractPdfText(buffer).join(' ');
  assert.match(text, /Injector Test Results/);
  assert.match(text, /INJECTORS EXPORTED 4/, 'the headline totals are printed');
  for (const serial of ['SN001', 'SN002', 'SN003', 'SN004']) {
    assert.ok(text.includes(serial), `${serial} is listed`);
  }
  assert.match(text, /Page 1 of 1/);
  assert.ok(!/filter/i.test(text), 'nothing on the page mentions a filter');
  assert.ok(!/SELECTION/.test(text), 'no applied-selection block is printed');
});

test('handing the exporter filter criteria cannot change what it writes', async () => {
  // A guard against filter provenance creeping back in: even when a caller
  // passes the criteria that found these records, the file is unchanged.
  const at = '2026-06-30T12:00:00.000Z';
  const injectors = seed();
  const plain = buildExportModel(injectors, { generatedAt: at });
  const withCriteria = buildExportModel(injectors, {
    generatedAt: at,
    criteria: { part_number: '6513589PX', steps: 'IVM06-R', step_status: 'fail' },
  });

  assert.deepStrictEqual(withCriteria, plain, 'the model ignores criteria entirely');

  const pdfOf = async (model) => extractPdfText(await buildInjectorListPdf(model)).join(' ');
  assert.strictEqual(await pdfOf(withCriteria), await pdfOf(plain));

  const sheetsOf = async (model) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildInjectorWorkbook(model));
    return wb.worksheets
      .map((w) => `${w.name}\n${w.getRows(1, w.rowCount).map((r) => r.values.join('|')).join('\n')}`)
      .join('\n--\n');
  };
  assert.strictEqual(await sheetsOf(withCriteria), await sheetsOf(plain));
});

test('a long selection paginates with its header and page numbers intact', async () => {
  resetInjectorData();
  carbonzapp.upsertReports(benchBatch(60, { job: 'Production', prefix: 'LG', idPrefix: 'rep-LG' }));
  const ids = db.all('SELECT id FROM injector_test_reports', []).map((r) => r.id);
  const model = buildExportModel(loadSelectedInjectors(ids));

  const pages = extractPdfText(await buildInjectorListPdf(model)).join(' ');
  assert.match(pages, /Page 1 of [2-9]/, 'the listing runs past one page');
  assert.match(pages, /Continued · injector/, 'continuation pages say where they resume');
  assert.strictEqual((pages.match(/SERIAL NUMBER/g) || []).length >= 2, true, 'the column header repeats');
});

test('an empty selection produces a valid, explicit PDF rather than failing', async () => {
  const model = buildExportModel([]);
  const text = extractPdfText(await buildInjectorListPdf(model)).join(' ');
  assert.match(text, /No injectors to list/);
});

// ── Filenames ───────────────────────────────────────────────────────────────
test('export filenames carry the part number and the record count', () => {
  const model = buildExportModel(seed());
  assert.strictEqual(exportFilename(model, 'xlsx'), 'InjectorTestResults_6513589_4.xlsx');
  assert.strictEqual(exportFilename(model, 'pdf'), 'InjectorTestResults_6513589_4.pdf');
  assert.strictEqual(exportFilename(buildExportModel([]), 'xlsx'), 'InjectorTestResults_Injectors_0.xlsx');
});
