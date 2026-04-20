import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, Search } from 'lucide-react'
import { useQualityAlerts, useQualityAlertCount, useAcknowledgeAlert } from '../hooks/useQualityAlerts'
import { useToast } from '../hooks/useToast'
import { formatDate } from '../lib/utils'
import { ALERT_TYPE_LABELS } from '../lib/constants'

export default function QualityAlerts() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [acknowledged, setAcknowledged] = useState('All')
  const [search, setSearch] = useState('')
  const { data: count = 0 } = useQualityAlertCount()
  const { data: alerts = [] } = useQualityAlerts({
    acknowledged: acknowledged === 'All' ? '' : acknowledged,
    part_number: search,
  })
  const acknowledge = useAcknowledgeAlert()

  async function handleAcknowledge(id) {
    try {
      await acknowledge.mutateAsync(id)
      showToast('Alert acknowledged', 'success')
    } catch (err) {
      showToast('Failed to acknowledge alert', 'error')
    }
  }

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bell size={24} className="text-pdi-navy flex-shrink-0" />
            {count > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 bg-pdi-amber text-white text-xs font-bold rounded-full">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy">Quality Alerts</h1>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-end">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Acknowledged</label>
            <select
              value={acknowledged}
              onChange={e => setAcknowledged(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
            >
              <option value="All">All Alerts</option>
              <option value="unacknowledged">Unacknowledged</option>
              <option value="acknowledged">Acknowledged</option>
            </select>
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Part Number Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by part number…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
              />
            </div>
          </div>
        </div>

        {/* Alerts table/cards */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {alerts.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-12 px-4">
              <Bell size={32} className="mx-auto mb-3 opacity-40" />
              <p>No quality alerts found</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {['Type', 'Part Number', 'Supplier', 'Inspection Form', 'Triggered By', 'Created', 'Status', ''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {alerts.map(alert => (
                      <tr key={alert.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                            {ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700 font-semibold">{alert.part_number || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{alert.supplier || '—'}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/inspections/${alert.inspection_id}`)}
                            className="text-xs text-pdi-navy hover:underline font-mono"
                          >
                            {alert.form_no || '—'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{alert.triggered_by_name || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{formatDate(alert.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium ${alert.is_acknowledged ? 'text-gray-400' : 'text-amber-600'}`}>
                            {alert.is_acknowledged ? 'Acknowledged' : 'Unacknowledged'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {!alert.is_acknowledged && (
                            <button
                              onClick={() => handleAcknowledge(alert.id)}
                              disabled={acknowledge.isPending}
                              className="flex items-center gap-1.5 text-xs text-pdi-navy hover:underline font-medium disabled:opacity-50 min-h-[36px]"
                            >
                              <Check size={13} />
                              Acknowledge
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-gray-100">
                {alerts.map(alert => (
                  <div key={alert.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                        {ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type}
                      </span>
                      <span className={`text-xs font-medium ${alert.is_acknowledged ? 'text-gray-400' : 'text-amber-600'}`}>
                        {alert.is_acknowledged ? 'Acked' : 'New'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 mb-3">
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Part Number</div>
                        <div className="font-mono text-sm font-semibold text-gray-800">{alert.part_number || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Supplier</div>
                        <div className="text-sm text-gray-700">{alert.supplier || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Triggered By</div>
                        <div className="text-sm text-gray-700">{alert.triggered_by_name || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Created</div>
                        <div className="text-xs text-gray-500">{formatDate(alert.created_at)}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/inspections/${alert.inspection_id}`)}
                        className="flex-1 text-xs text-pdi-navy hover:underline font-mono font-medium min-h-[36px] flex items-center justify-center"
                      >
                        View Form {alert.form_no}
                      </button>
                      {!alert.is_acknowledged && (
                        <button
                          onClick={() => handleAcknowledge(alert.id)}
                          disabled={acknowledge.isPending}
                          className="flex items-center gap-1 px-3 py-2 text-xs text-pdi-navy hover:underline font-medium disabled:opacity-50 min-h-[36px]"
                        >
                          <Check size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
