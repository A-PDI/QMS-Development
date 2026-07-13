import { useState, useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useTemplates } from '../hooks/useTemplates'
import { useCreateInspection } from '../hooks/useInspections'
import { useToast } from '../hooks/useToast'
import { getUser } from '../lib/auth'
import { X, Wrench } from 'lucide-react'
import PartNumberCombobox from '../components/PartNumberCombobox'

// Part Number, Part Description and Part Type are rendered first (in that
// order) as a dedicated lookup block. The remaining header fields follow.
const FIELD_CONFIG = [
  { key: 'po_number',      label: 'PO Number',         required: true,  type: 'text' },
  { key: 'lot_serial_no',  label: 'Lot / Serial No.',  required: false, type: 'text' },
  { key: 'date_received',  label: 'Date Received',      required: true,  type: 'date' },
  { key: 'inspector_name', label: 'Inspector Name',     required: true,  type: 'text' },
]

// Sentinel Part Type value for a one-off Miscellaneous inspection, and the
// form number of the hidden base template it uses (hidden from the dropdown).
const MISC_OPTION = '__misc'
const MISC_FORM_NO = 'PDI-IQI-MISC'

export default function NewInspection() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { data: templates = [], isLoading } = useTemplates()
  const create = useCreateInspection()

  const currentUser = getUser()
  // Check if user is allowed to create new inspections
  const isAdminRole = currentUser && (currentUser.role === 'admin' || currentUser.role === 'qc_manager')
  const userPerms = (() => {
    try { return currentUser?.permissions ? JSON.parse(currentUser.permissions) : null } catch { return null }
  })()
  const canCreateNew = isAdminRole || !userPerms || (Array.isArray(userPerms?.tabs) && userPerms.tabs.includes('new_inspection'))
  const [templateId, setTemplateId] = useState('')
  const [form, setForm] = useState({ inspector_name: currentUser?.name || '', item_count: 1 })
  const [submitting, setSubmitting] = useState(false)
  // Tracks which fields were auto-filled from a known part number (for hints).
  const [autoFilled, setAutoFilled] = useState({ description: false, template: false })

  // Close on Escape key
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') navigate(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  // When a known part number is chosen from the combobox, auto-fill the
  // Part Description and the Part Type (product type) from the catalogue.
  function handlePartSelect(rec) {
    const filledDesc = !!rec.description
    setForm(f => ({
      ...f,
      part_number: rec.part_number,
      description: rec.description || f.description || '',
    }))
    let filledTemplate = false
    if (rec.template_id) {
      const match = templates.find(t => t.id === rec.template_id)
      if (match) { setTemplateId(rec.template_id); filledTemplate = true }
    }
    setAutoFilled({ description: filledDesc, template: filledTemplate })
  }

  // Typing in the part-number box invalidates prior auto-fill hints.
  function handlePartNumberChange(val) {
    setForm(f => ({ ...f, part_number: val }))
    if (autoFilled.description || autoFilled.template) {
      setAutoFilled({ description: false, template: false })
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!templateId) {
      showToast('Please select a Part Type', 'error')
      return
    }
    // Miscellaneous / one-off inspection: hand off the header details to the
    // builder, where the inspector assembles the sections and items on the fly.
    if (templateId === MISC_OPTION) {
      const itemCount = Math.min(100, Math.max(1, parseInt(form.item_count, 10) || 1))
      navigate('/inspections/new/misc', { state: { form: { ...form, item_count: itemCount } } })
      return
    }
    setSubmitting(true)
    try {
      const itemCount = Math.min(100, Math.max(1, parseInt(form.item_count, 10) || 1))
      const inspection = await create.mutateAsync({ template_id: templateId, ...form, item_count: itemCount })
      navigate(`/inspections/${inspection.id}/edit`)
    } catch (err) {
      showToast(err?.response?.data?.error || err.message || 'Failed to create inspection', 'error')
      setSubmitting(false)
    }
  }

  // Redirect restricted users away before rendering
  if (!canCreateNew) return <Navigate to='/my-inspections' replace />

  return (
    /* Full-screen backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) navigate(-1) }}
    >
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg sm:mx-4 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">

        {/* Modal header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-gray-900">New Inspection</h2>
            <p className="text-xs text-gray-500 mt-0.5">Enter inspection details to begin</p>
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Close"
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleCreate} className="px-4 sm:px-6 py-4 sm:py-5 space-y-4">

          {/* 1) Part Number — primary field, drives auto-fill */}
          <div>
            <label htmlFor="field-part_number" className="block text-xs font-semibold text-gray-700 mb-1">
              Part Number <span className="text-red-400">*</span>
            </label>
            <PartNumberCombobox
              id="field-part_number"
              required
              value={form.part_number || ''}
              onChange={handlePartNumberChange}
              onSelect={handlePartSelect}
            />
          </div>

          {/* 2) Part Description — auto-filled from a known part number */}
          <div>
            <label htmlFor="field-description" className="block text-xs font-semibold text-gray-700 mb-1">
              Part Description
              {autoFilled.description && (
                <span className="ml-1.5 text-[10px] font-medium text-pdi-navy">· auto-filled</span>
              )}
            </label>
            <input
              id="field-description"
              type="text"
              value={form.description || ''}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy min-h-[40px]"
            />
          </div>

          {/* 3) Part Type — auto-filled when the part number is in the catalogue */}
          <div>
            <label htmlFor="field-part_type" className="block text-xs font-semibold text-gray-700 mb-1">
              Part Type <span className="text-red-400">*</span>
              {autoFilled.template && (
                <span className="ml-1.5 text-[10px] font-medium text-pdi-navy">· auto-filled</span>
              )}
            </label>
            {isLoading ? (
              <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ) : (
              <select
                id="field-part_type"
                required
                value={templateId}
                onChange={e => { setTemplateId(e.target.value); setAutoFilled(a => ({ ...a, template: false })) }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy bg-white min-h-[40px]"
              >
                <option value="">— Select inspection form —</option>
                {templates
                  .filter(t => t.form_no !== MISC_FORM_NO)
                  .map(t => (
                    <option key={t.id} value={t.id}>
                      {t.form_no} · {t.title.replace('PDI Incoming Quality Inspection — ', '')}
                    </option>
                  ))}
                <option value={MISC_OPTION}>Miscellaneous — one-off inspection</option>
              </select>
            )}
          </div>

          {/* Admin: Build Custom Form link */}
          {isAdminRole && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-pdi-frost border border-pdi-navy/10">
              <Wrench size={14} className="text-pdi-navy/60 flex-shrink-0" />
              <span className="text-xs text-gray-600 flex-1">Need a form for a new part type?</span>
              <button
                type="button"
                onClick={() => navigate('/inspections/new/custom')}
                className="text-xs font-semibold text-pdi-navy hover:underline flex-shrink-0"
              >
                Build Custom Form →
              </button>
            </div>
          )}

          {/* Number of Items — how many items this inspection covers */}
          <div>
            <label htmlFor="field-item_count" className="block text-xs font-semibold text-gray-700 mb-1">
              Number of Items <span className="text-red-400">*</span>
            </label>
            <input
              id="field-item_count"
              type="number"
              min={1}
              max={100}
              step={1}
              required
              value={form.item_count}
              onChange={e => setForm(f => ({ ...f, item_count: e.target.value }))}
              onBlur={e => {
                const n = Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1))
                setForm(f => ({ ...f, item_count: n }))
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy min-h-[40px]"
            />
            <p className="mt-1 text-[11px] text-gray-500">A separate inspection form is created for each item; the header stays the same.</p>
          </div>

          {/* Remaining header fields — single column on mobile, two columns on sm+ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELD_CONFIG.map(({ key, label, required, type, wide }) => (
              <div key={key} className={wide ? 'sm:col-span-2' : ''}>
                <label htmlFor={`field-${key}`} className="block text-xs font-semibold text-gray-700 mb-1">
                  {label}
                  {required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <input
                  id={`field-${key}`}
                  type={type}
                  required={required}
                  value={form[key] || ''}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy min-h-[40px]"
                />
              </div>
            ))}
          </div>

          {/* Actions — stack on very narrow screens, row on sm+ */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light disabled:opacity-50 transition-colors min-h-[44px] font-medium"
            >
              {submitting ? 'Creating…' : 'Start Inspection'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}