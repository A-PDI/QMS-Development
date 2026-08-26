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
