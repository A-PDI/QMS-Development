import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { SPEC_ERROR_MESSAGES, SPEC_UNITS, resolveSpec } from '../../lib/dimensional'
import { ENTRY_TYPES, emptyEntry, previewEntry } from '../../lib/specEditor'

const inputClass = 'w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[38px]'

function Field({ label, children }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-medium text-gray-500 mb-0.5">{label}</span>
      {children}
    </label>
  )
}

/** Live result of an entry: the acceptable range, or why it can't be evaluated. */
function EntryPreview({ entry, defaultSpec }) {
  const preview = previewEntry(entry)
  if (!preview) {
    const fallback = defaultSpec ? resolveSpec(defaultSpec) : null
    if (fallback?.evaluable) {
      return (
        <p className="flex items-start gap-1.5 text-xs text-gray-500">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>Not specified for this part — the form default <b className="font-mono">{fallback.rangeText}</b> is used.</span>
        </p>
      )
    }
    return <p className="text-xs text-gray-400">Not specified — Pass/Fail is selected manually during inspection.</p>
  }
  if (preview.evaluable) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-pdi-green">
        <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
        <span>Acceptable range <b className="font-mono">{preview.rangeText}</b> (limits inclusive) — Pass/Fail is automatic.</span>
      </p>
    )
  }
  if (entry.type === 'text') {
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-700">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>Shown to the inspector; Pass/Fail is selected manually.</span>
      </p>
    )
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-pdi-red" role="alert">
      <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
      <span>{SPEC_ERROR_MESSAGES[preview.error] || 'Invalid specification'}</span>
    </p>
  )
}

function PointRow({ point, entry, onChange }) {
  const e = entry || emptyEntry()
  const set = (field, value) => onChange({ ...e, [field]: value })
  const unitId = `units-${point.key}`
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0" data-point-key={point.key}>
      <div className="flex flex-col lg:flex-row lg:items-start gap-2 lg:gap-4">
        <div className="lg:w-56 flex-shrink-0 min-w-0">
          <div className="text-sm font-medium text-gray-800 break-words">{point.label}</div>
          {point.location && <div className="text-[11px] text-gray-400 break-words line-clamp-2">{point.location}</div>}
          {point.defaultSpec && (
            <div className="text-[11px] text-gray-400 break-words">Form default: <span className="font-mono">{point.defaultSpec}</span></div>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="col-span-2 sm:col-span-4 lg:col-span-1">
              <Field label="Format">
                <select
                  value={e.type}
                  onChange={ev => set('type', ev.target.value)}
                  aria-label={`${point.label} specification format`}
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[38px]"
                >
                  {ENTRY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
            </div>
            {e.type === 'tolerance' && (
              <>
                <Field label="Nominal">
                  <input value={e.nominal} onChange={ev => set('nominal', ev.target.value)} inputMode="decimal" placeholder="25.000"
                    aria-label={`${point.label} nominal`} className={inputClass} />
                </Field>
                <Field label="Lower tol (−)">
                  <input value={e.lower_tol} onChange={ev => set('lower_tol', ev.target.value)} inputMode="decimal" placeholder="-0.050"
                    aria-label={`${point.label} lower tolerance`} className={inputClass} />
                </Field>
                <Field label="Upper tol (+)">
                  <input value={e.upper_tol} onChange={ev => set('upper_tol', ev.target.value)} inputMode="decimal" placeholder="+0.050"
                    aria-label={`${point.label} upper tolerance`} className={inputClass} />
                </Field>
              </>
            )}
            {e.type === 'limits' && (
              <>
                <Field label="Min (blank = none)">
                  <input value={e.min} onChange={ev => set('min', ev.target.value)} inputMode="decimal" placeholder="24.950"
                    aria-label={`${point.label} minimum`} className={inputClass} />
                </Field>
                <Field label="Max (blank = none)">
                  <input value={e.max} onChange={ev => set('max', ev.target.value)} inputMode="decimal" placeholder="25.050"
                    aria-label={`${point.label} maximum`} className={inputClass} />
                </Field>
              </>
            )}
            {(e.type === 'tolerance' || e.type === 'limits') && (
              <Field label="Unit">
                <input value={e.unit} onChange={ev => set('unit', ev.target.value)} list={unitId} placeholder="in"
                  aria-label={`${point.label} unit`} className={inputClass} maxLength={12} />
                <datalist id={unitId}>{SPEC_UNITS.map(u => <option key={u} value={u} />)}</datalist>
              </Field>
            )}
            {e.type === 'text' && (
              <div className="col-span-2 sm:col-span-3">
                <Field label="Specification text">
                  <input value={e.text} onChange={ev => set('text', ev.target.value)} placeholder="e.g. Per drawing 12345 rev C"
                    aria-label={`${point.label} specification text`} maxLength={200}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[38px]" />
                </Field>
              </div>
            )}
          </div>
          <EntryPreview entry={e} defaultSpec={point.defaultSpec} />
        </div>
      </div>
    </div>
  )
}

/**
 * Specification entry for every dimensional inspection point on a form,
 * grouped by section. `entries` maps point key → editor entry.
 */
export default function DimensionalSpecEditor({ points, issues = [], entries, onChange }) {
  const groups = []
  for (const point of points) {
    let group = groups.find(g => g.sectionKey === point.sectionKey)
    if (!group) { group = { sectionKey: point.sectionKey, title: point.sectionTitle, points: [] }; groups.push(group) }
    group.points.push(point)
  }
  return (
    <div className="space-y-4">
      {issues.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <div>
            Some inspection points on this form can't be given a specification until the form is corrected in
            Inspection Forms:
            <ul className="mt-1 list-disc pl-4">
              {issues.map((issue, i) => (
                <li key={i}>
                  {issue.sectionTitle} — {issue.label}: {issue.reason === 'duplicate_id' ? `item id ${issue.itemId} is used twice` : 'the item has no id'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {groups.map(group => (
        <div key={group.sectionKey} className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            {group.title}
          </div>
          <div className="px-3">
            {group.points.map(point => (
              <PointRow key={point.key} point={point} entry={entries[point.key]} onChange={entry => onChange(point.key, entry)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
