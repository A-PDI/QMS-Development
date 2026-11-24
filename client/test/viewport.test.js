/**
 * Putting the document back after iOS scrolls it for the keyboard, so the app
 * shell isn't left pushed up with blank space beneath it.
 */

import test from 'node:test'
import assert from 'node:assert'

import { isEditableElement, restoreDocumentScroll, installDocumentScrollRestore } from '../src/lib/viewport.js'

function fakeWin(scrollY = 0) {
  const listeners = {}
  const vvListeners = {}
  return {
    scrollX: 0,
    scrollY,
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y },
    addEventListener: (t, f) => { listeners[t] = f },
    removeEventListener: (t) => { delete listeners[t] },
    visualViewport: {
      addEventListener: (t, f) => { vvListeners[t] = f },
      removeEventListener: (t) => { delete vvListeners[t] },
    },
    listeners,
    vvListeners,
  }
}
function fakeDoc(activeElement = null) {
  const listeners = {}
  return {
    activeElement,
    addEventListener: (t, f) => { listeners[t] = f },
    removeEventListener: (t) => { delete listeners[t] },
    listeners,
  }
}

test('fields that bring up the keyboard are recognised', () => {
  assert.ok(isEditableElement({ tagName: 'TEXTAREA' }))
  assert.ok(isEditableElement({ tagName: 'INPUT', type: 'text' }))
  assert.ok(isEditableElement({ tagName: 'INPUT' }), 'type defaults to text')
  assert.ok(isEditableElement({ tagName: 'SELECT' }))
  assert.ok(isEditableElement({ tagName: 'DIV', isContentEditable: true }))
  assert.ok(!isEditableElement({ tagName: 'INPUT', type: 'checkbox' }))
  assert.ok(!isEditableElement({ tagName: 'BUTTON' }))
  assert.ok(!isEditableElement(null))
})

test('a document left scrolled is put back once no field has focus', () => {
  const win = fakeWin(420)
  assert.strictEqual(restoreDocumentScroll(win, fakeDoc({ tagName: 'BODY' })), true)
  assert.strictEqual(win.scrollY, 0)
})

test('the document is left alone while a field is being edited', () => {
  const win = fakeWin(420)
  assert.strictEqual(restoreDocumentScroll(win, fakeDoc({ tagName: 'TEXTAREA' })), false)
  assert.strictEqual(win.scrollY, 420)
})

test('closing the keyboard (focus out / viewport resize) restores the document', async () => {
  const win = fakeWin(380)
  const doc = fakeDoc({ tagName: 'BODY' })
  const cleanup = installDocumentScrollRestore(win, doc, 5)
  doc.listeners.focusout()
  await new Promise(r => setTimeout(r, 20))
  assert.strictEqual(win.scrollY, 0)
  win.scrollY = 200
  win.vvListeners.resize()
  await new Promise(r => setTimeout(r, 20))
  assert.strictEqual(win.scrollY, 0)
  cleanup()
  assert.deepStrictEqual(Object.keys(doc.listeners), [])
  assert.deepStrictEqual(Object.keys(win.vvListeners), [])
})
