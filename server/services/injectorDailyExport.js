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
                        overall_pass, result_status, steps_total, steps_passed, steps_failed,
                        sheet_exported_at`;

/** Settings keys recording what has already been sent, so a day is not sent twice. */
const LAST_DAY_KEY = 'injector_sheet_export_last_day';
const LAST_RUN_KEY = 'injector_sheet_export_last_run';
// Every day sent so far, as a JSON array. The nightly run only ever asks about
// yesterday, but a backfill covers arbitrary days in any order, and a watermark
// cannot express "Monday and Wednesday are done, Tuesday is not". One string of
// a few kilobytes a year is a fair price for getting re-runs right.
// Retired: the export used to record which DAYS it had sent, which closed a
// day before its tests had been synced. The record is now sheet_exported_at on
// each test row. The key is still cleared on reset so an old deployment's
// leftovers cannot be mistaken for current state.
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

/**
 * Every test recorded up to `until` that has not been written to the sheet.
 *
 * This is what a scheduled run sends. Bench data arrives through a manual
 * sync, often days after the tests were run, so "yesterday's tests" is not a
 * set that is complete at midnight — but "tests not yet sent" always is. A
 * test synced a week late is picked up by the next run and lands under the day
 * it was actually run.
 */
function unsentTests(until, timeZone = testTimeZone()) {
  const { to } = zonedDayRange(until, timeZone);
  return db.all(
    `SELECT ${EXPORT_COLUMNS} FROM injector_test_reports
      WHERE ${BASE_EXCLUSIONS}
        AND test_datetime IS NOT NULL
        AND sheet_exported_at IS NULL
        AND datetime(test_datetime) < datetime(?)
      ORDER BY datetime(test_datetime) ASC, part_number ASC, serial_number ASC`,
    [to]
  );
}

/** Mark these tests as written, so no later run sends them again. */
function markTestsExported(tests = []) {
  const now = new Date().toISOString();
  for (const test of tests) {
    if (test && test.id) {
      db.run('UPDATE injector_test_reports SET sheet_exported_at = ? WHERE id = ?', [now, test.id]);
    }
  }
  setSetting(LAST_RUN_KEY, now);
}

/** The newest test day that has been written to the sheet, or null. */
function newestExportedDay(timeZone = testTimeZone()) {
  const row = db.get(
    `SELECT MAX(datetime(test_datetime)) AS newest FROM injector_test_reports
      WHERE sheet_exported_at IS NOT NULL AND test_datetime IS NOT NULL`, []);
  return row && row.newest ? zonedTestDate(row.newest, timeZone) : null;
}

/** How many passed tests are waiting to be sent, and the oldest day among them. */
function pendingSummary(until, timeZone = testTimeZone()) {
  const pending = passedTests(unsentTests(until, timeZone));
  const days = [...new Set(pending.map((test) => zonedTestDate(test.test_datetime, timeZone)))].sort();
  return { rows: pending.length, days: days.length, oldestDay: days[0] || null, newestDay: days[days.length - 1] || null };
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
    // The newest test day that has actually reached the sheet, read from the
    // rows themselves rather than from a marker a run might have moved without
    // sending anything.
    lastExportedDay: newestExportedDay(),
    lastRunAt: getSetting(LAST_RUN_KEY),
    // What is waiting to go up, through the end of yesterday. A number that
    // keeps growing means tests are being synced but not exported.
    pending: pendingSummary(previousDay(currentZonedDay(new Date(), testTimeZone()))),
  };
}

/**
 * Export one day's passed injectors.
 *
 * Only tests that have not already been written are sent, so running this for
 * a day that was partly exported sends the remainder rather than a duplicate
 * of the lot. `force` ignores the marks and sends the day's passes again.
 *
 * @param day        calendar day on the shop's clock; defaults to yesterday
 * @param opts.force send tests that have already been sent
 * @param opts.dryRun build the rows and report them without writing
 * @param opts.appendRows injector for tests; defaults to the Google Sheets client
 * @returns { ok, day, rows, appended, skipped, reason, unmappedParts }
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
    return { ok: false, day: target, rows: 0, appended: 0, skipped: true, reason: 'invalid_day', unmappedParts: [] };
  }

  const all = testsForDay(target, timeZone);
  const tests = passedTests(force ? all : all.filter((test) => !test.sheet_exported_at));
  const rows = buildExportRows(tests, timeZone);
  const result = {
    ok: true, day: target, rows: rows.length, appended: 0, skipped: false, reason: '', updatedRange: '',
    unmappedParts: unmappedPartsIn(tests),
  };

  if (dryRun) return { ...result, skipped: true, reason: 'dry_run' };
  if (!rows.length) {
    // Nothing outstanding. The day is NOT closed: tests synced later still go
    // up on a future run, because what is tracked is the test, not the day.
    return { ...result, skipped: true, reason: all.length ? 'already_exported' : 'no_passed_injectors' };
  }

  const appended = await appendRows(rows, { header: COLUMNS });
  markTestsExported(tests);
  return {
    ...result,
    appended: Number(appended && appended.appended) || rows.length,
    updatedRange: (appended && appended.updatedRange) || '',
  };
}

/**
 * Send everything outstanding up to the end of yesterday — the scheduled run.
 *
 * Deliberately not "yesterday's tests": the bench data is imported by a manual
 * sync, so a day's tests are often not in the database at midnight. Sweeping
 * every unsent test instead means a late sync is picked up by the next run,
 * under the day the test was actually run.
 */
async function exportOutstanding(opts = {}) {
  const {
    force = false,
    dryRun = false,
    appendRows = googleSheets.appendRows,
    timeZone = testTimeZone(),
    now = new Date(),
  } = opts;

  const through = previousDay(currentZonedDay(now, timeZone));
  const tests = passedTests(force ? allTestsThrough(through, timeZone) : unsentTests(through, timeZone));
  const rows = buildExportRows(tests, timeZone);
  const days = [...new Set(tests.map((test) => zonedTestDate(test.test_datetime, timeZone)))].sort();
  const result = {
    ok: true, through, days: days.length, rows: rows.length, appended: 0,
    skipped: false, reason: '', updatedRange: '',
    oldestDay: days[0] || null, newestDay: days[days.length - 1] || null,
    unmappedParts: unmappedPartsIn(tests),
  };

  if (dryRun) return { ...result, skipped: true, reason: 'dry_run' };
  if (!rows.length) return { ...result, skipped: true, reason: 'nothing_outstanding' };

  const appended = await appendRows(rows, { header: COLUMNS });
  markTestsExported(tests);
  return {
    ...result,
    appended: Number(appended && appended.appended) || rows.length,
    updatedRange: (appended && appended.updatedRange) || '',
  };
}

/** Every test up to the end of `through`, sent or not — what `force` resends. */
function allTestsThrough(through, timeZone = testTimeZone()) {
  const { to } = zonedDayRange(through, timeZone);
  return db.all(
    `SELECT ${EXPORT_COLUMNS} FROM injector_test_reports
      WHERE ${BASE_EXCLUSIONS}
        AND test_datetime IS NOT NULL
        AND datetime(test_datetime) < datetime(?)
      ORDER BY datetime(test_datetime) ASC, part_number ASC, serial_number ASC`,
    [to]
  );
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

  // Per day: what is still outstanding. A day whose tests have all been sent
  // contributes nothing, which is what makes re-running a backfill harmless —
  // the marks are on the tests, so a day that gains tests later is not closed.
  const perDay = [];
  const rows = [];
  const sent = [];
  const daysWithRows = [];
  const benchParts = [];
  for (const day of span) {
    const dayTests = testsForDay(day, timeZone);
    const outstanding = passedTests(force ? dayTests : dayTests.filter((test) => !test.sheet_exported_at));
    const dayRows = buildExportRows(outstanding, timeZone);
    perDay.push({
      day,
      rows: dayRows.length,
      skipped: dayRows.length === 0,
      reason: dayRows.length ? '' : (dayTests.length ? 'already_exported' : 'no_passed_injectors'),
    });
    if (!dayRows.length) continue;
    rows.push(...dayRows);
    sent.push(...outstanding);
    benchParts.push(...outstanding.map((test) => test.part_number));
    daysWithRows.push(day);
  }

  const result = {
    ...base, days: daysWithRows.length, rows: rows.length, perDay,
    unmappedParts: unmappedPartNumbers(benchParts),
  };
  if (rows.length > MAX_RANGE_ROWS) {
    return { ...result, ok: false, skipped: true, reason: 'too_many_rows' };
  }
  if (dryRun) return { ...result, skipped: true, reason: 'dry_run' };
  if (!rows.length) return { ...result, skipped: true, reason: 'nothing_outstanding' };

  const appended = await appendRows(rows, { header: COLUMNS });
  markTestsExported(sent);
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
  exportRange,
  exportMonthToDate,
  isDay,
  defaultExportDay,
  testsForDay,
  unsentTests,
  allTestsThrough,
  markTestsExported,
  pendingSummary,
  newestExportedDay,
  exportOutstanding,
  passedTests,
  buildExportRows,
  unmappedPartsIn,
  exportStatus,
  exportDay,
};
