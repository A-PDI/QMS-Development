import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Save, CheckSquare, ChevronDown, ChevronUp, Paperclip, PlusCircle, X, Printer, Mail, Loader2, AlertTriangle, Bell, ImagePlus, Trash2, Pencil, Check, Circle } from 'lucide-react'
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
import SectionGrooveSpecs from '../components/inspection/SectionGrooveSpecs'
import FileUploadZone from '../components/FileUploadZone'
import AuthImage from '../components/AuthImage'
import { initSectionData, mergeSectionData, formatFileSize } from '../lib/utils'
import { getItemsCompletion, deriveOverallDisposition, getItemDisposition, ITEM_DISPOSITION_KEY } from '../lib/itemCompletion'
import { dispositionColor, HEADER_FIELD_LABELS, COMPONENT_TYPE_LABELS } from '../lib/constants'

// Statuses that are still editable in the inspection form (not yet finalized).
const EDITABLE_STATUSES = new Set(['draft', 'partially_complete'])

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
  groove_specs: SectionGrooveSpecs,
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
      if (Array.isArray(data.measurements)) {
        for (const m of data.measurements) {
          if (m && m.status === 'A') return true
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

// Resize an image File to 490×650px (≈2.45"×3.25" at 200 dpi) before upload.
// Uses a centered cover crop so the exact aspect ratio is preserved.
async function resizeImageFile(file) {
  const TARGET_W = 490
  const TARGET_H = 650
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = TARGET_W
      canvas.height = TARGET_H
      const ctx = canvas.getContext('2d')
      const srcScale = Math.min(img.width / TARGET_W, img.height / TARGET_H)
      const srcW = TARGET_W * srcScale
      const srcH = TARGET_H * srcScale
      const srcX = (img.width - srcW) / 2
      const srcY = (img.height - srcH) / 2
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, TARGET_W, TARGET_H)
      canvas.toBlob(
        blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg',
        0.92
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
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

  // Per-item section data. `items` is an array (one entry per inspected item);
  // `activeItem` is the index currently being edited. Control flags such as
  // __dimensional_added / __admin_sections live at the top level (shared across
  // items) and are stored in `sharedFlags`.
  const [items, setItems] = useState([{}])
  const [activeItem, setActiveItem] = useState(0)
  const [sharedFlags, setSharedFlags] = useState({})
  // The active item's section data (what the section components read/write).
  const sectionData = items[activeItem] || {}
  // Setter scoped to the active item — accepts a value or updater fn, mirroring
  // the previous setSectionData(d => ...) call sites.
  const setSectionData = useCallback((updater) => {
    setItems(prev => {
      const idx = activeItemRef.current
      const next = prev.slice()
      const current = next[idx] || {}
      next[idx] = typeof updater === 'function' ? updater(current) : updater
      return next
    })
  }, [])
  // Disposition is now PER ITEM. The active item's disposition + notes are read
  // from its section_data (__disposition / __disposition_notes) and written back
  // via these setters. An item is "complete" once its disposition is selected.
  const disposition = sectionData[ITEM_DISPOSITION_KEY] || ''
  const dispositionNotes = sectionData.__disposition_notes || ''
  const setDisposition = useCallback((val) => {
    setSectionData(d => ({ ...d, [ITEM_DISPOSITION_KEY]: val }))
  }, [setSectionData])
  const setDispositionNotes = useCallback((val) => {
    setSectionData(d => ({ ...d, __disposition_notes: val }))
  }, [setSectionData])
  // Editable inspection header info (part #, PO, lot/serial, date received, inspector)
  const [headerInfo, setHeaderInfo] = useState({
    part_number: '', po_number: '', lot_serial_no: '', date_received: '', inspector_name: '',
  })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [uploadingKey, setUploadingKey] = useState(null)
  const [dimensionalAdded, setDimensionalAdded] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [showAlertModal, setShowAlertModal] = useState(false)
  const [completedInspectionId, setCompletedInspectionId] = useState(null)
  const [completing, setCompleting] = useState(false)
  const saveTimer = useRef(null)
  const initialLoad = useRef(true)
  const bulkUploadRef = useRef(null)
  const activeItemRef = useRef(0)
  useEffect(() => { activeItemRef.current = activeItem }, [activeItem])

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
    const saved = typeof inspection.section_data === 'string'
      ? JSON.parse(inspection.section_data || '{}')
      : (inspection.section_data || {})

    // Extract shared control flags (kept once, applied to all items).
    const flags = {}
    if (saved.__dimensional_added) flags.__dimensional_added = true
    if (saved.__admin_sections) flags.__admin_sections = saved.__admin_sections
    setSharedFlags(flags)

    // Build the per-item list. New format stores answers under `__items`;
    // legacy inspections keep answers as top-level section keys (= item 0).
    let savedItems
    if (Array.isArray(saved.__items)) {
      savedItems = saved.__items
    } else {
      const legacy = {}
      for (const k of Object.keys(saved)) {
        if (k.startsWith('__')) continue
        legacy[k] = saved[k]
      }
      savedItems = [legacy]
    }

    // Reconcile the item list length with the inspection's item_count, merging
    // each item's saved answers onto a fresh template so missing keys are filled.
    const count = Math.max(1, parseInt(inspection.item_count, 10) || savedItems.length || 1)
    const built = []
    for (let i = 0; i < count; i++) {
      const savedItem = savedItems[i] || {}
      const merged = mergeSectionData(savedItem, initSectionData(sections))
      // Preserve each item's own disposition + notes (control keys, not template
      // sections, so they aren't included by mergeSectionData).
      if (savedItem[ITEM_DISPOSITION_KEY] !== undefined) merged[ITEM_DISPOSITION_KEY] = savedItem[ITEM_DISPOSITION_KEY]
      if (savedItem.__disposition_notes !== undefined) merged.__disposition_notes = savedItem.__disposition_notes
      built.push(merged)
    }
    // Backward compat: if item 0 has no disposition yet but the inspection has a
    // legacy inspection-level disposition, seed it onto item 0.
    if (built[0] && !built[0][ITEM_DISPOSITION_KEY] && inspection.disposition) {
      built[0][ITEM_DISPOSITION_KEY] = inspection.disposition
      if (inspection.disposition_notes && !built[0].__disposition_notes) {
        built[0].__disposition_notes = inspection.disposition_notes
      }
    }
    setItems(built)
    setActiveItem(0)

    setHeaderInfo({
      part_number: inspection.part_number || '',
      po_number: inspection.po_number || '',
      lot_serial_no: inspection.lot_serial_no || '',
      date_received: (inspection.date_received || '').slice(0, 10),
      inspector_name: inspection.inspector_name || '',
    })
    if (flags.__dimensional_added) setDimensionalAdded(true)
    // Restore admin section customisations
    if (flags.__admin_sections) setCustomSections(flags.__admin_sections)
    initialLoad.current = false
  }, [template?.id, inspection?.id])

  const debouncedSave = useCallback(() => {
    if (initialLoad.current) return
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        // Keep status in sync while editing: once any item has a disposition (but
        // not all), the inspection is "Partially Complete"; with none it is a
        // draft. (A fully-dispositioned inspection is only marked 'complete' via
        // the explicit Complete action, not autosave.)
        const dispCount = items.filter(it => getItemDisposition(it)).length
        const autoStatus = dispCount > 0 && dispCount < items.length ? 'partially_complete' : 'draft'
        await update.mutateAsync({
          id,
          section_data: buildSectionDataPayload(),
          // Overall disposition is only set once every item is dispositioned.
          disposition: deriveOverallDisposition(items),
          item_count: items.length,
          status: autoStatus,
          ...headerInfo,
        })
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2000)
      } catch {
        setSaveState('error')
      }
    }, 600)
  }, [id, items, sharedFlags, headerInfo])

  useEffect(() => {
    if (!initialLoad.current) debouncedSave()
  }, [items, sharedFlags, headerInfo])

  function handleAddDimensional() {
    setDimensionalAdded(true)
    setSharedFlags(f => ({ ...f, __dimensional_added: true }))
  }

  // Build the persisted section_data blob: shared control flags + the per-item
  // answers under __items.
  function buildSectionDataPayload() {
    return { ...sharedFlags, __items: items }
  }

  // Attachments are scoped per item. Item 0 keeps the raw section key (so
  // existing single-item inspections keep their images); items 1+ get a
  // namespaced key so each item's images stay distinct.
  function attachmentKeyFor(itemIdx, sectionKey) {
    return itemIdx === 0 ? sectionKey : `item${itemIdx}__${sectionKey}`
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

  async function handleBulkImageSelect(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const resized = await Promise.all(files.map(resizeImageFile))
    await handleUpload(resized)
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
  // Section types that support per-item add/delete (including dimensional for add)
  const ITEM_EDITABLE = new Set(['pfn_checklist', 'pass_fail_checklist', 'dimensional'])

  function applyCustomSections(updater) {
    setCustomSections(prev => {
      const current = prev ?? rawSections
      const next = updater(current)
      // Persist into shared flags so auto-save captures it (shared across items)
      setSharedFlags(f => ({ ...f, __admin_sections: next }))
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
      const isDimensional = sec.section_type === 'dimensional'
      const newItem = isDimensional
        ? { id: maxId + 1, measurement: name, location: '', spec: '' }
        : { id: maxId + 1, name }
      return { ...secs, [sectionKey]: { ...sec, items: [...items, newItem] } }
    })
    setNewItemName('')
    setAddingItemKey(null)
  }

  function handleEditItem(sectionKey, itemId, nameOrMeasurement, requirementOrLocation) {
    applyCustomSections(secs => {
      const sec = secs[sectionKey] || {}
      const isDimensional = sec.section_type === 'dimensional'
      return {
        ...secs,
        [sectionKey]: {
          ...sec,
          items: (sec.items || []).map(it => {
            if (String(it.id) !== String(itemId)) return it
            return isDimensional
              ? { ...it, measurement: nameOrMeasurement, location: requirementOrLocation }
              : { ...it, name: nameOrMeasurement, requirement: requirementOrLocation }
          }),
        },
      }
    })
  }
  // ─────────────────────────────────────────────────────────────────────────

  async function handleDeleteFile(attachmentId) {
    try {
      await deleteFile.mutateAsync({ id: attachmentId, inspectionId: id })
    } catch {
      showToast('Failed to delete file', 'error')
    }
  }

  // Save the current work and mark the inspection "Partially Complete".
  async function handleSavePartial() {
    setCompleting(true)
    clearTimeout(saveTimer.current)
    try {
      await update.mutateAsync({
        id,
        section_data: buildSectionDataPayload(),
        disposition: deriveOverallDisposition(items),
        item_count: items.length,
        status: 'partially_complete',
        ...headerInfo,
      })
      showToast('Saved as Partially Complete — set a Disposition on the remaining items to complete the inspection.', 'info')
      navigate(`/inspections/${id}`)
    } catch (err) {
      showToast(err?.response?.data?.error || err.message || 'Save failed', 'error')
    } finally {
      setCompleting(false)
    }
  }

  async function handleComplete() {
    // Gate 1: every item must have a Disposition selected. If any item is
    // missing one, the inspection is saved as "Partially Complete" instead.
    const itemCompletion = getItemsCompletion(items)
    if (!itemCompletion.allComplete) {
      const labels = itemCompletion.incompleteIndexes.map(i => `Item ${i + 1}`)
      const shown = labels.slice(0, 3).join(', ')
      const extra = labels.length > 3 ? ` (+${labels.length - 3} more)` : ''
      const verb = items.length > 1 ? `${shown}${extra} ${labels.length === 1 ? 'has' : 'have'} no Disposition selected` : 'No Disposition selected'
      showToast(`Cannot complete: ${verb}. Saving as Partially Complete.`, 'error')
      await handleSavePartial()
      return
    }

    // Each item's disposition that requires attention (FAIL/ACCEPTED) needs notes
    // and at least one attachment on that item.
    const dispErrors = []
    items.forEach((itemData, itemIdx) => {
      const d = getItemDisposition(itemData)
      if (d === 'FAIL' || d === 'ACCEPTED') {
        const notes = (itemData.__disposition_notes || '').trim()
        const itemAtts = attachments.filter(a => {
          if (itemIdx === 0) return !a.section_key || !/^item\d+__/.test(a.section_key)
          return (a.section_key || '').startsWith(`item${itemIdx}__`)
        })
        if (!notes || itemAtts.length === 0) {
          dispErrors.push(items.length > 1 ? `Item ${itemIdx + 1}` : 'This inspection')
        }
      }
    })
    if (dispErrors.length > 0) {
      const extra = dispErrors.length > 1 ? ` (+${dispErrors.length - 1} more)` : ''
      showToast(`${dispErrors[0]}${extra}: a FAIL/ACCEPTED result requires notes and at least one attachment.`, 'error')
      return
    }

    // Validate: Fail and Accepted items need description + image (across all items)
    const itemErrors = []
    const multiItem = items.length > 1
    items.forEach((itemData, itemIdx) => {
      for (const [key, section] of Object.entries(effectiveSections)) {
        const sectionArr = Array.isArray(itemData[key]) ? itemData[key] : []
        if (section.section_type === 'pass_fail_checklist' || section.section_type === 'pfn_checklist') {
          for (const row of sectionArr) {
            const resultField = row.result !== undefined ? row.result : (row.status || '')
            const descField = row.notes || row.finding || ''
            const isFail = resultField === 'F' || row.fail === true
            const isAcc = resultField === 'A'
            if (isFail || isAcc) {
              const attKey = attachmentKeyFor(itemIdx, key)
              const hasImg = attachments.some(a => a.section_key === attKey && String(a.item_id) === String(row.id))
              const itemLabel = multiItem ? `Item ${itemIdx + 1} \u2014 ` : ''
              if (!hasImg || !descField.trim()) itemErrors.push(`${itemLabel}"${section.title}" \u2014 #${row.id}`)
            }
          }
        }
      }
    })

    if (itemErrors.length > 0) {
      const extra = itemErrors.length > 1 ? ` (+${itemErrors.length - 1} more)` : ''
      showToast(`Failed/Accepted items require an image and description: ${itemErrors[0]}${extra}`, 'error')
      return
    }

    setCompleting(true)
    clearTimeout(saveTimer.current)
    try {
      await update.mutateAsync({ id, section_data: buildSectionDataPayload(), disposition: deriveOverallDisposition(items), item_count: items.length, ...headerInfo })
      const hasAccepted = items.some(itemData =>
        getItemDisposition(itemData) === 'ACCEPTED' ||
        Object.entries(itemData).some(([, rows]) =>
          Array.isArray(rows) && rows.some(r => r.result === 'A' || r.status === 'A')
        )
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

  if (!EDITABLE_STATUSES.has(inspection.status)) {
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

  // Per-item completion state — drives the tab badges and the Complete gate.
  const completion = getItemsCompletion(items)

  return (
    <div className="flex flex-col h-full">
      {showAlertModal && completedInspectionId && (
        <QualityAlertModal inspectionId={completedInspectionId} onDone={handleAlertModalDone} />
      )}

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm flex-shrink-0">
        <div className="px-3 sm:px-5 py-2 flex items-center gap-3 min-h-[52px]">
          {/* Form number */}
          <span className="font-mono text-xs font-bold text-pdi-navy flex-shrink-0 hidden sm:block">{template.form_no}</span>
          <div className="w-px h-4 bg-gray-200 flex-shrink-0 hidden sm:block" />

          {/* Info fields — scroll horizontally on small screens */}
          <div className="flex items-center gap-4 sm:gap-5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
            {inspection.component_type && (
              <div className="flex-shrink-0">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Part Type</div>
                <div className="text-xs font-medium text-gray-800">{COMPONENT_TYPE_LABELS[inspection.component_type] || inspection.component_type}</div>
              </div>
            )}
            {headerInfo.part_number && (
              <div className="flex-shrink-0">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Part Number</div>
                <div className="text-xs font-medium text-gray-800 font-mono">{headerInfo.part_number}</div>
              </div>
            )}
            {headerInfo.po_number && (
              <div className="flex-shrink-0">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">PO Number</div>
                <div className="text-xs font-medium text-gray-800 font-mono">{headerInfo.po_number}</div>
              </div>
            )}
            {headerInfo.lot_serial_no && (
              <div className="flex-shrink-0">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Lot / Serial No.</div>
                <div className="text-xs font-medium text-gray-800 font-mono">{headerInfo.lot_serial_no}</div>
              </div>
            )}
            {headerInfo.date_received && (
              <div className="flex-shrink-0">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Date Received</div>
                <div className="text-xs font-medium text-gray-800 font-mono">{headerInfo.date_received}</div>
              </div>
            )}
            {headerInfo.inspector_name && (
              <div className="flex-shrink-0">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Inspector</div>
                <div className="text-xs font-medium text-gray-800">{headerInfo.inspector_name}</div>
              </div>
            )}
            <button
              onClick={() => setDetailsOpen(o => !o)}
              className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-pdi-navy hover:text-pdi-navy-light px-2 py-1 rounded hover:bg-pdi-frost transition-colors"
              title="Edit inspection details"
            >
              <Pencil size={12} />
              {detailsOpen ? 'Hide' : 'Edit'}
            </button>
          </div>

          {/* Status + save indicator */}
          <StatusBadge status={inspection.status} />
          <span className={`text-xs flex-shrink-0 hidden sm:block ${saveState === 'saving' ? 'text-gray-400' : saveState === 'saved' ? 'text-green-600' : saveState === 'error' ? 'text-red-500' : 'invisible'}`}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? 'Save failed' : '·'}
          </span>

          {/* Action buttons */}
          <div className="flex items-center gap-0.5 flex-shrink-0 pl-2 border-l border-gray-100">
            <button
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
              title="Print / PDF"
              className="p-2 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40 transition-colors flex-shrink-0"
            >
              {pdfLoading ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
            </button>
            <button
              onClick={handleEmail}
              title="Email"
              className="p-2 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors flex-shrink-0"
            >
              <Mail size={16} />
            </button>
            <button
              onClick={() => bulkUploadRef.current?.click()}
              title="Bulk Image Upload"
              className="p-2 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors flex-shrink-0"
            >
              <ImagePlus size={16} />
            </button>
            <button
              onClick={() => debouncedSave()}
              title="Save"
              className="p-2 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors flex-shrink-0"
            >
              <Save size={16} />
            </button>
            <button
              onClick={handleComplete}
              disabled={complete.isPending || completing}
              title={complete.isPending ? 'Completing…' : (!completion.allComplete ? 'Disposition required on every item' : 'Complete Inspection')}
              className="p-2 rounded text-pdi-teal hover:bg-teal-50 hover:text-teal-700 disabled:opacity-40 transition-colors flex-shrink-0"
            >
              {complete.isPending || completing ? <Loader2 size={16} className="animate-spin" /> : <CheckSquare size={16} />}
            </button>
            <div className="w-px h-5 bg-gray-200 mx-1 flex-shrink-0" />
            <button
              onClick={() => navigate(returnTo)}
              title="Close"
              className="p-2 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Hidden multi-file input for bulk image upload */}
        <input
          ref={bulkUploadRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={handleBulkImageSelect}
        />

        {/* Editable inspection details */}
        {detailsOpen && (
          <div className="border-t border-gray-100 bg-gray-50/70 px-3 sm:px-5 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                { key: 'part_number', label: 'Part Number', mono: true },
                { key: 'po_number', label: 'PO Number', mono: true },
                { key: 'lot_serial_no', label: 'Lot / Serial No.', mono: true },
                { key: 'date_received', label: 'Date Received', type: 'date' },
                { key: 'inspector_name', label: 'Inspector' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wide font-semibold mb-1">{f.label}</label>
                  <input
                    type={f.type || 'text'}
                    value={headerInfo[f.key]}
                    onChange={e => setHeaderInfo(h => ({ ...h, [f.key]: e.target.value }))}
                    className={`w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px] ${f.mono ? 'font-mono' : ''}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1440px] mx-auto p-3 sm:p-6 space-y-3 sm:space-y-4">

          {/* Accepted items notice for non-admins */}
          {!isAdminRole && items.some(detectAcceptedItems) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Accepted items require admin approval before this inspection can be printed or shared.
              </p>
            </div>
          )}

          {/* Item navigation — one tab per inspected item */}
          {items.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 sticky top-0 z-[5]">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0 pr-1">
                  Items ({completion.perItem.filter(c => c.isComplete).length}/{items.length} dispositioned)
                </span>
                {items.map((_, idx) => {
                  const done = completion.perItem[idx]?.isComplete
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveItem(idx)}
                      title={done ? `Item ${idx + 1} — disposition set (${completion.perItem[idx].disposition})` : `Item ${idx + 1} — no disposition selected`}
                      className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors min-h-[34px] ${
                        activeItem === idx
                          ? 'bg-pdi-navy text-white border-pdi-navy'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-pdi-navy/40 hover:bg-pdi-frost'
                      }`}
                    >
                      {done
                        ? <Check size={13} className={activeItem === idx ? 'text-green-300' : 'text-green-600'} strokeWidth={3} />
                        : <Circle size={11} className={activeItem === idx ? 'text-orange-200' : 'text-orange-400'} strokeWidth={3} />}
                      Item {idx + 1}
                    </button>
                  )
                })}
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={activeItem === 0}
                  onClick={() => setActiveItem(i => Math.max(0, i - 1))}
                  className="flex-shrink-0 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 min-h-[34px]"
                >
                  ‹ Prev
                </button>
                <button
                  type="button"
                  disabled={activeItem === items.length - 1}
                  onClick={() => setActiveItem(i => Math.min(items.length - 1, i + 1))}
                  className="flex-shrink-0 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 min-h-[34px]"
                >
                  Next ›
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500">
                Editing <span className="font-semibold text-gray-700">Item {activeItem + 1}</span> of {items.length}
                {completion.perItem[activeItem] && (
                  completion.perItem[activeItem].isComplete
                    ? <span className="text-green-600 font-medium"> · {completion.perItem[activeItem].disposition}</span>
                    : <span className="text-orange-500 font-medium"> · no Disposition</span>
                )}
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
            const adminTools = isAdmin ? {
              onDelete: (itemId) => handleDeleteItem(key, itemId),
              onEdit: (itemId, a, b) => handleEditItem(key, itemId, a, b),
            } : undefined
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
                    sectionKey: attachmentKeyFor(activeItem, key),
                    attachments,
                    onUploadItem: handleItemUpload,
                    onDeleteItem: handleDeleteFile,
                    uploadingKey,
                  } : {})}
                  adminItemTools={adminTools}
                />

                {/* Admin: Add item button in section footer */}
                {canEditItems && (
                  <div className="mt-3 border-t border-dashed border-gray-200 pt-3">
                    {addingItemKey === key ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={newItemName}
                          onChange={e => setNewItemName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(key) } if (e.key === 'Escape') setAddingItemKey(null) }}
                          placeholder={section.section_type === 'dimensional' ? 'Measurement name…' : 'Item name…'}
                          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                        />
                        <button type="button" onClick={() => handleAddItem(key)} className="text-xs text-pdi-navy hover:underline">Add</button>
                        <button type="button" onClick={() => setAddingItemKey(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setAddingItemKey(key); setNewItemName('') }}
                        className="flex items-center gap-1 text-xs text-pdi-navy hover:underline"
                      >
                        <PlusCircle size={12} /> Add item
                      </button>
                    )}
                  </div>
                )}
              </CollapsibleSection>
            )
          })}

          {/* Add Dimensional Inspection button */}
          {!dimensionalAdded && Object.values(effectiveSections).some(s => s.optional) && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={handleAddDimensional}
                className="flex items-center gap-2 px-5 py-2.5 text-sm border-2 border-dashed border-pdi-navy/40 text-pdi-navy rounded-lg hover:border-pdi-navy hover:bg-pdi-frost transition-colors font-medium"
              >
                <PlusCircle size={16} />
                Add Dimensional Inspection
              </button>
            </div>
          )}

          {/* General attachments gallery (bulk-uploaded images) */}
          {generalAttachments.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Inspection Images ({generalAttachments.length})
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {generalAttachments.map(att => (
                  <div
                    key={att.id}
                    className="relative group border border-gray-200 rounded overflow-hidden bg-gray-50"
                    style={{ aspectRatio: '2.45 / 3.25' }}
                  >
                    <AuthImage
                      attachmentId={att.id}
                      alt={att.file_name}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <button
                      onClick={() => handleDeleteFile(att.id)}
                      title="Remove image"
                      className="absolute top-1 right-1 p-1 bg-white/80 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={13} />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-1.5 py-0.5 text-[10px] text-white truncate">
                      {att.file_name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disposition + Complete */}
          {EDITABLE_STATUSES.has(inspection.status) && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Disposition{items.length > 1 ? ` — Item ${activeItem + 1}` : ''}
                </h3>
                {items.length > 1 && (
                  <span className="text-[11px] text-gray-400">Set a Disposition for each item</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {dispositionOptions.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setDisposition(opt)}
                    className={`px-4 py-2 text-sm rounded-lg border font-medium transition-colors min-h-[40px] ${
                      disposition === opt
                        ? dispositionColor(opt)
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

              {/* Completion gate notice */}
              {!completion.allComplete && (
                <div className="flex items-start gap-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2.5">
                  <AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-orange-800">
                    {completion.incompleteIndexes.length} of {items.length} item{items.length === 1 ? '' : 's'} still need a Disposition.
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                <button
                  type="button"
                  disabled={completing || !completion.allComplete}
                  onClick={handleComplete}
                  title={!completion.allComplete ? 'Select a Disposition for every item before completing' : undefined}
                  className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-2.5 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light disabled:opacity-40 font-medium min-h-[44px]"
                >
                  {completing ? <Loader2 size={16} className="animate-spin" /> : <CheckSquare size={16} />}
                  {completing ? 'Saving…' : 'Complete Inspection'}
                </button>
                {!completion.allComplete && (
                  <button
                    type="button"
                    disabled={completing}
                    onClick={handleSavePartial}
                    className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-2.5 text-sm border border-orange-300 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 disabled:opacity-40 font-medium min-h-[44px]"
                  >
                    {completing ? <Loader2 size={16} className="animate-spin" /> : <Circle size={15} strokeWidth={3} />}
                    Save as Partially Complete
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
