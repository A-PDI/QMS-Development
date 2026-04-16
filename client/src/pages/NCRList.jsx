import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PlusCircle, Search, AlertTriangle } from 'lucide-react'
import { useNCRs } from '../hooks/useNCRs'
import { formatDate } from '../lib/utils'
import { NCR_STATUS_COLORS, NCR_STATUS_LABELS, NCR_SEVERITY_COLORS, NCR_SEVERITY_LABELS } from '../lib/constants'

function NcrBadge({ value, colorMap, labelMap, className = '' }) {
  const color = colorMap[value] || 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color} ${className}`}>
      {labelMap[value] || value}
    </span>
  )
}

export default function NCRList() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
                  {['NCR #', 'Part Number', 'Supplier', 'Description', 'Severity', 'Disposition', 'Status', 'Created', 'Closed'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={9} className="text-center text-gray-400 py-12">Loading…</td></tr>
                ) : ncrs.length === 0 ? (
                  <tr><td colSpan={9} className="text-center text-gray-400 py-12">No NCRs found</td></tr>
                ) : ncrs.map(ncr => (
                  <tr key={ncr.id} onClick={() => navigate(`/ncrs/${ncr.id}`)} className="hover:bg-orange-50/40 cursor-pointer">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-pdi-navy">{ncr.ncr_number}</td>
                    <td className="px-4 py-3 font-mono text-xs">{ncr.part_number || '—'}</td>
                    <td className="px-4 py-3 text-sm">{ncr.supplier || '—'}</td>
                    <td className="px-4 py-3 text-sm max-w-xs truncate">{ncr.description_of_defect}</td>
                    <td className="px-4 py-3">
                      <NcrBadge value={ncr.severity} colorMap={NCR_SEVERITY_COLORS} labelMap={NCR_SEVERITY_LABELS} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{ncr.ncr_disposition?.replace(/_/g, ' ') || '—'}</td>
                    <td className="px-4 py-3">
                      <NcrBadge value={ncr.status} colorMap={NCR_STATUS_COLORS} labelMap={NCR_STATUS_LABELS} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(ncr.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{ncr.closed_at ? formatDate(ncr.closed_at) : '—'}</td>
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
              <button
                key={ncr.id}
                type="button"
                onClick={() => navigate(`/ncrs/${ncr.id}`)}
                className="w-full text-left px-4 py-3 hover:bg-orange-50/40 active:bg-orange-50 transition-colors min-h-[44px]"
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
                    <span className="text-gray-700">{ncr.ncr_disposition?.replace(/_/g, ' ') || '—'}</span>
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
    </div>
  )
}
