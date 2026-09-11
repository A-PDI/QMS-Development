import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, RefreshCw } from 'lucide-react'
import { BarChart, Bar, LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import api from '../lib/api'
import { useToast } from '../hooks/useToast'
import { AttemptCard } from '../components/InjectorRepairHistory'
import { formatInjectorTestDateTime } from '../lib/injectorDateTime'

const COLORS = { PASS: '#16806a', FAIL: '#c0392b', DNF: '#bd771a', UNKNOWN: '#7c8798' }
const number = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
const percent = (value) => value == null ? '—' : `${number(value)}%`
const shortDate = (value) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const inputStyle = 'min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'
const numeric = (value) => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null
function initialFilters() {
  const today = new Date()
  const from = new Date(today)
  from.setDate(today.getDate() - 89)
  const date = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  return { date_from: date(from), date_to: date(today), part_number: '', interval: 'week' }
}

function Panel({ title, note, children }) {
  return <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <h2 className="text-base font-semibold text-pdi-navy">{title}</h2>
    {note && <p className="mt-1 text-sm text-gray-500">{note}</p>}
    <div className="mt-4">{children}</div>
  </section>
}
function Metric({ label, value, note }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-4">
    <p className="text-sm font-medium text-gray-600">{label}</p>
    <p className="mt-1 text-3xl font-semibold tabular-nums text-pdi-navy">{value}</p>
    <p className="mt-2 text-sm text-gray-500">{note}</p>
  </div>
}
function Empty({ children = 'No data for this selection.' }) {
  return <p className="rounded-lg bg-gray-50 p-5 text-sm text-gray-500">{children}</p>
}
function OutcomeBars({ data, xKey, name }) {
  return <div className="h-72" role="img" aria-label={name}>
    <ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 10 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey={xKey} tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} />
      <Tooltip /><Legend />{Object.entries(COLORS).map(([key, color]) => <Bar key={key} dataKey={key} stackId="outcome" fill={color} />)}
    </BarChart></ResponsiveContainer>
  </div>
}
function Table({ columns, rows, rowKey }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm">
    <thead className="border-b bg-gray-50 text-gray-600"><tr>{columns.map((column) => <th scope="col" key={column.key} className="whitespace-nowrap px-3 py-3 font-medium">{column.label}</th>)}</tr></thead>
    <tbody className="divide-y divide-gray-100">{rows.map((row, index) => <tr key={rowKey ? row[rowKey] : index}>{columns.map((column) => <td key={column.key} className="px-3 py-3 align-top">{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}</tr>)}</tbody>
  </table></div>
}

function RepairHistoryReport({ caseId }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['injector-report-case', caseId], queryFn: async () => (await api.get(`/injector-tests/repairs/cases/${caseId}`)).data })
  const [measurementKey, setMeasurementKey] = useState('')
  const [testKey, setTestKey] = useState('')
  const measurementOptions = useMemo(() => {
    const map = new Map()
    for (const attempt of data?.attempts || []) for (const change of attempt.changes) {
      const key = JSON.stringify([change.component, change.parameter, change.unit])
      map.set(key, `${change.parameter || change.component} (${change.unit || 'unit not recorded'})`)
    }
    return [...map].map(([key, label]) => ({ key, label }))
  }, [data])
  const testOptions = useMemo(() => {
    const map = new Map()
    for (const attempt of data?.attempts || []) for (const delta of attempt.deltas) {
      const key = JSON.stringify([delta.step_key, delta.unit])
      map.set(key, `${delta.step_name} (${delta.unit || 'unit not recorded'})`)
    }
    return [...map].map(([key, label]) => ({ key, label }))
  }, [data])
  const measurement = measurementOptions.some((option) => option.key === measurementKey) ? measurementKey : measurementOptions[0]?.key
  const testPoint = testOptions.some((option) => option.key === testKey) ? testKey : testOptions[0]?.key
  if (isLoading) return <Empty>Loading repair history…</Empty>
  if (error) return <p role="alert" className="text-sm text-red-700">Repair history could not be loaded.</p>
  const measurementRows = data.attempts.map((attempt) => {
    const change = attempt.changes.find((row) => JSON.stringify([row.component, row.parameter, row.unit]) === measurement)
    return { repair: `#${attempt.attempt_number}`, Before: numeric(change?.before_value), After: numeric(change?.after_value) }
  })
  const testRows = []
  for (const attempt of data.attempts) {
    const delta = attempt.deltas.find((row) => JSON.stringify([row.step_key, row.unit]) === testPoint)
    if (!testRows.length) testRows.push({ test: 'Initial', Value: ['PASS', 'FAIL'].includes(delta?.before_status) ? numeric(delta.before_value) : null })
    if (attempt.status === 'COMPLETED') testRows.push({ test: `After #${attempt.attempt_number}`, Value: ['PASS', 'FAIL'].includes(delta?.after_status) ? numeric(delta.after_value) : null })
  }
  const lineChart = (rows, xKey, keys) => <div className="h-60"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 15, right: 15, left: 0, bottom: 10 }}>
    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={xKey} /><YAxis domain={['auto', 'auto']} /><Tooltip /><Legend />
    {keys.map((key, index) => <Line key={key} dataKey={key} type="linear" stroke={index ? '#16806a' : '#1D2B4F'} strokeWidth={2} connectNulls={false} />)}
  </LineChart></ResponsiveContainer></div>
  return <div className="space-y-4">
    <div><h3 className="font-semibold text-pdi-navy">{data.part_number} · {data.serial_number} · {data.status}</h3>
      <p className="text-sm text-gray-500">Initial failure: {formatInjectorTestDateTime(data.initial_test_datetime)}. Snapshots remain available after clearing synced tests.</p></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <div><label className="block text-sm font-medium text-gray-700">Physical measurement
        <select className={`${inputStyle} mt-2 w-full`} value={measurement || ''} onChange={(event) => setMeasurementKey(event.target.value)}>{measurementOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        {measurementOptions.length ? lineChart(measurementRows, 'repair', ['Before', 'After']) : <Empty />}</div>
      <div><label className="block text-sm font-medium text-gray-700">Test result through repairs
        <select className={`${inputStyle} mt-2 w-full`} value={testPoint || ''} onChange={(event) => setTestKey(event.target.value)}>{testOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        {testOptions.length ? lineChart(testRows, 'test', ['Value']) : <Empty />}</div>
    </div>
    <p className="text-sm text-gray-500">Gaps indicate unrecorded or unfinished measurements. Different bench conditions can affect the test trend.</p>
    <div className="space-y-4 border-l-2 border-gray-200">{data.attempts.map((attempt) => <AttemptCard key={attempt.id} attempt={attempt} />)}</div>
  </div>
}

export default function InjectorReports() {
  const { showToast } = useToast()
  const [draft, setDraft] = useState(initialFilters)
  const [config, setConfig] = useState(initialFilters)
  const [selectedEvidence, setSelectedEvidence] = useState('')
  const [caseId, setCaseId] = useState('')
  const [serial, setSerial] = useState('')
  const [caseStatus, setCaseStatus] = useState('')
  const [casePage, setCasePage] = useState(0)
  const [singleOnly, setSingleOnly] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [filterError, setFilterError] = useState('')
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['injector-analytics', config],
    queryFn: async () => (await api.get('/injector-tests/analytics', { params: config })).data,
  })
  const evidence = data?.evidence.find((row) => row.key === selectedEvidence) || data?.evidence[0]
  const observations = (evidence?.observations || []).filter((row) => !singleOnly || !row.multi_change)
  const plotted = observations.filter((row) => row.measurement_delta != null && row.test_delta != null)
  const corrected = observations.filter((row) => row.outcome === 'PASS').length
  const measured = observations.filter((row) => row.test_delta != null)
  const meanChange = measured.length ? measured.reduce((sum, row) => sum + row.test_delta, 0) / measured.length : null
  const cases = (data?.cases || []).filter((row) => row.serial_number.toLowerCase().includes(serial.trim().toLowerCase()) && (!caseStatus || row.status === caseStatus))
  const currentPage = Math.min(casePage, Math.max(0, Math.ceil(cases.length / 25) - 1))
  const openCase = (id) => { setCaseId(id); window.setTimeout(() => document.getElementById('case-history')?.scrollIntoView({ behavior: 'smooth' }), 0) }
  const caseButton = (row) => <button type="button" onClick={() => openCase(row.case_id || row.id)} className="text-pdi-navy underline">{row.serial_number}</button>
  const apply = (event) => {
    event.preventDefault()
    if (draft.date_from && draft.date_to && draft.date_from > draft.date_to) { setFilterError('Start date must be on or before end date.'); return }
    setFilterError(''); setConfig({ ...draft }); setCaseId(''); setCasePage(0); setSelectedEvidence('')
  }
  const exportReport = async () => {
    setExporting(true)
    try {
      const response = await api.get('/injector-tests/analytics/export.xlsx', { params: config, responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Injector-Repair-Analytics.xlsx'
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { showToast('The report could not be exported. Please try again.', 'error') } finally { setExporting(false) }
  }
  const testing = data?.testing
  const repairs = data?.repairs
  return <div className="min-h-full bg-gray-50/50">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-5 sm:px-6">
      <div><h1 className="flex items-center gap-2 text-xl font-bold text-pdi-navy"><BarChart3 /> Injector Reports</h1><p className="mt-1 text-sm text-gray-500">Testing volume, repair outcomes, and adjustment history</p></div>
      <Link to="/injector-tests" className="text-sm font-medium text-pdi-navy underline">Injector Tests</Link>
    </header>
    <main className="space-y-5 p-4 sm:p-6">
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
        <label className="text-sm font-medium text-gray-600">From<input aria-label="Report start date" type="date" value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} className={`${inputStyle} mt-1 block`} /></label>
        <label className="text-sm font-medium text-gray-600">Through<input aria-label="Report end date" type="date" value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} className={`${inputStyle} mt-1 block`} /></label>
        <label className="text-sm font-medium text-gray-600">Part number<select value={draft.part_number} onChange={(e) => setDraft({ ...draft, part_number: e.target.value })} className={`${inputStyle} mt-1 block`}><option value="">All parts</option>{data?.parts.map((part) => <option key={part}>{part}</option>)}</select></label>
        <label className="text-sm font-medium text-gray-600">Trend<select value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value })} className={`${inputStyle} mt-1 block`}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
        <button type="submit" className="min-h-11 rounded-lg bg-pdi-navy px-4 py-2 text-sm font-medium text-white">Apply</button>
        <button type="button" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh report" className={`${inputStyle} disabled:opacity-50`}><RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} /></button>
        <button type="button" onClick={exportReport} disabled={!data || exporting} className={`${inputStyle} flex items-center gap-2 disabled:opacity-50`}><Download size={16} /> {exporting ? 'Exporting…' : 'Export Excel'}</button>
        {filterError && <p role="alert" className="w-full text-sm text-red-700">{filterError}</p>}
      </form>
      {isLoading ? <Empty>Loading injector reports…</Empty> : error ? <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{error.response?.data?.error || 'The report could not be loaded.'} <button onClick={() => refetch()} className="underline">Retry</button></p> : data && <>
        <div className="text-sm text-gray-600"><p>Applied window: {config.date_from ? shortDate(config.date_from) : 'All available history'} – {config.date_to ? shortDate(config.date_to) : 'Latest'} · {config.part_number || 'All parts'}</p>
          <p className="mt-1">Synced test coverage: {shortDate(data.coverage.first_test)} – {shortDate(data.coverage.last_test)}. Last sync: {data.last_sync ? new Date(data.last_sync).toLocaleString() : 'Not recorded'}.</p>
          <p className="mt-1">Test counts use currently synced results and may change after clearing or resyncing. Repair history is retained separately.</p>
          {testing.missing_serial_tests > 0 && <p className="mt-1 text-amber-800">{testing.missing_serial_tests} tests have no serial number and are excluded from unique-injector percentages.</p>}</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Injectors tested" value={number(testing.unique_injectors, 0)} note={`${number(testing.test_runs, 0)} test runs, including repeat tests`} />
          <Metric label="Test-run pass / fail" value={`${percent(testing.test_pass_pct)} / ${percent(testing.test_fail_pct)}`} note={`${testing.outcomes.DNF} DNF · ${testing.outcomes.UNKNOWN} unknown; included in denominator`} />
          <Metric label="Injectors needing repair" value={percent(testing.needing_repair_pct)} note={`${testing.needing_repair} of ${testing.unique_injectors} had at least one failed test`} />
          <Metric label="Failed injectors with a repair case" value={percent(testing.tracked_failed_pct)} note={`${testing.tracked_failed_injectors} of ${testing.needing_repair} have a case beginning in this window`} />
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Testing volume and outcomes" note={`${config.interval === 'week' ? 'Weeks start Monday. ' : ''}Each bar counts test runs; periods without tests are omitted.`}>
            {data.trend.length ? <><OutcomeBars data={data.trend} xKey="period" name="Stacked test-run outcomes over time" /><details className="mt-2 text-sm"><summary className="cursor-pointer text-pdi-navy">View numbers</summary><Table rows={data.trend} columns={[{ key: 'period', label: 'Period' }, ...Object.keys(COLORS).map((key) => ({ key, label: key })), { key: 'injectors', label: 'Unique injectors' }]} /></details></> : <Empty />}
          </Panel>
          <Panel title="First and latest test in the window" note="One result per injector in each bar. These are not lifetime first-pass rates.">
            {testing.unique_injectors ? <><OutcomeBars data={[{ label: 'First in window', ...testing.first_outcomes }, { label: 'Latest in window', ...testing.latest_outcomes }]} xKey="label" name="First versus latest test outcomes per injector" />
              <p className="text-sm text-gray-600">First-test pass: {percent(testing.first_pass_pct)} · fail: {percent(testing.first_fail_pct)}</p></> : <Empty />}
          </Panel>
        </div>
        <div><h2 className="text-lg font-semibold text-pdi-navy">Repair effectiveness</h2><p className="mt-1 text-sm text-gray-500">Cases with an initial failure in the applied window; includes all later outcomes through {new Date(data.generated_at).toLocaleString()}.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Repair cases" value={number(repairs.cases, 0)} note={`${repairs.unique_injectors} injectors · ${repairs.passed_cases} passed cases`} />
          <Metric label="Average repairs to pass" value={number(repairs.avg_attempts_to_pass, 2)} note={`Among ${repairs.passed_cases} passed cases only`} />
          <Metric label="Injectors passed after one repair" value={number(repairs.injectors_passed_after_one, 0)} note={`${repairs.passed_after_one} cases · ${percent(repairs.first_repair_pass_pct)} of ${repairs.first_retested_cases} retested first attempts`} />
          <Metric label="Repair-attempt pass rate" value={percent(repairs.attempt_pass_pct)} note={`${repairs.passed_attempts} / ${repairs.completed_attempts} retested attempts · ${repairs.pending_retests} without a linked retest`} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Repairs needed to achieve a pass" note="Passed cases only; unresolved cases are shown separately.">
            {repairs.attempts_to_pass.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={repairs.attempts_to_pass}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="attempts" label={{ value: 'Repair attempts', position: 'insideBottom', offset: -3 }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="cases" name="Passed cases" fill="#16806a" /></BarChart></ResponsiveContainer></div> : <Empty>No passing retests linked yet.</Empty>}
          </Panel>
          <Panel title="Current repair-case status">
            {repairs.cases ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={Object.entries(repairs.dispositions).map(([status, cases]) => ({ status: status.replace(/_/g, ' '), cases }))} layout="vertical" margin={{ left: 30 }}><XAxis type="number" allowDecimals={false} /><YAxis dataKey="status" type="category" width={135} tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey="cases" fill="#1D2B4F" /></BarChart></ResponsiveContainer></div> : <Empty>No repair cases began in this window.</Empty>}
          </Panel>
        </div>
        <Panel title="Adjustment outcomes" note="Retest pass rates by part, adjustment, direction, and unit. One attempt can appear in several rows when multiple changes were made.">
          {data.actions.length ? <Table rowKey="key" rows={data.actions} columns={[
            { key: 'part_number', label: 'Part' }, { key: 'parameter', label: 'Measurement / component' },
            { key: 'direction', label: 'Adjustment', render: (row) => `${row.action} · ${row.direction} ${row.unit || ''}` },
            { key: 'completed', label: 'Retested' }, { key: 'pass_pct', label: 'Overall pass', render: (row) => `${percent(row.pass_pct)} (${row.passed}/${row.completed})` },
            { key: 'pending', label: 'No linked retest' }, { key: 'multi_change', label: 'Multiple changes' },
          ]} /> : <Empty>No recorded adjustments in this repair cohort.</Empty>}
        </Panel>
        <Panel title="Failure → adjustment → response" note="Explore observed associations, not proven causes. Simultaneous changes and bench conditions can affect the result. Small samples need more evidence.">
          {!evidence ? <Empty>Link retests to recorded repairs to compare failed test points with the adjustments made.</Empty> : <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">Failure and adjustment group<select className={`${inputStyle} mt-2 w-full`} value={evidence.key} onChange={(event) => { setSelectedEvidence(event.target.value); setSingleOnly(false) }}>{data.evidence.map((row) => <option key={row.key} value={row.key}>{row.part_number} · {row.step} {row.failure} · {row.parameter} {row.direction} ({row.measurement_unit || 'no unit'}) · spec {row.spec_min ?? '—'}–{row.spec_max ?? '—'} {row.test_unit || ''} · n={row.samples}</option>)}</select></label>
            <p className="text-sm text-gray-600">{corrected}/{observations.length} failed points passed on retest ({percent(observations.length ? corrected / observations.length * 100 : null)}). Mean test change: {number(meanChange, 3)} {evidence.test_unit || ''} across {measured.length} numeric comparisons. {observations.filter((row) => row.multi_change).length} attempts included other adjustments.</p>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={singleOnly} onChange={(e) => setSingleOnly(e.target.checked)} /> Show only attempts with one recorded change</label>
            <p className="text-sm text-gray-500">X: change in {evidence.parameter} ({evidence.measurement_unit || 'unit not recorded'}). Y: change in {evidence.step} ({evidence.test_unit || 'unit not recorded'}). Values are After − Before.</p>
            {plotted.length ? <div className="h-80" role="img" aria-label="Physical adjustment versus test result change"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 10, right: 25, left: 15, bottom: 15 }}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey="measurement_delta" name="Measurement change" unit={evidence.measurement_unit || ''} /><YAxis type="number" dataKey="test_delta" name="Test change" unit={evidence.test_unit || ''} />
              <ReferenceLine x={0} stroke="#9ca3af" /><ReferenceLine y={0} stroke="#9ca3af" /><Tooltip content={({ active, payload }) => active && payload?.length ? <div className="rounded border bg-white p-3 text-sm shadow"><p>{payload[0].payload.serial_number} · repair #{payload[0].payload.attempt_number}</p><p>Measurement Δ {number(payload[0].payload.measurement_delta, 4)}</p><p>Test Δ {number(payload[0].payload.test_delta, 3)}</p><p>{payload[0].payload.outcome}</p></div> : null} />
              <Legend /><Scatter name="One recorded change" data={plotted.filter((row) => !row.multi_change)} fill="#16806a" /><Scatter name="Multiple changes" data={plotted.filter((row) => row.multi_change)} fill="#bd771a" />
            </ScatterChart></ResponsiveContainer></div> : <Empty>No numeric before/after pairs for this selection.</Empty>}
            <p className="text-sm text-gray-500">{plotted.length} plotted points. DNF, unknown, missing or nonnumeric readings are omitted from the plot.</p>
            <Table rows={observations} columns={[
              { key: 'serial_number', label: 'Injector', render: caseButton }, { key: 'attempt_number', label: 'Repair #' },
              { key: 'before_measurement', label: 'Measurement before', render: (row) => number(row.before_measurement, 4) },
              { key: 'after_measurement', label: 'Measurement after', render: (row) => number(row.after_measurement, 4) },
              { key: 'before_test', label: 'Test before', render: (row) => number(row.before_test, 3) },
              { key: 'after_test', label: 'Test after', render: (row) => number(row.after_test, 3) },
              { key: 'test_delta', label: 'Test Δ', render: (row) => number(row.test_delta, 3) }, { key: 'outcome', label: 'Point outcome' },
              { key: 'multi_change', label: 'Other changes', render: (row) => row.multi_change ? 'Yes' : 'No' },
            ]} />
          </div>}
        </Panel>
        <Panel title="Repair-case history" note="Choose a serial number to view every repair, physical measurement, and linked test result.">
          <div className="mb-3 flex flex-wrap gap-3"><input aria-label="Search repair serial" placeholder="Search serial…" value={serial} onChange={(e) => { setSerial(e.target.value); setCasePage(0) }} className={inputStyle} />
            <select aria-label="Filter repair cases by status" value={caseStatus} onChange={(e) => { setCaseStatus(e.target.value); setCasePage(0) }} className={inputStyle}><option value="">All case statuses</option>{['OPEN', 'PASSED', 'HOLD', 'ENGINEERING_REVIEW', 'SCRAPPED'].map((status) => <option key={status}>{status}</option>)}</select></div>
          {cases.length ? <><Table rows={cases.slice(currentPage * 25, currentPage * 25 + 25)} rowKey="id" columns={[
            { key: 'serial_number', label: 'Serial', render: caseButton }, { key: 'part_number', label: 'Part' },
            { key: 'initial_test_datetime', label: 'Initial failure', render: (row) => shortDate(row.initial_test_datetime) },
            { key: 'status', label: 'Status' }, { key: 'attempts', label: 'Attempts' }, { key: 'pending', label: 'Unlinked retest', render: (row) => row.pending ? 'Yes' : 'No' },
          ]} /><div className="mt-3 flex items-center justify-between text-sm"><button className="disabled:opacity-40" disabled={!currentPage} onClick={() => setCasePage(currentPage - 1)}>Previous</button><span>{currentPage * 25 + 1}–{Math.min(cases.length, currentPage * 25 + 25)} of {cases.length}</span><button className="disabled:opacity-40" disabled={(currentPage + 1) * 25 >= cases.length} onClick={() => setCasePage(currentPage + 1)}>Next</button></div></> : <Empty />}
        </Panel>
        <div id="case-history" className="scroll-mt-4">{caseId && <Panel title="Selected repair case"><RepairHistoryReport key={caseId} caseId={caseId} /></Panel>}</div>
        <details className="rounded-xl border bg-white p-4 text-sm"><summary className="cursor-pointer font-medium text-pdi-navy">Metric definitions and data coverage</summary><dl className="mt-4 space-y-3">{data.definitions.map(([term, definition]) => <div key={term}><dt className="font-semibold text-gray-700">{term}</dt><dd className="mt-1 text-gray-500">{definition}</dd></div>)}</dl></details>
      </>}
    </main>
  </div>
}
