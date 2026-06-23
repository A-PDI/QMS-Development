import { useEffect, useRef, useState } from 'react'

/**
 * A controlled-but-stable text input for measurement / decimal entry.
 *
 * Why this exists: several inspection section components used to define their
 * <input> wrapper *inside* the render function. Because the parent re-renders on
 * every keystroke (section data flows up via onChange), React saw a brand-new
 * component type each render and remounted the DOM <input>, which dropped focus
 * after every character. This component is defined once at module scope so its
 * identity is stable, and it keeps a local draft value so the caret/IME never
 * fights the parent's state updates.
 *
 * The committed value still flows to the parent via onChange so autosave works.
 */
export default function MeasurementInput({
  value = '',
  onChange,
  readOnly = false,
  placeholder = '',
  className = '',
  inputMode = 'decimal',
  ariaLabel,
}) {
  const [draft, setDraft] = useState(value ?? '')
  const focused = useRef(false)

  // Keep local draft in sync with external value, but only when the field is not
  // being actively edited (so we never clobber what the user is typing).
  useEffect(() => {
    if (!focused.current) setDraft(value ?? '')
  }, [value])

  if (readOnly) {
    return <span className="font-mono text-xs">{value || '\u2014'}</span>
  }

  return (
    <input
      type="text"
      inputMode={inputMode}
      aria-label={ariaLabel}
      className={className || 'w-full text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy'}
      value={draft}
      placeholder={placeholder}
      onFocus={() => { focused.current = true }}
      onChange={e => {
        const v = e.target.value
        setDraft(v)
        onChange(v)
      }}
      onBlur={() => {
        focused.current = false
        // Reconcile with the canonical value on blur.
        setDraft(value ?? '')
      }}
    />
  )
}
