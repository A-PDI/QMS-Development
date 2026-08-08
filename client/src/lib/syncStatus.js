/**
 * Human-readable outcome of a test-bench synchronisation.
 *
 * The sync API returns counters plus diagnostics (what the bench sent, what the
 * import rules excluded, whether a destructive prune was held back). This
 * turns them into one banner message so the page never has to leave the user
 * guessing why a sync imported nothing.
 *
 * Pure function — unit-tested in test/syncStatus.test.js.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Human-readable counts for the two fixed import exclusions. */
export function describeExclusions(exclusions = {}) {
  const count = Number(exclusions.excludedCount) || 0
  if (!count) return ''
  const reasons = []
  if (exclusions.serialStartsWithR) {
    reasons.push(`${plural(exclusions.serialStartsWithR, 'serial number')} beginning with R`)
  }
  if (exclusions.jobContainsRma) {
    reasons.push(`${plural(exclusions.jobContainsRma, 'Job #')} containing RMA`)
  }
  const overlap = exclusions.both ? `; ${exclusions.both} matched both rules` : ''
  return `${plural(count, 'report')} excluded by the import rules${reasons.length ? ` (${reasons.join('; ')}${overlap})` : ''}`
}

/**
 * The span of bench history this sync actually read. Showing it is what makes a
 * partial view obvious — "covering 2024-03 → 2025-05" against a bench full of
 * 2026 tests says the fetch never reached the recent reports.
 */
function coverage(res) {
  const from = res.dateRange?.from
  const to = res.dateRange?.to
  if (!from || !to) return ''
  const day = (v) => String(v).slice(0, 10)
  const span = day(from) === day(to) ? day(from) : `${day(from)} → ${day(to)}`
  const pageCount = res.pagesFetched ?? res.pages
  const pages = pageCount > 1 ? `, ${pageCount} pages` : ''
  return ` (covering ${span}${pages})`
}

/** Connection-test message using the same exclusion vocabulary as sync. */
export function describeConnectionResult(res = {}) {
  const excludedText = describeExclusions(res.exclusions)
  const eligible = res.eligibleCount ?? Math.max(0, (res.count || 0) - (res.exclusions?.excludedCount || 0))
  const truncated = res.truncated
    ? ' The bench has more history than one read can cover — raise CARBONZAPP_MAX_PAGES if reports are missing.'
    : ''
  return {
    type: res.count > 0 && eligible === 0 ? 'warning' : 'success',
    text: `Connection OK — the bench returned ${plural(res.count || 0, 'report')}${coverage(res)}. `
      + `${plural(eligible, 'report')} eligible for import${excludedText ? `; ${excludedText}` : ''}.${truncated}`,
  }
}

/**
 * @returns {{ type: 'success'|'info'|'warning', text: string, toast: string }}
 */
export function describeSyncResult(res = {}, { fullResync = false } = {}) {
  const imported = res.imported || 0
  const updated = res.updated || 0
  const fetched = res.fetched || 0
  const fetchedTotal = res.fetchedTotal ?? fetched
  const excluded = res.exclusions?.excludedCount || 0
  const stored = res.storedRows
  const skipped = res.pruneSkipped

  // ── A destructive prune was held back ────────────────────────────────────
  if (skipped?.reason === 'incomplete_fetch') {
    return {
      type: 'warning',
      text: `The bench's history was too large to read in one go, so this resync only saw part of it${coverage(res)} `
        + `— ${plural(skipped.wouldDeleteRows, 'record')} were left in place rather than deleted. `
        + `Imported ${imported} new and updated ${updated} record(s). Run the resync again to continue, `
        + 'or raise CARBONZAPP_MAX_PAGES on the server.',
      toast: 'Partial resync — nothing was deleted',
    }
  }

  if (skipped?.reason === 'empty_fetch') {
    const why = 'The bench returned no reports at all — check the API key, the bench connection, and that reports exist for the requested date range.'
    return {
      type: 'warning',
      text: `Full resync imported nothing, so your existing ${plural(skipped.wouldDeleteRows, 'record')} were left untouched (nothing was deleted). ${why}`,
      toast: 'Full resync imported nothing — existing records kept',
    }
  }

  if (skipped?.reason === 'large_prune') {
    return {
      type: 'warning',
      text: `Imported ${imported} new and updated ${updated} record(s). The bench no longer lists ${plural(skipped.wouldDeleteRows, 'record')} of your ${skipped.storedRows} `
        + `(${Math.round(skipped.sharePct)}%) — more than the ${skipped.limitPct}% safety limit — so they were NOT removed. `
        + 'Confirm below if the bench really did drop them.',
      toast: 'Sync complete — a large deletion was held back',
    }
  }

  // ── Everything returned was excluded by one of the fixed rules ──────────
  if (fetched === 0 && excluded > 0) {
    return {
      type: 'warning',
      text: `The bench returned ${plural(fetchedTotal, 'report')}${coverage(res)}, but none were imported: ${describeExclusions(res.exclusions)}.`,
      toast: 'Nothing imported — all reports matched an exclusion rule',
    }
  }

  if (fetchedTotal === 0) {
    return {
      type: 'info',
      text: fullResync
        ? 'Full resync succeeded, but the bench returned no reports. Check the API key and the bench connection — no local records were changed.'
        : 'Sync succeeded, but the bench has no new reports since the last sync.',
      toast: 'No new reports from the test bench',
    }
  }

  // ── Normal outcome ───────────────────────────────────────────────────────
  const parts = [`Synced ${plural(fetched, 'report')}${coverage(res)}: ${imported} new, ${updated} updated.`]
  if (excluded) {
    parts.push(`${describeExclusions(res.exclusions)}.`)
  }
  if (res.excludedRowsRemoved) {
    parts.push(`Removed ${plural(res.excludedRowsRemoved, 'previously imported record')} that now matches an exclusion rule.`)
  }
  const delReports = res.reportsDeleted || 0
  const delInsp = res.inspectionsDeleted || 0
  const keptInsp = res.inspectionsKept || 0
  if (delReports || delInsp || keptInsp) {
    parts.push(`Removed ${plural(delReports, 'record')} no longer on the bench`
      + (delInsp ? `, deleted ${plural(delInsp, 'generated inspection')}` : '')
      + (keptInsp ? `; kept ${plural(keptInsp, 'completed inspection')}` : '') + '.')
  }
  if (typeof stored === 'number') parts.push(`${plural(stored, 'injector record')} available.`)
  parts.push('No inspection reports were created — select injectors below and generate reports.')

  return {
    type: 'success',
    text: parts.join(' '),
    toast: `Synced ${imported} new / ${updated} updated test record(s)`,
  }
}
