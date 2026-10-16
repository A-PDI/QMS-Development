'use strict';
/**
 * The daily Google Sheet export: which tests one shop day contains, which of
 * them passed, what gets written, and what stops a day being written twice.
 *
 * Nothing here reaches Google — exportDay takes the appender as an argument.
 */

const test = require('node:test');
const assert = require('node:assert');

const { db, resetInjectorData } = require('./helpers/testEnv');
const { benchBatch, benchReport } = require('./helpers/benchData');
const carbonzapp = require('../services/carbonzapp');
const googleSheets = require('../services/googleSheets');
const {
  COLUMNS,
  LAST_DAY_KEY,
  isDay,
  defaultExportDay,
  testsForDay,
  passedTests,
  buildExportRows,
  exportStatus,
  exportDay,
} = require('../services/injectorDailyExport');

/** Import one injector with a chosen timestamp and result. */
function seedTest({ id, serial, part = '6513589PX', datetime, pass = true, job = 'Production' }) {
  carbonzapp.upsertReports(benchBatch(1, {
    idPrefix: id,
    prefix: serial,
    part,
    job,
    customise: () => ({
      serial,
      datetime,
      // The fixture's defaults are all inside spec; 40 puts Peak HP (220-240)
      // well outside it, which the bench scores as a fail.
      flow: pass ? {} : { IVM01: 40 },
    }),
  }));
}

/** Collects what would have been appended, in place of the Google client. */
function recordingAppender() {
  const calls = [];
  const appendRows = async (rows, options) => {
    calls.push({ rows, options });
    return { appended: rows.length, updatedRange: `Sheet1!A2:C${rows.length + 1}` };
  };
  return { calls, appendRows };
}

test('a day is recognised, and nonsense is not', () => {
  assert.ok(isDay('2026-06-30'));
  for (const bad of ['2026-6-30', '2026-02-30', 'yesterday', '', null, '2026-06-30T00:00:00Z']) {
    assert.strictEqual(isDay(bad), false, `${bad} is not a day`);
  }
});

test('a scheduled run covers yesterday on the shop clock', () => {
  // 00:05 Mountain on 1 July is 06:05Z; the day to send is 30 June.
  assert.strictEqual(defaultExportDay(new Date('2026-07-01T06:05:00Z')), '2026-06-30');
  // Just before midnight Mountain it is still 30 June, so the day before is the 29th.
  assert.strictEqual(defaultExportDay(new Date('2026-07-01T05:55:00Z')), '2026-06-29');
});

test('a day holds the tests run on it in Mountain Time, not in UTC', async () => {
  resetInjectorData();
  // 7pm Mountain on 30 June, which is 01:00Z on 1 July.
  seedTest({ id: 'evening', serial: 'EVE-1', datetime: '2026-07-01T01:00:00+00:00' });
  // 8am Mountain on 30 June.
  seedTest({ id: 'morning', serial: 'MOR-1', datetime: '2026-06-30T14:00:00+00:00' });
  // Just after midnight Mountain, so the next day.
  seedTest({ id: 'after', serial: 'AFT-1', datetime: '2026-07-01T06:30:00+00:00' });

  const serials = testsForDay('2026-06-30').map((row) => row.serial_number);
  assert.deepStrictEqual(serials, ['MOR-1', 'EVE-1'], 'the evening test belongs to the day it was run');
  assert.deepStrictEqual(testsForDay('2026-07-01').map((row) => row.serial_number), ['AFT-1']);
});

test('only passed injectors are exported', async () => {
  resetInjectorData();
  seedTest({ id: 'good', serial: 'PASS-1', datetime: '2026-06-30T14:00:00+00:00', pass: true });
  seedTest({ id: 'bad', serial: 'FAIL-1', datetime: '2026-06-30T15:00:00+00:00', pass: false });

  const tests = testsForDay('2026-06-30');
  assert.strictEqual(tests.length, 2);
  assert.deepStrictEqual(passedTests(tests).map((t) => t.serial_number), ['PASS-1']);
  assert.deepStrictEqual(buildExportRows(tests), [['2026-06-30', '6513589PX', 'PASS-1']]);
});

test('a row is Test Date, Part Number, Serial Number, on the shop clock', async () => {
  resetInjectorData();
  seedTest({ id: 'evening', serial: 'EVE-2', part: 'PN-500', datetime: '2026-07-01T02:30:00+00:00' });
  assert.deepStrictEqual(COLUMNS, ['Test Date', 'Part Number', 'Serial Number']);
  assert.deepStrictEqual(buildExportRows(testsForDay('2026-06-30')), [['2026-06-30', 'PN-500', 'EVE-2']]);
});

test('repair serials and RMA jobs stay out, exactly as they do on the page', async () => {
  resetInjectorData();
  seedTest({ id: 'ok', serial: 'KEEP-1', datetime: '2026-06-30T14:00:00+00:00' });
  seedTest({ id: 'repair', serial: 'R123', datetime: '2026-06-30T15:00:00+00:00' });
  seedTest({ id: 'rma', serial: 'RMA-OK', datetime: '2026-06-30T16:00:00+00:00', job: 'RMA-88' });

  assert.deepStrictEqual(
    buildExportRows(testsForDay('2026-06-30')).map((row) => row[2]),
    ['KEEP-1'],
  );
});

test('a retest that also passed is its own row', async () => {
  resetInjectorData();
  carbonzapp.upsertReports([
    benchReport({ id: 'first', slot: 0, serial: 'TWICE-1', job: 'Production', datetime: '2026-06-30T14:00:00+00:00' }),
    benchReport({ id: 'second', slot: 0, serial: 'TWICE-1', job: 'Production', datetime: '2026-06-30T20:00:00+00:00', flow: { IVM01: 232 } }),
  ]);
  const rows = buildExportRows(testsForDay('2026-06-30'));
  assert.strictEqual(rows.length, 2, 'both passing runs are exported');
  assert.deepStrictEqual(rows.map((row) => row[2]), ['TWICE-1', 'TWICE-1']);
});

test('a run appends the rows with a header and records the day', async () => {
  resetInjectorData();
  db.run('DELETE FROM app_settings WHERE key = ?', [LAST_DAY_KEY]);
  seedTest({ id: 'one', serial: 'SHEET-1', datetime: '2026-06-30T14:00:00+00:00' });
  const sheet = recordingAppender();

  const result = await exportDay('2026-06-30', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(
    { ok: result.ok, day: result.day, rows: result.rows, appended: result.appended, skipped: result.skipped },
    { ok: true, day: '2026-06-30', rows: 1, appended: 1, skipped: false },
  );
  assert.strictEqual(sheet.calls.length, 1);
  assert.deepStrictEqual(sheet.calls[0].rows, [['2026-06-30', '6513589PX', 'SHEET-1']]);
  assert.deepStrictEqual(sheet.calls[0].options.header, COLUMNS, 'the header is offered for an empty sheet');
  assert.strictEqual(exportStatus().lastExportedDay, '2026-06-30');
});

test('the same day is not appended twice unless it is forced', async () => {
  resetInjectorData();
  db.run('DELETE FROM app_settings WHERE key = ?', [LAST_DAY_KEY]);
  seedTest({ id: 'one', serial: 'SHEET-2', datetime: '2026-06-30T14:00:00+00:00' });
  const sheet = recordingAppender();

  await exportDay('2026-06-30', { appendRows: sheet.appendRows });
  const again = await exportDay('2026-06-30', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(
    { skipped: again.skipped, reason: again.reason, appended: again.appended },
    { skipped: true, reason: 'already_exported', appended: 0 },
  );
  assert.strictEqual(sheet.calls.length, 1, 'nothing was written the second time');

  const forced = await exportDay('2026-06-30', { appendRows: sheet.appendRows, force: true });
  assert.strictEqual(forced.appended, 1);
  assert.strictEqual(sheet.calls.length, 2, 'forcing writes the day again');
});

test('a dry run reports the rows without writing them', async () => {
  resetInjectorData();
  db.run('DELETE FROM app_settings WHERE key = ?', [LAST_DAY_KEY]);
  seedTest({ id: 'one', serial: 'SHEET-3', datetime: '2026-06-30T14:00:00+00:00' });
  const sheet = recordingAppender();

  const result = await exportDay('2026-06-30', { appendRows: sheet.appendRows, dryRun: true });
  assert.deepStrictEqual(
    { rows: result.rows, skipped: result.skipped, reason: result.reason },
    { rows: 1, skipped: true, reason: 'dry_run' },
  );
  assert.strictEqual(sheet.calls.length, 0);
  assert.notStrictEqual(exportStatus().lastExportedDay, '2026-06-30', 'a dry run does not close the day');
});

test('a day with no passed injectors is closed without writing an empty row', async () => {
  resetInjectorData();
  db.run('DELETE FROM app_settings WHERE key = ?', [LAST_DAY_KEY]);
  seedTest({ id: 'bad', serial: 'FAIL-2', datetime: '2026-06-30T14:00:00+00:00', pass: false });
  const sheet = recordingAppender();

  const result = await exportDay('2026-06-30', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(
    { rows: result.rows, skipped: result.skipped, reason: result.reason },
    { rows: 0, skipped: true, reason: 'no_passed_injectors' },
  );
  assert.strictEqual(sheet.calls.length, 0);
  assert.strictEqual(exportStatus().lastExportedDay, '2026-06-30', 'a quiet day is still done');
});

test('a day that is not a day is refused before anything is written', async () => {
  const sheet = recordingAppender();
  const result = await exportDay('not-a-day', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(
    { ok: result.ok, skipped: result.skipped, reason: result.reason },
    { ok: false, skipped: true, reason: 'invalid_day' },
  );
  assert.strictEqual(sheet.calls.length, 0);
});

test('the status says what configuration is still missing', () => {
  const status = exportStatus();
  assert.strictEqual(status.configured, false, 'the test environment has no Google credentials');
  assert.ok(status.missing.includes('GOOGLE_SHEETS_SPREADSHEET_ID'));
  assert.strictEqual(status.timeZone, 'America/Denver');
  assert.deepStrictEqual(googleSheets.missingConfig(), status.missing);
});

test('a private key pasted into .env keeps its line breaks', () => {
  const pasted = '"-----BEGIN PRIVATE KEY-----\\nMIIBVAIBADANBg\\n-----END PRIVATE KEY-----\\n"';
  assert.strictEqual(
    googleSheets.normalisePrivateKey(pasted),
    '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBg\n-----END PRIVATE KEY-----\n',
    'the escaped newlines become real ones, the quotes go, and the PEM keeps its final newline',
  );
});
