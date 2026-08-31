// Helpers for identifying the standard inspection sections and for bulk-setting
// their results.
//
// Every form built by the app (seeded templates, the Custom and Miscellaneous
// builders) keys Section A as `receiving` and Section B as `visual`, so the key
// is the primary test; the title is a fallback for hand-built sections.

/** Status code for an inspection item marked "not applicable". */
export const NA_STATUS = 'N'

/** Result codes offered on Section A, where an item may not apply at all. */
export const PFN_OPTIONS_WITH_NA = ['P', 'F', 'A', NA_STATUS]

function titleOf(section) {
  return String(section?.title || '').toUpperCase()
}

/** True for Section A — Receiving & Documentation Verification. */
export function isReceivingSection(key, section) {
  return String(key || '').toLowerCase() === 'receiving' || titleOf(section).includes('RECEIVING')
}

/** True for Section B — Visual Inspection. */
export function isVisualSection(key, section) {
  return String(key || '').toLowerCase() === 'visual' || titleOf(section).includes('VISUAL')
}

// Field each checklist section type stores its Pass/Fail/Accepted code in.
const RESULT_FIELD_BY_TYPE = {
  pfn_checklist: 'status',
  pfn_visual: 'result',
  pass_fail_checklist: 'result',
}

/** True when a "Pass All" action applies to this section. */
export function supportsPassAll(section) {
  return !!RESULT_FIELD_BY_TYPE[section?.section_type] && (section?.items || []).length > 0
}

/** True when any row already carries a result other than Pass. */
export function hasNonPassRows(section, data) {
  const field = RESULT_FIELD_BY_TYPE[section?.section_type]
  if (!field) return false
  return (Array.isArray(data) ? data : []).some(row => {
    const value = row?.[field] !== undefined ? row[field] : row?.status
    // Legacy pass_fail rows stored booleans instead of a result code.
    if (row?.fail === true) return true
    return !!value && value !== 'P'
  })
}

/**
 * Every item in the section marked Pass, keeping each row's other fields.
 * Rows are rebuilt from the section's item list so items added after the
 * inspection was created also get a row.
 */
export function passAllRows(section, data) {
  const field = RESULT_FIELD_BY_TYPE[section?.section_type]
  if (!field) return data
  const rows = Array.isArray(data) ? data : []
  return (section.items || []).map(item => {
    const row = rows.find(r => r.id === item.id) || { id: item.id }
    const next = { ...row, [field]: 'P' }
    // Clear the legacy boolean pair so it can't contradict the result code.
    if (next.pass !== undefined) next.pass = true
    if (next.fail !== undefined) next.fail = false
    return next
  })
}

// ─── Section scope: inspection-level vs. per-item ────────────────────────────
// Most sections are answered once for every inspected item. Section A checks
// the DELIVERY — the carton, the paperwork, the count — so it is answered once
// for the whole inspection, before the item-level inspections begin.

/** Key under which the inspection-level answers live in section_data. */
export const SHARED_SECTION_DATA_KEY = '__shared'

/** True for a section completed once per inspection rather than once per item. */
export function isInspectionLevelSection(key, section) {
  return isReceivingSection(key, section)
}

/**
 * A template's sections split by scope, each as [key, section] pairs in the
 * template's own order. Control keys (`__…`) are dropped.
 */
export function splitSectionsByScope(sections) {
  const inspectionLevel = []
  const perItem = []
  for (const [key, section] of Object.entries(sections || {})) {
    if (key.startsWith('__')) continue
    if (isInspectionLevelSection(key, section)) inspectionLevel.push([key, section])
    else perItem.push([key, section])
  }
  return { inspectionLevel, perItem }
}

/** Keys of the sections answered once per inspection. */
export function inspectionLevelKeys(sections) {
  return splitSectionsByScope(sections).inspectionLevel.map(([key]) => key)
}

/** True when at least one row in a checklist section carries an answer. */
function hasAnswers(rows) {
  return (Array.isArray(rows) ? rows : []).some(row =>
    !!(row && (row.status || row.result || row.finding || row.notes || row.pass || row.fail))
  )
}

/**
 * The inspection-level answers held in a saved section_data blob.
 *
 * They live under `__shared`. Inspections saved before Section A moved up kept
 * a copy inside every item, so those are hoisted from the first item that was
 * actually filled in (falling back to the first item).
 */
export function extractSharedSectionData(saved, sections) {
  const stored = (saved && saved[SHARED_SECTION_DATA_KEY]) || {}
  const items = Array.isArray(saved?.__items) && saved.__items.length > 0
    ? saved.__items
    : [saved || {}]
  const shared = {}
  for (const key of inspectionLevelKeys(sections)) {
    if (stored[key] !== undefined) { shared[key] = stored[key]; continue }
    const answered = items.find(it => it && hasAnswers(it[key]))
    const source = answered || items.find(it => it && it[key] !== undefined)
    if (source) shared[key] = source[key]
  }
  return shared
}

/** A copy of one item's answers without the inspection-level section keys. */
export function stripSectionKeys(itemData, keys) {
  const next = { ...(itemData || {}) }
  for (const key of keys || []) delete next[key]
  return next
}

/**
 * Attachments as an inspection-level section sees them. An inspection answered
 * before Section A moved up filed its images under the per-item key
 * (`item2__receiving`); those are re-labelled to the section's own key so they
 * still show against the section they document.
 */
export function sharedSectionAttachments(attachments, key) {
  const legacy = new RegExp(`^item\\d+__${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  return (attachments || []).map(a => (
    legacy.test(a?.section_key || '') ? { ...a, section_key: key } : a
  ))
}
