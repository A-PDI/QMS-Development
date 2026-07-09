import { format, parseISO } from 'date-fns'

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy')
  } catch {
    return dateStr
  }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy h:mm a')
  } catch {
    return dateStr
  }
}

export function formatFileSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}

/** Initialize section_data from a template's sections definition */
export function initSectionData(templateSections) {
  const data = {}
  for (const [key, section] of Object.entries(templateSections)) {
    switch (section.section_type) {
      case 'pfn_checklist':
        data[key] = section.items.map(item => ({ id: item.id, finding: '', status: 'N' }))
        break
      case 'pfn_visual':
        data[key] = section.items.map(item => ({ id: item.id, result: 'N', remarks: '' }))
        break
      case 'dimensional':
        data[key] = section.items.map(item => ({ id: item.id, spec: item.spec || '', actual1: '', actual2: '', actual3: '', status: '' }))
        break
      case 'pass_fail_checklist':
        data[key] = section.items.map(item => ({ id: item.id, pass: false, fail: false, notes: '' }))
        break
      case 'general_measurements':
        data[key] = section.items.map(item => ({ id: item.id, specification: '', actual_value: '', notes: '', result: '' }))
        break
      case 'camshaft_bore':
        data[key] = { spec: '', bores: Array(section.bore_count).fill('') }
        break
      case 'fire_ring_protrusion':
        data[key] = { spec: '', cylinders: Array(section.cylinder_count).fill('') }
        break
      case 'valve_recession':
        data[key] = {
          intake_min: '', intake_max: '', exhaust_min: '', exhaust_max: '',
          cylinders: Array(section.cylinder_count).fill(null).map(() => ({ int1: '', int2: '', exh1: '', exh2: '' }))
        }
        break
      case 'vacuum_test':
        data[key] = {
          cylinders: Array(section.cylinder_count).fill(null).map(() => ({
            overall: '', int1: '', int2: '', exh1: '', exh2: ''
          }))
        }
        break
      case 'groove_specs':
        data[key] = {
          measurements: section.items.map(item => ({
            id: item.id,
            cylinders: Array(section.cylinder_count || 6).fill(''),
            status: '',
            notes: '',
          }))
        }
        break
      default:
        data[key] = {}
    }
  }
  return data
}

/** Merge saved section_data with fresh initialized structure (fills missing keys) */
export function mergeSectionData(saved, fresh) {
  const merged = { ...fresh }
  for (const key of Object.keys(fresh)) {
    if (saved && saved[key] !== undefined) {
      merged[key] = saved[key]
    }
  }
  return merged
}

// ─── Fire Ring (Fire Ring Protrusion) helpers ────────────────────────────────
// These mirror the eligibility logic in server/routes/dashboard.js. The "Add
// Fire Ring" action/KPI applies ONLY to complete cylinder-head inspections
// whose Fire Ring section has no per-cylinder values entered yet.

/** Parse an inspection's section_data (string or object) into an object. */
export function getSectionData(inspection) {
  if (!inspection) return {}
  const sd = inspection.section_data
  if (typeof sd === 'string') { try { return JSON.parse(sd || '{}') } catch { return {} } }
  return sd || {}
}

/** Effective sections for an inspection: admin overrides win over the template. */
export function getEffectiveSections(template, sectionData) {
  if (sectionData && sectionData.__admin_sections && typeof sectionData.__admin_sections === 'object') {
    return sectionData.__admin_sections
  }
  if (!template) return {}
  return typeof template.sections === 'string'
    ? JSON.parse(template.sections || '{}')
    : (template.sections || {})
}

/** The per-item answer list (new __items format or a single legacy item). */
export function getSectionItems(sectionData) {
  if (Array.isArray(sectionData?.__items) && sectionData.__items.length > 0) {
    return sectionData.__items
  }
  const legacy = {}
  for (const k of Object.keys(sectionData || {})) {
    if (k.startsWith('__')) continue
    legacy[k] = sectionData[k]
  }
  return [legacy]
}

/** Section key of the Fire Ring (groove_specs) section, or null if none. */
export function findFireRingKey(sections) {
  for (const [key, section] of Object.entries(sections || {})) {
    if (section && section.section_type === 'groove_specs') return key
  }
  return null
}

/** IDs of the data-entry measurement rows (e.g. Wire Protrusion) in a section. */
export function fireRingEntryItemIds(section) {
  return (section?.items || [])
    .filter(it => it.entry === true || (it.entry === undefined && /wire protrusion/i.test(it.measurement || '')))
    .map(it => it.id)
}

/** True if any entry-row cylinder value has already been recorded. */
export function fireRingHasValues(items, grooveKey, section) {
  const ids = fireRingEntryItemIds(section)
  for (const item of items) {
    const data = item?.[grooveKey]
    if (!data || !Array.isArray(data.measurements)) continue
    for (const m of data.measurements) {
      if (!ids.includes(m.id)) continue
      if (Array.isArray(m.cylinders) && m.cylinders.some(c => String(c ?? '').trim() !== '')) return true
    }
  }
  return false
}

/**
 * Whether the "Add Fire Ring" action applies to this inspection: a complete
 * cylinder-head inspection whose Fire Ring section exists but has no values.
 */
export function canAddFireRing(inspection, template) {
  if (!inspection || !template) return false
  if (inspection.status !== 'complete') return false
  if (inspection.component_type !== 'cylinder_head') return false
  const sd = getSectionData(inspection)
  const sections = getEffectiveSections(template, sd)
  const grooveKey = findFireRingKey(sections)
  if (!grooveKey) return false
  return !fireRingHasValues(getSectionItems(sd), grooveKey, sections[grooveKey])
}
