/**
 * Section A / Section B helpers: identifying the standard sections, the
 * "Pass All" bulk action, and the N/A result code.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  NA_STATUS,
  PFN_OPTIONS_WITH_NA,
  SHARED_SECTION_DATA_KEY,
  isReceivingSection,
  isVisualSection,
  isInspectionLevelSection,
  splitSectionsByScope,
  inspectionLevelKeys,
  extractSharedSectionData,
  stripSectionKeys,
  sharedSectionAttachments,
  supportsPassAll,
  hasNonPassRows,
  passAllRows,
} from '../src/lib/sections.js'

const receiving = {
  title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
  section_type: 'pfn_checklist',
  items: [{ id: 1, name: 'Outer Carton Condition' }, { id: 2, name: 'Box / Package Label' }],
}
const visual = {
  title: 'B. VISUAL INSPECTION',
  section_type: 'pass_fail_checklist',
  items: [{ id: 1, name: 'Crown' }, { id: 2, name: 'Ring Grooves' }, { id: 3, name: 'Pin Bore' }],
}
const dimensional = {
  title: 'C. DIMENSIONAL INSPECTION',
  section_type: 'dimensional',
  items: [{ id: 1, measurement: 'Skirt OD' }],
}

// ── Section identification ──────────────────────────────────────────────────
test('Section A and Section B are recognised by key, with the title as a fallback', () => {
  assert.ok(isReceivingSection('receiving', receiving))
  assert.ok(isReceivingSection('intake', receiving), 'the title alone identifies a renamed key')
  assert.ok(!isReceivingSection('visual', visual))

  assert.ok(isVisualSection('visual', visual))
  assert.ok(isVisualSection('sectionB', visual), 'the title alone identifies a renamed key')
  assert.ok(!isVisualSection('receiving', receiving))
  assert.ok(!isVisualSection('dimensional', dimensional))
})

// ── N/A ─────────────────────────────────────────────────────────────────────
test('N/A is offered alongside Pass / Fail / Accepted', () => {
  assert.strictEqual(NA_STATUS, 'N')
  assert.deepStrictEqual(PFN_OPTIONS_WITH_NA, ['P', 'F', 'A', 'N'])
})

// ── Pass All ────────────────────────────────────────────────────────────────
test('Pass All applies to checklist sections only', () => {
  assert.ok(supportsPassAll(visual))
  assert.ok(supportsPassAll(receiving))
  assert.ok(!supportsPassAll(dimensional), 'measurements are not pass/fail rows')
  assert.ok(!supportsPassAll({ ...visual, items: [] }), 'nothing to pass in an empty section')
})

test('Pass All marks every listed item Pass, keeping the rest of each row', () => {
  const data = [
    { id: 1, result: 'F', notes: 'chipped' },
    { id: 2, result: '', notes: '' },
  ]
  const next = passAllRows(visual, data)
  assert.deepStrictEqual(next.map((r) => r.id), [1, 2, 3], 'items with no row yet get one')
  assert.deepStrictEqual(next.map((r) => r.result), ['P', 'P', 'P'])
  assert.strictEqual(next[0].notes, 'chipped', 'findings already written are kept')
})

test('Pass All writes the field the section type actually reads', () => {
  const next = passAllRows(receiving, [{ id: 1, finding: '', status: '' }])
  assert.deepStrictEqual(next.map((r) => r.status), ['P', 'P'])
  assert.strictEqual(next[0].result, undefined, 'a pfn_checklist row is keyed on status')
})

test('Pass All clears the legacy pass/fail booleans it finds', () => {
  const [row] = passAllRows(visual, [{ id: 1, pass: false, fail: true, notes: '' }])
  assert.strictEqual(row.result, 'P')
  assert.strictEqual(row.pass, true)
  assert.strictEqual(row.fail, false)
})

test('Pass All only warns when it would overwrite a result', () => {
  assert.ok(!hasNonPassRows(visual, []))
  assert.ok(!hasNonPassRows(visual, [{ id: 1, result: 'P' }, { id: 2, result: '' }]))
  assert.ok(hasNonPassRows(visual, [{ id: 1, result: 'F' }]))
  assert.ok(hasNonPassRows(visual, [{ id: 1, result: 'A' }]))
  assert.ok(hasNonPassRows(visual, [{ id: 1, pass: false, fail: true }]), 'legacy rows count too')
  assert.ok(hasNonPassRows(receiving, [{ id: 1, status: 'N' }]), 'N/A is a result to protect')
})

// ── Section scope ───────────────────────────────────────────────────────────
const SECTIONS = { receiving, visual, dimensional }

test('Section A is answered once per inspection, the rest once per item', () => {
  assert.ok(isInspectionLevelSection('receiving', receiving))
  assert.ok(!isInspectionLevelSection('visual', visual))
  assert.ok(!isInspectionLevelSection('dimensional', dimensional))

  const { inspectionLevel, perItem } = splitSectionsByScope(SECTIONS)
  assert.deepStrictEqual(inspectionLevel.map(([key]) => key), ['receiving'])
  assert.deepStrictEqual(perItem.map(([key]) => key), ['visual', 'dimensional'])
  assert.deepStrictEqual(inspectionLevelKeys(SECTIONS), ['receiving'])
})

test('control keys are not sections', () => {
  const { inspectionLevel, perItem } = splitSectionsByScope({
    ...SECTIONS, __admin_sections: {}, __dimensional_added: true,
  })
  assert.deepStrictEqual(inspectionLevel.map(([key]) => key), ['receiving'])
  assert.deepStrictEqual(perItem.map(([key]) => key), ['visual', 'dimensional'])
})

test('the inspection-level answers are read from __shared', () => {
  const saved = {
    [SHARED_SECTION_DATA_KEY]: { receiving: [{ id: 1, status: 'P' }] },
    __items: [{ receiving: [{ id: 1, status: 'F' }], visual: [] }],
  }
  const shared = extractSharedSectionData(saved, SECTIONS)
  assert.deepStrictEqual(shared, { receiving: [{ id: 1, status: 'P' }] })
})

test('an inspection saved before Section A moved up keeps its answers', () => {
  const saved = {
    __items: [
      { receiving: [{ id: 1, status: '', finding: '' }] },
      { receiving: [{ id: 1, status: 'F', finding: 'carton crushed' }] },
    ],
  }
  const shared = extractSharedSectionData(saved, SECTIONS)
  assert.deepStrictEqual(
    shared.receiving,
    [{ id: 1, status: 'F', finding: 'carton crushed' }],
    'the item that was actually filled in is the one hoisted'
  )
})

test('a legacy single-item inspection keeps its Section A answers', () => {
  const saved = { receiving: [{ id: 1, status: 'P', finding: '' }], visual: [] }
  assert.deepStrictEqual(extractSharedSectionData(saved, SECTIONS).receiving, [{ id: 1, status: 'P', finding: '' }])
})

test('an unanswered Section A still resolves to its empty rows', () => {
  const saved = { __items: [{ receiving: [] }] }
  assert.deepStrictEqual(extractSharedSectionData(saved, SECTIONS), { receiving: [] })
  assert.deepStrictEqual(extractSharedSectionData({}, SECTIONS), {}, 'nothing saved yet, nothing to hoist')
})

test('the inspection-level keys come off the per-item answers', () => {
  const item = { receiving: [{ id: 1 }], visual: [{ id: 1 }], __disposition: 'PASS' }
  const stripped = stripSectionKeys(item, ['receiving'])
  assert.deepStrictEqual(stripped, { visual: [{ id: 1 }], __disposition: 'PASS' })
  assert.ok(item.receiving, 'the original item is not mutated')
})

test('an inspection-level section still sees images filed per item', () => {
  const attachments = [
    { id: 'a', section_key: 'receiving', item_id: 1 },
    { id: 'b', section_key: 'item2__receiving', item_id: 3 },
    { id: 'c', section_key: 'item2__visual', item_id: 1 },
    { id: 'd' },
  ]
  assert.deepStrictEqual(
    sharedSectionAttachments(attachments, 'receiving').map((a) => [a.id, a.section_key]),
    [['a', 'receiving'], ['b', 'receiving'], ['c', 'item2__visual'], ['d', undefined]]
  )
  assert.strictEqual(attachments[1].section_key, 'item2__receiving', 'the originals are not mutated')
})
