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
        data[key] = section.items.map(item => ({ id: item.id, specification: '', actual_value: '', notes: '' }))
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
