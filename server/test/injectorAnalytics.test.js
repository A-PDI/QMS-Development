'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { db, resetInjectorData } = require('./helpers/testEnv');
const { benchReport } = require('./helpers/benchData');
const carbonzapp = require('../services/carbonzapp');
const { createRepairCase, addRepairAttempt, linkRetest, setCaseStatus } = require('../services/injectorRepairs');
const { buildInjectorAnalytics, buildInjectorAnalyticsWorkbook } = require('../services/injectorAnalytics');

const USER = { id: 'analytics-user', name: 'Report Technician', role: 'admin' };
const WINDOW = { date_from: '2026-09-01', date_to: '2026-09-03', interval: 'day' };
function reset() {
  resetInjectorData();
  db.run("INSERT OR IGNORE INTO users (id,name,email,role,active) VALUES (?,?,?,'admin',1)", [USER.id, USER.name, 'analytics@example.com']);
}
function result(id, serial, day, flow = 250, part = '4327147') {
  carbonzapp.upsertReports([benchReport({ id, serial, part, datetime: `2026-09-${day}T10:00:00Z`, flow: { IVM01: flow } })]);
  return db.get('SELECT * FROM injector_test_reports WHERE report_ext_id = ?', [id]);
}
function input(day, multi = false) {
  const changes = [{ component: 'Needle', action_type: 'Adjusted', parameter: 'Needle Stroke', before_value: '.247', after_value: '.232', unit: 'mm' }];
  if (multi) changes.push({ component: 'Nozzle Nut', action_type: 'Retorqued', parameter: 'Nozzle Nut Torque', before_value: '65', after_value: '70', unit: 'ft-lb' });
  return { repair_date: `2026-09-${day}T11:00:00Z`, diagnosis: 'High peak flow', changes };
}
function start(row, day) { return createRepairCase({ initial_test_id: row.id, attempt: input(day) }, USER); }
function seed() {
  reset();
  const a = start(result('a1', 'FIX-A', '01'), '01');
  linkRetest(a.attempts[0].id, { after_test_id: result('a2', 'FIX-A', '02', 235).id }, USER);
  const b = start(result('b1', 'FIX-B', '01', 255), '01');
  linkRetest(b.attempts[0].id, { after_test_id: result('b2', 'FIX-B', '02', 245).id }, USER);
  const b2 = addRepairAttempt(b.id, input('03', true), USER);
  linkRetest(b2.attempts[1].id, { after_test_id: result('b3', 'FIX-B', '04', 235).id }, USER);
  const c = start(result('c1', 'FIX-C', '03'), '03');
  result('d1', 'FIX-D', '01', 235);
  const e = result('e1', 'FIX-E', '01');
  db.run("UPDATE injector_test_reports SET result_status = 'dnf' WHERE id = ?", [e.id]);
  const missing = result('missing', 'FIX-MISSING', '01', 235);
  db.run("UPDATE injector_test_reports SET serial_number = '' WHERE id = ?", [missing.id]);
  return { a, b, c };
}

test('test-window counts, distinct injectors and failure-date repair cohorts reconcile', () => {
  seed();
  const report = buildInjectorAnalytics(WINDOW);
  assert.equal(report.testing.test_runs, 8, 'the Sep 4 retest is outside the test window');
  assert.equal(report.testing.unique_injectors, 5, 'repeat tests and missing serial do not inflate injector count');
  assert.equal(report.testing.missing_serial_tests, 1);
  assert.deepEqual(report.testing.outcomes, { PASS: 3, FAIL: 4, DNF: 1, UNKNOWN: 0 });
  assert.deepEqual(report.testing.first_outcomes, { PASS: 1, FAIL: 3, DNF: 1, UNKNOWN: 0 });
  assert.deepEqual(report.testing.latest_outcomes, { PASS: 2, FAIL: 2, DNF: 1, UNKNOWN: 0 });
  assert.equal(report.testing.test_pass_pct, 37.5);
  assert.equal(report.testing.first_pass_pct, 20);
  assert.equal(report.testing.needing_repair_pct, 60);
  assert.equal(report.testing.tracked_failed_pct, 100);
  assert.equal(report.trend.reduce((sum, period) => sum + period.PASS + period.FAIL + period.DNF + period.UNKNOWN, 0), 8);
  assert.equal(report.repairs.cases, 3);
  assert.equal(report.repairs.passed_cases, 2, 'later retest is included for a case that began in the window');
  assert.equal(report.repairs.avg_attempts_to_pass, 1.5, 'pending case excluded from average');
  assert.equal(report.repairs.passed_after_one, 1);
  assert.equal(report.repairs.injectors_passed_after_one, 1);
  assert.equal(report.repairs.first_retested_cases, 2);
  assert.equal(report.repairs.first_repair_pass_pct, 50);
  assert.equal(report.repairs.completed_attempts, 3);
  assert.equal(report.repairs.pending_retests, 1);
  assert.deepEqual(report.repairs.attempts_to_pass, [{ attempts: 1, cases: 1 }, { attempts: 2, cases: 1 }]);
});

test('adjustment groups avoid join multiplication and retain multi-change evidence', () => {
  seed();
  const report = buildInjectorAnalytics(WINDOW);
  const needle = report.actions.find((row) => row.parameter === 'Needle Stroke');
  assert.equal(needle.attempts, 4);
  assert.equal(needle.completed, 3);
  assert.equal(needle.pending, 1);
  assert.equal(needle.passed, 2);
  assert.equal(needle.multi_change, 1);
  const evidence = report.evidence.find((row) => row.parameter === 'Needle Stroke' && row.step_key === 'IVM01|1');
  assert.equal(evidence.samples, 3);
  assert.equal(evidence.corrected, 2);
  assert.equal(evidence.multi_change, 1);
  assert.equal(evidence.failure, 'High');
  assert.equal(evidence.measured_samples, 3);
  assert.ok(Math.abs(evidence.mean_test_delta - (-35 / 3)) < 1e-10);
  assert.ok(evidence.observations.every((row) => Math.abs(row.measurement_delta + .015) < 1e-10));
  assert.equal(report.evidence.filter((row) => row.parameter === 'Nozzle Nut Torque').length, 1);
});

test('DNF placeholders never become numeric correction evidence; units and parts stay separate', () => {
  const { a } = seed();
  db.run("UPDATE injector_repair_result_deltas SET after_status = 'DNF', after_value = 0 WHERE repair_attempt_id = ? AND step_code = 'IVM01'", [a.attempts[0].id]);
  const other = start(result('different-part', 'FIX-PART', '01', 250, 'OTHER-PART'), '01');
  db.run("UPDATE injector_repair_changes SET unit = 'in' WHERE repair_attempt_id = ?", [other.attempts[0].id]);
  linkRetest(other.attempts[0].id, { after_test_id: result('different-part-after', 'FIX-PART', '02', 235, 'OTHER-PART').id }, USER);
  const report = buildInjectorAnalytics(WINDOW);
  const evidence = report.evidence.find((row) => row.part_number === '4327147' && row.parameter === 'Needle Stroke');
  assert.equal(evidence.measured_samples, 2);
  assert.equal(evidence.mean_test_delta, -10);
  assert.equal(evidence.observations.find((row) => row.case_id === a.id).test_delta, null);
  assert.ok(report.evidence.some((row) => row.part_number === 'OTHER-PART' && row.measurement_unit === 'in'));
  const filtered = buildInjectorAnalytics({ ...WINDOW, part_number: 'other-part' });
  assert.equal(filtered.testing.unique_injectors, 1);
  assert.equal(filtered.repairs.cases, 1);
  assert.ok(filtered.evidence.every((row) => row.part_number === 'OTHER-PART'));
});

test('bench calendar boundaries, missing denominators, exclusions and validation are explicit', () => {
  reset();
  const included = result('boundary', 'FIX-Z', '03', 235);
  db.run("UPDATE injector_test_reports SET test_datetime = '2026-09-03T23:59:59-06:00' WHERE id = ?", [included.id]);
  const excluded = result('excluded', 'FIX-EXCLUDED', '03', 235);
  db.run("UPDATE injector_test_reports SET job_number = 'RMA-123' WHERE id = ?", [excluded.id]);
  const banned = result('banned', 'FIX-BANNED', '03', 235);
  db.run("UPDATE injector_test_reports SET serial_number = ' R123' WHERE id = ?", [banned.id]);
  const report = buildInjectorAnalytics(WINDOW);
  assert.equal(report.testing.test_runs, 1);
  assert.equal(report.repairs.avg_attempts_to_pass, null);
  assert.equal(report.repairs.first_repair_pass_pct, null);
  assert.equal(buildInjectorAnalytics({ date_from: '2027-01-01' }).testing.test_pass_pct, null);
  for (const config of [{ date_from: 'bad' }, { date_from: '2026-02-30' }, { date_from: '2026-09-10', date_to: '2026-09-01' }, { interval: 'year' }]) {
    assert.throws(() => buildInjectorAnalytics(config), /date|day, week, or month/);
  }
});

test('opposite failures and same-part measurement units form distinct comparison groups', () => {
  seed();
  const low = start(result('low1', 'FIX-LOW', '01', 200), '01');
  linkRetest(low.attempts[0].id, { after_test_id: result('low2', 'FIX-LOW', '02', 230).id }, USER);
  const inches = start(result('inch1', 'FIX-INCH', '01', 250), '01');
  db.run("UPDATE injector_repair_changes SET unit = 'in' WHERE repair_attempt_id = ?", [inches.attempts[0].id]);
  linkRetest(inches.attempts[0].id, { after_test_id: result('inch2', 'FIX-INCH', '02', 235).id }, USER);
  const groups = buildInjectorAnalytics(WINDOW).evidence.filter((row) => row.parameter === 'Needle Stroke');
  assert.equal(groups.length, 3);
  assert.equal(groups.find((row) => row.failure === 'Low').samples, 1);
  assert.equal(groups.find((row) => row.failure === 'High' && row.measurement_unit === 'mm').samples, 3);
  assert.equal(groups.find((row) => row.measurement_unit === 'in').samples, 1);
});

test('permanent repair reporting survives cache clearing without inflating test volume', () => {
  const { c } = seed();
  setCaseStatus(c.id, 'HOLD', USER);
  const before = buildInjectorAnalytics(WINDOW);
  carbonzapp.clearAllReports();
  const after = buildInjectorAnalytics(WINDOW);
  assert.equal(after.testing.test_runs, 0);
  assert.deepEqual(after.repairs, before.repairs);
  assert.equal(after.evidence.length, before.evidence.length);
  assert.equal(after.coverage.available_tests, 0);
  assert.equal(after.repairs.dispositions.HOLD, 1);
});

test('multiple repair episodes do not double-count injectors passing after one repair', () => {
  seed();
  const another = start(result('a-return', 'FIX-A', '03'), '03');
  linkRetest(another.attempts[0].id, { after_test_id: result('a-return-pass', 'FIX-A', '04', 235).id }, USER);
  const report = buildInjectorAnalytics(WINDOW);
  assert.equal(report.repairs.passed_after_one, 2, 'two separate successful repair episodes');
  assert.equal(report.repairs.injectors_passed_after_one, 1, 'one physical injector');
  assert.equal(report.testing.unique_injectors, 5);
});

test('Excel export uses the same aggregates and includes definitions and raw evidence', async () => {
  seed();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildInjectorAnalyticsWorkbook(WINDOW));
  const summary = workbook.getWorksheet('Summary');
  const metrics = new Map();
  summary.eachRow((row, index) => { if (index > 1) metrics.set(`${row.getCell(1).value}:${row.getCell(2).value}`, row.getCell(3).value); });
  assert.equal(metrics.get('Testing:test_runs'), 8);
  assert.equal(metrics.get('Testing:unique_injectors'), 5);
  assert.equal(metrics.get('Repairs:unique_injectors'), 3);
  assert.equal(metrics.get('Repairs:avg_attempts_to_pass'), 1.5);
  assert.equal(workbook.getWorksheet('Test runs').rowCount, 9);
  assert.ok(workbook.getWorksheet('Definitions').rowCount > 8);
  assert.ok(workbook.getWorksheet('Measurements').rowCount > 4);
  assert.ok(workbook.getWorksheet('Test evidence').rowCount > 4);
});
