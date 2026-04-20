import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Edit, Paperclip, Loader2, X, Printer, Mail, AlertTriangle, Bell, CheckSquare, UserPlus } from 'lucide-react'
import { useInspection, useAssignInspection } from '../hooks/useInspections'
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

  const [pdfLoading, setPdfLoading] = useState(false)
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

  return (
    <div>
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
              onClick={() => { setAssignUserId(inspection.assigned_to || ''); setAssignDueDate(inspection.due_date || ''); setShowAssignModal(true) }}
              title="Assign"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-slate-600 text-white rounded-lg hover:bg-slate-700 active:bg-slate-800 min-h-[40px] flex-shrink-0"
            >
              <UserPlus size={14} />
              <span className="hidden sm:inline">Assign</span>
            </button>
          )}
          {inspection.status === 'pending_review' && isAdminRole && (
            <button
              onClick={() => setShowReviewModal(true)}
              title="Review"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 active:bg-amber-700 min-h-[40px] flex-shrink-0"
            >
              <CheckSquare size={14} />
              <span className="hidden sm:inline">Review</span>
            </button>
          )}
          <button
            onClick={() => navigate(`/ncrs/new?inspection_id=${id}`)}
            title="NCR"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 active:bg-orange-700 min-h-[40px] flex-shrink-0"
          >
            <AlertTriangle size={14} />
            <span className="hidden sm:inline">NCR</span>
          </button>
          {inspection.status !== 'pending_review' && (
            <>
              <button
                onClick={handleDownloadPdf}
                disabled={pdfLoading}
                title="Print / PDF"
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 active:bg-purple-800 disabled:opacity-50 min-h-[40px] flex-shrink-0"
              >
                {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                <span className="hidden sm:inline">{pdfLoading ? 'Generating…' : 'Print'}</span>
              </button>
              <button
                onClick={handleEmail}
                title="Email"
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 active:bg-indigo-700 min-h-[40px] flex-shrink-0"
              >
                <Mail size={14} />
                <span className="hidden sm:inline">Email</span>
              </button>
            </>
          )}
          <button
            onClick={() => navigate('/inspections')}
            title="Close"
            className="ml-auto flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 active:bg-gray-200 min-h-[40px] flex-shrink-0"
          >
            <X size={14} />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto p-3 sm:p-6 space-y-3 sm:space-y-4">
        {/* Pending review notice */}
        {inspection.status === 'pending_review' && (
          <div className={`rounded-xl border p-3 sm:p-4 flex items-start gap-3 ${isAdminRole ? 'bg-amber-50 border-amber-200' : 'bg-amber-50 border-amber-200'}`}>
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-amber-800">Pending Admin Review</div>
              <div className="text-xs text-amber-700 mt-0.5">
                {isAdminRole
                  ? 'This inspection has Accepted items and needs your review before it can be printed or shared. Click "Review" to approve.'
                  : 'This inspection has been submitted and is awaiting admin review. Printing and sharing are locked until approved.'}
              </div>
            </div>
          </div>
        )}
        {/* Header details */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-2.5 sm:gap-y-3">
            {headerFields.map(field => inspection[field] && (
              <div key={field} className="min-w-0">
                <div className="text-xs text-gray-400">{HEADER_FIELD_LABELS[field] || field}</div>
                <div className="text-sm sm:text-base font-medium text-gray-800 break-words">{inspection[field]}</div>
              </div>
            ))}
            <div className="min-w-0">
              <div className="text-xs text-gray-400">Created</div>
              <div className="text-sm sm:text-base text-gray-800">{formatDate(inspection.created_at)}</div>
            </div>
            {inspection.submitted_at && (
              <div className="min-w-0">
                <div className="text-xs text-gray-400">Submitted</div>
                <div className="text-sm sm:text-base text-gray-800">{formatDateTime(inspection.submitted_at)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Sections (read-only) */}
        {Object.entries(sections).map(([key, section]) => {
          if (key === '__dimensional_added') return null
          // Skip optional sections unless the inspector added dimensional data
          if (section.optional && !sectionData.__dimensional_added) return null
          const Component = SECTION_COMPONENTS[section.section_type]
          if (!Component) return null
          return (
            <div key={key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 sm:px-5 py-3 sm:py-3.5 bg-pdi-frost">
                <span className="text-sm sm:text-base font-semibold text-pdi-navy">{section.title}</span>
              </div>
              <div className="p-3 sm:p-4">
                <Component section={section} data={sectionData[key]} readOnly />
              </div>
            </div>
          )
        })}

        {/* Final Results */}
        {inspection.disposition && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
            <div className="text-sm font-semibold text-gray-700 mb-2 sm:mb-3">Final Results</div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <span className={`px-4 sm:px-5 py-2 text-sm font-bold rounded-lg border-2 inline-block w-fit ${DISPOSITION_COLORS[inspection.disposition] || 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                {inspection.disposition}
              </span>
              {inspection.disposition_notes && (
                <p className="text-sm text-gray-600">{inspection.disposition_notes}</p>
              )}
            </div>
          </div>
        )}

        {/* Completed at */}
        {inspection.completed_at && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3 sm:p-4">
            <div className="text-sm font-semibold text-green-700 mb-0.5">Completed</div>
            <div className="text-xs text-gray-500">{formatDateTime(inspection.completed_at)}</div>
          </div>
        )}

        {/* Attachments */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-3 sm:px-5 py-3 sm:py-3.5 bg-pdi-frost">
            <span className="text-sm font-semibold text-pdi-navy">Attachments ({attachments.length})</span>
          </div>
          <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
            <FileUploadZone onUpload={handleUpload} />
            {attachments.map(att => (
              <div key={att.id} className="flex items-center justify-between gap-2 p-2.5 sm:p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Paperclip size={14} className="text-gray-400 flex-shrink-0" />
                  <a href={`/api/attachments/download/${att.id}`} target="_blank" rel="noreferrer" className="text-sm text-pdi-navy hover:underline truncate">
                    {att.file_name}
                  </a>
                  <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">{formatFileSize(att.file_size_bytes)}</span>
                </div>
                <button
                  onClick={() => deleteFile.mutateAsync({ id: att.id, inspectionId: id })}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 min-h-[32px] flex-shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
