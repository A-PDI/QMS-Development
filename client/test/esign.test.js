/**
 * E-sign client helpers: geometry against real pdf.js viewports, field
 * assignment, pre-send checks and signing-page completeness.
 */

import test from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import {
  FIELD_META,
  recipientColor,
  UNASSIGNED_COLOR,
  RECIPIENT_COLORS,
  isEmail,
  fieldToScreen,
  screenToField,
  clampToPage,
  newFieldBox,
  guessRecipient,
  autoAssignFields,
  sendProblems,
  fieldComplete,
  remainingFields,
  initialsOf,
  safeFilename,
} from '../src/lib/esign.js'

const FIXTURE = fileURLToPath(new URL('../../esign-detector/tests/fixtures/lines.pdf', import.meta.url))

async function loadPage() {
  const data = new Uint8Array(readFileSync(FIXTURE))
  const doc = await getDocument({ data, isEvalSupported: false }).promise
  return doc.getPage(1)
}

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`)

test('field boxes survive a screen round trip at every rotation', async () => {
  const page = await loadPage()
  const field = { x: 72, y: 100, width: 180, height: 36 }
  for (const rotation of [0, 90, 180, 270]) {
    const viewport = page.getViewport({ scale: 1.37, rotation })
    const rect = fieldToScreen(field, viewport)
    assert.ok(rect.width > 0 && rect.height > 0, `rotation ${rotation} gives a positive rectangle`)
    assert.ok(rect.left >= 0 && rect.top >= 0, `rotation ${rotation} stays on the page`)
    const back = screenToField(rect, viewport)
    for (const k of ['x', 'y', 'width', 'height']) close(back[k], field[k], `rotation ${rotation} ${k}`)
  }
})

test('an unrotated field is drawn from the top-left of the page', async () => {
  const page = await loadPage()
  const viewport = page.getViewport({ scale: 1, rotation: 0 })
  const [, , , top] = page.view
  const rect = fieldToScreen({ x: 50, y: 700, width: 100, height: 20 }, viewport)
  close(rect.left, 50, 'left')
  close(rect.top, top - 720, 'top')
  close(rect.width, 100, 'width')
  close(rect.height, 20, 'height')
})

test('clampToPage keeps boxes inside the crop box and enforces a minimum size', () => {
  const page = { width: 612, height: 792, crop: [0, 0, 612, 792] }
  assert.deepStrictEqual(clampToPage({ x: -20, y: 780, width: 100, height: 30 }, page), { x: 0, y: 762, width: 100, height: 30 })
  assert.deepStrictEqual(clampToPage({ x: 10, y: 10, width: 1, height: 2 }, page), { x: 10, y: 10, width: 6, height: 6 })
  const offset = { width: 400, height: 400, crop: [100, 100, 500, 500] }
  assert.deepStrictEqual(clampToPage({ x: 0, y: 0, width: 50, height: 50 }, offset), { x: 100, y: 100, width: 50, height: 50 })
})

test('newFieldBox centers the default size and swaps it on sideways pages', () => {
  const page = { width: 612, height: 792, crop: [0, 0, 612, 792], rotation: 0 }
  const sig = FIELD_META.signature
  const box = newFieldBox('signature', { x: 300, y: 400 }, page)
  assert.deepStrictEqual(box, { x: 300 - sig.w / 2, y: 400 - sig.h / 2, width: sig.w, height: sig.h })
  const sideways = newFieldBox('signature', { x: 300, y: 400 }, { ...page, rotation: 90 })
  assert.strictEqual(sideways.width, sig.h)
  assert.strictEqual(sideways.height, sig.w)
  const unknown = newFieldBox('nope', { x: 300, y: 400 }, page)
  assert.strictEqual(unknown.width, FIELD_META.text.w)
})

test('recipient colors cycle and unassigned fields are grey', () => {
  assert.strictEqual(recipientColor(null), UNASSIGNED_COLOR)
  assert.strictEqual(recipientColor(-1), UNASSIGNED_COLOR)
  assert.strictEqual(recipientColor(0), RECIPIENT_COLORS[0])
  assert.strictEqual(recipientColor(RECIPIENT_COLORS.length), RECIPIENT_COLORS[0])
})

test('isEmail accepts ordinary addresses and rejects junk', () => {
  assert.ok(isEmail('jane.doe@supplier.com'))
  assert.ok(isEmail('  qc@pdi.example.org '))
  for (const bad of ['', 'jane', 'jane@', '@x.com', 'a b@x.com', 'Jane <jane@x.com>', 'jane@x']) {
    assert.ok(!isEmail(bad), bad)
  }
})

const supplier = { id: 's', name: 'Jane Doe', email: 'jane@supplier.com', role_label: 'Supplier', routing_order: 1 }
const pdi = { id: 'p', name: 'Andy Smith', email: 'andy@pdi.com', role_label: 'PDI', routing_order: 2 }

test('guessRecipient uses tag numbers, then role hints, then a lone recipient', () => {
  // Tag numbers follow signing order, not list order.
  assert.strictEqual(guessRecipient({ recipient_index: 2 }, [pdi, supplier]), 'p')
  assert.strictEqual(guessRecipient({ recipient_index: 1 }, [pdi, supplier]), 's')
  assert.strictEqual(guessRecipient({ recipient_index: 3, role_hint: 'supplier' }, [pdi, supplier]), 's')
  assert.strictEqual(guessRecipient({ role_hint: 'PDI' }, [supplier, pdi]), 'p')
  assert.strictEqual(guessRecipient({ role_hint: 'jane' }, [supplier, pdi]), 's')
  assert.strictEqual(guessRecipient({ role_hint: 'buyer' }, [supplier, pdi]), null)
  assert.strictEqual(guessRecipient({}, [supplier]), 's')
  assert.strictEqual(guessRecipient({}, []), null)
})

test('autoAssignFields leaves existing assignments alone', () => {
  const fields = [
    { id: 1, recipient_id: 'p', role_hint: 'supplier' },
    { id: 2, recipient_id: null, role_hint: 'supplier' },
    { id: 3, recipient_id: null },
  ]
  const out = autoAssignFields(fields, [supplier, pdi])
  assert.deepStrictEqual(out.map((f) => f.recipient_id), ['p', 's', null])
  assert.strictEqual(fields[1].recipient_id, null, 'input is not mutated')
})

test('sendProblems lists everything that blocks sending', () => {
  assert.deepStrictEqual(sendProblems([], []), ['Add at least one recipient.'])

  const ok = sendProblems([supplier, pdi], [
    { recipient_id: 's', type: 'signature' },
    { recipient_id: 'p', type: 'signature' },
  ])
  assert.deepStrictEqual(ok, [])

  const bad = sendProblems(
    [{ id: 'a', name: '', email: 'x@y.com' }, { id: 'b', name: 'B', email: 'X@Y.com' }, { id: 'c', name: 'C', email: 'bad' }],
    [{ recipient_id: null, type: 'text' }, { recipient_id: null, type: 'date' }, { recipient_id: 'a', type: 'signature' }],
  )
  assert.ok(bad.includes('Recipient 1 needs a name.'))
  assert.ok(bad.includes('Recipient 3 needs a valid e-mail address.'))
  assert.ok(bad.includes('Each recipient needs a different e-mail address.'))
  assert.ok(bad.includes('2 fields are not assigned to anyone.'))
  assert.ok(bad.includes('B has no signature field.'))
  assert.ok(bad.includes('C has no signature field.'))
  assert.ok(!bad.some((p) => p.startsWith('x@y.com')), 'recipient a has a signature field')
})

test('fieldComplete and remainingFields follow the signing rules', () => {
  const fields = [
    { id: 1, type: 'signature', required: true },
    { id: 2, type: 'initials', required: true },
    { id: 3, type: 'date', required: true },
    { id: 4, type: 'text', required: true },
    { id: 5, type: 'text', required: false },
    { id: 6, type: 'checkbox', required: true },
  ]
  const empty = remainingFields(fields, {}, {})
  assert.deepStrictEqual(empty.map((f) => f.id), [1, 2, 4, 6])

  const values = { 4: '  ', 6: false }
  assert.ok(!fieldComplete(fields[3], values, {}), 'blank text is not complete')
  assert.ok(!fieldComplete(fields[5], values, {}), 'unchecked required box is not complete')

  const done = remainingFields(fields, { 4: 'Acme', 6: true }, { signature: 'data:x', initials: 'data:y' })
  assert.deepStrictEqual(done, [])
})

test('initialsOf builds up to four capital letters', () => {
  assert.strictEqual(initialsOf('Mary Ann Smith'), 'MAS')
  assert.strictEqual(initialsOf('  jane   doe '), 'JD')
  assert.strictEqual(initialsOf('a b c d e'), 'ABCD')
  assert.strictEqual(initialsOf(''), '')
  assert.strictEqual(initialsOf(null), '')
})

test('safeFilename produces plain names browsers will honour', () => {
  assert.strictEqual(safeFilename('Supplier NDA — Acme Machining - signed.pdf'), 'Supplier NDA - Acme Machining - signed.pdf')
  assert.strictEqual(safeFilename('Café “Spec” PO 12/34: rev?.pdf'), 'Cafe Spec PO 12_34_ rev_.pdf')
  assert.strictEqual(safeFilename('日本語.pdf'), 'document.pdf')
  assert.strictEqual(safeFilename('', 'x.pdf'), 'x.pdf')
  assert.strictEqual(safeFilename(' .. report .pdf. '), 'report.pdf')
})
