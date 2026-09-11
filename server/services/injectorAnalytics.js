'use strict';

const db = require('../db/adapter');
const ExcelJS = require('exceljs');
const { AppError } = require('../middleware/error');
const { getSetting } = require('./carbonzapp');

const clean = (value) => String(value ?? '').trim();
const identity = (row) => JSON.stringify([clean(row.part_number).toUpperCase(), clean(row.serial_number).toUpperCase()]);
const status = (value) => ['PASS', 'FAIL', 'DNF'].includes(String(value).toUpperCase()) ? String(value).toUpperCase() : 'UNKNOWN';
const counts = () => ({ PASS: 0, FAIL: 0, DNF: 0, UNKNOWN: 0 });
const pct = (n, d) => d ? n / d * 100 : null;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const numeric = (value) => value != null && clean(value) !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const keyOf = (...values) => JSON.stringify(values);

function filters(input = {}) {
  const date = (value) => {
    if (!value) return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new AppError('Choose a valid date range.', 400, 'VALIDATION_ERROR');
    }
    return value;
  };
  const from = date(input.date_from);
  const to = date(input.date_to);
  if (from && to && from > to) throw new AppError('Start date must be on or before end date.', 400, 'VALIDATION_ERROR');
  const interval = input.interval || 'week';
  if (!['day', 'week', 'month'].includes(interval)) throw new AppError('Choose day, week, or month.', 400, 'VALIDATION_ERROR');
  if (input.part_number != null && typeof input.part_number !== 'string') throw new AppError('Choose one part number.', 400, 'VALIDATION_ERROR');
  return { date_from: from, date_to: to, part_number: clean(input.part_number), interval };
}

function scope(alias, dateColumn, config, isTest = false) {
  const clauses = [`UPPER(TRIM(COALESCE(${alias}.serial_number, ''))) NOT LIKE 'R%'`];
  const params = [];
  if (isTest) clauses.push(`UPPER(COALESCE(${alias}.job_number, '')) NOT LIKE '%RMA%'`);
  // Bench calendar dates match Injector Tests; do not shift an offset timestamp
  // across a calendar boundary by converting it to UTC.
  if (config.date_from) { clauses.push(`substr(${alias}.${dateColumn}, 1, 10) >= ?`); params.push(config.date_from); }
  if (config.date_to) { clauses.push(`substr(${alias}.${dateColumn}, 1, 10) <= ?`); params.push(config.date_to); }
  if (config.part_number) { clauses.push(`TRIM(COALESCE(${alias}.part_number, '')) = ? COLLATE NOCASE`); params.push(config.part_number); }
  clauses.push(`date(substr(${alias}.${dateColumn}, 1, 10)) IS NOT NULL`);
  return { sql: clauses.join(' AND '), params };
}

function bucket(value, interval) {
  const day = value.slice(0, 10);
  if (interval === 'month') return day.slice(0, 7);
  if (interval === 'day') return day;
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function changed(change) {
  if (['No Change', 'Inspected'].includes(change.action_type)) return false;
  const before = numeric(change.before_value);
  const after = numeric(change.after_value);
  return !(change.action_type === 'Adjusted' && before != null && after != null && before === after);
}

/** One consistent cohort powers cards, charts, tables and the workbook. */
function buildInjectorAnalytics(input = {}, includeDetails = false) {
  const config = filters(input);
  const testScope = scope('t', 'test_datetime', config, true);
  const caseScope = scope('c', 'initial_test_datetime', config);
  const tests = db.all(`SELECT id, report_ext_id, slot_position, part_number, serial_number, test_datetime, result_status
    FROM injector_test_reports t WHERE ${testScope.sql}
    ORDER BY substr(test_datetime, 1, 19), report_ext_id, slot_position`, testScope.params);
  const cases = db.all(`SELECT c.* FROM injector_repair_cases c WHERE ${caseScope.sql}
    ORDER BY c.initial_test_datetime DESC, c.id`, caseScope.params);
  const attempts = db.all(`SELECT a.* FROM injector_repair_attempts a
    JOIN injector_repair_cases c ON c.id = a.repair_case_id WHERE ${caseScope.sql} ORDER BY a.attempt_number`, caseScope.params);
  const changes = db.all(`SELECT x.* FROM injector_repair_changes x
    JOIN injector_repair_attempts a ON a.id = x.repair_attempt_id
    JOIN injector_repair_cases c ON c.id = a.repair_case_id WHERE ${caseScope.sql} ORDER BY x.sequence`, caseScope.params);
  const deltas = db.all(`SELECT d.* FROM injector_repair_result_deltas d
    JOIN injector_repair_attempts a ON a.id = d.repair_attempt_id
    JOIN injector_repair_cases c ON c.id = a.repair_case_id WHERE ${caseScope.sql}`, caseScope.params);
  const caseMap = new Map(cases.map((row) => [row.id, row]));
  const groupRows = (rows, field) => {
    const result = new Map();
    for (const row of rows) { if (!result.has(row[field])) result.set(row[field], []); result.get(row[field]).push(row); }
    return result;
  };
  const attemptsByCase = groupRows(attempts, 'repair_case_id');
  const changesByAttempt = groupRows(changes, 'repair_attempt_id');
  const deltasByAttempt = groupRows(deltas, 'repair_attempt_id');
  const unique = new Map();
  const trend = new Map();
  const testOutcomes = counts();
  let missingSerial = 0;
  for (const test of tests) {
    const outcome = status(test.result_status);
    testOutcomes[outcome] += 1;
    const period = bucket(test.test_datetime, config.interval);
    if (!trend.has(period)) trend.set(period, { period, ...counts(), injectors: new Set() });
    trend.get(period)[outcome] += 1;
    if (!clean(test.serial_number)) { missingSerial += 1; continue; }
    const id = identity(test);
    trend.get(period).injectors.add(id);
    if (!unique.has(id)) unique.set(id, { first: outcome, latest: outcome, failed: false });
    Object.assign(unique.get(id), { latest: outcome, failed: unique.get(id).failed || outcome === 'FAIL' });
  }
  const first = counts();
  const latest = counts();
  let failed = 0;
  for (const row of unique.values()) { first[row.first] += 1; latest[row.latest] += 1; if (row.failed) failed += 1; }
  const tracked = new Set(cases.filter((row) => unique.get(identity(row))?.failed).map(identity));
  const dispositions = {};
  const distribution = new Map();
  const successfulAttempts = [];
  let passedOne = 0;
  const injectorsPassedOne = new Set();
  let firstRetested = 0;
  for (const row of cases) {
    const rounds = attemptsByCase.get(row.id) || [];
    dispositions[row.status] = (dispositions[row.status] || 0) + 1;
    const firstAttempt = rounds.find((attempt) => Number(attempt.attempt_number) === 1);
    if (firstAttempt?.status === 'COMPLETED') {
      firstRetested += 1;
      if (firstAttempt.outcome === 'PASS') { passedOne += 1; injectorsPassedOne.add(identity(row)); }
    }
    if (row.status === 'PASSED') {
      const passing = rounds.find((attempt) => attempt.outcome === 'PASS' && attempt.status === 'COMPLETED');
      if (passing) {
        const count = Number(passing.attempt_number);
        successfulAttempts.push(count);
        distribution.set(count, (distribution.get(count) || 0) + 1);
      }
    }
  }
  const completed = attempts.filter((attempt) => attempt.status === 'COMPLETED');
  const attemptPasses = completed.filter((attempt) => attempt.outcome === 'PASS').length;

  // Do not multiply the attempt denominator by the number of changed parts or
  // failed test points. Each group counts an attempt at most once.
  const actions = new Map();
  const associations = new Map();
  for (const attempt of attempts) {
    const repairCase = caseMap.get(attempt.repair_case_id);
    const activeChanges = (changesByAttempt.get(attempt.id) || []).filter(changed);
    const multi = activeChanges.length > 1;
    const actionSeen = new Set();
    const evidenceSeen = new Set();
    for (const change of activeChanges) {
      const before = numeric(change.before_value);
      const after = numeric(change.after_value);
      const movement = before != null && after != null ? after - before : null;
      const direction = movement == null ? 'Recorded action' : movement > 0 ? 'Increased' : movement < 0 ? 'Decreased' : 'Unchanged';
      const actionKey = keyOf(clean(repairCase.part_number).toUpperCase(), change.component, change.parameter, change.action_type, change.unit, direction);
      if (!actions.has(actionKey)) actions.set(actionKey, {
        key: actionKey, part_number: repairCase.part_number, component: change.component,
        parameter: change.parameter || change.component, action: change.action_type, unit: change.unit,
        direction, attempts: 0, completed: 0, passed: 0, pending: 0, multi_change: 0,
      });
      const action = actions.get(actionKey);
      if (!actionSeen.has(actionKey)) {
        actionSeen.add(actionKey);
        action.attempts += 1;
        action.multi_change += multi ? 1 : 0;
        if (attempt.status === 'COMPLETED') { action.completed += 1; action.passed += attempt.outcome === 'PASS' ? 1 : 0; }
        else action.pending += 1;
      }
      if (attempt.status !== 'COMPLETED') continue;
      for (const delta of deltasByAttempt.get(attempt.id) || []) {
        if (delta.before_status !== 'FAIL') continue;
        const baseline = numeric(delta.before_value);
        const failure = baseline != null && numeric(delta.spec_max) != null && baseline > Number(delta.spec_max) ? 'High'
          : baseline != null && numeric(delta.spec_min) != null && baseline < Number(delta.spec_min) ? 'Low' : 'Reported fail';
        const evidenceKey = keyOf(actionKey, delta.step_key, delta.spec_min, delta.spec_max, delta.unit, failure);
        if (evidenceSeen.has(evidenceKey)) continue;
        evidenceSeen.add(evidenceKey);
        if (!associations.has(evidenceKey)) associations.set(evidenceKey, {
          key: evidenceKey, part_number: repairCase.part_number,
          failure,
          parameter: action.parameter, component: change.component, action: change.action_type,
          direction, measurement_unit: change.unit, step: delta.step_name, step_key: delta.step_key,
          test_unit: delta.unit, spec_min: delta.spec_min, spec_max: delta.spec_max,
          observations: [],
        });
        // DNF/unknown/missing readings may contain a zero placeholder. Keep the
        // outcome visible, but never put those readings in a numeric comparison.
        const comparable = ['PASS', 'FAIL'].includes(delta.after_status)
          && numeric(delta.before_value) != null && numeric(delta.after_value) != null;
        const response = comparable ? Number(delta.after_value) - Number(delta.before_value) : null;
        associations.get(evidenceKey).observations.push({
          case_id: repairCase.id, serial_number: repairCase.serial_number, attempt_number: attempt.attempt_number,
          repair_date: attempt.repair_date, before_measurement: before, after_measurement: after,
          measurement_delta: movement, before_test: numeric(delta.before_value),
          after_test: comparable ? numeric(delta.after_value) : null, test_delta: response,
          outcome: delta.after_status || 'MISSING', overall_outcome: attempt.outcome, multi_change: multi,
        });
      }
    }
  }
  const evidence = [...associations.values()].map((group) => {
    const rows = group.observations;
    const measured = rows.filter((row) => row.test_delta != null);
    const corrected = rows.filter((row) => row.outcome === 'PASS').length;
    return { ...group, samples: rows.length, corrected, correction_pct: pct(corrected, rows.length),
      measured_samples: measured.length, mean_test_delta: mean(measured.map((row) => row.test_delta)),
      multi_change: rows.filter((row) => row.multi_change).length };
  }).sort((a, b) => b.samples - a.samples || a.key.localeCompare(b.key));
  const coverageScope = scope('t', 'test_datetime', { part_number: config.part_number }, true);
  const coverage = db.get(`SELECT MIN(substr(test_datetime,1,10)) AS first_test, MAX(substr(test_datetime,1,10)) AS last_test,
    COUNT(*) AS available_tests FROM injector_test_reports t WHERE ${coverageScope.sql}`, coverageScope.params);
  const parts = db.all(`SELECT DISTINCT TRIM(part_number) AS part FROM injector_test_reports
    WHERE part_number IS NOT NULL AND TRIM(part_number) != ''
    UNION SELECT DISTINCT TRIM(part_number) FROM injector_repair_cases WHERE part_number IS NOT NULL AND TRIM(part_number) != '' ORDER BY 1`);
  const report = {
    filters: config, generated_at: new Date().toISOString(), last_sync: getSetting('carbonzapp_last_sync'), coverage,
    parts: parts.map((row) => row.part),
    testing: { test_runs: tests.length, unique_injectors: unique.size, missing_serial_tests: missingSerial,
      outcomes: testOutcomes, first_outcomes: first, latest_outcomes: latest,
      test_pass_pct: pct(testOutcomes.PASS, tests.length), test_fail_pct: pct(testOutcomes.FAIL, tests.length),
      first_pass_pct: pct(first.PASS, unique.size), first_fail_pct: pct(first.FAIL, unique.size),
      needing_repair: failed, needing_repair_pct: pct(failed, unique.size), tracked_failed_injectors: tracked.size,
      tracked_failed_pct: pct(tracked.size, failed) },
    trend: [...trend.values()].sort((a, b) => a.period.localeCompare(b.period)).map((row) => ({ ...row, injectors: row.injectors.size })),
    repairs: { cases: cases.length, unique_injectors: new Set(cases.map(identity)).size, dispositions,
      attempts: attempts.length, completed_attempts: completed.length, pending_retests: attempts.length - completed.length,
      passed_attempts: attemptPasses, attempt_pass_pct: pct(attemptPasses, completed.length),
      passed_cases: successfulAttempts.length, passed_after_one: passedOne, first_retested_cases: firstRetested,
      injectors_passed_after_one: injectorsPassedOne.size,
      first_repair_pass_pct: pct(passedOne, firstRetested), avg_attempts_to_pass: mean(successfulAttempts),
      attempts_to_pass: [...distribution].sort((a, b) => a[0] - b[0]).map(([attempts, cases]) => ({ attempts, cases })) },
    actions: [...actions.values()].map((row) => ({ ...row, pass_pct: pct(row.passed, row.completed) }))
      .sort((a, b) => b.completed - a.completed || a.key.localeCompare(b.key)),
    evidence,
    cases: cases.map((row) => ({ id: row.id, part_number: row.part_number, serial_number: row.serial_number,
      initial_test_datetime: row.initial_test_datetime, status: row.status, closed_at: row.closed_at,
      attempts: (attemptsByCase.get(row.id) || []).length,
      pending: (attemptsByCase.get(row.id) || []).some((attempt) => attempt.status === 'WAITING_RETEST') })),
  };
  if (includeDetails) report.details = { tests, attempts, changes, deltas };
  return report;
}

const DEFINITIONS = [
  ['Test window', 'Inclusive bench calendar dates. Test runs count each report/slot; unique injectors use case-insensitive, trimmed part + serial. Missing serials count only as test runs.'],
  ['Pass / fail percentages', 'All test-run outcomes, including DNF and Unknown, are in the denominator. First-test percentages use each injector\'s earliest test in the selected window, not its lifetime first test.'],
  ['Needing repair', 'Unique injectors with at least one FAIL in the test window / unique injectors tested. A later pass does not erase the earlier repair need. DNF alone is not assumed to require repair.'],
  ['Repair cohort', 'Cases whose initial failed test occurred in the selected window. All subsequent attempts/outcomes are included through report generation, even outside the window.'],
  ['Average attempts to pass', 'Attempt number of the passing retest, averaged only across passed cases in the cohort. Open, held, scrapped and untested cases are excluded.'],
  ['First repair pass rate', 'Cases that passed on attempt 1 / cases whose first attempt has a linked retest. Pending first retests are excluded. Counts represent repair episodes; a serial can have multiple episodes.'],
  ['Attempt pass rate', 'Completed attempts with an overall PASS / all attempts with a linked retest. Pending retests are excluded; DNF and Unknown retests are not passes.'],
  ['No linked retest', 'Attempts without a linked test result, including attempts in held or scrapped cases. No success or failure is inferred for these attempts.'],
  ['Failure / adjustment associations', 'Groups share part, component, parameter, action, adjustment direction, measurement unit, test point, high/low failure direction, recorded baseline specification and test unit. A sample is one attempt per group. A corrected point has after status PASS.'],
  ['Interpretation', 'Observed associations do not establish causality. Multiple simultaneous adjustments and unrecorded bench-condition/specification changes can affect outcomes. DNF, unknown and missing retest values are excluded from numeric means and scatter plots.'],
  ['Coverage', 'Test volumes use the currently synced CarbonZapp cache and can change after Clear All/resync. Repair evidence is permanent. Repair snapshots are not mixed into cache totals. Serial prefixes R and RMA bench jobs follow existing test-list exclusions.'],
];

async function buildInjectorAnalyticsWorkbook(input) {
  const report = buildInjectorAnalytics(input, true);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PDI QMS';
  const sheet = (name, rows) => {
    const ws = workbook.addWorksheet(name);
    if (!rows.length) { ws.addRow(['No data for these filters']); return; }
    const columns = Object.keys(rows[0]);
    ws.columns = columns.map((key) => ({ header: key.replace(/_/g, ' '), key, width: 24 }));
    rows.forEach((row) => ws.addRow(row));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2B4F' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
  };
  const summary = [];
  for (const [section, values] of [['Testing', report.testing], ['Repairs', report.repairs]]) {
    for (const [metric, value] of Object.entries(values)) {
      if (Array.isArray(value)) continue;
      if (value != null && typeof value === 'object') {
        for (const [label, count] of Object.entries(value)) summary.push({ section, metric: `${metric}_${label}`, value: count });
      } else summary.push({ section, metric, value });
    }
  }
  sheet('Summary', summary);
  sheet('Definitions', [
    { metric: 'Generated at', definition: report.generated_at },
    { metric: 'Filters', definition: JSON.stringify(report.filters) },
    { metric: 'Source coverage', definition: JSON.stringify(report.coverage) },
    ...DEFINITIONS.map(([metric, definition]) => ({ metric, definition })),
  ]);
  sheet('Test trend', report.trend);
  sheet('Attempts to pass', report.repairs.attempts_to_pass);
  sheet('Repair cases', report.cases);
  sheet('Adjustments', report.actions.map(({ key, ...row }) => row));
  sheet('Failure associations', report.evidence.map(({ key, observations, ...row }) => row));
  sheet('Observed changes', report.evidence.flatMap((group) => group.observations.map((row) => ({
    part_number: group.part_number, parameter: group.parameter, direction: group.direction,
    failure: group.failure,
    measurement_unit: group.measurement_unit, test_point: group.step, test_unit: group.test_unit,
    spec_min: group.spec_min, spec_max: group.spec_max, ...row,
  }))));
  sheet('Test runs', report.details.tests);
  sheet('Repair attempts', report.details.attempts);
  sheet('Measurements', report.details.changes);
  sheet('Test evidence', report.details.deltas);
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildInjectorAnalytics, buildInjectorAnalyticsWorkbook, DEFINITIONS };
