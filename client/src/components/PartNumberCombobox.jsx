import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Check, Loader2 } from 'lucide-react'
import { usePartNumberLookup } from '../hooks/usePartSpecs'

/**
 * Typeahead combobox for part numbers.
 *
 * Free-text entry is always allowed (the value is whatever the user typed);
 * the dropdown suggests known part numbers from the curated catalogue and
 * past inspections. Selecting a suggestion calls `onSelect(record)` so the
 * parent can auto-fill related fields (e.g. description, template).
 *
 * Props:
 *  - value:        current part number string (controlled)
 *  - onChange:     (string) => void           — fired on every keystroke
 *  - onSelect:     (record) => void           — fired when a suggestion is chosen
 *  - templateId:   optional template filter for suggestions
 *  - required, id, placeholder, className, inputClassName
 */
export default function PartNumberCombobox({
  value = '',
  onChange,
  onSelect,
  templateId,
  required = false,
  id,
  placeholder = 'Type or select a part number…',
  inputClassName = '',
}) {
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState(value)
  const [highlight, setHighlight] = useState(-1)
  const wrapRef = useRef(null)
  const blurTimer = useRef(null)

  // Debounce the query that hits the server.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 200)
    return () => clearTimeout(t)
  }, [value])

  const { data: results = [], isFetching } = usePartNumberLookup(debounced, {
    templateId,
    enabled: open,
  })

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => () => clearTimeout(blurTimer.current), [])

  const choose = useCallback((rec) => {
    onChange?.(rec.part_number)
    onSelect?.(rec)
    setOpen(false)
    setHighlight(-1)
  }, [onChange, onSelect])

  function handleKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      if (highlight >= 0 && results[highlight]) {
        e.preventDefault()
        choose(results[highlight])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlight(-1)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          required={required}
          value={value}
          placeholder={placeholder}
          onChange={e => { onChange?.(e.target.value); setOpen(true); setHighlight(-1) }}
          onFocus={() => setOpen(true)}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120) }}
          onKeyDown={handleKeyDown}
          className={
            inputClassName ||
            'w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy min-h-[40px]'
          }
        />
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          {isFetching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
        </span>
      </div>

      {open && (results.length > 0 || (debounced && !isFetching)) && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-400">
              No matching parts — press Enter to use “{debounced}” as a new part number.
            </li>
          ) : (
            results.map((rec, idx) => (
              <li
                key={`${rec.part_number}-${rec.template_id}`}
                role="option"
                aria-selected={idx === highlight}
                onMouseDown={e => { e.preventDefault(); choose(rec) }}
                onMouseEnter={() => setHighlight(idx)}
                className={`flex items-start gap-2 px-3 py-2 cursor-pointer text-sm ${
                  idx === highlight ? 'bg-pdi-frost' : 'hover:bg-gray-50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 truncate">{rec.part_number}</span>
                    {rec.source === 'catalogue' && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-pdi-navy bg-pdi-navy/10 px-1.5 py-0.5 rounded">
                        <Check size={9} /> Catalog
                      </span>
                    )}
                  </div>
                  {rec.description && (
                    <div className="text-xs text-gray-500 truncate">{rec.description}</div>
                  )}
                  {rec.form_no && (
                    <div className="text-[10px] text-gray-400 truncate">{rec.form_no}</div>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
