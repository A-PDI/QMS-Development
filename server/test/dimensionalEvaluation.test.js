'use strict';
/**
 * Automatic dimensional Pass/Fail on the server — PATCH /api/inspections/:id
 * and POST /api/inspections/:id/complete apply the shared evaluation rules, so
 * a stored result always agrees with its measurement and the part's spec.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const crypto = require('node:crypto');

const { db } = require('./helpers/testEnv');
const { errorHandler } = require('../middleware/error');
const inspectionsRoutes = require('../routes/inspections');

const USER = { id: 'u-dim-insp', name: 'Ivy Inspector', role: 'inspector' };
db.run('INSERT OR IGNORE INTO users (id, name, email, role, active) VALUES (?, ?, ?, ?, 1)',
  [USER.id, USER.name, `${USER.id}@test.local`, USER.role]);

const SECTIONS = {
  receiving: { title: 'A. RECEIVING', section_type: 'pfn_checklist', items: [{ id: 1, name: 'Carton' }] },
  dimensional: { title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional', items: [
    { id: 1, measurement: 'Skirt OD', location: '', spec: '' },
    { id: 2, measurement: 'Pin Bore', location: '', spec: '' },
    { id: 3, measurement: 'Ring Groove', location: '', spec: 'see drawing' },
  ] },
  groove_specs: { title: 'C. Fire Ring', section_type: 'groove_specs', cylinder_count: 2, items: [
    { id: 2, measurement: 'Groove Depth', spec: '.029-.031"', entry: true },
  ] },
};
const TEMPLATE = crypto.randomUUID();
db.run(
  `INSERT INTO inspection_templates (id, component_type, form_no, revision, title, form_type, disposition_type, header_schema, sections, active)
   VALUES (?, 'test_dim', 'TEST-DIM-EVAL', '', 'Test', 'iqi_standard', 'pass_fail', '[]', ?, 1)`,
  [TEMPLATE, JSON.stringify(SECTIONS)]
);

const SKIRT = { type: 'tolerance', nominal: '25.000', lower_tol: '-0.050', upper_tol: '+0.050', unit: 'mm' };
function setPartSpec(partNumber, specData) {
  db.run('DELETE FROM part_specs WHERE template_id = ? AND part_number = ?', [TEMPLATE, partNumber]);
  db.run(`INSERT INTO part_specs (id, template_id, part_number, description, spec_data) VALUES (?, ?, ?, '', ?)`,
    [crypto.randomUUID(), TEMPLATE, partNumber, JSON.stringify(specData)]);
}
setPartSpec('PN-EVAL', { 'dimensional.1': SKIRT, 'dimensional.2': { type: 'limits', min: '10.000', max: '10.020', unit: 'mm' } });

function createInspection(partNumber, status = 'draft', sectionData = {}) {
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO inspections (id, template_id, component_type, form_no, part_number, status, section_data, created_by)
     VALUES (?, ?, 'test_dim', 'TEST-DIM-EVAL', ?, ?, ?, ?)`,
    [id, TEMPLATE, partNumber, status, JSON.stringify(sectionData), USER.id]
  );
  return id;
}

const row = (id, actual1, status = '', extra = {}) => ({ id, spec: '', actual1, actual2: '', actual3: '', status, notes: '', ...extra });
const stored = id => JSON.parse(db.get('SELECT section_data FROM inspections WHERE id = ?', [id]).section_data);

async function request(method, path, body) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = USER; next(); });
  app.use('/api/inspections', inspectionsRoutes);
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/inspections${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(r => server.close(r));
  }
}

test('saving a draft evaluates measurements against the part spec, whatever status the client sent', async () => {
  const id = createInspection('PN-EVAL');
  const res = await request('PATCH', `/${id}`, { section_data: { __items: [{ dimensional: [
    row(1, '25.060', 'P'),     // out of spec but sent as Pass
    row(2, '10.000', ''),      // exactly on the minimum
    row(3, '7', 'F'),          // no evaluable spec → the inspector's own result
  ] }] } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const rows = stored(id).__items[0].dimensional;
  assert.deepStrictEqual(rows.map(r => r.status), ['F', 'P', 'F']);
  assert.strictEqual(rows[0].spec, '25.000 ± 0.050 mm', 'the spec used is recorded with the result');
  assert.strictEqual(rows[2].spec, '', 'a manual row is left as entered');
});

test('an out-of-spec reading may be dispositioned Accepted', async () => {
  const id = createInspection('PN-EVAL');
  await request('PATCH', `/${id}`, { section_data: { __items: [{ dimensional: [row(1, '25.060', 'A', { notes: 'Deviation 12' })] }] } });
  assert.strictEqual(stored(id).__items[0].dimensional[0].status, 'A');
});

test('the part spec follows the part number being saved, matched case-insensitively', async () => {
  const id = createInspection('OTHER');
  await request('PATCH', `/${id}`, { part_number: ' pn-eval ', section_data: { __items: [{ dimensional: [row(1, '24.900', 'P')] }] } });
  assert.strictEqual(stored(id).__items[0].dimensional[0].status, 'F');
});

test('a numeric spec written on the form applies when the part has none', async () => {
  const id = createInspection('NO-SPEC-PART');
  await request('PATCH', `/${id}`, { section_data: { __items: [{
    dimensional: [row(1, '99', 'P')],
    groove_specs: { measurements: [{ id: 2, cylinders: ['.030', '.032'], status: 'P', notes: '' }] },
  }] } });
  const item = stored(id).__items[0];
  assert.strictEqual(item.dimensional[0].status, 'P', 'no spec → manual result kept');
  assert.strictEqual(item.groove_specs.measurements[0].status, 'F', 'form default .029-.031" applied');
});

test('completion is refused while a reading against a spec is not a number', async () => {
  const id = createInspection('PN-EVAL', 'draft', { __items: [{ __disposition: 'PASS', dimensional: [row(1, '25.0.1', 'P')] }] });
  const res = await request('POST', `/${id}/complete`, {});
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'INVALID_MEASUREMENT');
  assert.match(res.body.error, /Skirt OD/);
  assert.strictEqual(db.get('SELECT status FROM inspections WHERE id = ?', [id]).status, 'draft');
});

test('completion re-applies the evaluation to what is stored', async () => {
  const id = createInspection('PN-EVAL', 'draft', { __items: [{ __disposition: 'PASS', dimensional: [row(1, '25.050', 'F'), row(2, '10.021', 'P')] }] });
  const res = await request('POST', `/${id}/complete`, {});
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(stored(id).__items[0].dimensional.map(r => r.status), ['P', 'F']);
  assert.strictEqual(db.get('SELECT status FROM inspections WHERE id = ?', [id]).status, 'complete');
});

test('a closed inspection keeps its recorded results; only newly entered readings are evaluated', async () => {
  const historical = { __items: [{
    dimensional: [row(1, '25.060', 'P', { spec: 'old spec' })],
    groove_specs: { measurements: [{ id: 2, cylinders: ['', ''], status: '', notes: '' }] },
  }] };
  const id = createInspection('PN-EVAL', 'complete', historical);
  // e.g. Add Fire Ring on a completed cylinder-head inspection
  await request('PATCH', `/${id}`, { section_data: { __items: [{
    dimensional: historical.__items[0].dimensional,
    groove_specs: { measurements: [{ id: 2, cylinders: ['.030', '.0305'], status: '', notes: '' }] },
  }] } });
  const item = stored(id).__items[0];
  assert.strictEqual(item.dimensional[0].status, 'P', 'historical result untouched');
  assert.strictEqual(item.dimensional[0].spec, 'old spec');
  assert.strictEqual(item.groove_specs.measurements[0].status, 'P', 'the new readings are evaluated');
});

test('injector test-bench inspections are never re-judged', async () => {
  const id = createInspection('PN-EVAL');
  const data = { __injector_source: { report_ext_id: 'x' }, __items: [{ dimensional: [row(1, '99', 'P')] }] };
  await request('PATCH', `/${id}`, { section_data: data });
  assert.strictEqual(stored(id).__items[0].dimensional[0].status, 'P');
});
