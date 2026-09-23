import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle, Download, Loader2, Pencil, Printer, Trash2, X } from 'lucide-react'
import { useNCR, useUpdateNCR, useDeleteNCR, downloadNCRPdf, apiErrorMessage } from '../hooks/useNCRs'
import { useToast } from '../hooks/useToast'
import { getUser } from '../lib/auth'
import { isAdminUser } from '../lib/nav'
import { NCR_STATUS_COLORS, NCR_STATUS_LABELS, NCR_SEVERITY_COLORS, NCR_SEVERITY_LABELS } from '../lib/constants'
import NcrReport from '../components/ncr/NcrReport'
import NcrDeleteDialog from '../components/ncr/NcrDeleteDialog'

// Printing waits for the photos; if one never loads, print anyway after this.
const PRINT_FALLBACK_MS = 15000

function Badge({ value, colorMap, labelMap }) {
  const color = colorMap[value] || 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{labelMap[value] || value}</span>
}

const actionButton = 'flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm rounded-lg min-h-[40px] flex-shrink-0 disabled:opacity-50'

export default function NCRView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const canDelete = isAdminUser(getUser())

  const { data: ncr, isLoading, isError, error } = useNCR(id)
  const updateNCR = useUpdateNCR()
  const deleteNCR = useDeleteNCR()

  const [imagesReady, setImagesReady] = useState(false)
  const [printRequested, setPrintRequested] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const onReadyChange = useCallback(ready => setImagesReady(ready), [])

  // "Print" from the NCR list arrives as ?print=1.
  useEffect(() => {
    if (searchParams.get('print') !== '1') return
    setPrintRequested(true)
    const next = new URLSearchParams(searchParams)
    next.delete('print')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  // Open the print dialog once every photo has loaded.
  useEffect(() => {
    if (!printRequested || !ncr) return
    const go = () => { setPrintRequested(false); window.print() }
    const timer = setTimeout(go, imagesReady ? 150 : PRINT_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [printRequested, ncr, imagesReady])

  // The document title heads the printout and names "Save as PDF" output.
  useEffect(() => {
    if (!ncr?.ncr_number) return
    const previous = document.title
    document.title = `${ncr.ncr_number} Non-Conformance Report`
    return () => { document.title = previous }
  }, [ncr?.ncr_number])

  async function handleDownload() {
    setDownloading(true)
    try {
      if (await downloadNCRPdf(ncr)) showToast('PDF saved', 'success')
    } catch (err) {
      showToast(await apiErrorMessage(err, 'Failed to generate PDF'), 'error')
    } finally {
      setDownloading(false)
    }
  }

  async function handleMarkClosed() {
    setClosing(true)
    try {
      await updateNCR.mutateAsync({ id, status: 'closed' })
      showToast('NCR closed', 'success')
    } catch (err) {
      showToast(await apiErrorMessage(err, 'Failed to close NCR'), 'error')
    } finally {
      setClosing(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteNCR.mutateAsync(id)
      showToast(`${ncr.ncr_number} deleted`, 'success')
      navigate('/ncrs', { replace: true })
    } catch (err) {
      showToast(await apiErrorMessage(err, 'Failed to delete NCR'), 'error')
      setDeleting(false)
      setShowDelete(false)
    }
  }

  if (isLoading) return <div className="p-4 sm:p-6 text-gray-400">Loading…</div>
  if (isError || !ncr) {
    const notFound = error?.response?.status === 404
    return (
      <div className="p-4 sm:p-6 space-y-3">
        <p className="text-red-500">{notFound ? 'NCR not found.' : 'Could not load this NCR.'}</p>
        <button onClick={() => navigate('/ncrs')} className="text-sm text-pdi-navy hover:underline">Back to NCRs</button>
      </div>
    )
  }

  const printing = printRequested && !imagesReady

  return (
    <div className="min-h-full bg-gray-50/50 print:bg-white">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm print:hidden">
        <div className="px-4 sm:px-6 pt-2 sm:pt-3 flex items-center gap-2 flex-wrap">
          <AlertTriangle size={16} className="text-orange-500 flex-shrink-0" />
          <span className="font-bold text-pdi-navy text-sm sm:text-base font-mono">{ncr.ncr_number}</span>
          {ncr.part_number && (
            <>
              <span className="text-gray-400 hidden sm:inline">·</span>
              <span className="text-xs sm:text-sm text-gray-600 truncate max-w-[40vw] sm:max-w-none">{ncr.part_number}</span>
            </>
          )}
          <Badge value={ncr.status} colorMap={NCR_STATUS_COLORS} labelMap={NCR_STATUS_LABELS} />
          <Badge value={ncr.severity} colorMap={NCR_SEVERITY_COLORS} labelMap={NCR_SEVERITY_LABELS} />
        </div>
        <div className="px-4 sm:px-6 py-2 sm:py-3 flex items-center gap-1.5 sm:gap-2 overflow-x-auto">
          <button onClick={() => navigate(`/ncrs/${id}/edit`)} title="Edit"
            className={`${actionButton} bg-orange-500 text-white hover:bg-orange-600 active:bg-orange-700`}>
            <Pencil size={14} /><span className="hidden sm:inline">Edit</span>
          </button>
          <button onClick={handleDownload} disabled={downloading} title="Download PDF"
            className={`${actionButton} bg-white border border-gray-200 text-gray-700 hover:bg-gray-50`}>
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            <span className="hidden sm:inline">Download PDF</span>
          </button>
          <button onClick={() => setPrintRequested(true)} disabled={printRequested} title="Print"
            className={`${actionButton} bg-white border border-gray-200 text-gray-700 hover:bg-gray-50`}>
            {printing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            <span className="hidden sm:inline">{printing ? 'Preparing…' : 'Print'}</span>
          </button>
          {ncr.status !== 'closed' && (
            <button onClick={handleMarkClosed} disabled={closing} title="Mark Closed"
              className={`${actionButton} bg-green-600 text-white hover:bg-green-700 active:bg-green-800`}>
              <CheckCircle size={14} /><span className="hidden sm:inline">Mark Closed</span>
            </button>
          )}
          {canDelete && (
            <button onClick={() => setShowDelete(true)} title="Delete"
              className={`${actionButton} bg-white border border-red-200 text-red-500 hover:bg-red-50`}>
              <Trash2 size={14} /><span className="hidden sm:inline">Delete</span>
            </button>
          )}
          <button onClick={() => navigate('/ncrs')} title="Close"
            className={`${actionButton} ml-auto border border-gray-200 hover:bg-gray-50 active:bg-gray-100`}>
            <X size={14} /><span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto p-3 sm:p-6 print:p-0 print:max-w-none">
        <NcrReport ncr={ncr} onReadyChange={onReadyChange} />
        {ncr.inspection_id && (
          <p className="mt-3 text-xs text-gray-500 print:hidden">
            Linked inspection:{' '}
            <button onClick={() => navigate(`/inspections/${ncr.inspection_id}`)} className="text-pdi-navy hover:underline">
              {ncr.form_no || 'View inspection'}
            </button>
          </p>
        )}
      </div>

      {showDelete && (
        <NcrDeleteDialog ncr={ncr} deleting={deleting} onCancel={() => setShowDelete(false)} onConfirm={handleDelete} />
      )}
    </div>
  )
}
