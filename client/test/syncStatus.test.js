/**
 * Sync outcome messages — the banner has to explain WHY a sync imported
 * nothing, and must never imply data was deleted when it was not.
 */

import test from 'node:test'
import assert from 'node:assert'

import { describeSyncResult } from '../src/lib/syncStatus.js'

test('a normal sync reports what came in', () => {
  const out = describeSyncResult({
    fetched: 12, fetchedTotal: 12, imported: 8, updated: 4, storedRows: 20,
  })
  assert.strictEqual(out.type, 'success')
  assert.match(out.text, /Synced 12 reports: 8 new, 4 updated/)
  assert.match(out.text, /20 injector records available/)
  assert.match(out.text, /No inspection reports were created/)
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
  // The tell-tale of a partial read: recent tests exist on the bench, but the
  // sync only saw old ones.
  const out = describeSyncResult({
    fetched: 0, fetchedTotal: 39, imported: 0, updated: 0, storedRows: 0,
    excludedByRouting: 39, excludedJobNumbers: ['Master', 'BTD-1'], jobPrefix: 'QMS',
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
    fetched: 100, fetchedTotal: 300, imported: 100, updated: 0, storedRows: 100,
    pagesFetched: 9, dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-10-27T00:00:00Z' },
  }, { fullResync: true })

  assert.strictEqual(out.type, 'success')
  assert.match(out.text, /9 pages/)
})

test('an empty import caused by job routing names the job numbers', () => {
  const out = describeSyncResult({
    fetched: 0, fetchedTotal: 6, imported: 0, updated: 0, storedRows: 30,
    excludedByRouting: 6, excludedJobNumbers: ['RMA-9001', '(blank)'], jobPrefix: 'QMS',
    pruneSkipped: { reason: 'empty_fetch', wouldDeleteRows: 30, storedRows: 30 },
  }, { fullResync: true })

  assert.strictEqual(out.type, 'warning')
  assert.match(out.text, /RMA-9001/)
  assert.match(out.text, /\(blank\)/)
  assert.match(out.text, /"QMS"/)
  assert.match(out.text, /nothing was deleted/i)
})

test('a routing mismatch on an ordinary sync explains the fix', () => {
  const out = describeSyncResult({
    fetched: 0, fetchedTotal: 4, imported: 0, updated: 0,
    excludedByRouting: 4, excludedJobNumbers: ['724-3'], jobPrefix: 'QMS',
  })

  assert.strictEqual(out.type, 'warning')
  assert.match(out.text, /724-3/)
  assert.match(out.text, /CARBONZAPP_JOB_PREFIX/)
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

test('a completed prune is reported as part of the summary', () => {
  const out = describeSyncResult({
    fetched: 16, fetchedTotal: 16, imported: 0, updated: 16, storedRows: 16,
    reportsDeleted: 4, inspectionsDeleted: 1, inspectionsKept: 2,
  }, { fullResync: true })

  assert.strictEqual(out.type, 'success')
  assert.match(out.text, /Removed 4 records no longer on the bench/)
  assert.match(out.text, /deleted 1 generated inspection/)
  assert.match(out.text, /kept 2 completed inspections/)
})

test('an ordinary sync with no new data is informational, not alarming', () => {
  const out = describeSyncResult({ fetched: 0, fetchedTotal: 0, imported: 0, updated: 0, storedRows: 12 })
  assert.strictEqual(out.type, 'info')
  assert.match(out.text, /no new reports since the last sync/i)
})

test('a full resync with no data warns that nothing local changed', () => {
  const out = describeSyncResult({ fetched: 0, fetchedTotal: 0, imported: 0, updated: 0, storedRows: 0 },
    { fullResync: true })
  assert.strictEqual(out.type, 'info')
  assert.match(out.text, /no local records were changed/i)
})
