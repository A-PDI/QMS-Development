import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusCircle, Search, SlidersHorizontal, X } from 'lucide-react'
import { useInspections } from '../hooks/useInspections'
import StatusBadge from '../components/StatusBadge'
import { formatDate } from '../lib/utils'
import { COMPONENT_TYPE_LABELS } from '../lib/constants'

export default function InspectionList() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState({ page: 1, limit: 20 })
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { data, isLoading } = useInspections(filters)

  function applySearch(e) {
    e.preventDefault()
    setFilters(f => ({ ...f, search, page: 1 }))
  }

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value || undefined, page: 1 }))
  }

  function clearFilters() {
    setFilters({ page: 1, limit: 20 })
    setSearch('')
  }

  const inspections = data?.inspections || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / (filters.limit || 20))

  // Count active filters (excluding pagination) for the mobile badge
  const activeFilterCount = ['status', 'component_type', 'date_from', 'date_to', 'search']
    .filter(k => filters[k]).length

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy">Inspections</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">{total} total records</p>
          </div>
          <button
            onClick={() => navigate('/inspections/new')}
            className="flex items-center gap-2 bg-pdi-navy text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-sm font-semibold hover:bg-pdi-navy-light shadow-sm transition-all flex-shrink-0"
            title="New Inspection"
          >
            <PlusCircle size={16} />
            <span className="hidden sm:inline">New Inspection</span>
          </button>
        </div>
      </div>
    <div className="p-4 sm:p-6 space-y-4">

      {/* Filters — mobile: search + filter toggle; tablet+: inline */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 space-y-3">
        {/* Search row — always visible */}
        <div className="flex gap-2">
          <form onSubmit={applySearch} className="flex gap-2 flex-1 min-w-0">
            <div className="relative flex-1 min-w-0">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Part #, PO, inspector…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button type="submit" className="px-3 py-2 text-sm bg-pdi-navy text-white rounded-lg flex-shrink-0 min-h-[40px]">
              Search
            </button>
          </form>
          {/* Filter toggle — only visible on mobile */}
          <button
            type="button"
            onClick={() => setFiltersOpen(o => !o)}
            className="sm:hidden flex items-center gap-1 px-3 py-2 text-sm border border-gray-200 rounded-lg relative min-h-[40px]"
            aria-label="Toggle filters"
          >
            <SlidersHorizontal size={15} />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-pdi-amber text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Filter controls — collapsible on mobile, inline on sm+ */}
        <div className={`${filtersOpen ? 'block' : 'hidden'} sm:flex sm:flex-wrap sm:gap-3 sm:items-end space-y-2 sm:space-y-0`}>
          <select
            className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
            onChange={e => setFilter('status', e.target.value)}
            value={filters.status || ''}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          <select
            className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
            onChange={e => setFilter('component_type', e.target.value)}
            value={filters.component_type || ''}
          >
            <option value="">All Components</option>
            {Object.entries(COMPONENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          <div className="flex gap-2 items-center">
            <input
              type="date"
              className="flex-1 sm:flex-initial px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
              onChange={e => setFilter('date_from', e.target.value)}
              value={filters.date_from || ''}
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              className="flex-1 sm:flex-initial px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
              onChange={e => setFilter('date_to', e.target.value)}
              value={filters.date_to || ''}
            />
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-2 sm:py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <X size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Results — table on md+, card list on mobile */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Component','Part Number','PO Number','Inspector','Date Received','Date Started','Status','Final Results'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={8} className="text-center text-gray-400 py-12">Loading…</td></tr>
              ) : inspections.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-gray-400 py-12">No inspections found</td></tr>
              ) : inspections.map(insp => (
                <tr
                  key={insp.id}
                  onClick={() => navigate(`/inspections/${insp.id}`)}
                  className="hover:bg-blue-50/50 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{COMPONENT_TYPE_LABELS[insp.component_type] || insp.component_type}</div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">{insp.form_no}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{insp.part_number || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{insp.po_number || '—'}</td>
                  <td className="px-4 py-3 text-sm">{insp.inspector_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(insp.date_received)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(insp.created_at)}</td>
                  <td className="px-4 py-3"><StatusBadge status={insp.status} /></td>
                  <td className="px-4 py-3">
                    {insp.disposition ? <StatusBadge disposition={insp.disposition} /> : <span className="text-gray-400 text-sm">—</span>}
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
          ) : inspections.length === 0 ? (
            <div className="text-center text-gray-400 py-12 text-sm">No inspections found</div>
          ) : inspections.map(insp => (
            <button
              key={insp.id}
              type="button"
              onClick={() => navigate(`/inspections/${insp.id}`)}
              className="w-full text-left px-4 py-3 hover:bg-blue-50/50 active:bg-blue-50 transition-colors min-h-[44px]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-800 text-sm truncate">{COMPONENT_TYPE_LABELS[insp.component_type] || insp.component_type}</div>
                  <div className="text-xs text-gray-400 font-mono mt-0.5 truncate">{insp.form_no}</div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <StatusBadge status={insp.status} />
                  {insp.disposition && <StatusBadge disposition={insp.disposition} />}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div className="min-w-0 truncate">
                  <span className="text-gray-400">Part: </span>
                  <span className="font-mono text-gray-700">{insp.part_number || '—'}</span>
                </div>
                <div className="min-w-0 truncate">
                  <span className="text-gray-400">PO: </span>
                  <span className="font-mono text-gray-700">{insp.po_number || '—'}</span>
                </div>
                <div className="min-w-0 truncate">
                  <span className="text-gray-400">By: </span>
                  <span className="text-gray-700">{insp.inspector_name || '—'}</span>
                </div>
                <div className="min-w-0 truncate">
                  <span className="text-gray-400">Received: </span>
                  <span className="text-gray-500">{formatDate(insp.date_received)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <span className="text-xs text-gray-500">Page {filters.page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                disabled={filters.page <= 1}
                onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                className="px-3 py-2 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50 min-h-[36px]"
              >
                Previous
              </button>
              <button
                disabled={filters.page >= totalPages}
                onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                className="px-3 py-2 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50 min-h-[36px]"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}
