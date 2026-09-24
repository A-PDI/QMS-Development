import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, X, Save, Search, Link, Plus, Loader2 } from 'lucide-react'
import { useNCR, useCreateNCR, useUpdateNCR, useSaveNCRContent, uploadNCRImage, apiErrorMessage } from '../hooks/useNCRs'
import { useInspections, useInspection } from '../hooks/useInspections'
import { useToast } from '../hooks/useToast'
import { formatDateTime, formatDate } from '../lib/utils'
import { NCR_SEVERITY_LABELS, NCR_STATUS_LABELS, NCR_DISPOSITION_LABELS, COMPONENT_TYPE_LABELS } from '../lib/constants'
import {
  NCR_SECTION_SUGGESTIONS, editorContentFromNcr, emptySection, moveItem, allImages,
  contentProblem, pendingUploads, markUploaded, buildContentPayload, assignSectionIds,
} from '../lib/ncrReport'
import NcrImageEditor from '../components/ncr/NcrImageEditor'
import NcrSectionEditor, { SECTION_TITLE_LIST_ID } from '../components/ncr/NcrSectionEditor'

const EMPTY_FORM = {
  part_number: '', supplier: '', po_number: '', description_of_defect: '',
  quantity_affected: '', severity: 'major', ncr_disposition: 'pending',
  corrective_action_required: false, corrective_action_due_date: '',
  status: 'open',
}

/** Extract failed / non-conforming items from inspection section_data */
function extractFailedItems(inspection, template) {
  const items = []
  if (!inspection?.section_data) return items

  const sectionData = typeof inspection.section_data === 'string'
    ? JSON.parse(inspection.section_data || '{}')
    : (inspection.section_data || {})

  const sections = template?.sections
    ? (typeof template.sections === 'string' ? JSON.parse(template.sections) : template.sections)
    : {}

  for (const [sKey, section] of Object.entries(sections)) {
    if (sKey === '__dimensional_added') continue
    const sArr = Array.isArray(sectionData[sKey]) ? sectionData[sKey] : []
    for (const row of sArr) {
      let failed = false
      let label = ''
      if (section.section_type === 'pass_fail_checklist' && row.fail) {
        failed = true
        const item = (section.items || []).find(i => i.id === row.id)
        label = item?.name || `Item #${row.id}`
      } else if (section.section_type === 'pfn_checklist' && row.status === 'F') {
        failed = true
        const item = (section.items || []).find(i => i.id === row.id)
        label = item?.name || `Item #${row.id}`
      }
      if (failed) {
        items.push({
          sectionTitle: section.title,
          label,
          notes: row.notes || row.finding || '',
        })
      }
    }
  }
  // Also check disposition
  if (inspection.disposition && ['FAIL', 'REJECT'].includes(inspection.disposition)) {
    items.unshift({ sectionTitle: 'Final Result', label: inspection.disposition, notes: inspection.disposition_notes || '' })
  }
  return items
}

/**
 * Create (/ncrs/new) or edit (/ncrs/:id/edit) an NCR: its fields, the general
 * Photos block and user-created sections (title, text, captioned photos).
 * Nothing reaches the server until Save; photos are uploaded then.
 */
export default function NCREditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { showToast } = useToast()
  const isNew = !id

  const { data: ncr, isLoading, isError } = useNCR(isNew ? null : id)
  const createNCR = useCreateNCR()
  const updateNCR = useUpdateNCR()
  const saveContent = useSaveNCRContent()

  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [content, setContent] = useState({ sections: [], photos: [] })
  const [removedImageIds, setRemovedImageIds] = useState([])
  // Set once a new NCR has been created, so a retried save updates it rather
  // than creating a second one (e.g. after a photo failed to upload).
  const [createdNcr, setCreatedNcr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [dirty, setDirty] = useState(false)
  const loadedIdRef = useRef(null)
  const previewUrlsRef = useRef(new Set())

  // Inspection linking state (new NCRs only)
  const [inspSearch, setInspSearch] = useState('')
  const [inspSearchActive, setInspSearchActive] = useState('')
  const [linkedInspId, setLinkedInspId] = useState(searchParams.get('inspection_id') || '')
  const [showInspSelector, setShowInspSelector] = useState(!searchParams.get('inspection_id'))

  // Fetch inspection list for search
  // Passed inspections have nothing to raise an NCR against, so they are not offered.
  const { data: inspListData } = useInspections(
    { ...(inspSearchActive ? { search: inspSearchActive } : {}), limit: 20, exclude_disposition: 'PASS' },
    { enabled: isNew && showInspSelector }
  )
  const inspList = inspListData?.inspections || []

  // Fetch the linked inspection detail (to extract failed items)
  const { data: linkedInspection } = useInspection(linkedInspId || null)

  // We need the template to parse section items - fetch it separately
  const [linkedTemplate, setLinkedTemplate] = useState(null)
  useEffect(() => {
    if (!linkedInspection?.template_id) { setLinkedTemplate(null); return }
    import('../lib/api').then(({ default: api }) => {
      api.get(`/templates/${linkedInspection.template_id}`)
        .then(r => setLinkedTemplate(r.data.template))
        .catch(() => setLinkedTemplate(null))
    })
  }, [linkedInspection?.template_id])

  const failedItems = extractFailedItems(linkedInspection, linkedTemplate)

  // Pre-fill form from linked inspection
  useEffect(() => {
    if (isNew && linkedInspection) {
      setForm(f => ({
        ...f,
        part_number: linkedInspection.part_number || f.part_number,
        supplier: linkedInspection.supplier || f.supplier,
        po_number: linkedInspection.po_number || f.po_number,
        quantity_affected: linkedInspection.sample_size || f.quantity_affected,
      }))
    }
  }, [linkedInspection?.id, isNew])

  // Load each NCR once. Later refetches (e.g. on window focus) must not
  // overwrite what the user is typing.
  useEffect(() => {
    if (isNew || !ncr || loadedIdRef.current === ncr.id) return
    loadedIdRef.current = ncr.id
    setForm({
      part_number: ncr.part_number || '',
      supplier: ncr.supplier || '',
      po_number: ncr.po_number || '',
      description_of_defect: ncr.description_of_defect || '',
      quantity_affected: ncr.quantity_affected ?? '',
      severity: ncr.severity || 'major',
      ncr_disposition: ncr.ncr_disposition || 'pending',
      corrective_action_required: !!ncr.corrective_action_required,
      corrective_action_due_date: ncr.corrective_action_due_date || '',
      status: ncr.status || 'open',
    })
    setContent(editorContentFromNcr(ncr))
    setRemovedImageIds([])
    setDirty(false)
    if (ncr.inspection_id) setLinkedInspId(ncr.inspection_id)
  }, [ncr, isNew])

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Release local photo previews when leaving the editor.
  useEffect(() => {
    const urls = previewUrlsRef.current
    return () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear() }
  }, [])

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setDirty(true)
  }

  function updateContent(updater) {
    setContent(prev => {
      const next = updater(prev)
      allImages(next).forEach(img => { if (img.previewUrl) previewUrlsRef.current.add(img.previewUrl) })
      return next
    })
    setDirty(true)
  }

  function forgetImage(img) {
    if (img.id) setRemovedImageIds(ids => (ids.includes(img.id) ? ids : [...ids, img.id]))
    if (img.previewUrl) { URL.revokeObjectURL(img.previewUrl); previewUrlsRef.current.delete(img.previewUrl) }
  }

  function removePhoto(img) {
    forgetImage(img)
    updateContent(c => ({ ...c, photos: c.photos.filter(p => p.key !== img.key) }))
  }

  function removeSectionImage(sectionKey, img) {
    forgetImage(img)
    updateContent(c => ({
      ...c,
      sections: c.sections.map(s => (s.key === sectionKey ? { ...s, images: s.images.filter(i => i.key !== img.key) } : s)),
    }))
  }

  function addSection() {
    updateContent(c => ({ ...c, sections: [...c.sections, emptySection()] }))
  }

  function removeSection(section) {
    const label = section.title.trim() ? `"${section.title.trim()}"` : 'this section'
    const photos = section.images.length ? ` and its ${section.images.length} photo${section.images.length === 1 ? '' : 's'}` : ''
    if (!window.confirm(`Remove ${label}${photos}? This takes effect when you save.`)) return
    section.images.forEach(forgetImage)
    updateContent(c => ({ ...c, sections: c.sections.filter(s => s.key !== section.key) }))
  }

  function selectInspection(insp) {
    setLinkedInspId(insp.id)
    setShowInspSelector(false)
    setDirty(true)
  }

  function clearInspection() {
    setLinkedInspId('')
    setShowInspSelector(true)
    setForm(f => ({ ...f, part_number: '', supplier: '', po_number: '' }))
    setLinkedTemplate(null)
  }

  function handleCancel() {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    const savedId = id || createdNcr?.id
    navigate(savedId ? `/ncrs/${savedId}` : '/ncrs')
  }

  async function handleSave() {
    if (!form.description_of_defect.trim()) {
      showToast('Description of defect is required', 'error'); return
    }
    const problem = contentProblem(content)
    if (problem) { showToast(problem, 'error'); return }

    setSaving(true)
    try {
      // 1. The NCR itself.
      let saved = createdNcr
      if (!id && !createdNcr) {
        setSaveStatus('Creating NCR…')
        saved = await createNCR.mutateAsync({ ...form, inspection_id: linkedInspId || undefined })
        setCreatedNcr(saved)
      } else {
        setSaveStatus('Saving details…')
        saved = await updateNCR.mutateAsync({ id: id || createdNcr.id, ...form })
      }
      const ncrId = saved.id

      // 2. New photos, one at a time so a failure names the file.
      const uploads = pendingUploads(content)
      const uploadedIds = new Map()
      const failed = []
      for (let i = 0; i < uploads.length; i++) {
        setSaveStatus(`Uploading photo ${i + 1} of ${uploads.length}…`)
        try {
          const image = await uploadNCRImage(ncrId, uploads[i].file, uploads[i].caption.trim())
          uploadedIds.set(uploads[i].key, image.id)
        } catch (err) {
          failed.push(`${uploads[i].file.name}: ${await apiErrorMessage(err, 'upload failed')}`)
        }
      }
      // Record uploads straight away so a retry never uploads a photo twice.
      let next = markUploaded(content, uploadedIds)
      setContent(next)

      // 3. Sections, photo order and captions.
      setSaveStatus('Saving sections…')
      const layout = await saveContent.mutateAsync({ id: ncrId, ...buildContentPayload(next, removedImageIds) })
      next = assignSectionIds(next, layout)
      setContent(next)
      setRemovedImageIds([])

      if (failed.length) {
        showToast(`Saved, but ${failed.length} photo${failed.length === 1 ? '' : 's'} did not upload (${failed.join('; ')}). Save again to retry.`, 'error')
        return
      }
      setDirty(false)
      showToast(id ? `${saved.ncr_number} saved` : `${saved.ncr_number} created`, 'success')
      navigate(`/ncrs/${ncrId}`)
    } catch (err) {
      showToast(await apiErrorMessage(err, 'Save failed'), 'error')
    } finally {
      setSaving(false)
      setSaveStatus('')
    }
  }

  if (!isNew && isLoading) return <div className="p-4 sm:p-6 text-gray-400">Loading…</div>
  if (!isNew && (isError || !ncr)) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        <p className="text-red-500">Could not load this NCR.</p>
        <button onClick={() => navigate('/ncrs')} className="text-sm text-pdi-navy hover:underline">Back to NCRs</button>
      </div>
    )
  }

  const heading = createdNcr?.ncr_number || (isNew ? 'New NCR' : `Edit ${ncr?.ncr_number}`)

  return (
    <div className="min-h-full bg-gray-50/50">
      <datalist id={SECTION_TITLE_LIST_ID}>
        {NCR_SECTION_SUGGESTIONS.map(t => <option key={t} value={t} />)}
      </datalist>

      {/* Header — stacks on mobile */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="px-4 sm:px-6 pt-2 sm:pt-3 flex items-center gap-2 flex-wrap">
          <AlertTriangle size={16} className="text-orange-500 flex-shrink-0" />
          <span className="font-bold text-pdi-navy text-sm sm:text-base truncate">{heading}</span>
          {!isNew && ncr?.part_number && (
            <>
              <span className="text-gray-400 hidden sm:inline">·</span>
              <span className="text-xs sm:text-sm text-gray-600 truncate max-w-[40vw] sm:max-w-none">{ncr.part_number}</span>
            </>
          )}
          {saveStatus && <span className="text-xs text-gray-500 ml-auto">{saveStatus}</span>}
        </div>
        <div className="px-4 sm:px-6 py-2 sm:py-3 flex items-center gap-1.5 sm:gap-2 overflow-x-auto">
          <button
            onClick={handleSave}
            disabled={saving}
            title="Save"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 active:bg-orange-700 disabled:opacity-50 min-h-[40px] flex-shrink-0"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            <span className="hidden sm:inline">{saving ? 'Saving…' : 'Save'}</span>
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            title="Cancel"
            className="ml-auto flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 min-h-[40px] flex-shrink-0"
          >
            <X size={14} />
            <span className="hidden sm:inline">Cancel</span>
          </button>
        </div>
      </div>

      <div className="p-3 sm:p-6 space-y-3 sm:space-y-5">

        {/* ── Inspection Link (new NCRs, until first saved) ── */}
        {isNew && !createdNcr && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-pdi-navy flex items-center gap-2">
                <Link size={16} className="text-pdi-navy" /> Link to Inspection
              </h3>
              <span className="text-xs text-gray-400">Optional — pre-fills part details and shows failed items</span>
            </div>

            {linkedInspId && linkedInspection ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 sm:px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-pdi-navy truncate">{linkedInspection.form_no}</div>
                    <div className="text-xs text-gray-500 mt-0.5 break-words">
                      {COMPONENT_TYPE_LABELS[linkedInspection.component_type] || linkedInspection.component_type}
                      {linkedInspection.part_number && ` · ${linkedInspection.part_number}`}
                      {linkedInspection.po_number && ` · PO ${linkedInspection.po_number}`}
                      {' · '}{formatDate(linkedInspection.date_received || linkedInspection.created_at)}
                    </div>
                  </div>
                  <button
                    onClick={clearInspection}
                    className="text-xs text-gray-400 hover:text-red-500 min-h-[32px] min-w-[32px] flex items-center justify-center flex-shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Failed items from the inspection */}
                {failedItems.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Failed / Non-Conforming Items</div>
                    <div className="space-y-1.5">
                      {failedItems.map((item, i) => (
                        <div key={i} className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <AlertTriangle size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <span className="text-xs text-gray-500">{item.sectionTitle} · </span>
                              <span className="text-xs font-semibold text-red-700">{item.label}</span>
                              {item.notes && <div className="text-xs text-gray-500 mt-0.5 break-words">{item.notes}</div>}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => set('description_of_defect', form.description_of_defect
                              ? `${form.description_of_defect}\n${item.sectionTitle}: ${item.label}${item.notes ? ' — ' + item.notes : ''}`
                              : `${item.sectionTitle}: ${item.label}${item.notes ? ' — ' + item.notes : ''}`
                            )}
                            className="sm:ml-auto text-xs text-pdi-navy hover:underline whitespace-nowrap flex-shrink-0 self-start sm:self-auto min-h-[32px] flex items-center"
                          >
                            Add to description
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {failedItems.length === 0 && linkedTemplate && (
                  <p className="text-xs text-gray-400 italic">No failed items found in this inspection.</p>
                )}
              </div>
            ) : showInspSelector ? (
              <div className="space-y-3">
                <form onSubmit={e => { e.preventDefault(); setInspSearchActive(inspSearch) }} className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search by part #, PO #, or form number…"
                      value={inspSearch}
                      onChange={e => setInspSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 sm:flex-none px-3 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px]">Search</button>
                    <button type="button" onClick={() => setShowInspSelector(false)} className="flex-1 sm:flex-none px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">
                      Skip
                    </button>
                  </div>
                </form>
                {inspList.length > 0 && (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block border border-gray-200 rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                              {['Form No', 'Component', 'Part #', 'PO #', 'Date', 'Disposition', ''].map(h => (
                                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {inspList.map(insp => (
                              <tr key={insp.id} className="hover:bg-orange-50/40">
                                <td className="px-3 py-2 font-mono text-xs font-bold text-pdi-navy">{insp.form_no}</td>
                                <td className="px-3 py-2 text-xs">{COMPONENT_TYPE_LABELS[insp.component_type] || insp.component_type || '—'}</td>
                                <td className="px-3 py-2 font-mono text-xs">{insp.part_number || '—'}</td>
                                <td className="px-3 py-2 font-mono text-xs">{insp.po_number || '—'}</td>
                                <td className="px-3 py-2 text-xs text-gray-500">{formatDate(insp.date_received || insp.created_at)}</td>
                                <td className="px-3 py-2 text-xs">
                                  {insp.disposition
                                    ? <span className={`font-semibold ${['FAIL','REJECT'].includes(insp.disposition) ? 'text-red-600' : 'text-green-600'}`}>{insp.disposition}</span>
                                    : <span className="text-gray-400">—</span>
                                  }
                                </td>
                                <td className="px-3 py-2">
                                  <button onClick={() => selectInspection(insp)}
                                    className="text-xs text-pdi-navy hover:underline font-medium">Select</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Mobile card list */}
                    <div className="md:hidden space-y-2 border border-gray-200 rounded-lg p-2 bg-gray-50">
                      {inspList.map(insp => (
                        <button
                          key={insp.id}
                          onClick={() => selectInspection(insp)}
                          className="w-full text-left bg-white border border-gray-200 rounded-lg px-3 py-2 active:bg-orange-50 min-h-[60px]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-xs font-bold text-pdi-navy truncate">{insp.form_no}</div>
                              <div className="text-xs text-gray-600 mt-0.5 truncate">
                                {COMPONENT_TYPE_LABELS[insp.component_type] || insp.component_type || '—'}
                              </div>
                            </div>
                            {insp.disposition && (
                              <span className={`text-xs font-semibold flex-shrink-0 ${['FAIL','REJECT'].includes(insp.disposition) ? 'text-red-600' : 'text-green-600'}`}>
                                {insp.disposition}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-500">
                            <div className="truncate"><span className="text-gray-400">Part:</span> <span className="font-mono">{insp.part_number || '—'}</span></div>
                            <div className="truncate"><span className="text-gray-400">PO:</span> <span className="font-mono">{insp.po_number || '—'}</span></div>
                            <div className="col-span-2"><span className="text-gray-400">Date:</span> {formatDate(insp.date_received || insp.created_at)}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                <span className="text-sm text-gray-500">No inspection linked.</span>
                <button onClick={() => setShowInspSelector(true)} className="text-xs text-pdi-navy hover:underline self-start">Link an inspection</button>
              </div>
            )}
          </div>
        )}

        {/* NCR metadata (existing NCRs) */}
        {!isNew && ncr && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 text-sm">
              <div className="min-w-0"><div className="text-xs text-gray-400 mb-0.5">NCR Number</div><div className="font-bold text-pdi-navy font-mono truncate">{ncr.ncr_number}</div></div>
              <div className="min-w-0"><div className="text-xs text-gray-400 mb-0.5">Created By</div><div className="truncate">{ncr.created_by_name || '—'}</div></div>
              <div className="min-w-0 col-span-2 md:col-span-1"><div className="text-xs text-gray-400 mb-0.5">Created</div><div className="truncate">{formatDateTime(ncr.created_at)}</div></div>
              {ncr.inspection_id && (
                <div className="min-w-0 col-span-2 md:col-span-1">
                  <div className="text-xs text-gray-400 mb-0.5">Linked Inspection</div>
                  <button onClick={() => navigate(`/inspections/${ncr.inspection_id}`)} className="text-pdi-navy hover:underline text-sm truncate block max-w-full text-left">
                    {ncr.form_no || ncr.inspection_id}
                  </button>
                </div>
              )}
              {ncr.closed_at && (
                <div className="min-w-0 col-span-2 md:col-span-1"><div className="text-xs text-gray-400 mb-0.5">Closed</div><div className="truncate">{formatDateTime(ncr.closed_at)}</div></div>
              )}
            </div>
          </div>
        )}

        {/* Part / PO Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <h3 className="text-sm sm:text-base font-semibold text-pdi-navy mb-3 sm:mb-4">Part &amp; Supplier Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {[
              ['Part Number', 'part_number', 'text'],
              ['Supplier', 'supplier', 'text'],
              ['PO Number', 'po_number', 'text'],
              ['Quantity Affected', 'quantity_affected', 'number'],
            ].map(([label, key, type]) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                <input
                  type={type}
                  inputMode={type === 'number' ? 'numeric' : undefined}
                  value={form[key]}
                  onChange={e => set(key, e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Defect Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <h3 className="text-sm sm:text-base font-semibold text-pdi-navy mb-3 sm:mb-4">Defect Details</h3>
          <div className="mb-3 sm:mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Description of Defect <span className="text-red-500">*</span></label>
            <textarea
              rows={4}
              value={form.description_of_defect}
              onChange={e => set('description_of_defect', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[100px]"
              placeholder="Describe the non-conformance in detail…"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Severity</label>
              <select value={form.severity} onChange={e => set('severity', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]">
                {Object.entries(NCR_SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]">
                {Object.entries(NCR_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Photos — general captioned photos of the non-conformance */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 mb-3 sm:mb-4">
            <h3 className="text-sm sm:text-base font-semibold text-pdi-navy">Photos</h3>
            <span className="text-xs text-gray-400">Shown under the defect description, numbered as figures</span>
          </div>
          <NcrImageEditor
            images={content.photos}
            onChange={photos => updateContent(c => ({ ...c, photos }))}
            onRemove={removePhoto}
            onError={msg => showToast(msg, 'error')}
            disabled={saving}
          />
        </div>

        {/* Disposition & Corrective Action */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <h3 className="text-sm sm:text-base font-semibold text-pdi-navy mb-3 sm:mb-4">Disposition &amp; Corrective Action</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Disposition</label>
              <select value={form.ncr_disposition} onChange={e => set('ncr_disposition', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]">
                {Object.entries(NCR_DISPOSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Corrective Action Due Date</label>
              <input type="date" value={form.corrective_action_due_date} onChange={e => set('corrective_action_due_date', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
            </div>
          </div>
          <label className="flex items-center gap-2 mt-3 sm:mt-4 cursor-pointer min-h-[40px]">
            <input type="checkbox" checked={form.corrective_action_required} onChange={e => set('corrective_action_required', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-pdi-navy focus:ring-pdi-navy" />
            <span className="text-sm text-gray-700">Corrective action required from supplier</span>
          </label>
        </div>

        {/* User-created report sections */}
        <div className="space-y-3 sm:space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 px-1">
            <h3 className="text-sm sm:text-base font-semibold text-pdi-navy">Report Sections</h3>
            <span className="text-xs text-gray-400">e.g. Containment, Root Cause, Corrective Action — each with text and photos</span>
          </div>
          {content.sections.length === 0 && (
            <p className="text-sm text-gray-400 px-1">No sections yet.</p>
          )}
          {content.sections.map((section, i) => (
            <NcrSectionEditor
              key={section.key}
              section={section}
              index={i}
              count={content.sections.length}
              disabled={saving}
              onChange={next => updateContent(c => ({ ...c, sections: c.sections.map(s => (s.key === section.key ? next : s)) }))}
              onMove={delta => updateContent(c => ({ ...c, sections: moveItem(c.sections, i, delta) }))}
              onRemove={() => removeSection(section)}
              onRemoveImage={img => removeSectionImage(section.key, img)}
              onError={msg => showToast(msg, 'error')}
            />
          ))}
          <button
            type="button"
            onClick={addSection}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-pdi-navy bg-white border-2 border-dashed border-gray-200 rounded-xl hover:border-pdi-navy hover:bg-pdi-frost disabled:opacity-50 min-h-[48px]"
          >
            <Plus size={16} /> Add Section
          </button>
        </div>
      </div>
    </div>
  )
}
