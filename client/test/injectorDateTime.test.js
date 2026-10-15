/**
 * Injector timestamps are stored in UTC and shown on the shop's clock
 * (America/Denver by default), so these assert the conversion, not the digits
 * the bench happened to send.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  formatInjectorTestDateTime,
  parseTestTimestamp,
  zonedTestDate,
  testTimeZoneLabel,
  TEST_TIME_ZONE,
} from '../src/lib/injectorDateTime.js'

test('the default zone is Mountain Time', () => {
  assert.strictEqual(TEST_TIME_ZONE, 'America/Denver')
})

test('a UTC bench timestamp is shown on the Mountain clock', () => {
  // 13:40 UTC in summer is 07:40 MDT (UTC-6) — not the 01:40 PM the raw digits read as.
  assert.strictEqual(formatInjectorTestDateTime('2026-06-30T13:40:56+00:00'), '06/30/26, 07:40 AM')
  // In January the same clock reading is MST (UTC-7).
  assert.strictEqual(formatInjectorTestDateTime('2026-01-15T13:40:56+00:00'), '01/15/26, 06:40 AM')
  assert.strictEqual(formatInjectorTestDateTime('2026-08-21T00:05:09Z'), '08/20/26, 06:05 PM')
})

test('a timestamp with no zone marker is UTC, which is how the database writes its own', () => {
  assert.strictEqual(formatInjectorTestDateTime('2026-08-21 07:33:41'), '08/21/26, 01:33 AM')
  assert.strictEqual(formatInjectorTestDateTime('2026-08-21T07:33:41'), '08/21/26, 01:33 AM')
})

test('a timestamp carrying its own offset is converted from the instant it names', () => {
  // 23:09 at UTC-06:00 is 05:09 UTC the next day, which is 11:09 PM the same
  // evening in Mountain summer time.
  assert.strictEqual(formatInjectorTestDateTime('2026-08-21T23:09:00-06:00'), '08/21/26, 11:09 PM')
  assert.strictEqual(formatInjectorTestDateTime('2026-08-21T23:09:00+02:00'), '08/21/26, 03:09 PM')
})

test('midnight and noon read as 12, not 00 or 24', () => {
  assert.strictEqual(formatInjectorTestDateTime('2026-06-30T06:00:00Z'), '06/30/26, 12:00 AM')
  assert.strictEqual(formatInjectorTestDateTime('2026-06-30T18:00:00Z'), '06/30/26, 12:00 PM')
})

test('a date-only value names a day, so it is never shifted', () => {
  assert.strictEqual(formatInjectorTestDateTime('2026-08-21'), '08/21/26')
  assert.strictEqual(zonedTestDate('2026-08-21'), '2026-08-21')
})

test('blanks and values the app never writes are left alone', () => {
  assert.strictEqual(formatInjectorTestDateTime(''), '—')
  assert.strictEqual(formatInjectorTestDateTime(null), '—')
  assert.strictEqual(formatInjectorTestDateTime('not-a-date'), 'not-a-date')
  assert.strictEqual(formatInjectorTestDateTime('2026-02-30T12:00:00Z'), '2026-02-30T12:00:00Z')
  assert.strictEqual(formatInjectorTestDateTime('2026-06-30T25:00:00Z'), '2026-06-30T25:00:00Z')
  assert.strictEqual(zonedTestDate('not-a-date'), '')
})

test('an evening test belongs to the day it was run, not the next UTC day', () => {
  // 01:00 UTC on 1 July is 7pm Mountain on 30 June.
  assert.strictEqual(zonedTestDate('2026-07-01T01:00:00Z'), '2026-06-30')
  assert.strictEqual(formatInjectorTestDateTime('2026-07-01T01:00:00Z'), '06/30/26, 07:00 PM')
  assert.strictEqual(zonedTestDate('2026-06-30T13:40:56+00:00'), '2026-06-30')
})

test('another zone can be asked for explicitly', () => {
  // Arizona keeps MST all year, so the same instant reads an hour earlier in summer.
  assert.strictEqual(
    formatInjectorTestDateTime('2026-06-30T13:40:56Z', { timeZone: 'America/Phoenix' }),
    '06/30/26, 06:40 AM',
  )
  assert.strictEqual(zonedTestDate('2026-07-01T01:00:00Z', 'UTC'), '2026-07-01')
})

test('the zone label follows daylight saving', () => {
  assert.strictEqual(testTimeZoneLabel('2026-06-30T13:40:56Z'), 'MDT')
  assert.strictEqual(testTimeZoneLabel('2026-01-15T13:40:56Z'), 'MST')
  assert.strictEqual(
    formatInjectorTestDateTime('2026-06-30T13:40:56Z', { withZone: true }),
    '06/30/26, 07:40 AM MDT',
  )
})

test('parsing separates an instant from a calendar day', () => {
  const instant = parseTestTimestamp('2026-06-30T13:40:56+00:00')
  assert.strictEqual(instant.instant.toISOString(), '2026-06-30T13:40:56.000Z')
  assert.strictEqual(instant.dateOnly, null)

  const day = parseTestTimestamp('2026-06-30')
  assert.strictEqual(day.instant, null)
  assert.strictEqual(day.dateOnly, '2026-06-30')

  const offset = parseTestTimestamp('2026-06-30T13:40:56-0700')
  assert.strictEqual(offset.instant.toISOString(), '2026-06-30T20:40:56.000Z')
})
