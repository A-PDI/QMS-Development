import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, FileText, Package, Database, Plus, Edit2, Trash2, Printer, Search, Save, X, ChevronDown, ChevronUp, Users, FileImage, Download, AlertTriangle, Loader2 } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useInspections, useDeleteInspection } from '../hooks/useInspections'
import { usePartSpecs, useCreatePartSpec, useUpdatePartSpec, useDeletePartSpec } from '../hooks/usePartSpecs'
import { useDrawings, useUploadDrawing, useSetCurrentDrawing, useDeleteDrawing } from '../hooks/useDrawings'
import { useToast } from '../hooks/useToast'
import { useTemplates } from '../hooks/useTemplates'
import { formatDate } from '../lib/utils'
import { COMPONENT_TYPE_LABELS, STATUS_LABELS, STATUS_COLORS } from '../lib/constants'
import StatusBadge from '../components/StatusBadge'

const TABS = [
  { id: 'forms',    label: 'Inspection Forms', shortLabel: 'Forms',    icon: FileText },
  { id: 'specs',    label: 'Part Specifications', shortLabel: 'Specs',  icon: Package },
  { id: 'users',    label: 'User Management',    shortLabel: 'Users',   icon: Users },
  { id: 'drawings', label: 'Engineering Drawings', shortLabel: 'Drawings', icon: FileImage },
  { id: 'data',     label: 'Inspection Data',    shortLabel: 'Data',    icon: Database },
]

const SECTION_TYPES = [
  { value: 'pfn_checklist',       label: 'Receiving / PFN Checklist' },
  { value: 'pass_fail_checklist', label: 'Pass/Fail Checklist' },
  { value: 'pfn_visual',          label: 'Visual Inspection' },
  { value: 'dimensional',         label: 'Dimensional Measurements' },
  { value: 'general_measurements',label: 'General Measurements' },
  { value: 'camshaft_bore',       label: 'Camshaft Bore' },
  { value: 'fire_ring_protrusion',label: 'Fire Ring Protrusion' },
  { value: 'valve_recession',     label: 'Valve Recession' },
  { value: 'vacuum_test',         label: 'Vacuum Test' },
]

const ITEM_FIELDS_BY_TYPE = {
  pfn_checklist:        ['name', 'requirement'],
  pass_fail_checklist:  ['name', 'requirement'],
  pfn_visual:           ['ctq_area', 'failure_mode', 'criteria', 'method'],
  dimensional:          ['measurement', 'location', 'spec'],
  general_measurements: ['measurement'],
}

// ── Inspection Forms Tab ──────────────────────────────────────────────────────

function InspectionFormsTab({ showToast }) {
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [expandedSections, setExpandedSections] = useState({})
  const [creating, setCreating] = useState(false)

  const { data: adminTemplates, isLoading } = useQuery({
    queryKey: ['admin-templates'],
    queryFn: async () => { const { data } = await api.get('/admin/templates'); return data.templates },
  })

  const { data: fullTemplate } = useQuery({
    queryKey: ['admin-template-full', editingId],
    queryFn: async () => { const { data } = await api.get(`/admin/templates/${editingId}`); return data.template },
    enabled: !!editingId,
  })

  useEffect(() => {
    if (fullTemplate) {
      setEditForm({
        form_no: fullTemplate.form_no,
        title: fullTemplate.title,
        component_type: fullTemplate.component_type,
        disposition_type: fullTemplate.disposition_type,
        revision: fullTemplate.revision || '',
        active: fullTemplate.active,
        sections: fullTemplate.sections,
      })
      // Auto-expand all sections so items are immediately visible
      const keys = Object.keys(fullTemplate.sections || {}).filter(k => k !== '__dimensional_added')
      setExpandedSections(Object.fromEntries(keys.map(k => [k, true])))
    }
  }, [fullTemplate])

  async function handleSaveTemplate() {
    try {
      await api.patch(`/admin/templates/${editingId}`, editForm)
      qc.invalidateQueries({ queryKey: ['admin-templates'] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      showToast('Template saved', 'success')
      setEditingId(null)
      setEditForm(null)
    } catch (err) {
      showToast(err?.response?.data?.error || 'Save failed', 'error')
    }
  }

  async function handleCreateTemplate() {
    try {
      await api.post('/admin/templates', editForm)
      qc.invalidateQueries({ queryKey: ['admin-templates'] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      showToast('Template created', 'success')
      setCreating(false)
      setEditForm(null)
    } catch (err) {
      showToast(err?.response?.data?.error || 'Create failed', 'error')
    }
  }

  function startCreate() {
    setEditForm({
      form_no: '', title: '', component_type: '',
      disposition_type: 'pass_fail', revision: '', active: 1,
      sections: {},
    })
    setExpandedSections({})
    setCreating(true)
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setCreating(false)
    setEditForm(null)
    setExpandedSections({})
  }

  function addSection() {
    const key = `section_${Date.now()}`
    const newSections = { ...editForm.sections, [key]: { title: 'New Section', section_type: 'pass_fail_checklist', items: [] } }
    setEditForm(f => ({ ...f, sections: newSections }))
    setExpandedSections(s => ({ ...s, [key]: true }))
  }

  function updateSection(key, field, val) {
    setEditForm(f => ({ ...f, sections: { ...f.sections, [key]: { ...f.sections[key], [field]: val } } }))
  }

  function removeSection(key) {
    setEditForm(f => {
      const s = { ...f.sections }; delete s[key]; return { ...f, sections: s }
    })
  }

  function addItem(sectionKey) {
    const section = editForm.sections[sectionKey]
    const items = section.items || []
    const nextId = (Math.max(0, ...items.map(i => i.id || 0)) + 1)
    const blankItem = { id: nextId, name: '', requirement: '' }
    updateSection(sectionKey, 'items', [...items, blankItem])
  }

  function updateItem(sectionKey, itemIdx, field, val) {
    const items = [...(editForm.sections[sectionKey].items || [])]
    items[itemIdx] = { ...items[itemIdx], [field]: val }
    updateSection(sectionKey, 'items', items)
  }

  function removeItem(sectionKey, itemIdx) {
    const items = (editForm.sections[sectionKey].items || []).filter((_, i) => i !== itemIdx)
    updateSection(sectionKey, 'items', items)
  }

  const isEditing = (editingId || creating) && editForm

  if (isLoading) return <div className="p-4 sm:p-6 text-gray-400">Loading templates…</div>

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex justify-end">
        <button onClick={startCreate} className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px]">
          <Plus size={15} /> New Template
        </button>
      </div>

      {isEditing && (
        <div className="bg-white rounded-xl border border-pdi-navy/30 p-3 sm:p-6 space-y-4 sm:space-y-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm sm:text-base font-semibold text-pdi-navy">{creating ? 'Create Template' : 'Edit Template'}</h3>
            <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 min-h-[40px] min-w-[40px] flex items-center justify-center"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            {[['Form No', 'form_no'], ['Title', 'title'], ['Revision', 'revision']].map(([label, key]) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                <input value={editForm[key]} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Component Type</label>
              {/* Free-text input with datalist suggestions so new types can be added */}
              <input
                list="component-type-suggestions"
                value={editForm.component_type}
                onChange={e => setEditForm(f => ({ ...f, component_type: e.target.value }))}
                placeholder="e.g. piston, turbocharger…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
              />
              <datalist id="component-type-suggestions">
                {Object.keys(COMPONENT_TYPE_LABELS).map(k => <option key={k} value={k} />)}
              </datalist>
              <p className="text-xs text-gray-400 mt-0.5">Type a new value to add a new component type</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Disposition Type</label>
              <select value={editForm.disposition_type} onChange={e => setEditForm(f => ({ ...f, disposition_type: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none min-h-[40px]">
                <option value="pass_fail">Pass / Fail</option>
                <option value="accept_reject_conditional">Accept / Reject / Conditional</option>
              </select>
            </div>
            <div className="flex items-center gap-2 mt-0 sm:mt-4 min-h-[40px]">
              <input type="checkbox" id="tmpl-active" checked={!!editForm.active} onChange={e => setEditForm(f => ({ ...f, active: e.target.checked ? 1 : 0 }))} className="w-4 h-4" />
              <label htmlFor="tmpl-active" className="text-sm text-gray-700">Active</label>
            </div>
          </div>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700">Sections</span>
              <button onClick={addSection} className="flex items-center gap-1 text-xs text-pdi-navy hover:underline min-h-[32px]"><Plus size={13} /> Add Section</button>
            </div>
            <div className="space-y-3">
              {Object.entries(editForm.sections || {}).map(([sKey, section]) => {
                if (sKey === '__dimensional_added') return null
                const open = expandedSections[sKey]
                const fields = ITEM_FIELDS_BY_TYPE[section.section_type] || ['name', 'requirement']
                return (
                  <div key={sKey} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-3 sm:px-4 py-2.5 bg-gray-50 cursor-pointer gap-2"
                      onClick={() => setExpandedSections(s => ({ ...s, [sKey]: !s[sKey] }))}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        <input value={section.title} onChange={e => { e.stopPropagation(); updateSection(sKey, 'title', e.target.value) }}
                          onClick={e => e.stopPropagation()}
                          className="text-sm font-medium bg-transparent border-b border-dashed border-gray-300 focus:outline-none focus:border-pdi-navy w-full sm:w-60 min-h-[32px]" />
                        <select value={section.section_type} onChange={e => updateSection(sKey, 'section_type', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none min-h-[32px] w-full sm:w-auto">
                          {SECTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        {section.optional && <span className="text-xs text-gray-400 italic">optional</span>}
                      </div>
                      <div className="flex items-center justify-end gap-2 flex-shrink-0">
                        <button onClick={e => { e.stopPropagation(); removeSection(sKey) }} className="text-red-400 hover:text-red-600 p-1 min-h-[32px] min-w-[32px] flex items-center justify-center"><Trash2 size={13} /></button>
                        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                      </div>
                    </div>
                    {open && (
                      <div className="p-3">
                        {/* Desktop item table */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-100">
                                <th className="pb-1 text-left text-gray-500 w-8">#</th>
                                {fields.map(f => <th key={f} className="pb-1 text-left text-gray-500 capitalize px-2">{f.replace(/_/g, ' ')}</th>)}
                                <th className="w-6"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {(section.items || []).map((item, idx) => (
                                <tr key={idx} className="border-b border-gray-50">
                                  <td className="py-1 text-gray-400">{item.id || idx + 1}</td>
                                  {fields.map(f => (
                                    <td key={f} className="py-1 px-2">
                                      <input value={item[f] || ''} onChange={e => updateItem(sKey, idx, f, e.target.value)}
                                        className="w-full border border-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pdi-navy text-xs" />
                                    </td>
                                  ))}
                                  <td className="py-1">
                                    <button onClick={() => removeItem(sKey, idx)} className="text-red-400 hover:text-red-600"><X size={12} /></button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {/* Mobile item cards */}
                        <div className="md:hidden space-y-2">
                          {(section.items || []).map((item, idx) => (
                            <div key={idx} className="border border-gray-100 rounded-lg p-2 bg-gray-50/50">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-gray-400 font-mono">#{item.id || idx + 1}</span>
                                <button onClick={() => removeItem(sKey, idx)} className="text-red-400 hover:text-red-600 min-h-[32px] min-w-[32px] flex items-center justify-center">
                                  <X size={14} />
                                </button>
                              </div>
                              <div className="space-y-2">
                                {fields.map(f => (
                                  <div key={f}>
                                    <label className="block text-xs text-gray-500 capitalize mb-0.5">{f.replace(/_/g, ' ')}</label>
                                    <input
                                      value={item[f] || ''}
                                      onChange={e => updateItem(sKey, idx, f, e.target.value)}
                                      className="w-full border border-gray-200 rounded px-2 py-2 focus:outline-none focus:ring-1 focus:ring-pdi-navy text-xs min-h-[36px]"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => addItem(sKey)} className="mt-2 text-xs text-pdi-navy hover:underline flex items-center gap-1 min-h-[32px]"><Plus size={12} /> Add item</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2 border-t border-gray-100">
            <button onClick={cancelEdit} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">Cancel</button>
            <button onClick={creating ? handleCreateTemplate : handleSaveTemplate}
              className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px]">
              <Save size={14} /> {creating ? 'Create Template' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Templates list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Form No', 'Title', 'Component', 'Disposition', 'Revision', 'Active', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(adminTemplates || []).map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-pdi-navy">{t.form_no}</td>
                  <td className="px-4 py-3 text-sm">{t.title}</td>
                  <td className="px-4 py-3 text-sm">{COMPONENT_TYPE_LABELS[t.component_type] || t.component_type}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{t.disposition_type?.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{t.revision || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${t.active ? 'text-green-600' : 'text-gray-400'}`}>{t.active ? 'Yes' : 'No'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => { setEditingId(t.id); setCreating(false); setEditForm(null) }}
                      className="flex items-center gap-1 text-xs text-pdi-navy hover:underline">
                      <Edit2 size={13} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-gray-100">
          {(adminTemplates || []).map(t => (
            <button
              key={t.id}
              onClick={() => { setEditingId(t.id); setCreating(false); setEditForm(null) }}
              className="w-full text-left px-3 py-3 hover:bg-gray-50 active:bg-gray-100 min-h-[44px]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-pdi-navy">{t.form_no}</span>
                    <span className={`text-xs font-medium ${t.active ? 'text-green-600' : 'text-gray-400'}`}>
                      {t.active ? '● Active' : '○ Inactive'}
                    </span>
                  </div>
                  <div className="text-sm text-gray-800 mt-0.5 break-words">{t.title}</div>
                </div>
                <Edit2 size={14} className="text-pdi-navy flex-shrink-0 mt-1" />
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-gray-500">
                <div className="truncate"><span className="text-gray-400">Component:</span> {COMPONENT_TYPE_LABELS[t.component_type] || t.component_type || '—'}</div>
                <div className="truncate"><span className="text-gray-400">Rev:</span> {t.revision || '—'}</div>
                <div className="col-span-2 truncate"><span className="text-gray-400">Disposition:</span> {t.disposition_type?.replace(/_/g, ' ')}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Part Specifications Tab ───────────────────────────────────────────────────

function PartSpecsTab({ showToast }) {
  const { data: templatesData } = useTemplates()
  const templates = templatesData || []
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [editingSpec, setEditingSpec] = useState(null)
  const [specForm, setSpecForm] = useState({ part_number: '', description: '', spec_data: {} })

  // Fetch the FULL template (with sections) when one is selected
  const { data: fullSelectedTemplate } = useQuery({
    queryKey: ['admin-template-full-specs', selectedTemplateId],
    queryFn: async () => {
      const { data } = await api.get(`/admin/templates/${selectedTemplateId}`)
      return data.template
    },
    enabled: !!selectedTemplateId,
  })

  const { data: specsData, isLoading } = usePartSpecs(
    selectedTemplateId ? { template_id: selectedTemplateId } : {}
  )
  const specs = specsData?.specs || []
  const createSpec = useCreatePartSpec()
  const updateSpec = useUpdatePartSpec()
  const deleteSpec = useDeletePartSpec()

  const templateSections = fullSelectedTemplate
    ? (typeof fullSelectedTemplate.sections === 'string'
        ? JSON.parse(fullSelectedTemplate.sections)
        : (fullSelectedTemplate.sections || {}))
    : {}

  const dimItems = Object.entries(templateSections)
    .filter(([k, s]) => k !== '__dimensional_added' && (s.section_type === 'dimensional' || s.section_type === 'general_measurements'))
    .flatMap(([sKey, s]) => (s.items || []).map(item => ({ sKey, item })))

  function startEdit(spec) {
    setEditingSpec(spec.id)
    setSpecForm({
      part_number: spec.part_number,
      description: spec.description || '',
      spec_data: typeof spec.spec_data === 'object' ? { ...spec.spec_data } : {},
    })
  }

  function startCreate() {
    setEditingSpec('new')
    setSpecForm({ part_number: '', description: '', spec_data: {} })
  }

  async function handleSave() {
    if (!specForm.part_number.trim()) {
      showToast('Part number is required', 'error'); return
    }
    try {
      if (editingSpec === 'new') {
        await createSpec.mutateAsync({ template_id: selectedTemplateId, ...specForm })
        showToast('Part spec created', 'success')
      } else {
        await updateSpec.mutateAsync({ id: editingSpec, ...specForm })
        showToast('Part spec updated', 'success')
      }
      setEditingSpec(null)
    } catch (err) {
      showToast(err?.response?.data?.error || 'Save failed', 'error')
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this part specification?')) return
    try {
      await deleteSpec.mutateAsync(id)
      showToast('Deleted', 'success')
    } catch { showToast('Delete failed', 'error') }
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <select value={selectedTemplateId} onChange={e => { setSelectedTemplateId(e.target.value); setEditingSpec(null) }}
          className="w-full sm:w-auto sm:flex-1 sm:max-w-md border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]">
          <option value="">— Select Part Type (Inspection Form) —</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.form_no} — {t.title}</option>)}
        </select>
        {selectedTemplateId && (
          <button onClick={startCreate} className="flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px]">
            <Plus size={15} /> Add Part Spec
          </button>
        )}
      </div>

      {!selectedTemplateId && (
        <div className="text-center text-gray-400 py-8 sm:py-12 text-sm px-4">Select an inspection form to manage part specifications</div>
      )}

      {selectedTemplateId && editingSpec && (
        <div className="bg-white rounded-xl border border-pdi-navy/30 p-3 sm:p-5 shadow-sm space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm sm:text-base font-semibold text-pdi-navy">{editingSpec === 'new' ? 'New Part Specification' : 'Edit Part Specification'}</h3>
            <button onClick={() => setEditingSpec(null)} className="min-h-[40px] min-w-[40px] flex items-center justify-center"><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Part Number <span className="text-red-500">*</span></label>
              <input value={specForm.part_number} onChange={e => setSpecForm(f => ({ ...f, part_number: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
              <input value={specForm.description} onChange={e => setSpecForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
            </div>
          </div>
          {dimItems.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Dimensional Specifications</div>
              <div className="space-y-2">
                {dimItems.map(({ sKey, item }) => {
                  const specKey = `${sKey}.${item.id}`
                  return (
                    <div key={specKey} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                      <span className="text-xs text-gray-600 w-full sm:w-56 truncate">{item.measurement || item.name || `Item ${item.id}`}</span>
                      <input
                        value={specForm.spec_data[specKey] || ''}
                        onChange={e => setSpecForm(f => ({ ...f, spec_data: { ...f.spec_data, [specKey]: e.target.value } }))}
                        placeholder="e.g. 45.00 ± 0.05"
                        className="w-full sm:flex-1 border border-gray-200 rounded-lg px-3 py-2 sm:py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px] sm:min-h-0"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {dimItems.length === 0 && selectedTemplateId && fullSelectedTemplate && (
            <p className="text-xs text-gray-400 italic">No dimensional measurement items defined for this template. Add sections in Inspection Forms first.</p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2 border-t border-gray-100">
            <button onClick={() => setEditingSpec(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">Cancel</button>
            <button onClick={handleSave} className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px]">
              <Save size={14} /> Save
            </button>
          </div>
        </div>
      )}

      {selectedTemplateId && !editingSpec && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? <div className="text-center text-gray-400 py-8 sm:py-10">Loading…</div> :
            specs.length === 0 ? <div className="text-center text-gray-400 py-8 sm:py-10 px-4 text-sm">No part specifications for this form type</div> : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {['Part Number', 'Description', 'Specs Defined', ''].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {specs.map(spec => (
                        <tr key={spec.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-sm font-semibold text-pdi-navy">{spec.part_number}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{spec.description || '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{Object.keys(spec.spec_data || {}).length} fields</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <button onClick={() => startEdit(spec)} className="text-xs text-pdi-navy hover:underline flex items-center gap-1"><Edit2 size={12} /> Edit</button>
                              <button onClick={() => handleDelete(spec.id)} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1"><Trash2 size={12} /> Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile card list */}
                <div className="md:hidden divide-y divide-gray-100">
                  {specs.map(spec => (
                    <div key={spec.id} className="px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-sm font-semibold text-pdi-navy truncate">{spec.part_number}</div>
                          <div className="text-xs text-gray-600 mt-0.5 break-words">{spec.description || '—'}</div>
                          <div className="text-xs text-gray-500 mt-1">{Object.keys(spec.spec_data || {}).length} fields defined</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <button onClick={() => startEdit(spec)} className="text-sm text-pdi-navy hover:underline flex items-center gap-1 min-h-[36px]">
                          <Edit2 size={13} /> Edit
                        </button>
                        <button onClick={() => handleDelete(spec.id)} className="text-sm text-red-500 hover:text-red-600 flex items-center gap-1 min-h-[36px]">
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          }
        </div>
      )}
    </div>
  )
}

// ── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab({ showToast }) {
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [creating, setCreating] = useState(false)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data } = await api.get('/admin/users?include_inactive=true')
      return data.users || []
    },
  })

  function startEdit(user) {
    setEditingId(user.id)
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
    })
  }

  function startCreate() {
    setCreating(true)
    setEditForm({
      name: '',
      email: '',
      role: 'inspector',
      password: '',
      active: 1,
    })
  }

  async function handleSave() {
    if (!editForm.name?.trim() || !editForm.email?.trim()) {
      showToast('Name and email are required', 'error')
      return
    }
    try {
      if (creating) {
        if (!editForm.password?.trim()) {
          showToast('Password is required for new users', 'error')
          return
        }
        await api.post('/admin/users', editForm)
        showToast('User created', 'success')
      } else {
        await api.patch(`/admin/users/${editingId}`, editForm)
        showToast('User updated', 'success')
      }
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      setEditingId(null)
      setCreating(false)
      setEditForm(null)
    } catch (err) {
      showToast(err?.response?.data?.error || 'Save failed', 'error')
    }
  }

  async function handleToggleActive(user) {
    try {
      await api.patch(`/admin/users/${user.id}`, { active: user.active ? 0 : 1 })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      showToast(user.active ? 'User deactivated' : 'User activated', 'success')
    } catch (err) {
      showToast('Toggle failed', 'error')
    }
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex justify-end">
        <button onClick={startCreate} className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px]">
          <Plus size={15} /> New User
        </button>
      </div>

      {(editingId || creating) && (
        <div className="bg-white rounded-xl border border-pdi-navy/30 p-3 sm:p-6 space-y-4 sm:space-y-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm sm:text-base font-semibold text-pdi-navy">{creating ? 'Create User' : 'Edit User'}</h3>
            <button onClick={() => { setEditingId(null); setCreating(false); setEditForm(null) }} className="text-gray-400 hover:text-gray-600 min-h-[40px] min-w-[40px] flex items-center justify-center"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Name <span className="text-red-500">*</span></label>
              <input value={editForm?.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email <span className="text-red-500">*</span></label>
              <input type="email" value={editForm?.email || ''} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
              <select value={editForm?.role || 'inspector'} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none min-h-[40px]">
                <option value="inspector">Inspector</option>
                <option value="qc_manager">QC Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {creating && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Password <span className="text-red-500">*</span></label>
                <input type="password" value={editForm?.password || ''} onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
              </div>
            )}
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2 border-t border-gray-100">
            <button onClick={() => { setEditingId(null); setCreating(false); setEditForm(null) }} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">Cancel</button>
            <button onClick={handleSave} className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px]">
              <Save size={14} /> Save
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="text-center text-gray-400 py-12">Loading…</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['Name', 'Email', 'Role', 'Active', 'Created', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{user.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{user.email}</td>
                      <td className="px-4 py-3 text-sm capitalize">{user.role?.replace('_', ' ')}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${user.active ? 'text-green-600' : 'text-gray-400'}`}>{user.active ? 'Yes' : 'No'}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(user.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button onClick={() => startEdit(user)} className="text-xs text-pdi-navy hover:underline"><Edit2 size={13} className="inline mr-1" /> Edit</button>
                          <button onClick={() => handleToggleActive(user)} className="text-xs text-gray-400 hover:text-gray-600">{user.active ? 'Deactivate' : 'Activate'}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-gray-100">
              {users.map(user => (
                <div key={user.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="font-medium text-gray-800">{user.name}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{user.email}</div>
                    </div>
                    <span className={`text-xs font-medium ${user.active ? 'text-green-600' : 'text-gray-400'}`}>{user.active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <div className="text-xs text-gray-500 mb-2 capitalize">Role: {user.role?.replace('_', ' ')}</div>
                  <div className="flex gap-3">
                    <button onClick={() => startEdit(user)} className="text-sm text-pdi-navy min-h-[36px]"><Edit2 size={13} className="inline mr-1" /> Edit</button>
                    <button onClick={() => handleToggleActive(user)} className="text-sm text-gray-600 min-h-[36px]">{user.active ? 'Deactivate' : 'Activate'}</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Drawings Tab ──────────────────────────────────────────────────────────────

function DrawingsTab({ showToast }) {
  const qc = useQueryClient()
  const [partNumber, setPartNumber] = useState('')
  const [uploadForm, setUploadForm] = useState({ version: '', notes: '' })
  const [uploading, setUploading] = useState(false)

  const { data: drawings = [] } = useDrawings(partNumber)
  const uploadDrawing = useUploadDrawing()
  const setCurrentDrawing = useSetCurrentDrawing()
  const deleteDrawing = useDeleteDrawing()

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !partNumber.trim() || !uploadForm.version.trim()) {
      showToast('Part number, version, and file are required', 'error')
      return
    }
    setUploading(true)
    try {
      await uploadDrawing.mutateAsync({ partNumber, version: uploadForm.version, notes: uploadForm.notes, file })
      showToast('Drawing uploaded', 'success')
      setUploadForm({ version: '', notes: '' })
      e.target.value = ''
    } catch (err) {
      showToast(err?.response?.data?.error || 'Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleSetCurrent(id) {
    try {
      await setCurrentDrawing.mutateAsync({ id, partNumber })
      showToast('Drawing set as current', 'success')
    } catch (err) {
      showToast('Failed to set current', 'error')
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this drawing?')) return
    try {
      await deleteDrawing.mutateAsync({ id, partNumber })
      showToast('Drawing deleted', 'success')
    } catch (err) {
      showToast('Delete failed', 'error')
    }
  }

  const currentDrawing = drawings.find(d => d.is_current)

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Part number search */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Part Number</label>
        <input
          type="text"
          placeholder="Search or enter part number…"
          value={partNumber}
          onChange={e => setPartNumber(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
        />
      </div>

      {partNumber && (
        <>
          {/* Current drawing */}
          {currentDrawing && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Current Drawing</h3>
              <div className="flex items-center justify-between gap-3 p-3 bg-pdi-frost rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-bold text-pdi-navy">{currentDrawing.file_name}</div>
                  <div className="text-xs text-gray-600 mt-1">v{currentDrawing.version} • {currentDrawing.uploaded_by_name} • {formatDate(currentDrawing.created_at)}</div>
                </div>
                <a
                  href={`/api/drawings/download/${currentDrawing.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex-shrink-0 min-h-[40px]"
                >
                  <Download size={14} /> Download
                </a>
              </div>
            </div>
          )}

          {/* Upload form */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Upload New Version</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Version</label>
                  <input
                    type="text"
                    value={uploadForm.version}
                    onChange={e => setUploadForm(f => ({ ...f, version: e.target.value }))}
                    placeholder="e.g., 1.0"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <input
                    type="text"
                    value={uploadForm.notes}
                    onChange={e => setUploadForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Optional notes…"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">File (PDF or image)</label>
                <input
                  type="file"
                  accept=".pdf,image/*"
                  onChange={handleUploadDrawing}
                  disabled={uploading || !uploadForm.version}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-pdi-navy file:text-white hover:file:bg-pdi-navy-light disabled:opacity-50"
                />
                {!uploadForm.version && (
                  <p className="text-xs text-amber-600 mt-1">Enter a version number before selecting a file.</p>
                )}
              </div>
              {uploading && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 size={14} className="animate-spin" />
                  Uploading…
                </div>
              )}
            </div>
          </div>

          {/* All versions */}
          {drawings.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-800">All Versions ({drawings.length})</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {drawings.map(d => (
                  <div key={d.id} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-pdi-navy">{d.file_name}</span>
                        {d.is_current ? (
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">Current</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">v{d.version} • {d.notes || 'No notes'} • {formatDate(d.created_at)}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!d.is_current && (
                        <button
                          onClick={() => handleSetCurrent(d.id)}
                          className="px-2.5 py-1.5 text-xs text-pdi-navy border border-pdi-navy/30 rounded-lg hover:bg-pdi-frost transition-colors min-h-[32px]"
                        >
                          Set Current
                        </button>
                      )}
                      <a
                        href={`/api/drawings/download/${d.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-pdi-navy hover:bg-gray-100 transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
                        title="Download"
                      >
                        <Download size={14} />
                      </a>
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {drawings.length === 0 && !isLoadingDrawings && (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No drawings found for this part number.
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main Admin page ───────────────────────────────────────────────────────────

export default function Admin() {
  const [activeTab, setActiveTab] = useState('forms')
  const navigate = useNavigate()

  return (
    <div className="min-h-full bg-gray-50/50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center gap-3">
          <Settings size={20} className="text-pdi-navy flex-shrink-0" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy">Admin</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Manage templates, users, and system data</p>
          </div>
        </div>
        {/* Tab bar */}
        <div className="mt-4 flex gap-1 overflow-x-auto pb-0.5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 min-h-[40px] ${
                activeTab === tab.id
                  ? 'bg-pdi-navy text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <tab.icon size={15} />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {activeTab === 'forms' && <FormsTab />}
        {activeTab === 'specs' && <SpecsTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'drawings' && <DrawingsTab />}
        {activeTab === 'data' && <DataTab navigate={navigate} />}
      </div>
    </div>
  )
}
