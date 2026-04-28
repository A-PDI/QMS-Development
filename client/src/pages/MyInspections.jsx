import { useNavigate } from 'react-router-dom'
import { ClipboardList, AlertTriangle, CheckCircle, Calendar } from 'lucide-react'
import { useAssignedInspections } from '../hooks/useInspections'
import { formatDate } from '../lib/utils'
import { COMPONENT_TYPE_LABELS } from '../lib/constants'
import StatusBadge from '../components/StatusBadge'

function getDueDateColor(dueDate) {
  if (!dueDate) return 'text-gray-400 italic'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  const diff = due.getTime() - today.getTime()
  if (diff < 0) return 'text-red-600 font-semibold'
  if (diff === 0) return 'text-amber-600 font-semibold'
  return 'text-gray-600'
}

function DueDateBadge({ dueDate }) {
  if (!dueDate) return <span className={`text-xs ${getDueDateColor(null)}`}>No due date</span>
  return <span className={`text-xs ${getDueDateColor(dueDate)}`}>{formatDate(dueDate)}</span>
}

export default function MyInspections() {
  const navigate = useNavigate()
  const { data: inspections = [], isLoading } = useAssignedInspections()

  // Calculate stats
  const total = inspections.length
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueToday = inspections.filter(i => {
    if (!i.due_date) return false
    const due = new Date(i.due_date)
    due.setHours(0, 0, 0, 0)
    return due.getTime() === today.getTime()
  }).length
  const pastDue = inspections.filter(i => {
    if (!i.due_date) return false
    const due = new Date(i.due_date)
    due.setHours(0, 0, 0, 0)
    return due.getTime() < today.getTime()
  }).length
  const completedThisWeek = inspections.filter(i => {
    if (i.status !== 'complete' || !i.completed_at) return false
    const completed = new Date(i.completed_at)
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)
    return completed >= weekAgo
  }).length

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center gap-3">
          <ClipboardList size={24} className="text-pdi-navy flex-shrink-0" />
          <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy">My Inspections</h1>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Stats row */}
        {!isLoading && inspections.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Total Assigned</div>
              <div className="text-2xl sm:text-3xl font-bold text-pdi-navy">{total}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Due Today</div>
              <div className={`text-2xl sm:text-3xl font-bold ${dueToday > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{dueToday}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Past Due</div>
              <div className={`text-2xl sm:text-3xl font-bold ${pastDue > 0 ? 'text-red-600' : 'text-gray-400'}`}>{pastDue}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Completed This Week</div>
              <div className="text-2xl sm:text-3xl font-bold text-pdi-teal">{completedThisWeek}</div>
            </div>
          </div>
        )}

        {/* Inspections table/cards */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="text-center text-gray-400 text-sm py-12">Loading…</div>
          ) : inspections.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-12 px-4">
              <AlertTriangle size={32} className="mx-auto mb-3 opacity-40" />
              <p>No inspections assigned to you</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {['Form No', 'Component', 'Part Number', 'Status', 'Due Date', 'Assigned', 'Started'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {inspections.map(insp => (
                      <tr
                        key={insp.id}
                        onClick={() => navigate(`/inspections/${insp.id}/edit`)}
                        className="hover:bg-blue-50/50 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-800">{insp.form_no}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{COMPONENT_TYPE_LABELS[insp.component_type] || insp.component_type || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{insp.part_number || '—'}</td>
                        <td className="px-4 py-3"><StatusBadge status={insp.status} /></td>
                        <td className="px-4 py-3">
                          <DueDateBadge dueDate={insp.due_date} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{insp.assigned_at ? formatDate(insp.assigned_at) : '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{insp.started_at ? formatDate(insp.started_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-gray-100">
                {inspections.map(insp => (
                  <button
                    key={insp.id}
                    type="button"
                    onClick={() => navigate(`/inspections/${insp.id}/edit`)}
                    className="w-full text-left px-4 py-3 hover:bg-blue-50/50 active:bg-blue-50 transition-colors min-h-[44px]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-800 text-sm">{insp.form_no}</div>
                        <div className="text-xs text-gray-600 mt-1">{COMPONENT_TYPE_LABELS[insp.component_type] || insp.component_type || '—'}</div>
                      </div>
                      <div className="flex-shrink-0">
                        <StatusBadge status={insp.status} />
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div className="min-w-0">
                        <span className="text-gray-400">Part: </span>
                        <span className="font-mono text-gray-700">{insp.part_number || '—'}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-gray-400">Due: </span>
                        <DueDateBadge dueDate={insp.due_date} />
                      </div>
                      <div className="min-w-0 text-gray-500">{insp.assigned_at ? formatDate(insp.assigned_at) : '—'}</div>
                      <div className="text-right text-gray-500">{insp.started_at ? formatDate(insp.started_at) : '—'}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
