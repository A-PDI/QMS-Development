import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { ClipboardList, CheckSquare, AlertTriangle, TrendingUp, PlusCircle } from 'lucide-react'
import api from '../lib/api'
import { useInspections } from '../hooks/useInspections'
import { useNCRs } from '../hooks/useNCRs'
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
      <div className={`${bg} px-5 py-4 flex items-center justify-between`}>
        <span className={`text-3xl font-bold ${fg}`}>{value ?? '—'}</span>
        <div className="p-2 rounded-lg bg-white/20">
          <Icon size={20} className={fg} />
        </div>
      </div>
      <div className="px-5 py-3 bg-white">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        {isActive && <span className="ml-2 text-xs text-pdi-navy font-semibold">● filtered</span>}
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
  const [activeFilter, setActiveFilter] = useState(null)
  const [chartPeriodIdx, setChartPeriodIdx] = useState(1)

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => { const { data } = await api.get('/dashboard/stats'); return data },
  })

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
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-pdi-navy">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
              <TrendingUp size={13} /> PDI Incoming Quality Inspection System
            </p>
          </div>
          <button
            onClick={() => navigate('/inspections/new')}
            className="flex items-center gap-2 bg-pdi-navy text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-pdi-navy-light shadow-sm transition-all"
          >
            <PlusCircle size={16} /> New Inspection
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-1 h-5 bg-pdi-navy rounded-full" />
                <h2 className="text-base font-semibold text-gray-800">{activeConfig?.filterLabel}</h2>
                <span className="text-xs text-gray-400">({tableInspections.length} shown)</span>
              </div>
              <button onClick={() => navigate('/inspections')} className="text-xs text-pdi-navy hover:underline font-medium">View all →</button>
            </div>
            {filteredLoading ? (
              <div className="text-center text-gray-400 text-sm py-10">Loading…</div>
            ) : tableInspections.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-10">No matching inspections</div>
            ) : (
              <div className="overflow-x-auto">
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
            )}
          </div>
        )}

        {/* Filtered NCR table */}
        {showNcrs && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-1 h-5 bg-pdi-red rounded-full" />
                <h2 className="text-base font-semibold text-gray-800">Open NCRs</h2>
                <span className="text-xs text-gray-400">({tableNcrs.length} shown)</span>
              </div>
              <button onClick={() => navigate('/ncrs')} className="text-xs text-pdi-navy hover:underline font-medium">View all →</button>
            </div>
            {ncrLoading ? (
              <div className="text-center text-gray-400 text-sm py-10">Loading…</div>
            ) : tableNcrs.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-10">No open NCRs</div>
            ) : (
              <div className="overflow-x-auto">
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
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Line Chart — Inspections by Component over Time */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-1 h-5 bg-pdi-navy rounded-full" />
                <h2 className="text-base font-semibold text-gray-800">Inspections by Component</h2>
              </div>
              <select
                value={chartPeriodIdx}
                onChange={e => setChartPeriodIdx(Number(e.target.value))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pdi-navy"
              >
                {PERIOD_OPTIONS.map((opt, idx) => (
                  <option key={idx} value={idx}>{opt.label}</option>
                ))}
              </select>
            </div>
            {isLoading || !chartData.length ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                {isLoading ? 'Loading…' : 'No data for this period'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f4f8" />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {componentTypes.map((ct, idx) => (
                    <Line
                      key={ct}
                      type="monotone"
                      dataKey={COMPONENT_TYPE_LABELS[ct] || ct}
                      stroke={COMPONENT_COLORS[idx % COMPONENT_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-5 bg-pdi-amber rounded-full" />
              <h2 className="text-base font-semibold text-gray-800">Recent Activity</h2>
            </div>
            {isLoading ? (
              <div className="text-gray-400 text-sm">Loading…</div>
            ) : !(stats?.recent_activity?.length) ? (
              <div className="text-gray-400 text-sm text-center py-8">No recent activity</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {(stats.recent_activity || []).map((item, idx) => {
                  const actionDef = ACTION_LABELS[item.action_type] || { label: item.action_type, color: 'bg-gray-100 text-gray-600' }
                  return (
                    <div key={`${item.id}-${item.action_type}-${idx}`}
                      onClick={() => navigate(`/inspections/${item.id}`)}
                      className="flex items-start gap-3 py-2.5 px-1 hover:bg-pdi-frost rounded-lg cursor-pointer transition-colors"
                    >
                      <div className="w-24 flex-shrink-0">
                        <div className="text-xs font-semibold text-gray-800 truncate leading-tight">{item.actor_name || '—'}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`inline-block text-xs font-medium px-1.5 py-0.5 rounded mr-1 ${actionDef.color}`}>{actionDef.label}</span>
                        <span className="text-xs font-semibold text-pdi-navy">{item.part_number || item.form_no || '—'}</span>
                        <div className="text-xs text-gray-400 mt-0.5">{COMPONENT_TYPE_LABELS[item.component_type] || item.component_type || ''}</div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-xs text-gray-500">{formatDate(item.created_at)}</div>
                        <div className="text-xs text-gray-400">{item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
