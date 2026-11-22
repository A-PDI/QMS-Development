'use strict';
/**
 * Product-family recognition for dimensional spec propagation
 * (services/partFamilies.js): which part numbers count as variants of the
 * same product, and how specs map onto another part's inspection points.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  normalizeText, baseDescription, variantsOf, familyKey, findFamilyCandidates, planPropagation, applyPlan,
} = require('../services/partFamilies');

const loadRules = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'dimensionalSpec.mjs')).href);

let n = 0;
const part = (part_number, description, extra = {}) => ({
  id: `p${++n}`, part_number, description, component_type: 'cylinder_head', product_family: null, ...extra,
});

const C15_S1 = part('C15-S1', 'Caterpillar C15 Cylinder Head — Stage 1');
const C15_S2 = part('C15-S2', 'CAT C15 Cylinder Head Stage 2');
const C15_S3 = part('C15-S3', 'C15 cylinder head (stage-3)');       // no make → different description
const ISX_S1 = part('ISX-S1', 'Cummins ISX Cylinder Head - Stage 1');
const ISX_S2 = part('ISX-S2', 'Cummins ISX Cylinder Head - Stage 2');
const C13_S1 = part('C13-S1', 'CAT C13 Cylinder Head Stage 1');
const C15_PISTON = part('C15-PST', 'CAT C15 Cylinder Head Stage 2', { component_type: 'piston' });
const ALL = [C15_S1, C15_S2, C15_S3, ISX_S1, ISX_S2, C13_S1, C15_PISTON];

const numbers = parts => parts.map(p => p.part_number);

test('descriptions are normalized before comparison', () => {
  assert.strictEqual(normalizeText('Caterpillar C15 Cyl. Head — Stage 1'), 'CAT C15 CYLINDER HEAD STAGE 1');
  assert.strictEqual(baseDescription('Caterpillar C15 Cylinder Head — Stage 1'), 'CAT C15 CYLINDER HEAD');
  assert.strictEqual(baseDescription('Cummins ISX Cylinder Head - STG2'), 'CUMMINS ISX CYLINDER HEAD');
  assert.deepStrictEqual(variantsOf('C15 Head Stage II'), ['STAGE II']);
  assert.deepStrictEqual(variantsOf('C15 Head'), []);
});

test('C15 Stage 1 finds its Stage 2, and never the ISX heads', () => {
  assert.deepStrictEqual(numbers(findFamilyCandidates(C15_S1, ALL)), ['C15-S2']);
});

test('ISX Stage 1 finds its Stage 2, and never the C15 heads', () => {
  assert.deepStrictEqual(numbers(findFamilyCandidates(ISX_S1, ALL)), ['ISX-S2']);
});

test('a different engine model or component type is never in the family', () => {
  assert.deepStrictEqual(numbers(findFamilyCandidates(C13_S1, ALL)), [], 'C13 is not C15');
  assert.ok(!findFamilyCandidates(C15_S1, ALL).some(p => p.component_type === 'piston'),
    'same words on a piston do not make it a cylinder head');
});

test('additional stages join the family without code changes', () => {
  const s3 = part('C15-S3B', 'CAT C15 Cylinder Head Stage 3');
  assert.deepStrictEqual(numbers(findFamilyCandidates(C15_S1, [...ALL, s3])), ['C15-S2', 'C15-S3B']);
});

test('an explicit product family overrides the description', () => {
  const a = part('X-1', 'Head assembly, ported', { product_family: 'C15 Performance Heads' });
  const b = part('X-2', 'Bare casting', { product_family: 'c15 performance heads' });
  const c = part('X-3', 'Head assembly, ported');
  assert.deepStrictEqual(numbers(findFamilyCandidates(a, [a, b, c])), ['X-2']);
  assert.deepStrictEqual(numbers(findFamilyCandidates(c, [a, b, c])), [],
    'a part assigned to an explicit family is not picked up by description');
  assert.deepStrictEqual(familyKey(a), { key: 'family:C15 PERFORMANCE HEADS', explicit: true, name: 'C15 PERFORMANCE HEADS' });
});

test('a part with no description and no family has no family', () => {
  assert.strictEqual(familyKey(part('BLANK', '')), null);
  assert.strictEqual(familyKey(part('ONLY-STAGE', 'Stage 2')), null);
  assert.deepStrictEqual(findFamilyCandidates(part('BLANK2', ''), ALL), []);
});

// ── Mapping specs onto another part's points ──────────────────────────────
const SOURCE_SECTIONS = {
  groove_specs: { title: 'Fire Ring', section_type: 'groove_specs', items: [
    { id: 1, measurement: 'Groove Diameter', entry: true },
    { id: 2, measurement: 'Groove Depth', entry: true },
  ] },
  general_measurements: { title: 'General', section_type: 'general_measurements', items: [
    { id: 1, measurement: 'Cylinder Head Height' }, { id: 3, measurement: 'Flatness' },
  ] },
};
const DIAMETER = { type: 'tolerance', nominal: '6.300', lower_tol: '-0.002', upper_tol: '+0.002', unit: 'in' };
const DEPTH = { type: 'limits', min: '0.029', max: '0.031', unit: 'in' };
const HEIGHT = { type: 'tolerance', nominal: '4.250', lower_tol: '-0.005', upper_tol: '+0.005', unit: 'in' };
const SOURCE_SPECS = { 'groove_specs.1': DIAMETER, 'groove_specs.2': DEPTH, 'general_measurements.1': HEIGHT };

test('specs map by point identity; existing different specs are conflicts, not overwrites', async () => {
  const rules = await loadRules();
  const target = { id: 't1', part_number: 'C15-S2', spec_data: {
    'groove_specs.2': '.029-.031"',                                   // same range, other format
    'general_measurements.1': { type: 'tolerance', nominal: '4.300', lower_tol: '-0.005', upper_tol: '+0.005', unit: 'in' },
    'general_measurements.3': { type: 'limits', max: '0.002', unit: 'in' },  // not in source — untouched
  } };
  const [plan] = planPropagation(rules, {
    sourceSections: SOURCE_SECTIONS, sourceSpecData: SOURCE_SPECS, targets: [{ part: target, sections: SOURCE_SECTIONS }],
  });
  assert.deepStrictEqual(plan.apply.map(e => e.key), ['groove_specs.1']);
  assert.deepStrictEqual(plan.unchanged.map(e => e.key), ['groove_specs.2']);
  assert.deepStrictEqual(plan.conflicts.map(e => [e.key, e.existing_text, e.new_text]),
    [['general_measurements.1', '4.300 ± 0.005 in', '4.250 ± 0.005 in']]);
  assert.strictEqual(plan.skipped.length, 0);

  const kept = applyPlan(target.spec_data, plan, false);
  assert.deepStrictEqual(kept['groove_specs.1'], DIAMETER, 'an empty point is filled');
  assert.strictEqual(kept['general_measurements.1'].nominal, '4.300', 'without confirmation the existing spec is kept');
  assert.deepStrictEqual(kept['general_measurements.3'], target.spec_data['general_measurements.3']);
  const replaced = applyPlan(target.spec_data, plan, true);
  assert.strictEqual(replaced['general_measurements.1'].nominal, '4.250', 'with confirmation it is replaced');
  assert.strictEqual(target.spec_data['groove_specs.1'], undefined, 'the input is not mutated');
});

test('points a target form lacks, or defines differently, are skipped and reported', async () => {
  const rules = await loadRules();
  const otherForm = {
    groove_specs: { title: 'Fire Ring', section_type: 'groove_specs', items: [
      { id: 1, measurement: 'Groove Diameter', entry: true },
      { id: 2, measurement: 'Wire Protrusion', entry: true },          // same id, different point
    ] },
  };
  const [plan] = planPropagation(rules, {
    sourceSections: SOURCE_SECTIONS, sourceSpecData: SOURCE_SPECS,
    targets: [{ part: { id: 't2', part_number: 'OLD-REV', spec_data: {} }, sections: otherForm }],
  });
  assert.deepStrictEqual(plan.apply.map(e => e.key), ['groove_specs.1']);
  assert.deepStrictEqual(plan.skipped.map(e => [e.key, e.reason]), [
    ['groove_specs.2', 'incompatible_point'],
    ['general_measurements.1', 'missing_point'],
  ]);
});
