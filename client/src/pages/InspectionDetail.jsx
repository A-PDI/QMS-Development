import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Edit, Paperclip, Loader2, X, Printer, Mail, AlertTriangle } from 'lucide-react'
import { useInspection } from '../hooks/useInspections'
import { useTemplate } from '../hooks/useTemplates'
import { useAttachments, useUploadAttachment, useDeleteAttachment } from '../hooks/useAttachments'
import { useToast } from '../hooks/useToast'
import { getUser } from '../lib/auth'
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
import api from '../lib/api'

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

  if (loadingInsp || loadingTpl) return <div className="p-6 text-gray-400">Loading…</div>
  if (!inspection || !template) return <div className="p-6 text-red-500">Not found</div>

  const sections = typeof template.sections === 'string' ? JSON.parse(template.sections) : template.sections
  const sectionData = typeof inspection.section_data === 'string'
    ? JSON.parse(inspection.section_data || '{}')
    : (inspection.section_data || {})
  const headerFields = typeof template.header_schema === 'string' ? JSON.parse(template.header_schema) : template.header_schema
  const canEdit = inspection.status === 'draft'

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-sm font-bold text-pdi-navy">{template.form_no}</span>
          <span className="text-gray-400">·</span>
          <span className="text-sm text-gray-700">{inspection.part_number || 'No part #'}</span>
          {inspection.po_number && <><span className="text-gray-400">·</span><span className="text-sm text-gray-500">PO {inspection.po_number}</span></>}
          <StatusBadge status={inspection.status} />
          {inspection.disposition && <StatusBadge disposition={inspection.disposition} />}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <button
              onClick={() => navigate(`/inspections/${id}/edit`)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light active:bg-pdi-navy"
            >
              <Edit size={14} />
              Edit
            </button>
          )}
          <button
            onClick={() => navigate(`/ncrs/new?inspection_id=${id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 active:bg-orange-700"
          >
            <AlertTriangle size={14} />
            NCR
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 active:bg-purple-800 disabled:opacity-50"
          >
            {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            {pdfLoading ? 'Generating…' : 'Print'}
          </button>
          <button
            onClick={handleEmail}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 active:bg-indigo-700"
          >
            <Mail size={14} />
            Email
          </button>
          <button
            onClick={() => navigate('/inspections')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 active:bg-gray-200"
          >
            <X size={14} />
            Close
          </button>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto p-6 space-y-4">
        {/* Header details */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
            {headerFields.map(field => inspection[field] && (
              <div key={field}>
                <div className="text-xs text-gray-400">{HEADER_FIELD_LABELS[field] || field}</div>
                <div className="text-base font-medium text-gray-800">{inspection[field]}</div>
              </div>
            ))}
            <div>
              <div className="text-xs text-gray-400">Created</div>
              <div className="text-base text-gray-800">{formatDate(inspection.created_at)}</div>
            </div>
            {inspection.submitted_at && (
              <div>
                <div className="text-xs text-gray-400">Submitted</div>
                <div className="text-base text-gray-800">{formatDateTime(inspection.submitted_at)}</div>
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
              <div className="px-5 py-3.5 bg-pdi-frost">
                <span className="text-base font-semibold text-pdi-navy">{section.title}</span>
              </div>
              <div className="p-4">
                <Component section={section} data={sectionData[key]} readOnly />
              </div>
            </div>
          )
        })}

        {/* Final Results */}
        {inspection.disposition && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-sm font-semibold text-gray-700 mb-3">Final Results</div>
            <div className="flex items-center gap-3">
              <span className={`px-5 py-2 text-sm font-bold rounded-lg border-2 ${DISPOSITION_COLORS[inspection.disposition] || 'bg-gray-100 text-gray-700 border-gray-300'}`}>
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
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="text-sm font-semibold text-green-700 mb-0.5">Completed</div>
            <div className="text-xs text-gray-500">{formatDateTime(inspection.completed_at)}</div>
          </div>
        )}

        {/* Attachments */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 bg-pdi-frost">
            <span className="text-sm font-semibold text-pdi-navy">Attachments ({attachments.length})</span>
          </div>
          <div className="p-4 space-y-3">
            <FileUploadZone onUpload={handleUpload} />
            {attachments.map(att => (
              <div key={att.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="flex items-center gap-2">
                  <Paperclip size={14} className="text-gray-400" />
                  <a href={`/api/attachments/download/${att.id}`} target="_blank" rel="noreferrer" className="text-sm text-pdi-navy hover:underline">
                    {att.file_name}
                  </a>
                  <span className="text-xs text-gray-400">{formatFileSize(att.file_size_bytes)}</span>
                </div>
                <button onClick={() => deleteFile.mutateAsync({ id: att.id, inspectionId: id })} className="text-xs text-red-400 hover:text-red-600">
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
