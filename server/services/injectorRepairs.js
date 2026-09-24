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
const { partKey, sameUnitSerials, unitResolver } = require('./injectorUnits');
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

/** Every serial recorded for a part number, on tests and on repair cases. */
function knownSerials(partNumber) {
  return db.all(
    `SELECT serial_number FROM injector_test_reports
      WHERE part_number = ? COLLATE NOCASE AND serial_number IS NOT NULL AND serial_number != ''
     UNION
     SELECT serial_number FROM injector_repair_cases WHERE part_number = ? COLLATE NOCASE`,
    [partNumber || '', partNumber || '']
  ).map((row) => row.serial_number);
}

/**
 * The stored spellings of this injector's serial number — the same unit
 * entered differently, e.g. 260521828A / 260521828 / 828 (see
 * services/injectorUnits.js). Empty when there is no serial.
 */
function unitSerials(partNumber, serialNumber) {
  if (!text(serialNumber, 200)) return [];
  return sameUnitSerials(serialNumber, knownSerials(partNumber));
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

/** Same part number and the same physical unit. */
function sameIdentity(left, right) {
  if (partKey(left.part_number) !== partKey(right.part_number)) return false;
  const resolve = unitResolver([...knownSerials(left.part_number), left.serial_number, right.serial_number]);
  const key = resolve(left.serial_number);
  return !!key && key === resolve(right.serial_number);
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
  const serials = unitSerials(test.part_number, test.serial_number);
  if (!serials.length) return undefined;
  return db.get(
    `SELECT * FROM injector_repair_cases
      WHERE part_number = ? COLLATE NOCASE
        AND serial_number IN (${placeholders(serials)})
        AND status IN ('OPEN', 'HOLD', 'ENGINEERING_REVIEW')
      ORDER BY datetime(opened_at) DESC LIMIT 1`,
    [test.part_number || '', ...serials]
  );
}

/**
 * The newest test already in this injector's repair history (any case). A new
 * repair case has to start on a later result, so repairs and retests always
 * run forward in test order.
 */
function latestHistoryTestAt(test) {
  const serials = unitSerials(test.part_number, test.serial_number);
  if (!serials.length) return null;
  const row = db.get(
    `SELECT MAX(datetime(COALESCE(a.after_test_datetime, a.before_test_datetime))) AS latest
       FROM injector_repair_attempts a
       JOIN injector_repair_cases c ON c.id = a.repair_case_id
      WHERE c.part_number = ? COLLATE NOCASE AND c.serial_number IN (${placeholders(serials)})`,
    [test.part_number || '', ...serials]
  );
  return row && row.latest ? row.latest : null;
}

function isOlderThanHistory(test) {
  const latest = latestHistoryTestAt(test);
  if (!latest) return false;
  // SQLite's datetime() is UTC without a zone marker.
  return new Date(test.test_datetime || 0) <= new Date(`${latest.replace(' ', 'T')}Z`);
}

const OLDER_THAN_HISTORY = 'This result is not newer than the repair history already recorded for this injector. Start a new repair on a later result.';

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
  if (isOlderThanHistory(initialTest)) {
    throw new AppError(OLDER_THAN_HISTORY, 409, 'OLDER_THAN_HISTORY');
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
    autoLinkRetests({ caseId, user });
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
    autoLinkRetests({ caseId: repairCase.id, user });
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
  // A repair belongs to the result it was recorded on, so its retest is any
  // later result. The entered repair date is not used here: it defaults to the
  // time of data entry, which is often after the retest was already run.
  if (new Date(afterTest.test_datetime || 0) <= new Date(repairedAt(attempt))) {
    throw new AppError('The retest must be a later test than the result this repair was recorded on.', 400, 'INVALID_RETEST_DATE');
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

/** The serial as entered on an attempt's before/after test (null once cleared). */
function testSerial(attempt, prefix) {
  const id = attempt[`${prefix}_test_id`];
  const extId = attempt[`${prefix}_report_ext_id`];
  const row = (id && db.get('SELECT serial_number FROM injector_test_reports WHERE id = ?', [id]))
    || (extId != null && db.get(
      'SELECT serial_number FROM injector_test_reports WHERE report_ext_id = ? AND slot_position = ?',
      [extId, attempt[`${prefix}_slot_position`]]
    ));
  return row ? row.serial_number : null;
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
    before_serial_number: testSerial(attempt, 'before'),
    after_serial_number: testSerial(attempt, 'after'),
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

/** When the result a repair was recorded on was tested (the repair follows it). */
function repairedAt(attempt) {
  return attempt.before_test_datetime || attempt.repair_date;
}

/** Later results for the injector that are not already some repair's retest, oldest first. */
function candidateRetests(repairCase, attempt) {
  if (!repairCase || !attempt || attempt.status !== 'WAITING_RETEST') return [];
  const serials = unitSerials(repairCase.part_number, repairCase.serial_number);
  if (!serials.length) return [];
  return db.all(
    `SELECT r.id, r.report_ext_id, r.slot_position, r.part_number, r.serial_number,
            r.test_datetime, r.result_status, r.steps_total, r.steps_passed, r.steps_failed
       FROM injector_test_reports r
      WHERE r.part_number = ? COLLATE NOCASE
        AND r.serial_number IN (${placeholders(serials)})
        AND datetime(r.test_datetime) > datetime(?)
        AND r.id != ?
        AND NOT EXISTS (
          SELECT 1 FROM injector_repair_attempts used
           WHERE used.after_test_id = r.id
              OR (used.after_report_ext_id = r.report_ext_id AND used.after_slot_position = r.slot_position)
        )
      ORDER BY datetime(r.test_datetime) ASC, r.report_ext_id ASC, r.slot_position ASC`,
    [repairCase.part_number || '', ...serials,
      repairedAt(attempt), attempt.before_test_id || '']
  );
}

/**
 * Link every repair still waiting for a retest to the next result for that
 * injector, when one has been synced. Runs after a repair is recorded, after a
 * CarbonZapp sync and at startup. Returns how many repairs were linked.
 */
function autoLinkRetests({ caseId = null, user = null } = {}) {
  const waiting = db.all(
    `SELECT a.id FROM injector_repair_attempts a
       JOIN injector_repair_cases c ON c.id = a.repair_case_id
      WHERE a.status = 'WAITING_RETEST'
        AND c.status IN ('OPEN', 'HOLD', 'ENGINEERING_REVIEW')
        ${caseId ? 'AND c.id = ?' : ''}
      ORDER BY datetime(a.repair_date) ASC`,
    caseId ? [caseId] : []
  );
  let linked = 0;
  for (const { id } of waiting) {
    const attempt = db.get('SELECT * FROM injector_repair_attempts WHERE id = ?', [id]);
    const repairCase = attempt && db.get('SELECT * FROM injector_repair_cases WHERE id = ?', [attempt.repair_case_id]);
    const [retest] = candidateRetests(repairCase, attempt);
    if (!retest) continue;
    try {
      linkRetest(attempt.id, { after_test_id: retest.id }, user);
      linked += 1;
    } catch (err) {
      console.warn(`[Repairs] Could not link a retest to repair attempt ${attempt.id}:`, err.message);
    }
  }
  return linked;
}

function identityKey(reportExtId, slotPosition) {
  return reportExtId == null ? null : `${reportExtId}\u0000${Number(slotPosition) || 0}`;
}

/**
 * Each result's own part in a repair, for the test list:
 *   repair_attempt_number  the repair recorded on this result
 *   retest_of_attempt      the repair this result is the retest of
 * A result with neither gets nothing — a repair is never stamped onto every
 * result for the injector. Matching falls back to report id + slot, so it
 * survives Clear All and a re-import.
 */
function repairRolesForTests(rows) {
  if (!rows.length) return rows;
  const attempts = db.all(
    `SELECT a.repair_case_id, a.attempt_number, a.status, a.outcome,
            a.before_test_id, a.before_report_ext_id, a.before_slot_position,
            a.after_test_id, a.after_report_ext_id, a.after_slot_position,
            c.status AS case_status
       FROM injector_repair_attempts a
       JOIN injector_repair_cases c ON c.id = a.repair_case_id`,
    []
  );
  const lookup = (prefix) => {
    const byId = new Map();
    const byIdentity = new Map();
    for (const attempt of attempts) {
      if (attempt[`${prefix}_test_id`]) byId.set(attempt[`${prefix}_test_id`], attempt);
      const key = identityKey(attempt[`${prefix}_report_ext_id`], attempt[`${prefix}_slot_position`]);
      if (key) byIdentity.set(key, attempt);
    }
    return (row) => byId.get(row.id) || byIdentity.get(identityKey(row.report_ext_id, row.slot_position)) || null;
  };
  const repairOn = lookup('before');
  const retestOf = lookup('after');
  return rows.map((row) => {
    const repair = repairOn(row);
    const retest = retestOf(row);
    if (!repair && !retest) return row;
    const owner = repair || retest;
    return {
      ...row,
      repair_case_id: owner.repair_case_id,
      repair_case_status: owner.case_status,
      repair_attempt_number: repair ? Number(repair.attempt_number) : null,
      repair_attempt_status: repair ? repair.status : null,
      retest_of_attempt: retest ? Number(retest.attempt_number) : null,
      retest_outcome: retest ? retest.outcome : null,
    };
  });
}

function getRepairHistory(testId) {
  const test = getTest(testId);
  const serials = unitSerials(test.part_number, test.serial_number);
  const sameUnit = serials.length
    ? `(part_number = ? COLLATE NOCASE AND serial_number IN (${placeholders(serials)})) OR `
    : '';
  const cases = db.all(
    `SELECT id FROM injector_repair_cases
      WHERE ${sameUnit}initial_test_id = ? OR final_test_id = ?
      ORDER BY datetime(opened_at) DESC`,
    [...(serials.length ? [test.part_number || '', ...serials] : []), test.id, test.id]
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
    can_start: statusOfTest(test) === 'FAIL' && !!test.serial_number && !activeCase && !isOlderThanHistory(test),
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
      if (matchesSavedTest(test, previous, 'before')) {
        reason = `Repair #${previous.attempt_number} is already recorded on this result. Run and sync the retest, then record the next repair on that result.`;
      } else if (candidateRetests(repairCase, previous).some((row) => row.id === test.id)) {
        linkPrevious = true;
      } else {
        reason = `This result is older than Repair #${previous.attempt_number}. Record repairs on the latest result for this injector.`;
      }
    } else if (!matchesSavedTest(test, previous, 'after')) {
      reason = `Record Repair #${Number(previous.attempt_number) + 1} on the retest of Repair #${previous.attempt_number}.`;
    }
  } else if (isOlderThanHistory(test)) {
    reason = OLDER_THAN_HISTORY;
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
  autoLinkRetests,
  repairRolesForTests,
};
