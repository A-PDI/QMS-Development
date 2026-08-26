/**
 * Selection, filtering and validation helpers for the Injector Tests page.
 *
 * Pure functions with no React/DOM dependencies so the selection rules can be
 * unit-tested and reused (the page only wires them to state).
 *
 * The active selection is always presented in natural ascending serial-number
 * order, regardless of the order in which injectors were added or removed.
 */

/** Newest test first, with stable identifiers breaking timestamp ties. */
export function sortByTestDate(injectors = []) {
  return [...injectors].sort((a, b) => {
    const timestamp = (value) => {
      const parsed = Date.parse(String(value ?? ''))
      return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
    }
    const dateOrder = timestamp(b?.test_datetime) - timestamp(a?.test_datetime)
    if (dateOrder) return dateOrder
    const partOrder = String(a?.part_number ?? '').localeCompare(String(b?.part_number ?? ''))
    if (partOrder) return partOrder
    return String(a?.serial_number ?? '').localeCompare(String(b?.serial_number ?? ''))
  })
}

function resultStatus(injector) {
  const stored = String(injector?.result_status ?? '').trim().toLowerCase()
  if (stored === 'pass' || stored === 'passed') return 'pass'
  if (stored === 'fail' || stored === 'failed') return 'fail'
  if (stored === 'dnf') return 'dnf'
  if (injector?.overall_pass === 1) return 'pass'
  if (injector?.overall_pass === 0) return 'fail'
  return 'unknown'
}

function testDate(value) {
  const raw = String(value ?? '').trim()
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoDate) return isoDate[1]
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10)
}

/**
 * Split a filter box into individual values. Commas, semicolons, pipes and any
 * whitespace separate entries, so a column of serial numbers pasted straight
 * from a spreadsheet filters as a list. Neither part numbers nor bench serial
 * numbers contain spaces.
 */
export function parseTokens(value) {
  const raw = Array.isArray(value) ? value : [value]
  const out = []
  const seen = new Set()
  for (const entry of raw) {
    if (entry == null) continue
    for (const token of String(entry).split(/[\s,;|]+/)) {
      const trimmed = token.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(trimmed)
    }
  }
  return out
}

/** True when any token appears in `value` (an empty token list matches all). */
function matchesAnyToken(value, tokens) {
  if (!tokens.length) return true
  const haystack = String(value ?? '').toLowerCase()
  return tokens.some((token) => haystack.includes(token.toLowerCase()))
}

/**
 * Independent Part Number, Serial Number, date-range and result filters.
 *
 * The part and serial boxes each accept SEVERAL values (see parseTokens) and a
 * record matches when ANY of them is contained in the field, so "all injectors
 * of part number(s) A, B" is one filter rather than three passes.
 *
 * TEST-STEP criteria are deliberately not evaluated here: individual steps are
 * not part of a list row, so the server resolves them (see buildInjectorQuery)
 * and returns rows that already satisfy them.
 */
export function filterInjectors(injectors = [], {
  partNumber = '',
  serialNumber = '',
  status = '',
  dateFrom = '',
  dateTo = '',
} = {}) {
  const parts = parseTokens(partNumber)
  const serials = parseTokens(serialNumber)
  const wantedStatus = String(status ?? '').trim().toLowerCase()
  const from = String(dateFrom ?? '').trim()
  const to = String(dateTo ?? '').trim()

  return sortByTestDate(injectors).filter((injector) => {
    if (!matchesAnyToken(injector?.part_number, parts)) return false
    if (!matchesAnyToken(injector?.serial_number, serials)) return false
    const date = testDate(injector?.test_datetime)
    if (from && (!date || date < from)) return false
    if (to && (!date || date > to)) return false
    const actualStatus = resultStatus(injector)
    if ((wantedStatus === 'pass' || wantedStatus === 'passed') && actualStatus !== 'pass') return false
    if ((wantedStatus === 'fail' || wantedStatus === 'failed') && actualStatus !== 'fail') return false
    if (wantedStatus === 'dnf' && actualStatus !== 'dnf') return false
    if ((wantedStatus === 'unscored' || wantedStatus === 'unknown') && actualStatus !== 'unknown') return false
    return true
  })
}

// ── Filter state ─────────────────────────────────────────────────────────────
// One object holds every filter on the page. Keeping it in one place is what
// lets the same value drive the visible list, the server query, the "what am I
// looking at" summary and the export request.

/** How a selected test step must have scored for a record to match. */
export const STEP_STATUS_OPTIONS = [
  { value: 'fail', label: 'Failed' },
  { value: 'pass', label: 'Passed' },
  { value: 'dnf', label: 'Did not finish' },
  { value: 'any', label: 'Was tested' },
]

/** The starting (unfiltered) state. */
export function emptyFilters() {
  return {
    partNumber: '',
    serialNumber: '',
    status: '',
    dateFrom: '',
    dateTo: '',
    steps: [],
    stepStatus: 'fail',
    stepMatch: 'any',
  }
}

/** Add/remove one test-step code from the step filter. */
export function toggleStepFilter(steps = [], code) {
  return steps.includes(code) ? steps.filter((c) => c !== code) : [...steps, code]
}

/** True when anything at all is filtered. */
export function hasActiveFilters(filters = {}) {
  return Boolean(
    parseTokens(filters.partNumber).length ||
    parseTokens(filters.serialNumber).length ||
    String(filters.status ?? '').trim() ||
    String(filters.dateFrom ?? '').trim() ||
    String(filters.dateTo ?? '').trim() ||
    (filters.steps || []).length
  )
}

/**
 * Filter state → query parameters for GET /api/injector-tests. Empty values
 * are omitted so the query key (and therefore the cache entry) only changes
 * when a real filter changes.
 */
export function buildInjectorQuery(filters = {}) {
  const query = {}
  const parts = parseTokens(filters.partNumber)
  const serials = parseTokens(filters.serialNumber)
  const steps = (filters.steps || []).filter(Boolean)

  if (parts.length) query.part_number = parts.join(',')
  if (serials.length) query.serial_number = serials.join(',')
  if (String(filters.status ?? '').trim()) query.status = String(filters.status).trim()
  if (String(filters.dateFrom ?? '').trim()) query.date_from = String(filters.dateFrom).trim()
  if (String(filters.dateTo ?? '').trim()) query.date_to = String(filters.dateTo).trim()
  if (steps.length) {
    query.steps = steps.join(',')
    query.step_status = filters.stepStatus || 'fail'
    query.step_match = filters.stepMatch || 'any'
  }
  return query
}

/**
 * The active filters as short readable phrases, for the summary line above the
 * list and for the export request. `stepLabels` maps a step code to its display
 * name; codes with no entry fall back to the raw code.
 */
export function describeActiveFilters(filters = {}, stepLabels = {}) {
  const out = []
  const parts = parseTokens(filters.partNumber)
  const serials = parseTokens(filters.serialNumber)
  const steps = (filters.steps || []).filter(Boolean)
  const statusLabel = { pass: 'Passed', fail: 'Failed', dnf: 'DNF', unscored: 'No result', unknown: 'No result' }

  if (parts.length) out.push(`Part ${parts.join(', ')}`)
  if (serials.length) out.push(`Serial ${serials.join(', ')}`)
  const status = String(filters.status ?? '').trim().toLowerCase()
  if (status) out.push(`Result ${statusLabel[status] || status}`)
  if (filters.dateFrom && filters.dateTo) {
    out.push(filters.dateFrom === filters.dateTo ? `Tested ${filters.dateFrom}` : `Tested ${filters.dateFrom} – ${filters.dateTo}`)
  } else if (filters.dateFrom) out.push(`Tested from ${filters.dateFrom}`)
  else if (filters.dateTo) out.push(`Tested through ${filters.dateTo}`)

  if (steps.length) {
    const verb = (STEP_STATUS_OPTIONS.find((o) => o.value === (filters.stepStatus || 'fail')) || {}).label || 'Failed'
    const scope = steps.length > 1 ? (filters.stepMatch === 'all' ? ' all of' : ' any of') : ''
    out.push(`${verb}${scope} ${steps.map((code) => stepLabels[code] || code).join(', ')}`)
  }
  return out
}

/** Natural serial ordering (SN-2 before SN-10), with blank serials last. */
export function sortBySerialNumber(injectors = []) {
  return [...injectors].sort((a, b) => {
    const as = String(a?.serial_number ?? '').trim()
    const bs = String(b?.serial_number ?? '').trim()
    if (!as && bs) return 1
    if (as && !bs) return -1
    return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/** Toggle one injector. Display/report order is applied by orderedSelection. */
export function toggleSelected(selectedIds = [], id) {
  return selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
}

/** Add every given injector that isn't selected yet. */
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

/** Selected injector records, dynamically sorted by serial number. */
export function orderedSelection(selectedIds = [], available = []) {
  const byId = new Map(available.map((i) => [i.id, i]))
  return sortBySerialNumber(selectedIds.map((id) => byId.get(id)).filter(Boolean))
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
  if (noSerial) warnings.push(`${noSerial} selected injector(s) have no serial number.`)
  if (noPart) warnings.push(`${noPart} selected injector(s) have no part number.`)

  return { ok: true, message: '', warnings }
}

/** Short description of what is selected. */
export function describeSelection(selected = []) {
  return `${selected.length} injector${selected.length === 1 ? '' : 's'}`
}

/**
 * Report name used by the vendor prompt, or an empty string when that report
 * does not need vendor header information.
 */
export function vendorPromptReport(kind) {
  if (kind === 'evaluation') return 'Shipment Evaluation Report'
  if (kind === 'customer' || kind === 'both') return 'Custom Report'
  return ''
}

/**
 * Suggested filename stem for a report over the given selection.
 * Pass `{ vendor }` for reports whose filename should carry the vendor.
 */
export function suggestReportName(prefix, selected = [], { vendor = '' } = {}) {
  const part = selected.find((i) => i.part_number)?.part_number
  const scope = String(vendor ?? '').trim()
  return [prefix, part, scope, `${selected.length}`]
    .filter(Boolean)
    .map((v) => String(v).trim().replace(/\s+/g, '-'))
    .join('_')
}
