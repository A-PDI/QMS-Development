import { useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { FIELD_META } from '../../lib/esign'

/**
 * A field on the editor canvas: click to select, drag to move, drag the
 * corner to resize. Works with mouse, pen and touch (pointer events).
 *
 * rect     — screen rectangle within the page ({left, top, width, height})
 * bounds   — page size in px ({width, height}) to keep the box on the page
 * onCommit — called with the final rect when a drag/resize ends
 */
export default function FieldBox({ field, rect, bounds, color, selected, recipientName, onSelect, onCommit }) {
  const [live, setLive] = useState(null)
  const drag = useRef(null)
  const r = live || rect
  const meta = FIELD_META[field.type] || { label: field.type }
  const unassigned = !field.recipient_id

  function start(e, mode) {
    e.stopPropagation()
    e.preventDefault()
    onSelect?.()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, rect: { ...rect }, moved: false }
  }

  function move(e) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
    let next
    if (d.mode === 'move') {
      next = {
        ...d.rect,
        left: Math.min(Math.max(d.rect.left + dx, 0), bounds.width - d.rect.width),
        top: Math.min(Math.max(d.rect.top + dy, 0), bounds.height - d.rect.height),
      }
    } else {
      next = {
        ...d.rect,
        width: Math.min(Math.max(d.rect.width + dx, 10), bounds.width - d.rect.left),
        height: Math.min(Math.max(d.rect.height + dy, 10), bounds.height - d.rect.top),
      }
    }
    setLive(next)
  }

  function end() {
    const d = drag.current
    drag.current = null
    if (d && d.moved && live) onCommit?.(live)
    setLive(null)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${meta.label} field${recipientName ? ` for ${recipientName}` : ', unassigned'}`}
      onPointerDown={(e) => start(e, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => e.stopPropagation()}
      className="absolute select-none touch-none group"
      style={{
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        border: `1.5px ${unassigned ? 'dashed' : 'solid'} ${color.border}`,
        background: color.fill,
        borderRadius: 3,
        cursor: 'move',
        boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 4px ${color.border}` : undefined,
        zIndex: selected ? 20 : 10,
      }}
    >
      <div
        className="absolute left-0 -top-[15px] max-w-[220px] truncate whitespace-nowrap rounded-t px-1 text-[10px] font-semibold leading-[15px] text-white"
        style={{ background: color.border }}
      >
        {unassigned && <AlertTriangle size={9} className="inline -mt-0.5 mr-0.5" />}
        {meta.label}{field.required === false ? ' (optional)' : ''}
      </div>
      {r.height >= 14 && field.type !== 'checkbox' && (
        <div className="flex h-full items-center px-1 text-[10px] leading-none truncate" style={{ color: color.text }}>
          {recipientName || 'Unassigned'}
        </div>
      )}
      <div
        onPointerDown={(e) => start(e, 'resize')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className={`absolute -right-1.5 -bottom-1.5 h-3 w-3 rounded-sm border border-white ${selected ? 'block' : 'hidden group-hover:block'}`}
        style={{ background: color.border, cursor: 'nwse-resize' }}
        aria-hidden="true"
      />
    </div>
  )
}
