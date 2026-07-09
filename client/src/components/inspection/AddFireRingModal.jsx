import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Ruler } from 'lucide-react'
import { useInspection, useUpdateInspection } from '../../hooks/useInspections'
import { useTemplate } from '../../hooks/useTemplates'
import { useToast } from '../../hooks/useToast'
import {
  getSectionData, getEffectiveSections, findFireRingKey, getSectionItems, initSectionData,
} from '../../lib/utils'
import SectionGrooveSpecs from './SectionGrooveSpecs'

/**
 * Popup for adding Fire Ring Protrusion measurements to a closed (complete)
 * cylinder-head inspection that has no Fire Ring values yet. Shows the
 * Dimensional Inspection entry card for the Fire Ring section only, with Save
 * and Cancel. Saving writes the values into section_data and leaves the
 * inspection's status/disposition unchanged.
 */
export default function AddFireRingModal({ inspectionId, onClose, onSaved }) {
  const { showToast } = useToast()
  const qc = useQueryClient()
  const update = useUpdateInspection()
  const { data: inspection, isLoading: loadingInsp } = useInspection(inspectionId)
  const { data: template, isLoading: loadingTpl } = useTemplate(inspection?.template_id)
  const [saving, setSaving] = useState(false)
  // Per-item Fire Ring section data being edited (null until initialized).
  const [grooveByItem, setGrooveByItem] = useState(null)

  const model = useMemo(() => {
    if (!inspection || !template) return null
    const sd = getSectionData(inspection)
    const sections = getEffectiveSections(template, sd)
    const grooveKey = findFireRingKey(sections)
    if (!grooveKey) return { grooveKey: null }
    const section = sections[grooveKey]
    const items = getSectionItems(sd)
    const defaultGroove = initSectionData({ [grooveKey]: section })[grooveKey]
    return { sd, sections, grooveKey, section, items, defaultGroove }
  }, [inspection, template])

  useEffect(() => {
    if (model && model.grooveKey && grooveByItem === null) {
      setGrooveByItem(model.items.map(it => it?.[model.grooveKey] || model.defaultGroove))
    }
  }, [model, grooveByItem])

  async function handleSave() {
    if (!model || !model.grooveKey || !grooveByItem) return
    setSaving(true)
    try {
      const { sd, grooveKey, items } = model
      // Preserve shared control flags; only the Fire Ring key changes per item.
      const sharedFlags = {}
      if (sd.__dimensional_added) sharedFlags.__dimensional_added = true
      if (sd.__admin_sections) sharedFlags.__admin_sections = sd.__admin_sections
      const newItems = items.map((it, i) => ({ ...it, [grooveKey]: grooveByItem[i] }))
      // Status/disposition intentionally omitted so the inspection stays closed.
      await update.mutateAsync({ id: inspectionId, section_data: { ...sharedFlags, __items: newItems } })
      qc.invalidateQueries({ queryKey: ['inspection', inspectionId] })
      qc.invalidateQueries({ queryKey: ['fire-ring-eligible'] })
      qc.invalidateQueries({ queryKey: ['inspections'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      showToast('Fire Ring measurements saved', 'success')
      onSaved?.()
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to save Fire Ring measurements', 'error')
    } finally {
      setSaving(false)
    }
  }

  const loading = loadingInsp || loadingTpl
  const multiItem = (model?.items?.length || 0) > 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 sm:p-6 border-b border-gray-100">
          <div className="flex-shrink-0 w-10 h-10 bg-pdi-navy/10 rounded-full flex items-center justify-center">
            <Ruler size={18} className="text-pdi-navy" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900">Add Fire Ring Protrusion</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {inspection
                ? <>Enter Fire Ring Protrusion measurements for <span className="font-mono">{inspection.form_no}</span>{inspection.part_number ? <> · {inspection.part_number}</> : null}.</>
                : 'Loading inspection…'}
            </p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-600 rounded" title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 size={20} className="animate-spin mr-2" /> Loading…
            </div>
          ) : !model || !model.grooveKey ? (
            <div className="text-sm text-red-500 py-6 text-center">
              This inspection's form has no Fire Ring section.
            </div>
          ) : !grooveByItem ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            model.items.map((_, itemIdx) => (
              <div key={itemIdx} className="space-y-2">
                {multiItem && (
                  <div className="text-xs font-semibold text-pdi-navy uppercase tracking-wide">
                    Item {itemIdx + 1} of {model.items.length}
                  </div>
                )}
                <div className="border border-gray-100 rounded-xl p-4">
                  <div className="text-sm font-semibold text-gray-700 mb-3">{model.section.title}</div>
                  <SectionGrooveSpecs
                    section={model.section}
                    data={grooveByItem[itemIdx]}
                    onChange={val => setGrooveByItem(arr => arr.map((g, i) => (i === itemIdx ? val : g)))}
                    readOnly={false}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end p-4 sm:p-5 border-t border-gray-100">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !model?.grooveKey || !grooveByItem}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px] disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
