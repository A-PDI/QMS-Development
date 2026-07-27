'use strict';
/**
 * Shipment-evaluation analytics.
 *
 * Covers requirement scenarios 11–14: failure counts by test point are correct;
 * only fully passing injectors take part in the consistency calculation;
 * missing/errored IVM measurements are handled safely; and a zero mean never
 * causes an error.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  injectorOutcome,
  percentage,
  summarise,
  failuresByTestPoint,
  consistencyOfPassingInjectors,
  evaluateShipment,
} = require('../services/injectorEvaluation');

/** Build a normalised injector record directly (no bench round-trip needed). */
function injector({ serial = 'SN', job = 'QMS-1', part = 'PN-1', steps = [] }) {
  return {
    id: serial,
    serial_number: serial,
    job_number: job,
    part_number: part,
    test_datetime: '2026-06-30T10:00:00Z',
    tests: steps.map((s) => ({
      name: s.name,
      raw_name: s.errored ? `${s.name} : ${s.errorRaw || 'HP ERROR (out of range) #1000'}` : s.name,
      status: s.errored ? 'fail' : (s.status || 'pass'),
      errored: !!s.errored,
      error_description: s.errored ? 'Out of Range' : '',
      error_raw: s.errored ? (s.errorRaw || 'HP ERROR (out of range) #1000') : '',
      internal: /^FL/i.test(s.name),
      primary: s.noTank ? null : {
        tank_name: '',
        unit: 'mm3/STRK',
        spec: '10.0 +/- 2.0',
        average: s.errored ? 'Error: Out of Range' : (s.value === undefined ? '' : String(s.value)),
        status: s.errored ? 'fail' : (s.status || 'pass'),
      },
      secondary: null,
    })),
  };
}

const flowSteps = (values, extra = {}) => Object.entries(values).map(([code, value]) => ({
  name: code.replace('IVM', 'iVM.'),
  value,
  ...(extra[code] || {}),
}));

// ── Outcome + percentages ────────────────────────────────────────────────────
test('an injector with any failing or errored step is a failure', () => {
  const pass = injector({ serial: 'A', steps: flowSteps({ IVM01: 10, IVM02: 20 }) });
  const failed = injector({ serial: 'B', steps: [
    { name: 'iVM.01', value: 10 },
    { name: 'iVM.02', value: 99, status: 'fail' },
  ] });
  const errored = injector({ serial: 'C', steps: [
    { name: 'iVM.01', value: 10 },
    { name: 'iVM.06', errored: true },
  ] });

  assert.strictEqual(injectorOutcome(pass), 'pass');
  assert.strictEqual(injectorOutcome(failed), 'fail');
  assert.strictEqual(injectorOutcome(errored), 'fail');
});

test('percentages never divide by zero', () => {
  assert.strictEqual(percentage(0, 0), 0);
  assert.strictEqual(percentage(5, 0), 0);
  assert.strictEqual(percentage(1, 4), 25);

  const empty = summarise([]);
  assert.strictEqual(empty.total, 0);
  assert.strictEqual(empty.passPct, 0);
  assert.strictEqual(empty.failPct, 0);
});

test('summary counts pass/fail and their percentages', () => {
  const list = [
    ...Array.from({ length: 25 }, (_, i) => injector({ serial: `P${i}`, steps: flowSteps({ IVM01: 10 }) })),
    ...Array.from({ length: 5 }, (_, i) => injector({
      serial: `F${i}`,
      steps: [{ name: 'iVM.01', value: 99, status: 'fail' }],
    })),
  ];
  const s = summarise(list);

  assert.strictEqual(s.total, 30);
  assert.strictEqual(s.passed, 25);
  assert.strictEqual(s.failed, 5);
  assert.ok(Math.abs(s.passPct - 83.3333) < 0.001);
  assert.ok(Math.abs(s.failPct - 16.6667) < 0.001);
  assert.deepStrictEqual(s.jobNumbers, ['QMS-1']);
  assert.deepStrictEqual(s.partNumbers, ['PN-1']);
});

// ── Scenario 11: failure counts by test point ────────────────────────────────
test('counts how many injectors failed each test point, ranked', () => {
  // 30 injectors: 25 pass; 3 fail test point 1; 2 fail test point 2;
  // 1 of those also fails test point 3 (an injector can fail several points).
  const list = [];
  for (let i = 0; i < 25; i += 1) {
    list.push(injector({ serial: `P${i}`, steps: flowSteps({ IVM01: 10, IVM02: 20, IVM03: 30 }) }));
  }
  for (let i = 0; i < 3; i += 1) {
    list.push(injector({ serial: `F1-${i}`, steps: [
      { name: 'iVM.01', value: 99, status: 'fail' },
      { name: 'iVM.02', value: 20 },
      { name: 'iVM.03', value: 30 },
    ] }));
  }
  for (let i = 0; i < 2; i += 1) {
    list.push(injector({ serial: `F2-${i}`, steps: [
      { name: 'iVM.01', value: 10 },
      { name: 'iVM.02', value: 99, status: 'fail' },
      { name: 'iVM.03', value: i === 0 ? 30 : 99, status: i === 0 ? 'pass' : 'fail' },
    ] }));
  }

  const failures = failuresByTestPoint(list);
  const byCode = Object.fromEntries(failures.map((f) => [f.code, f]));

  assert.strictEqual(byCode.IVM01.count, 3);
  assert.strictEqual(byCode.IVM02.count, 2);
  assert.strictEqual(byCode.IVM03.count, 1);
  assert.strictEqual(byCode.IVM01.label, 'Peak HP', 'uses the mapped display name');
  // Ranked most → least common.
  assert.deepStrictEqual(failures.filter((f) => f.count > 0).map((f) => f.code), ['IVM01', 'IVM02', 'IVM03']);
  // Counts may exceed the number of failed injectors (5 failed, 6 point-failures).
  assert.strictEqual(failures.reduce((a, f) => a + f.count, 0), 6);
  assert.strictEqual(summarise(list).failed, 5);
});

test('an errored step counts as a failure of that test point', () => {
  const list = [
    injector({ serial: 'A', steps: flowSteps({ IVM01: 10, IVM06: 60 }) }),
    injector({ serial: 'B', steps: [{ name: 'iVM.01', value: 10 }, { name: 'iVM.06', errored: true }] }),
  ];
  const failures = failuresByTestPoint(list);
  const ivm06 = failures.find((f) => f.code === 'IVM06');

  assert.strictEqual(ivm06.count, 1);
  assert.strictEqual(ivm06.label, 'Peak Torque', 'the error does not rename the test point');
});

// ── Scenario 12: consistency uses only fully passing injectors ───────────────
test('consistency includes only injectors that passed the complete test', () => {
  const list = [
    injector({ serial: 'P1', steps: flowSteps({ IVM01: 9 }) }),
    injector({ serial: 'P2', steps: flowSteps({ IVM01: 11 }) }),
    // Fails a DIFFERENT test point → excluded from every consistency figure.
    injector({ serial: 'F1', steps: [
      { name: 'iVM.01', value: 1000 },
      { name: 'iVM.02', value: 99, status: 'fail' },
    ] }),
  ];

  const [ivm01] = consistencyOfPassingInjectors(list, ['IVM01']);
  assert.strictEqual(ivm01.sampleCount, 2, 'only the two passing injectors are measured');
  assert.strictEqual(ivm01.mean, 10, 'the failing injector\'s 1000 is excluded');
  assert.strictEqual(ivm01.avgDeviationPct, 10, '|9-10|/10 and |11-10|/10 → 10%');
  assert.strictEqual(ivm01.insufficient, false);
});

test('average absolute percentage deviation matches the documented formula', () => {
  const values = [96, 98, 100, 102, 104];
  const list = values.map((v, i) => injector({ serial: `P${i}`, steps: flowSteps({ IVM03: v }) }));

  const [point] = consistencyOfPassingInjectors(list, ['IVM03']);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const expected = values.reduce((a, v) => a + Math.abs((v - mean) / mean) * 100, 0) / values.length;

  assert.strictEqual(point.mean, mean);
  assert.ok(Math.abs(point.avgDeviationPct - expected) < 1e-12, 'full precision is preserved');
  assert.strictEqual(point.label, 'Low Idle');
});

// ── Scenario 13: missing / errored measurements ──────────────────────────────
test('missing or errored measurements are excluded from that test point only', () => {
  const list = [
    injector({ serial: 'A', steps: flowSteps({ IVM01: 10, IVM02: 20 }) }),
    injector({ serial: 'B', steps: flowSteps({ IVM01: 10, IVM02: 22 }) }),
    // Valid at IVM02 but has no IVM01 measurement at all.
    injector({ serial: 'C', steps: [{ name: 'iVM.01', value: undefined }, { name: 'iVM.02', value: 24 }] }),
  ];

  const [ivm01, ivm02] = consistencyOfPassingInjectors(list, ['IVM01', 'IVM02']);
  assert.strictEqual(ivm01.sampleCount, 2, 'the missing value is skipped');
  assert.strictEqual(ivm01.excludedCount, 1);
  assert.strictEqual(ivm02.sampleCount, 3, 'the same injector still counts at IVM02');
});

test('a test point with no usable measurements is flagged, not zeroed', () => {
  const list = [injector({ serial: 'A', steps: flowSteps({ IVM02: 20 }) })];
  const [ivm01] = consistencyOfPassingInjectors(list, ['IVM01']);

  assert.strictEqual(ivm01.sampleCount, 0);
  assert.strictEqual(ivm01.avgDeviationPct, null);
  assert.strictEqual(ivm01.insufficient, true);
  assert.match(ivm01.note, /No valid measurements/i);
});

test('a single measurement is reported as insufficient for consistency', () => {
  const list = [injector({ serial: 'A', steps: flowSteps({ IVM01: 10 }) })];
  const [ivm01] = consistencyOfPassingInjectors(list, ['IVM01']);

  assert.strictEqual(ivm01.sampleCount, 1);
  assert.strictEqual(ivm01.insufficient, true);
  assert.match(ivm01.note, /one valid measurement/i);
});

// ── Scenario 14: zero mean ───────────────────────────────────────────────────
test('a zero mean does not divide by zero', () => {
  const list = [
    injector({ serial: 'A', steps: flowSteps({ IVM04: 0 }) }),
    injector({ serial: 'B', steps: flowSteps({ IVM04: 0 }) }),
  ];
  const [ivm04] = consistencyOfPassingInjectors(list, ['IVM04']);

  assert.strictEqual(ivm04.mean, 0);
  assert.strictEqual(ivm04.avgDeviationPct, null);
  assert.strictEqual(ivm04.insufficient, true);
  assert.match(ivm04.note, /zero/i);
});

test('IVM code formatting variations are normalised before analysis', () => {
  const list = [
    injector({ serial: 'A', steps: [{ name: 'IVM1', value: 10 }] }),
    injector({ serial: 'B', steps: [{ name: 'iVM.01', value: 12 }] }),
    injector({ serial: 'C', steps: [{ name: 'IVM 01', value: 14 }] }),
  ];
  const [ivm01] = consistencyOfPassingInjectors(list, ['IVM01']);
  assert.strictEqual(ivm01.sampleCount, 3, 'all three spellings map to IVM01');
  assert.strictEqual(ivm01.mean, 12);
});

// ── Whole-report roll-up ─────────────────────────────────────────────────────
test('evaluateShipment returns summary, failures and consistency together', () => {
  const list = [
    injector({ serial: 'A', steps: flowSteps({ IVM01: 10, IVM06: 60 }) }),
    injector({ serial: 'B', steps: flowSteps({ IVM01: 12, IVM06: 62 }) }),
    injector({ serial: 'C', steps: [{ name: 'iVM.01', value: 99, status: 'fail' }, { name: 'iVM.06', value: 60 }] }),
  ];
  const result = evaluateShipment(list);

  assert.strictEqual(result.summary.total, 3);
  assert.strictEqual(result.summary.passed, 2);
  assert.strictEqual(result.failures.find((f) => f.code === 'IVM01').count, 1);
  assert.strictEqual(result.consistency.length, 6, 'one row per IVM test point');
  assert.ok(result.consistencyOverall, 'group roll-up is available for the chart caption');
  assert.deepStrictEqual(result.outcomes.map((o) => o.outcome), ['pass', 'pass', 'fail']);
});

test('an empty selection produces a safe, empty evaluation', () => {
  const result = evaluateShipment([]);
  assert.strictEqual(result.summary.total, 0);
  assert.strictEqual(result.failures.length, 0);
  assert.strictEqual(result.consistencyOverall, null);
  assert.ok(result.consistency.every((c) => c.insufficient));
});
