import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Save, CheckSquare, ChevronDown, ChevronUp, Paperclip, PlusCircle, X, Printer, Mail, Loader2 } from 'lucide-react'
import api from '../lib/api'
import { useInspection } from '../hooks/useInspections'
import { useTemplate } from '../hooks/useTemplates'
import { useUpdateInspection, useCompleteInspection } from '../hooks/useInspections'
import { useAttachments, useUploadAttachment, useDeleteAttachment } from '../hooks/useAttachments'
import { useToast } from '../hooks/useToast'
import StatusBadge from '../components/StatusBadge'
import SectionReceiving from '../components/inspection/SectionReceiving'
import SectionVisual from '../components/inspection/SectionVisual'
import SectionDimensional from '../components/inspection/SectionDimensional'
import SectionChecklist from '../components/inspection/SectionChecklist'
import SectionGeneralMeasurements from '../components/inspection/SectionGeneralMeasurements'
import SectionCamshaftBore from '../components/inspection/SectionCamshaftBore'
import SectionFireRingProtrusion from '../components/inspection/SectionFireRingProtrusion'
import SectionValveRecession from '../components/inspection/SectionValveRecession'
import SectionVacuumTest from '../components/inspection/SectionVacuumTest'
import FileUploadZone from '../components/FileUploadZone'
import { initSectionData, mergeSectionData, formatFileSize } from '../lib/utils'
import { DISPOSITION_COLORS, HEADER_FIELD_LABELS } from '../lib/constants'

const SECTION_COMPONENTS = {
  pfn_checklist: SectionReceiving,
  pfn_visual: SectionVisual,
  dimensional: SectionDimensional,
  pass_fail_checklist: SectionChecklist,
  general_measurements: SectionGeneralMeasurements,
  camshaft_bore: SectionCamshaftBore,
  fire_ring_protrusion: SectionFireRingProtrusion,
  valve_recession: SectionValveRecession,
  vacuum_test: SectionVacuumTest,
}

// Section types that support per-item image attachments
const IMAGE_ENABLED_SECTIONS = new Set(['pfn_checklist', 'pass_fail_checklist'])

function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 bg-pdi-frost hover:bg-pdi-steel/30 transition-colors min-h-[48px]"
      >
        <span className="text-sm sm:text-base font-semibold text-pdi-navy text-left truncate pr-2">{title}</span>
        {open ? <ChevronUp size={16} className="text-pdi-navy flex-shrink-0" /> : <ChevronDown size={16} className="text-pdi-navy flex-shrink-0" />}
      </button>
      {open && <div className="p-3 sm:p-5">{children}</div>}
    </div>
  )
}

export default function InspectionForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo') || '/inspections'
  const { showToast } = useToast()

  const { data: inspection, isLoading: loadingInsp } = useInspection(id)
  const { data: template, isLoading: loadingTpl } = useTemplate(inspection?.template_id)
  const { data: attachments = [] } = useAttachments(id)

  const update = useUpdateInspection()
  const complete = useCompleteInspection()
  const uploadFile = useUploadAttachment()
  const deleteFile = useDeleteAttachment()

  const [sectionData, setSectionData] = useState({})
  const [disposition, setDisposition] = useState('')
  const [dispositionNotes, setDispositionNotes] = useState('')
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [uploadingKey, setUploadingKey] = useState(null) // "${sectionKey}_${itemId}"
  const [dimensionalAdded, setDimensionalAdded] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const saveTimer = useRef(null)
  const initialLoad = useRef(true)

  // Initialize section data when template and inspection are loaded
  useEffect(() => {
    if (!template || !inspection) return
    const sections = typeof template.sections === 'string'
      ? JSON.parse(template.sections)
      : template.sections
    const fresh = initSectionData(sections)
    const saved = typeof inspection.section_data === 'string'
      ? JSON.parse(inspection.section_data || '{}')
      : (inspection.section_data || {})
    setSectionData(mergeSectionData(saved, fresh))
    setDisposition(inspection.disposition || '')
    setDispositionNotes(inspection.disposition_notes || '')
    // Restore dimensional state for cylinder head forms
    if (saved.__dimensional_added) setDimensionalAdded(true)
    initialLoad.current = false
  }, [template?.id, inspection?.id])

  // Auto-save with debounce
  const debouncedSave = useCallback(() => {
    if (initialLoad.current) return
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await update.mutateAsync({
          id,
          section_data: sectionData,
          disposition,
          disposition_notes: dispositionNotes,
        })
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2000)
      } catch {
        setSaveState('error')
      }
    }, 600)
  }, [id, sectionData, disposition, dispositionNotes])

  useEffect(() => {
    if (!initialLoad.current) debouncedSave()
  }, [sectionData, disposition, dispositionNotes])

  function handleAddDimensional() {
    setDimensionalAdded(true)
    setSectionData(d => ({ ...d, __dimensional_added: true }))
  }

  // Upload a general (non-item) attachment
  async function handleUpload(files) {
    for (const file of files) {
      try {
        await uploadFile.mutateAsync({ inspectionId: id, file })
      } catch {
        showToast(`Failed to upload ${file.name}`, 'error')
      }
    }
  }

  // Upload an image for a specific inspection item
  async function handleItemUpload(file, sectionKey, itemId) {
    const key = `${sectionKey}_${itemId}`
    setUploadingKey(key)
    try {
      await uploadFile.mutateAsync({ inspectionId: id, file, sectionKey, itemId })
    } catch {
      showToast(`Failed to upload image for item #${itemId}`, 'error')
    } finally {
      setUploadingKey(null)
    }
  }

  async function handleDownloadPdf() {
    setPdfLoading(true)
    try {
      const response = await api.get(`/inspections/${id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      const po = inspection.po_number ? inspection.po_number.replace(/[^a-zA-Z0-9-]/g, '') : 'NO-PO'
      const part = inspection.part_number ? inspection.part_number.replace(/[^a-zA-Z0-9-]/g, '') : 'NO-PART'
      a.download = `QC-${po}-${part}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to generate PDF', 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  function handleEmail() {
    const subject = encodeURIComponent(`PDI Inspection ${inspection.form_no} — ${inspection.part_number || 'No part #'}`)
    const body = encodeURIComponent(
      `Please review the following inspection:\n\nForm: ${inspection.form_no}\nPart Number: ${inspection.part_number || '—'}\nPO Number: ${inspection.po_number || '—'}\nInspector: ${inspection.inspector_name || '—'}\n\nView at: ${window.location.origin}/inspections/${id}`
    )
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  async function handleDeleteFile(attachmentId) {
    try {
      await deleteFile.mutateAsync({ id: attachmentId, inspectionId: id })
    } catch {
      showToast('Failed to delete file', 'error')
    }
  }

  async function handleComplete() {
    if (!disposition) {
      showToast('Please set a Final Result before completing', 'error')
      return
    }

    const sections = typeof template.sections === 'string' ? JSON.parse(template.sections) : template.sections
    const failErrors = []
    for (const [key, section] of Object.entries(sections)) {
      const sectionArr = Array.isArray(sectionData[key]) ? sectionData[key] : []
      if (section.section_type === 'pass_fail_checklist') {
        for (const row of sectionArr) {
          if (row.fail) {
            const hasImg = attachments.some(a => a.section_key === key && String(a.item_id) === String(row.id))
            if (!hasImg || !row.notes?.trim()) failErrors.push(`"${section.title}" — Item #${row.id}`)
          }
        }
      }
      if (section.section_type === 'pfn_checklist') {
        for (const row of sectionArr) {
          if (row.status === 'F') {
            const hasImg = attachments.some(a => a.section_key === key && String(a.item_id) === String(row.id))
            if (!hasImg || !row.finding?.trim()) failErrors.push(`"${section.title}" — Item #${row.id}`)
          }
        }
      }
    }

    if (failErrors.length > 0) {
      const extra = failErrors.length > 1 ? ` (+${failErrors.length - 1} more)` : ''
      showToast(`Failed items require an image and description: ${failErrors[0]}${extra}`, 'error')
      return
    }

    clearTimeout(saveTimer.current)
    try {
      await update.mutateAsync({ id, section_data: sectionData, disposition, disposition_notes: dispositionNotes })
      await complete.mutateAsync(id)
      showToast('Inspection completed', 'success')
      navigate(`/inspections/${id}`)
    } catch (err) {
      showToast(err?.response?.data?.error || err.message || 'Complete failed', 'error')
    }
  }

  if (loadingInsp || loadingTpl) {
    return <div className="p-6 text-gray-400">Loading inspection…</div>
  }

  if (!inspection || !template) {
    return <div className="p-6 text-red-500">Inspection not found</div>
  }

  if (inspection.status !== 'draft') {
    navigate(`/inspections/${id}`)
    return null
  }

  const sections = typeof template.sections === 'string'
    ? JSON.parse(template.sections)
    : template.sections

  const dispositionOptions = template.disposition_type === 'accept_reject_conditional'
    ? ['ACCEPT', 'REJECT', 'CONDITIONAL']
    : ['PASS', 'FAIL']

  const headerFields = typeof template.header_schema === 'string'
    ? JSON.parse(template.header_schema)
    : template.header_schema

  // Count item-level attachments (non-general)
  const itemAttachmentCount = attachments.filter(a => a.section_key).length
  const generalAttachments = attachments.filter(a => !a.section_key)

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header — stacks title line + actions on mobile */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm flex-shrink-0">
        {/* Title line */}
        <div className="px-4 sm:px-6 pt-2 sm:pt-3 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs sm:text-sm font-bold text-pdi-navy">{template.form_no}</span>
          <span className="text-gray-400 text-xs sm:text-sm">·</span>
          <span className="text-xs sm:text-sm text-gray-700 truncate max-w-[50%] sm:max-w-none">{inspection.part_number || 'No part #'}</span>
          {inspection.po_number && (
            <>
              <span className="text-gray-400 text-xs sm:text-sm hidden sm:inline">·</span>
              <span className="text-xs sm:text-sm text-gray-500 hidden sm:inline">PO {inspection.po_number}</span>
            </>
          )}
          <StatusBadge status={inspection.status} />
          <span className={`text-xs ml-auto ${saveState === 'saving' ? 'text-gray-400' : saveState === 'saved' ? 'text-green-600' : saveState === 'error' ? 'text-red-500' : 'text-transparent'}`}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? 'Save failed' : '·'}
          </span>
        </div>
        {/* Action bar — horizontally scrollable on very narrow screens */}
        <div className="px-4 sm:px-6 py-2 sm:py-3 flex items-center gap-1.5 sm:gap-2 overflow-x-auto">
          <button
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            title="Print / PDF"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 active:bg-purple-800 disabled:opacity-50 flex-shrink-0 min-h-[40px]"
          >
            {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            <span className="hidden sm:inline">Print</span>
          </button>
          <button
            onClick={handleEmail}
            title="Email"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-sm bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 active:bg-indigo-700 flex-shrink-0 min-h-[40px]"
          >
            <Mail size={14} />
            <span className="hidden sm:inline">Email</span>
          </button>
          <button
            onClick={() => debouncedSave()}
            title="Save"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light active:bg-pdi-navy flex-shrink-0 min-h-[40px]"
          >
            <Save size={14} />
            <span className="hidden sm:inline">Save</span>
          </button>
          <button
            onClick={handleComplete}
            disabled={!disposition || complete.isPending}
            title={complete.isPending ? 'Completing…' : (
              Object.values(sections).some(s => s.optional) && !dimensionalAdded
                ? 'Complete (Visual Only)'
                : 'Complete'
            )}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-sm bg-pdi-teal text-white rounded-lg hover:bg-teal-700 active:bg-teal-800 disabled:opacity-40 flex-shrink-0 min-h-[40px]"
          >
            <CheckSquare size={14} />
            <span className="hidden sm:inline">{complete.isPending ? 'Completing…' : (
              Object.values(sections).some(s => s.optional) && !dimensionalAdded
                ? 'Complete (Visual Only)'
                : 'Complete'
            )}</span>
          </button>
          <button
            onClick={() => navigate(returnTo)}
            title="Close"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 active:bg-gray-200 flex-shrink-0 min-h-[40px] ml-auto sm:ml-0"
          >
            <X size={14} />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1440px] mx-auto p-3 sm:p-6 space-y-3 sm:space-y-4">

          {/* Header fields (read-only summary) */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h2 className="text-sm sm:text-base font-semibold text-gray-700 mb-3">Inspection Details</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-2 sm:gap-y-3">
              {headerFields.map(field => (
                inspection[field] && (
                  <div key={field} className="min-w-0">
                    <div className="text-xs text-gray-400 truncate">{HEADER_FIELD_LABELS[field] || field}</div>
                    <div className="text-sm sm:text-base font-medium text-gray-800 truncate">{inspection[field]}</div>
                  </div>
                )
              ))}
            </div>
          </div>

          {/* Inspection sections */}
          {Object.entries(sections).map(([key, section]) => {
            if (key === '__dimensional_added') return null
            // Skip optional sections unless dimensional has been added
            if (section.optional && !dimensionalAdded) return null
            const Component = SECTION_COMPONENTS[section.section_type]
            if (!Component) return null
            const supportsImages = IMAGE_ENABLED_SECTIONS.has(section.section_type)
            return (
              <CollapsibleSection key={key} title={section.title}>
                <Component
                  section={section}
                  data={sectionData[key]}
                  onChange={val => setSectionData(d => ({ ...d, [key]: val }))}
                  {...(supportsImages ? {
                    sectionKey: key,
                    attachments,
                    onUploadItem: handleItemUpload,
                    onDeleteItem: handleDeleteFile,
                    uploadingKey,
                  } : {})}
                />
              </CollapsibleSection>
            )
          })}

          {/* Add Dimensional button — shown for combined forms that have optional sections */}
          {!dimensionalAdded && Object.values(sections).some(s => s.optional) && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={handleAddDimensional}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-2 border-dashed border-pdi-navy/40 text-pdi-navy rounded-xl hover:border-pdi-navy hover:bg-pdi-frost transition-all"
              >
                <PlusCircle size={16} />
                Add Dimensional Inspection
              </button>
            </div>
          )}

          {/* Final Results */}
          <CollapsibleSection title="Final Results">
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3">
                {dispositionOptions.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setDisposition(d => d === opt ? '' : opt)}
                    className={`px-4 sm:px-6 py-3 text-sm font-bold rounded-lg border-2 transition-all min-h-[48px] ${
                      disposition === opt
                        ? DISPOSITION_COLORS[opt] || 'bg-blue-100 text-blue-700 border-blue-400'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                rows={3}
                placeholder="Disposition notes (optional)…"
                value={dispositionNotes}
                onChange={e => setDispositionNotes(e.target.value)}
              />
            </div>
          </CollapsibleSection>

          {/* General Attachments */}
          <CollapsibleSection title={`General Attachments (${generalAttachments.length})${itemAttachmentCount > 0 ? ` · ${itemAttachmentCount} item image${itemAttachmentCount !== 1 ? 's' : ''}` : ''}`}>
            <div className="space-y-3">
              <FileUploadZone onUpload={handleUpload} />
              {generalAttachments.length > 0 && (
                <div className="space-y-2">
                  {generalAttachments.map(att => (
                    <div key={att.id} className="flex items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Paperclip size={14} className="text-gray-400 flex-shrink-0" />
                        <a
                          href={`/api/attachments/download/${att.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-pdi-navy hover:underline truncate"
                        >
                          {att.file_name}
                        </a>
                        <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">{formatFileSize(att.file_size_bytes)}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteFile(att.id)}
                        className="text-xs text-red-400 hover:text-red-600 flex-shrink-0 px-2 py-1 min-h-[32px]"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CollapsibleSection>

        </div>
      </div>
    </div>
  )
}
