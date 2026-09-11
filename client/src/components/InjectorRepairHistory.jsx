import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle2, ChevronDown, CircleDot, FlaskConical,
  Loader2, Plus, Save, Trash2, Wrench,
} from 'lucide-react'
import api from '../lib/api'
import { getUser } from '../lib/auth'
import { formatInjectorTestDateTime } from '../lib/injectorDateTime'
import { useToast } from '../hooks/useToast'

const CASE_STATUS_LABELS = {
  OPEN: 'Open',
  PASSED: 'Passed',
  SCRAPPED: 'Scrapped',
  HOLD: 'Hold',
  ENGINEERING_REVIEW: 'Engineering Review',
}

const STATUS_STYLES = {
  OPEN: 'border-blue-200 bg-blue-50 text-blue-800',
  PASSED: 'border-green-200 bg-green-50 text-green-800',
  SCRAPPED: 'border-gray-300 bg-gray-100 text-gray-700',
  HOLD: 'border-amber-200 bg-amber-50 text-amber-800',
  ENGINEERING_REVIEW: 'border-purple-200 bg-purple-50 text-purple-800',
};

function apiError(err, fallback) {
  return err?.response?.data?.error || err?.message || fallback
}

function localDateTimeNow() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function formatNumber(value, digits = 2) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function formatSigned(value, suffix = '') {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—'
  const number = Number(value)
  return `${number > 0 ? '+' : ''}${formatNumber(number)}${suffix}`
}

function resultStyle(status) {
  const value = String(status || '').toUpperCase()
  if (value === 'PASS') return 'text-green-700'
  if (value === 'FAIL') return 'text-red-700'
  if (value === 'DNF') return 'text-amber-700'
  return 'text-gray-500'
}

function emptyChange(options) {
  return {
    component: options?.components?.[0] || 'Nozzle',
    action_type: options?.actions?.[0] || 'Adjusted',
    parameter: '', before_value: '', after_value: '', unit: '', notes: '',
  }
}

function RepairAttemptForm({ mode, repairCase, testId, options, onCancel, onSaved }) {
  const currentUser = getUser()
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    repair_date: localDateTimeNow(),
    technician: currentUser?.name || '',
    failure_categories: '',
    diagnosis: '',
    hypothesis: '',
    expected_outcome: '',
    repair_notes: '',
    changes: [emptyChange(options)],
  })

  const setField = (key, value) => setForm((previous) => ({ ...previous, [key]: value }))
  const updateChange = (index, key, value) => setForm((previous) => ({
    ...previous,
    changes: previous.changes.map((change, changeIndex) => (
      changeIndex === index ? { ...change, [key]: value } : change
    )),
  }))
  const addChange = () => setForm((previous) => ({
    ...previous,
    changes: [...previous.changes, emptyChange(options)],
  }))
  const removeChange = (index) => setForm((previous) => ({
    ...previous,
    changes: previous.changes.filter((_, changeIndex) => changeIndex !== index),
  }))

  const submit = async (event) => {
    event.preventDefault()
    if (!form.diagnosis.trim()) {
      showToast('Enter the diagnosis for this repair attempt.', 'error')
      return
    }
    if (!form.changes.length) {
      showToast('Record at least one repair change.', 'error')
      return
    }
    setSaving(true)
    try {
      const attempt = {
        repair_date: new Date(form.repair_date).toISOString(),
        technician: form.technician.trim(),
        diagnosis: form.diagnosis.trim(),
        hypothesis: form.hypothesis.trim(),
        expected_outcome: form.expected_outcome.trim(),
        repair_notes: form.repair_notes.trim(),
        changes: form.changes,
      }
      if (mode === 'start') {
        await api.post('/injector-tests/repairs/cases', {
          initial_test_id: testId,
          failure_categories: form.failure_categories.split(',').map((value) => value.trim()).filter(Boolean),
          attempt,
        })
      } else {
        await api.post(`/injector-tests/repairs/cases/${repairCase.id}/attempts`, attempt)
      }
      showToast(mode === 'start' ? 'Repair case started' : 'Repair attempt added', 'success')
      onSaved()
    } catch (err) {
      showToast(apiError(err, 'The repair attempt could not be saved.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-pdi-navy/15 bg-pdi-navy/[0.025] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-pdi-navy">
            {mode === 'start' ? 'Start Repair Case · Attempt 1' : `Repair Attempt ${(repairCase?.attempt_count || 0) + 1}`}
          </h3>
          <p className="mt-1 text-xs text-gray-500">Record what you believe is wrong, what changed, and what you expect the retest to show.</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-white">Cancel</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-gray-700">
          <span className="mb-1 block font-medium">Repair date</span>
          <input type="datetime-local" required value={form.repair_date}
            onChange={(event) => setField('repair_date', event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-pdi-teal focus:outline-none focus:ring-1 focus:ring-pdi-teal" />
        </label>
        <label className="text-sm text-gray-700">
          <span className="mb-1 block font-medium">Technician</span>
          <input value={form.technician} onChange={(event) => setField('technician', event.target.value)}
            placeholder="Defaults to signed-in user" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-pdi-teal focus:outline-none focus:ring-1 focus:ring-pdi-teal" />
        </label>
      </div>

      {mode === 'start' && (
        <label className="block text-sm text-gray-700">
          <span className="mb-1 block font-medium">Failure categories <span className="font-normal text-gray-400">(comma separated)</span></span>
          <input value={form.failure_categories} onChange={(event) => setField('failure_categories', event.target.value)}
            placeholder="High Delivery, Opening Pressure" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-pdi-teal focus:outline-none focus:ring-1 focus:ring-pdi-teal" />
        </label>
      )}

      <label className="block text-sm text-gray-700">
        <span className="mb-1 block font-medium">Diagnosis *</span>
        <textarea required rows={2} value={form.diagnosis} onChange={(event) => setField('diagnosis', event.target.value)}
          placeholder="High opening pressure with low cranking delivery."
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-pdi-teal focus:outline-none focus:ring-1 focus:ring-pdi-teal" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-gray-700">
          <span className="mb-1 block font-medium">Repair hypothesis</span>
          <textarea rows={2} value={form.hypothesis} onChange={(event) => setField('hypothesis', event.target.value)}
            placeholder="Insufficient needle stroke is increasing opening pressure."
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-pdi-teal focus:outline-none focus:ring-1 focus:ring-pdi-teal" />
        </label>
        <label className="block text-sm text-gray-700">
          <span className="mb-1 block font-medium">Expected outcome</span>
          <textarea rows={2} value={form.expected_outcome} onChange={(event) => setField('expected_outcome', event.target.value)}
            placeholder="Opening pressure decreases and cranking delivery increases."
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-pdi-teal focus:outline-none focus:ring-1 focus:ring-pdi-teal" />
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-gray-800">Structured changes *</h4>
          <button type="button" onClick={addChange}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-medium text-pdi-navy hover:bg-gray-50">
            <Plus size={14} /> Add change
          </button>
        </div>
        <div className="space-y-3">
          {form.changes.map((change, index) => (
            <div key={index} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <label className="text-xs font-medium text-gray-600 lg:col-span-2">Component
                  <select value={change.component} onChange={(event) => updateChange(index, 'component', event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm">
                    {(options?.components || []).map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600 lg:col-span-2">Action
                  <select value={change.action_type} onChange={(event) => updateChange(index, 'action_type', event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm">
                    {(options?.actions || []).map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600 lg:col-span-2">Parameter
                  <input value={change.parameter} onChange={(event) => updateChange(index, 'parameter', event.target.value)}
                    placeholder="Needle stroke" className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm" />
                </label>
                <label className="text-xs font-medium text-gray-600 lg:col-span-2">Before
                  <input value={change.before_value} onChange={(event) => updateChange(index, 'before_value', event.target.value)}
                    placeholder="0.247" className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm" />
                </label>
                <label className="text-xs font-medium text-gray-600 lg:col-span-2">After
                  <input value={change.after_value} onChange={(event) => updateChange(index, 'after_value', event.target.value)}
                    placeholder="0.232" className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm" />
                </label>
                <label className="text-xs font-medium text-gray-600">Unit
                  <input value={change.unit} onChange={(event) => updateChange(index, 'unit', event.target.value)}
                    placeholder="mm" className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm" />
                </label>
                <div className="flex items-end justify-end">
                  <button type="button" disabled={form.changes.length === 1} onClick={() => removeChange(index)}
                    aria-label={`Remove change ${index + 1}`}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <label className="mt-2 block text-xs font-medium text-gray-600">Change notes
                <input value={change.notes} onChange={(event) => updateChange(index, 'notes', event.target.value)}
                  placeholder="Optional detail specific to this change"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm" />
              </label>
            </div>
          ))}
        </div>
      </div>

      <label className="block text-sm text-gray-700">
        <span className="mb-1 block font-medium">Repair notes</span>
        <textarea rows={2} value={form.repair_notes} onChange={(event) => setField('repair_notes', event.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-pdi-teal focus:outline-none focus:ring-1 focus:ring-pdi-teal" />
      </label>

      <div className="flex justify-end">
        <button type="submit" disabled={saving}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-pdi-navy px-4 py-2 text-sm font-medium text-white hover:bg-pdi-navy-light disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {mode === 'start' ? 'Start Repair Case' : 'Save Repair Attempt'}
        </button>
      </div>
    </form>
  )
}

function RetestLinker({ attempt, candidates, onLinked }) {
  const { showToast } = useToast()
  const [testId, setTestId] = useState(candidates?.[0]?.id || '')
  const [observed, setObserved] = useState('')
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    if (!testId && candidates?.[0]?.id) setTestId(candidates[0].id)
  }, [candidates, testId])

  const link = async () => {
    if (!testId) return
    setLinking(true)
    try {
      await api.post(`/injector-tests/repairs/attempts/${attempt.id}/retest`, {
        after_test_id: testId,
        observed_outcome: observed.trim(),
      })
      showToast('Retest linked and flow changes calculated', 'success')
      onLinked()
    } catch (err) {
      showToast(apiError(err, 'The retest could not be linked.'), 'error')
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <FlaskConical size={18} className="mt-0.5 shrink-0 text-blue-700" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-blue-900">Link the retest for Repair #{attempt.attempt_number}</h4>
          {!candidates?.length ? (
            <p className="mt-1 text-sm text-blue-800">No newer matching test is available yet. Sync the CarbonZapp results after this injector is retested.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <label className="block text-sm text-blue-950">Matching retest
                <div className="relative mt-1">
                  <select value={testId} onChange={(event) => setTestId(event.target.value)}
                    className="w-full appearance-none rounded-lg border border-blue-300 bg-white px-3 py-2.5 pr-9 text-sm">
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {formatInjectorTestDateTime(candidate.test_datetime)} · {String(candidate.result_status || 'unknown').toUpperCase()} · {candidate.steps_failed || 0} failed
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-3 top-3 text-blue-600" />
                </div>
              </label>
              <label className="block text-sm text-blue-950">Observed outcome <span className="text-blue-600">(optional)</span>
                <textarea rows={2} value={observed} onChange={(event) => setObserved(event.target.value)}
                  placeholder="What changed as expected or unexpectedly?"
                  className="mt-1 w-full rounded-lg border border-blue-300 bg-white px-3 py-2.5 text-sm" />
              </label>
              <button type="button" onClick={link} disabled={linking}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">
                {linking ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
                Link Retest & Calculate Changes
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DeltaTable({ deltas }) {
  const completed = (deltas || []).filter((delta) => delta.after_status != null)
  if (!completed.length) return null
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th className="px-3 py-2 font-semibold">Test point</th>
            <th className="px-3 py-2 font-semibold">Before</th>
            <th className="px-3 py-2 font-semibold">After</th>
            <th className="px-3 py-2 font-semibold">Change</th>
            <th className="px-3 py-2 font-semibold">Toward target</th>
            <th className="px-3 py-2 font-semibold">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {completed.map((delta) => (
            <tr key={delta.id}>
              <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{delta.step_name}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatNumber(delta.before_value)} {delta.unit || ''}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-800">{formatNumber(delta.after_value)} {delta.unit || ''}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-800">
                {formatSigned(delta.absolute_delta)} <span className="text-gray-400">({formatSigned(delta.percent_delta, '%')})</span>
              </td>
              <td className={`whitespace-nowrap px-3 py-2 ${Number(delta.correction_effectiveness) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatSigned(delta.correction_effectiveness, '%')}
              </td>
              <td className={`whitespace-nowrap px-3 py-2 font-semibold ${resultStyle(delta.after_status)}`}>{delta.after_status || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AttemptCard({ attempt }) {
  return (
    <article className="relative ml-5 rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
      <span className="absolute -left-[1.85rem] top-4 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-pdi-teal text-white shadow">
        <Wrench size={13} />
      </span>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-pdi-navy">Repair #{attempt.attempt_number}</h4>
          <p className="mt-0.5 text-xs text-gray-500">{formatInjectorTestDateTime(attempt.repair_date)} · {attempt.technician}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${attempt.status === 'COMPLETED' ? resultStyle(attempt.outcome) : 'text-blue-700'}`}>
          {attempt.status === 'COMPLETED' ? attempt.outcome : 'Waiting for retest'}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Diagnosis</dt><dd className="mt-0.5 text-gray-800">{attempt.diagnosis}</dd></div>
        {attempt.hypothesis && <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Hypothesis</dt><dd className="mt-0.5 text-gray-800">{attempt.hypothesis}</dd></div>}
        {attempt.expected_outcome && <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Expected</dt><dd className="mt-0.5 text-gray-800">{attempt.expected_outcome}</dd></div>}
        {attempt.observed_outcome && <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Observed</dt><dd className="mt-0.5 text-gray-800">{attempt.observed_outcome}</dd></div>}
      </dl>

      <div className="mt-3 rounded-lg bg-gray-50 p-2.5">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Changes</div>
        <div className="mt-1.5 space-y-1.5">
          {(attempt.changes || []).map((change) => (
            <div key={change.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-gray-800">
              <span className="font-medium">{change.component}</span>
              <span className="text-gray-500">{change.action_type}{change.parameter ? ` · ${change.parameter}` : ''}</span>
              {(change.before_value || change.after_value) && (
                <span className="font-mono text-xs text-pdi-navy">{change.before_value || '—'} → {change.after_value || '—'} {change.unit || ''}</span>
              )}
              {change.notes && <span className="w-full text-xs text-gray-500">{change.notes}</span>}
            </div>
          ))}
        </div>
      </div>
      {attempt.repair_notes && <p className="mt-2 text-sm text-gray-600">{attempt.repair_notes}</p>}
      {attempt.after_test_datetime && (
        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
          <CircleDot size={14} className={resultStyle(attempt.after_result_status)} />
          Retested {formatInjectorTestDateTime(attempt.after_test_datetime)}
          <strong className={resultStyle(attempt.after_result_status)}>{attempt.after_result_status}</strong>
        </div>
      )}
      <DeltaTable deltas={attempt.deltas} />
    </article>
  )
}

function RepairCase({ repairCase, active, candidates, onRefresh, onAddAttempt }) {
  const { showToast } = useToast()
  const [status, setStatus] = useState(repairCase.status)
  const [updating, setUpdating] = useState(false)
  useEffect(() => setStatus(repairCase.status), [repairCase.status])
  const waitingAttempt = [...(repairCase.attempts || [])].reverse().find((attempt) => attempt.status === 'WAITING_RETEST')
  const lastAttempt = repairCase.attempts?.[repairCase.attempts.length - 1]
  const canAdd = active && repairCase.status === 'OPEN' && lastAttempt?.status === 'COMPLETED'
    && ['FAIL', 'DNF', 'UNKNOWN'].includes(lastAttempt?.outcome)

  const updateStatus = async () => {
    if (status === repairCase.status) return
    if (status === 'SCRAPPED' && !window.confirm('Mark this repair case as scrapped? Its history will remain available.')) {
      setStatus(repairCase.status)
      return
    }
    setUpdating(true)
    try {
      await api.patch(`/injector-tests/repairs/cases/${repairCase.id}/status`, { status })
      showToast(`Repair case set to ${CASE_STATUS_LABELS[status]}`, 'success')
      onRefresh()
    } catch (err) {
      setStatus(repairCase.status)
      showToast(apiError(err, 'The repair status could not be updated.'), 'error')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-pdi-navy">Repair Case</h3>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[repairCase.status] || STATUS_STYLES.OPEN}`}>
              {CASE_STATUS_LABELS[repairCase.status] || repairCase.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Opened {formatInjectorTestDateTime(repairCase.opened_at)} by {repairCase.opened_by_name || 'Unknown'} · {repairCase.attempt_count} attempt{repairCase.attempt_count === 1 ? '' : 's'}
          </p>
          {!!repairCase.failure_categories?.length && (
            <div className="mt-2 flex flex-wrap gap-1">
              {repairCase.failure_categories.map((category) => <span key={category} className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">{category}</span>)}
            </div>
          )}
        </div>
        {active && repairCase.status !== 'PASSED' && (
          <div className="flex items-end gap-2">
            <label className="text-xs text-gray-500">Case status
              <select value={status} onChange={(event) => setStatus(event.target.value)}
                className="mt-1 block rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800">
                <option value="OPEN">Open</option>
                <option value="HOLD">Hold</option>
                <option value="ENGINEERING_REVIEW">Engineering Review</option>
                <option value="SCRAPPED">Scrapped</option>
              </select>
            </label>
            <button type="button" onClick={updateStatus} disabled={updating || status === repairCase.status}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-pdi-navy hover:bg-gray-50 disabled:opacity-40">
              {updating ? 'Saving…' : 'Update'}
            </button>
          </div>
        )}
      </div>

      <div className="relative mt-4 space-y-3 border-l-2 border-gray-200 pl-2">
        <div className="relative ml-5 rounded-lg border border-red-100 bg-white px-3 py-2.5">
          <span className="absolute -left-[1.85rem] top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 text-white shadow">
            <AlertTriangle size={13} />
          </span>
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">Initial failed test</div>
          <div className="mt-0.5 text-sm text-gray-700">{formatInjectorTestDateTime(repairCase.initial_test_datetime)}</div>
        </div>
        {(repairCase.attempts || []).map((attempt) => <AttemptCard key={attempt.id} attempt={attempt} />)}
        {repairCase.status === 'PASSED' && (
          <div className="relative ml-5 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
            <span className="absolute -left-[1.85rem] top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-green-600 text-white shadow"><CheckCircle2 size={13} /></span>
            <div className="text-xs font-semibold uppercase tracking-wide text-green-800">Case closed · Passed</div>
            <div className="mt-0.5 text-sm text-green-900">{formatInjectorTestDateTime(repairCase.final_test_datetime)}</div>
          </div>
        )}
      </div>

      {active && waitingAttempt && (
        <div className="mt-4"><RetestLinker attempt={waitingAttempt} candidates={candidates} onLinked={onRefresh} /></div>
      )}
      {canAdd && (
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => onAddAttempt(repairCase)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-pdi-navy px-4 py-2 text-sm font-medium text-white hover:bg-pdi-navy-light">
            <Plus size={16} /> Add Repair #{repairCase.attempt_count + 1}
          </button>
        </div>
      )}
    </section>
  )
}

export default function InjectorRepairHistory({ testId }) {
  const qc = useQueryClient()
  const [formMode, setFormMode] = useState(null)
  const [formCase, setFormCase] = useState(null)
  const queryKey = useMemo(() => ['injector-repair-history', testId], [testId])
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: async () => { const response = await api.get(`/injector-tests/${testId}/repair-history`); return response.data },
    enabled: !!testId,
  })
  const activeCase = data?.cases?.find((repairCase) => repairCase.id === data.active_case_id) || null

  const refresh = () => {
    setFormMode(null)
    setFormCase(null)
    qc.invalidateQueries({ queryKey })
    qc.invalidateQueries({ queryKey: ['injector-tests'] })
  }

  if (isLoading) {
    return <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500"><Loader2 size={18} className="animate-spin" /> Loading repair history…</div>
  }
  if (error) {
    return <div className="flex items-start gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700"><AlertTriangle size={18} /> {apiError(error, 'Repair history could not be loaded.')}</div>
  }
  if (formMode) {
    return <RepairAttemptForm mode={formMode} repairCase={formCase} testId={testId} options={data?.options} onCancel={() => setFormMode(null)} onSaved={refresh} />
  }

  return (
    <div className="space-y-4">
      {isFetching && <div className="text-right text-xs text-gray-400">Refreshing…</div>}
      {!data?.cases?.length && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
          <Wrench size={28} className="mx-auto text-gray-400" />
          <h3 className="mt-2 text-sm font-semibold text-gray-800">No repair history recorded</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            Start a case to preserve the diagnosis, every physical change, and the measured effect of each retest.
          </p>
          {data?.can_start ? (
            <button type="button" onClick={() => setFormMode('start')}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-pdi-navy px-4 py-2 text-sm font-medium text-white hover:bg-pdi-navy-light">
              <Wrench size={16} /> Start Repair
            </button>
          ) : (
            <p className="mt-3 text-xs text-gray-400">A repair case can be started from a failed test with a serial number.</p>
          )}
        </div>
      )}

      {(data?.cases || []).map((repairCase) => (
        <RepairCase key={repairCase.id} repairCase={repairCase}
          active={repairCase.id === data.active_case_id}
          candidates={repairCase.id === data.active_case_id ? data.candidate_retests : []}
          onRefresh={refresh}
          onAddAttempt={(selectedCase) => { setFormCase(selectedCase); setFormMode('next') }} />
      ))}

      {data?.can_start && data?.cases?.length > 0 && !activeCase && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setFormMode('start')}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-pdi-navy px-4 py-2 text-sm font-medium text-white hover:bg-pdi-navy-light">
            <Wrench size={16} /> Start New Repair Case
          </button>
        </div>
      )}
    </div>
  )
}
