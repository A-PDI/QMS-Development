/**
 * Part Specifications editor state: reading stored specs (structured or legacy
 * text) into the editor, and saving without disturbing points the
 * administrator did not touch.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  toEditorEntry, fromEditorEntry, buildSpecPayload, countSpecified, entryErrors, emptyEntry, previewEntry,
} from '../src/lib/specEditor.js'
import { SPEC_ERROR_MESSAGES, listDimensionalPoints } from '../src/lib/dimensional.js'

const TOL = { type: 'tolerance', nominal: '25.000', lower_tol: '-0.050', upper_tol: '+0.050', unit: 'mm' }

test('a structured spec round-trips through the editor', () => {
  const entry = toEditorEntry(TOL)
  assert.strictEqual(entry.type, 'tolerance')
  assert.deepStrictEqual(fromEditorEntry(entry), TOL)
})

test('a legacy numeric text spec opens as a structured spec', () => {
  const entry = toEditorEntry('45.00 ± 0.05')
  assert.strictEqual(entry.type, 'tolerance')
  assert.strictEqual(entry.nominal, '45.00')
  assert.strictEqual(entry.lower_tol, '-0.05')
  assert.strictEqual(entry.upper_tol, '+0.05')
  assert.strictEqual(previewEntry(entry).rangeText, '44.95 to 45.05')
})

test('legacy non-numeric text opens as text, not as a guess', () => {
  const entry = toEditorEntry('Per drawing 1234 rev C')
  assert.strictEqual(entry.type, 'text')
  assert.strictEqual(entry.text, 'Per drawing 1234 rev C')
})

test('an unspecified point has no stored value', () => {
  assert.strictEqual(fromEditorEntry(emptyEntry()), null)
  assert.strictEqual(fromEditorEntry({ ...emptyEntry(), type: 'tolerance', unit: 'mm' }), null, 'a unit alone is not a spec')
})

test('saving keeps untouched points exactly as stored, including legacy strings and unknown keys', () => {
  const original = { 'dimensional.1': '45.00 ± 0.05', 'dimensional.2': TOL, 'old_section.9': 'kept' }
  const entries = {
    'dimensional.1': toEditorEntry(original['dimensional.1']),
    'dimensional.2': { ...toEditorEntry(TOL), nominal: '25.010' },
  }
  const payload = buildSpecPayload(original, entries, ['dimensional.2'])
  assert.strictEqual(payload['dimensional.1'], '45.00 ± 0.05', 'untouched legacy text is not rewritten')
  assert.strictEqual(payload['dimensional.2'].nominal, '25.010')
  assert.strictEqual(payload['old_section.9'], 'kept')
})

test('clearing a point removes its spec', () => {
  const payload = buildSpecPayload({ 'dimensional.1': TOL }, { 'dimensional.1': emptyEntry() }, ['dimensional.1'])
  assert.deepStrictEqual(payload, {})
})

test('invalid numeric entries are reported before saving; text entries are not', () => {
  const entries = {
    a: { ...emptyEntry(), type: 'limits', min: '5', max: '1' },
    b: { ...emptyEntry(), type: 'tolerance', nominal: '25', lower_tol: '', upper_tol: '0.1' },
    c: { ...emptyEntry(), type: 'text', text: 'anything' },
  }
  const errors = entryErrors(entries, ['a', 'b', 'c'], SPEC_ERROR_MESSAGES)
  assert.deepStrictEqual(errors.map(e => e.key), ['a', 'b'])
  assert.strictEqual(errors[0].message, SPEC_ERROR_MESSAGES.min_gt_max)
})

test('specs defined are counted against the form\'s points', () => {
  const { points } = listDimensionalPoints({
    dimensional: { section_type: 'dimensional', items: [{ id: 1, measurement: 'A' }, { id: 2, measurement: 'B' }] },
  })
  assert.strictEqual(countSpecified({ 'dimensional.1': TOL, 'gone.1': TOL }, points), 1)
})
