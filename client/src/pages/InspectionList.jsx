'use strict'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusCircle, Search, SlidersHorizontal, X, Eye, Mail, Printer, Trash2, UserPlus, Loader2 } from 'lucide-react'
import { useInspections, useDeleteInspection, useAssignInspection } from '../hooks/useInspections'
import StatusBadge from '../components/StatusBadge'
import { formatDate } from '../lib/utils'
import { COMPONENT_TYPE_LABELS } from '../lib/constants'
import { getUser } from '../lib/auth'
import api from '../lib/api'

export default function InspectionList() {
  const navigate = useNavigate()
  const user = getUser()
  const isAdminRole = user && (user.role === 'admin' || user.role === 'qc_manager')
  const [filters, setFilters] = useState({ page: 1, limit: 20 })
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { data, isLoading } = useInspections(filters)
  const deleteInspection = useDeleteInspection()

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, form_no }
  const [deleting, setDeleting] = useState(false)

  // Assign modal state
  const [assignTarget, setAssignTarget] = useState(null) // inspection object
  const [assignUserId, setAssignUserId] = useState('')
  const [assignDueDate, setAssignDueDate] = useState('')
  const [assignSubmitting, setAssignSubmitting] = useState(false)
  const [usersList, setUsersList] = useState([])
  const [usersLoaded, setUsersLoaded] = useState(false)
  const assignInspection = useAssignInspection()

  // PDF loading state per row
  const [pdfLoadingId, setPdfLoadingId] = useState(null)

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

  async function openAssignModal(insp) {
    setAssignTarget(insp)
    setAssignUserId(insp.assigned_to ? String(insp.assigned_to) : '')
    setAssignDueDate(insp.due_date || '')
    if (!usersLoaded) {
      try {
        const r = await api.get('/admin/users')
        setUsersList(r.data?.users || [])
        setUsersLoaded(true)
      } catch (_) {}
    }
  }

  async function handleAssign() {
    if (!assignUserId || !assignTarget) return
    setAssignSubmitting(true)
    try {
      await assignInspection.mutateAsync({ id: assignTarget.id, assigned_to: assignUserId, due_date: assignDueDate || null })
      setAssignTarget(null)
    } catch (_) {}
    setAssignSubmitting(false)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteInspection.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
    } catch (_) {}
    setDeleting(false)
  }

  async function handlePrint(e, insp) {
    e.stopPropagation()
    setPdfLoadingId(insp.id)
    try {
      const response = await api.get(`/inspections/${insp.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      const po = (insp.po_number || 'NO-PO').replace(/[^a-zA-Z0-9-]/g, '')
      const part = (insp.part_number || 'NO-PART').replace(/[^a-zA-Z0-9-]/g, '')
      a.download = `QC-${po}-${part}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (_) {}
    setPdfLoadingId(null)
  }

  function handleEmail(e, insp) {
    e.stopPropagation()
    const subject = encodeURIComponent(`PDI Inspection ${insp.form_no} — ${insp.part_number || 'No part #'}`)
    const body = encodeURIComponent(
      `Please review the following inspection:\n\nForm: ${insp.form_no}\nPart Number: ${insp.part_number || '—'}\nPO Number: ${insp.po_number || '—'}\nInspector: ${insp.inspector_name || '—'}\nStatus: ${insp.status}\n\nView at: ${window.location.origin}/inspections/${insp.id}`
    )
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  const inspections = data?.inspections || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / (filters.limit || 20))

  const activeFilterCount = ['status', 'component_type', 'date_from', 'date_to', 'search']
    .filter(k => filters[k]).length

  return (
    <div className="min-h-full bg-gray-50/50">

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Delete Inspection?</h3>
            <p className="text-sm text-gray-600">
              Delete <span className="font-mono font-bold">{deleteTarget.form_no}</span>? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 min-h-[40px]">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign modal */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Assign Inspection</h3>
            <p className="text-sm text-gray-500 font-mono">{assignTarget.form_no}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Inspector</label>
                <select value={assignUserId} onChange={e => setAssignUserId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy">
                  <option value="">— Select inspector —</option>
                  {usersList.filter(u => u.active).map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role.replace('_', ' ')})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Due Date (optional)</label>
                <input type="date" value={assignDueDate} onChange={e => setAssignDueDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setAssignTarget(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">Cancel</button>
              <button onClick={handleAssign} disabled={!assignUserId || assignSubmitting}
                className="px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light disabled:opacity-50 min-h-[40px]">
                {assignSubmitting ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy">Inspections</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">{total} total records</p>
          </div>
          <button
            onClick={() => navigate('/inspections/new')}
            className="flex items-center gap-2 bg-pdi-navy text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-sm font-semibold hover:bg-pdi-navy-light shadow-sm transition-all flex-shrink-0"
          >
            <PlusCircle size={16} />
            <span className="hidden sm:inline">New Inspection</span>
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 space-y-3">
          <div className="flex gap-2">
            <form onSubmit={applySearch} className="flex gap-2 flex-1 min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Part #, PO, inspector…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <button type="submit" className="px-3 py-2 text-sm bg-pdi-navy text-white rounded-lg flex-shrink-0 min-h-[40px]">Search</button>
            </form>
            <button type="button" onClick={() => setFiltersOpen(o => !o)}
              className="sm:hidden flex items-center gap-1 px-3 py-2 text-sm border border-gray-200 rounded-lg relative min-h-[40px]">
              <SlidersHorizontal size={15} />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-pdi-amber text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>
              )}
            </button>
          </div>

          <div className={`${filtersOpen ? 'block' : 'hidden'} sm:flex sm:flex-wrap sm:gap-3 sm:items-end space-y-2 sm:space-y-0`}>
            <select className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
              onChange={e => setFilter('status', e.target.value)} value={filters.status || ''}>
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
              onChange={e => setFilter('component_type', e.target.value)} value={filters.component_type || ''}>
              <option value="">All Components</option>
              {Object.entries(COMPONENT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="flex gap-2 items-center">
              <input type="date"
                className="flex-1 sm:flex-initial px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                onChange={e => setFilter('date_from', e.target.value)} value={filters.date_from || ''} />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date"
                className="flex-1 sm:flex-initial px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                onChange={e => setFilter('date_to', e.target.value)} value={filters.date_to || ''} />
            </div>
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters}
                className="flex items-center gap-1 px-3 py-2 sm:py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                <X size={13} /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Component', 'Part Number', 'PO Number', 'Inspector', 'Date Received', 'Date Started', 'Status', 'Final Results'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                  {isAdminRole && (
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={isAdminRole ? 9 : 8} className="text-center text-gray-400 py-12">Loading…</td></tr>
                ) : inspections.length === 0 ? (
                  <tr><td colSpan={isAdminRole ? 9 : 8} className="text-center text-gray-400 py-12">No inspections found</td></tr>
                ) : inspections.map(insp => (
                  <tr key={insp.id} onClick={() => navigate(`/inspections/${insp.id}`)} className="hover:bg-blue-50/50 cursor-pointer">
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
                    {isAdminRole && (
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button onClick={() => navigate(`/inspections/${insp.id}`)} title="View"
                            className="p-1.5 text-pdi-navy hover:bg-pdi-frost rounded transition-colors">
                            <Eye size={14} />
                          </button>
                          <button onClick={() => openAssignModal(insp)} title="Assign"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors">
                            <UserPlus size={14} />
                          </button>
                          <button onClick={e => handleEmail(e, insp)} title="Email"
                            className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
                            <Mail size={14} />
                          </button>
                          <button onClick={e => handlePrint(e, insp)} title="Print PDF" disabled={pdfLoadingId === insp.id}
                            className="p-1.5 text-purple-600 hover:bg-purple-50 rounded transition-colors disabled:opacity-40">
                            {pdfLoadingId === insp.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                          </button>
                          <button onClick={() => setDeleteTarget({ id: insp.id, form_no: insp.form_no })} title="Delete"
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
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
              <div key={insp.id} className="px-4 py-3">
                <button type="button" onClick={() => navigate(`/inspections/${insp.id}`)}
                  className="w-full text-left hover:bg-blue-50/50 active:bg-blue-50 transition-colors min-h-[44px]">
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
                    <div className="min-w-0 truncate"><span className="text-gray-400">Part: </span><span className="font-mono text-gray-700">{insp.part_number || '—'}</span></div>
                    <div className="min-w-0 truncate"><span className="text-gray-400">PO: </span><span className="font-mono text-gray-700">{insp.po_number || '—'}</span></div>
                    <div className="min-w-0 truncate"><span className="text-gray-400">By: </span><span className="text-gray-700">{insp.inspector_name || '—'}</span></div>
                    <div className="min-w-0 truncate"><span className="text-gray-400">Received: </span><span className="text-gray-500">{formatDate(insp.date_received)}</span></div>
                  </div>
                </button>
                {isAdminRole && (
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
                    <button onClick={() => openAssignModal(insp)} className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50">
                      <UserPlus size={12} /> Assign
                    </button>
                    <button onClick={e => handleEmail(e, insp)} className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50">
                      <Mail size={12} /> Email
                    </button>
                    <button onClick={e => handlePrint(e, insp)} disabled={pdfLoadingId === insp.id} className="flex items-center gap-1 px-2 py-1 text-xs text-purple-600 border border-purple-200 rounded hover:bg-purple-50 disabled:opacity-40">
                      {pdfLoadingId === insp.id ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />} PDF
                    </button>
                    <button onClick={() => setDeleteTarget({ id: insp.id, form_no: insp.form_no })} className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50 ml-auto">
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
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
