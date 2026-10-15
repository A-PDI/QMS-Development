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

/** The passed ones, using the same classifier as every other injector view. */
function passedTests(tests = []) {
  return (Array.isArray(tests) ? tests : []).filter((test) => injectorOutcome(test) === PASS);
}

/**
 * Sheet rows for a day's passed injectors: [Test Date, Part Number, Serial Number].
 *
 * A missing part or serial is written as an empty cell rather than a dash, so
 * the column stays usable as data.
 */
function buildExportRows(tests = [], timeZone = testTimeZone()) {
  return passedTests(tests).map((test) => [
    zonedTestDate(test.test_datetime, timeZone),
    String(test.part_number || '').trim(),
    String(test.serial_number || '').trim(),
  ]);
}

/** What the last run did, for the settings endpoint and the manual trigger. */
function exportStatus() {
  return {
    configured: googleSheets.isConfigured(),
    missing: googleSheets.missingConfig(),
    spreadsheetId: googleSheets.target().spreadsheetId || null,
    range: googleSheets.target().range,
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

  const rows = buildExportRows(testsForDay(target, timeZone), timeZone);
  const result = { ok: true, day: target, rows: rows.length, appended: 0, skipped: false, reason: '', updatedRange: '' };

  if (!force && getSetting(LAST_DAY_KEY) === target) {
    return { ...result, skipped: true, reason: 'already_exported' };
  }
  if (dryRun) return { ...result, skipped: true, reason: 'dry_run' };
  if (!rows.length) {
    // Nothing to write, but the day is still done — a quiet day must not make
    // tomorrow's run resend it.
    setSetting(LAST_DAY_KEY, target);
    setSetting(LAST_RUN_KEY, new Date().toISOString());
    return { ...result, skipped: true, reason: 'no_passed_injectors' };
  }

  const appended = await appendRows(rows, { header: COLUMNS });
  setSetting(LAST_DAY_KEY, target);
  setSetting(LAST_RUN_KEY, new Date().toISOString());
  return {
    ...result,
    appended: Number(appended && appended.appended) || rows.length,
    updatedRange: (appended && appended.updatedRange) || '',
  };
}

module.exports = {
  COLUMNS,
  LAST_DAY_KEY,
  LAST_RUN_KEY,
  isDay,
  defaultExportDay,
  testsForDay,
  passedTests,
  buildExportRows,
  exportStatus,
  exportDay,
};
