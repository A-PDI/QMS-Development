'use strict';
/**
 * Granular filtering of synced injector test records.
 *
 * The list page filters on two different kinds of data:
 *
 *   • ROW data — part number, serial number, overall result, test date. These
 *     live in real columns on `injector_test_reports` and are filtered in SQL.
 *   • STEP data — "which injectors failed the Peak Torque - Return point?".
 *     Individual test steps only exist inside the stored `report_json`, so that
 *     filtering happens here, in JavaScript, over hydrated rows.
 *
 * Everything in this file is a pure function over already-hydrated injector
 * objects (`{ part_number, serial_number, …, tests: [...] }`), which keeps the
 * rules unit-testable and lets the list route, the export service and any
 * future consumer share exactly one definition of "failed this test step".
 *
 * A MEASUREMENT POINT is the unit a step filter selects. It is normally the
 * test step itself (LKT01, IVM01 …), except for Peak Torque, whose Delivery and
 * Return tanks are judged independently and therefore appear as two selectable
 * points (IVM06-D / IVM06-R). That is the same identity the Shipment Evaluation
 * report's most-common-failure chart uses, so the two always agree.
 */

const {
  isFlushStep,
  stepCode,
  stepLabel,
} = require('./injectorSteps');
const {
  PASS,
  FAIL,
  DNF,
  UNKNOWN,
  SKIP,
  measurementOutcome,
  stepOutcome,
  injectorOutcome,
} = require('./injectorResult');

// Outcomes a step filter can ask for. `any` means "the injector ran this test
// point at all", whatever the result.
const STEP_STATUSES = [PASS, FAIL, DNF, 'any'];
// Whether the injector must match on ONE of the selected points or on ALL.
const STEP_MATCH_MODES = ['any', 'all'];
// Overall result values the status filter accepts.
const RESULT_STATUSES = [PASS, FAIL, DNF, UNKNOWN];

// The one step whose two tanks are separately selectable (see the note above).
const SPLIT_TANK_CODE = 'IVM06';

/**
 * Split a user-supplied filter value into individual tokens.
 *
 * Accepts an array or a single string and treats commas, semicolons, pipes and
 * any whitespace (so a column pasted from a spreadsheet works) as separators.
 * Neither part numbers nor bench serial numbers contain spaces.
 */
function parseList(value) {
  const raw = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (entry == null) continue;
    for (const token of String(entry).split(/[\s,;|]+/)) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/** Normalise one overall-result value ("Passed" → "pass"). */
function normaliseResultStatus(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (s === PASS || s === 'passed') return PASS;
  if (s === FAIL || s === 'failed') return FAIL;
  if (s === DNF) return DNF;
  if (s === 'unscored' || s === UNKNOWN) return UNKNOWN;
  return '';
}

/** Normalise a step-outcome filter value; '' when it is not a known one. */
function normaliseStepStatus(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (s === 'any' || s === 'all') return s === 'all' ? 'any' : s;
  const mapped = normaliseResultStatus(s);
  return mapped === UNKNOWN ? '' : mapped;
}

/** The overall result stored on a row, without re-deriving it from steps. */
function rowResultStatus(injector) {
  const stored = normaliseResultStatus(injector && injector.result_status);
  if (stored) return stored;
  if (injector && injector.overall_pass === 1) return PASS;
  if (injector && injector.overall_pass === 0) return FAIL;
  return UNKNOWN;
}

/** The date part of a test timestamp ("2026-06-30"), or '' when unparseable. */
function testDate(value) {
  const raw = String(value == null ? '' : value).trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Every measurement point of one injector, with the outcome the shared
 * classifier gives it. The internal FL(W) flush diagnostic is never a point.
 *
 * Returns [{ code, label, outcome, order }] in bench test order.
 */
function measurementPoints(injector) {
  const steps = (injector && Array.isArray(injector.tests) ? injector.tests : []).filter((t) => !isFlushStep(t));
  const points = [];
  steps.forEach((step, index) => {
    const code = stepCode(step);
    if (!code) return;
    const order = Number.isFinite(Number(step.order)) ? Number(step.order) : index;
    if (code === SPLIT_TANK_CODE) {
      const tanks = [
        { suffix: 'D', role: 'primary', tank: step.primary },
        { suffix: 'R', role: 'secondary', tank: step.secondary },
      ];
      for (const { suffix, role, tank } of tanks) {
        if (!tank) continue;
        points.push({
          code: `${code}-${suffix}`,
          label: stepLabel(step, role, tank.tank_name),
          outcome: measurementOutcome(step, tank),
          order,
        });
      }
      return;
    }
    points.push({
      code,
      label: stepLabel(step, 'primary', step.primary && step.primary.tank_name),
      outcome: stepOutcome(step),
      order,
    });
  });
  return points;
}

/** code → outcome for one injector, for repeated lookups while filtering. */
function measurementIndex(injector) {
  const index = new Map();
  for (const point of measurementPoints(injector)) {
    // A code can only appear once per injector; first occurrence wins.
    if (!index.has(point.code)) index.set(point.code, point);
  }
  return index;
}

/**
 * The measurement points present across a set of injectors, with how many
 * injectors passed / failed / did not finish each one.
 *
 * Ordered by the bench's own test order so the picker reads like the test
 * sequence rather than like a hash-map dump.
 *
 * Returns [{ code, label, total, pass, fail, dnf, other, order }].
 */
function stepCatalog(injectors = []) {
  const list = Array.isArray(injectors) ? injectors : [];
  const byCode = new Map();
  let seen = 0;

  for (const injector of list) {
    for (const point of measurementPoints(injector)) {
      if (!byCode.has(point.code)) {
        byCode.set(point.code, {
          code: point.code,
          label: point.label,
          total: 0,
          pass: 0,
          fail: 0,
          dnf: 0,
          other: 0,
          order: point.order,
          firstSeen: seen++,
        });
      }
      const entry = byCode.get(point.code);
      // Keep the earliest bench order seen for this point.
      if (Number.isFinite(point.order) && point.order < entry.order) entry.order = point.order;
      entry.total += 1;
      if (point.outcome === PASS) entry.pass += 1;
      else if (point.outcome === FAIL) entry.fail += 1;
      else if (point.outcome === DNF) entry.dnf += 1;
      else entry.other += 1;
    }
  }

  return [...byCode.values()]
    .sort((a, b) => (a.order - b.order) || (a.firstSeen - b.firstSeen))
    .map(({ firstSeen, ...entry }) => entry);
}

/** Codes of the selected points this injector matched, in selection order. */
function matchedStepCodes(injector, { steps = [], stepStatus = FAIL } = {}) {
  const wanted = normaliseStepStatus(stepStatus) || FAIL;
  const index = measurementIndex(injector);
  return steps.filter((code) => {
    const point = index.get(code);
    if (!point) return false;
    return wanted === 'any' ? true : point.outcome === wanted;
  });
}

/**
 * Human-readable labels for the selected points this injector matched — what
 * the list row and the export show to explain why the record is included.
 */
function matchedStepLabels(injector, criteria = {}) {
  const index = measurementIndex(injector);
  return matchedStepCodes(injector, criteria).map((code) => {
    const point = index.get(code);
    return point ? point.label : code;
  });
}

/** True when the injector satisfies the step criteria (or there are none). */
function matchesStepCriteria(injector, { steps = [], stepStatus = FAIL, stepMatch = 'any' } = {}) {
  const codes = Array.isArray(steps) ? steps.filter(Boolean) : [];
  if (codes.length === 0) return true;
  const matched = matchedStepCodes(injector, { steps: codes, stepStatus });
  return String(stepMatch).toLowerCase() === 'all'
    ? matched.length === codes.length
    : matched.length > 0;
}

/**
 * Normalise a raw criteria object (query string or request body) into the
 * canonical shape the matchers use.
 */
function normaliseCriteria(raw = {}) {
  const steps = parseList(raw.steps != null ? raw.steps : raw.step_codes)
    .map((code) => String(code).trim().toUpperCase())
    .filter(Boolean);
  const statuses = parseList(raw.statuses != null ? raw.statuses : raw.status)
    .map(normaliseResultStatus)
    .filter(Boolean);
  const stepMatch = String(raw.stepMatch != null ? raw.stepMatch : raw.step_match || 'any').toLowerCase();

  return {
    search: String(raw.search == null ? '' : raw.search).trim(),
    partNumbers: parseList(raw.partNumbers != null ? raw.partNumbers : raw.part_number),
    serialNumbers: parseList(raw.serialNumbers != null ? raw.serialNumbers : raw.serial_number),
    statuses: [...new Set(statuses)],
    dateFrom: testDate(raw.dateFrom != null ? raw.dateFrom : raw.date_from),
    dateTo: testDate(raw.dateTo != null ? raw.dateTo : raw.date_to),
    steps: [...new Set(steps)],
    stepStatus: normaliseStepStatus(raw.stepStatus != null ? raw.stepStatus : raw.step_status) || FAIL,
    stepMatch: STEP_MATCH_MODES.includes(stepMatch) ? stepMatch : 'any',
  };
}

/** True when any token is a case-insensitive substring of `value`. */
function matchesAnyToken(value, tokens = []) {
  if (!tokens.length) return true;
  const haystack = String(value == null ? '' : value).toLowerCase();
  return tokens.some((token) => haystack.includes(String(token).toLowerCase()));
}

/** True when the injector satisfies every part of the criteria. */
function matchesInjector(injector, criteria = {}) {
  const c = criteria.__normalised ? criteria : normaliseCriteria(criteria);
  if (!injector) return false;

  if (c.search) {
    const needle = c.search.toLowerCase();
    const haystack = `${injector.part_number || ''} ${injector.serial_number || ''}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (!matchesAnyToken(injector.part_number, c.partNumbers)) return false;
  if (!matchesAnyToken(injector.serial_number, c.serialNumbers)) return false;
  if (c.statuses.length && !c.statuses.includes(rowResultStatus(injector))) return false;

  if (c.dateFrom || c.dateTo) {
    const date = testDate(injector.test_datetime);
    if (c.dateFrom && (!date || date < c.dateFrom)) return false;
    if (c.dateTo && (!date || date > c.dateTo)) return false;
  }

  return matchesStepCriteria(injector, c);
}

/** Apply the full criteria to a list of hydrated injectors. */
function filterInjectors(injectors = [], criteria = {}) {
  const c = { ...normaliseCriteria(criteria), __normalised: true };
  return (Array.isArray(injectors) ? injectors : []).filter((injector) => matchesInjector(injector, c));
}

/** True when the criteria contain anything that needs the stored step data. */
function needsStepData(criteria = {}) {
  const c = criteria.__normalised ? criteria : normaliseCriteria(criteria);
  return c.steps.length > 0;
}

/**
 * True when the criteria narrow anything at all.
 *
 * Used to tell "export what the filters match" apart from "export nothing was
 * asked for" — never to describe a filter on an exported file, which carries no
 * record of how its injectors were chosen.
 */
function hasCriteria(criteria = {}) {
  const c = criteria.__normalised ? criteria : normaliseCriteria(criteria);
  return Boolean(
    c.search || c.partNumbers.length || c.serialNumbers.length || c.statuses.length ||
    c.dateFrom || c.dateTo || c.steps.length
  );
}

module.exports = {
  PASS,
  FAIL,
  DNF,
  UNKNOWN,
  SKIP,
  STEP_STATUSES,
  STEP_MATCH_MODES,
  RESULT_STATUSES,
  SPLIT_TANK_CODE,
  parseList,
  normaliseResultStatus,
  normaliseStepStatus,
  normaliseCriteria,
  rowResultStatus,
  testDate,
  measurementPoints,
  measurementIndex,
  stepCatalog,
  matchedStepCodes,
  matchedStepLabels,
  matchesStepCriteria,
  matchesInjector,
  filterInjectors,
  needsStepData,
  hasCriteria,
  injectorOutcome,
};
