/**
 * Injector test timestamps, shown on the shop's clock.
 *
 * Every timestamp the app stores is an absolute instant in UTC: the CarbonZapp
 * bench sends "2026-06-30T13:40:56+00:00", and the database writes its own
 * timestamps as UTC with no zone marker at all. Printing those digits as they
 * come put a 7:40 AM test on screen as 1:40 PM, so they are converted to the
 * shop's time zone here, in the one place every injector view formats through.
 *
 * A DATE-ONLY value ("2026-06-30") names a calendar day rather than an instant,
 * so it is shown exactly as given — converting it would move it a day.
 */

// Mountain Time, which is MST in winter and MDT through daylight saving. Set
// VITE_INJECTOR_TIME_ZONE to any IANA zone to override it — America/Phoenix for
// a shop that does not observe daylight saving — and set INJECTOR_TIME_ZONE on
// the server to the same value so reports and filters agree with the screen.
const configuredZone =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_INJECTOR_TIME_ZONE) || ''

export const TEST_TIME_ZONE = String(configuredZone).trim() || 'America/Denver'

// YYYY-MM-DD, optionally followed by a time and a zone marker. A value with no
// marker is UTC — that is how the database writes its own timestamps.
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i

/** Minutes east of UTC for a "+07:00" / "-0600" / "Z" marker. */
function offsetMinutes(marker) {
  if (!marker || marker.toUpperCase() === 'Z') return 0
  const sign = marker[0] === '-' ? -1 : 1
  const digits = marker.slice(1).replace(':', '')
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)))
}

/** Days in a month, so 2026-02-30 is rejected rather than rolled over. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Split a stored timestamp into the instant it names.
 *
 * Returns { instant, dateOnly, raw } — `instant` is a Date for a value that
 * carries a time, `dateOnly` the calendar day for one that does not, and both
 * are null when the value is not a timestamp this app writes.
 */
export function parseTestTimestamp(value) {
  const raw = value == null ? '' : String(value).trim()
  const match = raw.match(TIMESTAMP)
  if (!match) return { instant: null, dateOnly: null, raw }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, marker] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { instant: null, dateOnly: null, raw }
  }
  if (hourText == null) return { instant: null, dateOnly: `${yearText}-${monthText}-${dayText}`, raw }

  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = secondText == null ? 0 : Number(secondText)
  if (hour > 23 || minute > 59 || second > 59) return { instant: null, dateOnly: null, raw }

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes(marker) * 60000
  return { instant: new Date(utcMs), dateOnly: null, raw }
}

/** The instant's calendar/clock fields in `timeZone`. */
function zonedParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // h23 rather than hour12:false, which renders midnight as "24" in some engines.
    hourCycle: 'h23',
  }).formatToParts(instant)
  const field = (type) => parts.find((part) => part.type === type)?.value || ''
  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
  }
}

/**
 * The calendar day a test belongs to on the shop's clock ("2026-06-30").
 *
 * This is what the date filters compare against, so a test run at 7pm Mountain
 * is filtered under the day it was run rather than the next UTC day.
 */
export function zonedTestDate(value, timeZone = TEST_TIME_ZONE) {
  const { instant, dateOnly } = parseTestTimestamp(value)
  if (dateOnly) return dateOnly
  if (!instant) return ''
  const { year, month, day } = zonedParts(instant, timeZone)
  return `${year}-${month}-${day}`
}

/** The zone's abbreviation at that instant — "MST" in winter, "MDT" in summer. */
export function testTimeZoneLabel(value = new Date(), timeZone = TEST_TIME_ZONE) {
  const { instant } = parseTestTimestamp(value)
  const when = instant || (value instanceof Date ? value : new Date())
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(when)
  return parts.find((part) => part.type === 'timeZoneName')?.value || ''
}

/**
 * "06/30/26, 07:40 AM" — the test's date and time on the shop's clock.
 *
 * A value this app never writes is returned untouched rather than guessed at.
 */
export function formatInjectorTestDateTime(value, { timeZone = TEST_TIME_ZONE, withZone = false } = {}) {
  if (value == null || String(value).trim() === '') return '—'

  const { instant, dateOnly, raw } = parseTestTimestamp(value)
  if (dateOnly) {
    const [year, month, day] = dateOnly.split('-')
    return `${month}/${day}/${year.slice(-2)}`
  }
  if (!instant) return raw

  const { year, month, day, hour, minute } = zonedParts(instant, timeZone)
  const hour24 = Number(hour)
  const hour12 = hour24 % 12 || 12
  const period = hour24 < 12 ? 'AM' : 'PM'
  const stamp = `${month}/${day}/${year.slice(-2)}, ${String(hour12).padStart(2, '0')}:${minute} ${period}`
  return withZone ? `${stamp} ${testTimeZoneLabel(instant, timeZone)}` : stamp
}
