// Helpers for the identity and the completion state of an inspection item (one
// entry in the per-item section_data array).
//
// Identity: each item carries its own serial number under `__serial_no`, so the
// inspection points and images recorded against the item belong to that serial.
//
// Completion rule: an item is complete once its Disposition has been selected.
// Each item stores its own disposition under the `__disposition` key in its
// section_data. (Legacy single-item inspections seed item 0's disposition from
// the inspection-level disposition for backward compatibility.)

export const ITEM_DISPOSITION_KEY = '__disposition'

/** Key holding an item's serial number in its section_data. */
export const ITEM_SERIAL_KEY = '__serial_no'

/** Read an item's serial number, or '' if none has been entered. */
export function getItemSerial(itemData) {
  if (!itemData || typeof itemData !== 'object') return ''
  return String(itemData[ITEM_SERIAL_KEY] || '').trim()
}

/** Tab / banner label for an item: its serial number when it has one. */
export function getItemLabel(itemData, index) {
  const serial = getItemSerial(itemData)
  return serial ? `Item ${index + 1} · ${serial}` : `Item ${index + 1}`
}

/**
 * The inspection-level Lot / Serial No. derived from the item serials: every
 * distinct serial, in item order. It keeps the list views and the search index
 * (which query the inspection row, not section_data) working now that serials
 * are entered per item.
 */
export function deriveLotSerial(items) {
  const seen = new Set()
  for (const item of items || []) {
    const serial = getItemSerial(item)
    if (serial) seen.add(serial)
  }
  return [...seen].join(', ')
}

/**
 * Seed item serials from an inspection-level Lot / Serial No.
 *
 * Inspections created before serials moved to the item level hold one value on
 * the inspection row — either a single serial or the comma-separated list the
 * injector sync writes. A list whose length matches the item count maps onto
 * the items in order; anything else is only applied to a single-item
 * inspection, where it is unambiguous. Items that already carry a serial are
 * left untouched.
 */
export function seedItemSerials(items, lotSerialNo) {
  const list = items || []
  if (list.every(it => getItemSerial(it))) return list
  const parts = String(lotSerialNo || '').split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return list
  if (parts.length !== list.length && !(parts.length === 1 && list.length === 1)) return list
  return list.map((item, i) => (
    getItemSerial(item) ? item : { ...item, [ITEM_SERIAL_KEY]: parts[i] }
  ))
}

/** Read an item's selected disposition (PASS / FAIL / ACCEPTED), or '' if none. */
export function getItemDisposition(itemData) {
  if (!itemData || typeof itemData !== 'object') return ''
  return itemData[ITEM_DISPOSITION_KEY] || ''
}

/**
 * Completion for a single item.
 * @param {object} itemData  one item's section_data
 * @returns {{ disposition:string, isComplete:boolean }}
 */
export function getItemCompletion(itemData) {
  const disposition = getItemDisposition(itemData)
  return { disposition, isComplete: !!disposition }
}

/**
 * Completion for every item.
 * @returns {{ perItem: Array<{disposition,isComplete}>, allComplete:boolean,
 *            incompleteIndexes:number[] }}
 */
export function getItemsCompletion(items) {
  const perItem = (items || []).map(it => getItemCompletion(it))
  const incompleteIndexes = perItem
    .map((c, i) => (c.isComplete ? -1 : i))
    .filter(i => i >= 0)
  return { perItem, allComplete: incompleteIndexes.length === 0, incompleteIndexes }
}

/**
 * Derive the overall inspection disposition from the per-item dispositions.
 * Worst-case wins: any FAIL → FAIL, else any ACCEPTED → ACCEPTED, else PASS.
 *
 * Returns '' unless EVERY item has a disposition — a partially-completed
 * inspection has no overall pass/fail result yet, so the list/PDF shouldn't
 * show one until all items are done.
 */
export function deriveOverallDisposition(items) {
  const list = items || []
  if (list.length === 0) return ''
  const dispositions = list.map(getItemDisposition)
  // Not all items dispositioned yet → no overall result.
  if (dispositions.some(d => !d)) return ''
  if (dispositions.includes('FAIL') || dispositions.includes('REJECT')) return 'FAIL'
  if (dispositions.includes('ACCEPTED') || dispositions.includes('CONDITIONAL')) return 'ACCEPTED'
  return 'PASS'
}
