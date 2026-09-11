import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import api from '../lib/api'
import { getUser } from '../lib/auth'
import { formatInjectorTestDateTime } from '../lib/injectorDateTime'
import { useToast } from '../hooks/useToast'

export default function InjectorQuickEntry({ injector, onClose, onHistory }) {
  const qc = useQueryClient()
  const { showToast } = useToast()
  const dialog = useRef(null)
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState({})
  const [error, setError] = useState('')
  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ['injector-quick-entry', injector.id],
    queryFn: async () => (await api.get(`/injector-tests/${injector.id}/quick-entry`)).data,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    const keydown = (event) => {
      if (event.key === 'Escape' && !busy.current) onClose()
      if (event.key !== 'Tab') return
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', keydown)
      previousFocus?.focus()
    }
  }, [onClose])

  const valueFor = (measurement) => values[measurement.key] || {
    before_value: '', after_value: '', unit: measurement.units.includes('mm') ? 'mm' : '',
  }
  const update = (measurement, field, value) => setValues((current) => ({
    ...current, [measurement.key]: { ...valueFor(measurement), [field]: value },
  }))

  const submit = async (event) => {
    event.preventDefault()
    if (busy.current || !data?.can_save) return
    busy.current = true
    setSaving(true)
    setError('')
    try {
      await api.post(`/injector-tests/${injector.id}/quick-entry`, {
        measurements: data.measurements.map((measurement) => ({ key: measurement.key, ...valueFor(measurement) })),
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['injector-tests'] }),
        qc.invalidateQueries({ queryKey: ['injector-repair-history'] }),
        qc.invalidateQueries({ queryKey: ['injector-quick-entry'] }),
      ])
      showToast('Measurements saved. Repair history updated.', 'success')
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error || 'Measurements could not be saved. Please try again.')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="quick-entry-title"
        className="flex max-h-[95dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl outline-none">
        <header className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <h2 id="quick-entry-title" className="text-lg font-bold text-pdi-navy">Quick Entry</h2>
            <p className="text-sm text-gray-700">{injector.part_number || '—'} · SN {injector.serial_number || '—'}</p>
            <p className="text-xs text-gray-500">Test: {formatInjectorTestDateTime(injector.test_datetime)}</p>
          </div>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Close Quick Entry" className="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-50"><X size={20} /></button>
        </header>
        {isLoading ? <p className="p-6 text-sm text-gray-600" role="status">Loading measurement entry…</p>
          : loadError ? <div className="p-4 text-sm text-red-700" role="alert">Could not load Quick Entry. <button type="button" onClick={() => refetch()} className="underline">Try again</button></div>
            : <form onSubmit={submit} className="min-h-0 overflow-y-auto p-3 sm:p-4">
              {!data?.can_save && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{data?.reason}</p>}
              {data?.links_previous_retest && <p className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Saving will use this test as the result of the previous repair and record Repair #{data.attempt_number}.</p>}
              <p className="mb-3 text-sm text-gray-600">Enter the measurements taken before and after this repair. Leave unused rows blank.</p>
              <fieldset disabled={saving || !data?.can_save}>
                <table className="w-full table-fixed text-sm">
                  <thead><tr className="border-b bg-gray-50 text-left text-gray-600">
                    <th scope="col" className="w-[46%] p-2">Measurement</th>
                    <th scope="col" className="w-[27%] p-2">Before</th>
                    <th scope="col" className="w-[27%] p-2">After</th>
                  </tr></thead>
                  <tbody>{data?.measurements.map((measurement) => {
                    const value = valueFor(measurement)
                    const entered = value.before_value !== '' || value.after_value !== ''
                    return <tr key={measurement.key} className="border-b border-gray-100">
                      <th scope="row" className="p-2 text-left font-medium text-gray-800">
                        {measurement.label}
                        <select aria-label={`${measurement.label} unit`} required={entered} value={value.unit}
                          onChange={(event) => update(measurement, 'unit', event.target.value)}
                          className="mt-1 block max-w-full rounded border border-gray-300 bg-white px-1 py-1 text-sm font-normal">
                          <option value="">Unit…</option>
                          {measurement.units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                        </select>
                      </th>
                      {['before_value', 'after_value'].map((field) => <td key={field} className="p-1 sm:p-2">
                        <input type="text" inputMode="decimal" pattern="(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)" maxLength={100}
                          required={entered} aria-label={`${measurement.label} ${field === 'before_value' ? 'Before' : 'After'}`}
                          value={value[field]} onChange={(event) => update(measurement, field, event.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2 py-3 text-base focus:border-pdi-navy focus:outline-none focus:ring-1 focus:ring-pdi-navy" />
                      </td>)}
                    </tr>
                  })}</tbody>
                </table>
              </fieldset>
              <p className="mt-3 text-sm text-gray-500">Recorded as {getUser()?.name || 'the signed-in technician'} at the time of saving.</p>
              {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
              <footer className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <button type="button" disabled={saving} onClick={onHistory} className="text-sm font-medium text-pdi-navy underline">View Repair History</button>
                <button type="submit" disabled={saving || !data?.can_save} className="inline-flex items-center gap-2 rounded-lg bg-pdi-navy px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
                  {saving && <Loader2 size={16} className="animate-spin" />}{saving ? 'Saving…' : 'Save Measurements'}
                </button>
              </footer>
            </form>}
      </section>
    </div>
  )
}
