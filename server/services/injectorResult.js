'use strict';

/**
 * Shared injector-result classification.
 *
 * A bench error is not automatically a component failure.  It is a DNF when
 * every completed customer test point before the interruption passed.  It is
 * a failure only when a prior point failed or a measured value at the errored
 * point is outside its defined green acceptance band.
 */

const {
  isFlushStep,
  measuredValue,
  numericValue,
  stepErrorInfo,
} = require('./injectorSteps');

const PASS = 'pass';
const FAIL = 'fail';
const DNF = 'dnf';
const UNKNOWN = 'unknown';
const SKIP = 'skip';
const EPS = 1e-6;

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function tankMeasurement(tank) {
  return numericValue(measuredValue(tank));
}

/**
 * Whether the bench actually evaluated this measurement.
 *
 * CarbonZapp writes 0/0.0 into interrupted steps that never ran. The report
 * layer has always rendered that combination as "No Test"; treating the same
 * placeholder as an out-of-range result here would incorrectly turn a bench
 * interruption into a component failure.
 */
function tankWasEvaluated(step, tank) {
  const value = tankMeasurement(tank);
  if (value == null) return false;
  if (stepErrorInfo(step).errored && Math.abs(value) <= EPS) return false;
  return true;
}

function tankHasDefinedRange(tank) {
  if (!tank) return false;
  return finiteNumber(tank.min_green) != null || finiteNumber(tank.max_green) != null;
}

function tankOutOfBounds(tank, step = null) {
  const value = tankMeasurement(tank);
  if (!tankWasEvaluated(step, tank) || !tankHasDefinedRange(tank)) return false;
  const min = finiteNumber(tank.min_green);
  const max = finiteNumber(tank.max_green);
  return (min != null && value < min - EPS) || (max != null && value > max + EPS);
}

/** Outcome for one Delivery/Return measurement at a test point. */
function measurementOutcome(step, tank) {
  if (!tank) return stepErrorInfo(step).errored ? DNF : UNKNOWN;
  if (stepErrorInfo(step).errored) {
    if (tankOutOfBounds(tank, step)) return FAIL;
    if (tankWasEvaluated(step, tank) && tankHasDefinedRange(tank)) return PASS;
    return DNF;
  }
  if (tank.status === FAIL) return FAIL;
  if (tank.status === PASS) return PASS;
  return tank.status === SKIP ? SKIP : UNKNOWN;
}

/** True only for a demonstrated component failure, never for an unmeasured DNF. */
function stepHasExplicitFailure(step) {
  if (!step) return false;
  if (stepErrorInfo(step).errored) {
    return [step.primary, step.secondary].filter(Boolean).some((tank) => tankOutOfBounds(tank, step));
  }
  return step.status === FAIL
    || [step.primary, step.secondary].filter(Boolean).some((tank) => tank.status === FAIL);
}

function stepOutcome(step) {
  if (!step || step.skipped) return SKIP;
  if (stepHasExplicitFailure(step)) return FAIL;
  if (stepErrorInfo(step).errored) return DNF;
  if (step.status === SKIP) return SKIP;
  const measurements = [step.primary, step.secondary].filter(Boolean).map((tank) => measurementOutcome(step, tank));
  return measurements.includes(PASS) || step.status === PASS ? PASS : UNKNOWN;
}

function customerTestPoints(injector) {
  return (injector && Array.isArray(injector.tests) ? injector.tests : []).filter((step) => !isFlushStep(step));
}

function orderedTests(injector) {
  const list = injector && Array.isArray(injector.tests) ? injector.tests : [];
  return list
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      const ao = finiteNumber(a.step && a.step.order);
      const bo = finiteNumber(b.step && b.step.order);
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      return a.index - b.index;
    })
    .map(({ step }) => step);
}

function storedOutcome(injector) {
  const status = String(injector && injector.result_status || '').trim().toLowerCase();
  if (status === PASS || status === 'passed') return PASS;
  if (status === FAIL || status === 'failed') return FAIL;
  if (status === DNF) return DNF;
  if (injector && injector.overall_pass === 1) return PASS;
  if (injector && injector.overall_pass === 0) return FAIL;
  return UNKNOWN;
}

/** Overall result: pass | fail | dnf | unknown. */
function injectorOutcome(injector) {
  if (!injector) return UNKNOWN;
  const all = orderedTests(injector);
  if (!all.length) return storedOutcome(injector);

  const errorIndex = all.findIndex((step) => stepErrorInfo(step).errored);
  if (errorIndex !== -1) {
    const priorCustomerSteps = all.slice(0, errorIndex).filter((step) => !isFlushStep(step));
    if (priorCustomerSteps.some(stepHasExplicitFailure)) return FAIL;

    const errorStep = all[errorIndex];
    if (!isFlushStep(errorStep) && stepHasExplicitFailure(errorStep)) return FAIL;
    return DNF;
  }

  const points = all.filter((step) => !isFlushStep(step));
  if (points.some(stepHasExplicitFailure)) return FAIL;
  if (points.some((step) => stepOutcome(step) === PASS)) return PASS;
  return storedOutcome(injector);
}

function outcomeToOverallPass(outcome) {
  if (outcome === PASS) return 1;
  if (outcome === FAIL) return 0;
  return null;
}

/** Persistable row-level result and step counters from one shared rule set. */
function injectorScorecard(injector) {
  const points = customerTestPoints(injector)
    .filter((step) => step && !step.skipped && (step.primary || stepErrorInfo(step).errored));
  const outcome = injectorOutcome(injector);
  return {
    outcome,
    overallPass: outcomeToOverallPass(outcome),
    stepsTotal: points.length,
    stepsPassed: points.filter((step) => stepOutcome(step) === PASS).length,
    stepsFailed: points.filter(stepHasExplicitFailure).length,
  };
}

module.exports = {
  PASS,
  FAIL,
  DNF,
  UNKNOWN,
  SKIP,
  tankMeasurement,
  tankWasEvaluated,
  tankHasDefinedRange,
  tankOutOfBounds,
  measurementOutcome,
  stepHasExplicitFailure,
  stepOutcome,
  customerTestPoints,
  injectorOutcome,
  outcomeToOverallPass,
  injectorScorecard,
};
