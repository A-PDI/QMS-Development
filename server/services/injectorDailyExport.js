'use strict';
/**
 * The daily export of passed injectors to a Google Sheet.
 *
 * Once a day the sheet gains one row per injector that PASSED on the shop's
 * previous calendar day — Test Date, Part Number, Serial Number. A day is a day
 * on the Mountain clock (see services/timeZone), so a test run at 7pm belongs
 * to the day it was run rather than to the next UTC day.
 *
 * Retests are rows of their own: an injector that was tested twice in a day and
 * passed twice appears twice, because hiding the second result would hide the
 * repair that produced it.
 *
 * Everything that decides WHAT gets written is a plain function over rows, so
 * it is tested without touching Google; `exportDay` is the only part that talks
 * to the sheet, and it takes the appender as an argument so tests can stand in
 * for it.
 */

const db = require('../db/adapter');
const { PASS, injectorOutcome } = require('./injectorResult');
const { zonedDayRange, zonedTestDate, currentZonedDay, previousDay, testTimeZone } = require('./timeZone');
const googleSheets = require('./googleSheets');
const { displayPartNumber, unmappedPartNumbers } = require('./injectorPartNumbers');

/** The sheet's columns, in order. */
const COLUMNS = ['Test Date', 'Part Number', 'Serial Number'];

// The same records the Injector Tests page works with: no R-prefixed serials
// (bench re-runs) and no RMA jobs.
const BASE_EXCLUSIONS = `(serial_number IS NULL OR UPPER(TRIM(serial_number)) NOT LIKE 'R%')
                     AND (job_number IS NULL OR UPPER(job_number) NOT LIKE '%RMA%')`;

// Enough of a row to classify its result; the step JSON is never needed here.
const EXPORT_COLUMNS = `id, part_number, serial_number, test_datetime,
                        overall_pass, result_status, steps_total, steps_passed, steps_failed`;

/** Settings keys recording what has already been sent, so a day is not sent twice. */
const LAST_DAY_KEY = 'injector_sheet_export_last_day';
const LAST_RUN_KEY = 'injector_sheet_export_last_run';
// Every day sent so far, as a JSON array. The nightly run only ever asks about
// yesterday, but a backfill covers arbitrary days in any order, and a watermark
// cannot express "Monday and Wednesday are done, Tuesday is not". One string of
// a few kilobytes a year is a fair price for getting re-runs right.
const SENT_DAYS_KEY = 'injector_sheet_export_days';
// A backfill is bounded so one request cannot try to send years of history.
const MAX_RANGE_DAYS = 366;
const MAX_RANGE_ROWS = 5000;

function getSetting(key) {
  const row = db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const now = new Date().toISOString();
  const existing = db.get('SELECT key FROM app_settings WHERE key = ?', [key]);
  if (existing) db.run('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?', [value, now, key]);
  else db.run('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', [key, value, now]);
}

/** The days already written to the sheet. */
function sentDays() {
  try {
    const parsed = JSON.parse(getSetting(SENT_DAYS_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((day) => typeof day === 'string') : []);
  } catch (_) {
    return new Set();   // a corrupted setting must not block the export
  }
}

/** Record days as written, and move the "last day" marker to the newest. */
function markSent(days = []) {
  const all = sentDays();
  for (const day of days) all.add(day);
  const sorted = [...all].sort();
  setSetting(SENT_DAYS_KEY, JSON.stringify(sorted));
  setSetting(LAST_DAY_KEY, sorted[sorted.length - 1] || '');
  setSetting(LAST_RUN_KEY, new Date().toISOString());
}

/** True for a well-formed calendar day. */
function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && zonedTestDate(String(value)) === String(value);
}

/**
 * The day a scheduled run covers: the one before today on the shop's clock.
 */
function defaultExportDay(now = new Date(), timeZone = testTimeZone()) {
  return previousDay(currentZonedDay(now, timeZone));
}

/**
 * Every test recorded on `day`, newest last, as summary rows.
 *
 * The window is the day's instants rather than a string prefix, so it still
 * holds on the two mornings a year when a Mountain day is 23 or 25 hours long.
 */
function testsForDay(day, timeZone = testTimeZone()) {
  const { from, to } = zonedDayRange(day, timeZone);
  return db.all(
    `SELECT ${EXPORT_COLUMNS} FROM injector_test_reports
      WHERE ${BASE_EXCLUSIONS}
        AND test_datetime IS NOT NULL
        AND datetime(test_datetime) >= datetime(?)
        AND datetime(test_datetime) <  datetime(?)
      ORDER BY datetime(test_datetime) ASC, part_number ASC, serial_number ASC`,
    [from, to]
  );
}

/** The passed ones, using the same classifier as every other injector view. */
function passedTests(tests = []) {
  return (Array.isArray(tests) ? tests : []).filter((test) => injectorOutcome(test) === PASS);
}

/**
 * Sheet rows for a day's passed injectors: [Test Date, Part Number, Serial Number].
 *
 * The part number is PDI's, not the bench's: the bench records evaluation and
 * pre-production spellings of the same part, and the sheet is read as a record
 * of PDI parts (see injectorPartNumbers). A bench part with no PDI number
 * passes through as it came, and is listed by `unmappedParts` on the result.
 *
 * A missing part or serial is written as an empty cell rather than a dash, so
 * the column stays usable as data.
 */
function buildExportRows(tests = [], timeZone = testTimeZone()) {
  return passedTests(tests).map((test) => [
    zonedTestDate(test.test_datetime, timeZone),
    displayPartNumber(test.part_number),
    String(test.serial_number || '').trim(),
  ]);
}

/** The bench part numbers among these tests that have no PDI number. */
function unmappedPartsIn(tests = []) {
  return unmappedPartNumbers(passedTests(tests).map((test) => test.part_number));
}

/** What the last run did, for the settings endpoint and the manual trigger. */
function exportStatus() {
  return {
    configured: googleSheets.isConfigured(),
    missing: googleSheets.missingConfig(),
    spreadsheetId: googleSheets.target().spreadsheetId || null,
    range: googleSheets.target().range,
    // Which account the rows are written as. It is an identifier, not a
    // secret, and seeing it here is how an operator confirms that a replaced
    // key actually reached the server.
    serviceAccount: googleSheets.serviceAccountEmail(),
    timeZone: testTimeZone(),
    lastExportedDay: getSetting(LAST_DAY_KEY),
    lastRunAt: getSetting(LAST_RUN_KEY),
  };
}

/**
 * Export one day's passed injectors.
 *
 * @param day        calendar day on the shop's clock; defaults to yesterday
 * @param opts.force send a day that has already been sent (it appends again)
 * @param opts.dryRun build the rows and report them without writing
 * @param opts.appendRows injector for tests; defaults to the Google Sheets client
 * @returns { ok, day, rows, appended, skipped, reason, updatedRange }
 */
async function exportDay(day = null, opts = {}) {
  const {
    force = false,
    dryRun = false,
    appendRows = googleSheets.appendRows,
    timeZone = testTimeZone(),
    now = new Date(),
  } = opts;

  const target = day ? String(day) : defaultExportDay(now, timeZone);
  if (!isDay(target)) {
    return { ok: false, day: target, rows: 0, appended: 0, skipped: true, reason: 'invalid_day' };
  }

  const tests = testsForDay(target, timeZone);
  const rows = buildExportRows(tests, timeZone);
  const result = {
    ok: true, day: target, rows: rows.length, appended: 0, skipped: false, reason: '', updatedRange: '',
    unmappedParts: unmappedPartsIn(tests),
  };

  if (!force && sentDays().has(target)) {
    return { ...result, skipped: true, reason: 'already_exported' };
  }
  if (dryRun) return { ...result, skipped: true, reason: 'dry_run' };
  if (!rows.length) {
    // Nothing to write, but the day is still done — a quiet day must not make
    // tomorrow's run resend it.
    markSent([target]);
    return { ...result, skipped: true, reason: 'no_passed_injectors' };
  }

  const appended = await appendRows(rows, { header: COLUMNS });
  markSent([target]);
  return {
    ...result,
    appended: Number(appended && appended.appended) || rows.length,
    updatedRange: (appended && appended.updatedRange) || '',
  };
}

/** Every day from `from` to `to` inclusive, ascending. */
function daysBetween(from, to) {
  const days = [];
  const [year, month, day] = String(from).split('-').map(Number);
  for (let cursor = Date.UTC(year, month - 1, day); ; cursor += 86400000) {
    const date = new Date(cursor);
    const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (iso > String(to)) break;
    days.push(iso);
    if (days.length > MAX_RANGE_DAYS) break;
  }
  return days;
}

/** The first and last day of the month `day` falls in. */
function monthOf(day) {
  const [year, month] = String(day).split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value) => String(value).padStart(2, '0');
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/**
 * Export a span of days in one go — the backfill a new sheet starts with, and
 * the way a run missed while the server was down is caught up.
 *
 * Every day in the span is collected first and appended in ONE request, in
 * date order, so a month lands as one block rather than thirty appends that
 * can half-fail. Days already sent are left out unless `force` says otherwise,
 * which is what makes running the same backfill twice harmless.
 *
 * Days are only marked as sent once the append has succeeded.
 *
 * @returns { ok, from, to, days, rows, appended, skipped, reason, perDay }
 */
async function exportRange(from, to, opts = {}) {
  const {
    force = false,
    dryRun = false,
    appendRows = googleSheets.appendRows,
    timeZone = testTimeZone(),
    now = new Date(),
  } = opts;

  const start = String(from);
  const asked = String(to);
  const base = { ok: true, from: start, to: asked, days: 0, rows: 0, appended: 0, skipped: false, reason: '', perDay: [] };

  if (!isDay(start) || !isDay(asked)) {
    return { ...base, ok: false, skipped: true, reason: 'invalid_day' };
  }
  if (start > asked) {
    return { ...base, ok: false, skipped: true, reason: 'backwards_range' };
  }

  // A day is exported once, when it is over. Including today would send the
  // morning's tests and mark the day done, so everything tested after the
  // backfill ran would never reach the sheet — so the span stops at yesterday
  // and says so.
  const yesterday = previousDay(currentZonedDay(now, timeZone));
  const end = asked > yesterday ? yesterday : asked;
  base.to = end;
  if (end !== asked) base.askedTo = asked;
  if (start > end) {
    return { ...base, ok: true, skipped: true, reason: 'no_complete_days' };
  }

  const span = daysBetween(start, end);
  if (span.length > MAX_RANGE_DAYS) {
    return { ...base, ok: false, skipped: true, reason: 'range_too_long' };
  }

  const already = force ? new Set() : sentDays();
  const perDay = [];
  const rows = [];
  const covered = [];
  const benchParts = [];
  for (const day of span) {
    if (already.has(day)) {
      perDay.push({ day, rows: 0, skipped: true, reason: 'already_exported' });
      continue;
    }
    const dayTests = testsForDay(day, timeZone);
    const dayRows = buildExportRows(dayTests, timeZone);
    perDay.push({ day, rows: dayRows.length, skipped: false, reason: '' });
    rows.push(...dayRows);
    benchParts.push(...passedTests(dayTests).map((test) => test.part_number));
    covered.push(day);
  }

  const result = {
    ...base, days: covered.length, rows: rows.length, perDay,
    unmappedParts: unmappedPartNumbers(benchParts),
  };
  if (rows.length > MAX_RANGE_ROWS) {
    return { ...result, ok: false, skipped: true, reason: 'too_many_rows' };
  }
  if (dryRun) return { ...result, skipped: true, reason: 'dry_run' };
  if (!covered.length) return { ...result, skipped: true, reason: 'already_exported' };
  if (!rows.length) {
    // The span held no passing tests at all. The days are still done.
    markSent(covered);
    return { ...result, skipped: true, reason: 'no_passed_injectors' };
  }

  const appended = await appendRows(rows, { header: COLUMNS });
  markSent(covered);
  return {
    ...result,
    appended: Number(appended && appended.appended) || rows.length,
    updatedRange: (appended && appended.updatedRange) || '',
  };
}

/** The month-to-date backfill: the 1st of this month through yesterday. */
async function exportMonthToDate(opts = {}) {
  const timeZone = opts.timeZone || testTimeZone();
  const today = currentZonedDay(opts.now || new Date(), timeZone);
  const { from, to } = monthOf(today);
  // The month's last day may be in the future; exportRange stops at yesterday.
  return exportRange(from, to, { ...opts, timeZone });
}

module.exports = {
  COLUMNS,
  LAST_DAY_KEY,
  LAST_RUN_KEY,
  SENT_DAYS_KEY,
  MAX_RANGE_DAYS,
  MAX_RANGE_ROWS,
  daysBetween,
  monthOf,
  sentDays,
  exportRange,
  exportMonthToDate,
  isDay,
  defaultExportDay,
  testsForDay,
  passedTests,
  buildExportRows,
  unmappedPartsIn,
  exportStatus,
  exportDay,
};
