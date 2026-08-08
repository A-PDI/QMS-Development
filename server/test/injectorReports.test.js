'use strict';
/**
 * Sync/report separation and manual report generation.
 *
 * Covers requirement scenarios 6–10: synchronisation creates no inspection
 * reports; one selected injector produces a report containing only that
 * injector; an explicit multi-row selection produces the right set; "Generate
 * Both" produces one custom report and one inspection report; and a large batch
 * paginates without clipped or overlapping columns.
 */

const test = require('node:test');
const assert = require('node:assert');
const PDFDocument = require('pdfkit');

const { db, extractPdfPages, extractPdfText, resetInjectorData, injectorInspectionCount } = require('./helpers/testEnv');
const { benchReport, benchBatch } = require('./helpers/benchData');
const carbonzapp = require('../services/carbonzapp');
const {
  splitSerialLines,
  numericPartNumber,
  numericPartNumbers,
  buildInjectorComparisonModel,
  computeComparisonLayout,
  REPORT_TABLE_FONT_MIN,
} = require('../services/pdf');
const {
  loadSelectedInjectors,
  validateSelection,
  buildCustomerReport,
  buildReportPreview,
  buildShipmentEvaluationReport,
  generateInspectionReports,
} = require('../services/injectorReports');

/** Run a sync against a stubbed bench response. */
async function syncWith(reports, opts = {}) {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(reports),
  });
  try {
    return await carbonzapp.syncNow({ apiKey: 'test-key-1234', ...opts });
  } finally {
    global.fetch = originalFetch;
  }
}

function storedInjectors() {
  return db.all('SELECT * FROM injector_test_reports ORDER BY report_ext_id, slot_position', []);
}

// ── Scenario 6: sync must not create inspection reports ──────────────────────
test('synchronisation imports test records and creates no inspection reports', async () => {
  resetInjectorData();
  const before = injectorInspectionCount();

  const result = await syncWith(benchBatch(8));

  assert.strictEqual(result.imported, 8, 'all injectors imported');
  assert.strictEqual(result.inspectionsCreated, 0, 'sync must not create inspections');
  assert.strictEqual(storedInjectors().length, 8);
  assert.strictEqual(injectorInspectionCount(), before, 'no inspection rows added by sync');
  assert.ok(storedInjectors().every((r) => r.inspection_id == null), 'no injector linked to an inspection');
});

test('repeated synchronisation updates rather than duplicates records', async () => {
  resetInjectorData();
  await syncWith(benchBatch(8));
  const second = await syncWith(benchBatch(8));

  assert.strictEqual(second.imported, 0, 'nothing re-imported');
  assert.strictEqual(second.updated, 8, 'existing rows updated in place');
  assert.strictEqual(storedInjectors().length, 8, 'no duplicate injector rows');
  assert.strictEqual(second.inspectionsCreated, 0);
});

// ── Scenario 7: one injector → a report about only that injector ─────────────
test('selecting one injector reports on only that injector', async () => {
  resetInjectorData();
  await syncWith(benchBatch(6));
  const rows = storedInjectors();
  const chosen = rows[2];

  const selected = loadSelectedInjectors([chosen.id]);
  assert.strictEqual(selected.length, 1);

  const { buffer, filename } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer).join('\n');

  assert.ok(text.includes(chosen.serial_number), 'selected serial is in the report');
  for (const other of rows.filter((r) => r.id !== chosen.id)) {
    assert.ok(!text.includes(other.serial_number), `unselected ${other.serial_number} must not appear`);
  }
  assert.match(filename, /^CustomReport_.+\.pdf$/);
});

test('report preview uses the comparison model without creating a PDF or inspection', async () => {
  resetInjectorData();
  await syncWith([
    benchReport({ id: 'preview-1', slot: 0, serial: 'PV001' }),
    benchReport({ id: 'preview-1', slot: 1, serial: 'PV002', errorOn: 'IVM06' }),
  ]);
  const selected = loadSelectedInjectors(storedInjectors().map((row) => row.id));
  const before = injectorInspectionCount();
  const preview = buildReportPreview(selected);

  assert.strictEqual(preview.title, 'Custom Report Preview');
  assert.deepStrictEqual(preview.injectors.map((injector) => injector.serialNumber), ['PV001', 'PV002']);
  assert.ok(preview.rows.some((row) => row.label === 'Peak Torque'));
  assert.ok(preview.rows.some((row) => row.values.some((cell) => cell.error)));
  assert.ok(preview.injectors.every((injector) => !Object.hasOwn(injector, 'jobNumber')));
  assert.strictEqual(injectorInspectionCount(), before);
});

test('report part numbers remove all non-numeric characters and deduplicate afterwards', () => {
  assert.strictEqual(numericPartNumber('PN-0445-120067PX'), '0445120067');
  assert.strictEqual(numericPartNumber('AB12-CD34-EF'), '1234');
  assert.strictEqual(numericPartNumber('NO-DIGITS'), '—');
  assert.deepStrictEqual(
    numericPartNumbers(['PN-0445-120067PX', '0445120067-RX', 'P-999', 'PN-0445-120067PX']),
    ['0445120067', '999']
  );
});

test('custom and shipment reports share Part, Vendor and Report Date header information', async () => {
  resetInjectorData();
  await syncWith([
    benchReport({ id: 'header-1', slot: 0, serial: 'HDR001', part: 'PN-0445-120067PX' }),
    benchReport({ id: 'header-1', slot: 1, serial: 'HDR002', part: '0445120067-RX' }),
    benchReport({ id: 'header-1', slot: 2, serial: 'HDR003', part: 'P-999' }),
  ]);
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));
  const opts = { vendorName: 'Acme Diesel Supply', reportDate: '2026-08-07' };

  const customer = await buildCustomerReport(selected, opts);
  const shipment = await buildShipmentEvaluationReport(selected, opts);
  const customerHeader = extractPdfPages(customer.buffer)[0].join('\n');
  const shipmentHeader = extractPdfPages(shipment.buffer)[0].join('\n');

  for (const header of [customerHeader, shipmentHeader]) {
    assert.ok(header.includes('Part: 0445120067, 999'), 'numeric part variants are deduplicated');
    assert.ok(!header.includes('0445120067, 0445120067'), 'duplicate normalized parts are omitted');
    assert.ok(header.includes('Vendor: Acme Diesel Supply'));
    assert.ok(header.includes('Report Date: 08/07/2026'));
  }
  assert.ok(!customerHeader.includes('Injector:'), 'the former customer-only header field is gone');
  assert.ok(!customerHeader.includes('QMS-724-3'), 'job number is not used in the shared header');
});

test('injector report table values never render below 7.5pt', () => {
  const tests = Array.from({ length: 22 }, (_, index) => ({
    name: `T.${String(index + 1).padStart(2, '0')}`,
    raw_name: `T.${String(index + 1).padStart(2, '0')}`,
    status: 'pass',
    errored: false,
    primary: {
      tank_name: '',
      unit: 'mm3/STRK',
      spec: '10.0 +/- 1.0 mm3/STRK',
      min_green: 9,
      max_green: 11,
      average: '10.0',
      status: 'pass',
    },
    secondary: null,
  }));
  const model = buildInjectorComparisonModel([{
    serial_number: 'LONG00001',
    part_number: 'PN-123',
    brand: 'Acme',
    tests,
  }]);
  const doc = new PDFDocument({ margin: 28, size: 'Letter', layout: 'landscape' });
  doc.on('data', () => {});
  const layout = computeComparisonLayout(doc, model);

  assert.ok(layout.rowH < 20, 'fixture forces the compact-row layout');
  assert.ok(layout.valFont >= REPORT_TABLE_FONT_MIN);
  assert.ok(layout.specValFont >= REPORT_TABLE_FONT_MIN);
  assert.ok(layout.serialFont >= REPORT_TABLE_FONT_MIN);
  doc.end();
});

// ── Scenario 8: an explicit selection reports only that set ─────────────────
test('selecting a set of injector rows reports exactly that set', async () => {
  resetInjectorData();
  await syncWith([
    ...benchBatch(4, { job: 'QMS-100', prefix: 'AAA' }),
    ...benchBatch(3, { job: 'QMS-200', prefix: 'BBB' }),
  ]);

  const selectedRows = db.all("SELECT * FROM injector_test_reports WHERE serial_number LIKE 'AAA%' ORDER BY slot_position", []);
  const otherRows = db.all("SELECT * FROM injector_test_reports WHERE serial_number LIKE 'BBB%'", []);
  assert.strictEqual(selectedRows.length, 4);

  const selected = loadSelectedInjectors(selectedRows.map((r) => r.id));
  const { buffer } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer).join('\n');

  for (const inj of selectedRows) assert.ok(text.includes(inj.serial_number), `${inj.serial_number} missing`);
  for (const inj of otherRows) assert.ok(!text.includes(inj.serial_number), `${inj.serial_number} should not appear`);
});

test('report column order follows the selection order', async () => {
  resetInjectorData();
  await syncWith(benchBatch(4));
  const rows = storedInjectors();
  const order = [rows[3].id, rows[0].id, rows[2].id];

  const selected = loadSelectedInjectors(order);
  assert.deepStrictEqual(
    selected.map((r) => r.id),
    order,
    'selection order is preserved'
  );
});

// ── Scenario 9: Generate Both ────────────────────────────────────────────────
test('"Generate Both" produces one custom report and one inspection report', async () => {
  resetInjectorData();
  await syncWith(benchBatch(4, { perReport: 4 }));
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));

  const customer = await buildCustomerReport(selected);
  const inspectionResult = generateInspectionReports(selected, { actor: { id: 'u1', name: 'Test User' } });

  assert.ok(customer.buffer.length > 0, 'custom PDF generated');
  assert.strictEqual(customer.buffer.subarray(0, 4).toString(), '%PDF');
  assert.strictEqual(inspectionResult.inspections.length, 1, 'one inspection for one bench report');
  assert.strictEqual(inspectionResult.created, 1);

  const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [inspectionResult.inspections[0].inspection_id]);
  assert.ok(inspection, 'inspection row exists');
  const sectionData = JSON.parse(inspection.section_data);
  assert.strictEqual(sectionData.__items.length, 4, 'one item per selected injector');
  assert.strictEqual(inspection.inspector_name, 'Test User', 'records who generated it');
});

test('regenerating an inspection report updates it instead of duplicating', async () => {
  resetInjectorData();
  await syncWith(benchBatch(4, { perReport: 4 }));
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));

  const first = generateInspectionReports(selected);
  const second = generateInspectionReports(loadSelectedInjectors(storedInjectors().map((r) => r.id)));

  assert.strictEqual(first.created, 1);
  assert.strictEqual(second.created, 0, 'second run creates nothing new');
  assert.strictEqual(second.updated, 1, 'second run refreshes the existing inspection');
  assert.strictEqual(
    second.inspections[0].inspection_id,
    first.inspections[0].inspection_id,
    'same inspection reused'
  );
  assert.strictEqual(injectorInspectionCount(), 1, 'exactly one inspection exists');
});

test('an inspection report covers only the selected injectors', async () => {
  resetInjectorData();
  await syncWith(benchBatch(4, { perReport: 4 }));
  const rows = storedInjectors();
  const twoOfFour = loadSelectedInjectors([rows[0].id, rows[1].id]);

  const result = generateInspectionReports(twoOfFour);
  const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [result.inspections[0].inspection_id]);
  const sectionData = JSON.parse(inspection.section_data);

  assert.strictEqual(sectionData.__items.length, 2, 'only the selected injectors become items');
  assert.deepStrictEqual(
    sectionData.__injector_source.injectors.map((i) => i.serial),
    [rows[0].serial_number, rows[1].serial_number]
  );
});

test('a flagged step reports its measured value, not the error message', async () => {
  resetInjectorData();
  // The bench flags IVM06 as out of range but still reports what it measured.
  await syncWith([benchReport({ serial: 'ERR001', errorOn: 'IVM06', flow: { IVM06: 291 } })]);
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));

  const result = generateInspectionReports(selected);
  const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [result.inspections[0].inspection_id]);
  const sectionData = JSON.parse(inspection.section_data);
  const dimensional = sectionData.__admin_sections.dimensional.items.map((i) => i.measurement);
  const rows = sectionData.__items[0].dimensional;
  const values = rows.map((a) => a.actual1);

  assert.ok(dimensional.includes('Peak Torque'), `expected Peak Torque in ${JSON.stringify(dimensional)}`);
  assert.ok(!dimensional.some((m) => /error/i.test(m)), 'no step name carries error text');
  assert.ok(values.includes('291'), `expected the measured value, got ${JSON.stringify(values)}`);
  assert.ok(!values.some((v) => /excess return|error/i.test(String(v))), 'no message in a value cell');

  // The step still FAILS and still records why.
  const flagged = rows.find((r) => String(r.actual1) === '291');
  assert.strictEqual(flagged.status, 'F');
  assert.strictEqual(flagged.__error, 'Excess Return', 'the condition is still recorded on the row');
  assert.strictEqual(inspection.disposition, 'FAIL');
});

test('a flagged step with no reading at all still shows the condition', async () => {
  resetInjectorData();
  await syncWith([benchReport({ serial: 'ERR002', errorOn: 'IVM06', flow: { IVM06: null } })]);
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));

  const result = generateInspectionReports(selected);
  const inspection = db.get('SELECT * FROM inspections WHERE id = ?', [result.inspections[0].inspection_id]);
  const values = JSON.parse(inspection.section_data).__items[0].dimensional.map((a) => a.actual1);

  assert.ok(values.includes('Excess Return'), `expected the fallback text, got ${JSON.stringify(values)}`);
});

// ── Scenario 10: large batches paginate ──────────────────────────────────────
test('a large batch paginates with repeated headers and no dropped injectors', async () => {
  resetInjectorData();
  await syncWith(benchBatch(30, { perReport: 6 }));
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));
  assert.strictEqual(selected.length, 30);

  const { buffer } = await buildCustomerReport(selected);
  const pages = extractPdfPages(buffer);

  assert.ok(pages.length > 1, 'a 30-injector batch spans multiple pages');

  const serialsSeen = [];
  pages.forEach((page, idx) => {
    const text = page.join('\n');
    assert.ok(text.includes('TEST STEP'), `page ${idx + 1} repeats the column headers`);
    assert.ok(text.includes('Peak Torque'), `page ${idx + 1} repeats the test-point rows`);
    assert.ok(/Page \d+ of \d+/.test(text), `page ${idx + 1} is numbered`);
    page.filter((s) => /^SN\d{3}$/.test(s)).forEach((s) => serialsSeen.push(s));
  });

  // Every injector appears exactly once, in the selected order.
  assert.deepStrictEqual(serialsSeen, selected.map((r) => r.serial_number));
});

// ── Serial numbers are never clipped ─────────────────────────────────────────
test('a serial longer than 8 characters wraps with its last 4 below', () => {
  assert.deepStrictEqual(splitSerialLines('26098M455'), ['26098', 'M455']);
  assert.deepStrictEqual(splitSerialLines('ABC12345'), ['ABC12345'], '8 characters stays on one line');
  assert.deepStrictEqual(splitSerialLines('123456789'), ['12345', '6789']);
  assert.deepStrictEqual(splitSerialLines(''), ['—']);
  // The two lines always reconstruct the serial exactly.
  for (const sn of ['26098M455', 'INJECTOR-SERIAL-2026-001', 'SN1']) {
    assert.strictEqual(splitSerialLines(sn).join(''), sn);
  }
});

test('every serial number prints in full in the column header', async () => {
  resetInjectorData();
  // Long serials of the shape the bench actually produces.
  await syncWith(benchBatch(8, { perReport: 4, prefix: '26098M4' }));
  const rows = storedInjectors();
  const selected = loadSelectedInjectors(rows.map((r) => r.id));

  const { buffer } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer);

  for (const inj of rows) {
    for (const line of splitSerialLines(inj.serial_number)) {
      assert.ok(text.includes(line), `serial ${inj.serial_number}: line "${line}" is missing`);
    }
  }
  // No ellipsis anywhere in the header row.
  assert.ok(!text.some((s) => s.includes('…')), 'nothing was clipped');
});

test('very long serials widen the columns and move injectors onto more pages', async () => {
  resetInjectorData();
  await syncWith(benchBatch(12, { perReport: 4, prefix: 'INJECTOR-SERIAL-2026-' }));
  const rows = storedInjectors();
  const { buffer } = await buildCustomerReport(loadSelectedInjectors(rows.map((r) => r.id)));
  const pages = extractPdfPages(buffer);

  assert.ok(pages.length > 1, 'wide columns push the batch onto more pages');
  const text = pages.flat();
  for (const inj of rows) {
    for (const line of splitSerialLines(inj.serial_number)) {
      assert.ok(text.includes(line), `serial ${inj.serial_number}: line "${line}" is clipped`);
    }
  }
});

test('small batches still render on a single page', async () => {
  resetInjectorData();
  await syncWith(benchBatch(3));
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));

  const { buffer } = await buildCustomerReport(selected);
  const pages = extractPdfPages(buffer);
  assert.strictEqual(pages.length, 1, 'three injectors need one page');
});

// ── Validation ───────────────────────────────────────────────────────────────
test('validation blocks records with no test-bench results', async () => {
  resetInjectorData();
  await syncWith(benchBatch(2));
  const rows = storedInjectors();
  // Simulate a record that arrived without any usable steps.
  db.run('UPDATE injector_test_reports SET report_json = ?, steps_total = 0 WHERE id = ?',
    [JSON.stringify({ tests: [] }), rows[0].id]);

  const selected = loadSelectedInjectors(rows.map((r) => r.id));
  const validation = validateSelection(selected);

  assert.strictEqual(validation.ok, false);
  assert.match(validation.message, /no test-bench results/i);
  assert.ok(validation.message.includes(rows[0].serial_number), 'names the offending record');
});

test('validation rejects an empty selection', () => {
  const validation = validateSelection([]);
  assert.strictEqual(validation.ok, false);
  assert.match(validation.message, /at least one injector/i);
});

test('validation warns (but does not block) on missing part and serial identifiers', async () => {
  resetInjectorData();
  await syncWith(benchBatch(2));
  const rows = storedInjectors();
  db.run('UPDATE injector_test_reports SET serial_number = NULL, part_number = NULL WHERE id = ?', [rows[0].id]);

  const validation = validateSelection(loadSelectedInjectors(rows.map((r) => r.id)));
  assert.strictEqual(validation.ok, true);
  assert.ok(validation.warnings.some((w) => /serial number/i.test(w)));
  assert.ok(validation.warnings.some((w) => /part number/i.test(w)));
  assert.ok(validation.warnings.every((w) => !/job number/i.test(w)));
});

// ── Shipment evaluation report ───────────────────────────────────────────────
test('the shipment evaluation report has a summary page plus detail pages', async () => {
  resetInjectorData();
  await syncWith(benchBatch(30, {
    perReport: 6,
    // 4 injectors fail IVM01, 2 error on IVM06.
    customise: (i) => (i < 4
      ? { flow: { IVM01: 9999 } }
      : (i < 6 ? { errorOn: 'IVM06' } : {})),
  }));
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));

  const { buffer, filename } = await buildShipmentEvaluationReport(selected, { vendorName: 'Acme Diesel Supply' });
  const pages = extractPdfPages(buffer);
  const summary = pages[0].join('\n');

  assert.ok(pages.length >= 2, 'at least a summary page and one detail page');
  assert.match(filename, /^ShipmentEvaluation_.*Acme/);
  assert.ok(summary.includes('Shipment Evaluation Report'));
  assert.ok(summary.includes('TOTAL TESTED'));

  // Header identifies the shipment by part number, vendor and report date —
  // there is no job number and no identification strip below the banner.
  assert.ok(summary.includes('Vendor: Acme Diesel Supply'), 'vendor name in the header');
  assert.ok(/Part: /.test(summary), 'part number in the header');
  assert.ok(/Report Date: /.test(summary), 'report date in the header');
  assert.ok(!summary.includes('QMS-724-3'), 'the job number is not shown on the evaluation');
  assert.ok(!summary.includes('INJECTORS TESTED'), 'the identification strip is gone');

  // One failure representation, and the two deviation charts.
  assert.ok(summary.includes('Failure Count by Test Point'));
  assert.ok(!summary.includes('Most Common Failure Points'), 'the duplicate failure panel is gone');
  assert.ok(summary.includes('Average Deviation'));
  assert.ok(summary.includes('Maximum Deviation'));
  assert.ok(!/Passing-Injector Consistency/.test(summary), 'renamed to Average Deviation');
  assert.ok(!/mean \d/.test(summary), 'the mean is no longer shown on the deviation rows');
  assert.ok(!/n=\d/.test(summary), 'the sample count is no longer shown on the deviation rows');
  // Failure analysis uses normalised step names, never raw API error text.
  assert.ok(summary.includes('Peak HP'), 'failing test point named by its display name');
  assert.ok(summary.includes('Peak Torque'), 'errored test point named by its display name');
  assert.ok(!/HP ERROR|#1000/i.test(summary), 'raw bench error text must not appear on the summary');

  const detail = pages.slice(1).map((p) => p.join('\n')).join('\n');
  assert.ok(detail.includes('TEST STEP'), 'detail pages use the comparison grid');
  assert.ok(detail.includes('FAIL'), 'flagged injectors still read FAIL');
  assert.ok(!/Excess Return|Error:/.test(detail),
    'the detail grid shows measured values, not error messages');
});

// ── Result cell rules ────────────────────────────────────────────────────────
test('a flagged step reading zero shows "No Test" over the condition', async () => {
  resetInjectorData();
  await syncWith([benchReport({ serial: 'ZERO0001', errorOn: 'IVM06', flow: { IVM06: 0 } })]);
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));

  const { buffer } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer);

  assert.ok(text.includes('No Test'), 'the zero reading is replaced by "No Test"');
  assert.ok(text.includes('Excess Return'), 'the condition is named underneath');
  assert.ok(!text.includes('0.00'), 'the bare zero is not shown');
  assert.ok(text.includes('FAIL'), 'the injector still fails');
});

test('a zero on a step the bench did NOT flag stays a zero', async () => {
  resetInjectorData();
  // Leak tests legitimately read 0 — that is a passing measurement.
  await syncWith([benchReport({ serial: 'ZERO0002', flow: { IVM01: 0 } })]);
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));

  const { buffer } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer);

  assert.ok(!text.includes('No Test'), '"No Test" is only for flagged steps');
  assert.ok(text.includes('0'), 'the measured zero is shown');
});

test('the printed range is the band that decides pass/fail', async () => {
  resetInjectorData();
  await syncWith([benchReport({ serial: 'BANDRANGE001' })]);
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));
  const tests = selected[0].tests.filter((t) => t.primary && !/^FL/i.test(t.name));

  const { buffer } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer).join('\n');

  for (const t of tests) {
    const expected = `${t.primary.min_green.toFixed(1)} - ${t.primary.max_green.toFixed(1)}`;
    assert.ok(text.includes(expected), `expected the range ${expected} for ${t.name}`);
  }
});

test('a flagged injector with no band does not blank the range for the batch', async () => {
  resetInjectorData();
  const flagged = benchReport({ id: 'r1', slot: 0, serial: 'NOBAND01', errorOn: 'IVM06' });
  // The bench sent no acceptance band for the step it flagged.
  const step = flagged.AllTests.find((t) => /IVM|iVM/.test(t.TestInfo.test_name) && /ERROR/.test(t.TestInfo.test_name));
  step.PrimaryTank.min_green = '';
  step.PrimaryTank.max_green = '';
  step.PrimaryTank.text_green = '';
  const healthy = benchReport({ id: 'r1', slot: 1, serial: 'NOBAND02' });

  await syncWith([flagged, healthy]);
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));
  const { buffer } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer).join('\n');

  assert.ok(text.includes('234.0 - 276.0'), 'the band comes from the injector that has one');
});

test('the SPEC column shows the GREEN acceptance band, not the blue target band', async () => {
  resetInjectorData();
  const report = benchReport({ serial: 'BAND0001' });
  const step = report.AllTests.find((t) => t.TestInfo.test_name === 'iVM.01');
  // The bench sends both: a green acceptance band (what pass/fail uses, and what
  // the report must print) and a much tighter blue target band.
  step.PrimaryTank.min_green = '220.0';
  step.PrimaryTank.max_green = '240.0';
  step.PrimaryTank.text_green = '230.0 +/- 10.0';
  step.PrimaryTank.target_blue = '230.0';
  step.PrimaryTank.tol_blue = '2.0';

  await syncWith([report]);
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));
  const { buffer } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer).join('\n');

  assert.ok(text.includes('220.0 - 240.0'), 'the green acceptance band is printed');
  assert.ok(!text.includes('228.0 - 232.0'), 'the blue target band is not printed');
});
