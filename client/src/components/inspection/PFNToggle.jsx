import { Check, X } from 'lucide-react'

// Visual styling per option. Selected = solid, with a check (P) / X (F) / "A"
// or "N/A" glyph.
const SELECTED_STYLE = {
  P: 'bg-green-600 text-white border-green-600',
  F: 'bg-red-600 text-white border-red-600',
  A: 'bg-amber-500 text-white border-amber-500',
  N: 'bg-gray-400 text-white border-gray-400',
}

const LABELS = { P: 'Pass', F: 'Fail', A: 'Accepted', N: 'Not applicable' }

function Glyph({ option, size = 16 }) {
  if (option === 'P') return <Check size={size} strokeWidth={3} />
  if (option === 'F') return <X size={size} strokeWidth={3} />
  if (option === 'N') return <span className="text-[10px] font-bold leading-none">N/A</span>
  return <span className="text-xs font-bold leading-none">{option}</span>
}

/**
 * Pass / Fail / Accepted (/ N/A) selector.
 *
 * `allowed` (optional) limits which options can be picked — used for
 * dimensional points whose result is set automatically from the measurement:
 * the others stay visible but disabled, with `lockedTitle` explaining why.
 */
export default function PFNToggle({ value, onChange, readOnly = false, options = ['P', 'F', 'A'], allowed, lockedTitle }) {
  return (
    <div className="flex gap-1">
      {options.map(opt => {
        const selected = value === opt
        const locked = !readOnly && Array.isArray(allowed) && !allowed.includes(opt)
        const disabled = readOnly || locked
        const label = LABELS[opt] || opt
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            aria-label={label}
            aria-pressed={selected}
            title={locked && lockedTitle ? `${label} — ${lockedTitle}` : label}
            onClick={() => !disabled && onChange(selected ? '' : opt)}
            className={`w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center rounded border transition-colors ${
              selected
                ? SELECTED_STYLE[opt] || 'bg-blue-600 text-white border-blue-600'
                : locked
                  ? 'bg-gray-50 text-gray-200 border-gray-100'
                  : 'bg-white text-gray-300 border-gray-200 hover:border-gray-400 hover:text-gray-500'
            } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
          >
            <Glyph option={opt} />
          </button>
        )
      })}
    </div>
  )
}
