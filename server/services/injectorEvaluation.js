'use strict';
/**
 * Shipment / supplier evaluation analytics for a selected group of injectors.
 *
 * Pure calculations only — no database, no pdfkit. The PDF layer consumes the
 * numbers produced here, which keeps the maths unit-testable and lets any other
 * consumer (API, UI, export) reuse exactly the same figures.
 *
 * Terminology used throughout:
 *   • "test point"  — one bench test step (IVM01 … IVM06, LKT01, RSP …)
 *   • "passing injector" — an injector that passed its COMPLETE test; only
 *     these take part in the consistency analysis.
 */

const {
  IVM_FLOW_CODES,
  STEP_DISPLAY_NAMES,
  isFlushStep,
  stepCode,
  stepLabel,
  stepErrorInfo,
  numericValue,
} = require('./injectorSteps');

const PASS = 'pass';
const FAIL = 'fail';
const UNKNOWN = 'unknown';

/** Customer-facing test steps for one injector (excludes the internal flush). */
function testPointsOf(injector) {
  return (injector && Array.isArray(injector.tests) ? injector.tests : []).filter((t) => !isFlushStep(t));
}

/**
 * Overall outcome of one injector: 'pass' | 'fail' | 'unknown'.
 * An errored step — including one on the internal flush diagnostic, which
 * aborts the run — is a failure, never a pass.
 */
function injectorOutcome(injector) {
  if (!injector) return UNKNOWN;
  const all = Array.isArray(injector.tests) ? injector.tests : [];
  if (all.some((t) => stepErrorInfo(t).errored)) return FAIL;

  const scored = testPointsOf(injector).filter((t) => t.primary && t.status !== 'skip');
  if (scored.length === 0) {
    if (injector.overall_pass === 1) return PASS;
    if (injector.overall_pass === 0) return FAIL;
    return UNKNOWN;
  }
  return scored.some((t) => t.status === FAIL) ? FAIL : PASS;
}

/** Percentage helper that never divides by zero. */
function percentage(part, total) {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return (Number(part) / t) * 100;
}

/** Distinct, order-preserving list of non-empty values. */
function distinct(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = v == null ? '' : String(v).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Headline numbers for the selected batch.
 * Injectors with no scored result count towards the total but are reported
 * separately so pass% + fail% never silently absorb them.
 */
function summarise(injectors = []) {
  const list = Array.isArray(injectors) ? injectors : [];
  const outcomes = list.map(injectorOutcome);
  const passed = outcomes.filter((o) => o === PASS).length;
  const failed = outcomes.filter((o) => o === FAIL).length;
  const untested = outcomes.filter((o) => o === UNKNOWN).length;
  const total = list.length;

  const partNumbers = distinct(list.map((i) => i.part_number));
  const testDates = distinct(list.map((i) => String(i.test_datetime || '').slice(0, 10))).sort();

  return {
    total,
    passed,
    failed,
    untested,
    passPct: percentage(passed, total),
    failPct: percentage(failed, total),
    partNumbers,
    partNumber: partNumbers.length === 1 ? partNumbers[0] : (partNumbers[0] || ''),
    multiplePartNumbers: partNumbers.length > 1,
    dateFrom: testDates[0] || '',
    dateTo: testDates.length ? testDates[testDates.length - 1] : '',
    brands: distinct(list.map((i) => i.brand)),
    injectorTypes: distinct(list.map((i) => i.injector_type)),
  };
}

/**
 * How many of the selected injectors failed each test point.
 *
 * One injector can fail several test points, so the counts sum to MORE than the
 * number of failed injectors — that is expected and documented on the report.
 * Steps are identified by their normalised code and shown with their mapped
 * display name (never the raw API error text).
 *
 * Returns [{ code, label, count, pct, order }] ranked most→least common.
 */
function failuresByTestPoint(injectors = []) {
  const list = Array.isArray(injectors) ? injectors : [];
  const points = new Map(); // code -> { code, label, count, order }
  let order = 0;

  for (const inj of list) {
    for (const t of testPointsOf(inj)) {
      const code = stepCode(t);
      if (!code) continue;
      if (!points.has(code)) {
        points.set(code, { code, label: stepLabel(t, 'primary', t.primary && t.primary.tank_name), count: 0, order: order++ });
      }
      const entry = points.get(code);
      const errored = stepErrorInfo(t).errored;
      if (errored || t.status === FAIL) entry.count += 1;
    }
  }

  const total = list.length;
  return [...points.values()]
    .map((p) => ({ ...p, pct: percentage(p.count, total) }))
    .sort((a, b) => (b.count - a.count) || (a.order - b.order));
}

/**
 * Delivery-flow consistency of the PASSING injectors, per IVM test point.
 *
 * For each IVM test point:
 *   1. keep only injectors that passed the complete test
 *   2. take that injector's measured delivery-flow value
 *   3. mean          = Σ measurements / n
 *   4. deviation_i   = |(measurement_i − mean) / mean| × 100
 *   5. avgDeviation  = Σ deviation_i / n
 *
 * A LOWER average absolute percentage deviation means a more consistent group.
 *
 * Two spread figures are reported alongside it:
 *   rangeDeviationPct         = (max − min) / min × 100 — how much higher the
 *                               highest passing injector is than the lowest
 *                               ("Maximum Deviation" on the report)
 *   maxIndividualDeviationPct = the largest single deviation from the mean
 *
 * Data handling:
 *   • failed injectors are excluded entirely
 *   • missing / non-numeric / error values are excluded from THAT test point
 *     only — the injector still counts at every other test point
 *   • a zero mean yields `avgDeviationPct: null` (no division by zero)
 *   • full precision is kept here; rounding happens in the presentation layer
 */
function consistencyOfPassingInjectors(injectors = [], codes = IVM_FLOW_CODES) {
  const list = Array.isArray(injectors) ? injectors : [];
  const passing = list.filter((inj) => injectorOutcome(inj) === PASS);

  return codes.map((code) => {
    const label = typeof STEP_DISPLAY_NAMES[code] === 'string' ? STEP_DISPLAY_NAMES[code] : code;
    const measurements = [];
    let unit = '';
    let excluded = 0;

    for (const inj of passing) {
      const step = testPointsOf(inj).find((t) => stepCode(t) === code);
      if (!step || !step.primary) { excluded += 1; continue; }
      if (!unit && step.primary.unit) unit = step.primary.unit;
      const value = stepErrorInfo(step).errored ? null : numericValue(step.primary.average);
      if (value == null) { excluded += 1; continue; }
      measurements.push(value);
    }

    const sampleCount = measurements.length;
    const empty = {
      code, label, unit, sampleCount, excludedCount: excluded,
      mean: null, minValue: null, maxValue: null,
      avgDeviationPct: null, rangeDeviationPct: null, maxIndividualDeviationPct: null,
      insufficient: true,
    };
    if (sampleCount === 0) {
      return { ...empty, note: 'No valid measurements from passing injectors' };
    }

    const minValue = Math.min(...measurements);
    const maxValue = Math.max(...measurements);
    const mean = measurements.reduce((a, b) => a + b, 0) / sampleCount;
    if (mean === 0) {
      return {
        ...empty,
        mean, minValue, maxValue,
        note: 'Mean is zero — percentage deviation is undefined',
      };
    }

    const deviations = measurements.map((v) => Math.abs((v - mean) / mean) * 100);
    const avgDeviationPct = deviations.reduce((a, b) => a + b, 0) / sampleCount;
    // "Maximum Deviation": how much higher the highest passing injector reads
    // than the lowest. Undefined when the lowest reading is zero.
    const rangeDeviationPct = minValue === 0 ? null : ((maxValue - minValue) / minValue) * 100;

    return {
      code,
      label,
      unit,
      sampleCount,
      excludedCount: excluded,
      mean,
      minValue,
      maxValue,
      avgDeviationPct,
      rangeDeviationPct,
      maxIndividualDeviationPct: Math.max(...deviations),
      // One measurement cannot describe group consistency.
      insufficient: sampleCount < 2,
      note: sampleCount < 2 ? 'Only one valid measurement — consistency not meaningful' : '',
    };
  });
}

/**
 * Everything the Shipment Evaluation Report needs, in one call.
 */
function evaluateShipment(injectors = []) {
  const list = Array.isArray(injectors) ? injectors : [];
  const summary = summarise(list);
  const failures = failuresByTestPoint(list);
  const consistency = consistencyOfPassingInjectors(list);
  const rated = consistency.filter((c) => c.avgDeviationPct != null && !c.insufficient);

  return {
    summary,
    failures,
    consistency,
    // Group-level roll-up of the deviation analysis, for the chart captions.
    consistencyOverall: rated.length
      ? {
          averageDeviationPct: rated.reduce((a, c) => a + c.avgDeviationPct, 0) / rated.length,
          bestPoint: rated.reduce((a, c) => (c.avgDeviationPct < a.avgDeviationPct ? c : a)),
          worstPoint: rated.reduce((a, c) => (c.avgDeviationPct > a.avgDeviationPct ? c : a)),
          ratedPoints: rated.length,
          // Widest lowest-to-highest spread across the rated test points.
          maxRangeDeviationPct: rated.reduce(
            (a, c) => (c.rangeDeviationPct != null && c.rangeDeviationPct > a ? c.rangeDeviationPct : a),
            0
          ),
        }
      : null,
    outcomes: list.map((inj) => ({
      id: inj.id,
      serial_number: inj.serial_number,
      outcome: injectorOutcome(inj),
    })),
  };
}

module.exports = {
  PASS,
  FAIL,
  UNKNOWN,
  injectorOutcome,
  percentage,
  summarise,
  failuresByTestPoint,
  consistencyOfPassingInjectors,
  evaluateShipment,
};
