'use strict';
/**
 * The part number the shop uses, for a part number the test bench reports.
 *
 * The CarbonZapp bench records the part as it was set up for testing, which
 * includes evaluation and pre-production variants of the same part — "(Beta)",
 * "-Eval", "-QC". PDI's own part number is what belongs on anything that leaves
 * the test bench, so the Google Sheet export translates through this table.
 *
 * The table is deliberately EXPLICIT: every bench spelling is listed, including
 * each variant. Guessing a base part from a suffix would silently file a
 * genuinely new part under an existing number, which on a quality record is a
 * worse failure than not translating at all. A bench part that is not listed
 * passes through unchanged, so it shows up in the sheet looking like a bench
 * number — visible, and easily added here.
 *
 * To add a part: add every bench spelling of it, left, with PDI's number right.
 */

// Bench part number → PDI part number.
const PART_NUMBER_DISPLAY_MAP = {
  '2872405': '7159417',

  '2897320': '7159419',
  '2897320 (Beta)': '7159419',

  'P4327147': '7159421',
  'P4327147 (Beta)': '7159421',
  'P4327147-Eval': '7159421',
  'P4327147-QC': '7159421',
};

/**
 * The lookup key for a bench part number.
 *
 * Case and surrounding or repeated whitespace are not meaningful — the bench
 * has been seen to write "P4327147 (Beta)" and " p4327147  (beta) " for the
 * same setup — so they are normalised away. Nothing else is: a hyphen or a
 * suffix is part of the identity.
 */
function lookupKey(partNumber) {
  return String(partNumber == null ? '' : partNumber)
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

// Built once, so a lookup is a single hash hit however the bench spelled it.
const BY_KEY = new Map(
  Object.entries(PART_NUMBER_DISPLAY_MAP).map(([bench, display]) => [lookupKey(bench), display])
);

/** True when the bench part number has a PDI number to show instead. */
function isMapped(partNumber) {
  return BY_KEY.has(lookupKey(partNumber));
}

/**
 * PDI's part number for a bench part number, or the bench's own value when it
 * is not in the table. An empty part stays empty.
 */
function displayPartNumber(partNumber) {
  const key = lookupKey(partNumber);
  if (!key) return '';
  return BY_KEY.get(key) || String(partNumber).trim();
}

/**
 * The bench part numbers in `partNumbers` that have no PDI number, once each,
 * in the order first seen. The export reports these so a part the bench starts
 * using is noticed rather than quietly written through.
 */
function unmappedPartNumbers(partNumbers = []) {
  const seen = new Set();
  const out = [];
  for (const partNumber of partNumbers) {
    const key = lookupKey(partNumber);
    if (!key || seen.has(key) || BY_KEY.has(key)) continue;
    seen.add(key);
    out.push(String(partNumber).trim());
  }
  return out;
}

module.exports = {
  PART_NUMBER_DISPLAY_MAP,
  lookupKey,
  isMapped,
  displayPartNumber,
  unmappedPartNumbers,
};
