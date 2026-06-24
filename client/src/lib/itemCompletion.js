// Helpers for determining whether an inspection item (one entry in the
// per-item section_data array) has been fully filled in.
//
// "Finished" rules per section type:
//   • pfn_checklist / pfn_visual   — every item row has a decision (P/F/A or a
//                                     non-empty result/status that isn't 'N').
//   • pass_fail_checklist          — every row has pass===true or fail===true.
//   • general_measurements         — every row has an actual_value.
//   • dimensional                  — every row has at least actual1 filled.
//   • camshaft_bore                — every bore value filled.
//   • fire_ring_protrusion         — every cylinder value filled.
//   • valve_recession              — every cylinder's int/exh values filled.
//   • vacuum_test                  — every cylinder's overall value filled.
//   • groove_specs                 — every entry measurement's cylinder values filled.
// Optional (dimensional) sections are only required when dimensionalAdded.

function isDecided(v) {
  return v !== undefined && v !== null && v !== '' && v !== 'N'
}

function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== ''
}

// Returns { done, total } counts of required fields/rows for a single section.
function sectionProgress(def, data) {
  const items = Array.isArray(def.items) ? def.items : []
  let total = 0
  let done = 0

  switch (def.section_type) {
    case 'pfn_checklist':
    case 'pfn_visual': {
      const rows = Array.isArray(data) ? data : []
      for (const item of items) {
        total += 1
        const row = rows.find(r => String(r.id) === String(item.id))
        const decision = row ? (row.result !== undefined ? row.result : row.status) : ''
        if (isDecided(decision)) done += 1
      }
      break
    }
    case 'pass_fail_checklist': {
      const rows = Array.isArray(data) ? data : []
      for (const item of items) {
        total += 1
        const row = rows.find(r => String(r.id) === String(item.id))
        if (row && (row.pass === true || row.fail === true)) done += 1
      }
      break
    }
    case 'general_measurements': {
      const rows = Array.isArray(data) ? data : []
      for (const item of items) {
        total += 1
        const row = rows.find(r => String(r.id) === String(item.id))
        if (row && hasValue(row.actual_value)) done += 1
      }
      break
    }
    case 'dimensional': {
      const rows = Array.isArray(data) ? data : []
      for (const item of items) {
        total += 1
        const row = rows.find(r => String(r.id) === String(item.id))
        if (row && (hasValue(row.actual1) || hasValue(row.actual2) || hasValue(row.actual3))) done += 1
      }
      break
    }
    case 'camshaft_bore': {
      const bores = (data && Array.isArray(data.bores)) ? data.bores : []
      for (const b of bores) {
        total += 1
        const val = (b && typeof b === 'object') ? (b.value ?? b.actual ?? '') : b
        if (hasValue(val)) done += 1
      }
      break
    }
    case 'fire_ring_protrusion': {
      const cyls = (data && Array.isArray(data.cylinders)) ? data.cylinders : []
      for (const c of cyls) {
        total += 1
        const val = (c && typeof c === 'object') ? (c.value ?? c.actual ?? '') : c
        if (hasValue(val)) done += 1
      }
      break
    }
    case 'valve_recession': {
      const cyls = (data && Array.isArray(data.cylinders)) ? data.cylinders : []
      for (const c of cyls) {
        total += 1
        if (c && (hasValue(c.int1) || hasValue(c.int2) || hasValue(c.exh1) || hasValue(c.exh2))) done += 1
      }
      break
    }
    case 'vacuum_test': {
      const cyls = (data && Array.isArray(data.cylinders)) ? data.cylinders : []
      for (const c of cyls) {
        total += 1
        if (c && hasValue(c.overall)) done += 1
      }
      break
    }
    case 'groove_specs': {
      const measurements = (data && Array.isArray(data.measurements)) ? data.measurements : []
      // Only measurements flagged for per-cylinder data entry are required.
      const defItems = items.filter(it => it.entry !== false)
      defItems.forEach((di, idx) => {
        // Match stored data by id first, then fall back to positional index.
        const m = measurements.find(x => String(x.id) === String(di.id)) || measurements[idx]
        const cyls = (m && Array.isArray(m.cylinders)) ? m.cylinders : []
        const expected = di.cylinder_count || def.cylinder_count || cyls.length || 0
        const count = Math.max(expected, cyls.length, 1)
        for (let c = 0; c < count; c++) {
          total += 1
          if (hasValue(cyls[c])) done += 1
        }
      })
      break
    }
    default:
      break
  }
  return { done, total }
}

/**
 * Completion for a single item across all (applicable) sections.
 * @param {object} itemData  one item's section_data
 * @param {object} sections  effective section definitions
 * @param {boolean} dimensionalAdded  whether optional dimensional sections count
 * @returns {{ done:number, total:number, isComplete:boolean }}
 */
export function getItemCompletion(itemData, sections, dimensionalAdded) {
  let done = 0
  let total = 0
  for (const [key, def] of Object.entries(sections || {})) {
    if (key.startsWith('__')) continue
    if (!def || typeof def !== 'object') continue
    if (def.optional && !dimensionalAdded) continue
    const p = sectionProgress(def, itemData ? itemData[key] : undefined)
    done += p.done
    total += p.total
  }
  return { done, total, isComplete: total > 0 ? done >= total : true }
}

/**
 * Completion for every item.
 * @returns {{ perItem: Array<{done,total,isComplete}>, allComplete:boolean,
 *            incompleteIndexes:number[] }}
 */
export function getItemsCompletion(items, sections, dimensionalAdded) {
  const perItem = (items || []).map(it => getItemCompletion(it, sections, dimensionalAdded))
  const incompleteIndexes = perItem
    .map((c, i) => (c.isComplete ? -1 : i))
    .filter(i => i >= 0)
  return { perItem, allComplete: incompleteIndexes.length === 0, incompleteIndexes }
}
