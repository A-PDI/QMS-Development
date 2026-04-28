import { PFN_COLORS } from '../../lib/constants'

export default function PFNToggle({ value, onChange, readOnly = false, options = ['P', 'F', 'A'] }) {
  return (
    <div className="flex gap-1">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          disabled={readOnly}
          onClick={() => !readOnly && onChange(value === opt ? '' : opt)}
          className={`w-10 h-10 sm:w-9 sm:h-9 text-sm sm:text-xs font-bold rounded border transition-colors ${
            value === opt
              ? PFN_COLORS[opt] || 'bg-blue-100 text-blue-700 border-blue-300'
              : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
          } ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}