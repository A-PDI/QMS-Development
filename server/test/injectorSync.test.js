'use strict';
/**
 * Synchronisation import rules, paging and destructive-prune safety.
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

/** Simulate the bench's capped, oldest-first, inclusive date_from response. */
function pagedBench(allReports, pageSize) {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const from = body.date_from ? new Date(body.date_from) : null;
    const page = allReports
      .filter((report) => !from || new Date(report.datetime) >= from)
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      .slice(0, pageSize);
    return { ok: true, status: 200, text: async () => JSON.stringify(page) };
  };
  return { requests, restore: () => { global.fetch = originalFetch; } };
}

function benchHistory(count, jobFor = () => 'Production') {
  return Array.from({ length: count }, (_, i) => benchReport({
    id: `hist-${i}`,
    slot: 0,
    serial: `H${String(i).padStart(3, '0')}`,
    job: jobFor(i),
    datetime: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
  }));
}

const rowCount = () => db.get('SELECT COUNT(*) AS c FROM injector_test_reports', []).c;

test('a full resync asks the bench for a wide date range', async () => {
  resetInjectorData();
  const { requests } = await syncWith(benchBatch(2), { fullResync: true });
  assert.ok(requests.length >= 1);
  assert.ok(requests[0].date_from);
  assert.ok(new Date(requests[0].date_from).getFullYear() <= 2000);
});

test('an incremental sync still filters from the last sync', async () => {
  resetInjectorData();
  await syncWith(benchBatch(2));
  const { requests } = await syncWith(benchBatch(2));
  assert.ok(requests[0].date_from);
  assert.ok(new Date(requests[0].date_from).getFullYear() >= 2020);
});

// ── Paging ──────────────────────────────────────────────────────────────────
test('a sync pages through the full bench history and imports arbitrary jobs', async () => {
  resetInjectorData();
  const history = benchHistory(300, (i) => (i < 200 ? `BTD-${i}` : `Production ${i}`));
  const bench = pagedBench(history, 39);
  try {
    const result = await carbonzapp.syncNow({ apiKey: 'k', fullResync: true });
    assert.ok(bench.requests.length > 1);
    assert.strictEqual(result.fetchedTotal, 300);
    assert.strictEqual(result.imported, 300);
    assert.deepStrictEqual(result.exclusions, { excludedCount: 0, serialStartsWithR: 0, jobContainsRma: 0, both: 0 });
    assert.strictEqual(result.fetchTruncated, false);
    assert.strictEqual(rowCount(), 300);
  } finally {
    bench.restore();
  }
});

test('paging stops as soon as the bench repeats itself', async () => {
  resetInjectorData();
  const bench = pagedBench(benchHistory(10), 39);
  try {
    await carbonzapp.syncNow({ apiKey: 'k', fullResync: true });
    assert.ok(bench.requests.length <= 2, `expected at most 2 requests, got ${bench.requests.length}`);
    assert.strictEqual(rowCount(), 10);
  } finally {
    bench.restore();
  }
});

test('a fetch cut short by the page budget never prunes', async () => {
  resetInjectorData();
  const history = benchHistory(300);
  const firstPass = pagedBench(history, 39);
  try {
    await carbonzapp.syncNow({ apiKey: 'k', fullResync: true });
  } finally {
    firstPass.restore();
  }
  assert.strictEqual(rowCount(), 300);

  process.env.CARBONZAPP_MAX_PAGES = '1';
  const limited = pagedBench(history, 39);
  try {
    const result = await carbonzapp.syncNow({ apiKey: 'k', fullResync: true });
    assert.strictEqual(result.fetchTruncated, true);
    assert.strictEqual(result.pruneSkipped.reason, 'incomplete_fetch');
    assert.strictEqual(result.reportsDeleted, 0);
    assert.strictEqual(rowCount(), 300);
  } finally {
    limited.restore();
    delete process.env.CARBONZAPP_MAX_PAGES;
  }
});

test('the sync reports which span of bench history it read', async () => {
  resetInjectorData();
  const history = benchHistory(120);
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

test('Test Connection reports eligible and excluded counts without importing', async () => {
  const history = benchHistory(80, (i) => (i < 60 ? `wo-RmA-${i}` : `Production ${i}`));
  const bench = pagedBench(history, 39);
  try {
    const result = await carbonzapp.testConnection({ apiKey: 'k' });
    assert.strictEqual(result.count, 80);
    assert.ok(result.pages > 1);
    assert.strictEqual(result.eligibleCount, 20);
    assert.deepStrictEqual(result.exclusions, { excludedCount: 60, serialStartsWithR: 0, jobContainsRma: 60, both: 0 });
    assert.strictEqual(result.dateRange.from.slice(0, 10), '2025-01-01');
  } finally {
    bench.restore();
  }
});

// ── Fixed import exclusions ─────────────────────────────────────────────────
test('serial numbers beginning with R are excluded case-insensitively', async () => {
  resetInjectorData();
  const { result } = await syncWith([
    benchReport({ id: 'serial-r-1', serial: 'R123', job: 'Production' }),
    benchReport({ id: 'serial-r-2', serial: 'r456', job: 'Production' }),
    benchReport({ id: 'serial-s-1', serial: 'SR789', job: 'Production' }),
  ]);
  assert.strictEqual(result.fetchedTotal, 3);
  assert.strictEqual(result.fetched, 1);
  assert.strictEqual(result.exclusions.serialStartsWithR, 2);
  assert.strictEqual(rowCount(), 1);
});

test('job values containing RMA are excluded case-insensitively', async () => {
  resetInjectorData();
  const { result } = await syncWith([
    benchReport({ id: 'rma-1', serial: 'S1', job: 'WO-rMa-123' }),
    benchReport({ id: 'rma-2', serial: 'S2', job: 'PRE-RMATEST-POST' }),
    benchReport({ id: 'prod-1', serial: 'S3', job: 'Production' }),
  ]);
  assert.strictEqual(result.fetched, 1);
  assert.strictEqual(result.exclusions.jobContainsRma, 2);
  assert.strictEqual(rowCount(), 1);
});

test('a report matching both exclusions is counted once', () => {
  const reports = [benchReport({ serial: 'R100', job: 'RMA-42' })];
  assert.deepStrictEqual(carbonzapp.summariseExclusions(reports), {
    excludedCount: 1, serialStartsWithR: 1, jobContainsRma: 1, both: 1,
  });
});

test('eligible reports from any job are imported but job number is not stored', async () => {
  resetInjectorData();
  const { result } = await syncWith([
    benchReport({ id: 'any-1', serial: 'S1', job: 'BTD-724' }),
    benchReport({ id: 'any-2', serial: 'S2', job: '' }),
    benchReport({ id: 'any-3', serial: 'S3', job: 'Master' }),
  ]);
  assert.strictEqual(result.imported, 3);
  const rows = db.all('SELECT job_number, report_json FROM injector_test_reports ORDER BY report_ext_id', []);
  assert.ok(rows.every((row) => row.job_number == null));
  assert.ok(rows.every((row) => !Object.hasOwn(JSON.parse(row.report_json), 'job_number')));
});

test('a previously imported row is removed if that exact result becomes excluded', async () => {
  resetInjectorData();
  await syncWith([benchReport({ id: 'changing-1', slot: 0, serial: 'S100', job: 'Production' })]);
  assert.strictEqual(rowCount(), 1);

  const { result } = await syncWith([benchReport({ id: 'changing-1', slot: 0, serial: 'R100', job: 'Production' })]);
  assert.strictEqual(result.excludedRowsRemoved, 1);
  assert.strictEqual(rowCount(), 0);
});

// ── Destructive-prune guards ────────────────────────────────────────────────
test('a full resync that returns nothing keeps every existing record', async () => {
  resetInjectorData();
  await syncWith(benchBatch(10));
  const { result } = await syncWith([], { fullResync: true });
  assert.strictEqual(rowCount(), 10);
  assert.strictEqual(result.reportsDeleted, 0);
  assert.strictEqual(result.pruneSkipped.reason, 'empty_fetch');
  assert.strictEqual(result.pruneSkipped.wouldDeleteRows, 10);
});

test('an empty full resync does not advance the incremental sync marker', async () => {
  resetInjectorData();
  await syncWith(benchBatch(4));
  const marker = carbonzapp.getSetting('carbonzapp_last_sync');
  await syncWith([], { fullResync: true });
  assert.strictEqual(carbonzapp.getSetting('carbonzapp_last_sync'), marker);
});

test('a full resync holds back a prune that would remove most of the data', async () => {
  resetInjectorData();
  await syncWith(benchBatch(20, { perReport: 4 }));
  const { result } = await syncWith(benchBatch(4, { perReport: 4 }), { fullResync: true });
  assert.strictEqual(rowCount(), 20);
  assert.strictEqual(result.pruneSkipped.reason, 'large_prune');
  assert.strictEqual(result.pruneSkipped.wouldDeleteRows, 16);
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
  const { result } = await syncWith(benchBatch(16, { perReport: 4 }), { fullResync: true });
  assert.strictEqual(result.pruneSkipped, null);
  assert.strictEqual(result.reportsDeleted, 4);
  assert.strictEqual(rowCount(), 16);
});

test('a normal sync is unaffected by the safety rules', async () => {
  resetInjectorData();
  const { result } = await syncWith(benchBatch(5));
  assert.strictEqual(result.imported, 5);
  assert.strictEqual(result.pruneSkipped, null);
  assert.strictEqual(result.storedRows, 5);
  assert.strictEqual(rowCount(), 5);
});
