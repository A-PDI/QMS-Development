import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Gauge, RefreshCw, Settings, Trash2, Search, X,
  AlertTriangle, CheckCircle2, Loader2, XCircle, Save, FileText, BarChart3, Info, ShieldAlert, Eye,
  ListFilter, FileSpreadsheet, FileDown, ChevronDown, ChevronUp, ArrowDownAZ, GripVertical, Play,
} from 'lucide-react'
import api from '../lib/api'
import { useToast } from '../hooks/useToast'
import { chooseSaveTarget, writeBlobToTarget, deriveFilename } from '../lib/download'
import { describeConnectionResult, describeSyncResult } from '../lib/syncStatus'
import { formatInjectorTestDateTime } from '../lib/injectorDateTime'
import {
  filterInjectors,
  toggleSelected,
  toggleAll,
  areAllSelected,
  orderedSelection,
  moveSelected,
  moveSelectedTo,
  sortSelectionBySerial,
  validateSelectionForReport,
  describeSelection,
  vendorPromptReport,
  suggestReportName,
  hasTestResults,
  emptyFilters,
  buildInjectorQuery,
  describeActiveFilters,
  hasActiveFilters,
  toggleStepFilter,
  STEP_STATUS_OPTIONS,
  OUTPUTS,
  FORMATS,
  emptyOutputs,
  toggleOutput,
  toggleFormat,
  formatsApply,
  reportFormats,
  validateOutputs,
  producesFiles,
  describeOutputs,
} from '../lib/injectorSelection'

// How long typing in a filter box settles before the server is queried again.
const FILTER_DEBOUNCE_MS = 300

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// ── Custom Report formats ─────────────────────────────────────────────────────
// One report, two files. Both endpoints take the same selection in the same
// order, so the workbook's columns and the PDF's columns always match.
const REPORT_FORMATS = {
  xlsx: { path: '/injector-tests/reports/custom.xlsx', extension: '.xlsx', mimeType: XLSX_MIME },
  pdf: { path: '/injector-tests/reports/custom', extension: '.pdf', mimeType: 'application/pdf' },
}

// The icon shown on each output toggle.
const OUTPUT_ICONS = { preview: Eye, report: FileText, inspection: FileText, evaluation: BarChart3 }
const FORMAT_ICONS = { xlsx: FileSpreadsheet, pdf: FileDown }

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

  // Every filter on the page lives in one object: part/serial accept several
  // values each, and `steps` filters on how individual test steps scored.
  const [filters, setFilters] = useState(emptyFilters)
  // Typing narrows the visible list at once; the server is only re-queried once
  // the box settles, so a step filter does not fire on every keystroke.
  const [settledFilters, setSettledFilters] = useState(filters)
  // The order of `selectedIds` is the report's column order — the selection
  // panel below lets the user rearrange it.
  const [selectedIds, setSelectedIds] = useState(() => [])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const [showOrder, setShowOrder] = useState(true)   // the report order matters, so show it
  const [preview, setPreview] = useState(null)

  // What to produce, and in which file formats. Several outputs at once.
  const [outputSelection, setOutputSelection] = useState(emptyOutputs)

  const [syncing, setSyncing] = useState(false)
  const [generating, setGenerating] = useState(false)   // a run is in progress
  const generatingRef = useRef(false)                   // blocks repeated clicks
  const [vendorName, setVendorName] = useState('')     // remembered between shipment evaluation runs
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingPrune, setPendingPrune] = useState(null)   // large prune awaiting confirmation
  const [statusMsg, setStatusMsg] = useState(null)     // { type:'error'|'success'|'info'|'warning', text }

  useEffect(() => {
    const timer = setTimeout(() => setSettledFilters(filters), FILTER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filters])

  // Test-step criteria are resolved by the server — individual steps are not
  // part of a list row — so the query key carries the whole filter set.
  const listQuery = useMemo(() => buildInjectorQuery(settledFilters), [settledFilters])
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['injector-tests', listQuery],
    queryFn: async () => { const { data } = await api.get('/injector-tests', { params: listQuery }); return data },
    // Keep the previous rows on screen while a changed filter is in flight.
    placeholderData: (previous) => previous,
  })
  const { data: settings } = useQuery({
    queryKey: ['injector-tests-settings'],
    queryFn: async () => { const { data } = await api.get('/injector-tests/settings'); return data },
  })
  // The test steps present in the synced data — the step filter only ever
  // offers points that actually exist.
  const { data: stepData } = useQuery({
    queryKey: ['injector-tests-steps'],
    queryFn: async () => { const { data } = await api.get('/injector-tests/steps'); return data },
  })

  const injectors = data?.injectors || []
  const stepCatalog = stepData?.steps || []
  const stepLabels = useMemo(
    () => Object.fromEntries(stepCatalog.map((s) => [s.code, s.label])),
    [stepCatalog]
  )
  // The server already applied every filter; re-applying the row-level ones
  // client-side is what makes typing feel instant while the refetch is in
  // flight. Step criteria are left to the server (see filterInjectors).
  const filtered = useMemo(() => filterInjectors(injectors, filters), [injectors, filters])
  const allVisibleSelected = areAllSelected(selectedIds, filtered)
  const activeFilters = useMemo(() => describeActiveFilters(filters, stepLabels), [filters, stepLabels])
  const filtersActive = hasActiveFilters(filters)
  const totalInjectors = data?.total ?? injectors.length

  const setFilter = (patch) => setFilters((prev) => ({ ...prev, ...patch }))
  const resetFilters = () => setFilters(emptyFilters())

  // Filters only change the visible list; selections persist until explicitly
  // cleared and are re-sorted by serial whenever the set changes.
  //
  // The server now returns only the rows that match the filters, so a selected
  // injector can stop being in `injectors` the moment the filter changes. Its
  // full record is kept here for exactly that reason — otherwise narrowing a
  // filter would silently shrink the selection the user had already built.
  const [selectedRecords, setSelectedRecords] = useState([])
  useEffect(() => {
    setSelectedRecords((previous) => {
      const known = new Map(previous.map((record) => [record.id, record]))
      for (const injector of injectors) {
        if (selected.has(injector.id)) known.set(injector.id, injector)
      }
      const next = selectedIds.map((id) => known.get(id)).filter(Boolean)
      const unchanged = next.length === previous.length && next.every((record, i) => record === previous[i])
      return unchanged ? previous : next
    })
  }, [injectors, selectedIds, selected])

  const orderedSelected = useMemo(
    () => orderedSelection(selectedIds, selectedRecords),
    [selectedIds, selectedRecords]
  )
  const selectedCount = orderedSelected.length
  const selectionIssue = useMemo(
    () => (selectedCount ? validateSelectionForReport(orderedSelected) : null),
    [orderedSelected, selectedCount]
  )
  const outputIssue = validateOutputs(outputSelection)
  const canGenerate = selectedCount > 0 && outputIssue.ok && !generating

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
  // Reordering: the panel's order is the report's column order.
  const moveInSelection = (id, delta) => setSelectedIds(prev => moveSelected(prev, id, delta))
  const dropInSelection = (from, to) => setSelectedIds(prev => moveSelectedTo(prev, from, to))
  const sortSelection = () => setSelectedIds(prev => sortSelectionBySerial(prev, orderedSelected))

  const pickOutput = (value) => setOutputSelection(prev => ({ ...prev, outputs: toggleOutput(prev.outputs, value) }))
  const pickFormat = (value) => setOutputSelection(prev => ({ ...prev, formats: toggleFormat(prev.formats, value) }))

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
      qc.invalidateQueries({ queryKey: ['injector-tests-steps'] })
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
      qc.invalidateQueries({ queryKey: ['injector-tests-steps'] })
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

  // ── Generate the chosen outputs ────────────────────────────────────────────
  /**
   * Produce everything that is ticked, in one run.
   *
   * Ask for everything FIRST (while the click gesture is still active, which
   * the browser's save dialog requires), then generate. Cancelling any prompt
   * means no request and no download at all.
   *
   * Preview and Report are the same document in two forms, so a format ticked
   * against either produces exactly one file — never a duplicate.
   */
  const runOutputs = async () => {
    if (generatingRef.current) return          // repeated clicks are ignored

    const selection = orderedSelected
    const outcome = validateOutputs(outputSelection)
    if (!outcome.ok) {
      setStatusMsg({ type: 'error', text: outcome.message })
      showToast(outcome.message, 'error')
      return
    }
    const validation = validateSelectionForReport(selection)
    if (!validation.ok) {
      setStatusMsg({ type: 'error', text: validation.message })
      showToast(validation.message, 'error')
      return
    }

    // The ids go out in the order the panel shows them: that IS the column
    // order of every report, preview and workbook this run produces.
    const ids = selection.map((injector) => injector.id)
    const { outputs } = outputSelection
    const formats = reportFormats(outputSelection)

    // Only the Shipment Evaluation Report needs a vendor: it identifies the
    // shipment on the report header. The Custom Report is never asked for one —
    // its header falls back to the test bench's brand.
    let vendor = ''
    const vendorReport = vendorPromptReport(outputs)
    if (vendorReport) {
      const answer = window.prompt(`Vendor name for the ${vendorReport}`, vendorName)
      if (answer === null) {
        showToast('Cancelled — nothing was generated', 'info')
        return
      }
      vendor = String(answer).trim()
      if (!vendor) {
        const msg = `A vendor name is required for the ${vendorReport}.`
        setStatusMsg({ type: 'error', text: msg })
        showToast(msg, 'error')
        return
      }
      setVendorName(vendor)   // remembered as the default for the next run
    }

    // Only ask where to save when something is actually written to disk.
    let target = { cancelled: false, filename: '', handle: null }
    if (producesFiles(outputSelection)) {
      const suggestion = suggestReportName('InjectorReport', selection, { vendor })
      target = await chooseSaveTarget(suggestion, {
        extension: formats.includes('xlsx') && !formats.includes('pdf') ? '.xlsx' : '.pdf',
        mimeType: formats.includes('xlsx') && !formats.includes('pdf') ? XLSX_MIME : 'application/pdf',
        promptMessage: 'Base file name for this run',
      })
      if (target.cancelled) {
        showToast('Cancelled — nothing was generated', 'info')
        return
      }
    }

    generatingRef.current = true
    setGenerating(true)
    setStatusMsg({
      type: 'info',
      text: `Generating ${describeOutputs(outputSelection).toLowerCase()} for ${describeSelection(selection)}…`,
    })

    const savedFiles = []
    const warnings = []
    // The handle the user picked was created for ONE extension, so it may only
    // receive a file of that type — writing a workbook into a handle the OS
    // believes is a PDF would produce an unopenable file. Everything else
    // downloads alongside it under its own name.
    const targetExtension = (target.filename.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase()
    let handleUsed = false
    const saveBlob = async (blob, filename) => {
      const fitsHandle = !handleUsed && !!target.handle && filename.toLowerCase().endsWith(targetExtension)
      if (fitsHandle) handleUsed = true
      const writeTarget = fitsHandle ? { ...target, filename } : { cancelled: false, filename, handle: null }
      await writeBlobToTarget(writeTarget, blob)
      savedFiles.push(filename)
    }
    // One DOCUMENT kind means the user's chosen name is used as-is — Excel and
    // PDF of the same report are already told apart by their extension. Several
    // kinds each get a suffix so the set stays together in the folder.
    const documentKinds = (formats.length ? 1 : 0)
      + (outputs.includes('inspection') ? 1 : 0)
      + (outputs.includes('evaluation') ? 1 : 0)
    // `part` distinguishes several files of ONE kind (inspection 1, 2, 3…) and
    // is always applied; `kind` only appears when the run produces more than
    // one kind of document.
    const nameFor = (kind, extension, part = '') => deriveFilename(
      target.filename,
      [documentKinds > 1 ? kind : '', part].filter(Boolean).join('-'),
      extension
    )

    try {
      if (outputs.includes('preview')) {
        const { data: res } = await api.post('/injector-tests/reports/preview', { injector_ids: ids })
        setPreview(res.preview)
      }

      for (const format of formats) {
        const spec = REPORT_FORMATS[format]
        const res = await api.post(spec.path, { injector_ids: ids, vendor_name: vendor }, { responseType: 'blob' })
        await saveBlob(new Blob([res.data], { type: spec.mimeType }), nameFor('Report', spec.extension))
        const w = warningsFrom(res); if (w) warnings.push(w)
      }

      if (outputs.includes('inspection')) {
        const { data: res } = await api.post('/injector-tests/reports/inspection', { injector_ids: ids })
        const created = res.inspections || []
        if (res.warnings?.length) warnings.push(res.warnings.join(' '))
        for (let i = 0; i < created.length; i += 1) {
          const insp = created[i]
          if (!insp.inspection_id) continue
          const pdf = await api.get(`/inspections/${insp.inspection_id}/pdf`, { responseType: 'blob' })
          // Several inspections always need telling apart, even when the
          // inspection is the only kind of document this run produces.
          const part = created.length > 1 ? String(i + 1) : ''
          await saveBlob(new Blob([pdf.data], { type: 'application/pdf' }), nameFor('Inspection', '.pdf', part))
        }
        qc.invalidateQueries({ queryKey: ['injector-tests'] })
      }

      if (outputs.includes('evaluation')) {
        const res = await api.post(
          '/injector-tests/reports/shipment-evaluation',
          { injector_ids: ids, vendor_name: vendor },
          { responseType: 'blob' }
        )
        await saveBlob(new Blob([res.data], { type: 'application/pdf' }), nameFor('Evaluation', '.pdf'))
        const w = warningsFrom(res); if (w) warnings.push(w)
      }

      const saved = savedFiles.length ? ` — saved ${savedFiles.join(', ')}` : ''
      const text = `${describeOutputs(outputSelection)} generated for ${describeSelection(selection)}${saved}.`
      setStatusMsg({
        type: warnings.length ? 'warning' : 'success',
        text: warnings.length ? `${text} ${warnings.join(' ')}` : text,
      })
      showToast(`${describeOutputs(outputSelection)} generated`, 'success')
    } catch (err) {
      const msg = await errorMessageFrom(err, 'The report could not be generated. Please try again.')
      setStatusMsg({ type: 'error', text: msg })
      showToast(`Generate failed: ${msg}`, 'error')
    } finally {
      generatingRef.current = false
      setGenerating(false)
    }
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_160px_160px_150px_auto] gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={filters.partNumber} onChange={e => setFilter({ partNumber: e.target.value })}
                aria-label="Filter by part number"
                title="One or more part numbers, separated by commas or spaces"
                placeholder="Part number(s)…"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
            </div>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={filters.serialNumber} onChange={e => setFilter({ serialNumber: e.target.value })}
                aria-label="Filter by serial number"
                title="One or more serial numbers, separated by commas or spaces — a column pasted from a spreadsheet works too"
                placeholder="Serial number(s)…"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]" />
            </div>
            <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 focus-within:ring-1 focus-within:ring-pdi-navy">
              <span className="text-xs font-medium whitespace-nowrap">From</span>
              <input type="date" value={filters.dateFrom} onChange={e => setFilter({ dateFrom: e.target.value })}
                aria-label="Filter from test date"
                max={filters.dateTo || undefined}
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 focus:outline-none" />
            </label>
            <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 focus-within:ring-1 focus-within:ring-pdi-navy">
              <span className="text-xs font-medium whitespace-nowrap">To</span>
              <input type="date" value={filters.dateTo} onChange={e => setFilter({ dateTo: e.target.value })}
                aria-label="Filter through test date"
                min={filters.dateFrom || undefined}
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 focus:outline-none" />
            </label>
            <select value={filters.status} onChange={e => setFilter({ status: e.target.value })}
              aria-label="Filter by result status"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]">
              <option value="">All statuses</option>
              <option value="pass">Passed</option>
              <option value="fail">Failed</option>
              <option value="dnf">DNF</option>
              <option value="unscored">No result</option>
            </select>
            <StepFilterMenu
              steps={stepCatalog}
              selected={filters.steps}
              stepStatus={filters.stepStatus}
              stepMatch={filters.stepMatch}
              onToggleStep={(code) => setFilter({ steps: toggleStepFilter(filters.steps, code) })}
              onStatusChange={(stepStatus) => setFilter({ stepStatus })}
              onMatchChange={(stepMatch) => setFilter({ stepMatch })}
              onClear={() => setFilter({ steps: [] })}
            />
          </div>

          {/* What the list is currently showing, and how to undo it */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500">
              Showing <strong className="text-pdi-navy">{filtered.length}</strong>
              {totalInjectors > filtered.length ? ` of ${totalInjectors}` : ''} injector{filtered.length === 1 ? '' : 's'}
              {isFetching && !isLoading ? ' · filtering…' : ''}
            </span>
            {activeFilters.map((text) => (
              <span key={text} className="inline-flex items-center gap-1 rounded-full bg-pdi-navy/5 px-2 py-0.5 text-pdi-navy">
                <ListFilter size={11} /> {text}
              </span>
            ))}
            {filtersActive && (
              <button onClick={resetFilters} className="text-gray-400 hover:text-red-600 underline">
                Clear filters
              </button>
            )}
            <span className="ml-auto flex items-center gap-2">
              <button onClick={toggleAllVisible} disabled={filtered.length === 0}
                className="px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap">
                {allVisibleSelected ? 'Deselect visible' : 'Select all visible'}
              </button>
              <button onClick={clearSelection} disabled={selectedIds.length === 0}
                className="px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap">
                Clear selection
              </button>
            </span>
          </div>

          {/* What to produce. Several outputs at once; Preview and Report share
              the Excel / PDF choice, Inspection and Evaluation are always PDF. */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-2">
              <div className="2xl:w-48 shrink-0">
                <div className="text-sm font-medium text-pdi-navy">Generate</div>
                <div className="text-xs text-gray-400">
                  {selectedCount === 0
                    ? 'select injectors first'
                    : `${describeSelection(orderedSelected)} selected`}
                  {selectedCount > 0 && (
                    <button type="button" onClick={() => setShowOrder(o => !o)}
                      className="ml-1.5 text-pdi-teal hover:underline">
                      {showOrder ? 'hide order' : 'arrange order'}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {OUTPUTS.map((output) => (
                  <OutputToggle
                    key={output.value}
                    output={output}
                    icon={OUTPUT_ICONS[output.value]}
                    active={outputSelection.outputs.includes(output.value)}
                    disabled={generating}
                    onClick={pickOutput}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="2xl:w-48 shrink-0">
                <div className={`text-sm font-medium ${formatsApply(outputSelection.outputs) ? 'text-pdi-navy' : 'text-gray-300'}`}>
                  Report format
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {FORMATS.map((format) => (
                  <FormatToggle
                    key={format.value}
                    format={format}
                    icon={FORMAT_ICONS[format.value]}
                    active={outputSelection.formats.includes(format.value)}
                    disabled={generating || !formatsApply(outputSelection.outputs)}
                    onClick={pickFormat}
                  />
                ))}
                <span className="text-xs text-gray-400">
                  {formatsApply(outputSelection.outputs)
                    ? 'Applies to Preview and Report. Inspection and Evaluation are always PDF.'
                    : 'Pick Preview or Report to choose a file format.'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" onClick={runOutputs} disabled={!canGenerate}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-pdi-navy px-4 py-2 text-sm font-medium text-white min-h-[40px] hover:bg-pdi-navy-light disabled:opacity-40">
                {generating ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {generating ? 'Generating…' : 'Generate'}
              </button>
              {outputSelection.outputs.length > 0 && (
                <span className="text-xs text-gray-500">{describeOutputs(outputSelection)}</span>
              )}
              {outputSelection.outputs.length > 0 && (
                <button type="button" onClick={() => setOutputSelection(emptyOutputs())} disabled={generating}
                  className="text-xs text-gray-400 underline hover:text-red-600 disabled:opacity-40">
                  Clear
                </button>
              )}
            </div>
          </div>

          {selectedCount > 0 && !outputIssue.ok && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600">
              <Info size={13} className="mt-0.5 flex-shrink-0" /> {outputIssue.message}
            </p>
          )}
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

        {/* The report's column order, arranged by the user */}
        {showOrder && orderedSelected.length > 0 && (
          <ReportOrderPanel
            injectors={orderedSelected}
            disabled={generating}
            onMove={moveInSelection}
            onDrop={dropInSelection}
            onRemove={removeSelected}
            onSortBySerial={sortSelection}
            onClear={clearSelection}
          />
        )}

        {/* Continuous injector list, newest test first */}
        <div>
          {isLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 text-center text-gray-400 py-10">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 text-center text-gray-400 py-10 text-sm">
              {totalInjectors === 0
                ? 'No injector tests synced yet. Click "Sync Now" to pull results from the test bench.'
                : filtersActive
                  ? 'No injectors match the current filters.'
                  : 'No injectors to show.'}
            </div>
          ) : (
            <InjectorList injectors={filtered} selected={selected} onToggle={toggle} />
          )}
        </div>

        {preview && (
          <ReportPreviewModal preview={preview} onClose={() => setPreview(null)} />
        )}
      </div>
    </div>
  )
}

// ── Test-step filter ─────────────────────────────────────────────────────────
/**
 * Picks the test steps a record must have passed / failed / not finished.
 *
 * The list comes from the synced data (GET /injector-tests/steps), so only
 * steps that actually exist are offered, each with how many injectors scored
 * that way. Peak Torque appears as two points — Delivery and Return — because
 * the bench judges those two measurements independently.
 */
function StepFilterMenu({
  steps = [], selected = [], stepStatus, stepMatch,
  onToggleStep, onStatusChange, onMatchChange, onClear,
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const closeOnOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const statusLabel = (STEP_STATUS_OPTIONS.find((o) => o.value === stepStatus) || STEP_STATUS_OPTIONS[0]).label
  const summary = selected.length === 0
    ? 'Test steps'
    : `${statusLabel} · ${selected.length} step${selected.length === 1 ? '' : 's'}`
  // How many injectors scored the wanted way, per step — the number next to
  // each checkbox, so the user can see where the failures are before filtering.
  const countFor = (step) => {
    if (stepStatus === 'pass') return step.pass
    if (stepStatus === 'dnf') return step.dnf
    if (stepStatus === 'any') return step.total
    return step.fail
  }

  return (
    <div className="relative" ref={containerRef}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="true" aria-expanded={open}
        aria-label="Filter by test step outcome"
        className={`flex w-full min-h-[40px] items-center justify-between gap-1.5 rounded-lg border px-3 py-2 text-sm whitespace-nowrap
          ${selected.length ? 'border-pdi-navy bg-pdi-navy/5 text-pdi-navy font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
        <span className="flex items-center gap-1.5 truncate"><ListFilter size={14} /> {summary}</span>
        <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 max-w-[92vw] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Filter by test step</h4>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close test step filter"
              className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
          </div>

          <label className="mt-2 block text-xs text-gray-500">
            Show injectors that
            <select value={stepStatus} onChange={(e) => onStatusChange(e.target.value)}
              aria-label="Test step outcome"
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-pdi-navy">
              {STEP_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {selected.length > 1 && (
            <div className="mt-2 flex items-center gap-1 rounded-lg bg-gray-50 p-1 text-xs">
              {[['any', 'any of these steps'], ['all', 'all of these steps']].map(([value, label]) => (
                <button key={value} type="button" onClick={() => onMatchChange(value)}
                  className={`flex-1 rounded-md px-2 py-1 ${stepMatch === value ? 'bg-white font-medium text-pdi-navy shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
            {steps.length === 0 ? (
              <p className="px-1 py-3 text-xs text-gray-400">No test steps yet — sync the test bench first.</p>
            ) : steps.map((step) => (
              <label key={step.code}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-gray-50">
                <input type="checkbox" checked={selected.includes(step.code)}
                  onChange={() => onToggleStep(step.code)} className="rounded" />
                <span className="min-w-0 flex-1 truncate text-gray-800">{step.label}</span>
                <span className={`shrink-0 text-xs ${countFor(step) ? 'text-gray-500' : 'text-gray-300'}`}>
                  {countFor(step)}
                </span>
              </label>
            ))}
          </div>

          {selected.length > 0 && (
            <button type="button" onClick={onClear}
              className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-red-600">
              Clear test step filter
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Report column order ───────────────────────────────────────────────────────
/**
 * The selected injectors in the order they will appear in the report.
 *
 * This list used to re-sort itself by serial number on every change. It no
 * longer does: position 1 is the report's first column, and the user arranges
 * it — with the arrows, by dragging a row, or by pressing "Sort by serial" to
 * get the old ascending order back in one click.
 */
function ReportOrderPanel({ injectors, disabled, onMove, onDrop, onRemove, onSortBySerial, onClear }) {
  const [draggingIndex, setDraggingIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)

  const endDrag = () => { setDraggingIndex(null); setOverIndex(null) }
  const handleDrop = (toIndex) => {
    if (draggingIndex !== null && draggingIndex !== toIndex) onDrop(draggingIndex, toIndex)
    endDrag()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Selected Injectors · Report Order
        </h4>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onSortBySerial} disabled={disabled}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            <ArrowDownAZ size={13} /> Sort by serial
          </button>
          <button type="button" onClick={onClear} disabled={disabled}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 disabled:opacity-40">
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Position 1 is the report's first column. Drag a row, or use the arrows, to rearrange.
      </p>
      <ol className="space-y-1.5">
        {injectors.map((inj, idx) => (
          <li
            key={inj.id}
            draggable={!disabled}
            onDragStart={() => setDraggingIndex(idx)}
            onDragOver={(event) => { event.preventDefault(); setOverIndex(idx) }}
            onDrop={(event) => { event.preventDefault(); handleDrop(idx) }}
            onDragEnd={endDrag}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors
              ${overIndex === idx && draggingIndex !== null && draggingIndex !== idx
                ? 'border-pdi-teal bg-pdi-teal/5'
                : 'border-gray-200 bg-gray-50'}
              ${draggingIndex === idx ? 'opacity-50' : ''}`}
          >
            <GripVertical size={14} className={`shrink-0 ${disabled ? 'text-gray-200' : 'text-gray-300'}`} aria-hidden="true" />
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-pdi-navy text-white text-xs font-semibold shrink-0">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">
                {inj.part_number || '—'}
                <span className="text-gray-400 font-normal"> · SN {inj.serial_number || '—'}</span>
              </div>
              <div className="text-xs text-gray-400 truncate">Tested {formatInjectorTestDateTime(inj.test_datetime)}</div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button type="button" onClick={() => onMove(inj.id, -1)} disabled={disabled || idx === 0}
                title="Move earlier" aria-label={`Move ${inj.serial_number || 'injector'} earlier`}
                className="p-1.5 text-gray-400 hover:text-pdi-navy hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent">
                <ChevronUp size={16} />
              </button>
              <button type="button" onClick={() => onMove(inj.id, 1)} disabled={disabled || idx === injectors.length - 1}
                title="Move later" aria-label={`Move ${inj.serial_number || 'injector'} later`}
                className="p-1.5 text-gray-400 hover:text-pdi-navy hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent">
                <ChevronDown size={16} />
              </button>
              <button type="button" onClick={() => onRemove(inj.id)} disabled={disabled}
                title="Remove" aria-label={`Remove ${inj.serial_number || 'injector'}`}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-white rounded disabled:opacity-30">
                <X size={16} />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Output toggle ─────────────────────────────────────────────────────────────
// Each of Preview / Report / Inspection / Evaluation toggles independently, so
// one Generate can produce several of them.
function OutputToggle({ output, icon: Icon, active, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(output.value)}
      disabled={disabled}
      aria-pressed={active}
      title={output.hint}
      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium whitespace-nowrap min-h-[40px] disabled:opacity-40
        ${active
          ? 'border-pdi-navy bg-pdi-navy text-white hover:bg-pdi-navy-light'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
    >
      {Icon ? <Icon size={15} /> : null}
      {output.label}
    </button>
  )
}

// ── File format toggle ────────────────────────────────────────────────────────
// Excel / PDF for the Custom Report. Disabled until Preview or Report is on.
function FormatToggle({ format, icon: Icon, active, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(format.value)}
      disabled={disabled}
      aria-pressed={active}
      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium whitespace-nowrap min-h-[40px] disabled:opacity-40
        ${active
          ? 'border-pdi-teal bg-pdi-teal text-white hover:opacity-90'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
    >
      {Icon ? <Icon size={15} /> : null}
      {format.label}
    </button>
  )
}

// ── One continuous, test-date-ordered list of injectors ──────────────────────
function InjectorList({ injectors, selected, onToggle }) {
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
                <td className="px-3 py-2.5">
                  <InjectorFlowBadge injector={i} />
                  <MatchedSteps steps={i.matched_steps} />
                </td>
                <td className="px-3 py-2.5 text-gray-500 text-xs">{formatInjectorTestDateTime(i.test_datetime)}</td>
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
              <MatchedSteps steps={i.matched_steps} />
              <div className="text-xs text-gray-400 mt-0.5">{formatInjectorTestDateTime(i.test_datetime)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The test steps this row matched the active step filter on — the server sends
 * them so a filtered list says WHY each record is in it.
 */
function MatchedSteps({ steps }) {
  if (!Array.isArray(steps) || steps.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {steps.map((label) => (
        <span key={label} className="inline-flex items-center rounded bg-pdi-navy/5 px-1.5 py-0.5 text-[11px] text-pdi-navy">
          {label}
        </span>
      ))}
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
