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
  autoLinkRetests,
  repairRolesForTests,
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
  assert.throws(() => saveQuickEntry(initial.id, quickPayload('2026-09-11T11:30:00Z'), ADMIN), /already recorded on this result/);

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

// ── Repairs belong to the result they were recorded on ──────────────────────

/** Each result's repair role, oldest test first, as the test list shows it. */
function roles(serial = 'FIX001') {
  return repairRolesForTests(db.all(
    'SELECT * FROM injector_test_reports WHERE serial_number = ? ORDER BY datetime(test_datetime) ASC',
    [serial]
  )).map((row) => [row.report_ext_id, row.repair_attempt_number || null, row.retest_of_attempt || null, row.retest_outcome || null]);
}

test('a repair recorded after its retest was synced still links to that retest', () => {
  reset();
  const failed = importTest({ id: 'late-entry-before', datetime: '2026-09-11T10:00:00Z', peakHp: 255 });
  const retest = importTest({ id: 'late-entry-retest', datetime: '2026-09-11T12:00:00Z', peakHp: 245 });

  // The technician enters the repair the next day — after the retest ran.
  const repairCase = createRepairCase({
    initial_test_id: failed.id,
    attempt: attemptPayload('2026-09-12T09:00:00Z'),
  }, ADMIN);

  assert.strictEqual(repairCase.attempts[0].status, 'COMPLETED', 'the synced retest is linked straight away');
  assert.strictEqual(repairCase.attempts[0].after_test_id, retest.id);
  assert.strictEqual(repairCase.attempts[0].outcome, 'FAIL');
  assert.strictEqual(repairCase.attempts[0].deltas.find((d) => d.step_code === 'IVM01').absolute_delta, -10);
});

test('repairs chain through the results they were recorded on, ending in a pass', () => {
  reset();
  const results = [
    importTest({ id: 'chain-1', datetime: '2026-09-20T08:00:00-05:00', peakHp: 256 }),
    importTest({ id: 'chain-2', datetime: '2026-09-20T09:00:00-05:00', peakHp: 256 }),
    importTest({ id: 'chain-3', datetime: '2026-09-20T10:00:00-05:00', peakHp: 255 }),
    importTest({ id: 'chain-4', datetime: '2026-09-20T11:00:00-05:00', peakHp: 245 }),
    importTest({ id: 'chain-5', datetime: '2026-09-20T12:00:00-05:00', peakHp: 235 }),
  ];
  assert.deepStrictEqual(results.map((r) => r.result_status), ['fail', 'fail', 'fail', 'fail', 'pass']);

  saveQuickEntry(results[2].id, quickPayload(), ADMIN);          // Repair 1 on Result 3
  assert.strictEqual(getQuickEntry(results[3].id).can_save, true, 'Result 4 takes the next repair');
  const closed = saveQuickEntry(results[3].id, quickPayload(), ADMIN); // Repair 2 on Result 4

  assert.strictEqual(closed.status, 'PASSED');
  assert.strictEqual(closed.final_test_id, results[4].id);
  assert.deepStrictEqual(roles(), [
    ['chain-1', null, null, null],
    ['chain-2', null, null, null],
    ['chain-3', 1, null, null],
    ['chain-4', 2, 1, 'FAIL'],
    ['chain-5', null, 2, 'PASS'],
  ]);

  // The roles are matched by report and slot, so they survive a re-import.
  carbonzapp.clearAllReports();
  for (const [i, r] of results.entries()) {
    importTest({ id: r.report_ext_id, datetime: r.test_datetime, peakHp: [256, 256, 255, 245, 235][i] });
  }
  assert.deepStrictEqual(roles().map((row) => row.slice(1)), [
    [null, null, null], [null, null, null], [1, null, null], [2, 1, 'FAIL'], [null, 2, 'PASS'],
  ]);
});

test('a sync links repairs waiting for a retest, but not scrapped ones', () => {
  reset();
  const open = importTest({ id: 'sync-open-before', serial: 'SYNC-1', datetime: '2026-09-11T10:00:00Z', peakHp: 255 });
  const scrapped = importTest({ id: 'sync-scrap-before', serial: 'SYNC-2', datetime: '2026-09-11T10:00:00Z', peakHp: 255 });
  const openCase = createRepairCase({ initial_test_id: open.id, attempt: attemptPayload('2026-09-11T11:00:00Z') }, ADMIN);
  const scrappedCase = createRepairCase({ initial_test_id: scrapped.id, attempt: attemptPayload('2026-09-11T11:00:00Z') }, ADMIN);
  setCaseStatus(scrappedCase.id, 'SCRAPPED', ADMIN);
  assert.strictEqual(autoLinkRetests(), 0, 'nothing to link before the retests arrive');

  const passed = importTest({ id: 'sync-open-after', serial: 'SYNC-1', datetime: '2026-09-11T12:00:00Z', peakHp: 235 });
  importTest({ id: 'sync-scrap-after', serial: 'SYNC-2', datetime: '2026-09-11T12:00:00Z', peakHp: 235 });

  assert.strictEqual(autoLinkRetests({ user: ADMIN }), 1);
  const linked = loadCase(openCase.id);
  assert.strictEqual(linked.status, 'PASSED');
  assert.strictEqual(linked.final_test_id, passed.id);
  assert.strictEqual(loadCase(scrappedCase.id).attempts[0].status, 'WAITING_RETEST');
  assert.strictEqual(autoLinkRetests(), 0, 'linking is idempotent');
});

test('a new repair case cannot start on a result older than the recorded history', () => {
  reset();
  const first = importTest({ id: 'older-1', datetime: '2026-09-11T08:00:00Z', peakHp: 256 });
  const repaired = importTest({ id: 'older-2', datetime: '2026-09-11T10:00:00Z', peakHp: 255 });
  importTest({ id: 'older-3', datetime: '2026-09-11T12:00:00Z', peakHp: 235 });
  const passedCase = saveQuickEntry(repaired.id, quickPayload(), ADMIN);
  assert.strictEqual(passedCase.status, 'PASSED');

  assert.strictEqual(getQuickEntry(first.id).can_save, false);
  assert.match(getQuickEntry(first.id).reason, /not newer than the repair history/);
  assert.strictEqual(getRepairHistory(first.id).can_start, false);
  assert.throws(
    () => createRepairCase({ initial_test_id: first.id, attempt: attemptPayload('2026-09-12T09:00:00Z') }, ADMIN),
    /not newer than the repair history/
  );

  // A later failure starts a fresh case normally.
  const laterFailure = importTest({ id: 'older-4', datetime: '2026-09-13T10:00:00Z', peakHp: 256 });
  assert.strictEqual(getQuickEntry(laterFailure.id).can_save, true);
});

// ── One unit, serial entered differently (260521828A = 260521828 = 828) ─────

test('a repair follows the unit across different spellings of its serial', () => {
  reset();
  const first = importTest({ id: 'spell-1', serial: '260521828A', datetime: '2026-09-20T10:00:00-05:00', peakHp: 255 });
  const second = importTest({ id: 'spell-2', serial: '828', datetime: '2026-09-20T11:00:00-05:00', peakHp: 245 });
  const third = importTest({ id: 'spell-3', serial: '260521828', datetime: '2026-09-20T12:00:00-05:00', peakHp: 235 });
  importTest({ id: 'spell-other', serial: '260777000', datetime: '2026-09-20T11:30:00-05:00', peakHp: 235 });

  const opened = saveQuickEntry(first.id, quickPayload(), ADMIN);
  assert.strictEqual(opened.attempts[0].after_test_id, second.id, '"828" is linked as the retest of 260521828A');
  assert.strictEqual(opened.attempts[0].after_serial_number, '828');
  assert.strictEqual(getRepairHistory(second.id).active_case_id, opened.id, 'the case shows from the "828" result');
  assert.throws(
    () => createRepairCase({ initial_test_id: second.id, attempt: attemptPayload('2026-09-21T09:00:00Z') }, ADMIN),
    /already has an active repair case/,
    'a second case cannot be opened for the same unit under another spelling'
  );

  const closed = saveQuickEntry(second.id, quickPayload(), ADMIN);
  assert.strictEqual(closed.status, 'PASSED');
  assert.strictEqual(closed.final_test_id, third.id);
  assert.deepStrictEqual(
    repairRolesForTests(db.all("SELECT * FROM injector_test_reports WHERE report_ext_id LIKE 'spell-%' ORDER BY test_datetime", []))
      .map((row) => [row.serial_number, row.repair_attempt_number || null, row.retest_of_attempt || null]),
    [['260521828A', 1, null], ['828', 2, 1], ['260777000', null, null], ['260521828', null, 2]]
  );
});

test('a short serial two units could own is not linked to either', () => {
  reset();
  importTest({ id: 'amb-other', serial: '260777828', datetime: '2026-09-20T09:00:00-05:00', peakHp: 235 });
  const failed = importTest({ id: 'amb-1', serial: '260521828', datetime: '2026-09-20T10:00:00-05:00', peakHp: 255 });
  const repairCase = saveQuickEntry(failed.id, quickPayload(), ADMIN);
  importTest({ id: 'amb-2', serial: '828', datetime: '2026-09-20T11:00:00-05:00', peakHp: 235 });

  assert.strictEqual(autoLinkRetests(), 0, '"828" could be 260521828 or 260777828');
  assert.deepStrictEqual(getRepairHistory(failed.id).candidate_retests, []);
  assert.strictEqual(loadCase(repairCase.id).attempts[0].status, 'WAITING_RETEST');

  // A spelling that can only be this unit still links.
  const exact = importTest({ id: 'amb-3', serial: '260521828-A', datetime: '2026-09-20T12:00:00-05:00', peakHp: 235 });
  assert.strictEqual(autoLinkRetests(), 1);
  assert.strictEqual(loadCase(repairCase.id).final_test_id, exact.id);
});
