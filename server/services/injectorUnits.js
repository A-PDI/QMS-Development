'use strict';

/**
 * Which injector test results belong to the same physical unit.
 *
 * Technicians type the serial number at the bench, so one unit can appear as
 *   260521828A  =  260521828  =  828
 * These rules decide when two spellings are the same unit (the part number
 * must match as well):
 *
 *   1. Case, spaces and separators are ignored:   "260-521 828" = "260521828"
 *   2. A trailing letter suffix is ignored:        "260521828A"  = "260521828"
 *      Leading letters are kept — they carry meaning (serials starting with
 *      R are RMA units and are never imported).
 *   3. A shortened serial of at least 3 digits matches the full serial it
 *      ends:                                        "828" = "260521828"
 *      …but only when exactly one full serial of that part ends with it. If
 *      two units could own it ("260521828" and "260777828"), the shortened
 *      serial stays on its own rather than merge two units' repair history.
 */

const MIN_SHORT_DIGITS = 3;
const DIGITS = /^\d+$/;

/** Uppercase with spaces and separators removed. */
function normaliseSerial(serial) {
  return String(serial == null ? '' : serial).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The serial without a trailing letter suffix ("260521828A" → "260521828"). */
function serialCore(serial) {
  const normalised = normaliseSerial(serial);
  return normalised.replace(/[A-Z]+$/, '') || normalised;
}

/**
 * Resolver over every serial recorded for ONE part number. Returns a function
 * mapping a serial to its unit key (the full serial core it belongs to); two
 * serials are the same unit when their keys are equal. A serial that is not in
 * the list is resolved against the list without changing it.
 *
 * Linear in the number of serials: every all-digit core is indexed under each
 * of its endings of 3+ digits, so "which longer serials end with 828?" is a
 * single lookup.
 */
function unitResolver(serials = []) {
  const cores = new Set(serials.map(serialCore).filter(Boolean));
  const longerEndingWith = new Map();
  for (const core of cores) {
    if (!DIGITS.test(core)) continue;
    for (let length = MIN_SHORT_DIGITS; length < core.length; length++) {
      const ending = core.slice(-length);
      if (!longerEndingWith.has(ending)) longerEndingWith.set(ending, []);
      longerEndingWith.get(ending).push(core);
    }
  }
  // A full serial is one that no longer serial ends with.
  const isFull = (core) => !longerEndingWith.has(core);
  const cache = new Map();
  const keyOf = (core) => {
    if (!cache.has(core)) {
      const owners = [...new Set(longerEndingWith.get(core) || [])].filter(isFull);
      cache.set(core, owners.length === 1 ? owners[0] : core);
    }
    return cache.get(core);
  };
  return (serial) => {
    const core = serialCore(serial);
    return core ? keyOf(core) : '';
  };
}

/** Part numbers compare trimmed and case-insensitively. */
function partKey(partNumber) {
  return String(partNumber == null ? '' : partNumber).trim().toUpperCase();
}

/**
 * Keyer over many rows ({ part_number, serial_number }): returns a function
 * giving each row's unit identity, stable across the spellings above.
 */
function unitKeyer(rows = []) {
  const serialsByPart = new Map();
  for (const row of rows) {
    const part = partKey(row && row.part_number);
    if (!serialsByPart.has(part)) serialsByPart.set(part, []);
    serialsByPart.get(part).push(row && row.serial_number);
  }
  const resolvers = new Map([...serialsByPart].map(([part, serials]) => [part, unitResolver(serials)]));
  return (row) => {
    const part = partKey(row && row.part_number);
    const resolve = resolvers.get(part) || unitResolver([row && row.serial_number]);
    return JSON.stringify([part, resolve(row && row.serial_number)]);
  };
}

/** The spellings in `serials` that are the same unit as `serial` (always includes it). */
function sameUnitSerials(serial, serials = []) {
  const resolve = unitResolver([...serials, serial]);
  const key = resolve(serial);
  const matches = serials.filter((candidate) => key && resolve(candidate) === key);
  return [...new Set([serial, ...matches].filter((value) => value != null && value !== ''))];
}

/**
 * The rows ({ part_number, serial_number }) that are the same unit as any of
 * the typed serials, judged within each part number — so filtering on
 * "260521828A" also finds that unit's "828" results, but not another part's.
 */
function sameUnitRows(tokens = [], rows = []) {
  const typed = tokens.filter((token) => serialCore(token));
  if (!typed.length) return [];
  const rowsByPart = new Map();
  for (const row of rows) {
    const part = partKey(row && row.part_number);
    if (!rowsByPart.has(part)) rowsByPart.set(part, []);
    rowsByPart.get(part).push(row);
  }
  const out = [];
  for (const partRows of rowsByPart.values()) {
    const resolve = unitResolver(partRows.map((row) => row.serial_number));
    const keys = new Set(typed.map(resolve));
    for (const row of partRows) {
      if (keys.has(resolve(row.serial_number))) out.push(row);
    }
  }
  return out;
}

module.exports = {
  MIN_SHORT_DIGITS,
  normaliseSerial,
  serialCore,
  unitResolver,
  unitKeyer,
  sameUnitSerials,
  sameUnitRows,
  partKey,
};
