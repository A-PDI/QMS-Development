/**
 * Selection, filtering and validation helpers for the Injector Tests page.
 *
 * Pure functions with no React/DOM dependencies so the selection rules can be
 * unit-tested and reused (the page only wires them to state).
 *
 * Selection is ORDER-AWARE: `selectedIds` is an array whose order defines the
 * injector column order (1, 2, 3 …) in every generated report.
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

/** Independent Part Number, Serial Number and result-status filters. */
export function filterInjectors(injectors = [], {
  partNumber = '',
  serialNumber = '',
  status = '',
} = {}) {
  const part = String(partNumber ?? '').trim().toLowerCase()
  const serial = String(serialNumber ?? '').trim().toLowerCase()
  const wantedStatus = String(status ?? '').trim().toLowerCase()

  return sortByTestDate(injectors).filter((injector) => {
    if (part && !String(injector?.part_number ?? '').toLowerCase().includes(part)) return false
    if (serial && !String(injector?.serial_number ?? '').toLowerCase().includes(serial)) return false
    if (wantedStatus === 'pass' && injector?.overall_pass !== 1) return false
    if (wantedStatus === 'fail' && injector?.overall_pass !== 0) return false
    if (wantedStatus === 'unscored' && injector?.overall_pass != null) return false
    return true
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
