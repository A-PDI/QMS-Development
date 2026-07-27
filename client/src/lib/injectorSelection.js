/**
 * Selection, grouping and validation helpers for the Injector Tests page.
 *
 * Pure functions with no React/DOM dependencies so the selection rules can be
 * unit-tested and reused (the page only wires them to state).
 *
 * Selection is ORDER-AWARE: `selectedIds` is an array whose order defines the
 * injector column order (1, 2, 3 …) in every generated report.
 */

export const NO_JOB_KEY = '__no_job__'
export const NO_JOB_LABEL = 'No job number'

/** Grouping key for an injector's job number ('' → the "no job" bucket). */
export function jobKeyOf(injector) {
  const job = String(injector?.job_number ?? '').trim()
  return job || NO_JOB_KEY
}

/** Human label for a job key. */
export function jobLabel(key) {
  return key === NO_JOB_KEY ? NO_JOB_LABEL : key
}

/**
 * Group injectors by job number, keeping record order inside each group and
 * ordering the groups by their most recent test date (newest first). Similar
 * job numbers therefore sit together in the list.
 */
export function groupByJobNumber(injectors = []) {
  const groups = new Map()
  for (const inj of injectors) {
    const key = jobKeyOf(inj)
    if (!groups.has(key)) groups.set(key, { key, label: jobLabel(key), injectors: [], latest: '' })
    const g = groups.get(key)
    g.injectors.push(inj)
    const dt = String(inj?.test_datetime ?? '')
    if (dt > g.latest) g.latest = dt
  }
  return [...groups.values()].sort((a, b) => {
    if (a.latest !== b.latest) return a.latest < b.latest ? 1 : -1
    return a.label.localeCompare(b.label)
  })
}

/** Distinct job numbers present in the list, newest batch first. */
export function jobNumberOptions(injectors = []) {
  return groupByJobNumber(injectors).map((g) => ({ key: g.key, label: g.label, count: g.injectors.length }))
}

/** Free-text + job-number filtering, mirroring what the user sees. */
export function filterInjectors(injectors = [], { search = '', jobNumber = '' } = {}) {
  const term = String(search ?? '').trim().toLowerCase()
  return injectors.filter((i) => {
    if (jobNumber && jobKeyOf(i) !== jobNumber) return false
    if (!term) return true
    return [i.part_number, i.serial_number, i.job_number]
      .some((v) => String(v ?? '').toLowerCase().includes(term))
  })
}

/** Toggle one injector, appending to the end so pick order is preserved. */
export function toggleSelected(selectedIds = [], id) {
  return selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
}

/** Add every given injector that isn't selected yet (keeps existing order). */
export function addToSelection(selectedIds = [], injectors = []) {
  const have = new Set(selectedIds)
  return [...selectedIds, ...injectors.map((i) => i.id).filter((id) => !have.has(id))]
}

/** Remove every given injector from the selection. */
export function removeFromSelection(selectedIds = [], injectors = []) {
  const drop = new Set(injectors.map((i) => i.id))
  return selectedIds.filter((id) => !drop.has(id))
}

/** True when every one of `injectors` is currently selected. */
export function areAllSelected(selectedIds = [], injectors = []) {
  if (injectors.length === 0) return false
  const have = new Set(selectedIds)
  return injectors.every((i) => have.has(i.id))
}

/** "Select all visible" / "Deselect all visible" in one call. */
export function toggleAll(selectedIds = [], injectors = []) {
  return areAllSelected(selectedIds, injectors)
    ? removeFromSelection(selectedIds, injectors)
    : addToSelection(selectedIds, injectors)
}

/** Select (or clear) every injector belonging to one job number. */
export function toggleJobSelection(selectedIds = [], injectors = [], key) {
  const inJob = injectors.filter((i) => jobKeyOf(i) === key)
  return toggleAll(selectedIds, inJob)
}

/** The selected injector records, in selection order, limited to `available`. */
export function orderedSelection(selectedIds = [], available = []) {
  const byId = new Map(available.map((i) => [i.id, i]))
  return selectedIds.map((id) => byId.get(id)).filter(Boolean)
}

/** Move a selected injector up (-1) or down (+1) in the report column order. */
export function moveSelected(selectedIds = [], id, direction) {
  const idx = selectedIds.indexOf(id)
  if (idx < 0) return selectedIds
  const swap = idx + direction
  if (swap < 0 || swap >= selectedIds.length) return selectedIds
  const next = [...selectedIds]
  ;[next[idx], next[swap]] = [next[swap], next[idx]]
  return next
}

/** True when an injector row carries usable test-bench results. */
export function hasTestResults(injector) {
  return Number(injector?.steps_total ?? 0) > 0
}

/**
 * Check a selection before asking the server for a report. Mirrors the
 * server-side validation so problems are reported before any request is made.
 * Returns { ok, message, warnings }.
 */
export function validateSelectionForReport(selected = []) {
  if (!selected.length) {
    return { ok: false, message: 'Select at least one injector to generate a report.', warnings: [] }
  }

  const label = (i) => i.serial_number || i.part_number || 'unknown'
  const missingResults = selected.filter((i) => !hasTestResults(i))
  if (missingResults.length) {
    const names = missingResults.slice(0, 5).map(label).join(', ')
    const more = missingResults.length > 5 ? ` and ${missingResults.length - 5} more` : ''
    return {
      ok: false,
      message: `${missingResults.length} selected injector(s) have no test-bench results: ${names}${more}. Remove them from the selection or re-sync the test bench.`,
      warnings: [],
    }
  }

  const warnings = []
  const noSerial = selected.filter((i) => !i.serial_number).length
  const noPart = selected.filter((i) => !i.part_number).length
  const noJob = selected.filter((i) => !String(i.job_number ?? '').trim()).length
  if (noSerial) warnings.push(`${noSerial} selected injector(s) have no serial number.`)
  if (noPart) warnings.push(`${noPart} selected injector(s) have no part number.`)
  if (noJob) warnings.push(`${noJob} selected injector(s) have no job number.`)

  return { ok: true, message: '', warnings }
}

/** Short description of what is selected, e.g. "12 injectors · job QMS-724-3". */
export function describeSelection(selected = []) {
  const jobs = [...new Set(selected.map((i) => String(i.job_number ?? '').trim()).filter(Boolean))]
  const parts = [`${selected.length} injector${selected.length === 1 ? '' : 's'}`]
  if (jobs.length === 1) parts.push(`job ${jobs[0]}`)
  else if (jobs.length > 1) parts.push(`${jobs.length} job numbers`)
  return parts.join(' · ')
}

/** Suggested filename stem for a report over the given selection. */
export function suggestReportName(prefix, selected = []) {
  const part = selected.find((i) => i.part_number)?.part_number
  const job = selected.find((i) => String(i.job_number ?? '').trim())?.job_number
  return [prefix, part, job, `${selected.length}`]
    .filter(Boolean)
    .map((v) => String(v).trim().replace(/\s+/g, '-'))
    .join('_')
}
