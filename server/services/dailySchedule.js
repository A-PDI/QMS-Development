'use strict';
/**
 * A once-a-day job, timed by the shop's clock.
 *
 * The server runs as a single process (PM2 fork / one Render web service), so a
 * timer inside it is the whole scheduler — there is no second instance to
 * double-fire. Each run schedules the next one from the wall-clock time rather
 * than by adding 24 hours, so the job keeps its slot across both daylight-saving
 * switches instead of drifting an hour twice a year.
 *
 * `nextRunAt` is a plain function of (now, time, zone) and carries the whole
 * rule, so the timing is tested without waiting for a clock.
 */

const { zonedTimeToInstant, currentZonedDay, testTimeZone } = require('./timeZone');

/** "00:05" → { hour: 0, minute: 5 }, or null when it is not a time of day. */
function parseTimeOfDay(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value == null ? '' : value).trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * The next instant at which `time` strikes in `timeZone`, strictly after `now`.
 *
 * Today's slot is used when it is still ahead; otherwise tomorrow's. Both are
 * resolved through the zone, so the gap and the repeat around a daylight-saving
 * switch land on a real instant.
 */
function nextRunAt(now = new Date(), time = '00:05', timeZone = testTimeZone()) {
  const at = parseTimeOfDay(time);
  if (!at) throw new Error(`Not a time of day: "${time}" (expected HH:MM).`);

  const today = currentZonedDay(now, timeZone);
  const todaysRun = zonedTimeToInstant(today, at, timeZone);
  if (todaysRun.getTime() > now.getTime()) return todaysRun;

  // The day after `today` on the shop's calendar.
  const [year, month, day] = today.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const tomorrow = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return zonedTimeToInstant(tomorrow, at, timeZone);
}

/**
 * Run `task` every day at `time` on the shop's clock.
 *
 * Returns { nextRun, stop }. The timer is unref'd: it keeps no process alive on
 * its own, which matters for tests and for a shutdown that is already underway.
 * A task that throws is reported through `onError` and never stops the schedule.
 */
function startDailyJob({ time = '00:05', timeZone = testTimeZone(), task, onError = null, now = () => new Date() } = {}) {
  if (typeof task !== 'function') throw new Error('startDailyJob needs a task to run.');

  let timer = null;
  let stopped = false;
  const state = { nextRun: null, stop: null };

  const schedule = () => {
    if (stopped) return;
    const from = now();
    const at = nextRunAt(from, time, timeZone);
    state.nextRun = at;
    // Never a negative delay, and never longer than setTimeout can hold.
    const delay = Math.min(Math.max(at.getTime() - from.getTime(), 0), 2147483647);
    timer = setTimeout(async () => {
      try {
        await task();
      } catch (err) {
        if (onError) onError(err);
        else console.error('[DailyJob] Task failed:', err && err.message ? err.message : err);
      } finally {
        schedule();
      }
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
  };

  schedule();

  state.stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return state;
}

module.exports = { parseTimeOfDay, nextRunAt, startDailyJob };
