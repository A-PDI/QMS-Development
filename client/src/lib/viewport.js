// Keeping the app shell where it belongs on phones.
//
// The shell (components/Layout.jsx) fills exactly the visible screen and does
// its own scrolling, so the document itself never needs to scroll. iOS Safari
// scrolls the document anyway to lift a focused field above the on-screen
// keyboard, and leaves it scrolled when the keyboard goes away — the shell
// then sits pushed up with blank page showing beneath it. Once no field has
// focus, the document is put back at the top.

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

/** True for an element that brings up the keyboard (or a picker wheel). */
export function isEditableElement(el) {
  if (!el) return false
  const tag = String(el.tagName || '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(String(el.type || 'text').toLowerCase())
  return el.isContentEditable === true
}

/** Scroll the document back to the top unless a field is being edited. Returns true if it moved. */
export function restoreDocumentScroll(win, doc) {
  if (isEditableElement(doc.activeElement)) return false
  if (!win.scrollX && !win.scrollY) return false
  win.scrollTo(0, 0)
  return true
}

/**
 * Put the document back whenever focus leaves a field or the visible viewport
 * changes size (the keyboard closing, rotation). Returns a cleanup function.
 */
export function installDocumentScrollRestore(win = window, doc = document, delayMs = 150) {
  let timer = null
  const schedule = () => {
    clearTimeout(timer)
    // After the keyboard has finished animating away / focus has moved on.
    timer = setTimeout(() => restoreDocumentScroll(win, doc), delayMs)
  }
  doc.addEventListener('focusout', schedule)
  win.visualViewport?.addEventListener('resize', schedule)
  win.addEventListener('orientationchange', schedule)
  return () => {
    clearTimeout(timer)
    doc.removeEventListener('focusout', schedule)
    win.visualViewport?.removeEventListener('resize', schedule)
    win.removeEventListener('orientationchange', schedule)
  }
}
