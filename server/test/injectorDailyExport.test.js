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
  MAX_RANGE_DAYS,
  daysBetween,
  monthOf,
  pendingSummary,
  exportOutstanding,
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

test('a day with nothing to send writes no row, and is NOT closed', async () => {
  resetInjectorData();
  seedTest({ id: 'bad', serial: 'FAIL-2', datetime: '2026-06-30T14:00:00+00:00', pass: false });
  const sheet = recordingAppender();

  const result = await exportDay('2026-06-30', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(
    { rows: result.rows, skipped: result.skipped, reason: result.reason },
    { rows: 0, skipped: true, reason: 'already_exported' },
    'the day held only a failure, so there was nothing to send',
  );
  assert.strictEqual(sheet.calls.length, 0);

  // The bench data is synced by hand and arrives late. A pass imported after
  // the day was first exported must still go up — which is exactly what the
  // old day-marking got wrong.
  seedTest({ id: 'late', serial: 'LATE-1', datetime: '2026-06-30T15:00:00+00:00' });
  const second = await exportDay('2026-06-30', { appendRows: sheet.appendRows });
  assert.strictEqual(second.appended, 1, 'the late arrival is sent');
  assert.deepStrictEqual(sheet.calls[0].rows.map((row) => row[2]), ['LATE-1']);
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

// ── Backfilling a span of days ──────────────────────────────────────────────
test('a span is every day from first to last, and a month knows its own length', () => {
  assert.deepStrictEqual(daysBetween('2026-10-01', '2026-10-04'), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.deepStrictEqual(daysBetween('2026-10-14', '2026-10-14'), ['2026-10-14'], 'a single day is a span of one');
  assert.deepStrictEqual(daysBetween('2026-10-31', '2026-11-02'), ['2026-10-31', '2026-11-01', '2026-11-02'], 'it crosses a month');
  assert.deepStrictEqual(daysBetween('2026-02-27', '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01'], 'February is 28 days in 2026');

  assert.deepStrictEqual(monthOf('2026-10-16'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepStrictEqual(monthOf('2026-02-05'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepStrictEqual(monthOf('2028-02-05'), { from: '2028-02-01', to: '2028-02-29' }, 'a leap February');
});

test('a month of passed injectors goes up in one request, in date order', async () => {
  resetInjectorData();
  seedTest({ id: 'oct-02', serial: 'OCT-2', datetime: '2026-10-02T15:00:00+00:00' });
  seedTest({ id: 'oct-05a', serial: 'OCT-5A', datetime: '2026-10-05T14:00:00+00:00' });
  seedTest({ id: 'oct-05b', serial: 'OCT-5B', datetime: '2026-10-05T16:00:00+00:00' });
  seedTest({ id: 'oct-05f', serial: 'OCT-5F', datetime: '2026-10-05T17:00:00+00:00', pass: false });
  // 01:00 UTC on the 8th is 7pm Mountain on the 7th.
  seedTest({ id: 'oct-07eve', serial: 'OCT-7EVE', datetime: '2026-10-08T01:00:00+00:00' });
  // Outside the range.
  seedTest({ id: 'sep-30', serial: 'SEP-30', datetime: '2026-09-30T15:00:00+00:00' });

  const sheet = recordingAppender();
  const result = await exportRange('2026-10-01', '2026-10-10', { appendRows: sheet.appendRows });

  assert.strictEqual(sheet.calls.length, 1, 'one append for the whole span, not one per day');
  assert.deepStrictEqual(sheet.calls[0].rows, [
    ['2026-10-02', '6513589PX', 'OCT-2'],
    ['2026-10-05', '6513589PX', 'OCT-5A'],
    ['2026-10-05', '6513589PX', 'OCT-5B'],
    ['2026-10-07', '6513589PX', 'OCT-7EVE'],
  ], 'passes only, in date order, with the evening test on the day it was run');
  assert.deepStrictEqual(
    { ok: result.ok, from: result.from, to: result.to, days: result.days, rows: result.rows, appended: result.appended },
    { ok: true, from: '2026-10-01', to: '2026-10-10', days: 3, rows: 4, appended: 4 },
  );
  assert.strictEqual(result.perDay.length, 10, 'every day in the span is still accounted for');
  assert.deepStrictEqual(
    result.perDay.filter((d) => d.rows).map((d) => [d.day, d.rows]),
    [['2026-10-02', 1], ['2026-10-05', 2], ['2026-10-07', 1]],
  );
});

test('running the same backfill twice writes nothing the second time', async () => {
  resetInjectorData();
  seedTest({ id: 'oct-02', serial: 'OCT-2', datetime: '2026-10-02T15:00:00+00:00' });
  const sheet = recordingAppender();

  const first = await exportRange('2026-10-01', '2026-10-05', { appendRows: sheet.appendRows });
  assert.strictEqual(first.appended, 1);

  const second = await exportRange('2026-10-01', '2026-10-05', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(
    { days: second.days, rows: second.rows, skipped: second.skipped, reason: second.reason },
    { days: 0, rows: 0, skipped: true, reason: 'nothing_outstanding' },
  );
  assert.strictEqual(sheet.calls.length, 1, 'the sheet was written once');

  // An overlapping span only sends the days the first run did not cover.
  seedTest({ id: 'oct-07', serial: 'OCT-7', datetime: '2026-10-07T15:00:00+00:00' });
  const extended = await exportRange('2026-10-01', '2026-10-08', { appendRows: sheet.appendRows });
  assert.strictEqual(extended.days, 1, 'only the 7th had anything still outstanding');
  assert.deepStrictEqual(sheet.calls[1].rows, [['2026-10-07', '6513589PX', 'OCT-7']]);
});

test('a quiet span writes nothing and closes nothing, so late data still goes up', async () => {
  resetInjectorData();
  const sheet = recordingAppender();
  const result = await exportRange('2026-10-01', '2026-10-03', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(
    { rows: result.rows, skipped: result.skipped, reason: result.reason },
    { rows: 0, skipped: true, reason: 'nothing_outstanding' },
  );
  assert.strictEqual(sheet.calls.length, 0);

  // Tests for those days are synced afterwards; the same span now sends them.
  seedTest({ id: 'late-a', serial: 'LATE-A', datetime: '2026-10-02T15:00:00+00:00' });
  const again = await exportRange('2026-10-01', '2026-10-03', { appendRows: sheet.appendRows });
  assert.strictEqual(again.appended, 1);
  assert.deepStrictEqual(sheet.calls[0].rows.map((row) => row[2]), ['LATE-A']);
});

test('a dry run over a span counts every day and writes nothing', async () => {
  resetInjectorData();
  seedTest({ id: 'oct-02', serial: 'OCT-2', datetime: '2026-10-02T15:00:00+00:00' });
  const sheet = recordingAppender();

  const result = await exportRange('2026-10-01', '2026-10-05', { appendRows: sheet.appendRows, dryRun: true });
  assert.deepStrictEqual(
    { rows: result.rows, days: result.days, skipped: result.skipped, reason: result.reason },
    { rows: 1, days: 1, skipped: true, reason: 'dry_run' },
    'days counts the days that actually have something to send',
  );
  assert.strictEqual(sheet.calls.length, 0);
  assert.strictEqual(pendingSummary('2026-10-05').rows, 1, 'a dry run marks nothing');
});

test('a backwards or over-long span is refused before any work', async () => {
  resetInjectorData();
  const sheet = recordingAppender();
  const backwards = await exportRange('2026-10-10', '2026-10-01', { appendRows: sheet.appendRows });
  assert.deepStrictEqual({ ok: backwards.ok, reason: backwards.reason }, { ok: false, reason: 'backwards_range' });

  const tooLong = await exportRange('2020-01-01', '2026-10-01', { appendRows: sheet.appendRows });
  assert.deepStrictEqual({ ok: tooLong.ok, reason: tooLong.reason }, { ok: false, reason: 'range_too_long' });

  const bad = await exportRange('10-01-2026', '2026-10-05', { appendRows: sheet.appendRows });
  assert.deepStrictEqual({ ok: bad.ok, reason: bad.reason }, { ok: false, reason: 'invalid_day' });
  assert.strictEqual(sheet.calls.length, 0);
  assert.ok(MAX_RANGE_DAYS >= 366);
});

test('the month-to-date backfill runs from the 1st to yesterday', async () => {
  resetInjectorData();
  seedTest({ id: 'oct-01', serial: 'MTD-1', datetime: '2026-10-01T15:00:00+00:00' });
  seedTest({ id: 'oct-15', serial: 'MTD-15', datetime: '2026-10-15T15:00:00+00:00' });
  // Today, which a month-to-date run deliberately leaves for tonight.
  seedTest({ id: 'oct-16', serial: 'MTD-16', datetime: '2026-10-16T15:00:00+00:00' });

  const sheet = recordingAppender();
  const result = await exportMonthToDate({
    appendRows: sheet.appendRows,
    now: new Date('2026-10-16T18:00:00Z'),   // noon Mountain on the 16th
  });

  assert.deepStrictEqual({ from: result.from, to: result.to }, { from: '2026-10-01', to: '2026-10-15' });
  assert.deepStrictEqual(sheet.calls[0].rows.map((row) => row[2]), ['MTD-1', 'MTD-15'], "today's test is left for the nightly run");
});

test('a day already sent by the nightly run is not sent again by a backfill', async () => {
  resetInjectorData();
  seedTest({ id: 'oct-14', serial: 'NIGHTLY-14', datetime: '2026-10-14T15:00:00+00:00' });
  seedTest({ id: 'oct-13', serial: 'BACKFILL-13', datetime: '2026-10-13T15:00:00+00:00' });
  const sheet = recordingAppender();

  await exportDay('2026-10-14', { appendRows: sheet.appendRows });
  const backfill = await exportRange('2026-10-01', '2026-10-14', { appendRows: sheet.appendRows });

  assert.deepStrictEqual(sheet.calls[1].rows, [['2026-10-13', '6513589PX', 'BACKFILL-13']],
    'the day the nightly run covered is left alone');
  assert.ok(backfill.perDay.some((d) => d.day === '2026-10-14' && d.reason === 'already_exported'));
});

test('a range stops at the last complete day, so today is never half-sent', async () => {
  resetInjectorData();
  seedTest({ id: 'yest', serial: 'YEST-1', datetime: '2026-10-15T15:00:00+00:00' });
  seedTest({ id: 'today', serial: 'TODAY-1', datetime: '2026-10-16T15:00:00+00:00' });
  const sheet = recordingAppender();
  const noon = new Date('2026-10-16T18:00:00Z');   // midday Mountain on the 16th

  const result = await exportRange('2026-10-01', '2026-10-31', { appendRows: sheet.appendRows, now: noon });
  assert.deepStrictEqual(
    { to: result.to, askedTo: result.askedTo },
    { to: '2026-10-15', askedTo: '2026-10-31' },
    'the span is cut back to yesterday, and says what was asked for',
  );
  assert.deepStrictEqual(sheet.calls[0].rows.map((row) => row[2]), ['YEST-1'],
    "today's tests are left for tonight, when the day is over");
  assert.strictEqual(pendingSummary('2026-10-16').rows, 1, "today's test is still waiting");

  // Tonight's run then sends the whole of today, nothing missing.
  const tonight = await exportDay('2026-10-16', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(sheet.calls[1].rows.map((row) => row[2]), ['TODAY-1']);
  assert.strictEqual(tonight.appended, 1);
});

test('a range entirely in the future has no complete day to send', async () => {
  resetInjectorData();
  const sheet = recordingAppender();
  const result = await exportRange('2026-11-01', '2026-11-30', {
    appendRows: sheet.appendRows,
    now: new Date('2026-10-16T18:00:00Z'),
  });
  assert.deepStrictEqual(
    { ok: result.ok, skipped: result.skipped, reason: result.reason, rows: result.rows },
    { ok: true, skipped: true, reason: 'no_complete_days', rows: 0 },
  );
  assert.strictEqual(sheet.calls.length, 0);
});

// ── The part number the sheet shows ─────────────────────────────────────────
test("exported rows carry PDI's part number, not the bench's", async () => {
  resetInjectorData();
  seedTest({ id: 'map-a', serial: 'MAP-A', part: '2872405', datetime: '2026-10-02T15:00:00+00:00' });
  seedTest({ id: 'map-b', serial: 'MAP-B', part: '2897320 (Beta)', datetime: '2026-10-02T16:00:00+00:00' });
  seedTest({ id: 'map-c', serial: 'MAP-C', part: 'P4327147-QC', datetime: '2026-10-02T17:00:00+00:00' });

  assert.deepStrictEqual(buildExportRows(testsForDay('2026-10-02')), [
    ['2026-10-02', '7159417', 'MAP-A'],
    ['2026-10-02', '7159419', 'MAP-B'],
    ['2026-10-02', '7159421', 'MAP-C'],
  ]);
});

test('a bench part with no PDI number goes through as it came, and is reported', async () => {
  resetInjectorData();
  seedTest({ id: 'known', serial: 'KNOWN-1', part: '2872405', datetime: '2026-10-03T15:00:00+00:00' });
  // A variant of a known part translates however the bench spelled it; only a
  // part with no known core in it is left alone.
  seedTest({ id: 'variant', serial: 'VARIANT-1', part: 'P4327147 - Dev', datetime: '2026-10-03T16:00:00+00:00' });
  seedTest({ id: 'unknown', serial: 'UNKNOWN-1', part: '6513589PX', datetime: '2026-10-03T16:30:00+00:00' });
  // A failing injector's part is not reported: it never reaches the sheet.
  seedTest({ id: 'failed', serial: 'FAILED-1', part: 'OTHER-PART', datetime: '2026-10-03T17:00:00+00:00', pass: false });

  const tests = testsForDay('2026-10-03');
  assert.deepStrictEqual(buildExportRows(tests), [
    ['2026-10-03', '7159417', 'KNOWN-1'],
    ['2026-10-03', '7159421', 'VARIANT-1'],
    ['2026-10-03', '6513589PX', 'UNKNOWN-1'],
  ]);
  assert.deepStrictEqual(unmappedPartsIn(tests), ['6513589PX']);

  const sheet = recordingAppender();
  const result = await exportDay('2026-10-03', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(result.unmappedParts, ['6513589PX'], 'the run says what it could not translate');
});

test('a backfill reports every untranslated part across the span, once each', async () => {
  resetInjectorData();
  seedTest({ id: 'r1', serial: 'SPAN-1', part: '2897320', datetime: '2026-10-02T15:00:00+00:00' });
  seedTest({ id: 'r2', serial: 'SPAN-2', part: 'MYSTERY-9', datetime: '2026-10-04T15:00:00+00:00' });
  seedTest({ id: 'r3', serial: 'SPAN-3', part: 'MYSTERY-9', datetime: '2026-10-06T15:00:00+00:00' });

  const sheet = recordingAppender();
  const result = await exportRange('2026-10-01', '2026-10-08', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(result.unmappedParts, ['MYSTERY-9']);
  assert.deepStrictEqual(sheet.calls[0].rows.map((row) => row[1]), ['7159419', 'MYSTERY-9', 'MYSTERY-9']);
});

// ── Late-arriving bench data ────────────────────────────────────────────────
// The failure this model exists to prevent: the bench data is imported by a
// manual sync, so a scheduled run at 00:05 routinely sees a day that has no
// tests in it yet. Closing that day lost everything synced afterwards.
test('a scheduled run sends everything outstanding, not just yesterday', async () => {
  resetInjectorData();
  const sheet = recordingAppender();
  const midday = (day) => new Date(`2026-10-${day}T18:00:00Z`);

  // Nights 17-22: the run fires, the database is still empty, nothing is sent.
  for (const day of ['17', '18', '19', '20', '21', '22']) {
    const nightly = await exportOutstanding({ appendRows: sheet.appendRows, now: midday(day) });
    assert.strictEqual(nightly.rows, 0, `nothing to send on the ${day}th`);
    assert.strictEqual(nightly.reason, 'nothing_outstanding');
  }
  assert.strictEqual(sheet.calls.length, 0);

  // Someone finally presses Sync, and a week of tests arrives at once.
  seedTest({ id: 'late-16', serial: 'LATE-16', datetime: '2026-10-16T15:00:00+00:00' });
  seedTest({ id: 'late-19', serial: 'LATE-19', datetime: '2026-10-19T15:00:00+00:00' });
  seedTest({ id: 'late-21', serial: 'LATE-21', datetime: '2026-10-21T15:00:00+00:00' });
  seedTest({ id: 'late-21f', serial: 'LATE-21F', datetime: '2026-10-21T16:00:00+00:00', pass: false });

  // The next run sweeps all of it up, each row under the day it was run.
  const sweep = await exportOutstanding({ appendRows: sheet.appendRows, now: midday('23') });
  assert.deepStrictEqual(
    { through: sweep.through, rows: sweep.rows, days: sweep.days, appended: sweep.appended },
    { through: '2026-10-22', rows: 3, days: 3, appended: 3 },
  );
  assert.deepStrictEqual(sheet.calls[0].rows.map((row) => [row[0], row[2]]), [
    ['2026-10-16', 'LATE-16'],
    ['2026-10-19', 'LATE-19'],
    ['2026-10-21', 'LATE-21'],
  ], 'every late test lands under the day it was actually run');

  // And the run after that has nothing left to do.
  const quiet = await exportOutstanding({ appendRows: sheet.appendRows, now: midday('24') });
  assert.strictEqual(quiet.reason, 'nothing_outstanding');
  assert.strictEqual(sheet.calls.length, 1, 'nothing was sent twice');
});

test('a test synced after its day was exported still goes up, exactly once', async () => {
  resetInjectorData();
  const sheet = recordingAppender();
  seedTest({ id: 'first', serial: 'ONTIME-1', datetime: '2026-10-20T15:00:00+00:00' });

  const first = await exportOutstanding({ appendRows: sheet.appendRows, now: new Date('2026-10-21T18:00:00Z') });
  assert.strictEqual(first.appended, 1);

  // A second test for the SAME day arrives on a later sync.
  seedTest({ id: 'straggler', serial: 'LATE-1', datetime: '2026-10-20T16:00:00+00:00' });
  const second = await exportOutstanding({ appendRows: sheet.appendRows, now: new Date('2026-10-22T18:00:00Z') });
  assert.strictEqual(second.appended, 1, 'the straggler is sent');
  assert.deepStrictEqual(sheet.calls[1].rows.map((row) => row[2]), ['LATE-1']);

  // The one already sent is not sent again.
  const third = await exportOutstanding({ appendRows: sheet.appendRows, now: new Date('2026-10-23T18:00:00Z') });
  assert.strictEqual(third.reason, 'nothing_outstanding');
  assert.strictEqual(sheet.calls.length, 2);
});

test("a scheduled run never sends today's tests, which are still being run", async () => {
  resetInjectorData();
  const sheet = recordingAppender();
  seedTest({ id: 'yesterday', serial: 'YEST-9', datetime: '2026-10-20T15:00:00+00:00' });
  seedTest({ id: 'today', serial: 'TODAY-9', datetime: '2026-10-21T15:00:00+00:00' });

  const run = await exportOutstanding({ appendRows: sheet.appendRows, now: new Date('2026-10-21T18:00:00Z') });
  assert.strictEqual(run.through, '2026-10-20');
  assert.deepStrictEqual(sheet.calls[0].rows.map((row) => row[2]), ['YEST-9']);
  assert.strictEqual(pendingSummary('2026-10-21').rows, 1, "today's test is still waiting its turn");
});

test('the status reports what is waiting, so a stalled export is visible', async () => {
  resetInjectorData();
  seedTest({ id: 'p1', serial: 'PEND-1', datetime: '2026-10-02T15:00:00+00:00' });
  seedTest({ id: 'p2', serial: 'PEND-2', datetime: '2026-10-09T15:00:00+00:00' });
  seedTest({ id: 'p3', serial: 'PEND-3', datetime: '2026-10-09T16:00:00+00:00' });

  assert.deepStrictEqual(pendingSummary('2026-10-15'), {
    rows: 3, days: 2, oldestDay: '2026-10-02', newestDay: '2026-10-09',
  });

  const sheet = recordingAppender();
  await exportRange('2026-10-01', '2026-10-15', { appendRows: sheet.appendRows });
  assert.deepStrictEqual(pendingSummary('2026-10-15'), {
    rows: 0, days: 0, oldestDay: null, newestDay: null,
  });
  assert.strictEqual(exportStatus().lastExportedDay, '2026-10-09', 'read from the rows that were sent');
});

test('force resends tests that have already been written', async () => {
  resetInjectorData();
  const sheet = recordingAppender();
  seedTest({ id: 'once', serial: 'ONCE-1', datetime: '2026-10-20T15:00:00+00:00' });

  await exportOutstanding({ appendRows: sheet.appendRows, now: new Date('2026-10-21T18:00:00Z') });
  const forced = await exportOutstanding({ appendRows: sheet.appendRows, force: true, now: new Date('2026-10-21T18:00:00Z') });
  assert.strictEqual(forced.appended, 1, 'force ignores the marks');
  assert.deepStrictEqual(sheet.calls[1].rows.map((row) => row[2]), ['ONCE-1']);
});
