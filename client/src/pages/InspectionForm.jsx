import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Save, CheckSquare, ChevronDown, ChevronUp, Paperclip, PlusCircle, X, Printer, Mail, Loader2, AlertTriangle, Bell } from 'lucide-react'
import api from '../lib/api'
import { getUser } from '../lib/auth'
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

// All section types now support per-item images
const IMAGE_ENABLED_SECTIONS = new Set(Object.keys(SECTION_COMPONENTS))

// Detect any item in section_data marked Accepted ('A')
function detectAcceptedItems(sectionData) {
  for (const [key, data] of Object.entries(sectionData)) {
    if (key.startsWith('__')) continue
    if (Array.isArray(data)) {
      for (const row of data) {
        if (row.status === 'A' || row.result === 'A') return true
      }
    } else if (data && typeof data === 'object') {
      if (data.result === 'A') return true
      if (Array.isArray(data.bores)) {
        for (const b of data.bores) { if (b && b.result === 'A') return true }
      }
      if (Array.isArray(data.cylinders)) {
        for (const c of data.cylinders) {
          if (c && (c.result === 'A' || c.overall === 'A')) return true
        }
      }
    }
  }
  return false
}

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

// Quality Alert confirmation modal for admins
function QualityAlertModal({ inspectionId, onDone }) {
  const [alertNotes, setAlertNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleCreate() {
    setSubmitting(true)
    try {
      await api.post(`/inspections/${inspectionId}/review`, { create_alert: true, alert_notes: alertNotes })
    } catch (_) {}
    onDone()
  }

  async function handleSkip() {
    setSubmitting(true)
    try {
      await api.post(`/inspections/${inspectionId}/review`, { create_alert: false })
    } catch (_) {}
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
            <Bell size={18} className="text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Accepted Items Detected</h3>
            <p className="text-sm text-gray-600 mt-1">
              One or more inspection items were marked Accepted. Would you like to create a Quality Alert for management review?
            </p>
          </div>
        </div>
        <textarea
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy"
          rows={3}
          placeholder="Alert notes (optional)..."
          value={alertNotes}
          onChange={e => setAlertNotes(e.target.value)}
        />
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleSkip}
            disabled={submitting}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px] disabled:opacity-50"
          >
            Skip
          </button>
          <button
            onClick={handleCreate}
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 min-h-[40px] disabled:opacity-50"
          >
            <Bell size={14} /> Create Quality Alert
          </button>
        </div>
      </div>
    </div>
  )
}

export default function InspectionForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo') || '/inspections'
  const { showToast } = useToast()
  const currentUser = getUser()
  const isAdminRole = currentUser && (currentUser.role === 'admin' || currentUser.role === 'qc_manager')

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
  const [saveState, setSaveState] = useState('idle')
  const [uploadingKey, setUploadingKey] = useState(null)
  const [dimensionalAdded, setDimensionalAdded] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [showAlertModal, setShowAlertModal] = useState(false)
  const [completedInspectionId, setCompletedInspectionId] = useState(null)
  const saveTimer = useRef(null)
  const initialLoad = useRef(true)

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
    if (saved.__dimensional_added) setDimensionalAdded(true)
    initialLoad.current = false
  }, [template?.id, inspection?.id])

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

  async function handleUpload(files) {
    for (const file of files) {
      try {
        await uploadFile.mutateAsync({ inspectionId: id, file })
      } catch {
        showToast(`Failed to upload ${file.name}`, 'error')
      }
    }
  }

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
    const subject = encodeURIComponent(`PDI Inspection ${inspection.form_no} \u2014 ${inspection.part_number || 'No part #'}`)
    const body = encodeURIComponent(
      `Please review the following inspection:\n\nForm: ${inspection.form_no}\nPart Number: ${inspection.part_number || '\u2014'}\nPO Number: ${inspection.po_number || '\u2014'}\nInspector: ${inspection.inspector_name || '\u2014'}\n\nView at: ${window.location.origin}/inspections/${id}`
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

    if ((disposition === 'FAIL' || disposition === 'ACCEPTED') && (!dispositionNotes.trim() || generalAttachments.length === 0)) {
      showToast('This result requires an explanation and at least one attachment', 'error')
      return
    }

    // Validate: Fail and Accepted items need description + image
    const sections = typeof template.sections === 'string' ? JSON.parse(template.sections) : template.sections
    const itemErrors = []
    for (const [key, section] of Object.entries(sections)) {
      const sectionArr = Array.isArray(sectionData[key]) ? sectionData[key] : []
      if (section.section_type === 'pass_fail_checklist' || section.section_type === 'pfn_checklist') {
        for (const row of sectionArr) {
          const resultField = row.result !== undefined ? row.result : (row.status || '')
          const descField = row.notes || row.finding || ''
          const isFail = resultField === 'F' || row.fail === true
          const isAcc = resultField === 'A'
          if (isFail || isAcc) {
            const hasImg = attachments.some(a => a.section_key === key && String(a.item_id) === String(row.id))
            if (!hasImg || !descField.trim()) itemErrors.push(`"${section.title}" \u2014 Item #${row.id}`)
          }
        }
      }
    }

    if (itemErrors.length > 0) {
      const extra = itemErrors.length > 1 ? ` (+${itemErrors.length - 1} more)` : ''
      showToast(`Failed/Accepted items require an image and description: ${itemErrors[0]}${extra}`, 'error')
      return
    }

    clearTimeout(saveTimer.current)
    try {
      await update.mutateAsync({ id, section_data: sectionData, disposition, disposition_notes: dispositionNotes })
      const hasAccepted = detectAcceptedItems(sectionData)
      const result = await complete.mutateAsync(id)
      const wasPendingReview = result?.pending_review === true

      if (wasPendingReview) {
        showToast('Inspection submitted for review. An admin must approve before it can be printed or shared.', 'info')
        navigate(`/inspections/${id}`)
      } else if (hasAccepted && isAdminRole) {
        // Admin completed with accepted items: prompt for quality alert
        setCompletedInspectionId(id)
        setShowAlertModal(true)
      } else {
        showToast('Inspection completed', 'success')
        navigate(`/inspections/${id}`)
      }
    } catch (err) {
      showToast(err?.response?.data?.error || err.message || 'Complete failed', 'error')
    }
  }

  function handleAlertModalDone() {
    setShowAlertModal(false)
    showToast('Inspection completed', 'success')
    navigate(`/inspections/${completedInspectionId}`)
  }

  if (loadingInsp || loadingTpl) {
    return <div className="p-6 text-gray-400">Loading inspection\u2026</div>
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

  const dispositionOptions = ['PASS', 'FAIL', 'ACCEPTED']

  const headerFields = typeof template.header_schema === 'string'
    ? JSON.parse(template.header_schema)
    : template.header_schema

  const itemAttachmentCount = attachments.filter(a => a.section_key).length
  const generalAttachments = attachments.filter(a => !a.section_key)
  const requiresDispositionAttention = disposition === 'FAIL' || disposition === 'ACCEPTED'

  return (
    <div className="flex flex-col h-full">
      {showAlertModal && completedInspectionId && (
        <QualityAlertModal inspectionId={completedInspectionId} onDone={handleAlertModalDone} />
      )}

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm flex-shrink-0">
        <div className="px-4 sm:px-6 pt-2 sm:pt-3 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs sm:text-sm font-bold text-pdi-navy">{template.form_no}</span>
          <span className="text-gray-400 text-xs sm:text-sm">\u00b7</span>
          <span className="text-xs sm:text-sm text-gray-700 truncate max-w-[50%] sm:max-w-none">{inspection.part_number || 'No part #'}</span>
          {inspection.po_number && (
            <>
              <span className="text-gray-400 text-xs sm:text-sm hidden sm:inline">\u00b7</span>
              <span className="text-xs sm:text-sm text-gray-500 hidden sm:inline">PO {inspection.po_number}</span>
            </>
          )}
          <StatusBadge status={inspection.status} />
          <span className={`text-xs ml-auto ${saveState === 'saving' ? 'text-gray-400' : saveState === 'saved' ? 'text-green-600' : saveState === 'error' ? 'text-red-500' : 'text-transparent'}`}>
            {saveState === 'saving' ? 'Saving\u2026' : saveState === 'saved' ? '\u2713 Saved' : saveState === 'error' ? 'Save failed' : '\u00b7'}
          </span>
        </div>
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
            title={complete.isPending ? 'Completing\u2026' : 'Complete'}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-sm bg-pdi-teal text-white rounded-lg hover:bg-teal-700 active:bg-teal-800 disabled:opacity-40 flex-shrink-0 min-h-[40px]"
          >
            <CheckSquare size={14} />
            <span className="hidden sm:inline">{complete.isPending ? 'Completing\u2026' : (
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

          {/* Header fields */}
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

          {/* Accepted items notice for non-admins */}
          {!isAdminRole && detectAcceptedItems(sectionData) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Accepted items detected. When you complete this inspection it will go to Pending Review for admin approval before it can be printed or shared.
              </p>
            </div>
          )}

          {/* Inspection sections */}
          {Object.entries(sections).map(([key, section]) => {
            if (key === '__dimensional_added') return null
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

          {/* Add Dimensional button */}
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

              {requiresDispositionAttention && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">This result requires an explanation and at least one attachment.</p>
                </div>
              )}

              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                rows={3}
                placeholder="Disposition notes (optional)\u2026"
                value={dispositionNotes}
                onChange={e => setDispositionNotes(e.target.value)}
              />

              {disposition === 'ACCEPTED' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    {isAdminRole
                      ? 'You will be prompted to create a Quality Alert after completing.'
                      : 'Selecting Accepted will send this inspection for admin review before it can be shared.'}
                  </p>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* General Attachments */}
          <CollapsibleSection title={`General Attachments (${generalAttachments.length})${itemAttachmentCount > 0 ? ` \u00b7 ${itemAttachmentCount} item image${itemAttachmentCount !== 1 ? 's' : ''}` : ''}`}>
            <div className="space-y-3">
              <FileUploadZone onUpload={handleUpload} />
              {generalAttachments.length > 0 && (
                <div className="space-y-2">
                  {generalAttachments.map(att => (
                    <div key={att.id} className="flex items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Paperclip size={14} className="text-gray-400 flex-shrink-0" />
                        <a
                          href={`${import.meta.env.VITE_API_URL || ''}/api/attachments/${att.id}/download`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-pdi-navy hover:underline truncate"
                        >
                          {att.file_name}
                        </a>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(att.id)}
                        className="flex-shrink-0 p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
                        aria-label="Delete attachment"
                      >
                        <X size={14} />
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
