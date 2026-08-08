/**
 * Sync outcome messages explain fixed exclusions and destructive-prune guards.
 */

import test from 'node:test'
import assert from 'node:assert'

import { describeConnectionResult, describeExclusions, describeSyncResult } from '../src/lib/syncStatus.js'

test('a normal sync reports imports, exclusions and available rows', () => {
  const out = describeSyncResult({
    fetched: 12, fetchedTotal: 15, imported: 8, updated: 4, storedRows: 20,
    exclusions: { excludedCount: 3, serialStartsWithR: 2, jobContainsRma: 1, both: 0 },
  })
  assert.strictEqual(out.type, 'success')
  assert.match(out.text, /Synced 12 reports: 8 new, 4 updated/)
  assert.match(out.text, /3 reports excluded/)
  assert.match(out.text, /serial numbers beginning with R/)
  assert.match(out.text, /Job # containing RMA/)
  assert.match(out.text, /20 injector records available/)
  assert.match(out.text, /No inspection reports were created/)
})

test('exclusion summaries count overlap only once', () => {
  const text = describeExclusions({ excludedCount: 3, serialStartsWithR: 2, jobContainsRma: 2, both: 1 })
  assert.match(text, /^3 reports excluded/)
  assert.match(text, /1 matched both rules/)
})

test('connection results state how many reports are eligible', () => {
  const out = describeConnectionResult({
    count: 10,
    eligibleCount: 7,
    exclusions: { excludedCount: 3, serialStartsWithR: 1, jobContainsRma: 2, both: 0 },
    pages: 2,
    dateRange: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
  })
  assert.strictEqual(out.type, 'success')
  assert.match(out.text, /7 reports eligible for import/)
  assert.match(out.text, /2 pages/)
})

test('connection warns when every returned report is excluded', () => {
  const out = describeConnectionResult({
    count: 2,
    eligibleCount: 0,
    exclusions: { excludedCount: 2, serialStartsWithR: 1, jobContainsRma: 1, both: 0 },
  })
  assert.strictEqual(out.type, 'warning')
})

test('an empty full resync says nothing was deleted and why', () => {
  const out = describeSyncResult({
    fetched: 0, fetchedTotal: 0, imported: 0, updated: 0, storedRows: 30,
    pruneSkipped: { reason: 'empty_fetch', wouldDeleteRows: 30, storedRows: 30 },
  }, { fullResync: true })
  assert.strictEqual(out.type, 'warning')
  assert.match(out.text, /left untouched/i)
  assert.match(out.text, /nothing was deleted/i)
  assert.match(out.text, /no reports at all/i)
})

test('the message says which span of bench history was read', () => {
  const out = describeSyncResult({
    fetched: 2, fetchedTotal: 2, imported: 2, updated: 0, storedRows: 2,
    pagesFetched: 1, dateRange: { from: '2024-03-02T10:00:00Z', to: '2025-05-14T08:00:00Z' },
  })
  assert.match(out.text, /covering 2024-03-02 → 2025-05-14/)
})

test('a partial read is reported as partial, with nothing deleted', () => {
  const out = describeSyncResult({
    fetched: 39, fetchedTotal: 39, imported: 39, updated: 0, storedRows: 300,
    pagesFetched: 1, fetchTruncated: true,
    dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-02-08T00:00:00Z' },
    pruneSkipped: { reason: 'incomplete_fetch', wouldDeleteRows: 261, storedRows: 300 },
  }, { fullResync: true })
  assert.strictEqual(out.type, 'warning')
  assert.match(out.text, /only saw part of it/i)
  assert.match(out.text, /261 records were left in place/)
  assert.match(out.text, /CARBONZAPP_MAX_PAGES/)
})

test('multi-page coverage is shown on a successful sync', () => {
  const out = describeSyncResult({
    fetched: 100, fetchedTotal: 100, imported: 100, updated: 0, storedRows: 100,
    pagesFetched: 9, dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-10-27T00:00:00Z' },
  }, { fullResync: true })
  assert.strictEqual(out.type, 'success')
  assert.match(out.text, /9 pages/)
})

test('an ordinary sync explains when all returned reports were excluded', () => {
  const out = describeSyncResult({
    fetched: 0, fetchedTotal: 4, imported: 0, updated: 0,
    exclusions: { excludedCount: 4, serialStartsWithR: 2, jobContainsRma: 3, both: 1 },
  })
  assert.strictEqual(out.type, 'warning')
  assert.match(out.text, /none were imported/i)
  assert.match(out.text, /beginning with R/)
  assert.match(out.text, /containing RMA/)
})

test('a held-back prune explains the safety limit', () => {
  const out = describeSyncResult({
    fetched: 4, fetchedTotal: 4, imported: 0, updated: 4, storedRows: 20,
    pruneSkipped: { reason: 'large_prune', wouldDeleteRows: 16, storedRows: 20, sharePct: 80, limitPct: 50 },
  }, { fullResync: true })
  assert.strictEqual(out.type, 'warning')
  assert.match(out.text, /16 records/)
  assert.match(out.text, /80%/)
  assert.match(out.text, /NOT removed/)
})

test('completed cleanup and newly excluded stored rows are reported', () => {
  const out = describeSyncResult({
    fetched: 16, fetchedTotal: 16, imported: 0, updated: 16, storedRows: 16,
    excludedRowsRemoved: 2, reportsDeleted: 4, inspectionsDeleted: 1, inspectionsKept: 2,
  }, { fullResync: true })
  assert.strictEqual(out.type, 'success')
  assert.match(out.text, /Removed 2 previously imported records/)
  assert.match(out.text, /Removed 4 records no longer on the bench/)
  assert.match(out.text, /deleted 1 generated inspection/)
  assert.match(out.text, /kept 2 completed inspections/)
})

test('an ordinary sync with no new data is informational', () => {
  const out = describeSyncResult({ fetched: 0, fetchedTotal: 0, imported: 0, updated: 0, storedRows: 12 })
  assert.strictEqual(out.type, 'info')
  assert.match(out.text, /no new reports since the last sync/i)
})

test('a full resync with no data says no local records changed', () => {
  const out = describeSyncResult({ fetched: 0, fetchedTotal: 0, imported: 0, updated: 0, storedRows: 0 }, { fullResync: true })
  assert.strictEqual(out.type, 'info')
  assert.match(out.text, /no local records were changed/i)
})
