import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { ClipboardList, CheckSquare, AlertTriangle, TrendingUp, PlusCircle, Bell } from 'lucide-react'
import api from '../lib/api'
import { useInspections, useInspectionAlerts } from '../hooks/useInspections'
import { useNCRs } from '../hooks/useNCRs'
import { useQualityAlertCount } from '../hooks/useQualityAlerts'
import { getUser } from '../lib/auth'
import StatusBadge from '../components/StatusBadge'
import { formatDate } from '../lib/utils'
import { COMPONENT_TYPE_LABELS, NCR_SEVERITY_COLORS, NCR_SEVERITY_LABELS, NCR_STATUS_COLORS, NCR_STATUS_LABELS } from '../lib/constants'

const METRIC_CONFIGS = [
  { key: 'total_inspections',    label: 'Total Inspections',    icon: ClipboardList,  bg: 'bg-pdi-navy',  fg: 'text-white', filter: 'all',      filterLabel: 'All Inspections' },
  { key: 'open_inspections',     label: 'Open Inspections',     icon: ClipboardList,  bg: 'bg-pdi-amber', fg: 'text-white', filter: 'draft',    filterLabel: 'Open Inspections' },
  { key: 'completed_this_month', label: 'Completed This Month', icon: CheckSquare,    bg: 'bg-pdi-teal',  fg: 'text-white', filter: 'complete', filterLabel: 'Completed Inspections' },
  { key: 'open_ncrs',            label: 'Open NCRs',            icon: AlertTriangle,  bg: 'bg-pdi-red',   fg: 'text-white', filter: 'ncrs',     filterLabel: 'Open NCRs' },
]

const COMPONENT_COLORS = ['#1D2B4F', '#1A8C80', '#D4943A', '#C0392B', '#2A3F72', '#7C3AED']

const ACTION_LABELS = {
  started:   { label: 'Started',   color: 'bg-blue-100 text-blue-700' },
  edited:    { label: 'Edited',    color: 'bg-gray-100 text-gray-600' },
  printed:   { label: 'Printed',   color: 'bg-purple-100 text-purple-700' },
  emailed:   { label: 'Emailed',   color: 'bg-indigo-100 text-indigo-700' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-700' },
}

const PERIOD_OPTIONS = [
  { value: '3', label: 'Last 3 months',  period: 'month' },
  { value: '6', label: 'Last 6 months',  period: 'month' },
  { value: '12', label: 'Last 12 months', period: 'month' },
  { value: '8', label: 'Last 8 weeks',   period: 'week' },
]

function MetricCard({ label, value, icon: Icon, bg, fg, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border shadow-sm hover:shadow-md transition-all overflow-hidden focus:outline-none ${
        isActive ? 'border-pdi-navy ring-2 ring-pdi-navy/30' : 'border-gray-100'
      }`}
    >
      <div className={`${bg} px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between`}>
        <span className={`text-2xl sm:text-3xl font-bold ${fg}`}>{value ?? '—'}</span>
        <div className="p-1.5 sm:p-2 rounded-lg bg-white/20">
          <Icon size={18} className={fg} />
        </div>
      </div>
      <div className="px-4 sm:px-5 py-2.5 sm:py-3 bg-white">
        <span className="text-xs sm:text-sm font-medium text-gray-600 leading-tight block">{label}</span>
        {isActive && <span className="text-xs text-pdi-navy font-semibold">● filtered</span>}
      </div>
    </button>
  )
}

function NcrBadge({ value, colorMap, labelMap }) {
  const color = colorMap[value] || 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {labelMap[value] || value}
    </span>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const user = getUser()
  const [activeFilter, setActiveFilter] = useState(null)
  const [chartPeriodIdx, setChartPeriodIdx] = useState(1)

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => { const { data } = await api.get('/dashboard/stats'); return data },
  })

  const { data: qualityAlertCount = 0 } = useQualityAlertCount()
  const { data: inspectionAlerts = {} } = useInspectionAlerts()

  const chartPeriod = PERIOD_OPTIONS[chartPeriodIdx]
  const { data: chartRaw } = useQuery({
    queryKey: ['dashboard-chart', chartPeriod.period, chartPeriod.value],
    queryFn: async () => {
      const { data } = await api.get(`/dashboard/chart?period=${chartPeriod.period}&range=${chartPeriod.value}`)
      return data
    },
  })

  // Pivot chart rows into recharts shape
  const componentTypes = [...new Set((chartRaw?.rows || []).map(r => r.component_type))]
  const periodMap = {}
  for (const row of (chartRaw?.rows || [])) {
    if (!periodMap[row.period]) periodMap[row.period] = { period: row.period }
    const label = COMPONENT_TYPE_LABELS[row.component_type] || row.component_type
    periodMap[row.period][label] = (periodMap[row.period][label] || 0) + row.count
  }
  const chartData = Object.values(periodMap)

  // Inspections filtered by card click (non-NCR cards) — must be strict boolean for React Query v5
  const showInspections = activeFilter !== null && activeFilter !== 'ncrs'
  const showAllInspections = activeFilter === 'all'
  const inspectionFilter = showInspections
    ? (showAllInspections ? { limit: 50, page: 1 } : { status: activeFilter, limit: 50, page: 1 })
    : null
  const { data: filteredData, isLoading: filteredLoading } = useInspections(
    inspectionFilter,
    { enabled: showInspections }
  )
  const tableInspections = showInspections ? (filteredData?.inspections || []) : []

  // NCRs for the Open NCRs card
  const showNcrs = activeFilter === 'ncrs'
  const { data: ncrData, isLoading: ncrLoading } = useNCRs(
    { status: 'open', limit: 50 },
    { enabled: showNcrs }
  )
  const tableNcrs = showNcrs ? (ncrData?.ncrs || []) : []

  function handleCardClick(filter) {
    setActiveFilter(prev => prev === filter ? null : filter)
  }

  const activeConfig = METRIC_CONFIGS.find(m => m.filter === activeFilter)

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy">Dashboard</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
              <TrendingUp size={13} className="flex-shrink-0" />
              <span className="truncate">PDI Incoming Quality Inspection</span>
            </p>
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

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Quality Alerts Widget */}
        {qualityAlertCount !== undefined && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            {qualityAlertCount > 0 ? (
              <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-5 py-3 sm:py-4">
                <div className="flex items-start sm:items-center justify-between gap-3">
                  <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
                    <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5 sm:mt-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-900">
                        {qualityAlertCount} unacknowledged quality alert{qualityAlertCount !== 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-amber-700 mt-0.5">Review these alerts for product quality concerns</p>
                    </div>
                  </div>
                  <button
                    onClick={() => navigate('/quality-alerts')}
                    className="flex-shrink-0 text-xs text-amber-700 hover:text-amber-900 font-semibold underline min-h-[32px] min-w-[60px] text-right"
                  >
                    View All →
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border-b border-green-200 px-4 sm:px-5 py-3 sm:py-4">
                <div className="flex items-center gap-2">
                  <CheckSquare size={18} className="text-green-600" />
                  <p className="text-sm font-medium text-green-700">No open quality alerts</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {METRIC_CONFIGS.map(({ key, label, icon, bg, fg, filter }) => (
            <MetricCard key={key} label={label} value={stats?.[key]} icon={icon} bg={bg} fg={fg}
              isActive={activeFilter === filter}
              onClick={() => handleCardClick(filter)}
            />
          ))}
        </div>

        {/* Filtered inspection table */}
        {showInspections && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b border-gray-100 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-1 h-5 bg-pdi-navy rounded-full flex-shrink-0" />
                <h2 className="text-sm sm:text-base font-semibold text-gray-800 truncate">{activeConfig?.filterLabel}</h2>
                <span className="text-xs text-gray-400 flex-shrink-0">({tableInspections.length})</span>
              </div>
              <button onClick={() => navigate('/inspections')} className="text-xs text-pdi-navy hover:underline font-medium flex-shrink-0">View all →</button>
            </div>
            {filteredLoading ? (
              <div className="text-center text-gray-400 text-sm py-10">Loading…</div>
            ) : tableInspections.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-10">No matching inspections</div>
            ) : (
              <>
                {/* Desktop table — hidden on mobile */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['Component', 'Part Number', 'PO Number', 'Inspector', 'Date Received', 'Status'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {tableInspections.map(insp => (
                        <tr key={insp.id} onClick={() => navigate(`/inspections/${insp.id}`)} className="hover:bg-blue-50/50 cursor-pointer">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-800">{COMPONENT_TYPE_LABELS[insp.component_type] || insp.component_type || '—'}</div>
                            <div className="text-xs text-gray-400 font-mono mt-0.5">{insp.form_no}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-700">{insp.part_number || '—'}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-700">{insp.po_number || '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">{insp.inspector_name || '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{formatDate(insp.date_received || insp.created_at)}</td>
                          <td className="px-4 py-3"><StatusBadge status={insp.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile card list — hidden on md and up */}
                <div className="md:hidden divide-y divide-gray-100">
                  {tableInspections.map(insp => (
                    <button
                      key={insp.id}
                      type="button"
                      onClick={() => navigate(`/inspections/${insp.id}`)}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50/50 active:bg-blue-50 transition-colors min-h-[44px]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-800 text-sm truncate">{COMPONENT_TYPE_LABELS[insp.component_type] || insp.component_type || '—'}</div>
                          <div className="text-xs text-gray-400 font-mono mt-0.5 truncate">{insp.form_no}</div>
                        </div>
                        <div className="flex-shrink-0"><StatusBadge status={insp.status} /></div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <div className="min-w-0">
                          <span className="text-gray-400">Part: </span>
                          <span className="font-mono text-gray-700">{insp.part_number || '—'}</span>
                        </div>
                        <div className="min-w-0">
                          <span className="text-gray-400">PO: </span>
                          <span className="font-mono text-gray-700">{insp.po_number || '—'}</span>
                        </div>
                        <div className="min-w-0 truncate">
                          <span className="text-gray-400">By: </span>
                          <span className="text-gray-700">{insp.inspector_name || '—'}</span>
                        </div>
                        <div className="min-w-0 truncate">
                          <span className="text-gray-400">On: </span>
                          <span className="text-gray-500">{formatDate(insp.date_received || insp.created_at)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Filtered NCR table */}
        {showNcrs && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b border-gray-100 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-1 h-5 bg-pdi-red rounded-full flex-shrink-0" />
                <h2 className="text-sm sm:text-base font-semibold text-gray-800 truncate">Open NCRs</h2>
                <span className="text-xs text-gray-400 flex-shrink-0">({tableNcrs.length})</span>
              </div>
              <button onClick={() => navigate('/ncrs')} className="text-xs text-pdi-navy hover:underline font-medium flex-shrink-0">View all →</button>
            </div>
            {ncrLoading ? (
              <div className="text-center text-gray-400 text-sm py-10">Loading…</div>
            ) : tableNcrs.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-10">No open NCRs</div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['NCR #', 'Part Number', 'Supplier', 'Description', 'Severity', 'Status', 'Created'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {tableNcrs.map(ncr => (
                        <tr key={ncr.id} onClick={() => navigate(`/ncrs/${ncr.id}`)} className="hover:bg-orange-50/40 cursor-pointer">
                          <td className="px-4 py-3 font-mono text-xs font-bold text-pdi-navy">{ncr.ncr_number}</td>
                          <td className="px-4 py-3 font-mono text-xs">{ncr.part_number || '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">{ncr.supplier || '—'}</td>
                          <td className="px-4 py-3 text-sm max-w-xs truncate text-gray-700">{ncr.description_of_defect}</td>
                          <td className="px-4 py-3">
                            <NcrBadge value={ncr.severity} colorMap={NCR_SEVERITY_COLORS} labelMap={NCR_SEVERITY_LABELS} />
                          </td>
                          <td className="px-4 py-3">
                            <NcrBadge value={ncr.status} colorMap={NCR_STATUS_COLORS} labelMap={NCR_STATUS_LABELS} />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{formatDate(ncr.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile card list */}
                <div className="md:hidden divide-y divide-gray-100">
                  {tableNcrs.map(ncr => (
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
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                        <span className="text-gray-500 truncate">{ncr.supplier || '—'}</span>
                        <span className="text-gray-400 flex-shrink-0">{formatDate(ncr.created_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Admin Alerts Section — only shown for admin/qc_manager */}
        {user && (user.role === 'admin' || user.role === 'qc_manager') && inspectionAlerts && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Past Due */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 sm:px-5 py-3 sm:py-3.5 border-b border-gray-200 bg-gray-50">
                <div className="w-1 h-5 bg-red-500 rounded-full flex-shrink-0" />
                <h3 className="text-sm sm:text-base font-semibold text-gray-800">Past Due Inspections</h3>
                <span className="text-xs text-gray-400 flex-shrink-0">({(inspectionAlerts.past_due || []).length})</span>
              </div>
              {(inspectionAlerts.past_due || []).length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-8 px-4">No past due inspections</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {(inspectionAlerts.past_due || []).slice(0, 5).map(insp => (
                    <button
                      key={insp.id}
                      onClick={() => navigate(`/inspections/${insp.id}`)}
                      className="w-full text-left px-4 sm:px-5 py-3 hover:bg-red-50/50 transition-colors min-h-[44px] flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs font-bold text-pdi-navy">{insp.form_no}</div>
                        <div className="font-mono text-xs text-gray-600 mt-0.5">{insp.part_number || '—'}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs text-red-600 font-semibold">{formatDate(insp.due_date)}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{insp.assigned_to_name || '—'}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Short Duration */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 sm:px-5 py-3 sm:py-3.5 border-b border-gray-200 bg-gray-50">
                <div className="w-1 h-5 bg-orange-500 rounded-full flex-shrink-0" />
                <h3 className="text-sm sm:text-base font-semibold text-gray-800">Short Duration Completions</h3>
                <span className="text-xs text-gray-400 flex-shrink-0">({(inspectionAlerts.short_duration || []).length})</span>
              </div>
              {(inspectionAlerts.short_duration || []).length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-8 px-4">No short duration completions</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {(inspectionAlerts.short_duration || []).slice(0, 5).map(insp => (
                    <button
                      key={insp.id}
                      onClick={() => navigate(`/inspections/${insp.id}`)}
                      className="w-full text-left px-4 sm:px-5 py-3 hover:bg-orange-50/50 transition-colors min-h-[44px] flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs font-bold text-pdi-navy">{insp.form_no}</div>
                        <div className="font-mono text-xs text-gray-600 mt-0.5">{insp.part_number || '—'}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs text-orange-600 font-semibold">{insp.assigned_to_name || '—'}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {insp.started_at && insp.completed_at
                            ? `${Math.round((new Date(insp.completed_at) - new Date(insp.started_at)) / 60000)} min`
                            : '—'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Trend Chart */}
        {chartData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <h2 className="text-sm sm:text-base font-semibold text-gray-800">Inspection Trend</h2>
              <div className="flex gap-1">
                {PERIOD_OPTIONS.map((opt, idx) => (
                  <button
                    key={opt.value}
                    onClick={() => setChartPeriodIdx(idx)}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      chartPeriodIdx === idx
                        ? 'bg-pdi-navy text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {componentTypes.map((ct, i) => (
                  <Line
                    key={ct}
                    type="monotone"
                    dataKey={COMPONENT_TYPE_LABELS[ct] || ct}
                    stroke={COMPONENT_COLORS[i % COMPONENT_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

      </div>
    </div>
  )
}
