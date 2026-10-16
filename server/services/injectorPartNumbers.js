'use strict';
/**
 * The part number the shop uses, for a part number the test bench reports.
 *
 * The bench records the part as it was set up for testing, and the spelling
 * varies: "P4327147", "P4327147 (Beta)", "P4327147-Eval", "P4327147 - QC".
 * PDI's own part number is what belongs on anything that leaves the bench, so
 * the Google Sheet export translates through the rules below.
 *
 * A rule matches when its CORE NUMBER appears anywhere in the bench part. That
 * is deliberately broad: a prefix, a suffix, a bracketed variant, or spaces
 * around a hyphen all still match, so a new spelling of a known part does not
 * silently reach the sheet untranslated. The cost is that a different part
 * whose number happens to contain one of these cores would be translated too
 * — the cores are seven digits, so that is unlikely, but it is the trade.
 *
 * To add a part: add a rule with its core number and PDI's number.
 */

// Checked in order; the first core found in the bench part wins. Cores must not
// contain one another — the test suite asserts that, because overlapping cores
// would make the result depend on the order of this list rather than the data.
const PART_NUMBER_RULES = [
  { core: '2872405', display: '7159417' },
  { core: '2897320', display: '7159419' },
  { core: '4327147', display: '7159421' },
];

/**
 * The two forms a bench part is matched against.
 *
 * The first is the value itself, upper-cased with whitespace collapsed. The
 * second also has every separator removed, so a core broken up by a stray
 * space or hyphen — "P4327 147", "4327-147" — is still found.
 */
function matchForms(partNumber) {
  const text = String(partNumber == null ? '' : partNumber).trim().replace(/\s+/g, ' ').toUpperCase();
  return [text, text.replace(/[^A-Z0-9]/g, '')];
}

/** The rule covering this bench part, or null. */
function ruleFor(partNumber) {
  const forms = matchForms(partNumber);
  if (!forms[0]) return null;
  return PART_NUMBER_RULES.find((rule) => forms.some((form) => form.includes(rule.core))) || null;
}

/** True when the bench part number has a PDI number to show instead. */
function isMapped(partNumber) {
  return ruleFor(partNumber) !== null;
}

/**
 * PDI's part number for a bench part number, or the bench's own value when no
 * rule covers it. An empty part stays empty.
 */
function displayPartNumber(partNumber) {
  const rule = ruleFor(partNumber);
  if (rule) return rule.display;
  return String(partNumber == null ? '' : partNumber).trim();
}

/**
 * The bench part numbers in `partNumbers` that no rule covers, once each, in
 * the order first seen. The export reports these so a part the bench starts
 * using is noticed rather than quietly written through.
 */
function unmappedPartNumbers(partNumbers = []) {
  const seen = new Set();
  const out = [];
  for (const partNumber of partNumbers) {
    const [text] = matchForms(partNumber);
    if (!text || seen.has(text) || ruleFor(partNumber)) continue;
    seen.add(text);
    out.push(String(partNumber).trim());
  }
  return out;
}

module.exports = {
  PART_NUMBER_RULES,
  matchForms,
  ruleFor,
  isMapped,
  displayPartNumber,
  unmappedPartNumbers,
};
