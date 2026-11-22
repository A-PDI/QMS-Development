import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Users } from 'lucide-react'
import { Dialog } from '../ui/dialog'
import { usePropagationPreview, usePropagateSpecs } from '../../hooks/usePartSpecs'

const SKIP_REASONS = {
  missing_point: 'not on this part’s form',
  incompatible_point: 'defined differently on this part’s form',
}

const btn = 'px-4 py-2 text-sm rounded-lg min-h-[40px] disabled:opacity-50'
const btnPrimary = `${btn} flex items-center justify-center gap-1.5 bg-pdi-navy text-white hover:bg-pdi-navy-light`
const btnSecondary = `${btn} border border-gray-200 hover:bg-gray-50`

function errorText(err, fallback) {
  return err?.response?.data?.error || err?.message || fallback
}

/**
 * Offer to copy a part's just-saved dimensional specs to the other part
 * numbers in its product family.
 *
 * Nothing is selected for the administrator: each related part is opted in
 * with its checkbox (or Select All). The review step shows, per part, which
 * points would be filled, which already hold a different spec (kept unless
 * the administrator ticks "Replace" for that part) and which points cannot be
 * mapped onto that part's form (skipped). Only then are the specs applied.
 *
 * Props: source { id, part_number, description }, family { name, explicit },
 * candidates [...], onClose(), showToast
 */
export default function PartFamilyDialog({ source, family, candidates, onClose, showToast }) {
  const [step, setStep] = useState('select')       // select | review | done
  const [selected, setSelected] = useState(() => new Set())
  const [plans, setPlans] = useState([])
  const [replace, setReplace] = useState(() => new Set())
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const preview = usePropagationPreview()
  const propagate = usePropagateSpecs()

  const toggle = (setter, id) => setter(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  async function handleReview() {
    setError('')
    try {
      const result = await preview.mutateAsync({ sourceId: source.id, targetIds: [...selected] })
      setPlans(result)
      setReplace(new Set())
      setStep('review')
    } catch (err) {
      setError(errorText(err, 'Could not check the selected part numbers'))
    }
  }

  async function handleApply() {
    setError('')
    try {
      const result = await propagate.mutateAsync({
        sourceId: source.id,
        targets: plans.map(p => ({ id: p.id, replace_conflicts: replace.has(p.id) })),
      })
      setResults(result)
      setStep('done')
      const updated = result.filter(r => r.applied + r.replaced > 0).length
      showToast?.(updated
        ? `Specifications applied to ${updated} part number${updated === 1 ? '' : 's'}`
        : 'No part numbers needed changes', 'success')
    } catch (err) {
      setError(errorText(err, 'Applying the specifications failed — nothing was changed'))
    }
  }

  const title = step === 'done' ? 'Specifications applied' : 'Apply to product family'
  const nothingToDo = plans.length > 0 && plans.every(p => p.apply.length === 0 && (p.conflicts.length === 0 || !replace.has(p.id)))

  return (
    <Dialog open onClose={onClose} title={title} className="sm:max-w-2xl">
      <div className="space-y-4">
        {step === 'select' && (
          <>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-pdi-frost flex items-center justify-center">
                <Users size={17} className="text-pdi-navy" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-800 font-medium">
                  Would you like to apply these dimensional specifications to other part numbers in this product family?
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Saved for <span className="font-mono font-semibold text-pdi-navy">{source.part_number}</span>
                  {family?.name && <> · Family <span className="font-semibold">{family.name}</span>{family.explicit ? ' (set on the part)' : ' (from the description)'}</>}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500">{selected.size} of {candidates.length} selected</span>
              <div className="flex gap-3">
                <button type="button" onClick={() => setSelected(new Set(candidates.map(c => c.id)))} className="text-xs text-pdi-navy hover:underline min-h-[32px]">Select All</button>
                <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-pdi-navy hover:underline min-h-[32px]">Deselect All</button>
              </div>
            </div>

            <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {candidates.map(c => (
                <li key={c.id}>
                  <label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(setSelected, c.id)}
                      className="mt-1 w-4 h-4 flex-shrink-0"
                      aria-label={`Apply to ${c.part_number}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm font-semibold text-pdi-navy break-words">{c.part_number}</span>
                      <span className="block text-xs text-gray-600 break-words">{c.description || '—'}</span>
                      <span className="block text-[11px] text-gray-400 mt-0.5">
                        {c.form_no}{c.variant ? ` · ${c.variant}` : ''} · {c.specified_points ? `${c.specified_points} spec${c.specified_points === 1 ? '' : 's'} already defined` : 'no specs yet'}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 'review' && (
          <>
            <p className="text-sm text-gray-700">
              Review what will change. Specs already on a part are only replaced where you tick <b>Replace</b>.
            </p>
            <div className="space-y-3 max-h-[55vh] overflow-y-auto">
              {plans.map(plan => (
                <div key={plan.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-pdi-navy">{plan.part_number}</span>
                    <span className="text-xs text-gray-500">
                      {plan.apply.length} to add · {plan.unchanged.length} already the same
                    </span>
                  </div>
                  {plan.apply.length > 0 && (
                    <ul className="text-xs text-gray-600 space-y-0.5">
                      {plan.apply.map(e => <li key={e.key}>+ {e.label}: <span className="font-mono">{e.new_text}</span></li>)}
                    </ul>
                  )}
                  {plan.conflicts.length > 0 && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 space-y-1.5">
                      <div className="flex items-start gap-1.5 text-xs text-amber-800 font-medium">
                        <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                        {plan.conflicts.length} point{plan.conflicts.length === 1 ? ' already has' : 's already have'} a different spec on this part
                      </div>
                      <ul className="text-xs text-amber-900 space-y-0.5 pl-5">
                        {plan.conflicts.map(c => (
                          <li key={c.key}>{c.label}: <span className="font-mono">{c.existing_text}</span> → <span className="font-mono">{c.new_text}</span></li>
                        ))}
                      </ul>
                      <label className="flex items-center gap-2 text-xs font-semibold text-amber-900 pl-5 min-h-[32px] cursor-pointer">
                        <input type="checkbox" checked={replace.has(plan.id)} onChange={() => toggle(setReplace, plan.id)} className="w-4 h-4" />
                        Replace the existing spec{plan.conflicts.length === 1 ? '' : 's'} on {plan.part_number}
                      </label>
                    </div>
                  )}
                  {plan.skipped.length > 0 && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 p-2.5">
                      <div className="text-xs text-gray-700 font-medium">Skipped — can’t be mapped onto this part’s inspection form:</div>
                      <ul className="text-xs text-gray-500 space-y-0.5 mt-1 pl-4 list-disc">
                        {plan.skipped.map(s => <li key={s.key}>{s.label} ({SKIP_REASONS[s.reason] || s.reason})</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {step === 'done' && (
          <ul className="space-y-2">
            {results.map(r => (
              <li key={r.id} className="border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
                <div className="flex items-center gap-1.5 font-mono text-sm font-semibold text-pdi-navy">
                  <CheckCircle2 size={14} className="text-pdi-green" /> {r.part_number}
                </div>
                <div className="mt-1">
                  {r.applied} added · {r.replaced} replaced · {r.unchanged} already the same
                  {r.kept_existing.length > 0 && ` · ${r.kept_existing.length} existing kept`}
                  {r.skipped.length > 0 && ` · ${r.skipped.length} skipped`}
                </div>
                {r.skipped.length > 0 && (
                  <div className="mt-1 text-gray-500">Skipped: {r.skipped.map(s => s.label).join(', ')}</div>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-sm text-pdi-red" role="alert">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {error}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-gray-100">
          {step === 'select' && (
            <>
              <button type="button" onClick={onClose} className={btnSecondary}>No, this part only</button>
              <button type="button" onClick={handleReview} disabled={selected.size === 0 || preview.isPending} className={btnPrimary}>
                {preview.isPending && <Loader2 size={14} className="animate-spin" />}
                Review {selected.size > 0 ? `(${selected.size})` : ''}
              </button>
            </>
          )}
          {step === 'review' && (
            <>
              <button type="button" onClick={() => setStep('select')} disabled={propagate.isPending} className={btnSecondary}>Back</button>
              <button type="button" onClick={handleApply} disabled={propagate.isPending || nothingToDo} className={btnPrimary}
                title={nothingToDo ? 'Nothing to change for the selected part numbers' : undefined}>
                {propagate.isPending && <Loader2 size={14} className="animate-spin" />}
                Apply specifications
              </button>
            </>
          )}
          {step === 'done' && (
            <button type="button" onClick={onClose} className={btnPrimary}>Done</button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
