'use strict';

/**
 * Persistent repair lifecycle for failed injector tests.
 *
 * CarbonZapp rows are a refreshable cache. Repair cases, attempts, structured
 * changes, and measurement snapshots are deliberately stored in separate
 * tables so the engineering history survives Clear All and future resyncs.
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');
const { hydrateInjectorRow } = require('./carbonzapp');
const {
  isFlushStep,
  numericValue,
  stepCode,
  stepLabel,
} = require('./injectorSteps');

const ACTIVE_CASE_STATUSES = ['OPEN', 'HOLD', 'ENGINEERING_REVIEW'];
const MANUAL_CASE_STATUSES = ['OPEN', 'SCRAPPED', 'HOLD', 'ENGINEERING_REVIEW'];
const COMPONENT_OPTIONS = [
  'Nozzle', 'Needle', 'Control Valve', 'Control Ball', 'Armature', 'Stator',
  'Solenoid', 'Spring', 'Nozzle Nut', 'Valve Body', 'Housing', 'Other',
];
const ACTION_OPTIONS = [
  'Adjusted', 'Replaced', 'Reworked', 'Cleaned', 'Retorqued', 'Lapped',
  'Inspected', 'No Change',
];
const MAX_CHANGES = 25;
const QUICK_MEASUREMENTS = [
  { key: 'preload_screw_height', label: 'Preload Screw Height', component: 'Spring', units: ['mm', 'in'] },
  { key: 'armature_stroke', label: 'Armature Stroke', component: 'Armature', units: ['mm', 'in'] },
  { key: 'needle_stroke', label: 'Needle Stroke', component: 'Needle', units: ['mm', 'in'] },
  { key: 'nozzle_nut_torque', label: 'Nozzle Nut Torque', component: 'Nozzle Nut', units: ['ft-lb', 'in-lb', 'N·m'] },
  { key: 'valve_body_torque', label: 'Valve Body Torque', component: 'Valve Body', units: ['ft-lb', 'in-lb', 'N·m'] },
  { key: 'solenoid_nut_torque', label: 'Solenoid Nut Torque', component: 'Solenoid', units: ['ft-lb', 'in-lb', 'N·m'] },
];

function text(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function nullableText(value, max) {
  const valueText = text(value, max);
  return valueText || null;
}

function isoDate(value, fallback = null) {
  const candidate = value || fallback;
  const date = candidate ? new Date(candidate) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new AppError('Enter a valid repair date.', 400, 'VALIDATION_ERROR');
  }
  return date.toISOString();
}

function sameIdentity(left, right) {
  const clean = (value) => text(value, 200).toUpperCase();
  return clean(left.part_number) === clean(right.part_number)
    && clean(left.serial_number) === clean(right.serial_number);
}

function getTest(testId) {
  const row = db.get('SELECT * FROM injector_test_reports WHERE id = ?', [text(testId, 100)]);
  if (!row) throw new AppError('The injector test could not be found. Refresh the list and try again.', 404, 'NOT_FOUND');
  return hydrateInjectorRow(row);
}

function testSnapshot(test) {
  return {
    testId: test.id || null,
    reportExtId: test.report_ext_id || null,
    slotPosition: test.slot_position == null ? null : Number(test.slot_position),
    testDatetime: test.test_datetime || null,
    resultStatus: String(test.result_status || 'unknown').toUpperCase(),
    partNumber: test.part_number || '',
    serialNumber: test.serial_number || '',
  };
}

function statusOfTest(test) {
  const status = String(test.result_status || '').toUpperCase();
  return ['PASS', 'FAIL', 'DNF'].includes(status) ? status : 'UNKNOWN';
}

function activeCaseFor(test) {
  return db.get(
    `SELECT * FROM injector_repair_cases
      WHERE part_number = ? COLLATE NOCASE
        AND serial_number = ? COLLATE NOCASE
        AND status IN ('OPEN', 'HOLD', 'ENGINEERING_REVIEW')
      ORDER BY datetime(opened_at) DESC LIMIT 1`,
    [test.part_number || '', test.serial_number || '']
  );
}

function normaliseCategories(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => text(value, 100)).filter(Boolean))].slice(0, 20);
}

function normaliseChanges(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new AppError('Record at least one structured repair change.', 400, 'VALIDATION_ERROR');
  }
  if (values.length > MAX_CHANGES) {
    throw new AppError(`Record at most ${MAX_CHANGES} changes in one repair attempt.`, 400, 'VALIDATION_ERROR');
  }
  return values.map((change, index) => {
    const component = text(change && change.component, 100);
    const actionType = text(change && change.action_type, 100);
    if (!component || !actionType) {
      throw new AppError(`Repair change ${index + 1} needs a component and action.`, 400, 'VALIDATION_ERROR');
    }
    if (!COMPONENT_OPTIONS.includes(component)) {
      throw new AppError(`Repair change ${index + 1} has an unsupported component.`, 400, 'VALIDATION_ERROR');
    }
    if (!ACTION_OPTIONS.includes(actionType)) {
      throw new AppError(`Repair change ${index + 1} has an unsupported action.`, 400, 'VALIDATION_ERROR');
    }
    return {
      component,
      actionType,
      parameter: nullableText(change.parameter, 120),
      beforeValue: nullableText(change.before_value, 100),
      afterValue: nullableText(change.after_value, 100),
      unit: nullableText(change.unit, 40),
      notes: nullableText(change.notes, 500),
    };
  });
}

function normaliseAttemptInput(payload, user) {
  const technician = text(payload && payload.technician, 120) || text(user && user.name, 120);
  const diagnosis = text(payload && payload.diagnosis, 2000);
  if (!technician) throw new AppError('Technician is required.', 400, 'VALIDATION_ERROR');
  if (!diagnosis) throw new AppError('Diagnosis is required.', 400, 'VALIDATION_ERROR');
  return {
    repairDate: isoDate(payload && payload.repair_date, new Date().toISOString()),
    technician,
    diagnosis,
    hypothesis: nullableText(payload && payload.hypothesis, 3000),
    expectedOutcome: nullableText(payload && payload.expected_outcome, 3000),
    repairNotes: nullableText(payload && payload.repair_notes, 4000),
    changes: normaliseChanges(payload && payload.changes),
  };
}

function finite(value) {
  const number = numericValue(value);
  return number == null ? null : number;
}

/** One row per customer-facing test-step tank. */
function measurementSnapshot(test) {
  const rows = new Map();
  for (const step of (test.tests || [])) {
    if (!step || !step.primary || isFlushStep(step)) continue;
    const code = stepCode(step);
    const add = (tank, role, keyRole) => {
      if (!tank) return;
      const min = finite(tank.min_green);
      const max = finite(tank.max_green);
      const explicitTarget = finite(tank.target);
      const target = explicitTarget != null
        ? explicitTarget
        : (min != null && max != null ? (min + max) / 2 : null);
      rows.set(`${code}|${keyRole}`, {
        stepKey: `${code}|${keyRole}`,
        stepCode: code,
        stepName: stepLabel(step, role, tank.tank_name),
        tankRole: role,
        value: finite(tank.average),
        status: String(tank.status || step.status || 'unknown').toUpperCase(),
        target,
        specMin: min,
        specMax: max,
        unit: text(tank.unit, 40) || null,
      });
    };
    add(step.primary, 'primary', '1');
    add(step.secondary, 'secondary', '2');
  }
  return rows;
}

function insertChangeRows(attemptId, changes) {
  changes.forEach((change, index) => {
    db.run(
      `INSERT INTO injector_repair_changes
        (id, repair_attempt_id, sequence, component, action_type, parameter,
         before_value, after_value, unit, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), attemptId, index + 1, change.component, change.actionType,
        change.parameter, change.beforeValue, change.afterValue, change.unit, change.notes]
    );
  });
}

/** Snapshot the before-test immediately, before its cache row can be cleared. */
function insertBeforeMeasurements(attemptId, beforeTest) {
  for (const measurement of measurementSnapshot(beforeTest).values()) {
    const beforeDistance = measurement.value != null && measurement.target != null
      ? measurement.value - measurement.target
      : null;
    db.run(
      `INSERT INTO injector_repair_result_deltas
        (id, repair_attempt_id, step_key, step_code, step_name, tank_role,
         before_value, target_value, before_distance_from_target, before_status,
         spec_min, spec_max, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), attemptId, measurement.stepKey, measurement.stepCode,
        measurement.stepName, measurement.tankRole, measurement.value,
        measurement.target, beforeDistance, measurement.status,
        measurement.specMin, measurement.specMax, measurement.unit]
    );
  }
}

function withTransaction(work) {
  // Savepoints also allow Quick Entry to link a retest and create the next
  // attempt atomically using the same lifecycle functions.
  const savepoint = `repair_${uuidv4().replace(/-/g, '')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = work();
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (err) {
    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (_) { /* original error wins */ }
    throw err;
  }
}

function createAttemptRecord(caseId, attemptNumber, beforeTest, input, user) {
  const attemptId = uuidv4();
  const before = testSnapshot(beforeTest);
  db.run(
    `INSERT INTO injector_repair_attempts
      (id, repair_case_id, attempt_number, before_test_id, before_report_ext_id,
       before_slot_position, before_test_datetime, before_result_status,
       repair_date, technician, technician_id, diagnosis, hypothesis,
       expected_outcome, repair_notes, status, outcome, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING_RETEST', 'PENDING', ?)`,
    [attemptId, caseId, attemptNumber, before.testId, before.reportExtId,
      before.slotPosition, before.testDatetime, before.resultStatus,
      input.repairDate, input.technician, user && user.id ? user.id : null,
      input.diagnosis, input.hypothesis, input.expectedOutcome,
      input.repairNotes, new Date().toISOString()]
  );
  insertChangeRows(attemptId, input.changes);
  insertBeforeMeasurements(attemptId, beforeTest);
  return attemptId;
}

function createRepairCase(payload, user) {
  const initialTest = getTest(payload && payload.initial_test_id);
  if (!initialTest.serial_number) {
    throw new AppError('A serial number is required to start repair tracking.', 400, 'VALIDATION_ERROR');
  }
  if (statusOfTest(initialTest) !== 'FAIL') {
    throw new AppError('Repair tracking can only be started from a failed injector test.', 400, 'VALIDATION_ERROR');
  }
  if (activeCaseFor(initialTest)) {
    throw new AppError('This injector already has an active repair case.', 409, 'ACTIVE_REPAIR_CASE');
  }

  const attemptInput = normaliseAttemptInput(payload && payload.attempt, user);
  if (new Date(attemptInput.repairDate) < new Date(initialTest.test_datetime || 0)) {
    throw new AppError('The repair date cannot be before the failed test.', 400, 'VALIDATION_ERROR');
  }
  const initial = testSnapshot(initialTest);
  const caseId = uuidv4();
  const now = new Date().toISOString();

  withTransaction(() => {
    db.run(
      `INSERT INTO injector_repair_cases
        (id, part_number, serial_number, initial_test_id, initial_report_ext_id,
         initial_slot_position, initial_test_datetime, initial_result_status,
         status, failure_categories_json, opened_at, opened_by, opened_by_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`,
      [caseId, initial.partNumber, initial.serialNumber,
        initial.testId, initial.reportExtId, initial.slotPosition,
        initial.testDatetime, initial.resultStatus,
        JSON.stringify(normaliseCategories(payload && payload.failure_categories)),
        now, user && user.id ? user.id : null, text(user && user.name, 120) || null, now]
    );
    createAttemptRecord(caseId, 1, initialTest, attemptInput, user);
  });
  return loadCase(caseId);
}

function addRepairAttempt(caseId, payload, user) {
  const repairCase = db.get('SELECT * FROM injector_repair_cases WHERE id = ?', [text(caseId, 100)]);
  if (!repairCase) throw new AppError('The repair case could not be found.', 404, 'NOT_FOUND');
  if (repairCase.status !== 'OPEN') {
    throw new AppError('Reopen this repair case before adding another attempt.', 409, 'CASE_NOT_OPEN');
  }
  const previous = db.get(
    'SELECT * FROM injector_repair_attempts WHERE repair_case_id = ? ORDER BY attempt_number DESC LIMIT 1',
    [repairCase.id]
  );
  if (!previous || previous.status !== 'COMPLETED' || !previous.after_test_id) {
    throw new AppError('Link the current repair attempt to a retest before adding another attempt.', 409, 'RETEST_REQUIRED');
  }
  if (!['FAIL', 'DNF', 'UNKNOWN'].includes(previous.outcome)) {
    throw new AppError('This repair case has already passed.', 409, 'CASE_RESOLVED');
  }
  const beforeTest = getTest(previous.after_test_id);
  const input = normaliseAttemptInput(payload, user);
  if (new Date(input.repairDate) < new Date(beforeTest.test_datetime || 0)) {
    throw new AppError('The repair date cannot be before the linked retest.', 400, 'VALIDATION_ERROR');
  }
  const now = new Date().toISOString();
  withTransaction(() => {
    createAttemptRecord(repairCase.id, Number(previous.attempt_number) + 1, beforeTest, input, user);
    db.run('UPDATE injector_repair_cases SET updated_at = ? WHERE id = ?', [now, repairCase.id]);
  });
  return loadCase(repairCase.id);
}

function calculateDelta(before, after) {
  const beforeValue = before ? before.before_value : null;
  const target = before && before.target_value != null
    ? before.target_value
    : (after ? after.target : null);
  const afterValue = after ? after.value : null;
  const absolute = beforeValue != null && afterValue != null ? afterValue - beforeValue : null;
  const percent = absolute != null && beforeValue !== 0 ? (absolute / beforeValue) * 100 : null;
  const beforeDistance = beforeValue != null && target != null ? beforeValue - target : null;
  const afterDistance = afterValue != null && target != null ? afterValue - target : null;
  const effectiveness = beforeDistance != null && afterDistance != null && beforeDistance !== 0
    ? ((Math.abs(beforeDistance) - Math.abs(afterDistance)) / Math.abs(beforeDistance)) * 100
    : null;
  return { target, afterValue, absolute, percent, beforeDistance, afterDistance, effectiveness };
}

function linkRetest(attemptId, payload, user) {
  const attempt = db.get('SELECT * FROM injector_repair_attempts WHERE id = ?', [text(attemptId, 100)]);
  if (!attempt) throw new AppError('The repair attempt could not be found.', 404, 'NOT_FOUND');
  if (attempt.status !== 'WAITING_RETEST' || attempt.after_test_id) {
    throw new AppError('This repair attempt already has a linked retest.', 409, 'RETEST_ALREADY_LINKED');
  }
  const repairCase = db.get('SELECT * FROM injector_repair_cases WHERE id = ?', [attempt.repair_case_id]);
  if (!repairCase) throw new AppError('The repair case could not be found.', 404, 'NOT_FOUND');
  const afterTest = getTest(payload && payload.after_test_id);
  if (!sameIdentity(repairCase, afterTest)) {
    throw new AppError('The selected retest does not match this injector part and serial number.', 400, 'IDENTITY_MISMATCH');
  }
  if (new Date(afterTest.test_datetime || 0) <= new Date(attempt.repair_date)) {
    throw new AppError('The retest must have occurred after the repair.', 400, 'INVALID_RETEST_DATE');
  }
  const alreadyUsed = db.get(
    'SELECT id FROM injector_repair_attempts WHERE after_test_id = ? AND id != ?',
    [afterTest.id, attempt.id]
  );
  if (alreadyUsed) throw new AppError('That test is already linked to another repair attempt.', 409, 'RETEST_ALREADY_LINKED');

  const after = testSnapshot(afterTest);
  const afterMeasurements = measurementSnapshot(afterTest);
  const existingRows = db.all(
    'SELECT * FROM injector_repair_result_deltas WHERE repair_attempt_id = ?',
    [attempt.id]
  );
  const existingByKey = new Map(existingRows.map((row) => [row.step_key, row]));
  const allKeys = new Set([...existingByKey.keys(), ...afterMeasurements.keys()]);
  const now = new Date().toISOString();
  const outcome = statusOfTest(afterTest);

  withTransaction(() => {
    for (const key of allKeys) {
      const before = existingByKey.get(key) || null;
      const measuredAfter = afterMeasurements.get(key) || null;
      const calculated = calculateDelta(before, measuredAfter);
      if (before) {
        db.run(
          `UPDATE injector_repair_result_deltas SET
             step_code = ?, step_name = ?, tank_role = ?, after_value = ?,
             absolute_delta = ?, percent_delta = ?, target_value = ?,
             before_distance_from_target = ?, after_distance_from_target = ?,
             correction_effectiveness = ?, after_status = ?,
             spec_min = ?, spec_max = ?, unit = ?
           WHERE id = ?`,
          [before.step_code || (measuredAfter && measuredAfter.stepCode),
            before.step_name || (measuredAfter && measuredAfter.stepName),
            before.tank_role || (measuredAfter && measuredAfter.tankRole),
            calculated.afterValue, calculated.absolute, calculated.percent,
            calculated.target, calculated.beforeDistance, calculated.afterDistance,
            calculated.effectiveness, measuredAfter ? measuredAfter.status : 'MISSING',
            before.spec_min != null ? before.spec_min : (measuredAfter && measuredAfter.specMin),
            before.spec_max != null ? before.spec_max : (measuredAfter && measuredAfter.specMax),
            before.unit || (measuredAfter && measuredAfter.unit), before.id]
        );
      } else if (measuredAfter) {
        db.run(
          `INSERT INTO injector_repair_result_deltas
            (id, repair_attempt_id, step_key, step_code, step_name, tank_role,
             after_value, target_value, after_distance_from_target, before_status,
             after_status, spec_min, spec_max, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MISSING', ?, ?, ?, ?)`,
          [uuidv4(), attempt.id, measuredAfter.stepKey, measuredAfter.stepCode,
            measuredAfter.stepName, measuredAfter.tankRole, measuredAfter.value,
            calculated.target, calculated.afterDistance, measuredAfter.status,
            measuredAfter.specMin, measuredAfter.specMax, measuredAfter.unit]
        );
      }
    }

    db.run(
      `UPDATE injector_repair_attempts SET
         after_test_id = ?, after_report_ext_id = ?, after_slot_position = ?,
         after_test_datetime = ?, after_result_status = ?, observed_outcome = ?,
         status = 'COMPLETED', outcome = ?, updated_at = ?
       WHERE id = ?`,
      [after.testId, after.reportExtId, after.slotPosition, after.testDatetime,
        after.resultStatus, nullableText(payload && payload.observed_outcome, 3000),
        outcome, now, attempt.id]
    );

    if (outcome === 'PASS') {
      db.run(
        `UPDATE injector_repair_cases SET
           status = 'PASSED', closed_at = ?, closed_by = ?, closed_by_name = ?,
           final_test_id = ?, final_report_ext_id = ?, final_slot_position = ?,
           final_test_datetime = ?, final_result_status = ?, updated_at = ?
         WHERE id = ?`,
        [now, user && user.id ? user.id : null, text(user && user.name, 120) || null,
          after.testId, after.reportExtId, after.slotPosition, after.testDatetime,
          after.resultStatus, now, repairCase.id]
      );
    } else {
      db.run('UPDATE injector_repair_cases SET updated_at = ? WHERE id = ?', [now, repairCase.id]);
    }
  });
  return loadCase(repairCase.id);
}

function setCaseStatus(caseId, requestedStatus, user) {
  const repairCase = db.get('SELECT * FROM injector_repair_cases WHERE id = ?', [text(caseId, 100)]);
  if (!repairCase) throw new AppError('The repair case could not be found.', 404, 'NOT_FOUND');
  const status = text(requestedStatus, 40).toUpperCase();
  if (!MANUAL_CASE_STATUSES.includes(status)) {
    throw new AppError('Choose Open, Hold, Engineering Review, or Scrapped.', 400, 'VALIDATION_ERROR');
  }
  if (repairCase.status === 'PASSED') {
    throw new AppError('A passed repair case cannot be reopened manually.', 409, 'CASE_RESOLVED');
  }
  const now = new Date().toISOString();
  const closed = status === 'SCRAPPED';
  db.run(
    `UPDATE injector_repair_cases SET status = ?, closed_at = ?, closed_by = ?,
       closed_by_name = ?, updated_at = ? WHERE id = ?`,
    [status, closed ? now : null, closed && user && user.id ? user.id : null,
      closed ? (text(user && user.name, 120) || null) : null, now, repairCase.id]
  );
  return loadCase(repairCase.id);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function loadCase(caseId) {
  const repairCase = db.get('SELECT * FROM injector_repair_cases WHERE id = ?', [caseId]);
  if (!repairCase) return null;
  const { failure_categories_json: failureCategoriesJson, ...caseFields } = repairCase;
  const attempts = db.all(
    'SELECT * FROM injector_repair_attempts WHERE repair_case_id = ? ORDER BY attempt_number ASC',
    [repairCase.id]
  ).map((attempt) => ({
    ...attempt,
    changes: db.all(
      'SELECT * FROM injector_repair_changes WHERE repair_attempt_id = ? ORDER BY sequence ASC',
      [attempt.id]
    ),
    deltas: db.all(
      'SELECT * FROM injector_repair_result_deltas WHERE repair_attempt_id = ? ORDER BY rowid ASC',
      [attempt.id]
    ),
  }));
  return {
    ...caseFields,
    failure_categories: parseJsonArray(failureCategoriesJson),
    attempt_count: attempts.length,
    attempts,
  };
}

function candidateRetests(repairCase, attempt) {
  if (!repairCase || !attempt || attempt.status !== 'WAITING_RETEST') return [];
  return db.all(
    `SELECT id, report_ext_id, slot_position, part_number, serial_number,
            test_datetime, result_status, steps_total, steps_passed, steps_failed
       FROM injector_test_reports
      WHERE part_number = ? COLLATE NOCASE
        AND serial_number = ? COLLATE NOCASE
        AND datetime(test_datetime) > datetime(?)
        AND id != ?
        AND id NOT IN (
          SELECT after_test_id FROM injector_repair_attempts WHERE after_test_id IS NOT NULL
        )
      ORDER BY datetime(test_datetime) ASC, report_ext_id ASC, slot_position ASC`,
    [repairCase.part_number || '', repairCase.serial_number || '',
      attempt.repair_date, attempt.before_test_id || '']
  );
}

function getRepairHistory(testId) {
  const test = getTest(testId);
  const cases = db.all(
    `SELECT id FROM injector_repair_cases
      WHERE (part_number = ? COLLATE NOCASE AND serial_number = ? COLLATE NOCASE)
         OR initial_test_id = ? OR final_test_id = ?
      ORDER BY datetime(opened_at) DESC`,
    [test.part_number || '', test.serial_number || '', test.id, test.id]
  ).map((row) => loadCase(row.id));
  const activeCase = cases.find((repairCase) => ACTIVE_CASE_STATUSES.includes(repairCase.status)) || null;
  const waitingAttempt = activeCase
    ? [...activeCase.attempts].reverse().find((attempt) => attempt.status === 'WAITING_RETEST') || null
    : null;
  return {
    test: testSnapshot(test),
    cases,
    active_case_id: activeCase ? activeCase.id : null,
    candidate_retests: candidateRetests(activeCase, waitingAttempt),
    can_start: statusOfTest(test) === 'FAIL' && !!test.serial_number && !activeCase,
    options: { components: COMPONENT_OPTIONS, actions: ACTION_OPTIONS },
  };
}

function matchesSavedTest(test, attempt, prefix) {
  return attempt[`${prefix}_test_id`] === test.id
    || (test.report_ext_id != null
      && attempt[`${prefix}_report_ext_id`] === test.report_ext_id
      && Number(attempt[`${prefix}_slot_position`]) === Number(test.slot_position));
}

function quickEntryContext(testId) {
  const test = getTest(testId);
  const repairCase = activeCaseFor(test);
  const previous = repairCase && db.get(
    'SELECT * FROM injector_repair_attempts WHERE repair_case_id = ? ORDER BY attempt_number DESC LIMIT 1',
    [repairCase.id]
  );
  let reason = '';
  let linkPrevious = false;
  if (!test.serial_number) reason = 'A serial number is required to record a repair.';
  else if (repairCase && repairCase.status !== 'OPEN') reason = 'This repair is on hold or under engineering review. Reopen it in Repair History first.';
  else if (!['FAIL', 'DNF', 'UNKNOWN'].includes(statusOfTest(test)) || (!repairCase && statusOfTest(test) !== 'FAIL')) {
    reason = 'Quick Entry records repairs after an unsuccessful test. Use Repair History to link a passing retest.';
  } else if (previous) {
    if (previous.status === 'WAITING_RETEST') {
      if (matchesSavedTest(test, previous, 'before') || !candidateRetests(repairCase, previous).some((row) => row.id === test.id)) {
        reason = 'Measurements have already been recorded for this repair. Run and sync a new retest before recording the next repair.';
      } else linkPrevious = true;
    } else if (!matchesSavedTest(test, previous, 'after')) {
      reason = 'Open Quick Entry on the latest linked retest to record the next repair.';
    }
  } else {
    const saved = db.all(
      `SELECT a.* FROM injector_repair_attempts a JOIN injector_repair_cases c ON c.id = a.repair_case_id
        WHERE c.part_number = ? COLLATE NOCASE AND c.serial_number = ? COLLATE NOCASE`,
      [test.part_number || '', test.serial_number]
    );
    if (saved.some((attempt) => matchesSavedTest(test, attempt, 'before') || matchesSavedTest(test, attempt, 'after'))) {
      reason = 'This test is already part of a repair history. Select a new failed test to start another case.';
    }
  }
  return { test, repairCase, previous, reason, linkPrevious };
}

function getQuickEntry(testId) {
  const context = quickEntryContext(testId);
  return {
    measurements: QUICK_MEASUREMENTS,
    can_save: !context.reason,
    reason: context.reason,
    attempt_number: context.previous ? Number(context.previous.attempt_number) + 1 : 1,
    links_previous_retest: context.linkPrevious,
  };
}

function saveQuickEntry(testId, payload, user) {
  const values = payload && payload.measurements;
  if (!Array.isArray(values) || values.length > QUICK_MEASUREMENTS.length) {
    throw new AppError('Enter the repair measurements.', 400, 'VALIDATION_ERROR');
  }
  const seen = new Set();
  const changes = values.map((value) => {
    const definition = QUICK_MEASUREMENTS.find((item) => item.key === value?.key);
    if (!definition || seen.has(value.key)) throw new AppError('Unknown or repeated measurement.', 400, 'VALIDATION_ERROR');
    seen.add(value.key);
    const before = text(value.before_value, 100);
    const after = text(value.after_value, 100);
    if (!before && !after) return null;
    const validNumber = (number) => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(number) && Number.isFinite(Number(number));
    if (!validNumber(before) || !validNumber(after)) {
      throw new AppError(`${definition.label}: enter a nonnegative number in both Before and After, or leave both blank.`, 400, 'VALIDATION_ERROR');
    }
    if (!definition.units.includes(value.unit)) {
      throw new AppError(`${definition.label}: select the measurement unit.`, 400, 'VALIDATION_ERROR');
    }
    return {
      component: definition.component, parameter: definition.label,
      action_type: Number(before) === Number(after) ? 'No Change' : 'Adjusted',
      before_value: before, after_value: after, unit: value.unit,
    };
  }).filter(Boolean);
  if (!changes.length) throw new AppError('Complete at least one Before / After measurement pair.', 400, 'VALIDATION_ERROR');
  const attempt = {
    repair_date: payload.repair_date,
    technician: user && user.name,
    diagnosis: 'Measurements recorded via Quick Entry.',
    repair_notes: payload.notes,
    changes,
  };
  return withTransaction(() => {
    const context = quickEntryContext(testId);
    if (context.reason) throw new AppError(context.reason, 409, 'QUICK_ENTRY_UNAVAILABLE');
    if (!context.repairCase) return createRepairCase({ initial_test_id: testId, attempt }, user);
    if (context.linkPrevious) linkRetest(context.previous.id, { after_test_id: testId }, user);
    // The durable identity still resolves after a cache clear/reimport.
    if (!context.linkPrevious && !context.previous.after_test_id) {
      db.run('UPDATE injector_repair_attempts SET after_test_id = ? WHERE id = ?', [testId, context.previous.id]);
    }
    return addRepairAttempt(context.repairCase.id, attempt, user);
  });
}

module.exports = {
  ACTIVE_CASE_STATUSES,
  COMPONENT_OPTIONS,
  ACTION_OPTIONS,
  measurementSnapshot,
  createRepairCase,
  addRepairAttempt,
  linkRetest,
  setCaseStatus,
  getRepairHistory,
  loadCase,
  getQuickEntry,
  saveQuickEntry,
};
