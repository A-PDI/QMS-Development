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
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-pdi-navy flex items-center gap-2">
              <AlertTriangle size={22} className="text-orange-500" />
              Non Conformance Reports
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} total NCRs</p>
          </div>
          <button
            onClick={() => navigate('/ncrs/new')}
            className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-orange-600 active:bg-orange-700 shadow-sm"
          >
            <PlusCircle size={16} /> New NCR
          </button>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
          <form onSubmit={applySearch} className="flex gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="NCR#, part#, supplier…"
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy w-52"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button type="submit" className="px-3 py-1.5 text-sm bg-pdi-navy text-white rounded-lg">Search</button>
          </form>
          <select
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none"
            value={filters.status || ''}
            onChange={e => setFilter('status', e.target.value)}
          >
            <option value="">All Statuses</option>
            {Object.entries(NCR_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
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
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <span className="text-xs text-gray-500">Page {filters.page} of {totalPages}</span>
              <div className="flex gap-2">
                <button disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                  className="px-3 py-1 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button disabled={filters.page >= totalPages} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                  className="px-3 py-1 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
