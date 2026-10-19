import { useEffect, useRef, useState } from 'react'
import { Eraser, PenLine, Type, X } from 'lucide-react'
import '@fontsource/dancing-script/500.css'
import '@fontsource/great-vibes/400.css'
import '@fontsource/caveat/500.css'

const FONTS = [
  { family: 'Dancing Script', weight: 500, label: 'Script' },
  { family: 'Great Vibes', weight: 400, label: 'Formal' },
  { family: 'Caveat', weight: 500, label: 'Handwritten' },
]
const INK = '#13235b'

/** A typed name rendered in a signature font, as a tight PNG data URL. */
async function renderTyped(text, font) {
  const size = 96
  const spec = `${font.weight} ${size}px "${font.family}"`
  try { await document.fonts.load(spec, text) } catch (_) { /* fall back to whatever loaded */ }
  const measure = document.createElement('canvas').getContext('2d')
  measure.font = spec
  const m = measure.measureText(text)
  const ascent = m.actualBoundingBoxAscent || size * 0.8
  const descent = m.actualBoundingBoxDescent || size * 0.25
  const pad = 16
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width) + pad * 2)
  canvas.height = Math.ceil(ascent + descent + pad * 2)
  const ctx = canvas.getContext('2d')
  ctx.font = spec
  ctx.fillStyle = INK
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, pad + (m.actualBoundingBoxLeft || 0), pad + ascent)
  return canvas.toDataURL('image/png')
}

/** The drawn strokes cropped to their bounding box, as a PNG data URL (null when blank). */
function exportDrawn(canvas) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const pad = 8
  const w = maxX - minX + 1 + pad * 2
  const h = maxY - minY + 1 + pad * 2
  const scale = Math.min(1, 1200 / w)
  const out = document.createElement('canvas')
  out.width = Math.ceil(w * scale)
  out.height = Math.ceil(h * scale)
  out.getContext('2d').drawImage(canvas, minX - pad, minY - pad, w, h, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

function DrawCanvas({ onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ratio = Math.min(window.devicePixelRatio || 1, 3)
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.floor(rect.width * ratio)
    canvas.height = Math.floor(rect.height * ratio)
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.6
  }, [])

  function point(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function down(e) {
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    const p = point(e)
    drawing.current = { last: p, mid: p }
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = point(e)
    const { last, mid } = drawing.current
    const nextMid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 }
    ctx.beginPath()
    ctx.moveTo(mid.x, mid.y)
    ctx.quadraticCurveTo(last.x, last.y, nextMid.x, nextMid.y)
    ctx.stroke()
    drawing.current = { last: p, mid: nextMid }
  }

  function up() {
    if (!drawing.current) return
    drawing.current = null
    onChange(canvasRef.current)
  }

  function clear() {
    const c = canvasRef.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    onChange(null)
  }

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-pdi-steel bg-white">
        <canvas
          ref={canvasRef}
          className="w-full h-44 touch-none cursor-crosshair rounded-xl"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label="Draw your signature"
        />
        <div className="pointer-events-none absolute left-6 right-6 bottom-10 border-b border-gray-300" />
        <span className="pointer-events-none absolute left-6 bottom-4 text-[11px] text-gray-400">Sign above the line</span>
      </div>
      <button type="button" onClick={clear} className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-pdi-navy">
        <Eraser size={13} /> Clear
      </button>
    </div>
  )
}

/**
 * Modal to adopt a signature or initials: type it (choose a style) or draw it.
 * onAdopt({ method: 'typed'|'drawn', text, image }) — image is a PNG data URL.
 */
export default function SignaturePad({ open, kind = 'signature', defaultText = '', onAdopt, onClose }) {
  const [tab, setTab] = useState('type')
  const [text, setText] = useState(defaultText)
  const [fontIdx, setFontIdx] = useState(0)
  const [drawnCanvas, setDrawnCanvas] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const noun = kind === 'initials' ? 'initials' : 'signature'

  useEffect(() => {
    if (open) {
      setText(defaultText)
      setError('')
      setDrawnCanvas(null)
    }
  }, [open, defaultText])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function adopt() {
    setError('')
    setBusy(true)
    try {
      if (tab === 'type') {
        const t = text.trim()
        if (!t) { setError(`Type your ${noun}`); return }
        onAdopt({ method: 'typed', text: t, image: await renderTyped(t, FONTS[fontIdx]) })
      } else {
        const image = drawnCanvas ? exportDrawn(drawnCanvas) : null
        if (!image) { setError(`Draw your ${noun} in the box`); return }
        onAdopt({ method: 'drawn', text: null, image })
      }
    } catch (err) {
      setError(err?.message || `Could not create your ${noun}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={`Adopt your ${noun}`}>
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-pdi-navy">Adopt your {noun}</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="inline-flex rounded-lg bg-gray-100 p-1 text-sm">
            {[['type', 'Type', Type], ['draw', 'Draw', PenLine]].map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setTab(key); setError('') }}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md font-medium transition-colors ${
                  tab === key ? 'bg-white text-pdi-navy shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {tab === 'type' ? (
            <>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={kind === 'initials' ? 6 : 80}
                placeholder={kind === 'initials' ? 'Your initials' : 'Your full name'}
                className="w-full rounded-lg border border-pdi-steel px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy"
                autoFocus
              />
              <div className="grid gap-2">
                {FONTS.map((f, i) => (
                  <button
                    key={f.family}
                    type="button"
                    onClick={() => setFontIdx(i)}
                    className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-left transition-colors ${
                      fontIdx === i ? 'border-pdi-navy ring-2 ring-pdi-navy/20 bg-pdi-frost/40' : 'border-gray-200 hover:border-pdi-steel'
                    }`}
                  >
                    <span className="truncate text-3xl leading-tight" style={{ fontFamily: `"${f.family}"`, fontWeight: f.weight, color: INK }}>
                      {text.trim() || (kind === 'initials' ? 'AB' : 'Your Name')}
                    </span>
                    <span className="ml-3 text-[11px] uppercase tracking-wide text-gray-400 flex-shrink-0">{f.label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <DrawCanvas onChange={setDrawnCanvas} />
          )}
          {error && <p className="text-sm text-pdi-red">{error}</p>}
          <p className="text-[11px] leading-relaxed text-gray-500">
            By selecting Adopt, you agree that this {noun} is the electronic representation of your {noun} for this document,
            with the same effect as a pen-and-ink {noun}.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button
            type="button"
            onClick={adopt}
            disabled={busy}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-pdi-navy text-white hover:bg-pdi-navy-light disabled:opacity-50"
          >
            {busy ? 'Preparing…' : `Adopt ${noun}`}
          </button>
        </div>
      </div>
    </div>
  )
}
