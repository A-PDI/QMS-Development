/**
 * pdf.js, configured once for the app.
 *
 * The worker is bundled by Vite (?url import) and served from our own origin,
 * which the production Content-Security-Policy allows. isEvalSupported is off
 * so pdf.js never needs 'unsafe-eval'.
 */
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Open a PDF from bytes. pdf.js takes ownership of (detaches) the buffer it is
 * given, so a copy is passed and the caller's bytes stay usable.
 */
export function openPdf(bytes) {
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0))
  return pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
  }).promise
}
