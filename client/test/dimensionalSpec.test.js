/**
 * Dimensional specifications and automatic Pass/Fail evaluation — the shared
 * rules in /shared/dimensionalSpec.mjs that both the inspection form and the
 * server apply.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  parseDecimal, compareDecimal, formatDecimal,
  resolveSpec, parseSpecText, specsEqual, isSpecEmpty, normalizeSpecValue, sanitizeSpecData,
  parseMeasurement, evaluateMeasurements, classifyMeasurement, resolveStatus, allowedStatusOptions,
  listDimensionalPoints, buildSpecIndex, evaluateSection, evaluateSectionData, evaluateValveCylinder,
} from '../src/lib/dimensional.js'

const SPEC_25 = { type: 'tolerance', nominal: '25.000', lower_tol: '-0.050', upper_tol: '+0.050', unit: 'mm' }
const result = (spec, ...values) => evaluateMeasurements(resolveSpec(spec), values).result

// ── The acceptance example ─────────────────────────────────────────────────
test('25.000 mm -0.050/+0.050 gives an acceptable range of 24.950-25.050 mm', () => {
  const spec = resolveSpec(SPEC_25)
  assert.strictEqual(spec.evaluable, true)
  assert.strictEqual(spec.minText, '24.950')
  assert.strictEqual(spec.maxText, '25.050')
  assert.strictEqual(spec.rangeText, '24.950 to 25.050 mm')
  assert.strictEqual(spec.text, '25.000 ± 0.050 mm')
})

test('measurements are judged exactly as the evaluation table requires', () => {
  assert.strictEqual(result(SPEC_25, '24.940'), 'F', 'below minimum fails')
  assert.strictEqual(result(SPEC_25, '24.950'), 'P', 'equal to minimum passes')
  assert.strictEqual(result(SPEC_25, '25.000'), 'P', 'between the limits passes')
  assert.strictEqual(result(SPEC_25, '25.050'), 'P', 'equal to maximum passes')
  assert.strictEqual(result(SPEC_25, '25.060'), 'F', 'above maximum fails')
})

test('no measurement leaves the point not evaluated', () => {
  const ev = evaluateMeasurements(resolveSpec(SPEC_25), ['', '  ', undefined])
  assert.strictEqual(ev.state, 'not_evaluated')
  assert.strictEqual(ev.result, '')
})

test('no valid spec keeps manual Pass/Fail', () => {
  assert.strictEqual(evaluateMeasurements(null, ['25']).state, 'manual')
  assert.strictEqual(evaluateMeasurements(resolveSpec('Per drawing'), ['25']).state, 'manual')
  assert.strictEqual(resolveStatus({ state: 'manual' }, 'F'), 'F', 'the manual status is kept')
})

// ── Exact limits (no binary float rounding) ────────────────────────────────
test('limits are computed exactly, so a reading on the limit is on it', () => {
  // 1.4 - 0.7 is 0.6999999999999999 in floating point.
  const spec = resolveSpec({ type: 'tolerance', nominal: '1.4', lower_tol: '-0.7', upper_tol: '+0.1' })
  assert.strictEqual(spec.minText, '0.7')
  assert.strictEqual(evaluateMeasurements(spec, ['0.7']).result, 'P')
  assert.strictEqual(evaluateMeasurements(spec, ['0.6999']).result, 'F')
  assert.strictEqual(evaluateMeasurements(spec, ['1.5']).result, 'P')
  assert.strictEqual(evaluateMeasurements(spec, ['1.50001']).result, 'F')
})

test('decimals compare and format without losing precision', () => {
  assert.strictEqual(compareDecimal(parseDecimal('24.95'), parseDecimal('24.950')), 0)
  assert.strictEqual(compareDecimal(parseDecimal('.029'), parseDecimal('0.03')), -1)
  assert.strictEqual(formatDecimal(parseDecimal('.029')), '0.029')
  assert.strictEqual(formatDecimal(parseDecimal('-0.5'), 3), '-0.500')
  assert.strictEqual(parseDecimal('1.2.3'), null)
  assert.strictEqual(parseDecimal('abc'), null)
})

// ── Spec formats ───────────────────────────────────────────────────────────
test('an unsigned lower tolerance is below nominal; explicit signs are respected', () => {
  const unsigned = resolveSpec({ type: 'tolerance', nominal: '10.00', lower_tol: '0.05', upper_tol: '0.05' })
  assert.strictEqual(unsigned.rangeText, '9.95 to 10.05')
  const bothAbove = resolveSpec({ type: 'tolerance', nominal: '10.00', lower_tol: '+0.02', upper_tol: '+0.05' })
  assert.strictEqual(bothAbove.rangeText, '10.02 to 10.05')
  assert.strictEqual(bothAbove.text, '10.00 +0.05 / +0.02')
})

test('min/max limits, including one-sided limits', () => {
  assert.strictEqual(resolveSpec({ type: 'limits', min: '0.029', max: '0.031', unit: 'in' }).rangeText, '0.029 to 0.031 in')
  const maxOnly = resolveSpec({ type: 'limits', max: '0.002', unit: 'in' })
  assert.strictEqual(maxOnly.text, 'Max 0.002 in')
  assert.strictEqual(evaluateMeasurements(maxOnly, ['0.002']).result, 'P')
  assert.strictEqual(evaluateMeasurements(maxOnly, ['-5']).result, 'P', 'no lower limit')
  assert.strictEqual(evaluateMeasurements(maxOnly, ['0.0021']).result, 'F')
  const minOnly = resolveSpec({ type: 'limits', min: '0.5' })
  assert.strictEqual(evaluateMeasurements(minOnly, ['0.49']).result, 'F')
  assert.strictEqual(evaluateMeasurements(minOnly, ['999']).result, 'P')
})

test('invalid spec entries are rejected with a reason', () => {
  assert.strictEqual(resolveSpec({ type: 'limits', min: '0.031', max: '0.029' }).error, 'min_gt_max')
  assert.strictEqual(resolveSpec({ type: 'tolerance', nominal: '25', lower_tol: '', upper_tol: '0.05' }).error, 'incomplete_tolerance')
  assert.strictEqual(resolveSpec({ type: 'tolerance', nominal: 'abc', lower_tol: '1', upper_tol: '1' }).error, 'invalid_number')
  assert.strictEqual(resolveSpec({ type: 'limits', min: 'x' }).error, 'invalid_number')
  assert.strictEqual(normalizeSpecValue({ type: 'limits', min: '2', max: '1' }).error, 'The lower limit is greater than the upper limit.')
})

test('legacy free-text specs are read when they are unambiguous', () => {
  assert.strictEqual(resolveSpec('45.00 ± 0.05').rangeText, '44.95 to 45.05')
  assert.strictEqual(resolveSpec('85.00±0.02').rangeText, '84.98 to 85.02')
  assert.strictEqual(resolveSpec('85.00 +/- 0.02 mm').rangeText, '84.98 to 85.02 mm')
  assert.strictEqual(resolveSpec('.029-.031"').rangeText, '0.029 to 0.031 in')
  assert.strictEqual(resolveSpec('.008-.010"').rangeText, '0.008 to 0.010 in')
  assert.strictEqual(resolveSpec('25.000 +0.050/-0.020').rangeText, '24.980 to 25.050')
  assert.strictEqual(resolveSpec('24.95 to 25.05 mm').rangeText, '24.95 to 25.05 mm')
  assert.strictEqual(resolveSpec('Max 0.002"').rangeText, '0.002 in or less')
  assert.strictEqual(resolveSpec('0.5 min').rangeText, '0.5 or more')
  assert.strictEqual(resolveSpec('Min 0.029 / Max 0.031').rangeText, '0.029 to 0.031')
})

test('ambiguous text is never guessed at', () => {
  for (const text of ['6.300" Groove OD for CAT, 5.990" Groove OD for Cummins', '6.300"', 'Per drawing', '25.000 -0.050', 'OK']) {
    const spec = resolveSpec(text)
    assert.strictEqual(spec.evaluable, false, text)
  }
  assert.strictEqual(parseSpecText(''), null)
})

test('specs with the same limits are equal whatever their format', () => {
  assert.ok(specsEqual('25.000 ± 0.050 mm', SPEC_25))
  assert.ok(specsEqual({ type: 'limits', min: '24.95', max: '25.05', unit: 'mm' }, SPEC_25))
  assert.ok(!specsEqual({ type: 'limits', min: '24.95', max: '25.05', unit: 'in' }, SPEC_25), 'units differ')
  assert.ok(!specsEqual('25.000 ± 0.040 mm', SPEC_25))
  assert.ok(specsEqual('', null))
  assert.ok(isSpecEmpty({ type: 'tolerance', nominal: '', lower_tol: '', upper_tol: '', unit: 'mm' }))
})

test('spec_data is cleaned before it is stored', () => {
  const { data, errors } = sanitizeSpecData({
    'dimensional.1': SPEC_25,
    'dimensional.2': '  45.00 ± 0.05 ',
    'dimensional.3': { type: 'tolerance', nominal: '', lower_tol: '', upper_tol: '' },
    'dimensional.4': { type: 'limits', min: '5', max: '1' },
  })
  assert.deepStrictEqual(Object.keys(data), ['dimensional.1', 'dimensional.2'])
  assert.strictEqual(data['dimensional.2'], '45.00 ± 0.05')
  assert.strictEqual(errors.length, 1)
  assert.strictEqual(errors[0].key, 'dimensional.4')
})

// ── Measurement entry ──────────────────────────────────────────────────────
test('measurement entries: numbers, empty, invalid and units', () => {
  assert.strictEqual(parseMeasurement('').state, 'empty')
  assert.strictEqual(parseMeasurement(' 24.95 ').state, 'valid')
  assert.strictEqual(parseMeasurement('.029"', 'in').state, 'valid')
  assert.strictEqual(parseMeasurement('25.00mm', 'mm').state, 'valid')
  assert.strictEqual(parseMeasurement('25.00 mm', 'in').reason, 'unit_mismatch')
  assert.strictEqual(parseMeasurement('abc').state, 'invalid')
  assert.strictEqual(parseMeasurement('24,95').state, 'invalid', 'comma decimals are rejected, not misread')
  assert.strictEqual(parseMeasurement('1.2.3').state, 'invalid')
})

test('an invalid entry is never judged a Pass', () => {
  const ev = evaluateMeasurements(resolveSpec(SPEC_25), ['25.000', 'oops'])
  assert.strictEqual(ev.state, 'invalid')
  assert.strictEqual(ev.result, '')
  assert.deepStrictEqual(ev.invalidIndexes, [1])
})

test('every entered reading must be within limits', () => {
  assert.strictEqual(result(SPEC_25, '25.000', '', '25.010'), 'P')
  assert.strictEqual(result(SPEC_25, '25.000', '25.051', '25.010'), 'F')
  assert.strictEqual(classifyMeasurement(resolveSpec(SPEC_25), '25.051'), 'above')
  assert.strictEqual(classifyMeasurement(resolveSpec(SPEC_25), '24.9'), 'below')
  assert.strictEqual(classifyMeasurement(resolveSpec(SPEC_25), '25'), 'within')
})

// ── Status rules ───────────────────────────────────────────────────────────
test('an automatic Fail may be Accepted; a Pass cannot be overridden', () => {
  const fail = { state: 'fail', result: 'F' }
  const pass = { state: 'pass', result: 'P' }
  assert.strictEqual(resolveStatus(fail, 'P'), 'F', 'an out-of-spec reading is never left marked Pass')
  assert.strictEqual(resolveStatus(fail, 'A'), 'A', 'an accepted deviation stays accepted')
  assert.strictEqual(resolveStatus(pass, 'F'), 'P')
  assert.strictEqual(resolveStatus({ state: 'not_evaluated', result: '' }, 'P'), '', 'clearing the reading clears the result')
  assert.deepStrictEqual(allowedStatusOptions(fail), ['F', 'A'])
  assert.deepStrictEqual(allowedStatusOptions(pass), ['P'])
  assert.deepStrictEqual(allowedStatusOptions({ state: 'invalid' }), [])
  assert.deepStrictEqual(allowedStatusOptions({ state: 'manual' }), ['P', 'F', 'A'])
})

// ── Inspection points ──────────────────────────────────────────────────────
const CYLINDER_HEAD = {
  receiving: { title: 'A. RECEIVING', section_type: 'pfn_checklist', items: [{ id: 1, name: 'Carton' }] },
  visual: { title: 'B. VISUAL', section_type: 'pfn_checklist', items: [{ id: 1, name: 'Edge Debur' }] },
  general_measurements: {
    title: 'C. General', section_type: 'general_measurements', optional: true,
    items: [{ id: 1, measurement: 'Cylinder Head Height' }, { id: 3, measurement: 'Flatness' }],
  },
  groove_specs: {
    title: 'C. Fire Ring', section_type: 'groove_specs', cylinder_count: 3,
    items: [
      { id: 1, measurement: 'Groove Diameter', spec: '6.300" Groove OD for CAT, 5.990" Groove OD for Cummins', entry: true },
      { id: 2, measurement: 'Groove Depth', spec: '.029-.031"', entry: true },
      { id: 3, measurement: 'Wire Protrusion', spec: '.008-.010"', entry: true },
    ],
  },
  valve_recession: { title: 'C. Valve Recession', section_type: 'valve_recession', cylinder_count: 2 },
  vacuum_test: { title: 'C. Vacuum', section_type: 'vacuum_test', cylinder_count: 2 },
}

test('every dimensional section type contributes its points (not just dimensional/general)', () => {
  const { points, issues } = listDimensionalPoints({
    ...CYLINDER_HEAD,
    dimensional: { title: 'C. DIM', section_type: 'dimensional', items: [{ id: 1, measurement: 'OD', spec: '' }] },
    camshaft_bore: { title: 'Cam', section_type: 'camshaft_bore', bore_count: 7 },
    fire_ring_protrusion: { title: 'FRP', section_type: 'fire_ring_protrusion', cylinder_count: 6 },
  })
  assert.deepStrictEqual(points.map(p => p.key), [
    'general_measurements.1', 'general_measurements.3',
    'groove_specs.1', 'groove_specs.2', 'groove_specs.3',
    'valve_recession.intake', 'valve_recession.exhaust',
    'dimensional.1', 'camshaft_bore.0', 'fire_ring_protrusion.0',
  ])
  assert.strictEqual(issues.length, 0)
  assert.ok(!points.some(p => p.sectionType === 'vacuum_test' || p.sectionType === 'pfn_checklist'),
    'Pass/Fail-only sections are not turned into dimensional points')
})

test('points with the same name in different sections stay distinct; duplicate ids are reported', () => {
  const { points, issues } = listDimensionalPoints({
    a: { title: 'A', section_type: 'dimensional', items: [{ id: 1, measurement: 'Flatness' }, { id: 1, measurement: 'Flatness again' }, { measurement: 'No id' }] },
    b: { title: 'B', section_type: 'general_measurements', items: [{ id: 1, measurement: 'Flatness' }] },
  })
  assert.deepStrictEqual(points.map(p => p.key), ['a.1', 'b.1'])
  assert.deepStrictEqual(issues.map(i => i.reason), ['duplicate_id', 'missing_id'])
})

test('a part spec wins over the form default; text defaults stay manual', () => {
  const index = buildSpecIndex(CYLINDER_HEAD, { 'groove_specs.1': { type: 'tolerance', nominal: '6.300', lower_tol: '-0.002', upper_tol: '+0.002', unit: 'in' } })
  assert.strictEqual(index['groove_specs.1'].source, 'part')
  assert.strictEqual(index['groove_specs.1'].rangeText, '6.298 to 6.302 in')
  assert.strictEqual(index['groove_specs.2'].source, 'form')
  assert.strictEqual(index['groove_specs.2'].rangeText, '0.029 to 0.031 in')
  const noPart = buildSpecIndex(CYLINDER_HEAD, null)
  assert.strictEqual(noPart['groove_specs.1'].evaluable, false, 'the CAT/Cummins text cannot be judged')
})

// ── Section evaluation ─────────────────────────────────────────────────────
test('Fire Ring cylinders are judged against the spec and the status follows edits', () => {
  const section = CYLINDER_HEAD.groove_specs
  const index = buildSpecIndex(CYLINDER_HEAD, {})
  const data = { measurements: [{ id: 2, cylinders: ['.030', '.031', ''], status: '', notes: '' }] }
  let r = evaluateSection('groove_specs', section, data, index)
  assert.strictEqual(r.data.measurements[0].status, 'P')
  assert.strictEqual(r.data.measurements[0].spec, '0.029 to 0.031 in')
  r = evaluateSection('groove_specs', section, { measurements: [{ ...r.data.measurements[0], cylinders: ['.030', '.032', ''] }] }, index)
  assert.strictEqual(r.data.measurements[0].status, 'F', 'editing a value re-evaluates it')
  r = evaluateSection('groove_specs', section, { measurements: [{ ...r.data.measurements[0], cylinders: ['', '', ''] }] }, index)
  assert.strictEqual(r.data.measurements[0].status, '', 'clearing the values clears the result')
})

test('dimensional rows: status, spec snapshot, and rows with no spec untouched', () => {
  const sections = { dimensional: { title: 'C', section_type: 'dimensional', items: [{ id: 1, measurement: 'OD', spec: '' }, { id: 2, measurement: 'ID', spec: '' }] } }
  const index = buildSpecIndex(sections, { 'dimensional.1': SPEC_25 })
  const data = [
    { id: 1, spec: '', actual1: '25.06', actual2: '', actual3: '', status: 'P' },
    { id: 2, spec: 'typed', actual1: '3', actual2: '', actual3: '', status: 'F' },
  ]
  const r = evaluateSection('dimensional', sections.dimensional, data, index)
  assert.strictEqual(r.data[0].status, 'F')
  assert.strictEqual(r.data[0].spec, '25.000 ± 0.050 mm')
  assert.strictEqual(r.data[1], data[1], 'no spec → manual row is left alone')
})

test('injector test-bench rows are never re-judged', () => {
  const section = { title: 'C', section_type: 'dimensional', layout: 'single_value', items: [{ id: 1, measurement: 'Leak', spec: '1 ± 0.5' }] }
  const data = [{ id: 1, spec: '1 ± 0.5', actual1: '9', status: 'P' }]
  const r = evaluateSection('dimensional', section, data, buildSpecIndex({ dimensional: section }, {}))
  assert.strictEqual(r.changed, false)
  assert.strictEqual(evaluateSectionData({ __injector_source: {}, __items: [{ dimensional: data }] }, { templateSections: { dimensional: section } }).changed, false)
})

test('valve recession cylinders combine intake and exhaust limits', () => {
  const intake = resolveSpec({ type: 'limits', min: '0.040', max: '0.060' })
  const exhaust = resolveSpec({ type: 'limits', min: '0.050', max: '0.070' })
  assert.strictEqual(evaluateValveCylinder({ int1: '.045', int2: '.050', exh1: '.055', exh2: '.07' }, intake, exhaust).result, 'P')
  assert.strictEqual(evaluateValveCylinder({ int1: '.045', exh1: '.071' }, intake, exhaust).result, 'F')
  assert.strictEqual(evaluateValveCylinder({}, intake, exhaust).state, 'not_evaluated')
  assert.strictEqual(evaluateValveCylinder({ int1: '.045', exh1: '.06' }, intake, null).state, 'manual',
    'an exhaust reading with no exhaust spec cannot be judged automatically')

  const sections = { valve_recession: CYLINDER_HEAD.valve_recession }
  const index = buildSpecIndex(sections, {
    'valve_recession.intake': { type: 'limits', min: '0.040', max: '0.060', unit: 'in' },
    'valve_recession.exhaust': { type: 'limits', min: '0.050', max: '0.070', unit: 'in' },
  })
  const r = evaluateSection('valve_recession', sections.valve_recession, {
    intake_min: '', intake_max: '', exhaust_min: '', exhaust_max: '',
    cylinders: [{ int1: '.05', int2: '', exh1: '.06', exh2: '', result: '' }, { int1: '.03', int2: '', exh1: '', exh2: '', result: 'P' }],
  }, index)
  assert.strictEqual(r.data.intake_min, '0.040')
  assert.strictEqual(r.data.exhaust_max, '0.070')
  assert.deepStrictEqual(r.data.cylinders.map(c => c.result), ['P', 'F'])
})

test('whole inspections: every item is evaluated and invalid entries are reported', () => {
  const sections = { dimensional: { title: 'C. DIM', section_type: 'dimensional', items: [{ id: 1, measurement: 'OD' }] } }
  const sectionData = {
    __shared: {},
    __items: [
      { dimensional: [{ id: 1, actual1: '25.01', actual2: '', actual3: '', status: '' }] },
      { dimensional: [{ id: 1, actual1: 'x', actual2: '', actual3: '', status: 'P' }] },
    ],
  }
  const r = evaluateSectionData(sectionData, { templateSections: sections, partSpecData: { 'dimensional.1': SPEC_25 } })
  assert.strictEqual(r.changed, true)
  assert.strictEqual(r.sectionData.__items[0].dimensional[0].status, 'P')
  assert.strictEqual(r.sectionData.__items[1].dimensional[0].status, '', 'an invalid reading is not left as Pass')
  assert.deepStrictEqual(r.invalid.map(i => [i.itemIndex, i.key, i.label]), [[1, 'dimensional.1', 'OD']])
  assert.strictEqual(sectionData.__items[0].dimensional[0].status, '', 'the input is not mutated')
})

test('onlyChanged leaves recorded results alone unless their readings changed', () => {
  const sections = { dimensional: { title: 'C', section_type: 'dimensional', items: [{ id: 1, measurement: 'OD' }, { id: 2, measurement: 'ID' }] } }
  const stored = { __items: [{ dimensional: [
    { id: 1, actual1: '25.06', actual2: '', actual3: '', status: 'P', spec: 'old spec' },
    { id: 2, actual1: '25.00', actual2: '', actual3: '', status: '' },
  ] }] }
  const incoming = { __items: [{ dimensional: [
    { id: 1, actual1: '25.06', actual2: '', actual3: '', status: 'P', spec: 'old spec' },
    { id: 2, actual1: '25.07', actual2: '', actual3: '', status: '' },
  ] }] }
  const partSpecData = { 'dimensional.1': SPEC_25, 'dimensional.2': SPEC_25 }
  const r = evaluateSectionData(incoming, { templateSections: sections, partSpecData, previous: stored, onlyChanged: true })
  assert.strictEqual(r.sectionData.__items[0].dimensional[0].status, 'P', 'historical result preserved')
  assert.strictEqual(r.sectionData.__items[0].dimensional[0].spec, 'old spec', 'historical spec preserved')
  assert.strictEqual(r.sectionData.__items[0].dimensional[1].status, 'F', 'the newly entered reading is evaluated')
})
