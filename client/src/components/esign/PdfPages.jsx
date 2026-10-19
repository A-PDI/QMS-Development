import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { openPdf } from '../../lib/pdfjs'

/**
 * Renders every page of a PDF, scaled to the container width, with an overlay
 * layer per page for field boxes.
 *
 *   <PdfPages
 *     bytes={arrayBuffer}
 *     renderOverlay={(pageIndex, viewport) => <…/>}   // absolutely positioned children
 *     onPageClick={(pageIndex, viewport, event) => …}  // optional
 *   />
 *
 * `viewport` is a pdf.js PageViewport: use lib/esign.js fieldToScreen /
 * screenToField to convert between PDF points and pixels.
 */
export default function PdfPages({ bytes, renderOverlay, onPageClick, maxWidth = 980, className = '', pageClassName = '', cursor }) {
  const containerRef = useRef(null)
  const [pdf, setPdf] = useState(null)
  const [error, setError] = useState(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!bytes) return undefined
    let cancelled = false
    let doc = null
    setPdf(null)
    setError(null)
    openPdf(bytes)
      .then((d) => {
        doc = d
        if (cancelled) d.destroy()
        else setPdf(d)
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'The PDF could not be displayed')
      })
    return () => {
      cancelled = true
      if (doc) doc.destroy()
    }
  }, [bytes])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const update = () => setWidth(Math.min(el.clientWidth, maxWidth))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxWidth])

  return (
    <div ref={containerRef} className={`w-full ${className}`}>
      {error ? (
        <div className="flex items-center gap-2 text-sm text-pdi-red bg-pdi-red-light rounded-lg p-4">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : !pdf || !width ? (
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-16">
          <Loader2 size={18} className="animate-spin" /> Loading document…
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage
              key={i}
              pdf={pdf}
              index={i}
              width={width}
              renderOverlay={renderOverlay}
              onPageClick={onPageClick}
              className={pageClassName}
              cursor={cursor}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PdfPage({ pdf, index, width, renderOverlay, onPageClick, className, cursor }) {
  const canvasRef = useRef(null)
  const [viewport, setViewport] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let task = null
    pdf.getPage(index + 1).then((page) => {
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: width / base.width })
      const canvas = canvasRef.current
      if (!canvas) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2.5)
      canvas.width = Math.floor(vp.width * ratio)
      canvas.height = Math.floor(vp.height * ratio)
      canvas.style.width = `${vp.width}px`
      canvas.style.height = `${vp.height}px`
      const ctx = canvas.getContext('2d')
      task = page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      })
      setViewport(vp)
      task.promise.catch((err) => {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) setFailed(true)
      })
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      if (task) task.cancel()
    }
  }, [pdf, index, width])

  return (
    <div
      className={`relative bg-white shadow-md ring-1 ring-black/5 ${className}`}
      style={viewport ? { width: viewport.width, height: viewport.height, cursor } : { width, height: width * 1.294 }}
      data-page-index={index}
      onClick={(e) => {
        if (!onPageClick || !viewport) return
        if (e.target !== e.currentTarget && !e.target.dataset?.pageLayer) return
        onPageClick(index, viewport, e)
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none select-none" aria-label={`Page ${index + 1}`} />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Page {index + 1} could not be drawn</div>
      )}
      {viewport && (
        <div className="absolute inset-0" data-page-layer="1">
          {renderOverlay?.(index, viewport)}
        </div>
      )}
      <div className="absolute -left-1 top-1 -translate-x-full text-[10px] text-gray-400 hidden xl:block">{index + 1}</div>
    </div>
  )
}
