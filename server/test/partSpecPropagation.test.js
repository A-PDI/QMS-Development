'use strict';
/**
 * Part-number dimensional specifications and copying them to the other part
 * numbers in a product family — /api/part-specs.
 *
 * Covers spec validation on save, the family lookup (Stage 1 ↔ Stage 2, never
 * across engine models or component types), the preview, explicit selection,
 * conflict handling, unmappable points, and that copies stay independent.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const crypto = require('node:crypto');

const { db } = require('./helpers/testEnv');
const { errorHandler } = require('../middleware/error');
const partSpecRoutes = require('../routes/part-specs');

const ADMIN = { id: 'u-ps-admin', name: 'Alex Admin', role: 'admin' };
const INSPECTOR = { id: 'u-ps-insp', name: 'Ivy Inspector', role: 'inspector' };
for (const user of [ADMIN, INSPECTOR]) {
  db.run('INSERT OR IGNORE INTO users (id, name, email, role, active) VALUES (?, ?, ?, ?, 1)',
    [user.id, user.name, `${user.id}@test.local`, user.role]);
}

const HEAD_SECTIONS = {
  receiving: { title: 'A. RECEIVING', section_type: 'pfn_checklist', items: [{ id: 1, name: 'Carton' }] },
  general_measurements: { title: 'C. General', section_type: 'general_measurements', optional: true, items: [
    { id: 1, measurement: 'Cylinder Head Height' }, { id: 3, measurement: 'Flatness' },
  ] },
  groove_specs: { title: 'C. Fire Ring', section_type: 'groove_specs', optional: true, cylinder_count: 6, items: [
    { id: 1, measurement: 'Groove Diameter', spec: '', entry: true },
    { id: 2, measurement: 'Groove Depth', spec: '.029-.031"', entry: true },
  ] },
};
// An older form for the same component: no Fire Ring, Flatness under another id.
const OLD_HEAD_SECTIONS = {
  general_measurements: { title: 'C. General', section_type: 'general_measurements', items: [
    { id: 1, measurement: 'Cylinder Head Height' }, { id: 3, measurement: 'Surface Finish (Ra)' },
  ] },
};
const PISTON_SECTIONS = {
  dimensional: { title: 'C. DIM', section_type: 'dimensional', items: [{ id: 1, measurement: 'Skirt OD', spec: '' }] },
};

function insertTemplate(formNo, componentType, sections) {
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO inspection_templates (id, component_type, form_no, revision, title, form_type, disposition_type, header_schema, sections, active)
     VALUES (?, ?, ?, '', ?, 'iqi_standard', 'pass_fail', '[]', ?, 1)`,
    [id, componentType, formNo, `Test ${formNo}`, JSON.stringify(sections)]
  );
  return id;
}

const HEAD = insertTemplate('TEST-PS-HEAD', 'test_ps_head', HEAD_SECTIONS);
const OLD_HEAD = insertTemplate('TEST-PS-HEAD-OLD', 'test_ps_head', OLD_HEAD_SECTIONS);
const PISTON = insertTemplate('TEST-PS-PISTON', 'test_ps_piston', PISTON_SECTIONS);

async function serve(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/part-specs', partSpecRoutes);
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

async function call(user, method, path, body) {
  const s = await serve(user);
  try {
    const res = await fetch(`${s.url}/api/part-specs${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await s.close();
  }
}

async function createPart(template_id, part_number, description, spec_data = {}, extra = {}) {
  const res = await call(ADMIN, 'POST', '/', { template_id, part_number, description, spec_data, ...extra });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  return res.body.spec;
}

const specOf = id => JSON.parse(db.get('SELECT spec_data FROM part_specs WHERE id = ?', [id]).spec_data);

const DIAMETER = { type: 'tolerance', nominal: '6.300', lower_tol: '-0.002', upper_tol: '+0.002', unit: 'in' };
const HEIGHT = { type: 'tolerance', nominal: '4.250', lower_tol: '-0.005', upper_tol: '+0.005', unit: 'in' };
const FLAT = { type: 'limits', min: '', max: '0.002', unit: 'in' };

let C15_S1; let C15_S2; let C15_OLD; let ISX_S1; let ISX_S2; let C15_PISTON;

test.before(async () => {
  C15_S1 = await createPart(HEAD, 'T-C15-S1', 'CAT C15 Cylinder Head Stage 1');
  C15_S2 = await createPart(HEAD, 'T-C15-S2', 'Caterpillar C15 Cylinder Head - Stage 2', {
    'general_measurements.1': { type: 'tolerance', nominal: '4.300', lower_tol: '-0.005', upper_tol: '+0.005', unit: 'in' },
  });
  C15_OLD = await createPart(OLD_HEAD, 'T-C15-S0', 'CAT C15 Cylinder Head Stage 0');
  ISX_S1 = await createPart(HEAD, 'T-ISX-S1', 'Cummins ISX Cylinder Head Stage 1');
  ISX_S2 = await createPart(HEAD, 'T-ISX-S2', 'Cummins ISX Cylinder Head Stage 2');
  C15_PISTON = await createPart(PISTON, 'T-C15-PST', 'CAT C15 Cylinder Head Stage 2');
});

// ── Saving specs ───────────────────────────────────────────────────────────
test('structured specs are validated and stored; an impossible range is refused', async () => {
  const ok = await call(ADMIN, 'PATCH', `/${C15_S1.id}`, { spec_data: {
    'groove_specs.1': DIAMETER, 'general_measurements.1': HEIGHT, 'general_measurements.3': FLAT,
  } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.deepStrictEqual(ok.body.spec.spec_data['groove_specs.1'], DIAMETER);

  const bad = await call(ADMIN, 'PATCH', `/${C15_S1.id}`, { spec_data: {
    'groove_specs.1': { type: 'limits', min: '6.310', max: '6.290', unit: 'in' },
  } });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.body.error, /lower limit is greater than the upper limit/);
  assert.deepStrictEqual(specOf(C15_S1.id)['groove_specs.1'], DIAMETER, 'the stored spec is unchanged');
});

test('legacy free-text specs are still accepted', async () => {
  const part = await createPart(PISTON, 'T-LEGACY', 'Legacy piston', { 'dimensional.1': '45.00 ± 0.05' });
  assert.strictEqual(part.spec_data['dimensional.1'], '45.00 ± 0.05');
});

test('inspectors cannot change specs or see families', async () => {
  assert.strictEqual((await call(INSPECTOR, 'PATCH', `/${C15_S1.id}`, { spec_data: {} })).status, 403);
  assert.strictEqual((await call(INSPECTOR, 'GET', `/${C15_S1.id}/family`)).status, 403);
  assert.strictEqual((await call(INSPECTOR, 'POST', `/${C15_S1.id}/propagate`, { targets: [] })).status, 403);
});

// ── Family lookup ──────────────────────────────────────────────────────────
test('C15 Stage 1 is offered its Stage 2 (and older-form variant), never ISX or a piston', async () => {
  const res = await call(ADMIN, 'GET', `/${C15_S1.id}/family`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.family.name, 'CAT C15 CYLINDER HEAD');
  const offered = res.body.candidates.map(c => c.part_number);
  assert.deepStrictEqual(offered, ['T-C15-S0', 'T-C15-S2']);
  assert.ok(!offered.includes(ISX_S1.part_number) && !offered.includes(C15_PISTON.part_number));
  assert.strictEqual(res.body.candidates.find(c => c.part_number === 'T-C15-S2').variant, 'STAGE 2');
});

test('ISX Stage 1 is offered only ISX Stage 2', async () => {
  const res = await call(ADMIN, 'GET', `/${ISX_S1.id}/family`);
  assert.deepStrictEqual(res.body.candidates.map(c => c.part_number), ['T-ISX-S2']);
});

// ── Preview and propagation ────────────────────────────────────────────────
test('the preview reports what would change, conflicts and unmappable points, and changes nothing', async () => {
  const before = specOf(C15_S2.id);
  const res = await call(ADMIN, 'POST', `/${C15_S1.id}/propagate/preview`, { target_ids: [C15_S2.id, C15_OLD.id] });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const s2 = res.body.plans.find(p => p.id === C15_S2.id);
  assert.deepStrictEqual(s2.apply.map(e => e.key).sort(), ['general_measurements.3', 'groove_specs.1']);
  assert.deepStrictEqual(s2.conflicts.map(e => [e.key, e.existing_text, e.new_text]),
    [['general_measurements.1', '4.300 ± 0.005 in', '4.250 ± 0.005 in']]);
  const old = res.body.plans.find(p => p.id === C15_OLD.id);
  assert.deepStrictEqual(old.apply.map(e => e.key), ['general_measurements.1']);
  assert.deepStrictEqual(old.skipped.map(e => [e.key, e.reason]).sort(), [
    ['general_measurements.3', 'incompatible_point'],
    ['groove_specs.1', 'missing_point'],
  ]);
  assert.deepStrictEqual(specOf(C15_S2.id), before);
});

test('specs are never copied to a part outside the family', async () => {
  const res = await call(ADMIN, 'POST', `/${C15_S1.id}/propagate`, { targets: [{ id: ISX_S2.id }] });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'NOT_IN_FAMILY');
  assert.deepStrictEqual(specOf(ISX_S2.id), {});
  const empty = await call(ADMIN, 'POST', `/${C15_S1.id}/propagate`, { targets: [] });
  assert.strictEqual(empty.status, 400, 'an explicit selection is required');
});

test('without confirmation an existing different spec is kept; only empty points are filled', async () => {
  const res = await call(ADMIN, 'POST', `/${C15_S1.id}/propagate`, { targets: [{ id: C15_S2.id, replace_conflicts: false }] });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.results[0].applied, 2);
  assert.strictEqual(res.body.results[0].replaced, 0);
  assert.deepStrictEqual(res.body.results[0].kept_existing.map(k => k.key), ['general_measurements.1']);
  const s2 = specOf(C15_S2.id);
  assert.deepStrictEqual(s2['groove_specs.1'], DIAMETER);
  assert.deepStrictEqual(s2['general_measurements.3'], FLAT);
  assert.strictEqual(s2['general_measurements.1'].nominal, '4.300');
});

test('with confirmation the conflicting spec is replaced', async () => {
  const res = await call(ADMIN, 'POST', `/${C15_S1.id}/propagate`, { targets: [{ id: C15_S2.id, replace_conflicts: true }] });
  assert.strictEqual(res.body.results[0].replaced, 1);
  assert.deepStrictEqual(specOf(C15_S2.id)['general_measurements.1'], HEIGHT);
});

test('unmappable points are skipped on another form while compatible ones are applied', async () => {
  const res = await call(ADMIN, 'POST', `/${C15_S1.id}/propagate`, { targets: [{ id: C15_OLD.id }] });
  const result = res.body.results[0];
  assert.strictEqual(result.applied, 1);
  assert.deepStrictEqual(result.skipped.map(s => s.reason).sort(), ['incompatible_point', 'missing_point']);
  assert.deepStrictEqual(specOf(C15_OLD.id), { 'general_measurements.1': HEIGHT },
    'Flatness was not written onto the old form\'s Surface Finish point');
});

test('copies are independent: a later edit to one part does not change the other', async () => {
  const edited = { ...DIAMETER, nominal: '6.310' };
  await call(ADMIN, 'PATCH', `/${C15_S1.id}`, { spec_data: { ...specOf(C15_S1.id), 'groove_specs.1': edited } });
  assert.deepStrictEqual(specOf(C15_S1.id)['groove_specs.1'], edited);
  assert.deepStrictEqual(specOf(C15_S2.id)['groove_specs.1'], DIAMETER);
  // …and when the admin chooses to propagate again, the difference is a conflict.
  const preview = await call(ADMIN, 'POST', `/${C15_S1.id}/propagate/preview`, { target_ids: [C15_S2.id] });
  assert.deepStrictEqual(preview.body.plans[0].conflicts.map(c => c.key), ['groove_specs.1']);
});

test('an explicit product family groups parts the descriptions would not', async () => {
  const a = await createPart(HEAD, 'T-FAM-A', 'Ported head', {}, { product_family: 'C15 Race Heads' });
  const b = await createPart(HEAD, 'T-FAM-B', 'Bare casting', {}, { product_family: 'c15 race heads' });
  const res = await call(ADMIN, 'GET', `/${a.id}/family`);
  assert.strictEqual(res.body.family.explicit, true);
  assert.deepStrictEqual(res.body.candidates.map(c => c.id), [b.id]);
  assert.strictEqual(db.get('SELECT product_family FROM part_specs WHERE id = ?', [a.id]).product_family, 'C15 Race Heads');
});
