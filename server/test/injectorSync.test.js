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
const { benchReport, benchBatch } = require('./helpers/benchData');
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

/**
 * A bench that answers ONE request with at most `pageSize` reports, oldest
 * first, filtered inclusively by date_from — the behaviour observed in
 * production, where a single request only ever showed the oldest slice.
 */
function pagedBench(allReports, pageSize) {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const from = body.date_from ? new Date(body.date_from) : null;
    const page = allReports
      .filter((r) => !from || new Date(r.datetime) >= from)
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      .slice(0, pageSize);
    return { ok: true, status: 200, text: async () => JSON.stringify(page) };
  };
  return { requests, restore: () => { global.fetch = originalFetch; } };
}

/** `count` reports on consecutive days; `jobFor(i)` decides the job number. */
function benchHistory(count, jobFor) {
  return Array.from({ length: count }, (_, i) => benchReport({
    id: `hist-${i}`,
    slot: 0,
    serial: `H${String(i).padStart(3, '0')}`,
    job: jobFor(i),
    datetime: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
  }));
}

const rowCount = () => db.get('SELECT COUNT(*) AS c FROM injector_test_reports', []).c;

test('a full resync asks the bench for a wide date range, not for nothing', async () => {
  resetInjectorData();
  const { requests } = await syncWith(benchBatch(2), { fullResync: true });

  assert.ok(requests.length >= 1);
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

// ── Paging: one request only returns a slice of the bench's history ──────────
test('a sync pages through a bench that answers with a capped list', async () => {
  resetInjectorData();
  // 300 reports: the oldest 200 belong to other systems, the newest 100 are
  // ours. A single 39-report page would show only the old, non-matching ones.
  const history = benchHistory(300, (i) => (i < 200 ? `BTD-${i}` : `qms ${700 + i}-1`));
  const bench = pagedBench(history, 39);
  try {
    const result = await carbonzapp.syncNow({ apiKey: 'k', fullResync: true });

    assert.ok(bench.requests.length > 1, 'the bench was asked for more than one page');
    assert.strictEqual(result.fetchedTotal, 300, 'the whole history was read');
    assert.strictEqual(result.imported, 100, 'every matching report was imported');
    assert.strictEqual(result.excludedByRouting, 200);
    assert.strictEqual(result.fetchTruncated, false);
    assert.strictEqual(rowCount(), 100);
  } finally {
    bench.restore();
  }
});

test('paging stops as soon as the bench repeats itself', async () => {
  resetInjectorData();
  const history = benchHistory(10, () => 'QMS-1');
  const bench = pagedBench(history, 39); // one page holds everything
  try {
    await carbonzapp.syncNow({ apiKey: 'k', fullResync: true });
    // One request for the data, one that returns only the repeated last report.
    assert.ok(bench.requests.length <= 2, `expected at most 2 requests, got ${bench.requests.length}`);
    assert.strictEqual(rowCount(), 10);
  } finally {
    bench.restore();
  }
});

test('a fetch cut short by the page budget never prunes', async () => {
  resetInjectorData();
  const history = benchHistory(300, () => 'QMS-1');
  const firstPass = pagedBench(history, 39);
  try {
    await carbonzapp.syncNow({ apiKey: 'k', fullResync: true });
  } finally {
    firstPass.restore();
  }
  assert.strictEqual(rowCount(), 300);

  // Now the bench only lets us read the first page before we run out of budget.
  process.env.CARBONZAPP_MAX_PAGES = '1';
  const limited = pagedBench(history, 39);
  try {
    const result = await carbonzapp.syncNow({ apiKey: 'k', fullResync: true });

    assert.strictEqual(result.fetchTruncated, true, 'the incomplete read is reported');
    assert.strictEqual(result.pruneSkipped.reason, 'incomplete_fetch');
    assert.strictEqual(result.reportsDeleted, 0);
    assert.strictEqual(rowCount(), 300, 'a partial view must never delete records');
  } finally {
    limited.restore();
    delete process.env.CARBONZAPP_MAX_PAGES;
  }
});

test('the sync reports which span of bench history it read', async () => {
  resetInjectorData();
  const history = benchHistory(120, () => 'QMS-9');
  const bench = pagedBench(history, 39);
  try {
    const result = await carbonzapp.syncNow({ apiKey: 'k', fullResync: true });

    assert.ok(result.pagesFetched > 1);
    assert.strictEqual(result.dateRange.from.slice(0, 10), '2025-01-01');
    assert.strictEqual(result.dateRange.to.slice(0, 10), history[119].datetime.slice(0, 10));
  } finally {
    bench.restore();
  }
});

test('Test Connection reports what the API key can see', async () => {
  const history = benchHistory(80, (i) => (i < 60 ? `RMA-${i}` : `qms ${i}`));
  const bench = pagedBench(history, 39);
  try {
    const result = await carbonzapp.testConnection({ apiKey: 'k' });

    assert.strictEqual(result.count, 80);
    assert.ok(result.pages > 1);
    assert.strictEqual(result.matchingCount, 20, 'how many pass the Job # filter');
    assert.strictEqual(result.jobPrefix, 'QMS');
    assert.ok(result.newestJobNumbers[0].startsWith('qms'), 'newest job numbers first');
    assert.strictEqual(result.dateRange.from.slice(0, 10), '2025-01-01');
  } finally {
    bench.restore();
  }
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
