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

function CollapsibleSection({ title, children, defaultOpen = true, onDelete }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center bg-pdi-frost hover:bg-pdi-steel/30 transition-colors min-h-[48px]">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex-1 flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 text-left"
        >
          <span className="text-sm sm:text-base font-semibold text-pdi-navy truncate pr-2">{title}</span>
          {open ? <ChevronUp size={16} className="text-pdi-navy flex-shrink-0" /> : <ChevronDown size={16} className="text-pdi-navy flex-shrink-0" />}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title="Remove section"
            className="flex-shrink-0 px-3 py-2 text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>
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
  const [completing, setCompleting] = useState(false)
  const saveTimer = useRef(null)
  const initialLoad = useRef(true)

  // Admin section-editing state
  const isAdmin = ['admin', 'qc_manager'].includes(currentUser?.role)
  const [customSections, setCustomSections] = useState(null) // null = use template default
  const [addingItemKey, setAddingItemKey] = useState(null)   // section key where + is open
  const [newItemName, setNewItemName] = useState('')

  // Derive effective sections (admin overrides take priority)
  const rawSections = template
    ? (typeof template.sections === 'string' ? JSON.parse(template.sections) : template.sections)
    : {}
  const effectiveSections = customSections ?? rawSections

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
    if (saved.__dimensional_added) setDimensionalAdded(true)
    // Restore admin section customisations
    if (saved.__admin_sections) setCustomSections(saved.__admin_sections)
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

  // ── Admin section / item helpers ─────────────────────────────────────────
  // Section types that support per-item add/delete
  const ITEM_EDITABLE = new Set(['pfn_checklist', 'pass_fail_checklist'])

  function applyCustomSections(updater) {
    setCustomSections(prev => {
      const current = prev ?? rawSections
      const next = updater(current)
      // Persist into sectionData so auto-save captures it
      setSectionData(d => ({ ...d, __admin_sections: next }))
      return next
    })
  }

  function handleDeleteSection(key) {
    applyCustomSections(secs => {
      const next = { ...secs }
      delete next[key]
      return next
    })
  }

  function handleDeleteItem(sectionKey, itemId) {
    applyCustomSections(secs => ({
      ...secs,
      [sectionKey]: {
        ...secs[sectionKey],
        items: (secs[sectionKey].items || []).filter(it => String(it.id) !== String(itemId)),
      },
    }))
  }

  function handleAddItem(sectionKey) {
    const name = newItemName.trim()
    if (!name) return
    applyCustomSections(secs => {
      const sec = secs[sectionKey] || {}
      const items = sec.items || []
      const maxId = items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0)
      return {
        ...secs,
        [sectionKey]: { ...sec, items: [...items, { id: maxId + 1, name }] },
      }
    })
    setNewItemName('')
    setAddingItemKey(null)
  }
  // ─────────────────────────────────────────────────────────────────────────

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
    const itemErrors = []
    for (const [key, section] of Object.entries(effectiveSections)) {
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

    setCompleting(true)
    clearTimeout(saveTimer.current)
    try {
      await update.mutateAsync({ id, section_data: sectionData, disposition, disposition_notes: dispositionNotes })
      const hasAccepted = Object.entries(sectionData).some(([, rows]) =>
        Array.isArray(rows) && rows.some(r => r.result === 'A' || r.status === 'A')
      )
      const result = await complete.mutateAsync(id)
      const wasPendingReview = result?.pending_review === true

      if (wasPendingReview) {
        showToast('Inspection submitted for review. An admin must approve before it can be printed or shared.', 'info')
        navigate(`/inspections/${id}`)
      } else if (hasAccepted && isAdminRole) {
        setCompletedInspectionId(id)
        setShowAlertModal(true)
      } else {
        showToast('Inspection completed', 'success')
        navigate(`/inspections/${id}`)
      }
    } catch (err) {
      showToast(err?.response?.data?.error || err.message || 'Complete failed', 'error')
    } finally {
      setCompleting(false)
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
            <span className="hidden sm:inline">{complete.isPending ? 'Completing…' : (
              Object.values(effectiveSections).some(s => s.optional) && !dimensionalAdded
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
          {Object.entries(effectiveSections).map(([key, section]) => {
            if (key === '__dimensional_added' || key === '__admin_sections') return null
            // Skip optional sections unless dimensional has been added
            if (section.optional && !dimensionalAdded) return null
            const Component = SECTION_COMPONENTS[section.section_type]
            if (!Component) return null
            const supportsImages = IMAGE_ENABLED_SECTIONS.has(section.section_type)
            const canEditItems = isAdmin && ITEM_EDITABLE.has(section.section_type)
            return (
              <CollapsibleSection
                key={key}
                title={section.title}
                onDelete={isAdmin ? () => handleDeleteSection(key) : undefined}
              >
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

                {/* Admin item controls */}
                {canEditItems && (
                  <div className="mt-3 border-t border-dashed border-gray-200 pt-3 space-y-1">
                    {/* Per-item delete buttons */}
                    {(section.items || []).map(item => (
                      <div key={item.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-red-50 group">
                        <span className="text-xs text-gray-500 truncate">{item.name || item.measurement || item.ctq_area || `Item ${item.id}`}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(key, item.id)}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity p-0.5"
                          title="Remove item"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {/* Add item inline */}
                    {addingItemKey === key ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          autoFocus
                          type="text"
                          value={newItemName}
                          onChange={e => setNewItemName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(key) } if (e.key === 'Escape') setAddingItemKey(null) }}
                          placeholder="Item name…"
                          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                        />
                        <button type="button" onClick={() => handleAddItem(key)} className="text-xs text-pdi-navy hover:underline">Add</button>
                        <button type="button" onClick={() => setAddingItemKey(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setAddingItemKey(key); setNewItemName('') }}
                        className="flex items-center gap-1 text-xs text-pdi-navy hover:underline mt-1"
                      >
                        <PlusCircle size={12} /> Add item
                      </button>
                    )}
                  </div>
                )}
              </CollapsibleSection>
            )
          })}

          {/* Disposition + Complete */}
          {inspection.status === 'draft' && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Disposition</h3>
              <div className="flex flex-wrap gap-2">
                {dispositionOptions.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setDisposition(opt)}
                    className={`px-4 py-2 text-sm rounded-lg border font-medium transition-colors min-h-[40px] ${
                      disposition === opt
                        ? `${DISPOSITION_COLORS[opt] || 'bg-gray-200 border-gray-300'} text-white`
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {disposition && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
                  <textarea
                    value={dispositionNotes}
                    onChange={e => setDispositionNotes(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                    placeholder="Add any disposition notes…"
                  />
                </div>
              )}
              <button
                type="button"
                disabled={!disposition || completing}
                onClick={handleComplete}
                className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-2.5 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light disabled:opacity-40 font-medium min-h-[44px]"
              >
                {completing ? <Loader2 size={16} className="animate-spin" /> : <CheckSquare size={16} />}
                {completing ? 'Completing…' : 'Complete Inspection'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}