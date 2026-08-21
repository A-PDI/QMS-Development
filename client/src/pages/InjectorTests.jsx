import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Gauge, RefreshCw, Settings, Trash2, Search, Printer, X,
  AlertTriangle, CheckCircle2, Loader2, XCircle, Save, FileText, Files, BarChart3, Info, ShieldAlert, Eye,
} from 'lucide-react'
import api from '../lib/api'
import { useToast } from '../hooks/useToast'
import { chooseSaveTarget, writeBlobToTarget, deriveFilename } from '../lib/download'
import { describeConnectionResult, describeSyncResult } from '../lib/syncStatus'
import {
  filterInjectors,
  toggleSelected,
  toggleAll,
  areAllSelected,
  orderedSelection,
  validateSelectionForReport,
  describeSelection,
  vendorPromptReport,
  suggestReportName,
  hasTestResults,
} from '../lib/injectorSelection'

// ── Report kinds ──────────────────────────────────────────────────────────────
// `internal` matches the server's report type ids; `label` is what the user sees.
const REPORT_KINDS = {
  customer:   { label: 'Custom Report',        short: 'Custom',     prefix: 'CustomReport',       internal: 'customer' },
  inspection: { label: 'Inspection Report',    short: 'Inspection', prefix: 'InspectionReport',   internal: 'inspection' },
  both:       { label: 'Both Reports',         short: 'Both',       prefix: 'CustomReports',      internal: 'customer+inspection' },
  evaluation: { label: 'Shipment Evaluation',  short: 'Evaluation', prefix: 'ShipmentEvaluation', internal: 'supplier_evaluation' },
}

/** Axios error → a message safe to show the user (blob bodies included). */
async function errorMessageFrom(err, fallback) {
  const data = err?.response?.data
  if (data && typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      if (parsed?.error) return parsed.error
    } catch (_) { /* not JSON — fall through */ }
    return fallback
  }
  return data?.error || err?.message || fallback
}

/** Warnings the server attached to a generated report, if any. */
function warningsFrom(response) {
  const raw = response?.headers?.['x-report-warnings']
  if (!raw) return ''
  try { return decodeURIComponent(raw) } catch (_) { return raw }
}

export default function InjectorTests() {
  const qc = useQueryClient()
  const { showToast } = useToast()

  const [partFilter, setPartFilter] = useState('')
  const [serialFilter, setSerialFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFromFilter, setDateFromFilter] = useState('')
  const [dateToFilter, setDateToFilter] = useState('')
  // Selected rows are presented and reported in natural serial-number order.
  const [selectedIds, setSelectedIds] = useState(() => [])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const [showOrder, setShowOrder] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  const [syncing, setSyncing] = useState(false)
  const [generating, setGenerating] = useState(null)   // report kind currently running
  const generatingRef = useRef(false)                  // blocks repeated clicks
  const [vendorName, setVendorName] = useState('')     // remembered between customer/evaluation reports
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingPrune, setPendingPrune] = useState(null)   // large prune awaiting confirmation
  const [statusMsg, setStatusMsg] = useState(null)     // { type:'error'|'success'|'info'|'warning', text }

  const { data, isLoading } = useQuery({
    queryKey: ['injector-tests'],
    queryFn: async () => { const { data } = await api.get('/injector-tests'); return data },
  })
  const { data: settings } = useQuery({
    queryKey: ['injector-tests-settings'],
    queryFn: async () => { const { data } = await api.get('/injector-tests/settings'); return data },
  })

  const injectors = data?.injectors || []
  const filtered = useMemo(
    () => filterInjectors(injectors, {
      partNumber: partFilter,
      serialNumber: serialFilter,
      status: statusFilter,
      dateFrom: dateFromFilter,
      dateTo: dateToFilter,
    }),
    [injectors, partFilter, serialFilter, statusFilter, dateFromFilter, dateToFilter]
  )
  const allVisibleSelected = areAllSelected(selectedIds, filtered)

  // Filters only change the visible list; selections persist until explicitly
  // cleared and are re-sorted by serial whenever the set changes.
  const orderedSelected = useMemo(() => orderedSelection(selectedIds, injectors), [selectedIds, injectors])
  const selectedCount = orderedSelected.length
  const selectionIssue = useMemo(
    () => (selectedCount ? validateSelectionForReport(orderedSelected) : null),
    [orderedSelected, selectedCount]
  )
  const canGenerate = selectedCount > 0 && !generating && !previewing

  useEffect(() => {
    if (!preview) return undefined
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setPreview(null)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [preview])

  // ── Selection handlers ─────────────────────────────────────────────────────
  const toggle = (id) => setSelectedIds(prev => toggleSelected(prev, id))
  const toggleAllVisible = () => setSelectedIds(prev => toggleAll(prev, filtered))
  const clearSelection = () => setSelectedIds([])
  const removeSelected = (id) => setSelectedIds(prev => prev.filter(x => x !== id))

  // ── Sync / settings ────────────────────────────────────────────────────────
  const handleSync = async (fullResync = false, { allowLargePrune = false } = {}) => {
    setSyncing(true)
    setPendingPrune(null)
    setStatusMsg({ type: 'info', text: fullResync
      ? 'Full resync — fetching the complete report set from the test bench…'
      : 'Syncing with the test bench…' })
    try {
      const body = {}
      if (fullResync) body.full_resync = true
      if (allowLargePrune) body.allow_large_prune = true
      const { data: res } = await api.post('/injector-tests/sync', body)

      const outcome = describeSyncResult(res, { fullResync })
      setStatusMsg({ type: outcome.type, text: outcome.text })
      // A held-back prune offers a confirm button below the banner.
      setPendingPrune(res.pruneSkipped?.reason === 'large_prune' ? res.pruneSkipped : null)
      showToast(outcome.toast, outcome.type === 'success' ? 'success' : 'info')
      qc.invalidateQueries({ queryKey: ['injector-tests'] })
      qc.invalidateQueries({ queryKey: ['injector-tests-settings'] })
    } catch (err) {
      const msg = await errorMessageFrom(err, 'Sync failed.')
      if (err?.response?.data?.code === 'NO_API_KEY') {
        setStatusMsg({ type: 'error', text: 'No API key configured — open Settings and add your CarbonZapp API key.' })
        showToast('No API key configured — open Settings to add it.', 'error')
        setShowSettings(true)
      } else {
        setStatusMsg({ type: 'error', text: msg })
        showToast(`Sync failed: ${msg}`, 'error')
      }
    } finally { setSyncing(false) }
  }

  const handleClearAll = async () => {
    setClearing(true)
    setConfirmClear(false)
    setStatusMsg({ type: 'info', text: 'Clearing all synced reports…' })
    try {
      const { data: res } = await api.delete('/injector-tests')
      const kept = res.inspectionsKept || 0
      const summary = `Cleared ${res.reportsDeleted || 0} report(s) and ${res.inspectionsDeleted || 0} generated inspection(s)` +
        (kept ? `; kept ${kept} completed inspection(s)` : '') + '. You can now run a fresh sync.'
      setStatusMsg({ type: 'success', text: summary })
      showToast('Synced reports cleared', 'success')
      setSelectedIds([])
      qc.invalidateQueries({ queryKey: ['injector-tests'] })
      qc.invalidateQueries({ queryKey: ['injector-tests-settings'] })
    } catch (err) {
      const msg = await errorMessageFrom(err, 'Clear failed.')
      setStatusMsg({ type: 'error', text: msg })
      showToast(`Clear failed: ${msg}`, 'error')
    } finally { setClearing(false) }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setStatusMsg({ type: 'info', text: 'Testing connection to the test bench…' })
    try {
      const { data: res } = await api.post('/injector-tests/test-connection', {})
      const outcome = describeConnectionResult(res)
      setStatusMsg(outcome)
      showToast('Connection successful', 'success')
    } catch (err) {
      const msg = await errorMessageFrom(err, 'Connection failed.')
      setStatusMsg({ type: 'error', text: msg })
      showToast('Connection failed', 'error')
    } finally { setTesting(false) }
  }

  const handleSaveKey = async () => {
    if (apiKeyInput.trim().length < 8) { showToast('Enter a valid API key', 'error'); return }
    setSavingKey(true)
    try {
      await api.put('/injector-tests/settings', { api_key: apiKeyInput.trim() })
      showToast('API key saved', 'success')
      setApiKeyInput('')
      setShowSettings(false)
      qc.invalidateQueries({ queryKey: ['injector-tests-settings'] })
    } catch (err) {
      showToast(`Save failed: ${await errorMessageFrom(err, 'Unknown error')}`, 'error')
    } finally { setSavingKey(false) }
  }

  const handlePreview = async () => {
    const validation = validateSelectionForReport(orderedSelected)
    if (!validation.ok) {
      setStatusMsg({ type: 'error', text: validation.message })
      showToast(validation.message, 'error')
      return
    }

    setPreviewing(true)
    try {
      const { data: res } = await api.post('/injector-tests/reports/preview', {
        injector_ids: orderedSelected.map((injector) => injector.id),
      })
      setPreview(res.preview)
    } catch (err) {
      const msg = await errorMessageFrom(err, 'The report preview could not be loaded. Please try again.')
      setStatusMsg({ type: 'error', text: msg })
      showToast(`Preview failed: ${msg}`, 'error')
    } finally {
      setPreviewing(false)
    }
  }

  // ── Report generation ──────────────────────────────────────────────────────
  /**
   * Ask for everything the report needs FIRST (while the click gesture is still
   * active, which the browser's save dialog requires), then generate.
   * Cancelling any prompt means no request and no download at all.
   */
  const runGeneration = async (kind) => {
    if (generatingRef.current) return          // repeated clicks are ignored
    const kindInfo = REPORT_KINDS[kind]
    const selection = orderedSelected
    const validation = validateSelectionForReport(selection)
    if (!validation.ok) {
      setStatusMsg({ type: 'error', text: validation.message })
      showToast(validation.message, 'error')
      return
    }
    const ids = selection.map(i => i.id)

    // Custom and Shipment Evaluation reports share the same Part / Vendor /
    // Report Date header. Ask once while the click gesture is still active;
    // "Both" uses the value for its Custom Report.
    let vendor = vendorName
    const vendorReport = vendorPromptReport(kind)
    if (vendorReport) {
      const answer = window.prompt(`Vendor name for the ${vendorReport}`, vendorName)
      if (answer === null) {
        showToast('Cancelled — no report was generated', 'info')
        return
      }
      vendor = String(answer).trim()
      if (!vendor) {
        const msg = `A vendor name is required for the ${vendorReport}.`
        setStatusMsg({ type: 'error', text: msg })
        showToast(msg, 'error')
        return
      }
      setVendorName(vendor)   // remembered as the default for the next report
    }

    const suggestion = kind === 'evaluation'
      ? suggestReportName(kindInfo.prefix, selection, { vendor })
      : suggestReportName(kindInfo.prefix, selection)
    const target = await chooseSaveTarget(suggestion, {
      promptMessage: `File name for the ${kindInfo.label.toLowerCase()}`,
    })
    if (target.cancelled) {
      showToast('Cancelled — no report was downloaded', 'info')
      return
    }

    generatingRef.current = true
    setGenerating(kind)
    setStatusMsg({ type: 'info', text: `Generating ${kindInfo.label.toLowerCase()} for ${describeSelection(selection)}…` })

    const savedFiles = []
    const warnings = []
    try {
      if (kind === 'customer' || kind === 'both') {
        const res = await api.post(
          '/injector-tests/reports/custom',
          { injector_ids: ids, vendor_name: vendor },
          { responseType: 'blob' }
        )
        const name = kind === 'both' ? deriveFilename(target.filename, 'Custom') : target.filename
        await writeBlobToTarget({ ...target, filename: name }, new Blob([res.data], { type: 'application/pdf' }))
        savedFiles.push(name)
        const w = warningsFrom(res); if (w) warnings.push(w)
      }

      if (kind === 'evaluation') {
        const res = await api.post(
          '/injector-tests/reports/shipment-evaluation',
          { injector_ids: ids, vendor_name: vendor },
          { responseType: 'blob' }
        )
        await writeBlobToTarget(target, new Blob([res.data], { type: 'application/pdf' }))
        savedFiles.push(target.filename)
        const w = warningsFrom(res); if (w) warnings.push(w)
      }

      if (kind === 'inspection' || kind === 'both') {
        const { data: res } = await api.post('/injector-tests/reports/inspection', { injector_ids: ids })
        const created = res.inspections || []
        if (res.warnings?.length) warnings.push(res.warnings.join(' '))
        // Base name: on "Both" the inspection file is derived from the chosen
        // name so the pair stays together in the folder.
        const baseName = kind === 'both' ? deriveFilename(target.filename, 'Inspection') : target.filename
        for (let i = 0; i < created.length; i++) {
          const insp = created[i]
          if (!insp.inspection_id) continue
          const pdf = await api.get(`/inspections/${insp.inspection_id}/pdf`, { responseType: 'blob' })
          const name = created.length > 1 ? deriveFilename(baseName, String(i + 1)) : baseName
          // Only the first file can be written to the handle the user picked;
          // any additional inspection reports download alongside it.
          const writeTarget = (i === 0 && kind === 'inspection')
            ? { ...target, filename: name }
            : { cancelled: false, filename: name, handle: null }
          await writeBlobToTarget(writeTarget, new Blob([pdf.data], { type: 'application/pdf' }))
          savedFiles.push(name)
        }
        qc.invalidateQueries({ queryKey: ['injector-tests'] })
      }

      const text = `${kindInfo.label} generated for ${describeSelection(selection)} — saved ${savedFiles.join(', ')}.`
      setStatusMsg({ type: warnings.length ? 'warning' : 'success', text: warnings.length ? `${text} ${warnings.join(' ')}` : text })
      showToast(`${kindInfo.label} generated`, 'success')
    } catch (err) {
      const msg = await errorMessageFrom(err, 'The report could not be generated. Please try again.')
      setStatusMsg({ type: 'error', text: msg })
      showToast(`Report failed: ${msg}`, 'error')
    } finally {
      generatingRef.current = false
      setGenerating(null)
    }
  }

  const fmtDate = (value) => {
    if (!value) return '—'
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4">
        {/* Page header */}
        <div className="mb-1">
          <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy flex items-center gap-2">
            <Gauge size={22} /> Injector Tests
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Import results from the CarbonZapp test bench, then select injectors and generate reports.
          </p>
        </div>

        {/* Sync toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => handleSync(false)} disabled={syncing || clearing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light disabled:opacity-50 min-h-[40px] font-medium">
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
            <button onClick={() => handleSync(true)} disabled={syncing || clearing}
              title="Fetch the complete report set and reconcile any reports deleted from the test bench"
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-pdi-navy/30 text-pdi-navy rounded-lg hover:bg-pdi-navy/5 disabled:opacity-50 min-h-[40px] font-medium">
              <RefreshCw size={14} /> Full Resync
            </button>
            <button onClick={() => setShowSettings(s => !s)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">
              <Settings size={15} /> Settings
            </button>
            <button onClick={() => setConfirmClear(true)} disabled={syncing || clearing}
              title="Delete all synced reports and the inspections generated from them (completed inspections are kept)"
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 min-h-[40px]">
              <Trash2 size={14} className={clearing ? 'animate-pulse' : ''} /> {clearing ? 'Clearing…' : 'Clear All'}
            </button>
          </div>
          <div className="text-xs text-gray-500">
            {settings?.lastSync ? `Last sync: ${new Date(settings.lastSync).toLocaleString()}` : 'Never synced'}
            {settings && !settings.hasApiKey && (
              <span className="ml-2 text-amber-600 font-medium">· No API key</span>
            )}
          </div>
        </div>

        {/* Status banner */}
        {statusMsg && (
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm
            ${statusMsg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700'
              : statusMsg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700'
              : statusMsg.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
            {statusMsg.type === 'error' ? <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              : statusMsg.type === 'success' ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
              : statusMsg.type === 'warning' ? <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              : <Loader2 size={16} className="mt-0.5 flex-shrink-0 animate-spin" />}
            <span className="flex-1">{statusMsg.text}</span>
            <button onClick={() => setStatusMsg(null)} className="text-current opacity-50 hover:opacity-100" aria-label="Dismiss"><X size={14} /></button>
          </div>
        )}

        {/* A full resync wanted to delete a large share of the records — the
            user confirms before anything is removed. */}
        {pendingPrune && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <ShieldAlert size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900">
                  {pendingPrune.wouldDeleteRows} of {pendingPrune.storedRows} records are no longer on the test bench
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  That is {Math.round(pendingPrune.sharePct)}% of your injector records — more than the {pendingPrune.limitPct}% safety limit — so
                  nothing was deleted. This usually means the bench returned only part of its data. Re-run the
                  resync to check, or remove them if the bench really did drop those tests.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={() => handleSync(true, { allowLargePrune: true })} disabled={syncing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 min-h-[36px] font-medium">
                    <Trash2 size={14} /> Remove them
                  </button>
                  <button onClick={() => handleSync(true)} disabled={syncing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-amber-300 bg-white rounded-lg hover:bg-amber-100 min-h-[36px]">
                    <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> Run the resync again
                  </button>
                  <button onClick={() => setPendingPrune(null)} disabled={syncing}
                    className="px-3 py-1.5 text-sm border border-gray-300 bg-white rounded-lg hover:bg-gray-50 min-h-[36px]">
                    Keep them
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Clear-all confirmation */}
        {confirmClear && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">Clear all synced reports?</p>
                <p className="mt-1 text-xs text-red-700">
                  This deletes every report imported from the test bench and any generated inspections that
                  have not been completed. Inspections you have already <strong>completed will be kept</strong> (just
                  detached from the report). Afterwards, run <strong>Sync Now</strong> or <strong>Full Resync</strong> to re-import fresh data.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={handleClearAll} disabled={clearing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 min-h-[36px] font-medium">
                    <Trash2 size={14} /> {clearing ? 'Clearing…' : 'Yes, clear all'}
                  </button>
                  <button onClick={() => setConfirmClear(false)} disabled={clearing}
                    className="px-3 py-1.5 text-sm border border-gray-300 bg-white rounded-lg hover:bg-gray-50 min-h-[36px]">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Settings panel */}
        {showSettings && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-pdi-navy">CarbonZapp Test Bench Settings</h3>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close settings"><X size={16} /></button>
            </div>
            {settings?.apiKeyFromEnv ? (
              <p className="text-xs text-gray-500">API key is set from a server environment variable (CARBONZAPP_API_KEY) and cannot be edited here.</p>
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  {settings?.hasApiKey ? `Current key: ${settings.apiKeyMasked}. ` : ''}
                  Enter a CarbonZapp API key to enable syncing. Stored server-side only.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input type="password" value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)}
                    placeholder="CarbonZapp API key" autoComplete="off"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
                  <button onClick={handleSaveKey} disabled={savingKey}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light disabled:opacity-50 min-h-[40px]">
                    <Save size={14} /> {savingKey ? 'Saving…' : 'Save Key'}
                  </button>
                </div>
              </>
            )}
            <div className="pt-1 border-t border-gray-100">
              <button onClick={handleTestConnection} disabled={testing || !settings?.hasApiKey}
                className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-pdi-navy text-pdi-navy rounded-lg hover:bg-pdi-navy/5 disabled:opacity-40 min-h-[40px]">
                <RefreshCw size={14} className={testing ? 'animate-spin' : ''} /> {testing ? 'Testing…' : 'Test Connection'}
              </button>
              <p className="text-xs text-gray-400 mt-1">Verifies the key can reach the bench without importing anything.</p>
            </div>

            {/* Fixed import exclusions */}
            <div className="pt-2 border-t border-gray-100 text-xs text-gray-500 space-y-0.5">
              <p>
                <span className="font-medium text-gray-600">Import rules:</span>{' '}
                all test results are imported except serial numbers beginning with{' '}
                <code className="bg-gray-100 px-1 rounded">{settings?.exclusions?.serialStartsWith || 'R'}</code>{' '}
                or bench Job # values containing{' '}
                <code className="bg-gray-100 px-1 rounded">{settings?.exclusions?.jobContains || 'RMA'}</code>.
              </p>
              <p>
                <span className="font-medium text-gray-600">Full resync window:</span>{' '}
                {settings?.fullSyncFrom ? `from ${String(settings.fullSyncFrom).slice(0, 10)}` : 'no date filter sent'}
              </p>
              <p className="text-gray-400">Set <code className="bg-gray-100 px-1 rounded">CARBONZAPP_FULL_SYNC_FROM</code> on the server to change the full-history window.</p>
            </div>
          </div>
        )}

        {/* Report filters + selection controls */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_160px_160px_170px_auto] gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={partFilter} onChange={e => setPartFilter(e.target.value)}
                aria-label="Filter by part number"
                placeholder="Filter by part number…"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
            </div>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={serialFilter} onChange={e => setSerialFilter(e.target.value)}
                aria-label="Filter by serial number"
                placeholder="Filter by serial number…"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
            </div>
            <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 focus-within:ring-1 focus-within:ring-pdi-navy">
              <span className="text-xs font-medium whitespace-nowrap">From</span>
              <input type="date" value={dateFromFilter} onChange={e => setDateFromFilter(e.target.value)}
                aria-label="Filter from test date"
                max={dateToFilter || undefined}
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 focus:outline-none" />
            </label>
            <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 focus-within:ring-1 focus-within:ring-pdi-navy">
              <span className="text-xs font-medium whitespace-nowrap">To</span>
              <input type="date" value={dateToFilter} onChange={e => setDateToFilter(e.target.value)}
                aria-label="Filter through test date"
                min={dateFromFilter || undefined}
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 focus:outline-none" />
            </label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              aria-label="Filter by result status"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]">
              <option value="">All statuses</option>
              <option value="pass">Passed</option>
              <option value="fail">Failed</option>
              <option value="dnf">DNF</option>
            </select>
            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3 2xl:col-span-1">
              <button onClick={toggleAllVisible} disabled={filtered.length === 0}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 min-h-[40px] whitespace-nowrap">
                {allVisibleSelected ? 'Deselect visible' : 'Select all visible'}
              </button>
              <button onClick={clearSelection} disabled={selectedIds.length === 0}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 min-h-[40px] whitespace-nowrap">
                Clear selection
              </button>
            </div>
          </div>

          {/* Report actions */}
          <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-2 pt-2 border-t border-gray-100">
            <div className="text-sm text-gray-600 flex-1 min-w-0">
              {selectedCount === 0
                ? <span className="text-gray-400">Select one or more injectors to generate reports.</span>
                : <span><strong className="text-pdi-navy">{describeSelection(orderedSelected)}</strong> selected</span>}
              {selectedCount > 0 && (
                <button onClick={() => setShowOrder(s => !s)}
                  className="ml-2 text-xs text-pdi-teal hover:underline">
                  {showOrder ? 'hide selected list' : 'view selected list'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={handlePreview} disabled={!canGenerate}
                className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg min-h-[40px] font-medium whitespace-nowrap border border-pdi-navy text-pdi-navy hover:bg-pdi-navy/5 disabled:opacity-40">
                {previewing ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
                {previewing ? 'Loading Preview…' : 'Preview Report'}
              </button>
              <ReportButton kind="customer" icon={Printer} generating={generating} disabled={!canGenerate} onClick={runGeneration}>
                Generate Custom Report
              </ReportButton>
              <ReportButton kind="inspection" icon={FileText} generating={generating} disabled={!canGenerate} onClick={runGeneration}>
                Generate Inspection Report
              </ReportButton>
              <ReportButton kind="both" icon={Files} generating={generating} disabled={!canGenerate} onClick={runGeneration}>
                Generate Both
              </ReportButton>
              <ReportButton kind="evaluation" icon={BarChart3} generating={generating} disabled={!canGenerate} onClick={runGeneration} accent>
                Generate Shipment Evaluation
              </ReportButton>
            </div>
          </div>

          {selectionIssue && !selectionIssue.ok && (
            <p className="flex items-start gap-1.5 text-xs text-red-600">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> {selectionIssue.message}
            </p>
          )}
          {selectionIssue?.ok && selectionIssue.warnings.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600">
              <Info size={13} className="mt-0.5 flex-shrink-0" /> {selectionIssue.warnings.join(' ')}
            </p>
          )}
        </div>

        {/* Automatically ordered active selection */}
        {showOrder && orderedSelected.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Selected Injectors · Serial Number Order</h4>
              <button onClick={clearSelection} className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600">
                <Trash2 size={13} /> Clear
              </button>
            </div>
            <p className="text-xs text-gray-400">
              This list re-sorts automatically in ascending serial-number order whenever injectors are added or removed.
            </p>
            <ol className="space-y-1.5">
              {orderedSelected.map((inj, idx) => (
                <li key={inj.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-pdi-navy text-white text-xs font-semibold shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {inj.part_number || '—'}
                      <span className="text-gray-400 font-normal"> · SN {inj.serial_number || '—'}</span>
                    </div>
                    <div className="text-xs text-gray-400 truncate">Tested {fmtDate(inj.test_datetime)}</div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => removeSelected(inj.id)} title="Remove" aria-label="Remove"
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-white rounded">
                      <X size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Continuous injector list, newest test first */}
        <div>
          {isLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 text-center text-gray-400 py-10">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 text-center text-gray-400 py-10 text-sm">
              {injectors.length === 0
                ? 'No injector tests synced yet. Click "Sync Now" to pull results from the test bench.'
                : 'No injectors match the current filters.'}
            </div>
          ) : (
            <InjectorList injectors={filtered} selected={selected} onToggle={toggle} fmtDate={fmtDate} />
          )}
        </div>

        {preview && (
          <ReportPreviewModal preview={preview} onClose={() => setPreview(null)} />
        )}
      </div>
    </div>
  )
}

// ── Report action button ──────────────────────────────────────────────────────
function ReportButton({ kind, icon: Icon, generating, disabled, onClick, accent, children }) {
  const busy = generating === kind
  const blocked = disabled || !!generating
  return (
    <button
      type="button"
      onClick={() => onClick(kind)}
      disabled={blocked}
      aria-busy={busy}
      className={`flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg min-h-[40px] font-medium whitespace-nowrap disabled:opacity-40
        ${accent ? 'bg-pdi-navy text-white hover:bg-pdi-navy-light' : 'bg-pdi-teal text-white hover:opacity-90'}`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
      {busy ? 'Generating…' : children}
    </button>
  )
}

// ── One continuous, test-date-ordered list of injectors ──────────────────────
function InjectorList({ injectors, selected, onToggle, fmtDate }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50 border-b border-gray-200">
        <div>
          <div className="text-sm font-semibold text-pdi-navy">Test Results</div>
          <div className="text-xs text-gray-500">{injectors.length} result{injectors.length === 1 ? '' : 's'} · newest first</div>
        </div>
        <span className="text-xs text-gray-400">Select rows to build a report</span>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
              <th className="px-3 py-2 w-10"><span className="sr-only">Select</span></th>
              <th className="px-3 py-2">Part Number</th>
              <th className="px-3 py-2">Serial Number</th>
              <th className="px-3 py-2">Flow Results</th>
              <th className="px-3 py-2">Tested</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {injectors.map(i => (
              <tr key={i.id} className={`hover:bg-gray-50 ${selected.has(i.id) ? 'bg-pdi-navy/5' : ''}`}>
                <td className="px-3 py-2.5">
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => onToggle(i.id)} className="rounded"
                    aria-label={`Select injector ${i.serial_number || i.part_number || i.id}`} />
                </td>
                <td className="px-3 py-2.5 font-medium text-gray-900">{i.part_number || '—'}</td>
                <td className="px-3 py-2.5 text-gray-700">{i.serial_number || '—'}</td>
                <td className="px-3 py-2.5"><InjectorFlowBadge injector={i} /></td>
                <td className="px-3 py-2.5 text-gray-500 text-xs">{fmtDate(i.test_datetime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-gray-100">
        {injectors.map(i => (
          <div key={i.id} className={`p-3 flex gap-3 ${selected.has(i.id) ? 'bg-pdi-navy/5' : ''}`}>
            <input type="checkbox" checked={selected.has(i.id)} onChange={() => onToggle(i.id)} className="rounded mt-1"
              aria-label={`Select injector ${i.serial_number || i.part_number || i.id}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm text-gray-900 truncate">{i.part_number || '—'}</span>
                <InjectorFlowBadge injector={i} />
              </div>
              <div className="text-xs text-gray-500 mt-0.5">SN: {i.serial_number || '—'}</div>
              <div className="text-xs text-gray-400 mt-0.5">{fmtDate(i.test_datetime)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReportPreviewModal({ preview, onClose }) {
  const formatRange = () => {
    if (!preview.dateFrom) return '—'
    return preview.dateFrom === preview.dateTo ? preview.dateFrom : `${preview.dateFrom} – ${preview.dateTo}`
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-5"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-preview-title"
        className="flex max-h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3 sm:px-6">
          <div>
            <h2 id="report-preview-title" className="text-lg font-bold text-pdi-navy">{preview.title || 'Custom Report Preview'}</h2>
            <p className="mt-0.5 text-xs text-gray-500">Preview only — no PDF or inspection has been created.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close report preview"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
            <X size={20} />
          </button>
        </header>

        <div className="grid grid-cols-1 gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm sm:grid-cols-3 sm:px-6">
          <div><span className="font-semibold text-gray-700">Part:</span> {preview.parts?.join(', ') || '—'}</div>
          <div><span className="font-semibold text-gray-700">Brand:</span> {preview.brands?.join(', ') || '—'}</div>
          <div><span className="font-semibold text-gray-700">Test date:</span> {formatRange()}</div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="min-w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-pdi-navy text-white">
              <tr>
                <th className="sticky left-0 z-20 min-w-48 border-r border-white/20 bg-pdi-navy px-3 py-2 text-left">Test Step</th>
                <th className="min-w-32 border-r border-white/20 px-3 py-2 text-left">Specification</th>
                {(preview.injectors || []).map((injector, index) => (
                  <th key={injector.id || index} className="min-w-36 border-r border-white/20 px-3 py-2 text-left last:border-r-0">
                    <div>{injector.partNumber || '—'}</div>
                    <div className="font-normal text-white/75">SN {injector.serialNumber || '—'}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(preview.rows || []).map((row) => (
                <tr key={row.key} className="border-b border-gray-200 align-top odd:bg-white even:bg-gray-50">
                  <th className="sticky left-0 border-r border-gray-200 bg-inherit px-3 py-2 text-left font-semibold text-gray-800">
                    {row.label || row.key}
                  </th>
                  <td className="border-r border-gray-200 px-3 py-2 text-gray-600">
                    {row.specification || '—'}{row.unit ? ` ${row.unit}` : ''}
                  </td>
                  {(row.values || []).map((cell, index) => (
                    <td key={`${row.key}-${index}`} className={`border-r border-gray-200 px-3 py-2 last:border-r-0 ${previewCellClass(cell)}`}>
                      {(cell.lines || ['—']).map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 border-pdi-navy bg-gray-100 font-semibold">
                <th className="sticky left-0 border-r border-gray-200 bg-gray-100 px-3 py-2 text-left text-gray-800">Overall Result</th>
                <td className="border-r border-gray-200 px-3 py-2">—</td>
                {(preview.injectors || []).map((injector, index) => (
                  <td key={injector.id || index} className={`border-r border-gray-200 px-3 py-2 last:border-r-0 ${resultClass(injector.result)}`}>
                    {injector.result || '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <footer className="flex justify-end border-t border-gray-200 px-4 py-3 sm:px-6">
          <button type="button" onClick={onClose}
            className="min-h-[40px] rounded-lg bg-pdi-navy px-4 py-2 text-sm font-medium text-white hover:bg-pdi-navy-light">
            Close Preview
          </button>
        </footer>
      </section>
    </div>
  )
}

function previewCellClass(cell) {
  if (cell?.status === 'dnf') return 'bg-orange-50 font-semibold text-orange-700'
  if (cell?.error || cell?.status === 'fail') return 'bg-red-50 font-semibold text-red-700'
  if (cell?.status === 'pass') return 'text-green-700'
  return 'text-gray-700'
}

function resultClass(result) {
  const normalized = String(result || '').toLowerCase()
  if (normalized === 'pass') return 'text-green-700'
  if (normalized === 'fail') return 'text-red-700'
  if (normalized === 'dnf') return 'text-orange-700'
  return 'text-gray-600'
}

function InjectorFlowBadge({ injector }) {
  const { overall_pass, result_status, steps_passed, steps_total } = injector
  const status = String(result_status || (overall_pass === 1 ? 'pass' : (overall_pass === 0 ? 'fail' : 'unknown'))).toLowerCase()
  if (!hasTestResults(injector) || status === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <span className="text-gray-400">No result</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {status === 'pass'
        ? <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium"><CheckCircle2 size={12} /> Passed</span>
        : status === 'dnf'
          ? <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium"><AlertTriangle size={12} /> DNF</span>
          : <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium"><XCircle size={12} /> Failed</span>}
      <span className="text-gray-500">{steps_passed}/{steps_total} steps</span>
    </span>
  )
}
