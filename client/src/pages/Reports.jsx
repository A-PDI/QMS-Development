import { useState } from 'react'
import { BarChart2, Download, Trash2, Plus, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'
import api from '../lib/api'
import { useRunReport, useSavedReports, useSaveReport, useDeleteSavedReport } from '../hooks/useReports'
import { useToast } from '../hooks/useToast'
import { COMPONENT_TYPE_LABELS } from '../lib/constants'

const DISPOSITION_OPTIONS = ['All', 'PASS', 'FAIL', 'ACCEPTED']
const STATUS_OPTIONS = ['All', 'Open', 'Complete']
const GROUP_BY_OPTIONS = [
  { value: 'component_type', label: 'Component Type' },
  { value: 'disposition', label: 'Disposition' },
  { value: 'status', label: 'Status' },
  { value: 'month', label: 'Month' },
  { value: 'assigned_to', label: 'Assigned Inspector' },
]

const BAR_COLORS = {
  total: '#1D2B4F',
  pass: '#1A8C80',
  fail: '#C0392B',
  accepted: '#D4943A',
}

export default function Reports() {
  const { showToast } = useToast()
  const [config, setConfig] = useState({
    date_from: '',
    date_to: '',
    component_type: '',
    status: 'All',
    disposition: 'All',
    group_by: 'component_type',
  })
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

  const { data: reportData } = useRunReport(config, true)
  const { data: savedReports = [] } = useSavedReports()
  const saveReport = useSaveReport()
  const deleteReport = useDeleteSavedReport()

  const rows = reportData?.rows || []
  const totals = reportData?.totals || {}

  async function handleExport(format) {
    try {
      const { data } = await api.post(`/reports/export/${format}`, config, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = `report.${format === 'excel' ? 'xlsx' : 'pdf'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(`Exported as ${format.toUpperCase()}`, 'success')
    } catch (err) {
      showToast(`Export failed: ${err?.response?.data?.error || err.message}`, 'error')
    }
  }

  async function handleSaveReport() {
    if (!saveName.trim()) {
      showToast('Please enter a name for this report', 'error')
      return
    }
    try {
      await saveReport.mutateAsync({
        name: saveName,
        config_json: JSON.stringify(config),
      })
      showToast('Report saved', 'success')
      setSaveModalOpen(false)
      setSaveName('')
    } catch (err) {
      showToast(`Save failed: ${err?.response?.data?.error || err.message}`, 'error')
    }
  }

  async function handleDeleteReport(id) {
    if (!window.confirm('Delete this saved report?')) return
    try {
      await deleteReport.mutateAsync(id)
      showToast('Deleted', 'success')
    } catch (err) {
      showToast('Delete failed', 'error')
    }
  }

  function loadSavedReport(report) {
    try {
      const saved = JSON.parse(report.config_json)
      setConfig(saved)
    } catch {
      showToast('Failed to load report config', 'error')
    }
  }

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center gap-3">
          <BarChart2 size={24} className="text-pdi-navy flex-shrink-0" />
          <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy">Reports</h1>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Left panel: Filters */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Date Range</label>
                <div className="space-y-2">
                  <input
                    type="date"
                    value={config.date_from}
                    onChange={e => setConfig(c => ({ ...c, date_from: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                    placeholder="From"
                  />
                  <input
                    type="date"
                    value={config.date_to}
                    onChange={e => setConfig(c => ({ ...c, date_to: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                    placeholder="To"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Component Type</label>
                <select
                  value={config.component_type}
                  onChange={e => setConfig(c => ({ ...c, component_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                >
                  <option value="">All Components</option>
                  {Object.entries(COMPONENT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Status</label>
                <select
                  value={config.status}
                  onChange={e => setConfig(c => ({ ...c, status: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                >
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Disposition</label>
                <select
                  value={config.disposition}
                  onChange={e => setConfig(c => ({ ...c, disposition: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                >
                  {DISPOSITION_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Group By</label>
                <select
                  value={config.group_by}
                  onChange={e => setConfig(c => ({ ...c, group_by: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                >
                  {GROUP_BY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <button
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light transition-all min-h-[44px]"
              >
                <BarChart2 size={14} />
                Run Report
              </button>

              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Saved Reports</h3>
                {savedReports.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No saved reports</p>
                ) : (
                  <div className="space-y-2">
                    {savedReports.map(report => (
                      <div key={report.id} className="flex items-center gap-2 text-xs">
                        <button
                          onClick={() => loadSavedReport(report)}
                          className="flex-1 text-left px-2 py-1.5 text-pdi-navy hover:bg-pdi-frost rounded transition-colors truncate font-medium"
                          title={report.name}
                        >
                          {report.name}
                        </button>
                        <button
                          onClick={() => handleDeleteReport(report.id)}
                          className="text-red-400 hover:text-red-600 p-1 min-h-[32px] min-w-[32px] flex items-center justify-center"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => setSaveModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-all min-h-[40px]"
              >
                <Plus size={14} />
                Save Current
              </button>
            </div>
          </div>

          {/* Right panel: Results */}
          <div className="lg:col-span-2 space-y-4">
            {/* Totals row */}
            {reportData && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                  <div className="text-center">
                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Total</div>
                    <div className="text-2xl sm:text-3xl font-bold text-pdi-navy">{totals.total || 0}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Complete</div>
                    <div className="text-2xl sm:text-3xl font-bold text-pdi-teal">{totals.complete || 0}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Draft</div>
                    <div className="text-2xl sm:text-3xl font-bold text-pdi-amber">{totals.draft || 0}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Pass</div>
                    <div className="text-2xl font-bold text-pdi-teal">{totals.pass || 0}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Fail</div>
                    <div className="text-2xl font-bold text-pdi-red">{totals.fail || 0}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Accepted</div>
                    <div className="text-2xl font-bold text-pdi-amber">{totals.accepted || 0}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Chart */}
            {reportData && rows.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
                <h2 className="text-sm sm:text-base font-semibold text-gray-800 mb-4">Results Chart</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={rows} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={rows.length > 5 ? -45 : 0} height={rows.length > 5 ? 80 : 40} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="total" fill={BAR_COLORS.total} name="Total" />
                    {rows.some(r => r.pass !== undefined) && <Bar dataKey="pass" fill={BAR_COLORS.pass} name="Pass" />}
                    {rows.some(r => r.fail !== undefined) && <Bar dataKey="fail" fill={BAR_COLORS.fail} name="Fail" />}
                    {rows.some(r => r.accepted !== undefined) && <Bar dataKey="accepted" fill={BAR_COLORS.accepted} name="Accepted" />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Detail table */}
            {reportData && rows.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Label</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide">Count</th>
                        {rows.some(r => r.pass !== undefined) && <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide">Pass</th>}
                        {rows.some(r => r.fail !== undefined) && <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide">Fail</th>}
                        {rows.some(r => r.accepted !== undefined) && <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide">Accepted</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-800">{row.label}</td>
                          <td className="px-4 py-3 text-center font-semibold text-pdi-navy">{row.count}</td>
                          {rows.some(r => r.pass !== undefined) && <td className="px-4 py-3 text-center text-pdi-teal">{row.pass || 0}</td>}
                          {rows.some(r => r.fail !== undefined) && <td className="px-4 py-3 text-center text-pdi-red">{row.fail || 0}</td>}
                          {rows.some(r => r.accepted !== undefined) && <td className="px-4 py-3 text-center text-pdi-amber">{row.accepted || 0}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden divide-y divide-gray-100">
                  {rows.map((row, idx) => (
                    <div key={idx} className="px-4 py-3">
                      <div className="font-medium text-gray-800 mb-2">{row.label}</div>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div className="text-center">
                          <div className="text-gray-400 text-xs mb-1">Total</div>
                          <div className="font-semibold text-pdi-navy">{row.count}</div>
                        </div>
                        {rows.some(r => r.pass !== undefined) && (
                          <div className="text-center">
                            <div className="text-gray-400 text-xs mb-1">Pass</div>
                            <div className="font-semibold text-pdi-teal">{row.pass || 0}</div>
                          </div>
                        )}
                        {rows.some(r => r.fail !== undefined) && (
                          <div className="text-center">
                            <div className="text-gray-400 text-xs mb-1">Fail</div>
                            <div className="font-semibold text-pdi-red">{row.fail || 0}</div>
                          </div>
                        )}
                        {rows.some(r => r.accepted !== undefined) && (
                          <div className="text-center">
                            <div className="text-gray-400 text-xs mb-1">Accepted</div>
                            <div className="font-semibold text-pdi-amber">{row.accepted || 0}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Export buttons */}
            {reportData && (
              <div className="flex gap-3">
                <button
                  onClick={() => handleExport('excel')}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-all min-h-[44px]"
                >
                  <Download size={14} />
                  Export Excel
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-all min-h-[44px]"
                >
                  <Download size={14} />
                  Export PDF
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Save report modal */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-sm w-full shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-pdi-navy">Save Report</h3>
              <button
                onClick={() => {
                  setSaveModalOpen(false)
                  setSaveName('')
                }}
                className="text-gray-400 hover:text-gray-600 min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>
            <input
              type="text"
              placeholder="Report name"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy mb-4 min-h-[40px]"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSaveModalOpen(false)
                  setSaveName('')
                }}
                className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveReport}
                disabled={saveReport.isPending}
                className="flex-1 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light disabled:opacity-40 min-h-[40px]"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
