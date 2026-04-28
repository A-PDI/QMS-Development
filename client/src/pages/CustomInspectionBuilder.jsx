import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusCircle, X, ChevronDown, ChevronUp, ArrowLeft, Pencil, Check, Save, PlayCircle } from 'lucide-react'
import { useCreateTemplate, useInspectionItems, useTemplates } from '../hooks/useTemplates'
import { useCreateInspection } from '../hooks/useInspections'
import { useToast } from '../hooks/useToast'
import { getUser } from '../lib/auth'

// Standard header fields stored in every template
const STANDARD_HEADER = [
  'part_number', 'supplier', 'po_number', 'lot_serial_no',
  'date_received', 'inspector_name', 'lot_size',
]

const DEFAULT_RECEIVING_ITEMS = [
  { id: 1, name: 'PO / Traveler present', requirement: '' },
  { id: 2, name: 'Quantity matches PO', requirement: '' },
  { id: 3, name: 'Part number matches PO', requirement: '' },
  { id: 4, name: 'Parts properly packaged / no damage', requirement: '' },
  { id: 5, name: 'Certificates / paperwork present', requirement: '' },
]

const SECTION_TYPE_LABELS = {
  pfn_checklist: 'Receiving Checklist (Pass / Fail / NA)',
  pass_fail_checklist: 'Visual / Quality Checklist (Pass / Fail)',
  dimensional: 'Dimensional Inspection',
}

// Field config per section type: which item fields map to which columns
const FIELD_CONFIG = {
  pfn_checklist:      { f1: 'name',        l1: 'Check Item',   f2: 'requirement', l2: 'Requirement' },
  pass_fail_checklist:{ f1: 'name',        l1: 'Check Item',   f2: 'requirement', l2: 'Requirement' },
  dimensional:        { f1: 'measurement', l1: 'Measurement',  f2: 'location',    l2: 'Location(s)' },
}

// Sections where item-level add/delete/edit makes sense
const ITEM_EDITABLE = new Set(['pfn_checklist', 'pass_fail_checklist', 'dimensional'])

const INITIAL_SECTIONS = [
  {
    key: 'receiving',
    title: 'Receiving & Documentation Verification',
    section_type: 'pfn_checklist',
    items: DEFAULT_RECEIVING_ITEMS.map(i => ({ ...i })),
  },
  {
    key: 'visual',
    title: 'Visual Inspection',
    section_type: 'pass_fail_checklist',
    items: [],
  },
  {
    key: 'dimensional',
    title: 'Dimensional Inspection',
    section_type: 'dimensional',
    items: [],
  },
]

function slugify(str) {
  return str.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// ─── SectionCard ─────────────────────────────────────────────────────────────

function SectionCard({ section, onDelete, onDeleteItem, onAddItem, onEditItem, existingItems }) {
  const [open, setOpen] = useState(true)
  const [addMode, setAddMode] = useState(false)
  const [pickerVal, setPickerVal] = useState('__custom')
  const [addVal1, setAddVal1] = useState('')
  const [addVal2, setAddVal2] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editVal1, setEditVal1] = useState('')
  const [editVal2, setEditVal2] = useState('')

  const canEditItems = ITEM_EDITABLE.has(section.section_type)
  const dbItems = existingItems?.[section.section_type] || []
  const fc = FIELD_CONFIG[section.section_type] || { f1: 'name', l1: 'Item', f2: 'requirement', l2: 'Requirement' }

  function commitAdd() {
    const val1 = pickerVal === '__custom' ? addVal1.trim() : pickerVal
    if (!val1) return
    onAddItem(section.key, val1, addVal2.trim())
    setAddVal1('')
    setAddVal2('')
    setPickerVal('__custom')
    setAddMode(false)
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditVal1(item[fc.f1] || '')
    setEditVal2(item[fc.f2] || '')
  }

  function commitEdit() {
    if (!editVal1.trim()) return
    onEditItem(section.key, editingId, editVal1.trim(), editVal2.trim())
    setEditingId(null)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Section header */}
      <div className="flex items-center bg-pdi-frost min-h-[48px]">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex-1 flex items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-pdi-navy truncate pr-2">{section.title}</span>
          {open ? <ChevronUp size={16} className="text-pdi-navy flex-shrink-0" /> : <ChevronDown size={16} className="text-pdi-navy flex-shrink-0" />}
        </button>
        <button
          type="button"
          onClick={() => onDelete(section.key)}
          title="Remove section"
          className="flex-shrink-0 px-3 py-2 text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {open && (
        <div className="p-4 space-y-3">
          {/* Section type badge */}
          <p className="text-xs text-gray-400">{SECTION_TYPE_LABELS[section.section_type] || section.section_type}</p>

          {/* Item list */}
          {canEditItems && (
            <div className="space-y-1">
              {section.items.length === 0 && (
                <p className="text-xs text-gray-400 italic px-1">No items yet — add one below</p>
              )}
              {section.items.length > 0 && (
                <div className="grid gap-x-2 px-2 pb-1 border-b border-gray-100"
                  style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                  <span className="text-xs font-semibold text-gray-500">{fc.l1}</span>
                  <span className="text-xs font-semibold text-gray-500">{fc.l2}</span>
                  <span className="w-14" />
                </div>
              )}
              {section.items.map(item => (
                <div key={item.id}
                  className="grid gap-x-2 px-2 py-1 rounded hover:bg-gray-50 group items-center"
                  style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                  {editingId === item.id ? (
                    <>
                      <input
                        type="text"
                        value={editVal1}
                        onChange={e => setEditVal1(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null) }}
                        autoFocus
                        className="text-xs border border-pdi-navy rounded px-2 py-1 focus:outline-none"
                        placeholder={fc.l1}
                      />
                      <input
                        type="text"
                        value={editVal2}
                        onChange={e => setEditVal2(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null) }}
                        className="text-xs border border-pdi-navy rounded px-2 py-1 focus:outline-none"
                        placeholder={fc.l2}
                      />
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={commitEdit} title="Save"
                          className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={12} /></button>
                        <button type="button" onClick={() => setEditingId(null)} title="Cancel"
                          className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={12} /></button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-gray-700 truncate">{item[fc.f1] || '—'}</span>
                      <span className="text-sm text-gray-500 truncate">{item[fc.f2] || ''}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" onClick={() => startEdit(item)} title="Edit item"
                          className="p-1 text-blue-500 hover:bg-blue-50 rounded"><Pencil size={12} /></button>
                        <button type="button" onClick={() => onDeleteItem(section.key, item.id)} title="Remove item"
                          className="p-1 text-red-400 hover:bg-red-50 rounded"><X size={12} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add item controls */}
          {canEditItems && (
            addMode ? (
              <div className="space-y-2 border-t border-dashed border-gray-200 pt-3">
                {dbItems.length > 0 && (
                  <select
                    value={pickerVal}
                    onChange={e => { setPickerVal(e.target.value); if (e.target.value !== '__custom') setAddVal1('') }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy bg-white"
                  >
                    <option value="__custom">— Type custom item —</option>
                    {dbItems.map(it => (
                      <option key={it.id ?? it.name} value={it.name}>{it.name}</option>
                    ))}
                  </select>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">{fc.l1} <span className="text-red-400">*</span></label>
                    {(pickerVal === '__custom' || dbItems.length === 0) ? (
                      <input
                        autoFocus
                        type="text"
                        value={addVal1}
                        onChange={e => setAddVal1(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); commitAdd() }
                          if (e.key === 'Escape') { setAddMode(false); setAddVal1(''); setAddVal2('') }
                        }}
                        placeholder={fc.l1 + '…'}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                      />
                    ) : (
                      <div className="px-3 py-2 text-sm bg-gray-50 rounded-lg border border-gray-100">{pickerVal}</div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">{fc.l2}</label>
                    <input
                      type="text"
                      value={addVal2}
                      onChange={e => setAddVal2(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAdd() } }}
                      placeholder={fc.l2 + '…'}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={commitAdd}
                    className="px-3 py-1.5 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy/90"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddMode(false); setAddVal1(''); setAddVal2(''); setPickerVal('__custom') }}
                    className="px-3 py-1.5 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddMode(true)}
                className="flex items-center gap-1.5 text-xs text-pdi-navy/70 hover:text-pdi-navy px-1"
              >
                <PlusCircle size={13} />
                Add item
              </button>
            )
          )}

          {!canEditItems && (
            <p className="text-xs text-gray-400 italic">Items for this section type are configured automatically.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CustomInspectionBuilder() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const createTemplate = useCreateTemplate()
  const createInspection = useCreateInspection()
  const { data: existingItems } = useInspectionItems()

  const currentUser = getUser()
  const { data: allTemplates = [] } = useTemplates()

  // Compute next PDI-IQI number from existing templates
  function nextIqiFormNo() {
    const nums = allTemplates
      .map(t => t.form_no)
      .filter(n => /^PDI-IQI-\d+$/i.test(n))
      .map(n => parseInt(n.replace(/^PDI-IQI-/i, ''), 10))
      .filter(n => !isNaN(n))
    const max = nums.length > 0 ? Math.max(...nums) : 0
    return `PDI-IQI-${String(max + 1).padStart(4, '0')}`
  }

  const [productType, setProductType] = useState('')
  const [sections, setSections] = useState(INITIAL_SECTIONS.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) })))
  const [submitting, setSubmitting] = useState(false)

  function handleDeleteSection(key) {
    setSections(prev => prev.filter(s => s.key !== key))
  }

  function handleDeleteItem(sectionKey, itemId) {
    setSections(prev => prev.map(s =>
      s.key === sectionKey
        ? { ...s, items: s.items.filter(it => String(it.id) !== String(itemId)) }
        : s
    ))
  }

  function handleAddItem(sectionKey, field1, field2) {
    setSections(prev => prev.map(s => {
      if (s.key !== sectionKey) return s
      const maxId = s.items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0)
      const isDimensional = s.section_type === 'dimensional'
      const newItem = isDimensional
        ? { id: maxId + 1, measurement: field1, location: field2 || '', spec: '' }
        : { id: maxId + 1, name: field1, requirement: field2 || '' }
      return { ...s, items: [...s.items, newItem] }
    }))
  }

  function handleEditItem(sectionKey, itemId, field1, field2) {
    setSections(prev => prev.map(s => {
      if (s.key !== sectionKey) return s
      const isDimensional = s.section_type === 'dimensional'
      return {
        ...s,
        items: s.items.map(it => {
          if (String(it.id) !== String(itemId)) return it
          return isDimensional
            ? { ...it, measurement: field1, location: field2 }
            : { ...it, name: field1, requirement: field2 }
        }),
      }
    }))
  }

  function handleAddSection(sectionType) {
    const label = SECTION_TYPE_LABELS[sectionType] || sectionType
    const key = `${sectionType}_${Date.now()}`
    setSections(prev => [...prev, { key, title: label, section_type: sectionType, items: [] }])
  }

  async function handleAction(beginInspection = false) {
    if (!productType.trim()) {
      showToast('Product Type is required', 'error')
      return
    }
    if (sections.length === 0) {
      showToast('Add at least one section', 'error')
      return
    }

    setSubmitting(true)
    try {
      const slug = slugify(productType)
      const formNo = nextIqiFormNo()
      const title = `PDI Incoming Quality Inspection — ${productType.trim()}`

      const sectionsObj = {}
      for (const sec of sections) {
        sectionsObj[sec.key] = { title: sec.title, section_type: sec.section_type, items: sec.items }
      }

      const template = await createTemplate.mutateAsync({
        form_no: formNo,
        title,
        component_type: slug,
        disposition_type: 'pass_fail',
        header_schema: STANDARD_HEADER,
        sections: sectionsObj,
      })

      if (beginInspection) {
        const inspection = await createInspection.mutateAsync({
          template_id: template.id,
          inspector_name: currentUser?.name || '',
        })
        showToast(`Form ${formNo} created — starting inspection`, 'success')
        navigate(`/inspections/${inspection.id}/edit`)
      } else {
        showToast(`Template ${formNo} saved`, 'success')
        navigate('/inspections')
      }
    } catch (err) {
      showToast(err?.response?.data?.error || err.message || 'Failed to create form', 'error')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm flex-shrink-0 px-4 sm:px-6 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/inspections/new')}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0"
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-gray-900">Build Custom Inspection Form</h1>
          <p className="text-xs text-gray-500">Define sections and items, then save or start an inspection</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">

          {/* Product type */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Form Identity</h2>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Product / Component Type <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={productType}
              onChange={e => setProductType(e.target.value)}
              placeholder="e.g. Water Pump, Brake Caliper…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy min-h-[40px]"
            />
            <p className="text-xs text-gray-400 mt-1.5">
              This creates a reusable form template for this product type.
            </p>
          </div>

          {/* Section builder */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Inspection Sections</h2>
              <span className="text-xs text-gray-400">{sections.length} section{sections.length !== 1 ? 's' : ''}</span>
            </div>
            {sections.length === 0 && (
              <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-sm">
                No sections — add one below
              </div>
            )}
            {sections.map(sec => (
              <SectionCard
                key={sec.key}
                section={sec}
                onDelete={handleDeleteSection}
                onDeleteItem={handleDeleteItem}
                onAddItem={handleAddItem}
                onEditItem={handleEditItem}
                existingItems={existingItems}
              />
            ))}
            {(() => {
              const usedTypes = new Set(sections.map(s => s.section_type))
              const missing = Object.entries(SECTION_TYPE_LABELS).filter(([type]) => !usedTypes.has(type))
              if (missing.length === 0) return null
              return (
                <div className="flex flex-wrap gap-2 pt-1">
                  {missing.map(([type, label]) => (
                    <button key={type} type="button" onClick={() => handleAddSection(type)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-2 border-dashed border-pdi-navy/30 text-pdi-navy/70 rounded-lg hover:border-pdi-navy hover:text-pdi-navy hover:bg-pdi-frost transition-all">
                      <PlusCircle size={13} />
                      + {label.split(' (')[0]}
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2 pb-8">
            <button type="button" onClick={() => navigate('/inspections/new')}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]">
              Cancel
            </button>
            <button type="button" disabled={submitting} onClick={() => handleAction(false)}
              className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-60 transition-colors font-semibold min-h-[44px]">
              <Save size={15} />
              {submitting ? 'Saving…' : 'Save Template'}
            </button>
            <button type="button" disabled={submitting} onClick={() => handleAction(true)}
              className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light disabled:opacity-60 transition-colors font-semibold min-h-[44px]">
              <PlayCircle size={15} />
              {submitting ? 'Creating…' : 'Begin Inspection'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
