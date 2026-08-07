/**
 * Injector selection, job-number grouping and pre-flight validation.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  NO_JOB_KEY,
  jobKeyOf,
  groupByJobNumber,
  jobNumberOptions,
  filterInjectors,
  toggleSelected,
  addToSelection,
  removeFromSelection,
  areAllSelected,
  toggleAll,
  toggleJobSelection,
  orderedSelection,
  moveSelected,
  hasTestResults,
  validateSelectionForReport,
  describeSelection,
  vendorPromptReport,
  suggestReportName,
} from '../src/lib/injectorSelection.js'

const inj = (id, job, extra = {}) => ({
  id,
  job_number: job,
  serial_number: `SN${id}`,
  part_number: '6513589PX',
  steps_total: 10,
  steps_passed: 10,
  overall_pass: 1,
  test_datetime: extra.test_datetime || '2026-06-30T10:00:00Z',
  ...extra,
})

const list = [
  inj('1', 'QMS-100', { test_datetime: '2026-06-30T10:00:00Z' }),
  inj('2', 'QMS-100'),
  inj('3', 'QMS-200', { test_datetime: '2026-07-01T10:00:00Z' }),
  inj('4', '', { test_datetime: '2026-06-01T10:00:00Z' }),
]

// ── Grouping and filtering ───────────────────────────────────────────────────
test('injectors group by job number, newest job first', () => {
  const groups = groupByJobNumber(list)
  assert.deepStrictEqual(groups.map((g) => g.label), ['QMS-200', 'QMS-100', 'No job number'])
  assert.deepStrictEqual(groups[1].injectors.map((i) => i.id), ['1', '2'])
  assert.strictEqual(jobKeyOf(list[3]), NO_JOB_KEY)
})

test('the job filter lists every job with its count', () => {
  assert.deepStrictEqual(
    jobNumberOptions(list).map((o) => [o.label, o.count]),
    [['QMS-200', 1], ['QMS-100', 2], ['No job number', 1]]
  )
})

test('search and job filter narrow the list', () => {
  assert.deepStrictEqual(filterInjectors(list, { jobNumber: 'QMS-100' }).map((i) => i.id), ['1', '2'])
  assert.deepStrictEqual(filterInjectors(list, { search: 'sn3' }).map((i) => i.id), ['3'])
  assert.deepStrictEqual(filterInjectors(list, { search: 'QMS-2' }).map((i) => i.id), ['3'])
  assert.deepStrictEqual(filterInjectors(list, {}).length, 4)
})

// ── Selection ────────────────────────────────────────────────────────────────
test('selection preserves pick order (which drives report column order)', () => {
  let selected = []
  selected = toggleSelected(selected, '3')
  selected = toggleSelected(selected, '1')
  selected = toggleSelected(selected, '2')
  assert.deepStrictEqual(selected, ['3', '1', '2'])

  selected = toggleSelected(selected, '1') // deselect
  assert.deepStrictEqual(selected, ['3', '2'])

  assert.deepStrictEqual(orderedSelection(selected, list).map((i) => i.id), ['3', '2'])
})

test('select-all-visible adds only what is missing and keeps order', () => {
  const selected = addToSelection(['3'], list)
  assert.deepStrictEqual(selected, ['3', '1', '2', '4'])
  assert.ok(areAllSelected(selected, list))

  const cleared = removeFromSelection(selected, list)
  assert.deepStrictEqual(cleared, [])
})

test('toggling all deselects when everything visible is already selected', () => {
  const visible = filterInjectors(list, { jobNumber: 'QMS-100' })
  let selected = toggleAll(['3'], visible)
  assert.deepStrictEqual(selected, ['3', '1', '2'])
  selected = toggleAll(selected, visible)
  assert.deepStrictEqual(selected, ['3'], 'other selections are left alone')
})

test('a whole job number can be selected and cleared in one click', () => {
  let selected = toggleJobSelection([], list, 'QMS-100')
  assert.deepStrictEqual(selected, ['1', '2'])
  selected = toggleJobSelection(selected, list, 'QMS-200')
  assert.deepStrictEqual(selected, ['1', '2', '3'])
  selected = toggleJobSelection(selected, list, 'QMS-100')
  assert.deepStrictEqual(selected, ['3'])
})

test('column order can be rearranged', () => {
  const selected = ['1', '2', '3']
  assert.deepStrictEqual(moveSelected(selected, '3', -1), ['1', '3', '2'])
  assert.deepStrictEqual(moveSelected(selected, '1', -1), ['1', '2', '3'], 'first item cannot move up')
  assert.deepStrictEqual(moveSelected(selected, '3', 1), ['1', '2', '3'], 'last item cannot move down')
  assert.deepStrictEqual(moveSelected(selected, 'unknown', 1), ['1', '2', '3'])
})

test('selections only include injectors still visible in the list', () => {
  const visible = filterInjectors(list, { jobNumber: 'QMS-100' })
  assert.deepStrictEqual(orderedSelection(['3', '1'], visible).map((i) => i.id), ['1'])
})

// ── Validation ───────────────────────────────────────────────────────────────
test('report actions are blocked without a selection', () => {
  const result = validateSelectionForReport([])
  assert.strictEqual(result.ok, false)
  assert.match(result.message, /at least one injector/i)
})

test('injectors without test results are reported clearly', () => {
  const noResults = inj('9', 'QMS-100', { steps_total: 0, overall_pass: null })
  assert.strictEqual(hasTestResults(noResults), false)

  const result = validateSelectionForReport([list[0], noResults])
  assert.strictEqual(result.ok, false)
  assert.match(result.message, /no test-bench results/i)
  assert.ok(result.message.includes('SN9'), 'names the offending injector')
})

test('missing identifiers warn without blocking', () => {
  const result = validateSelectionForReport([list[0], list[3]])
  assert.strictEqual(result.ok, true)
  assert.ok(result.warnings.some((w) => /job number/i.test(w)))
})

// ── Labels ───────────────────────────────────────────────────────────────────
test('the selection is described for the user', () => {
  assert.strictEqual(describeSelection([list[0]]), '1 injector · job QMS-100')
  assert.strictEqual(describeSelection([list[0], list[1]]), '2 injectors · job QMS-100')
  assert.strictEqual(describeSelection([list[0], list[2]]), '2 injectors · 2 job numbers')
})

test('vendor information is requested for every report that uses the shared header', () => {
  assert.strictEqual(vendorPromptReport('customer'), 'Customer Report')
  assert.strictEqual(vendorPromptReport('both'), 'Customer Report')
  assert.strictEqual(vendorPromptReport('evaluation'), 'Shipment Evaluation Report')
  assert.strictEqual(vendorPromptReport('inspection'), '')
})

test('a suggested filename includes the part and job number', () => {
  assert.strictEqual(
    suggestReportName('InjectorReport', [list[0], list[1]]),
    'InjectorReport_6513589PX_QMS-100_2'
  )
  assert.strictEqual(suggestReportName('ShipmentEvaluation', []), 'ShipmentEvaluation_0')
})

test('the shipment evaluation filename is scoped by vendor, not job number', () => {
  assert.strictEqual(
    suggestReportName('ShipmentEvaluation', [list[0], list[1]], { vendor: 'Acme Diesel Supply' }),
    'ShipmentEvaluation_6513589PX_Acme-Diesel-Supply_2'
  )
  // No vendor given → falls back to the job number.
  assert.strictEqual(
    suggestReportName('ShipmentEvaluation', [list[0]], { vendor: '' }),
    'ShipmentEvaluation_6513589PX_QMS-100_1'
  )
})
