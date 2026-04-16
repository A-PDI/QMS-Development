import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTemplates } from '../hooks/useTemplates'
import { useCreateInspection } from '../hooks/useInspections'
import { useToast } from '../hooks/useToast'
import { getUser } from '../lib/auth'
import { X } from 'lucide-react'

const FIELD_CONFIG = [
  { key: 'po_number',      label: 'PO Number',         required: true,  type: 'text' },
  { key: 'lot_serial_no',  label: 'Lot / Serial No.',  required: false, type: 'text' },
  { key: 'part_number',    label: 'Part Number',        required: true,  type: 'text' },
  { key: 'description',    label: 'Part Description',   required: false, type: 'text', wide: true },
  { key: 'date_received',  label: 'Date Received',      required: true,  type: 'date' },
  { key: 'inspector_name', label: 'Inspector Name',     required: true,  type: 'text' },
]

export default function NewInspection() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { data: templates = [], isLoading } = useTemplates()
  const create = useCreateInspection()

  const currentUser = getUser()
  const [templateId, setTemplateId] = useState('')
  const [form, setForm] = useState({ inspector_name: currentUser?.name || '' })
  const [submitting, setSubmitting] = useState(false)

  // Close on Escape key
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') navigate(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  async function handleCreate(e) {
    e.preventDefault()
    if (!templateId) {
      showToast('Please select a Part Type', 'error')
      return
    }
    setSubmitting(true)
    try {
      const inspection = await create.mutateAsync({ template_id: templateId, ...form })
      navigate(`/inspections/${inspection.id}/edit`)
    } catch (err) {
      showToast(err?.response?.data?.error || err.message || 'Failed to create inspection', 'error')
      setSubmitting(false)
    }
  }

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

          {/* Part Type dropdown */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Part Type <span className="text-red-400">*</span>
            </label>
            {isLoading ? (
              <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ) : (
              <select
                required
                value={templateId}
                onChange={e => setTemplateId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy bg-white min-h-[40px]"
              >
                <option value="">— Select inspection form —</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.form_no} · {t.title.replace('PDI Incoming Quality Inspection — ', '')}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Other header fields — single column on mobile, two columns on sm+ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELD_CONFIG.map(({ key, label, required, type, wide }) => (
              <div key={key} className={wide ? 'sm:col-span-2' : ''}>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  {label}
                  {required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <input
                  type={type}
                  required={required}
                  value={form[key] || ''}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy min-h-[40px]"
                />
              </div>
            ))}
          </div>

          {/* Actions — stack on very narrow screens */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || isLoading}
              className="px-5 py-2.5 text-sm font-semibold bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy/90 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {submitting ? 'Starting…' : 'Start Inspection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
