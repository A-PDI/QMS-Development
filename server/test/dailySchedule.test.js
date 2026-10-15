'use strict';
/**
 * The daily job keeps its slot on the shop's clock, including the two mornings
 * a year when that clock jumps.
 */

const test = require('node:test');
const assert = require('node:assert');

const { parseTimeOfDay, nextRunAt, startDailyJob } = require('../services/dailySchedule');

const MOUNTAIN = 'America/Denver';

test('a time of day is read, or refused', () => {
  assert.deepStrictEqual(parseTimeOfDay('00:05'), { hour: 0, minute: 5 });
  assert.deepStrictEqual(parseTimeOfDay('6:30'), { hour: 6, minute: 30 });
  assert.deepStrictEqual(parseTimeOfDay(' 23:59 '), { hour: 23, minute: 59 });
  for (const bad of ['24:00', '12:60', '12', 'noon', '', null, '12:5']) {
    assert.strictEqual(parseTimeOfDay(bad), null, `${bad} is not a time of day`);
  }
  assert.throws(() => nextRunAt(new Date(), 'noon', MOUNTAIN), /Not a time of day/);
});

test('the next run is tonight when it is still ahead, and tomorrow once it has passed', () => {
  // 00:05 Mountain in summer is 06:05 UTC.
  const beforeTonight = new Date('2026-06-30T03:00:00Z');   // 9pm 29 June, Mountain
  assert.strictEqual(nextRunAt(beforeTonight, '00:05', MOUNTAIN).toISOString(), '2026-06-30T06:05:00.000Z');

  // A minute after the slot, the next one is the following day.
  const justAfter = new Date('2026-06-30T06:06:00Z');
  assert.strictEqual(nextRunAt(justAfter, '00:05', MOUNTAIN).toISOString(), '2026-07-01T06:05:00.000Z');

  // Exactly on the slot counts as done, so the job never fires twice.
  const onTheSlot = new Date('2026-06-30T06:05:00Z');
  assert.strictEqual(nextRunAt(onTheSlot, '00:05', MOUNTAIN).toISOString(), '2026-07-01T06:05:00.000Z');
});

test('the slot stays at the same wall-clock time through both daylight-saving switches', () => {
  const localTime = (instant) => new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(instant);

  // Spring forward, 8 March 2026: the UTC instant moves, the shop clock does not.
  const beforeSpring = nextRunAt(new Date('2026-03-07T12:00:00Z'), '00:05', MOUNTAIN);
  const afterSpring = nextRunAt(new Date('2026-03-09T12:00:00Z'), '00:05', MOUNTAIN);
  assert.strictEqual(beforeSpring.toISOString(), '2026-03-08T07:05:00.000Z');
  assert.strictEqual(afterSpring.toISOString(), '2026-03-10T06:05:00.000Z');
  assert.strictEqual(localTime(beforeSpring), '00:05');
  assert.strictEqual(localTime(afterSpring), '00:05');

  // Fall back, 1 November 2026.
  const beforeFall = nextRunAt(new Date('2026-10-31T12:00:00Z'), '00:05', MOUNTAIN);
  const afterFall = nextRunAt(new Date('2026-11-02T12:00:00Z'), '00:05', MOUNTAIN);
  assert.strictEqual(beforeFall.toISOString(), '2026-11-01T06:05:00.000Z');
  assert.strictEqual(afterFall.toISOString(), '2026-11-03T07:05:00.000Z');
  assert.strictEqual(localTime(beforeFall), '00:05');
  assert.strictEqual(localTime(afterFall), '00:05');
});

test('an evening slot is resolved on the shop clock too', () => {
  assert.strictEqual(nextRunAt(new Date('2026-06-30T12:00:00Z'), '19:00', MOUNTAIN).toISOString(), '2026-07-01T01:00:00.000Z');
});

/**
 * The schedule has minute granularity, so these drive it with a clock that
 * sits just before a slot and steps past it, rather than waiting on a real one.
 */
function atSlot() {
  const slot = new Date(Date.now() + 60000);
  slot.setSeconds(0, 0);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(slot);
  let reads = 0;
  // Just before the slot on the first read, just after it on every later one,
  // so the job fires once and then schedules the next day.
  const now = () => new Date(slot.getTime() + (reads++ === 0 ? -10 : 1000));
  return { slot, time, now };
}

test('the job runs, reschedules, and survives a task that throws', async () => {
  const runs = [];
  const failures = [];
  const { slot, time, now } = atSlot();

  const job = startDailyJob({
    time,
    timeZone: MOUNTAIN,
    now,
    task: async () => {
      runs.push(Date.now());
      throw new Error('bench offline');
    },
    onError: (err) => failures.push(err.message),
  });

  assert.strictEqual(job.nextRun.getTime(), slot.getTime(), 'the next run is reported up front');
  await new Promise((resolve) => setTimeout(resolve, 120));
  job.stop();

  assert.strictEqual(runs.length, 1, 'the task ran once');
  assert.deepStrictEqual(failures, ['bench offline'], 'the failure was reported, not thrown');
  assert.strictEqual(
    job.nextRun.getTime() - slot.getTime(),
    24 * 60 * 60 * 1000,
    'the same slot tomorrow was scheduled anyway',
  );
});

test('stopping the job keeps it from running again', async () => {
  const runs = [];
  const { time, now } = atSlot();
  const job = startDailyJob({
    time,
    timeZone: MOUNTAIN,
    now,
    task: () => { runs.push(Date.now()); },
  });
  job.stop();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepStrictEqual(runs, [], 'a stopped job does not fire');
});

test('a task is required', () => {
  assert.throws(() => startDailyJob({ time: '00:05' }), /needs a task/);
});
