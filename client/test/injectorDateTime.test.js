import test from 'node:test'
import assert from 'node:assert'

import { formatInjectorTestDateTime } from '../src/lib/injectorDateTime.js'

test('formats the Tested timestamp as MM/DD/YY with a 12-hour time', () => {
  assert.strictEqual(
    formatInjectorTestDateTime('2026-08-21T13:40:56+00:00'),
    '08/21/26, 01:40 PM',
  )
  assert.strictEqual(
    formatInjectorTestDateTime('2026-08-21T00:05:09Z'),
    '08/21/26, 12:05 AM',
  )
})

test('preserves the report clock instead of converting it to the viewer time zone', () => {
  assert.strictEqual(
    formatInjectorTestDateTime('2026-08-21T23:09:00-06:00'),
    '08/21/26, 11:09 PM',
  )
  assert.strictEqual(
    formatInjectorTestDateTime('2026-08-21 07:33:41'),
    '08/21/26, 07:33 AM',
  )
})

test('handles a date-only value, blanks, and malformed legacy values safely', () => {
  assert.strictEqual(formatInjectorTestDateTime('2026-08-21'), '08/21/26')
  assert.strictEqual(formatInjectorTestDateTime(''), '—')
  assert.strictEqual(formatInjectorTestDateTime(null), '—')
  assert.strictEqual(formatInjectorTestDateTime('not-a-date'), 'not-a-date')
  assert.strictEqual(formatInjectorTestDateTime('2026-02-30T12:00:00Z'), '2026-02-30T12:00:00Z')
})
