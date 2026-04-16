import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusCircle, Search } from 'lucide-react'
import { useInspections } from '../hooks/useInspections'
import StatusBadge from '../components/StatusBadge'
import { formatDate } from '../lib/utils'
import { COMPONENT_TYPE_LABELS } from '../lib/constants'

export default function InspectionList() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState({ page: 1, limit: 20 })
  const [search, setSearch] = useState('')
  const { data, isLoading } = useInspections(filters)

  function applySearch(e) {
    e.preventDefault()
    setFilters(f => ({ ...f, search, page: 1 }))
  }

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value || undefined, page: 1 }))
  }

  const inspections = data?.inspections || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / (filters.limit || 20))

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-pdi-navy">Inspections</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} total records</p>
          </div>
          <button
            onClick={() => navigate('/inspections/new')}
            className="flex items-center gap-2 bg-pdi-navy text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-pdi-navy-light shadow-sm transition-all"
          >
            <PlusCircle size={16} />
            New Inspection
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
              placeholder="Part #, PO, inspector…"
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy w-52"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button type="submit" className="px-3 py-1.5 text-sm bg-pdi-navy text-white rounded-lg">Search</button>
        </form>

        <select
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
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
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
          onChange={e => setFilter('component_type', e.target.value)}
          value={filters.component_type || ''}
        >
          <option value="">All Components</option>
          {Object.entries(COMPONENT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <input
          type="date"
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
          onChange={e => setFilter('date_from', e.target.value)}
          value={filters.date_from || ''}
        />
        <span className="text-gray-400 text-sm self-center">to</span>
        <input
          type="date"
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
          onChange={e => setFilter('date_to', e.target.value)}
          value={filters.date_to || ''}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <span className="text-xs text-gray-500">Page {filters.page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                disabled={filters.page <= 1}
                onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                className="px-3 py-1 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                disabled={filters.page >= totalPages}
                onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                className="px-3 py-1 text-xs border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
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
