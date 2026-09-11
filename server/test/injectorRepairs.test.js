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
  getQuickEntry,
  saveQuickEntry,
  setCaseStatus,
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

function quickPayload(repairDate) {
  return { repair_date: repairDate, measurements: [
    { key: 'preload_screw_height', before_value: '0', after_value: '0', unit: 'mm' },
    { key: 'armature_stroke', before_value: '.058', after_value: '.054', unit: 'mm' },
    { key: 'needle_stroke', before_value: '.247', after_value: '.232', unit: 'mm' },
    { key: 'nozzle_nut_torque', before_value: '65', after_value: '70', unit: 'ft-lb' },
    { key: 'valve_body_torque', before_value: '50', after_value: '55', unit: 'N·m' },
    { key: 'solenoid_nut_torque', before_value: '35', after_value: '40', unit: 'in-lb' },
  ] };
}

test('quick entry records six measurements, identity, and immutable repair rounds', () => {
  reset();
  const initial = importTest({ id: 'quick-first', datetime: '2026-09-11T10:00:00Z', peakHp: 255 });
  assert.strictEqual(getQuickEntry(initial.id).measurements.length, 6);
  const first = saveQuickEntry(initial.id, quickPayload('2026-09-11T11:00:00Z'), ADMIN);
  assert.strictEqual(first.attempts[0].changes.length, 6);
  assert.strictEqual(first.attempts[0].technician, ADMIN.name);
  assert.strictEqual(first.attempts[0].changes[0].before_value, '0');
  assert.strictEqual(first.attempts[0].changes[0].action_type, 'No Change');
  assert.strictEqual(getQuickEntry(initial.id).can_save, false);
  assert.throws(() => saveQuickEntry(initial.id, quickPayload('2026-09-11T11:30:00Z'), ADMIN), /already been recorded/);

  const retest = importTest({ id: 'quick-second', datetime: '2026-09-11T12:00:00Z', peakHp: 245 });
  assert.strictEqual(getQuickEntry(retest.id).links_previous_retest, true);
  // A failed second write must roll back the retest link too.
  assert.throws(() => saveQuickEntry(retest.id, quickPayload('2026-09-11T11:30:00Z'), ADMIN), /repair date cannot be before/);
  assert.strictEqual(loadCase(first.id).attempts[0].status, 'WAITING_RETEST');
  const second = saveQuickEntry(retest.id, quickPayload('2026-09-11T13:00:00Z'), ADMIN);
  assert.strictEqual(second.attempt_count, 2);
  assert.strictEqual(second.attempts[0].after_test_id, retest.id);
  assert.strictEqual(second.attempts[1].before_test_id, retest.id);
  assert.strictEqual(second.attempts[0].deltas.find((d) => d.step_code === 'IVM01').absolute_delta, -10);
  assert.strictEqual(second.attempts[0].changes[2].before_value, '.247');
  carbonzapp.clearAllReports();
  assert.strictEqual(loadCase(first.id).attempts[1].changes.length, 6);
  const reimported = importTest({ id: 'quick-second', datetime: '2026-09-11T12:00:00Z', peakHp: 245 });
  assert.strictEqual(getQuickEntry(reimported.id).can_save, false);
});

test('quick entry validates pairs and units and respects case disposition', () => {
  reset();
  const initial = importTest({ id: 'quick-validation', datetime: '2026-09-11T10:00:00Z', peakHp: 255 });
  for (const patch of [{ before_value: '' }, { after_value: 'abc' }, { after_value: '-1' }, { unit: '' }]) {
    const payload = quickPayload('2026-09-11T11:00:00Z');
    Object.assign(payload.measurements[0], patch);
    assert.throws(() => saveQuickEntry(initial.id, payload, ADMIN));
  }
  assert.throws(() => saveQuickEntry(initial.id, { measurements: [] }, ADMIN), /at least one/);
  assert.strictEqual(db.get('SELECT COUNT(*) AS count FROM injector_repair_cases').count, 0);
  const payload = quickPayload('2026-09-11T11:00:00Z');
  payload.measurements = [payload.measurements[0], { key: 'needle_stroke', before_value: '', after_value: '', unit: 'mm' }];
  const repair = saveQuickEntry(initial.id, payload, ADMIN);
  assert.strictEqual(repair.attempts[0].changes.length, 1);
  const retest = importTest({ id: 'quick-held', datetime: '2026-09-11T12:00:00Z', peakHp: 245 });
  setCaseStatus(repair.id, 'HOLD', ADMIN);
  assert.strictEqual(getQuickEntry(retest.id).can_save, false);
  assert.throws(() => saveQuickEntry(retest.id, quickPayload('2026-09-11T13:00:00Z'), ADMIN), /on hold/);
  setCaseStatus(repair.id, 'OPEN', ADMIN);
  linkRetest(repair.attempts[0].id, { after_test_id: retest.id }, ADMIN);
  carbonzapp.clearAllReports();
  const restored = importTest({ id: 'quick-held', datetime: '2026-09-11T12:00:00Z', peakHp: 245 });
  const next = saveQuickEntry(restored.id, quickPayload('2026-09-11T13:00:00Z'), ADMIN);
  assert.strictEqual(next.attempt_count, 2, 'a cleared/reimported retest still starts the next round');
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
