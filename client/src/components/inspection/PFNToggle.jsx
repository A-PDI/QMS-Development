import { Check, X } from 'lucide-react'

// Visual styling per option. Selected = solid, with a check (P) / X (F) / "A" glyph.
const SELECTED_STYLE = {
  P: 'bg-green-600 text-white border-green-600',
  F: 'bg-red-600 text-white border-red-600',
  A: 'bg-amber-500 text-white border-amber-500',
  N: 'bg-gray-400 text-white border-gray-400',
}

function Glyph({ option, size = 16 }) {
  if (option === 'P') return <Check size={size} strokeWidth={3} />
  if (option === 'F') return <X size={size} strokeWidth={3} />
  return <span className="text-xs font-bold leading-none">{option}</span>
}

export default function PFNToggle({ value, onChange, readOnly = false, options = ['P', 'F', 'A'] }) {
  return (
    <div className="flex gap-1">
      {options.map(opt => {
        const selected = value === opt
        return (
          <button
            key={opt}
            type="button"
            disabled={readOnly}
            aria-label={opt === 'P' ? 'Pass' : opt === 'F' ? 'Fail' : opt === 'A' ? 'Accepted' : opt}
            title={opt === 'P' ? 'Pass' : opt === 'F' ? 'Fail' : opt === 'A' ? 'Accepted' : opt}
            onClick={() => !readOnly && onChange(selected ? '' : opt)}
            className={`w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center rounded border transition-colors ${
              selected
                ? SELECTED_STYLE[opt] || 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-300 border-gray-200 hover:border-gray-400 hover:text-gray-500'
            } ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
          >
            <Glyph option={opt} />
          </button>
        )
      })}
    </div>
  )
}
