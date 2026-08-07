'use strict';
/**
 * Injector test-step naming, normalisation and error parsing.
 *
 * The CarbonZapp bench sends one raw `TestInfo.test_name` per step. Besides the
 * step code itself, that string can carry a trailing status/anomaly note:
 *
 *   "iVM.06"                                → normal step
 *   "eRL : SKIPPED"                         → step was skipped
 *   "iVM.06 : HP ERROR (out of range) #1000"→ step errored on the bench
 *
 * Everything the app shows to a user must treat those three cases the same way:
 * the TEST-STEP NAME always comes from the step CODE (via STEP_DISPLAY_NAMES),
 * and an error only ever affects the RESULT VALUE ("Error: Out of Range").
 * Keeping that logic here — instead of in each consumer — is what stops an API
 * error from leaking into a step name in the app, the inspection form or a PDF.
 */

// Canonical display names, keyed by NORMALISED step code (see normaliseStepCode).
// "eRL" is the one step that reports two unrelated measurements off the same
// step (Resistance / Inductance), so it gets a distinct name per tank role.
const STEP_DISPLAY_NAMES = {
  ERL: { primary: 'Resistance', secondary: 'Inductance' },
  LKT01: 'Low Pressure Leak',
  LKT02: 'High Pressure Leak',
  WARMUP: 'Warm Up',
  IVM01: 'Peak HP',
  IVM02: 'Emissions',
  IVM03: 'Low Idle',
  IVM04: 'Mid-Range',
  IVM05: 'Cranking',
  IVM06: 'Peak Torque',
  RSP: 'Response Time',
  ANOP: 'Opening Pressure',
  FLW: 'Flush',
};

// Delivery-flow test points used by the passing-injector consistency analysis.
const IVM_FLOW_CODES = ['IVM01', 'IVM02', 'IVM03', 'IVM04', 'IVM05', 'IVM06'];

// FL(W) is an internal bench flush/prep diagnostic, not a customer-facing test.
const FLUSH_CODE = 'FLW';

// Words that stay lower-case inside a title-cased error description.
const SMALL_WORDS = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'in', 'to', 'at', 'by', 'for', 'on', 'with', 'from']);

// Suffix text that marks a step as errored even without the literal word
// "error" (the bench is not consistent about how it phrases these).
const ERROR_HINTS = /(error|fail|out\s*of\s*range|invalid|timeout|timed\s*out|communication|abort|overflow|no\s*result|not\s*measured)/i;

/**
 * Bench errors that describe a KNOWN physical condition rather than a machine
 * fault. These are shown by their quality-department name and WITHOUT the
 * "Error:" prefix, because they are a test outcome the inspector recognises —
 * e.g. the bench's "out of range" on the return tank is an EXCESS RETURN.
 *
 * They are still failures: any step with one of these conditions fails, which
 * fails the injector in every downstream report.
 */
const NAMED_ERROR_CONDITIONS = [
  { match: /out\s*of\s*range/i, term: 'Excess Return' },
];

/** The named condition for a raw API error description, or null. */
function namedErrorCondition(rawText) {
  const raw = String(rawText == null ? '' : rawText);
  const hit = NAMED_ERROR_CONDITIONS.find((c) => c.match.test(raw));
  return hit ? hit.term : null;
}

/** True when a description is already a named condition (no "Error:" prefix). */
function isNamedErrorTerm(description) {
  const desc = String(description == null ? '' : description).trim().toLowerCase();
  return NAMED_ERROR_CONDITIONS.some((c) => c.term.toLowerCase() === desc);
}

/**
 * Split a raw bench step name into its code and any trailing status note.
 * Returns { raw, base, suffix, skipped, errored, errorRaw }.
 *   base     — the step code with the note removed ("iVM.06")
 *   errorRaw — the untouched API error description, preserved for logs/tooltips
 */
function splitStepName(rawName) {
  const raw = String(rawName == null ? '' : rawName).trim();
  const idx = raw.indexOf(':');
  if (idx === -1) {
    return { raw, base: raw, suffix: '', skipped: false, errored: false, errorRaw: '' };
  }
  const base = raw.slice(0, idx).trim();
  const suffix = raw.slice(idx + 1).trim();

  if (/^skipped$/i.test(suffix)) {
    return { raw, base, suffix, skipped: true, errored: false, errorRaw: '' };
  }
  // Treat the note as an error when it reads like one, or whenever the code in
  // front of it is a step we recognise (a known code + an unexpected note can
  // only be a bench anomaly — and must never become part of the step name).
  if (suffix && (ERROR_HINTS.test(suffix) || Object.prototype.hasOwnProperty.call(STEP_DISPLAY_NAMES, normaliseStepCode(base)))) {
    return { raw, base, suffix, skipped: false, errored: true, errorRaw: suffix };
  }
  // Unrecognised note on an unrecognised code — keep the name intact rather
  // than silently dropping information.
  return { raw, base: raw, suffix, skipped: false, errored: false, errorRaw: '' };
}

/**
 * Canonical, comparison-safe code for a step name. Handles the formatting
 * variations the bench and older records use:
 *   "iVM.01", "IVM01", "IVM 01", "ivm1"  → "IVM01"
 *   "eRL", "Warm Up", "FL(W)"            → "ERL", "WARMUP", "FLW"
 */
function normaliseStepCode(name) {
  const raw = String(name == null ? '' : name).trim();
  // Strip a trailing note first so "iVM.06 : HP ERROR" still normalises to IVM06.
  const colon = raw.indexOf(':');
  const base = colon === -1 ? raw : raw.slice(0, colon);
  const compact = base.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Zero-pad a single-digit index so IVM1 and IVM01 are the same test point.
  const m = /^([A-Z]+)(\d)$/.exec(compact);
  return m ? `${m[1]}0${m[2]}` : compact;
}

/** True when the step is the internal FL(W) flush diagnostic. */
function isFlushStep(nameOrStep) {
  const name = typeof nameOrStep === 'object' && nameOrStep !== null
    ? (nameOrStep.raw_name || nameOrStep.name || '')
    : nameOrStep;
  return normaliseStepCode(name) === FLUSH_CODE;
}

/** Alias kept for the sync layer, which filters internal steps before storing. */
function isInternalTestStep(testInfo) {
  return isFlushStep((testInfo && testInfo.test_name) || '');
}

// Only the "R" (return) tank gets a row-label suffix, e.g. "Peak HP [R]".
// Bench tank names already arrive bracketed ("[R]"), so strip brackets before
// comparing to avoid doubling them up into "[[R]]".
function tankSuffix(tankName) {
  const code = String(tankName || '').replace(/[[\]]/g, '').trim().toUpperCase();
  return code === 'R' ? ` [${code}]` : '';
}

/**
 * The customer-facing name of a test step. NEVER returns error text: an
 * unmapped code falls back to the bench code with any error note stripped.
 *
 * @param {string} rawName  raw bench name ("iVM.06 : HP ERROR (out of range)")
 * @param {string} role     'primary' | 'secondary' (tank role)
 * @param {string} tankName bench tank name, e.g. "[R]"
 */
function stepDisplayName(rawName, role = 'primary', tankName = '') {
  const { base } = splitStepName(rawName);
  const entry = STEP_DISPLAY_NAMES[normaliseStepCode(base)];
  if (entry && typeof entry === 'object') return entry[role] || entry.primary || base;
  const label = typeof entry === 'string' ? entry : (base || 'Step');
  return `${label}${tankSuffix(tankName)}`;
}

/** Title-case a description while preserving acronyms ("HP") and small words. */
function titleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      // Leave acronyms / codes untouched (HP, LP, #1000).
      if (/[A-Z]/.test(word) && !/[a-z]/.test(word)) return word;
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Turn the API's raw error text into a short human description. Known physical
 * conditions get their quality-department name; everything else preserves the
 * API's own wording:
 *   "HP ERROR (out of range) #1000" → "Excess Return"
 *   "ERROR: Communication Failure"  → "Communication Failure"
 *   "Invalid Measurement"           → "Invalid Measurement"
 */
function formatErrorDescription(rawText) {
  const raw = String(rawText == null ? '' : rawText).trim();
  if (!raw) return 'Test Error';

  const named = namedErrorCondition(raw);
  if (named) return named;

  let text;
  const paren = raw.match(/\(([^)]*[A-Za-z][^)]*)\)/);
  if (paren) {
    text = paren[1];
  } else {
    text = raw
      .replace(/#\s*\d+/g, ' ')        // bench error code, e.g. "#1000"
      .replace(/\berrors?\b/gi, ' ')   // the literal word ERROR
      .replace(/[:;,]+/g, ' ');
  }
  text = text.replace(/#\s*\d+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'Test Error';
  // Nothing left but a channel acronym ("HP") — say it errored.
  if (/^[A-Z]{1,3}$/.test(text)) return `${text} Error`;
  return titleCase(text);
}

/**
 * The value shown in a result cell for an errored step. Named conditions stand
 * on their own ("Excess Return"); anything else keeps the "Error:" prefix so a
 * machine fault reads clearly as one ("Error: Communication Failure").
 */
function formatErrorValue(description) {
  const desc = String(description || '').trim();
  if (!desc) return 'Error: Test Error';
  return isNamedErrorTerm(desc) ? desc : `Error: ${desc}`;
}

/** True when a stored result value is an error marker rather than a number. */
function isErrorValue(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return false;
  if (/^error\b/i.test(text)) return true;
  return isNamedErrorTerm(text);
}

/**
 * Numeric view of a measured value, or null when it is missing, non-numeric or
 * an error marker. Used by every calculation so error text can never be
 * silently coerced into 0.
 */
function numericValue(value) {
  if (value == null || value === '') return null;
  if (isErrorValue(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── Step-object helpers ───────────────────────────────────────────────────────
// These accept a NORMALISED step object (see carbonzapp.normaliseTests) and
// also cope with rows synced before the error fields existed, where the error
// text still lives inside the step name. Consumers therefore never have to know
// which vintage of data they are looking at.

/** Error state of a step: { errored, description, raw }. */
function stepErrorInfo(step) {
  if (!step) return { errored: false, description: '', raw: '' };
  if (step.errored) {
    const raw = step.error_raw || '';
    return {
      errored: true,
      description: step.error_description || formatErrorDescription(raw),
      raw,
    };
  }
  const parsed = splitStepName(step.raw_name || step.name || '');
  if (parsed.errored) {
    return { errored: true, description: formatErrorDescription(parsed.errorRaw), raw: parsed.errorRaw };
  }
  return { errored: false, description: '', raw: '' };
}

/** The step code with any error/skip note removed ("iVM.06"). */
function stepBaseName(step) {
  if (!step) return '';
  return splitStepName(step.raw_name || step.name || '').base;
}

/** Canonical code for a step object ("IVM06"). */
function stepCode(step) {
  return normaliseStepCode(stepBaseName(step));
}

/** Customer-facing label for one tank of a step — never contains error text. */
function stepLabel(step, role = 'primary', tankName = '') {
  return stepDisplayName(stepBaseName(step), role, tankName);
}

/**
 * Mean of the bench's raw reading list ("230.3~230.4~230.3"), or null.
 * The bench sends the individual readings alongside its own average, so this
 * recovers a measurement even from records synced before errored steps kept
 * their value.
 */
function averageOfRawResults(results) {
  // Blank entries are NOT zeros — an empty reading list means "no measurement".
  const parts = String(results == null ? '' : results)
    .split(/[~,;|]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const readings = parts.map(Number).filter((n) => Number.isFinite(n));
  if (!readings.length) return null;

  const mean = readings.reduce((a, b) => a + b, 0) / readings.length;
  // Match the precision the bench reported its readings with.
  const decimals = parts.reduce((max, s) => {
    const i = s.indexOf('.');
    return Math.max(max, i === -1 ? 0 : s.length - i - 1);
  }, 0);
  return Number(mean.toFixed(Math.min(decimals, 4)));
}

/**
 * The measurement the bench recorded for one tank, as a display string.
 * Returns '' when there is genuinely no reading.
 */
function measuredValue(tank) {
  if (!tank) return '';
  const average = tank.average == null ? '' : String(tank.average).trim();
  // Normal path: the stored average is the measurement.
  if (average && !isErrorValue(average)) return average;
  // Records synced before errored steps kept their value stored the error text
  // in `average` — the raw readings are still there, so use those.
  const recovered = averageOfRawResults(tank.results);
  return recovered == null ? '' : String(recovered);
}

// Shown on the first line when a flagged step recorded no delivery at all —
// a zero reading means the test never actually ran.
const NO_TEST_LABEL = 'No Test';

/**
 * The value shown for one tank of a step, as the line(s) to print.
 *
 * The MEASUREMENT normally wins: a step the bench flagged (e.g. an excess
 * return) still reports what it measured, and that number is what the report
 * shows — the failure is conveyed by the red/FAIL styling and the pass/fail
 * rollups, not by replacing the reading with text.
 *
 * Two exceptions, both about a flagged step with nothing to report:
 *   • a reading of ZERO on a flagged step means no delivery was measured, so
 *     the cell reads "No Test" over the condition ("Excess Return")
 *   • no reading at all falls back to the condition on its own
 */
function stepResultLines(step, tank) {
  const err = stepErrorInfo(step);
  const measured = measuredValue(tank);

  if (err.errored) {
    const condition = formatErrorValue(err.description);
    if (!measured) return [condition];
    // A zero on a flagged step is "nothing came through", not a measurement.
    if (numericValue(measured) === 0) return [NO_TEST_LABEL, condition];
    return [measured];
  }
  return measured ? [measured] : [];
}

/** Single-line form of the same value, for plain-text fields. */
function stepResultValue(step, tank) {
  return stepResultLines(step, tank).join(' / ');
}

module.exports = {
  STEP_DISPLAY_NAMES,
  NAMED_ERROR_CONDITIONS,
  namedErrorCondition,
  isNamedErrorTerm,
  IVM_FLOW_CODES,
  FLUSH_CODE,
  splitStepName,
  normaliseStepCode,
  isFlushStep,
  isInternalTestStep,
  tankSuffix,
  stepDisplayName,
  titleCase,
  formatErrorDescription,
  formatErrorValue,
  isErrorValue,
  numericValue,
  stepErrorInfo,
  averageOfRawResults,
  measuredValue,
  stepBaseName,
  stepCode,
  stepLabel,
  stepResultLines,
  stepResultValue,
  NO_TEST_LABEL,
};
