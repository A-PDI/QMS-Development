'use strict';
/**
 * Synchronisation safety.
 *
 * A full resync prunes reports the bench no longer has — which is destructive,
 * so it must never fire on a response we could not read properly. These tests
 * pin the two guards and the diagnostics that explain an empty import.
 */

const test = require('node:test');
const assert = require('node:assert');

const { db, resetInjectorData } = require('./helpers/testEnv');
const { benchBatch } = require('./helpers/benchData');
const carbonzapp = require('../services/carbonzapp');

/** Run a sync against a stubbed bench response; captures the request body. */
async function syncWith(reports, opts = {}) {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify(reports) };
  };
  try {
    const result = await carbonzapp.syncNow({ apiKey: 'test-key-1234', ...opts });
    return { result, requests };
  } finally {
    global.fetch = originalFetch;
  }
}

const rowCount = () => db.get('SELECT COUNT(*) AS c FROM injector_test_reports', []).c;

test('a full resync asks the bench for a wide date range, not for nothing', async () => {
  resetInjectorData();
  const { requests } = await syncWith(benchBatch(2), { fullResync: true });

  assert.strictEqual(requests.length, 1);
  assert.ok(requests[0].date_from, 'a full resync sends an explicit date_from');
  assert.ok(new Date(requests[0].date_from).getFullYear() <= 2000, 'the window covers the bench history');
});

test('an incremental sync still filters from the last sync', async () => {
  resetInjectorData();
  await syncWith(benchBatch(2));                       // sets the marker
  const { requests } = await syncWith(benchBatch(2));  // second, incremental

  assert.ok(requests[0].date_from, 'incremental syncs are still filtered');
  assert.ok(new Date(requests[0].date_from).getFullYear() >= 2020);
});

// ── Guard 1: an empty response must never delete anything ────────────────────
test('a full resync that returns nothing keeps every existing record', async () => {
  resetInjectorData();
  await syncWith(benchBatch(10));
  assert.strictEqual(rowCount(), 10);

  const { result } = await syncWith([], { fullResync: true });

  assert.strictEqual(rowCount(), 10, 'existing records must survive an empty response');
  assert.strictEqual(result.reportsDeleted, 0);
  assert.strictEqual(result.pruneSkipped.reason, 'empty_fetch');
  assert.strictEqual(result.pruneSkipped.wouldDeleteRows, 10);
});

test('an empty full resync does not advance the incremental sync marker', async () => {
  resetInjectorData();
  await syncWith(benchBatch(4));
  const marker = carbonzapp.getSetting('carbonzapp_last_sync');

  await syncWith([], { fullResync: true });

  assert.strictEqual(
    carbonzapp.getSetting('carbonzapp_last_sync'),
    marker,
    'a failed-looking resync must not skip the next incremental sync forward'
  );
});

test('records are kept when every fetched report is excluded by job routing', async () => {
  resetInjectorData();
  await syncWith(benchBatch(6, { job: 'QMS-700', prefix: 'AA' }));
  assert.strictEqual(rowCount(), 6);

  // The bench answers, but with another system's job numbers.
  const { result } = await syncWith(benchBatch(6, { job: 'RMA-9001', prefix: 'BB' }), { fullResync: true });

  assert.strictEqual(rowCount(), 6, 'nothing deleted');
  assert.strictEqual(result.fetchedTotal, 6);
  assert.strictEqual(result.fetched, 0);
  assert.strictEqual(result.excludedByRouting, 6);
  assert.deepStrictEqual(result.excludedJobNumbers, ['RMA-9001'], 'the reason is reported back');
  assert.strictEqual(result.jobPrefix, 'QMS');
  assert.strictEqual(result.pruneSkipped.reason, 'empty_fetch');
});

// ── Guard 2: a suspiciously large prune needs confirmation ───────────────────
test('a full resync holds back a prune that would remove most of the data', async () => {
  resetInjectorData();
  await syncWith(benchBatch(20, { perReport: 4 }));
  assert.strictEqual(rowCount(), 20);

  // The bench now returns only one report's worth (a truncated response).
  const { result } = await syncWith(benchBatch(4, { perReport: 4 }), { fullResync: true });

  assert.strictEqual(rowCount(), 20, 'nothing removed without confirmation');
  assert.strictEqual(result.pruneSkipped.reason, 'large_prune');
  assert.strictEqual(result.pruneSkipped.wouldDeleteRows, 16);
  assert.strictEqual(result.pruneSkipped.storedRows, 20);
  assert.ok(result.pruneSkipped.sharePct > 50);
});

test('the held-back prune is applied once confirmed', async () => {
  resetInjectorData();
  await syncWith(benchBatch(20, { perReport: 4 }));

  const { result } = await syncWith(benchBatch(4, { perReport: 4 }), {
    fullResync: true,
    allowLargePrune: true,
  });

  assert.strictEqual(result.pruneSkipped, null);
  assert.strictEqual(result.reportsDeleted, 16);
  assert.strictEqual(rowCount(), 4);
});

test('a small prune still happens automatically', async () => {
  resetInjectorData();
  await syncWith(benchBatch(20, { perReport: 4 }));

  // 16 of 20 still present → a 20% prune, well under the safety limit.
  const { result } = await syncWith(benchBatch(16, { perReport: 4 }), { fullResync: true });

  assert.strictEqual(result.pruneSkipped, null);
  assert.strictEqual(result.reportsDeleted, 4);
  assert.strictEqual(rowCount(), 16);
});

// ── Job-number routing configuration ─────────────────────────────────────────
test('the job-number prefix is configurable', async () => {
  resetInjectorData();
  process.env.CARBONZAPP_JOB_PREFIX = 'WO';
  try {
    const { result } = await syncWith(benchBatch(3, { job: 'WO-4455' }));
    assert.strictEqual(result.imported, 3, 'reports matching the configured prefix are imported');
    assert.strictEqual(result.jobPrefix, 'WO');
  } finally {
    delete process.env.CARBONZAPP_JOB_PREFIX;
  }
});

test('routing can be switched off to import every job number', async () => {
  resetInjectorData();
  process.env.CARBONZAPP_JOB_PREFIX = 'none';
  try {
    const { result } = await syncWith([
      ...benchBatch(2, { job: 'RMA-1', prefix: 'R' }),
      ...benchBatch(2, { job: '', prefix: 'N' }),
    ]);
    assert.strictEqual(result.imported, 4, 'everything is imported when routing is disabled');
    assert.strictEqual(result.excludedByRouting, 0);
    assert.strictEqual(result.jobPrefix, null);
  } finally {
    delete process.env.CARBONZAPP_JOB_PREFIX;
  }
});

test('a normal sync is unaffected by the safety rules', async () => {
  resetInjectorData();
  const { result } = await syncWith(benchBatch(5));

  assert.strictEqual(result.imported, 5);
  assert.strictEqual(result.pruneSkipped, null);
  assert.strictEqual(result.storedRows, 5);
  assert.strictEqual(rowCount(), 5);
});
