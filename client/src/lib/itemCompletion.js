// Helpers for determining whether an inspection item (one entry in the
// per-item section_data array) is "complete".
//
// Completion rule: an item is complete once its Disposition has been selected.
// Each item stores its own disposition under the `__disposition` key in its
// section_data. (Legacy single-item inspections seed item 0's disposition from
// the inspection-level disposition for backward compatibility.)

export const ITEM_DISPOSITION_KEY = '__disposition'

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
 * Returns '' if no item has a disposition yet.
 */
export function deriveOverallDisposition(items) {
  const dispositions = (items || []).map(getItemDisposition).filter(Boolean)
  if (dispositions.length === 0) return ''
  if (dispositions.includes('FAIL') || dispositions.includes('REJECT')) return 'FAIL'
  if (dispositions.includes('ACCEPTED') || dispositions.includes('CONDITIONAL')) return 'ACCEPTED'
  return 'PASS'
}
