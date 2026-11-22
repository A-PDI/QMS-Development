import { AlertTriangle, Lock } from 'lucide-react'
import { classifyMeasurement, evaluationMessage } from '../../lib/dimensional'

// Shared display pieces for automatically evaluated dimensional points. The
// rules come from lib/dimensional (shared with the server); these only show
// them, so every section type presents a configured spec the same way.

const SOURCE_LABEL = { part: 'Part spec', form: 'Form spec' }

/** The configured spec and its acceptable range, shown where the reading is entered. */
export function SpecInfo({ spec, className = '' }) {
  if (!spec) return null
  return (
    <div className={`text-xs leading-snug ${className}`}>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="font-mono font-semibold text-gray-800 break-all">{spec.text}</span>
        <span className="inline-flex items-center gap-0.5 rounded bg-pdi-frost px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-pdi-navy">
          <Lock size={9} /> {SOURCE_LABEL[spec.source] || 'Spec'}
        </span>
      </div>
      <div className="text-gray-500">
        Accept <span className="font-mono">{spec.rangeText}</span>
      </div>
    </div>
  )
}

const STATE_STYLE = {
  pass: 'bg-pdi-green-light text-pdi-green border-pdi-green/30',
  fail: 'bg-pdi-red-light text-pdi-red border-pdi-red/30',
  invalid: 'bg-amber-50 text-amber-700 border-amber-300',
  not_evaluated: 'bg-gray-50 text-gray-500 border-gray-200',
}
const STATE_LABEL = { pass: 'Auto · Pass', fail: 'Auto · Fail', invalid: 'Invalid entry', not_evaluated: 'Not evaluated' }

/** Result of the automatic evaluation (nothing for a manual point). */
export function EvaluationBadge({ evaluation, accepted = false }) {
  if (!evaluation || evaluation.state === 'manual') return null
  const label = evaluation.state === 'fail' && accepted ? 'Auto · Fail → Accepted' : STATE_LABEL[evaluation.state]
  return (
    <span
      role="status"
      title={evaluationMessage(evaluation)}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATE_STYLE[evaluation.state] || ''}`}
    >
      {evaluation.state === 'invalid' && <AlertTriangle size={11} />}
      {label}
    </span>
  )
}

/** Inline validation message for an invalid entry. */
export function InvalidEntryMessage({ evaluation }) {
  if (evaluation?.state !== 'invalid') return null
  return <span className="block text-[11px] text-amber-700 mt-0.5" role="alert">{evaluationMessage(evaluation)}</span>
}

const TONE = {
  within: 'border-green-400 bg-green-50',
  below: 'border-red-400 bg-red-50 text-red-700',
  above: 'border-red-400 bg-red-50 text-red-700',
  invalid: 'border-amber-400 bg-amber-50',
}

/** Extra input classes colouring one reading against the spec. */
export function readingTone(spec, raw) {
  return TONE[classifyMeasurement(spec, raw)] || ''
}

/** Accessible description of one reading against the spec. */
export function readingTitle(spec, raw) {
  switch (classifyMeasurement(spec, raw)) {
    case 'below': return 'Below the minimum'
    case 'above': return 'Above the maximum'
    case 'within': return 'Within specification'
    case 'invalid': return 'Not a valid number'
    default: return undefined
  }
}
