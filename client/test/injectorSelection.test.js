/**
 * Injector date ordering, independent filters, selection and report validation.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  sortByTestDate,
  filterInjectors,
  toggleSelected,
  addToSelection,
  removeFromSelection,
  areAllSelected,
  toggleAll,
  orderedSelection,
  moveSelected,
  hasTestResults,
  validateSelectionForReport,
  describeSelection,
  vendorPromptReport,
  suggestReportName,
} from '../src/lib/injectorSelection.js'

const inj = (id, extra = {}) => ({
  id,
  serial_number: `SN${id}`,
  part_number: '6513589PX',
  steps_total: 10,
  steps_passed: 10,
  overall_pass: 1,
  test_datetime: '2026-06-30T10:00:00Z',
  ...extra,
})

const list = [
  inj('1', { test_datetime: '2026-06-30T10:00:00Z' }),
  inj('2', { serial_number: 'ABC-222', part_number: '0445120231', overall_pass: 0, steps_passed: 8, test_datetime: '2026-07-02T10:00:00Z' }),
  inj('3', { serial_number: 'ABC-333', test_datetime: '2026-07-01T10:00:00Z' }),
  inj('4', { serial_number: 'ZX-400', overall_pass: null, steps_total: 0, steps_passed: 0, test_datetime: '2026-06-01T10:00:00Z' }),
]

// ── Ordering and filtering ──────────────────────────────────────────────────
test('injectors are one continuous list ordered by newest test date first', () => {
  assert.deepStrictEqual(sortByTestDate(list).map((i) => i.id), ['2', '3', '1', '4'])
  assert.deepStrictEqual(list.map((i) => i.id), ['1', '2', '3', '4'], 'source array is not mutated')
})

test('part, serial and pass/fail filters work independently and together', () => {
  assert.deepStrictEqual(filterInjectors(list, { partNumber: '0445' }).map((i) => i.id), ['2'])
  assert.deepStrictEqual(filterInjectors(list, { serialNumber: 'abc' }).map((i) => i.id), ['2', '3'])
  assert.deepStrictEqual(filterInjectors(list, { status: 'pass' }).map((i) => i.id), ['3', '1'])
  assert.deepStrictEqual(filterInjectors(list, { status: 'fail' }).map((i) => i.id), ['2'])
  assert.deepStrictEqual(filterInjectors(list, { status: 'unscored' }).map((i) => i.id), ['4'])
  assert.deepStrictEqual(filterInjectors(list, { serialNumber: 'abc', status: 'pass' }).map((i) => i.id), ['3'])
})

// ── Selection ───────────────────────────────────────────────────────────────
test('selection preserves pick order (which drives report column order)', () => {
  let selected = []
  selected = toggleSelected(selected, '3')
  selected = toggleSelected(selected, '1')
  selected = toggleSelected(selected, '2')
  assert.deepStrictEqual(selected, ['3', '1', '2'])

  selected = toggleSelected(selected, '1')
  assert.deepStrictEqual(selected, ['3', '2'])
  assert.deepStrictEqual(orderedSelection(selected, list).map((i) => i.id), ['3', '2'])
})

test('select-all-visible adds only missing rows and keeps hidden selections', () => {
  const visible = filterInjectors(list, { serialNumber: 'abc' })
  let selected = toggleAll(['1'], visible)
  assert.deepStrictEqual(selected, ['1', '2', '3'])
  assert.ok(areAllSelected(selected, visible))

  selected = toggleAll(selected, visible)
  assert.deepStrictEqual(selected, ['1'], 'hidden selections remain selected')
})

test('selection helper functions retain stable order', () => {
  const selected = addToSelection(['3'], list)
  assert.deepStrictEqual(selected, ['3', '1', '2', '4'])
  assert.deepStrictEqual(removeFromSelection(selected, [list[1], list[3]]), ['3', '1'])
})

test('column order can be rearranged', () => {
  const selected = ['1', '2', '3']
  assert.deepStrictEqual(moveSelected(selected, '3', -1), ['1', '3', '2'])
  assert.deepStrictEqual(moveSelected(selected, '1', -1), selected)
  assert.deepStrictEqual(moveSelected(selected, '3', 1), selected)
  assert.deepStrictEqual(moveSelected(selected, 'unknown', 1), selected)
})

// ── Validation ───────────────────────────────────────────────────────────────
test('report actions are blocked without a selection', () => {
  const result = validateSelectionForReport([])
  assert.strictEqual(result.ok, false)
  assert.match(result.message, /at least one injector/i)
})

test('injectors without test results are reported clearly', () => {
  assert.strictEqual(hasTestResults(list[3]), false)
  const result = validateSelectionForReport([list[0], list[3]])
  assert.strictEqual(result.ok, false)
  assert.match(result.message, /no test-bench results/i)
  assert.ok(result.message.includes('ZX-400'))
})

test('missing part and serial identifiers warn without a job-number warning', () => {
  const result = validateSelectionForReport([inj('9', { serial_number: '', part_number: '' })])
  assert.strictEqual(result.ok, true)
  assert.ok(result.warnings.some((warning) => /serial number/i.test(warning)))
  assert.ok(result.warnings.some((warning) => /part number/i.test(warning)))
  assert.ok(result.warnings.every((warning) => !/job/i.test(warning)))
})

// ── Labels and filenames ────────────────────────────────────────────────────
test('the selection is described without job-number grouping', () => {
  assert.strictEqual(describeSelection([list[0]]), '1 injector')
  assert.strictEqual(describeSelection([list[0], list[1]]), '2 injectors')
})

test('vendor information is requested for every report that uses the shared header', () => {
  assert.strictEqual(vendorPromptReport('customer'), 'Custom Report')
  assert.strictEqual(vendorPromptReport('both'), 'Custom Report')
  assert.strictEqual(vendorPromptReport('evaluation'), 'Shipment Evaluation Report')
  assert.strictEqual(vendorPromptReport('inspection'), '')
})

test('suggested filenames contain part, optional vendor and count but no job number', () => {
  assert.strictEqual(suggestReportName('CustomReport', [list[0], list[2]]), 'CustomReport_6513589PX_2')
  assert.strictEqual(
    suggestReportName('ShipmentEvaluation', [list[0], list[2]], { vendor: 'Acme Diesel Supply' }),
    'ShipmentEvaluation_6513589PX_Acme-Diesel-Supply_2'
  )
  assert.strictEqual(suggestReportName('ShipmentEvaluation', [list[0]], { vendor: '' }), 'ShipmentEvaluation_6513589PX_1')
  assert.strictEqual(suggestReportName('ShipmentEvaluation', []), 'ShipmentEvaluation_0')
})
