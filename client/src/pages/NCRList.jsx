import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PlusCircle, Search, AlertTriangle, Eye, Pencil, Download, Printer, Trash2, Loader2 } from 'lucide-react'
import { useNCRs, useDeleteNCR, downloadNCRPdf, apiErrorMessage } from '../hooks/useNCRs'
import { useToast } from '../hooks/useToast'
import { getUser } from '../lib/auth'
import { isAdminUser } from '../lib/nav'
import { formatDate } from '../lib/utils'
import { NCR_STATUS_COLORS, NCR_STATUS_LABELS, NCR_SEVERITY_COLORS, NCR_SEVERITY_LABELS, NCR_DISPOSITION_LABELS } from '../lib/constants'
import NcrDeleteDialog from '../components/ncr/NcrDeleteDialog'

function NcrBadge({ value, colorMap, labelMap, className = '' }) {
  const color = colorMap[value] || 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color} ${className}`}>
      {labelMap[value] || value}
    </span>
  )
}

function dispositionLabel(value) {
  return NCR_DISPOSITION_LABELS[value] || value?.replace(/_/g, ' ') || '—'
}

/** View · Edit · Download PDF · Print · Delete (admin-level users only). */
function RowActions({ ncr, canDelete, downloading, onView, onEdit, onDownload, onPrint, onDelete }) {
  const base = 'p-2 rounded-md border min-h-[36px] min-w-[36px] flex items-center justify-center disabled:opacity-40'
  const neutral = `${base} border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-pdi-navy`
  // Row clicks open the report; the buttons must not trigger that as well.
  const act = fn => e => { e.stopPropagation(); fn(ncr) }
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={act(onView)} title="View" aria-label={`View ${ncr.ncr_number}`} className={neutral}><Eye size={14} /></button>
      <button type="button" onClick={act(onEdit)} title="Edit" aria-label={`Edit ${ncr.ncr_number}`} className={neutral}><Pencil size={14} /></button>
      <button type="button" onClick={act(onDownload)} disabled={downloading} title="Download PDF" aria-label={`Download ${ncr.ncr_number} PDF`} className={neutral}>
        {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      </button>
      <button type="button" onClick={act(onPrint)} title="Print" aria-label={`Print ${ncr.ncr_number}`} className={neutral}><Printer size={14} /></button>
      {canDelete && (
        <button type="button" onClick={act(onDelete)} title="Delete" aria-label={`Delete ${ncr.ncr_number}`}
          className={`${base} border-red-200 text-red-500 hover:bg-red-50`}><Trash2 size={14} /></button>
      )}
    </div>
  )
}

export default function NCRList() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { showToast } = useToast()
  const canDelete = isAdminUser(getUser())
  const deleteNCR = useDeleteNCR()
  const [downloadingId, setDownloadingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [filters, setFilters] = useState({ page: 1, limit: 25, status: searchParams.get('status') || '' })
  const [search, setSearch] = useState('')

  const { data, isLoading } = useNCRs(filters)
  const ncrs = data?.ncrs || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / (filters.limit || 25))

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value || undefined, page: 1 }))
  }

  function applySearch(e) {
    e.preventDefault()
    setFilters(f => ({ ...f, search, page: 1 }))
  }

  async function handleDownload(ncr) {
    setDownloadingId(ncr.id)
    try {
      if (await downloadNCRPdf(ncr)) showToast(`${ncr.ncr_number} PDF saved`, 'success')
    } catch (err) {
      showToast(await apiErrorMessage(err, 'Failed to generate PDF'), 'error')
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteNCR.mutateAsync(pendingDelete.id)
      showToast(`${pendingDelete.ncr_number} deleted`, 'success')
    } catch (err) {
      showToast(await apiErrorMessage(err, 'Failed to delete NCR'), 'error')
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  const actions = {
    canDelete,
    onView: ncr => navigate(`/ncrs/${ncr.id}`),
    onEdit: ncr => navigate(`/ncrs/${ncr.id}/edit`),
    onDownload: handleDownload,
    onPrint: ncr => navigate(`/ncrs/${ncr.id}?print=1`),
    onDelete: ncr => setPendingDelete(ncr),
  }

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy flex items-center gap-2">
              <AlertTriangle size={20} className="text-orange-500 flex-shrink-0" />
              <span className="truncate">Non Conformance Reports</span>
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">{total} total NCRs</p>
          </div>
          <button
            onClick={() => navigate('/ncrs/new')}
            className="flex items-center gap-2 bg-orange-500 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-sm font-semibold hover:bg-orange-600 active:bg-orange-700 shadow-sm flex-shrink-0"
            title="New NCR"
          >
            <PlusCircle size={16} />
            <span className="hidden sm:inline">New NCR</span>
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:gap-3 sm:items-end">
          <form onSubmit={applySearch} className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="NCR#, part#, supplier…"
                className="w-full sm:w-52 pl-8 pr-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button type="submit" className="px-3 py-2 sm:py-1.5 text-sm bg-pdi-navy text-white rounded-lg flex-shrink-0 min-h-[40px] sm:min-h-0">Search</button>
          </form>
          <select
            className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none"
            value={filters.status || ''}
            onChange={e => setFilter('status', e.target.value)}
          >
            <option value="">All Statuses</option>
            {Object.entries(NCR_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        {/* Results */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['NCR #', 'Part Number', 'Supplier', 'Description', 'Severity', 'Disposition', 'Status', 'Created', 'Closed', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={10} className="text-center text-gray-400 py-12">Loading…</td></tr>
                ) : ncrs.length === 0 ? (
                  <tr><td colSpan={10} className="text-center text-gray-400 py-12">No NCRs found</td></tr>
                ) : ncrs.map(ncr => (
                  <tr key={ncr.id} onClick={() => navigate(`/ncrs/${ncr.id}`)} className="hover:bg-orange-50/40 cursor-pointer">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-pdi-navy">{ncr.ncr_number}</td>
                    <td className="px-4 py-3 font-mono text-xs">{ncr.part_number || '—'}</td>
                    <td className="px-4 py-3 text-sm">{ncr.supplier || '—'}</td>
                    <td className="px-4 py-3 text-sm max-w-xs truncate">{ncr.description_of_defect}</td>
                    <td className="px-4 py-3">
                      <NcrBadge value={ncr.severity} colorMap={NCR_SEVERITY_COLORS} labelMap={NCR_SEVERITY_LABELS} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{dispositionLabel(ncr.ncr_disposition)}</td>
                    <td className="px-4 py-3">
                      <NcrBadge value={ncr.status} colorMap={NCR_STATUS_COLORS} labelMap={NCR_STATUS_LABELS} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(ncr.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{ncr.closed_at ? formatDate(ncr.closed_at) : '—'}</td>
                    <td className="px-4 py-2">
                      <RowActions ncr={ncr} downloading={downloadingId === ncr.id} {...actions} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-gray-100">
            {isLoading ? (
              <div className="text-center text-gray-400 py-12 text-sm">Loading…</div>
            ) : ncrs.length === 0 ? (
              <div className="text-center text-gray-400 py-12 text-sm">No NCRs found</div>
            ) : ncrs.map(ncr => (
              <div key={ncr.id}>
              <button
                type="button"
                onClick={() => navigate(`/ncrs/${ncr.id}`)}
                className="w-full text-left px-4 pt-3 pb-2 hover:bg-orange-50/40 active:bg-orange-50 transition-colors min-h-[44px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-bold text-pdi-navy">{ncr.ncr_number}</div>
                    <div className="font-mono text-xs text-gray-500 mt-0.5 truncate">{ncr.part_number || '—'}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <NcrBadge value={ncr.severity} colorMap={NCR_SEVERITY_COLORS} labelMap={NCR_SEVERITY_LABELS} />
                    <NcrBadge value={ncr.status} colorMap={NCR_STATUS_COLORS} labelMap={NCR_STATUS_LABELS} />
                  </div>
                </div>
                <div className="mt-1.5 text-xs text-gray-700 line-clamp-2">{ncr.description_of_defect}</div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  <div className="min-w-0 truncate">
                    <span className="text-gray-400">Supplier: </span>
                    <span className="text-gray-700">{ncr.supplier || '—'}</span>
                  </div>
                  <div className="min-w-0 truncate">
                    <span className="text-gray-400">Disp: </span>
                    <span className="text-gray-700">{dispositionLabel(ncr.ncr_disposition)}</span>
                  </div>
                  <div className="min-w-0 truncate">
                    <span className="text-gray-400">Created: </span>
                    <span className="text-gray-500">{formatDate(ncr.created_at)}</span>
                  </div>
                  <div className="min-w-0 truncate">
                    <span className="text-gray-400">Closed: </span>
                    <span className="text-gray-500">{ncr.closed_at ? formatDate(ncr.closed_at) : '—'}</span>
                  </div>
                </div>
              </button>
              <div className="px-4 pb-3">
                <RowActions ncr={ncr} downloading={downloadingId === ncr.id} {...actions} />
              </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <span className="text-xs text-gray-500">Page {filters.page} of {totalPages}</span>
              <div className="flex gap-2">
                <button disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                  className="px-3 py-2 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50 min-h-[36px]">Previous</button>
                <button disabled={filters.page >= totalPages} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                  className="px-3 py-2 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50 min-h-[36px]">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <NcrDeleteDialog ncr={pendingDelete} deleting={deleting} onCancel={() => setPendingDelete(null)} onConfirm={handleDelete} />
      )}
    </div>
  )
}
