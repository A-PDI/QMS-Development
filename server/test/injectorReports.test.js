'use strict';
/**
 * Sync/report separation and manual report generation.
 *
 * Covers requirement scenarios 6–10: synchronisation creates no inspection
 * reports; one selected injector produces a report containing only that
 * injector; a job-number selection produces the right set; "Generate Both"
 * produces one customer report and one inspection report; and a large batch
 * paginates without clipped or overlapping columns.
 */

const test = require('node:test');
const assert = require('node:assert');

const { db, extractPdfPages, extractPdfText, resetInjectorData, injectorInspectionCount } = require('./helpers/testEnv');
const { benchReport, benchBatch } = require('./helpers/benchData');
const carbonzapp = require('../services/carbonzapp');
const {
  loadSelectedInjectors,
  validateSelection,
  buildCustomerReport,
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
  assert.match(filename, /^InjectorReport_.+\.pdf$/);
});

// ── Scenario 8: selection by job number ──────────────────────────────────────
test('selecting the injectors of one job number reports exactly that set', async () => {
  resetInjectorData();
  await syncWith([
    ...benchBatch(4, { job: 'QMS-100', prefix: 'AAA' }),
    ...benchBatch(3, { job: 'QMS-200', prefix: 'BBB' }),
  ]);

  const job100 = db.all('SELECT * FROM injector_test_reports WHERE job_number = ? ORDER BY slot_position', ['QMS-100']);
  const job200 = db.all('SELECT * FROM injector_test_reports WHERE job_number = ?', ['QMS-200']);
  assert.strictEqual(job100.length, 4);

  const selected = loadSelectedInjectors(job100.map((r) => r.id));
  const { buffer } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer).join('\n');

  for (const inj of job100) assert.ok(text.includes(inj.serial_number), `${inj.serial_number} missing`);
  for (const inj of job200) assert.ok(!text.includes(inj.serial_number), `${inj.serial_number} should not appear`);
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
test('"Generate Both" produces one customer report and one inspection report', async () => {
  resetInjectorData();
  await syncWith(benchBatch(4, { perReport: 4 }));
  const selected = loadSelectedInjectors(storedInjectors().map((r) => r.id));

  const customer = await buildCustomerReport(selected);
  const inspectionResult = generateInspectionReports(selected, { actor: { id: 'u1', name: 'Test User' } });

  assert.ok(customer.buffer.length > 0, 'customer PDF generated');
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
test('every serial number prints in full in the column header', async () => {
  resetInjectorData();
  // Long serials of the shape the bench actually produces.
  await syncWith(benchBatch(8, { perReport: 4, prefix: '26098M4' }));
  const rows = storedInjectors();
  const selected = loadSelectedInjectors(rows.map((r) => r.id));

  const { buffer } = await buildCustomerReport(selected);
  const text = extractPdfText(buffer);

  for (const inj of rows) {
    assert.ok(
      text.includes(inj.serial_number),
      `serial ${inj.serial_number} is missing or truncated: ${JSON.stringify(text.filter((s) => s.startsWith('26098')))}`
    );
  }
  // No ellipsis anywhere in the header row.
  assert.ok(!text.some((s) => s.includes('…')), 'nothing was clipped');
});

test('long serials widen the columns and move injectors onto more pages', async () => {
  resetInjectorData();
  await syncWith(benchBatch(12, { perReport: 4, prefix: 'INJECTOR-SERIAL-2026-' }));
  const rows = storedInjectors();
  const { buffer } = await buildCustomerReport(loadSelectedInjectors(rows.map((r) => r.id)));
  const pages = extractPdfPages(buffer);

  assert.ok(pages.length > 1, 'wide columns push the batch onto more pages');
  const text = pages.flat();
  for (const inj of rows) {
    assert.ok(text.includes(inj.serial_number), `serial ${inj.serial_number} is clipped`);
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

test('validation warns (but does not block) on missing identifiers', async () => {
  resetInjectorData();
  await syncWith(benchBatch(2));
  const rows = storedInjectors();
  db.run('UPDATE injector_test_reports SET job_number = NULL WHERE id = ?', [rows[0].id]);

  const validation = validateSelection(loadSelectedInjectors(rows.map((r) => r.id)));
  assert.strictEqual(validation.ok, true);
  assert.ok(validation.warnings.some((w) => /job number/i.test(w)));
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
