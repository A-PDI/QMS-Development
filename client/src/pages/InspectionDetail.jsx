import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Edit, Paperclip, Loader2, X, Printer, Mail, AlertTriangle, Bell, CheckSquare, UserPlus, Trash2 } from 'lucide-react'
import { useInspection, useAssignInspection, useDeleteInspection } from '../hooks/useInspections'
import { useTemplate } from '../hooks/useTemplates'
import { useAttachments, useUploadAttachment, useDeleteAttachment } from '../hooks/useAttachments'
import { useToast } from '../hooks/useToast'
import { getUser } from '../lib/auth'
import { useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
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
import { formatDate, formatDateTime, formatFileSize } from '../lib/utils'
import { HEADER_FIELD_LABELS, DISPOSITION_COLORS } from '../lib/constants'

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

export default function InspectionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const user = getUser()

  const { data: inspection, isLoading: loadingInsp } = useInspection(id)
  const { data: template, isLoading: loadingTpl } = useTemplate(inspection?.template_id)
  const { data: attachments = [] } = useAttachments(id)
  const uploadFile = useUploadAttachment()
  const deleteFile = useDeleteAttachment()

  const deleteInspection = useDeleteInspection()
  const [pdfLoading, setPdfLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const qc = useQueryClient()
  const isAdminRole = user && (user.role === 'admin' || user.role === 'qc_manager')
  const assignInspection = useAssignInspection()
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assignUserId, setAssignUserId] = useState('')
  const [assignDueDate, setAssignDueDate] = useState('')
  const [assignSubmitting, setAssignSubmitting] = useState(false)
  const [usersList, setUsersList] = useState([])

  useEffect(() => {
    if (isAdminRole) {
      api.get('/admin/users').then(r => setUsersList(r.data?.users || [])).catch(() => {})
    }
  }, [isAdminRole])

  async function handleAssign() {
    if (!assignUserId) return
    setAssignSubmitting(true)
    try {
      await assignInspection.mutateAsync({ id, assigned_to: assignUserId, due_date: assignDueDate || null })
      setShowAssignModal(false)
      showToast('Inspection assigned', 'success')
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to assign', 'error')
    } finally {
      setAssignSubmitting(false)
    }
  }

  function handleEmail() {
    const subject = encodeURIComponent(`PDI Inspection ${inspection.form_no} — ${inspection.part_number || 'No part #'}`)
    const body = encodeURIComponent(
      `Please review the following inspection:\n\nForm: ${inspection.form_no}\nPart Number: ${inspection.part_number || '—'}\nPO Number: ${inspection.po_number || '—'}\nInspector: ${inspection.inspector_name || '—'}\nStatus: ${inspection.status}\n\nView at: ${window.location.origin}/inspections/${id}`
    )
    window.open(`mailto:?subject=${subject}&body=${body}`)
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

  async function handleUpload(files) {
    for (const file of files) {
      try {
        await uploadFile.mutateAsync({ inspectionId: id, file })
      } catch {
        showToast(`Failed to upload ${file.name}`, 'error')
      }
    }
  }

  if (loadingInsp || loadingTpl) return <div className="p-4 sm:p-6 text-gray-400">Loading…</div>
  if (!inspection || !template) return <div className="p-4 sm:p-6 text-red-500">Not found</div>

  const sections = typeof template.sections === 'string' ? JSON.parse(template.sections) : template.sections
  const sectionData = typeof inspection.section_data === 'string'
    ? JSON.parse(inspection.section_data || '{}')
    : (inspection.section_data || {})
  const headerFields = typeof template.header_schema === 'string' ? JSON.parse(template.header_schema) : template.header_schema
  const canEdit = inspection.status === 'draft'

  async function handleReview(createAlert) {
    setReviewSubmitting(true)
    try {
      await api.post(`/inspections/${id}/review`, { create_alert: createAlert, alert_notes: reviewNotes })
      qc.invalidateQueries({ queryKey: ['inspection', id] })
      setShowReviewModal(false)
      showToast(createAlert ? 'Inspection approved and Quality Alert created' : 'Inspection approved', 'success')
    } catch (err) {
      showToast(err?.response?.data?.error || 'Review failed', 'error')
    } finally {
      setReviewSubmitting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteInspection.mutateAsync(id)
      navigate('/inspections')
    } catch (err) {
      showToast(err?.response?.data?.error || 'Delete failed', 'error')
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <div>
      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Delete Inspection?</h3>
            <p className="text-sm text-gray-600">
              Delete <span className="font-mono font-bold">{inspection.form_no}</span>? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 min-h-[40px]">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Assign modal for admins */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-pdi-navy/10 rounded-full flex items-center justify-center">
                <UserPlus size={18} className="text-pdi-navy" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Assign Inspection</h3>
                <p className="text-sm text-gray-500 mt-0.5">Assign this inspection to an inspector with an optional due date.</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Inspector</label>
                <select
                  value={assignUserId}
                  onChange={e => setAssignUserId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                >
                  <option value="">— Select inspector —</option>
                  {usersList.filter(u => u.active).map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role.replace('_', ' ')})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Due Date (optional)</label>
                <input
                  type="date"
                  value={assignDueDate}
                  onChange={e => setAssignDueDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAssignModal(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]"
              >Cancel</button>
              <button
                onClick={handleAssign}
                disabled={!assignUserId || assignSubmitting}
                className="px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px] disabled:opacity-50"
              >{assignSubmitting ? 'Assigning…' : 'Assign'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Review modal for admins */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <Bell size={18} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Review Inspection</h3>
                <p className="text-sm text-gray-600 mt-1">
                  This inspection has Accepted items. Approve it and optionally create a Quality Alert.
                </p>
              </div>
            </div>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy"
              rows={3}
              placeholder="Quality alert notes (optional)..."
              value={reviewNotes}
              onChange={e => setReviewNotes(e.target.value)}
            />
            <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
              <button
                onClick={() => setShowReviewModal(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReview(false)}
                disabled={reviewSubmitting}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 min-h-[40px] disabled:opacity-50"
              >
                Approve (No Alert)
              </button>
              <button
                onClick={() => handleReview(true)}
                disabled={reviewSubmitting}
                className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 min-h-[40px] disabled:opacity-50"
              >
                <Bell size={14} /> Approve + Quality Alert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header — stacks on mobile, single row on desktop */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        {/* Title line */}
        <div className="px-4 sm:px-6 pt-2 sm:pt-3 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs sm:text-sm font-bold text-pdi-navy">{template.form_no}</span>
          <span className="text-gray-400 hidden sm:inline">·</span>
          <span className="text-xs sm:text-sm text-gray-700 truncate max-w-[40vw] sm:max-w-none">{inspection.part_number || 'No part #'}</span>
          {inspection.po_number && (
            <>
              <span className="text-gray-400 hidden sm:inline">·</span>
              <span className="text-xs sm:text-sm text-gray-500 truncate max-w-[40vw] sm:max-w-none">PO {inspection.po_number}</span>
            </>
          )}
          <StatusBadge status={inspection.status} />
          {inspection.disposition && <StatusBadge disposition={inspection.disposition} />}
        </div>
        {/* Action bar — horizontally scrollable on mobile */}
        <div className="px-4 sm:px-6 py-2 sm:py-3 flex items-center gap-1.5 sm:gap-2 overflow-x-auto">
          {canEdit && (
            <button
              onClick={() => navigate(`/inspections/${id}/edit`)}
              title="Edit"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light active:bg-pdi-navy min-h-[40px] flex-shrink-0"
            >
              <Edit size={14} />
              <span className="hidden sm:inline">Edit</span>
            </button>
          )}
          {isAdminRole && canEdit && (
            <button
              onClick={() => { setAssignUserId(inspection.assigned_to ? String(inspection.assigned_to) : ''); setAssignDueDate(inspection.due_date || ''); setShowAssignModal(true) }}
              title="Assign"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 min-h-[40px] flex-shrink-0"
            >
              <UserPlus size={14} />
              <span className="hidden sm:inline">Assign</span>
            </button>
          )}
          <button
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            title="Print PDF"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 min-h-[40px] flex-shrink-0"
          >
            {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            <span className="hidden sm:inline">PDF</span>
          </button>
          <button
            onClick={handleEmail}
            title="Email"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 min-h-[40px] flex-shrink-0"
          >
            <Mail size={14} />
            <span className="hidden sm:inline">Email</span>
          </button>
          {isAdminRole && inspection.status === 'pending_review' && (
            <button
              onClick={() => setShowReviewModal(true)}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 min-h-[40px] flex-shrink-0"
            >
              <CheckSquare size={14} />
              <span className="hidden sm:inline">Review</span>
            </button>
          )}
          {isAdminRole && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-white border border-red-200 text-red-500 rounded-lg hover:bg-red-50 min-h-[40px] flex-shrink-0 ml-auto"
            >
              <Trash2 size={14} />
              <span className="hidden sm:inline">Delete</span>
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Header info */}
        {headerFields && headerFields.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">Inspection Details</h2>
            </div>
            <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              {headerFields.map(field => {
                const key = typeof field === 'string' ? field : field.key
                const label = HEADER_FIELD_LABELS[key] || key
                const value = inspection[key]
                return (
                  <div key={key}>
                    <div className="text-xs text-gray-500 mb-0.5">{label}</div>
                    <div className="text-sm font-medium text-gray-800">{value || '—'}</div>
                  </div>
                )
              })}
              {inspection.assigned_to_name && (
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Assigned To</div>
                  <div className="text-sm font-medium text-gray-800">{inspection.assigned_to_name}</div>
                </div>
              )}
              {inspection.due_date && (
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Due Date</div>
                  <div className="text-sm font-medium text-gray-800">{formatDate(inspection.due_date)}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section data */}
        {Object.entries(sections || {}).map(([key, section]) => {
          const SectionComp = SECTION_COMPONENTS[section.section_type]
          if (!SectionComp) return null
          return (
            <div key={key} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-700">{section.title || key}</h2>
              </div>
              <div className="p-4 sm:p-5">
                <SectionComp
                  section={section}
                  data={sectionData[key]}
                  onChange={() => {}}
                  readOnly={true}
                  sectionKey={key}
                  attachments={attachments}
                />
              </div>
            </div>
          )
        })}

        {/* Disposition */}
        {inspection.disposition && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">Disposition</h2>
            </div>
            <div className="p-4 sm:p-5 space-y-2">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${DISPOSITION_COLORS[inspection.disposition] || 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                {inspection.disposition}
              </span>
              {inspection.disposition_notes && (
                <p className="text-sm text-gray-600 mt-2">{inspection.disposition_notes}</p>
              )}
            </div>
          </div>
        )}

        {/* Attachments */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Paperclip size={14} />
              Attachments ({attachments.length})
            </h2>
          </div>
          <div className="p-4 sm:p-5 space-y-3">
            {canEdit && (
              <FileUploadZone onFiles={handleUpload} uploading={uploadFile.isPending} />
            )}
            {attachments.filter(a => !a.section_key && !a.item_id).length === 0 ? (
              <div className="text-sm text-gray-400">No attachments</div>
            ) : (
              <div className="space-y-2">
                {attachments.filter(a => !a.section_key && !a.item_id).map(att => (
                  <div key={att.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                    <div className="min-w-0 flex-1">
                      <a href={`/api/attachments/download/${att.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-pdi-navy hover:underline truncate block">{att.file_name}</a>
                      <div className="text-xs text-gray-400">{formatFileSize(att.file_size_bytes)} · {formatDateTime(att.uploaded_at)}</div>
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => deleteFile.mutate({ id: att.id, inspectionId: id })}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors flex-shrink-0"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quality alerts */}
        {inspection.quality_alerts && inspection.quality_alerts.length > 0 && (
          <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-600" />
              <h2 className="text-sm font-semibold text-amber-700">Quality Alerts ({inspection.quality_alerts.length})</h2>
            </div>
            <div className="divide-y divide-amber-100">
              {inspection.quality_alerts.map(alert => (
                <div key={alert.id} className="px-4 sm:px-5 py-3">
                  <div className="text-xs font-semibold text-amber-700">{alert.alert_type?.replace(/_/g, ' ')}</div>
                  {alert.notes && <div className="text-sm text-gray-600 mt-1">{alert.notes}</div>}
                  <div className="text-xs text-gray-400 mt-1">{formatDateTime(alert.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
