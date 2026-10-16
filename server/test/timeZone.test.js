'use strict';
/**
 * The shop clock: stored timestamps are UTC instants, and every injector date
 * the server derives from them is the day they fall on in Mountain Time.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_TIME_ZONE,
  testTimeZone,
  zonedTestDate,
  formatZonedDateTime,
  zonedTimeToInstant,
  zonedDayRange,
  currentZonedDay,
  previousDay,
  zoneLabel,
} = require('../services/timeZone');

test('the default zone is Mountain Time, and the environment can move it', () => {
  assert.strictEqual(DEFAULT_TIME_ZONE, 'America/Denver');
  assert.strictEqual(testTimeZone(), 'America/Denver');

  const previous = process.env.INJECTOR_TIME_ZONE;
  process.env.INJECTOR_TIME_ZONE = 'America/Phoenix';
  try {
    assert.strictEqual(testTimeZone(), 'America/Phoenix');
    assert.strictEqual(zonedTestDate('2026-07-01T01:00:00Z'), '2026-06-30');
  } finally {
    if (previous == null) delete process.env.INJECTOR_TIME_ZONE;
    else process.env.INJECTOR_TIME_ZONE = previous;
  }
});

test('a test belongs to the day it was run on the shop clock', () => {
  // 01:00 UTC on 1 July is 7pm Mountain on 30 June.
  assert.strictEqual(zonedTestDate('2026-07-01T01:00:00Z'), '2026-06-30');
  assert.strictEqual(zonedTestDate('2026-06-30T13:40:56+00:00'), '2026-06-30');
  // Just before and after midnight Mountain (06:00Z in summer).
  assert.strictEqual(zonedTestDate('2026-07-01T05:59:59Z'), '2026-06-30');
  assert.strictEqual(zonedTestDate('2026-07-01T06:00:00Z'), '2026-07-01');
});

test('a value with no zone marker is UTC; a date-only value is already a day', () => {
  assert.strictEqual(zonedTestDate('2026-08-21 07:33:41'), '2026-08-21');
  assert.strictEqual(zonedTestDate('2026-08-21 05:33:41'), '2026-08-20');
  assert.strictEqual(zonedTestDate('2026-08-21'), '2026-08-21');
  assert.strictEqual(zonedTestDate(''), '');
  assert.strictEqual(zonedTestDate('not-a-date'), '');
  assert.strictEqual(zonedTestDate('2026-02-30T12:00:00Z'), '');
});

test('timestamps are printed on the shop clock', () => {
  assert.strictEqual(formatZonedDateTime('2026-06-30T13:40:56+00:00'), '06/30/26, 07:40 AM');
  assert.strictEqual(formatZonedDateTime('2026-01-15T13:40:56Z'), '01/15/26, 06:40 AM');
  assert.strictEqual(formatZonedDateTime('2026-06-30T06:00:00Z'), '06/30/26, 12:00 AM');
  assert.strictEqual(formatZonedDateTime('2026-06-30'), '06/30/26');
  assert.strictEqual(formatZonedDateTime('nonsense'), '');
});

test('midnight on the shop clock resolves to the right UTC instant in both seasons', () => {
  assert.strictEqual(zonedTimeToInstant('2026-06-30', { hour: 0 }).toISOString(), '2026-06-30T06:00:00.000Z');
  assert.strictEqual(zonedTimeToInstant('2026-01-15', { hour: 0 }).toISOString(), '2026-01-15T07:00:00.000Z');
  assert.strictEqual(zonedTimeToInstant('2026-06-30', { hour: 17, minute: 30 }).toISOString(), '2026-06-30T23:30:00.000Z');
});

test('a day is the half-open instant range that selects it', () => {
  const day = zonedDayRange('2026-06-30');
  assert.deepStrictEqual(
    { from: day.from, to: day.to, nextDay: day.nextDay },
    { from: '2026-06-30T06:00:00.000Z', to: '2026-07-01T06:00:00.000Z', nextDay: '2026-07-01' },
  );
  // A test at the very end of the day is inside the range; midnight starts the next one.
  assert.ok('2026-07-01T05:59:59Z' < day.to && '2026-07-01T05:59:59Z' > day.from);
});

test('daylight-saving days are 23 and 25 hours long', () => {
  const hours = (range) => (Date.parse(range.to) - Date.parse(range.from)) / 3600000;
  // 8 March 2026: clocks spring forward, so the day loses an hour.
  const springForward = zonedDayRange('2026-03-08');
  assert.strictEqual(hours(springForward), 23);
  assert.strictEqual(springForward.from, '2026-03-08T07:00:00.000Z');
  assert.strictEqual(springForward.to, '2026-03-09T06:00:00.000Z');
  // 1 November 2026: clocks fall back, so the day gains one.
  const fallBack = zonedDayRange('2026-11-01');
  assert.strictEqual(hours(fallBack), 25);
  assert.strictEqual(fallBack.from, '2026-11-01T06:00:00.000Z');
  assert.strictEqual(fallBack.to, '2026-11-02T07:00:00.000Z');
  // An ordinary day either side is 24.
  assert.strictEqual(hours(zonedDayRange('2026-06-30')), 24);
});

test('a wall-clock time the spring-forward morning never has resolves to the jump', () => {
  // 02:30 on 8 March 2026 does not exist in Mountain Time; the clock goes
  // straight from 01:59:59 MST to 03:00:00 MDT.
  assert.strictEqual(zonedTimeToInstant('2026-03-08', { hour: 2, minute: 30 }).toISOString(), '2026-03-08T09:30:00.000Z');
});

test('the current day and the day before it are read on the shop clock', () => {
  // 03:00 UTC on 1 July is still 9pm on 30 June in Mountain Time.
  assert.strictEqual(currentZonedDay(new Date('2026-07-01T03:00:00Z')), '2026-06-30');
  assert.strictEqual(currentZonedDay(new Date('2026-07-01T07:00:00Z')), '2026-07-01');
  assert.strictEqual(previousDay('2026-07-01'), '2026-06-30');
  assert.strictEqual(previousDay('2026-01-01'), '2025-12-31');
  assert.strictEqual(previousDay('2026-03-02'), '2026-03-01');
});

test('the zone label follows daylight saving', () => {
  assert.strictEqual(zoneLabel(new Date('2026-06-30T13:40:56Z')), 'MDT');
  assert.strictEqual(zoneLabel(new Date('2026-01-15T13:40:56Z')), 'MST');
});
