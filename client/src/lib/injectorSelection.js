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

/** Independent Part Number, Serial Number, date-range and result filters. */
export function filterInjectors(injectors = [], {
  partNumber = '',
  serialNumber = '',
  status = '',
  dateFrom = '',
  dateTo = '',
} = {}) {
  const part = String(partNumber ?? '').trim().toLowerCase()
  const serial = String(serialNumber ?? '').trim().toLowerCase()
  const wantedStatus = String(status ?? '').trim().toLowerCase()
  const from = String(dateFrom ?? '').trim()
  const to = String(dateTo ?? '').trim()

  return sortByTestDate(injectors).filter((injector) => {
    if (part && !String(injector?.part_number ?? '').toLowerCase().includes(part)) return false
    if (serial && !String(injector?.serial_number ?? '').toLowerCase().includes(serial)) return false
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
