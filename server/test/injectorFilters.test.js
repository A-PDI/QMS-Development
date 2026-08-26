'use strict';
/**
 * Granular filtering of injector test records: multi-value part/serial/result
 * criteria, and the test-step outcome filter that answers "which injectors
 * failed THIS test point?".
 */

const test = require('node:test');
const assert = require('node:assert');

require('./helpers/testEnv');
const { benchReport } = require('./helpers/benchData');
const { normaliseTests } = require('../services/carbonzapp');
const { injectorScorecard } = require('../services/injectorResult');
const {
  parseList,
  normaliseCriteria,
  measurementPoints,
  stepCatalog,
  matchesStepCriteria,
  matchedStepLabels,
  filterInjectors,
  needsStepData,
} = require('../services/injectorFilters');

/** A hydrated injector, exactly as the routes and exporters see one. */
function injector(opts = {}) {
  const report = benchReport(opts);
  const tests = normaliseTests(report);
  const scorecard = injectorScorecard({ tests });
  return {
    id: opts.id || `inj-${opts.serial || 'SN001'}`,
    part_number: report.actuator_code,
    serial_number: report.SlotsData.sn,
    brand: report.actuator_Brand,
    test_datetime: report.datetime,
    result_status: scorecard.outcome,
    overall_pass: scorecard.overallPass,
    steps_total: scorecard.stepsTotal,
    steps_passed: scorecard.stepsPassed,
    steps_failed: scorecard.stepsFailed,
    tests,
  };
}

// A passing injector, one that fails Peak Torque - Return (excess return), one
// that fails Peak HP, and one the bench interrupted at Peak Torque (DNF).
const PASSING = injector({ serial: 'SN001', datetime: '2026-06-01T08:00:00+00:00' });
const FAILS_RETURN = injector({
  serial: 'SN002', flow: { IVM06_RETURN: 120 }, datetime: '2026-06-02T08:00:00+00:00',
});
const FAILS_PEAK_HP = injector({
  serial: 'SN003', part: '0445120067', flow: { IVM01: 40 }, datetime: '2026-06-03T08:00:00+00:00',
});
const INTERRUPTED = injector({
  serial: 'SN004', errorOn: 'IVM06', flow: { IVM06: 0, IVM06_RETURN: 0 },
  datetime: '2026-06-04T08:00:00+00:00',
});
const ALL = [PASSING, FAILS_RETURN, FAILS_PEAK_HP, INTERRUPTED];

const serials = (list) => list.map((i) => i.serial_number);

// ── Value lists ─────────────────────────────────────────────────────────────
test('a filter box splits on commas, spaces, newlines and pipes', () => {
  assert.deepStrictEqual(parseList('SN001, SN002'), ['SN001', 'SN002']);
  assert.deepStrictEqual(parseList('SN001 SN002\nSN003|SN004;SN005'), ['SN001', 'SN002', 'SN003', 'SN004', 'SN005']);
  assert.deepStrictEqual(parseList(['SN001', ' SN002 ']), ['SN001', 'SN002']);
  assert.deepStrictEqual(parseList('SN001, sn001'), ['SN001'], 'duplicates are dropped case-insensitively');
  assert.deepStrictEqual(parseList(''), []);
  assert.deepStrictEqual(parseList(null), []);
});

test('criteria normalise both the query-string and the camelCase spelling', () => {
  const fromQuery = normaliseCriteria({
    part_number: '6513589PX,0445120067',
    serial_number: 'SN001 SN002',
    status: 'failed',
    date_from: '2026-06-01',
    steps: 'ivm06-r',
    step_status: 'Failed',
    step_match: 'ALL',
  });
  assert.deepStrictEqual(fromQuery.partNumbers, ['6513589PX', '0445120067']);
  assert.deepStrictEqual(fromQuery.serialNumbers, ['SN001', 'SN002']);
  assert.deepStrictEqual(fromQuery.statuses, ['fail']);
  assert.strictEqual(fromQuery.dateFrom, '2026-06-01');
  assert.deepStrictEqual(fromQuery.steps, ['IVM06-R']);
  assert.strictEqual(fromQuery.stepStatus, 'fail');
  assert.strictEqual(fromQuery.stepMatch, 'all');

  const empty = normaliseCriteria({});
  assert.deepStrictEqual(empty.steps, []);
  assert.strictEqual(empty.stepMatch, 'any');
  assert.strictEqual(empty.stepStatus, 'fail', 'the step filter defaults to failures');
});

// ── Measurement points ──────────────────────────────────────────────────────
test('Peak Torque contributes two independently judged measurement points', () => {
  const points = measurementPoints(FAILS_RETURN);
  assert.deepStrictEqual(points.map((p) => p.code), ['IVM01', 'IVM06-D', 'IVM06-R']);
  assert.deepStrictEqual(points.map((p) => p.label), ['Peak HP', 'Peak Torque - Delivery', 'Peak Torque - Return']);
  assert.deepStrictEqual(points.map((p) => p.outcome), ['pass', 'pass', 'fail']);
});

test('the internal flush step is never a measurement point', () => {
  assert.ok(measurementPoints(PASSING).every((p) => p.code !== 'FLW'));
});

test('the step catalog counts pass/fail/dnf per point, in bench test order', () => {
  const catalog = stepCatalog(ALL);
  assert.deepStrictEqual(catalog.map((s) => s.code), ['IVM01', 'IVM06-D', 'IVM06-R']);

  const byCode = Object.fromEntries(catalog.map((s) => [s.code, s]));
  assert.strictEqual(byCode.IVM01.total, 4);
  assert.strictEqual(byCode.IVM01.fail, 1, 'only SN003 fails Peak HP');
  assert.strictEqual(byCode['IVM06-R'].fail, 1, 'only SN002 fails Peak Torque - Return');
  assert.strictEqual(byCode['IVM06-D'].dnf, 1, 'the interrupted injector did not finish Peak Torque');
});

// ── Step criteria ───────────────────────────────────────────────────────────
test('a step filter selects the injectors that failed that exact point', () => {
  const criteria = normaliseCriteria({ steps: 'IVM06-R', step_status: 'fail' });
  assert.deepStrictEqual(serials(filterInjectors(ALL, criteria)), ['SN002']);
  assert.deepStrictEqual(matchedStepLabels(FAILS_RETURN, criteria), ['Peak Torque - Return']);
  assert.deepStrictEqual(matchedStepLabels(PASSING, criteria), [], 'a non-match explains nothing');
});

test('several steps match on ANY of them by default and on ALL on request', () => {
  const any = normaliseCriteria({ steps: 'IVM01,IVM06-R', step_status: 'fail' });
  assert.deepStrictEqual(serials(filterInjectors(ALL, any)), ['SN002', 'SN003']);

  const all = normaliseCriteria({ steps: 'IVM01,IVM06-R', step_status: 'fail', step_match: 'all' });
  assert.deepStrictEqual(serials(filterInjectors(ALL, all)), [], 'no injector fails both points');

  const bothFail = injector({ serial: 'SN005', flow: { IVM01: 40, IVM06_RETURN: 120 } });
  assert.deepStrictEqual(serials(filterInjectors([...ALL, bothFail], all)), ['SN005']);
});

test('the step filter also selects passes, DNFs and "was tested at all"', () => {
  const passed = normaliseCriteria({ steps: 'IVM06-R', step_status: 'pass' });
  assert.deepStrictEqual(serials(filterInjectors(ALL, passed)), ['SN001', 'SN003']);

  const dnf = normaliseCriteria({ steps: 'IVM06-D', step_status: 'dnf' });
  assert.deepStrictEqual(serials(filterInjectors(ALL, dnf)), ['SN004']);

  const tested = normaliseCriteria({ steps: 'IVM01', step_status: 'any' });
  assert.deepStrictEqual(serials(filterInjectors(ALL, tested)), ['SN001', 'SN002', 'SN003', 'SN004']);
});

test('an unknown step code matches nothing rather than everything', () => {
  assert.deepStrictEqual(serials(filterInjectors(ALL, { steps: 'NOSUCHSTEP' })), []);
});

test('no step criteria means the step filter is not applied at all', () => {
  assert.ok(matchesStepCriteria(PASSING, normaliseCriteria({})));
  assert.strictEqual(needsStepData(normaliseCriteria({ part_number: '6513589PX' })), false);
  assert.strictEqual(needsStepData(normaliseCriteria({ steps: 'IVM01' })), true);
});

// ── Row criteria ────────────────────────────────────────────────────────────
test('part and serial filters accept several values and match any of them', () => {
  assert.deepStrictEqual(serials(filterInjectors(ALL, { part_number: '0445120067' })), ['SN003']);
  assert.deepStrictEqual(
    serials(filterInjectors(ALL, { part_number: '6513589PX, 0445120067' })),
    ['SN001', 'SN002', 'SN003', 'SN004']
  );
  assert.deepStrictEqual(serials(filterInjectors(ALL, { serial_number: 'SN002 SN004' })), ['SN002', 'SN004']);
});

test('result, date-range and step criteria combine into one selection', () => {
  const criteria = {
    part_number: '6513589PX',
    serial_number: 'SN001,SN002,SN003',
    status: 'fail',
    date_from: '2026-06-02',
    steps: 'IVM06-R',
    step_status: 'fail',
  };
  assert.deepStrictEqual(serials(filterInjectors(ALL, criteria)), ['SN002']);

  // Any single criterion that excludes the record excludes the whole match.
  assert.deepStrictEqual(serials(filterInjectors(ALL, { ...criteria, date_from: '2026-06-03' })), []);
  assert.deepStrictEqual(serials(filterInjectors(ALL, { ...criteria, status: 'pass' })), []);
});

test('several result statuses can be selected at once', () => {
  assert.deepStrictEqual(serials(filterInjectors(ALL, { status: 'fail,dnf' })), ['SN002', 'SN003', 'SN004']);
});
