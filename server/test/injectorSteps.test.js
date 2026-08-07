'use strict';
/**
 * Test-step naming and error handling.
 *
 * Covers requirement scenarios 1–3: a valid result keeps its step name and
 * value; an out-of-range result keeps the step name and shows the named
 * condition ("Excess Return"); and different API error messages never change
 * the step name.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  normaliseStepCode,
  splitStepName,
  stepDisplayName,
  formatErrorDescription,
  formatErrorValue,
  stepErrorInfo,
  stepLabel,
  stepResultValue,
  isErrorValue,
  numericValue,
  isFlushStep,
} = require('../services/injectorSteps');
const { normaliseTests, mapReportToInjector } = require('../services/carbonzapp');

// ── Step-code normalisation ──────────────────────────────────────────────────
test('normalises the formatting variations of a test-step code', () => {
  for (const variant of ['IVM01', 'iVM.01', 'IVM 01', 'ivm1', 'iVm-01', 'IVM.1']) {
    assert.strictEqual(normaliseStepCode(variant), 'IVM01', `variant: ${variant}`);
  }
  assert.strictEqual(normaliseStepCode('iVM.06'), 'IVM06');
  assert.strictEqual(normaliseStepCode('eRL'), 'ERL');
  assert.strictEqual(normaliseStepCode('Warm Up'), 'WARMUP');
  assert.strictEqual(normaliseStepCode('FL(W)'), 'FLW');
  // The error suffix must not leak into the code.
  assert.strictEqual(normaliseStepCode('iVM.06 : HP ERROR (out of range) #1000'), 'IVM06');
});

test('IVM06 displays as Peak Torque regardless of the result', () => {
  assert.strictEqual(stepDisplayName('iVM.06'), 'Peak Torque');
  assert.strictEqual(stepDisplayName('IVM06'), 'Peak Torque');
  assert.strictEqual(stepDisplayName('iVM.06 : HP ERROR (out of range) #1000'), 'Peak Torque');
  assert.strictEqual(stepDisplayName('iVM.06 : SKIPPED'), 'Peak Torque');
});

test('leak test steps display their specified test pressure', () => {
  assert.strictEqual(stepDisplayName('LKT.01'), 'Leak Test 200 bar');
  assert.strictEqual(stepDisplayName('LKT.02'), 'Leak Test 1800 bar');
  assert.strictEqual(stepDisplayName('LKT.04'), 'Leak Test 2400 bar');
  assert.strictEqual(stepDisplayName('lkt4'), 'Leak Test 2400 bar');
});

test('unmapped steps fall back to the code, never to the error text', () => {
  assert.strictEqual(stepDisplayName('XYZ.09'), 'XYZ.09');
  assert.strictEqual(stepDisplayName('XYZ.09 : HP ERROR (out of range)'), 'XYZ.09');
});

test('the return tank keeps its [R] suffix', () => {
  assert.strictEqual(stepDisplayName('iVM.01', 'primary', '[R]'), 'Peak HP [R]');
  assert.strictEqual(stepDisplayName('iVM.01', 'primary', '[D]'), 'Peak HP');
  // eRL reports two different measurements rather than one with a suffix.
  assert.strictEqual(stepDisplayName('eRL', 'primary'), 'Resistance');
  assert.strictEqual(stepDisplayName('eRL', 'secondary'), 'Inductance');
});

// ── Error parsing ────────────────────────────────────────────────────────────
test('splits a bench name into step code and error description', () => {
  const parsed = splitStepName('iVM.06 : HP ERROR (out of range) #1000');
  assert.strictEqual(parsed.base, 'iVM.06');
  assert.ok(parsed.errored);
  // The untouched API text is preserved.
  assert.strictEqual(parsed.errorRaw, 'HP ERROR (out of range) #1000');

  const skipped = splitStepName('eRL : SKIPPED');
  assert.strictEqual(skipped.base, 'eRL');
  assert.ok(skipped.skipped);
  assert.ok(!skipped.errored);
});

test('formats API error descriptions for display', () => {
  // An out-of-range result is the known EXCESS RETURN condition, so it is named
  // rather than reported as a generic error.
  assert.strictEqual(formatErrorDescription('HP ERROR (out of range) #1000'), 'Excess Return');
  assert.strictEqual(formatErrorDescription('LP ERROR (Out Of Range)'), 'Excess Return');
  assert.strictEqual(formatErrorValue('Excess Return'), 'Excess Return', 'no "Error:" prefix on a named condition');

  // Machine faults keep the API wording behind the "Error:" prefix.
  assert.strictEqual(formatErrorDescription('ERROR: Communication Failure'), 'Communication Failure');
  assert.strictEqual(formatErrorDescription('Invalid Measurement'), 'Invalid Measurement');
  assert.strictEqual(formatErrorDescription('(timeout)'), 'Timeout');
  assert.strictEqual(formatErrorDescription(''), 'Test Error');
  assert.strictEqual(formatErrorValue('Communication Failure'), 'Error: Communication Failure');
});

test('different API errors never change the test-step name', () => {
  const errors = [
    'HP ERROR (out of range) #1000',
    'ERROR: Communication Failure',
    'Invalid Measurement',
    'ERROR (timeout) #77',
  ];
  const expectedValues = [
    'Excess Return',
    'Error: Communication Failure',
    'Error: Invalid Measurement',
    'Error: Timeout',
  ];
  errors.forEach((errText, i) => {
    const step = { name: 'iVM.06', raw_name: `iVM.06 : ${errText}` };
    assert.strictEqual(stepLabel(step), 'Peak Torque', `step name changed for: ${errText}`);
    assert.strictEqual(stepResultValue(step, { average: '' }), expectedValues[i]);
    assert.strictEqual(stepErrorInfo(step).raw, errText, 'original API description not preserved');
  });
});

test('a valid result keeps its numeric value', () => {
  const step = { name: 'iVM.06', raw_name: 'iVM.06', errored: false };
  assert.strictEqual(stepLabel(step), 'Peak Torque');
  assert.strictEqual(stepResultValue(step, { average: '224.5' }), '224.5');
  assert.strictEqual(numericValue('224.5'), 224.5);
  assert.strictEqual(isErrorValue('224.5'), false);
  assert.strictEqual(isErrorValue('Error: Communication Failure'), true);
  assert.strictEqual(isErrorValue('Excess Return'), true, 'a named condition is an error value, not a number');
  assert.strictEqual(numericValue('Excess Return'), null);
});

test('the internal FL(W) flush step is recognised', () => {
  assert.ok(isFlushStep('FL(W)'));
  assert.ok(isFlushStep({ raw_name: 'FL(W) : SKIPPED' }));
  assert.ok(!isFlushStep('iVM.01'));
});

// ── End-to-end through the sync normaliser ───────────────────────────────────
function benchReport(overrides = {}) {
  return {
    _id: 'report-1',
    actuator_code: '6513589PX',
    datetime: '2026-06-30T13:40:56+00:00',
    SlotsData: { position: 0, sn: 'SN001' },
    AllTests: [
      {
        TestInfo: { test_name: 'iVM.01', test_order: 1, status: 4 },
        PrimaryTank: {
          tank_name: '', tank_unit: 'mm3/STRK', text_green: '230.0 +/- 10.0',
          min_green: '220.0', max_green: '240.0', AvrResult: '231.5', results: '231.5',
        },
      },
      {
        TestInfo: { test_name: overrides.step6Name || 'iVM.06', test_order: 2, status: 4 },
        PrimaryTank: {
          tank_name: '', tank_unit: 'mm3/STRK', text_green: '255.0 +/- 21.0',
          min_green: '234.0', max_green: '276.0', AvrResult: overrides.step6Value ?? '260.0',
        },
      },
    ],
  };
}

test('sync keeps the step name and moves the error into the value', () => {
  const tests = normaliseTests(benchReport({ step6Name: 'iVM.06 : HP ERROR (out of range) #1000', step6Value: '' }));
  const step = tests.find((t) => normaliseStepCode(t.name) === 'IVM06');

  assert.strictEqual(step.name, 'iVM.06', 'step name must not contain the error text');
  assert.strictEqual(step.display_name, 'Peak Torque');
  assert.ok(step.errored);
  assert.strictEqual(step.error_description, 'Excess Return');
  assert.strictEqual(step.error_raw, 'HP ERROR (out of range) #1000', 'the API text is preserved');
  assert.strictEqual(step.primary.average, 'Excess Return');
  assert.strictEqual(step.status, 'fail');

  // A valid step in the same report is unaffected.
  const ok = tests.find((t) => normaliseStepCode(t.name) === 'IVM01');
  assert.strictEqual(ok.display_name, 'Peak HP');
  assert.strictEqual(ok.primary.average, '231.5');
  assert.strictEqual(ok.status, 'pass');
});

test('an errored step fails the injector overall', () => {
  const good = mapReportToInjector(benchReport());
  assert.strictEqual(good.overall_pass, 1);
  assert.strictEqual(good.steps_failed, 0);

  const bad = mapReportToInjector(benchReport({ step6Name: 'iVM.06 : HP ERROR (out of range) #1000', step6Value: '' }));
  assert.strictEqual(bad.overall_pass, 0);
  assert.strictEqual(bad.steps_failed, 1);
});
