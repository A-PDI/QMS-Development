// Editing state for the Part Specifications admin screen.
//
// A part's spec_data maps an inspection point key (`${sectionKey}.${itemId}`)
// to its spec. The editor works on one "entry" per point; these helpers turn a
// stored value into an entry and back, and build the payload to save so that
// points the administrator did not touch keep their stored value exactly.

import { isSpecEmpty, resolveSpec } from './dimensional.js'

export const ENTRY_TYPES = [
  { value: '', label: 'Not specified' },
  { value: 'tolerance', label: 'Nominal ± tolerance' },
  { value: 'limits', label: 'Min / Max limits' },
  { value: 'text', label: 'Text only (manual Pass/Fail)' },
]

export function emptyEntry() {
  return { type: '', nominal: '', lower_tol: '', upper_tol: '', min: '', max: '', unit: '', text: '' }
}

/** Editor entry for a stored spec value (legacy strings are read as structured specs when they parse). */
export function toEditorEntry(stored) {
  const entry = emptyEntry()
  if (isSpecEmpty(stored)) return entry
  if (typeof stored === 'string') {
    const resolved = resolveSpec(stored)
    if (resolved && resolved.evaluable) return { ...entry, ...resolved.fields }
    return { ...entry, type: 'text', text: stored.trim() }
  }
  const str = v => (v == null ? '' : String(v))
  const type = ['tolerance', 'limits', 'text'].includes(stored.type)
    ? stored.type
    : (str(stored.nominal).trim() ? 'tolerance' : (str(stored.min).trim() || str(stored.max).trim()) ? 'limits' : 'text')
  return {
    ...entry,
    type,
    nominal: str(stored.nominal), lower_tol: str(stored.lower_tol), upper_tol: str(stored.upper_tol),
    min: str(stored.min), max: str(stored.max), unit: str(stored.unit), text: str(stored.text),
  }
}

/** Stored value for an editor entry, or null when the point is not specified. */
export function fromEditorEntry(entry) {
  if (!entry || !entry.type) return null
  const t = v => String(v ?? '').trim()
  let value
  if (entry.type === 'tolerance') {
    value = { type: 'tolerance', nominal: t(entry.nominal), lower_tol: t(entry.lower_tol), upper_tol: t(entry.upper_tol), unit: t(entry.unit) }
  } else if (entry.type === 'limits') {
    value = { type: 'limits', min: t(entry.min), max: t(entry.max), unit: t(entry.unit) }
  } else {
    value = { type: 'text', text: t(entry.text) }
  }
  return isSpecEmpty(value) ? null : value
}

/** What an entry resolves to, for the live preview: null when not specified. */
export function previewEntry(entry) {
  const value = fromEditorEntry(entry)
  return value ? resolveSpec(value) : null
}

/**
 * spec_data to save. Points the administrator edited take their entry's value
 * (or are removed when cleared); every other stored key — including keys for
 * points no longer on the form — is kept exactly as it was.
 */
export function buildSpecPayload(original, entries, touchedKeys) {
  const next = { ...(original && typeof original === 'object' ? original : {}) }
  for (const key of touchedKeys || []) {
    const value = fromEditorEntry(entries[key])
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

/** Number of the form's points that have a spec. */
export function countSpecified(specData, points) {
  const data = specData && typeof specData === 'object' ? specData : {}
  return (points || []).filter(p => !isSpecEmpty(data[p.key])).length
}

/** Entries that cannot be saved: [{ key, message }]. */
export function entryErrors(entries, touchedKeys, messages) {
  const errors = []
  for (const key of touchedKeys || []) {
    const entry = entries[key]
    if (!entry || !entry.type || entry.type === 'text') continue
    const preview = previewEntry(entry)
    if (preview && !preview.evaluable) errors.push({ key, message: messages[preview.error] || 'Invalid specification' })
  }
  return errors
}
