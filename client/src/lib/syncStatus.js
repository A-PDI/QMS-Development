/**
 * Human-readable outcome of a test-bench synchronisation.
 *
 * The sync API returns counters plus diagnostics (what the bench sent, what the
 * job-number routing excluded, whether a destructive prune was held back). This
 * turns them into one banner message so the page never has to leave the user
 * guessing why a sync imported nothing.
 *
 * Pure function — unit-tested in test/syncStatus.test.js.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Format the excluded job numbers for the message, capped for readability. */
function excludedJobList(res) {
  const jobs = Array.isArray(res.excludedJobNumbers) ? res.excludedJobNumbers : []
  if (!jobs.length) return ''
  const shown = jobs.slice(0, 5).join(', ')
  return jobs.length > 5 ? `${shown}, …` : shown
}

/**
 * @returns {{ type: 'success'|'info'|'warning', text: string, toast: string }}
 */
export function describeSyncResult(res = {}, { fullResync = false } = {}) {
  const imported = res.imported || 0
  const updated = res.updated || 0
  const fetched = res.fetched || 0
  const fetchedTotal = res.fetchedTotal ?? fetched
  const excluded = res.excludedByRouting || 0
  const stored = res.storedRows
  const prefix = res.jobPrefix
  const skipped = res.pruneSkipped

  // ── A destructive prune was held back ────────────────────────────────────
  if (skipped?.reason === 'empty_fetch') {
    const why = fetchedTotal > 0
      ? `The bench returned ${plural(fetchedTotal, 'report')}, but ${excluded === fetchedTotal ? 'every one of them was' : `${excluded} were`} excluded because the Job # doesn't start with "${prefix}"${excludedJobList(res) ? ` (${excludedJobList(res)})` : ''}.`
      : 'The bench returned no reports at all — check the API key, the bench connection, and that reports exist for the requested date range.'
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

  // ── Nothing came back that belongs to this app ───────────────────────────
  if (fetched === 0 && excluded > 0) {
    return {
      type: 'warning',
      text: `The bench returned ${plural(fetchedTotal, 'report')}, but none were imported: their Job # doesn't start with "${prefix}"`
        + `${excludedJobList(res) ? ` (${excludedJobList(res)})` : ''}. `
        + 'Fix the Job # on the bench, or set CARBONZAPP_JOB_PREFIX on the server to match your numbering.',
      toast: 'Nothing imported — job numbers did not match',
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
  const parts = [`Synced ${plural(fetched, 'report')}: ${imported} new, ${updated} updated.`]
  if (excluded) {
    parts.push(`${excluded} excluded — Job # doesn't start with "${prefix}"${excludedJobList(res) ? ` (${excludedJobList(res)})` : ''}.`)
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
