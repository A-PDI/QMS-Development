'use strict';
/**
 * Injector test timestamps on the shop's clock.
 *
 * Every timestamp this app stores is an absolute instant in UTC: the CarbonZapp
 * bench sends "2026-06-30T13:40:56+00:00", and SQLite writes its own timestamps
 * as UTC with no zone marker at all. The shop reads them in Mountain Time, so
 * the calendar day a test belongs to — the day a report header prints, a date
 * filter selects on, and the daily export groups by — is its day in that zone,
 * not in UTC. A test run at 7pm Mountain is otherwise filed under the next day.
 *
 * This mirrors client/src/lib/injectorDateTime.js, which formats the same
 * values for the screen. Set INJECTOR_TIME_ZONE (server) and
 * VITE_INJECTOR_TIME_ZONE (client) to the same IANA zone to move both.
 */

const DEFAULT_TIME_ZONE = 'America/Denver';

/** The zone every injector date is resolved in. */
function testTimeZone() {
  return String(process.env.INJECTOR_TIME_ZONE || '').trim() || DEFAULT_TIME_ZONE;
}

// YYYY-MM-DD, optionally followed by a time and a zone marker. No marker means
// UTC — that is how the database writes its own timestamps.
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

/** Minutes east of UTC for a "+07:00" / "-0600" / "Z" marker. */
function offsetMinutes(marker) {
  if (!marker || marker.toUpperCase() === 'Z') return 0;
  const sign = marker[0] === '-' ? -1 : 1;
  const digits = marker.slice(1).replace(':', '');
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/** Days in a month, so 2026-02-30 is rejected rather than rolled over. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Split a stored timestamp into the instant it names.
 *
 * Returns { instant, dateOnly } — `instant` is a Date for a value carrying a
 * time, `dateOnly` the calendar day for one that does not (a day has no instant
 * to convert), and both are null for anything this app does not write.
 */
function parseTestTimestamp(value) {
  const raw = value == null ? '' : String(value).trim();
  const match = raw.match(TIMESTAMP);
  if (!match) return { instant: null, dateOnly: null };

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, marker] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { instant: null, dateOnly: null };
  }
  if (hourText == null) return { instant: null, dateOnly: `${yearText}-${monthText}-${dayText}` };

  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText == null ? 0 : Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return { instant: null, dateOnly: null };

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes(marker) * 60000;
  return { instant: new Date(utcMs), dateOnly: null };
}

/** The instant's calendar/clock fields in `timeZone`, as numbers. */
function zonedParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23 rather than hour12:false, which renders midnight as "24" in some engines.
    hourCycle: 'h23',
  }).formatToParts(instant);
  const field = (type) => Number((parts.find((part) => part.type === type) || {}).value);
  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
    second: field('second'),
  };
}

const pad = (value, width = 2) => String(value).padStart(width, '0');

/**
 * The calendar day a test belongs to on the shop's clock ("2026-06-30"), or ''
 * when the value is not a timestamp. A date-only value is already a day and is
 * returned unchanged.
 */
function zonedTestDate(value, timeZone = testTimeZone()) {
  const { instant, dateOnly } = parseTestTimestamp(value);
  if (dateOnly) return dateOnly;
  if (!instant) return '';
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "06/30/26, 07:40 AM" on the shop's clock, or '' when there is no instant. */
function formatZonedDateTime(value, timeZone = testTimeZone()) {
  const { instant, dateOnly } = parseTestTimestamp(value);
  if (dateOnly) {
    const [year, month, day] = dateOnly.split('-');
    return `${month}/${day}/${year.slice(-2)}`;
  }
  if (!instant) return '';
  const { year, month, day, hour, minute } = zonedParts(instant, timeZone);
  const hour12 = hour % 12 || 12;
  return `${pad(month)}/${pad(day)}/${String(year).slice(-2)}, ${pad(hour12)}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The zone's offset from UTC, in milliseconds, at that instant. */
function zoneOffsetMs(instant, timeZone) {
  const { year, month, day, hour, minute, second } = zonedParts(instant, timeZone);
  return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which a wall-clock time occurs in `timeZone`.
 *
 * The zone's offset depends on the instant we are solving for, so the first
 * pass guesses with the offset in force at the naive reading and the second
 * corrects it. A candidate is only right if the zone reads it back as the time
 * that was asked for, which settles both daylight-saving switches: a time that
 * happens twice (01:30 on a fall-back morning) resolves to its first
 * occurrence, and one that never happens (02:30 on a spring-forward morning)
 * resolves forward to the instant the clock jumps to, so a job scheduled then
 * still runs that day instead of being skipped.
 */
function zonedTimeToInstant(day, { hour = 0, minute = 0, second = 0 } = {}, timeZone = testTimeZone()) {
  const [year, month, date] = String(day).split('-').map(Number);
  const naive = Date.UTC(year, month - 1, date, hour, minute, second);

  const firstPass = zoneOffsetMs(new Date(naive), timeZone);
  const candidate = new Date(naive - firstPass);
  if (zoneOffsetMs(candidate, timeZone) === firstPass) return candidate;

  const secondPass = zoneOffsetMs(candidate, timeZone);
  const corrected = new Date(naive - secondPass);
  if (zoneOffsetMs(corrected, timeZone) === secondPass) return corrected;

  // Neither reading exists on the clock: take the later one, which is the
  // instant the gap ends.
  return new Date(Math.max(candidate.getTime(), corrected.getTime()));
}

/**
 * One calendar day in the shop's zone, as the half-open instant range
 * [from, to) that selects it — 23, 24 or 25 hours long across a daylight-saving
 * switch. Returned as ISO strings, which is the form stored timestamps compare
 * against through SQLite's datetime().
 */
function zonedDayRange(day, timeZone = testTimeZone()) {
  const from = zonedTimeToInstant(day, { hour: 0 }, timeZone);
  const [year, month, date] = String(day).split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, date + 1));
  const next = `${nextDay.getUTCFullYear()}-${pad(nextDay.getUTCMonth() + 1)}-${pad(nextDay.getUTCDate())}`;
  const to = zonedTimeToInstant(next, { hour: 0 }, timeZone);
  return { day: String(day), from: from.toISOString(), to: to.toISOString(), nextDay: next };
}

/** Today on the shop's clock ("2026-06-30"). */
function currentZonedDay(now = new Date(), timeZone = testTimeZone()) {
  return zonedTestDate(now.toISOString(), timeZone);
}

/** The day before `day` ("2026-07-01" → "2026-06-30"). */
function previousDay(day) {
  const [year, month, date] = String(day).split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, date - 1));
  return `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-${pad(previous.getUTCDate())}`;
}

/** The zone's abbreviation at that instant — "MST" in winter, "MDT" in summer. */
function zoneLabel(instant = new Date(), timeZone = testTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(instant);
  return (parts.find((part) => part.type === 'timeZoneName') || {}).value || '';
}

module.exports = {
  DEFAULT_TIME_ZONE,
  testTimeZone,
  parseTestTimestamp,
  zonedTestDate,
  formatZonedDateTime,
  zonedTimeToInstant,
  zonedDayRange,
  currentZonedDay,
  previousDay,
  zoneLabel,
};
