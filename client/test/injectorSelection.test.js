/**
 * Injector date ordering, independent filters, selection and report validation.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  sortByTestDate,
  sortBySerialNumber,
  filterInjectors,
  toggleSelected,
  addToSelection,
  removeFromSelection,
  areAllSelected,
  toggleAll,
  orderedSelection,
  hasTestResults,
  validateSelectionForReport,
  describeSelection,
  vendorPromptReport,
  suggestReportName,
  moveSelected,
  moveSelectedTo,
  sortSelectionBySerial,
  OUTPUTS,
  FORMATS,
  emptyOutputs,
  toggleOutput,
  toggleFormat,
  formatsApply,
  reportFormats,
  validateOutputs,
  producesFiles,
  describeOutputs,
  parseTokens,
  emptyFilters,
  buildInjectorQuery,
  describeActiveFilters,
  hasActiveFilters,
  toggleStepFilter,
} from '../src/lib/injectorSelection.js'

const inj = (id, extra = {}) => ({
  id,
  serial_number: `SN${id}`,
  part_number: '6513589PX',
  steps_total: 10,
  steps_passed: 10,
  overall_pass: 1,
  result_status: 'pass',
  test_datetime: '2026-06-30T10:00:00Z',
  ...extra,
})

const list = [
  inj('1', { test_datetime: '2026-06-30T10:00:00Z' }),
  inj('2', { serial_number: 'ABC-222', part_number: '0445120231', overall_pass: 0, result_status: 'fail', steps_passed: 8, test_datetime: '2026-07-02T10:00:00Z' }),
  inj('3', { serial_number: 'ABC-333', test_datetime: '2026-07-01T10:00:00Z' }),
  inj('4', { serial_number: 'ZX-400', overall_pass: null, result_status: 'unknown', steps_total: 0, steps_passed: 0, test_datetime: '2026-06-01T10:00:00Z' }),
  inj('5', { serial_number: 'DNF-500', overall_pass: null, result_status: 'dnf', steps_passed: 1, test_datetime: '2026-06-15T10:00:00Z' }),
]

// ── Ordering and filtering ──────────────────────────────────────────────────
test('injectors are one continuous list ordered by newest test date first', () => {
  assert.deepStrictEqual(sortByTestDate(list).map((i) => i.id), ['2', '3', '1', '5', '4'])
  assert.deepStrictEqual(list.map((i) => i.id), ['1', '2', '3', '4', '5'], 'source array is not mutated')
})

test('part, serial, date range, and four-state result filters work together', () => {
  assert.deepStrictEqual(filterInjectors(list, { partNumber: '0445' }).map((i) => i.id), ['2'])
  assert.deepStrictEqual(filterInjectors(list, { serialNumber: 'abc' }).map((i) => i.id), ['2', '3'])
  assert.deepStrictEqual(filterInjectors(list, { status: 'pass' }).map((i) => i.id), ['3', '1'])
  assert.deepStrictEqual(filterInjectors(list, { status: 'fail' }).map((i) => i.id), ['2'])
  assert.deepStrictEqual(filterInjectors(list, { status: 'dnf' }).map((i) => i.id), ['5'])
  assert.deepStrictEqual(filterInjectors(list, { status: 'unscored' }).map((i) => i.id), ['4'])
  assert.deepStrictEqual(filterInjectors(list, { serialNumber: 'abc', status: 'pass' }).map((i) => i.id), ['3'])
  assert.deepStrictEqual(filterInjectors(list, { dateFrom: '2026-06-30', dateTo: '2026-07-01' }).map((i) => i.id), ['3', '1'])
})

// ── Selection ───────────────────────────────────────────────────────────────
test('the selection keeps the order injectors were added in', () => {
  let selected = []
  selected = toggleSelected(selected, '3')
  selected = toggleSelected(selected, '1')
  selected = toggleSelected(selected, '2')
  assert.deepStrictEqual(selected, ['3', '1', '2'], 'a new injector goes to the end')

  selected = toggleSelected(selected, '1')
  assert.deepStrictEqual(selected, ['3', '2'])
  // The order is the report's column order and is never re-sorted behind the
  // user's back — only the helpers below change it.
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
  assert.deepStrictEqual(selected, ['3', '1', '2', '4', '5'])
  assert.deepStrictEqual(removeFromSelection(selected, [list[1], list[3]]), ['3', '1', '5'])
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

test('vendor information is requested for every output that uses the shared header', () => {
  assert.strictEqual(vendorPromptReport(['report']), 'Custom Report')
  assert.strictEqual(vendorPromptReport(['preview']), 'Custom Report')
  assert.strictEqual(vendorPromptReport(['evaluation']), 'Shipment Evaluation Report')
  assert.strictEqual(
    vendorPromptReport(['report', 'evaluation']), 'Custom Report and Shipment Evaluation',
    'one prompt covers both when both are selected'
  )
  assert.strictEqual(vendorPromptReport(['inspection']), '', 'the inspection record needs no vendor')
  assert.strictEqual(vendorPromptReport([]), '')
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

// ── Multi-value filters and the server query ────────────────────────────────
test('a filter box splits on commas, spaces, newlines and pipes', () => {
  assert.deepStrictEqual(parseTokens('6513589PX, 0445120067'), ['6513589PX', '0445120067'])
  assert.deepStrictEqual(parseTokens('SN1 SN2\nSN3|SN4;SN5'), ['SN1', 'SN2', 'SN3', 'SN4', 'SN5'])
  assert.deepStrictEqual(parseTokens('SN1, sn1'), ['SN1'], 'duplicates are dropped case-insensitively')
  assert.deepStrictEqual(parseTokens(''), [])
  assert.deepStrictEqual(parseTokens(null), [])
})

test('part and serial filters accept several values and match any of them', () => {
  assert.deepStrictEqual(
    filterInjectors(list, { partNumber: '0445120231, 6513589PX' }).map((i) => i.id),
    ['2', '3', '1', '5', '4']
  )
  assert.deepStrictEqual(filterInjectors(list, { serialNumber: 'ABC-222 ZX-400' }).map((i) => i.id), ['2', '4'])
  assert.deepStrictEqual(
    filterInjectors(list, { partNumber: '6513589PX', serialNumber: 'ABC-222, ABC-333' }).map((i) => i.id),
    ['3'],
    'part and serial filters intersect'
  )
})

test('a single value still filters exactly as it always did', () => {
  assert.deepStrictEqual(filterInjectors(list, { partNumber: '0445' }).map((i) => i.id), ['2'])
  assert.deepStrictEqual(filterInjectors(list, { serialNumber: 'abc' }).map((i) => i.id), ['2', '3'])
})

test('the server query carries only the filters that are actually set', () => {
  assert.deepStrictEqual(buildInjectorQuery(emptyFilters()), {})
  assert.deepStrictEqual(
    buildInjectorQuery({
      ...emptyFilters(),
      partNumber: '6513589PX 0445120067',
      serialNumber: 'SN1',
      status: 'fail',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    }),
    {
      part_number: '6513589PX,0445120067',
      serial_number: 'SN1',
      status: 'fail',
      date_from: '2026-06-01',
      date_to: '2026-06-30',
    }
  )
})

test('a step filter sends its outcome and match mode alongside the codes', () => {
  assert.deepStrictEqual(
    buildInjectorQuery({ ...emptyFilters(), steps: ['IVM06-R'] }),
    { steps: 'IVM06-R', step_status: 'fail', step_match: 'any' },
    'the step filter defaults to failures on any of the chosen steps'
  )
  assert.deepStrictEqual(
    buildInjectorQuery({ ...emptyFilters(), steps: ['IVM01', 'IVM06-R'], stepStatus: 'pass', stepMatch: 'all' }),
    { steps: 'IVM01,IVM06-R', step_status: 'pass', step_match: 'all' }
  )
})

test('step codes toggle in and out of the filter', () => {
  assert.deepStrictEqual(toggleStepFilter([], 'IVM01'), ['IVM01'])
  assert.deepStrictEqual(toggleStepFilter(['IVM01'], 'IVM06-R'), ['IVM01', 'IVM06-R'])
  assert.deepStrictEqual(toggleStepFilter(['IVM01', 'IVM06-R'], 'IVM01'), ['IVM06-R'])
})

test('an active filter is detectable so the page can offer to clear it', () => {
  assert.strictEqual(hasActiveFilters(emptyFilters()), false)
  assert.strictEqual(hasActiveFilters({ ...emptyFilters(), partNumber: '  ' }), false, 'whitespace is not a filter')
  assert.strictEqual(hasActiveFilters({ ...emptyFilters(), partNumber: '6513589PX' }), true)
  assert.strictEqual(hasActiveFilters({ ...emptyFilters(), steps: ['IVM01'] }), true)
  assert.strictEqual(hasActiveFilters({ ...emptyFilters(), status: 'fail' }), true)
})

test('active filters are described in the words shown above the list', () => {
  const labels = { 'IVM06-R': 'Peak Torque - Return', IVM01: 'Peak HP' }
  assert.deepStrictEqual(
    describeActiveFilters({
      ...emptyFilters(),
      partNumber: '6513589PX,0445120067',
      serialNumber: 'SN1',
      status: 'fail',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      steps: ['IVM06-R'],
    }, labels),
    [
      'Part 6513589PX, 0445120067',
      'Serial SN1',
      'Result Failed',
      'Tested 2026-06-01 – 2026-06-30',
      'Failed Peak Torque - Return',
    ]
  )

  assert.deepStrictEqual(
    describeActiveFilters({ ...emptyFilters(), steps: ['IVM01', 'IVM06-R'], stepStatus: 'pass', stepMatch: 'all' }, labels),
    ['Passed all of Peak HP, Peak Torque - Return']
  )
  assert.deepStrictEqual(describeActiveFilters(emptyFilters()), [], 'nothing filtered, nothing described')
  assert.deepStrictEqual(
    describeActiveFilters({ ...emptyFilters(), steps: ['NEW-CODE'] }),
    ['Failed NEW-CODE'],
    'an unmapped step code falls back to the code itself'
  )
})


// ── Report order ────────────────────────────────────────────────────────────
test('an injector moves one place at a time and stops at the ends', () => {
  const order = ['a', 'b', 'c', 'd']
  assert.deepStrictEqual(moveSelected(order, 'c', -1), ['a', 'c', 'b', 'd'])
  assert.deepStrictEqual(moveSelected(order, 'b', 1), ['a', 'c', 'b', 'd'])

  assert.deepStrictEqual(moveSelected(order, 'a', -1), order, 'the first cannot move earlier')
  assert.deepStrictEqual(moveSelected(order, 'd', 1), order, 'the last cannot move later')
  assert.deepStrictEqual(moveSelected(order, 'nope', -1), order, 'an unknown id changes nothing')
  assert.deepStrictEqual(order, ['a', 'b', 'c', 'd'], 'the source array is not mutated')
})

test('dragging moves an injector to an arbitrary position', () => {
  const order = ['a', 'b', 'c', 'd']
  assert.deepStrictEqual(moveSelectedTo(order, 3, 0), ['d', 'a', 'b', 'c'], 'last to first')
  assert.deepStrictEqual(moveSelectedTo(order, 0, 3), ['b', 'c', 'd', 'a'], 'first to last')
  assert.deepStrictEqual(moveSelectedTo(order, 1, 1), order, 'a no-op drop changes nothing')
  assert.deepStrictEqual(moveSelectedTo(order, 0, 99), ['b', 'c', 'd', 'a'], 'past the end clamps')
  assert.deepStrictEqual(moveSelectedTo(order, 9, 0), order, 'an out-of-range source is ignored')
})

test('sort by serial resets the order naturally, with blanks last', () => {
  const available = [
    inj('x', { serial_number: 'SN-10' }),
    inj('y', { serial_number: 'SN-2' }),
    inj('z', { serial_number: '' }),
  ]
  assert.deepStrictEqual(sortSelectionBySerial(['x', 'z', 'y'], available), ['y', 'x', 'z'])
  assert.deepStrictEqual(sortBySerialNumber(available).map((i) => i.serial_number), ['SN-2', 'SN-10', ''])
})

// ── Outputs ─────────────────────────────────────────────────────────────────
test('the four outputs toggle independently and keep a stable order', () => {
  assert.deepStrictEqual(OUTPUTS.map((o) => o.value), ['preview', 'report', 'inspection', 'evaluation'])
  assert.deepStrictEqual(FORMATS.map((f) => f.value), ['xlsx', 'pdf'])
  assert.deepStrictEqual(emptyOutputs(), { outputs: [], formats: [] })

  let outputs = toggleOutput([], 'evaluation')
  outputs = toggleOutput(outputs, 'preview')
  assert.deepStrictEqual(outputs, ['preview', 'evaluation'], 'listed in OUTPUTS order, not click order')

  outputs = toggleOutput(outputs, 'evaluation')
  assert.deepStrictEqual(outputs, ['preview'], 'clicking again removes it')

  assert.deepStrictEqual(toggleFormat(toggleFormat([], 'pdf'), 'xlsx'), ['xlsx', 'pdf'])
})

test('the Excel/PDF choice applies to Preview and Report only', () => {
  assert.strictEqual(formatsApply(['preview']), true)
  assert.strictEqual(formatsApply(['report']), true)
  assert.strictEqual(formatsApply(['inspection', 'evaluation']), false, 'those two are always PDF')
  assert.strictEqual(formatsApply([]), false)

  // A format ticked against Inspection or Evaluation produces no extra file.
  assert.deepStrictEqual(reportFormats({ outputs: ['evaluation'], formats: ['xlsx'] }), [])
  assert.deepStrictEqual(reportFormats({ outputs: ['report'], formats: ['xlsx', 'pdf'] }), ['xlsx', 'pdf'])
})

test('Preview and Report are one document, so together they make one file each', () => {
  const both = { outputs: ['preview', 'report'], formats: ['pdf'] }
  assert.deepStrictEqual(reportFormats(both), ['pdf'], 'not two copies of the same PDF')
  assert.deepStrictEqual(
    reportFormats({ outputs: ['preview'], formats: ['pdf'] }),
    reportFormats({ outputs: ['report'], formats: ['pdf'] })
  )
})

test('Report needs a format; Preview on its own does not', () => {
  assert.strictEqual(validateOutputs(emptyOutputs()).ok, false)
  assert.match(validateOutputs(emptyOutputs()).message, /at least one of Preview/)

  assert.strictEqual(validateOutputs({ outputs: ['report'], formats: [] }).ok, false)
  assert.match(validateOutputs({ outputs: ['report'], formats: [] }).message, /Excel or PDF/)

  assert.strictEqual(validateOutputs({ outputs: ['report'], formats: ['xlsx'] }).ok, true)
  assert.strictEqual(validateOutputs({ outputs: ['preview'], formats: [] }).ok, true)
  assert.strictEqual(validateOutputs({ outputs: ['inspection'] }).ok, true)
  assert.strictEqual(validateOutputs({ outputs: ['evaluation'] }).ok, true)
})

test('a run only asks where to save when it will actually write a file', () => {
  assert.strictEqual(producesFiles({ outputs: ['preview'], formats: [] }), false, 'preview alone writes nothing')
  assert.strictEqual(producesFiles({ outputs: ['preview'], formats: ['pdf'] }), true)
  assert.strictEqual(producesFiles({ outputs: ['inspection'] }), true)
  assert.strictEqual(producesFiles({ outputs: ['evaluation'] }), true)
  assert.strictEqual(producesFiles(emptyOutputs()), false)
})

test('the chosen outputs are described the way the page announces them', () => {
  assert.strictEqual(
    describeOutputs({ outputs: ['preview', 'report', 'evaluation'], formats: ['xlsx', 'pdf'] }),
    'Preview, Report (Excel + PDF), Evaluation'
  )
  assert.strictEqual(describeOutputs({ outputs: ['inspection'], formats: ['xlsx'] }), 'Inspection')
  assert.strictEqual(describeOutputs(emptyOutputs()), '')
})
