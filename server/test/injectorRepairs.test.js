'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { db, resetInjectorData } = require('./helpers/testEnv');
const { benchReport } = require('./helpers/benchData');
const carbonzapp = require('../services/carbonzapp');
const {
  createRepairCase,
  addRepairAttempt,
  linkRetest,
  getRepairHistory,
  loadCase,
} = require('../services/injectorRepairs');

const ADMIN = { id: 'u-admin', name: 'Alex Admin', role: 'admin' };

function reset() {
  resetInjectorData();
  db.run(
    `INSERT OR IGNORE INTO users (id, name, email, role, active)
     VALUES (?, ?, ?, 'admin', 1)`,
    [ADMIN.id, ADMIN.name, 'repair-tests@example.com']
  );
}

function importTest({ id, datetime, peakHp, serial = 'FIX001' }) {
  carbonzapp.upsertReports([benchReport({
    id,
    slot: 0,
    serial,
    part: '4327147',
    datetime,
    flow: { IVM01: peakHp, IVM06: 260, IVM06_RETURN: 28 },
  })]);
  return db.get('SELECT * FROM injector_test_reports WHERE report_ext_id = ?', [id]);
}

function attemptPayload(repairDate, afterValue = '0.232') {
  return {
    repair_date: repairDate,
    technician: 'Alex Admin',
    diagnosis: 'High opening pressure with low cranking delivery.',
    hypothesis: 'Needle stroke is outside the effective range.',
    expected_outcome: 'Opening pressure decreases and delivery moves into specification.',
    repair_notes: 'Measurement taken before assembly.',
    changes: [{
      component: 'Needle',
      action_type: 'Adjusted',
      parameter: 'Needle Stroke',
      before_value: '0.247',
      after_value: afterValue,
      unit: 'mm',
      notes: 'Reduced installed stroke.',
    }],
  };
}

test('a failed test starts a permanent case with a structured first attempt', () => {
  reset();
  const failed = importTest({ id: 'repair-initial', datetime: '2026-09-11T10:00:00Z', peakHp: 250 });

  const repairCase = createRepairCase({
    initial_test_id: failed.id,
    failure_categories: ['High Delivery', 'Opening Pressure'],
    attempt: attemptPayload('2026-09-11T11:00:00Z'),
  }, ADMIN);

  assert.strictEqual(repairCase.status, 'OPEN');
  assert.deepStrictEqual(repairCase.failure_categories, ['High Delivery', 'Opening Pressure']);
  assert.strictEqual(repairCase.attempt_count, 1);
  assert.strictEqual(repairCase.attempts[0].status, 'WAITING_RETEST');
  assert.strictEqual(repairCase.attempts[0].changes[0].parameter, 'Needle Stroke');

  const peakHp = repairCase.attempts[0].deltas.find((delta) => delta.step_code === 'IVM01');
  assert.strictEqual(peakHp.before_value, 250, 'the before measurement is snapshotted immediately');
  assert.strictEqual(peakHp.after_value, null);

  const history = getRepairHistory(failed.id);
  assert.strictEqual(history.can_start, false, 'a second active case cannot be started');
  assert.strictEqual(history.active_case_id, repairCase.id);
  assert.deepStrictEqual(history.candidate_retests, []);
});

test('linking a passing retest calculates deltas and closes the case', () => {
  reset();
  const failed = importTest({ id: 'repair-pass-before', datetime: '2026-09-11T10:00:00Z', peakHp: 250 });
  const repairCase = createRepairCase({
    initial_test_id: failed.id,
    attempt: attemptPayload('2026-09-11T11:00:00Z'),
  }, ADMIN);
  const passed = importTest({ id: 'repair-pass-after', datetime: '2026-09-11T12:00:00Z', peakHp: 235 });

  const history = getRepairHistory(failed.id);
  assert.deepStrictEqual(history.candidate_retests.map((candidate) => candidate.id), [passed.id]);

  const completed = linkRetest(repairCase.attempts[0].id, {
    after_test_id: passed.id,
    observed_outcome: 'Peak HP moved into the green band.',
  }, ADMIN);

  assert.strictEqual(completed.status, 'PASSED');
  assert.strictEqual(completed.final_test_id, passed.id);
  assert.strictEqual(completed.attempts[0].outcome, 'PASS');
  assert.strictEqual(completed.attempts[0].observed_outcome, 'Peak HP moved into the green band.');

  const delta = completed.attempts[0].deltas.find((row) => row.step_code === 'IVM01');
  assert.strictEqual(delta.before_value, 250);
  assert.strictEqual(delta.after_value, 235);
  assert.strictEqual(delta.absolute_delta, -15);
  assert.strictEqual(delta.percent_delta, -6);
  assert.strictEqual(delta.target_value, 230);
  assert.strictEqual(delta.before_distance_from_target, 20);
  assert.strictEqual(delta.after_distance_from_target, 5);
  assert.strictEqual(delta.correction_effectiveness, 75);
});

test('a failed retest becomes the before snapshot for the next attempt', () => {
  reset();
  const initial = importTest({ id: 'repair-round-one', datetime: '2026-09-11T10:00:00Z', peakHp: 255 });
  const repairCase = createRepairCase({
    initial_test_id: initial.id,
    attempt: attemptPayload('2026-09-11T11:00:00Z', '0.238'),
  }, ADMIN);
  const failedRetest = importTest({ id: 'repair-round-two', datetime: '2026-09-11T12:00:00Z', peakHp: 245 });
  const afterFirst = linkRetest(repairCase.attempts[0].id, { after_test_id: failedRetest.id }, ADMIN);
  assert.strictEqual(afterFirst.status, 'OPEN');
  assert.strictEqual(afterFirst.attempts[0].outcome, 'FAIL');

  const afterSecond = addRepairAttempt(afterFirst.id, attemptPayload('2026-09-11T13:00:00Z', '0.230'), ADMIN);
  assert.strictEqual(afterSecond.attempt_count, 2);
  assert.strictEqual(afterSecond.attempts[1].before_test_id, failedRetest.id);
  const peakHpBefore = afterSecond.attempts[1].deltas.find((row) => row.step_code === 'IVM01');
  assert.strictEqual(peakHpBefore.before_value, 245);
  assert.strictEqual(peakHpBefore.after_value, null);
});

test('repair history and calculated evidence survive clearing the CarbonZapp cache', () => {
  reset();
  const initial = importTest({ id: 'repair-durable-before', datetime: '2026-09-11T10:00:00Z', peakHp: 250 });
  const repairCase = createRepairCase({
    initial_test_id: initial.id,
    attempt: attemptPayload('2026-09-11T11:00:00Z'),
  }, ADMIN);
  const passed = importTest({ id: 'repair-durable-after', datetime: '2026-09-11T12:00:00Z', peakHp: 235 });
  linkRetest(repairCase.attempts[0].id, { after_test_id: passed.id }, ADMIN);

  carbonzapp.clearAllReports();
  assert.strictEqual(db.get('SELECT COUNT(*) AS c FROM injector_test_reports', []).c, 0);

  const durable = loadCase(repairCase.id);
  assert.strictEqual(durable.status, 'PASSED');
  assert.strictEqual(durable.initial_test_id, null, 'the disposable cache reference is cleared');
  assert.strictEqual(durable.initial_report_ext_id, 'repair-durable-before', 'the permanent snapshot remains');
  assert.strictEqual(durable.attempts[0].after_test_id, null);
  const delta = durable.attempts[0].deltas.find((row) => row.step_code === 'IVM01');
  assert.strictEqual(delta.before_value, 250);
  assert.strictEqual(delta.after_value, 235);
  assert.strictEqual(delta.correction_effectiveness, 75);
});
