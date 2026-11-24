'use strict';
/**
 * GET /api/inspections and /api/inspections/assigned — the inspection lists.
 *
 *  - exclude_disposition= is used by the NCR "Link to Inspection" picker so
 *    passed inspections are not offered.
 *  - Each row carries part_description (shown in place of the form number),
 *    and the search box matches it.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const crypto = require('node:crypto');

const { db } = require('./helpers/testEnv');
const { errorHandler } = require('../middleware/error');
const inspectionsRoutes = require('../routes/inspections');

const USER = { id: 'u-list', name: 'Lee List', role: 'inspector' };
const PART = 'PN-EXCLUDE-DISP';

async function request(path, query = {}) {
  const app = express();
  app.use((req, res, next) => { req.user = USER; next(); });
  app.use('/api/inspections', inspectionsRoutes);
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/inspections${path}?${new URLSearchParams(query)}`);
    assert.strictEqual(res.status, 200);
    return res.json();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const list = (query) => request('', query);

function addInspection(template, fields) {
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO inspections (id, template_id, component_type, form_no, part_number, description, assigned_to, section_data, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'draft')`,
    [id, template.id, template.component_type, template.form_no,
      fields.part_number ?? null, fields.description ?? null, fields.assigned_to ?? null]
  );
  return id;
}

function addCatalogueEntry(template, partNumber, description) {
  db.run(
    `INSERT INTO part_specs (id, template_id, part_number, description, spec_data) VALUES (?, ?, ?, ?, '{}')`,
    [crypto.randomUUID(), template.id, partNumber, description]
  );
}

test('passed inspections can be left out of the list', async () => {
  const template = db.get('SELECT id, component_type, form_no FROM inspection_templates LIMIT 1', []);
  const dispositions = ['PASS', 'pass', ' Pass ', 'FAIL', 'REJECT', 'ACCEPTED', null];
  for (const disposition of dispositions) {
    db.run(
      `INSERT INTO inspections (id, template_id, component_type, form_no, part_number, disposition, section_data, status)
       VALUES (?, ?, ?, ?, ?, ?, '{}', 'complete')`,
      [crypto.randomUUID(), template.id, template.component_type, template.form_no, PART, disposition]
    );
  }

  const all = await list({ search: PART, limit: 50 });
  assert.strictEqual(all.total, dispositions.length, 'no filter lists everything');

  const withoutPass = await list({ search: PART, limit: 50, exclude_disposition: 'PASS' });
  assert.deepStrictEqual(
    withoutPass.inspections.map((i) => i.disposition).sort(),
    ['ACCEPTED', 'FAIL', 'REJECT', null].sort(),
    'every casing of PASS is left out; open inspections with no disposition stay'
  );
  assert.strictEqual(withoutPass.total, 4, 'the total matches the filtered list');

  const several = await list({ search: PART, limit: 50, exclude_disposition: 'pass, reject' });
  assert.strictEqual(several.total, 3);
});

test('rows carry the part description: the inspection\'s own, else the catalogue\'s for that form', async () => {
  const [form, otherForm] = db.all('SELECT id, component_type, form_no FROM inspection_templates ORDER BY id LIMIT 2', []);
  addCatalogueEntry(form, 'PN-DESC-OWN', 'Wombat catalogue text');
  addCatalogueEntry(form, 'PN-DESC-CAT', 'Zephyr C15 Cylinder Head Stage 1');
  addCatalogueEntry(otherForm, 'PN-DESC-OTHER', 'Numbat other form description');

  const own = addInspection(form, { part_number: 'PN-DESC-OWN', description: '  Quokka recorded description ' });
  const fromCatalogue = addInspection(form, { part_number: ' pn-desc-cat ' });
  const otherFormOnly = addInspection(form, { part_number: 'PN-DESC-OTHER', description: '   ' });
  const none = addInspection(form, { part_number: 'PN-DESC-NONE' });

  const { inspections } = await list({ search: 'PN-DESC', limit: 50 });
  const byId = new Map(inspections.map((i) => [i.id, i.part_description]));
  assert.strictEqual(byId.get(own), 'Quokka recorded description', 'the description recorded on the inspection wins');
  assert.strictEqual(byId.get(fromCatalogue), 'Zephyr C15 Cylinder Head Stage 1',
    'falls back to the catalogue, matching the part number regardless of case and spaces');
  assert.strictEqual(byId.get(otherFormOnly), null, 'a catalogue entry on another form is not used');
  assert.strictEqual(byId.get(none), null, 'no description anywhere');
});

test('the search box matches the part description', async () => {
  const [form, otherForm] = db.all('SELECT id, component_type, form_no FROM inspection_templates ORDER BY id LIMIT 2', []);
  addCatalogueEntry(form, 'PN-SRCH-CAT', 'Kestrel Turbocharger Assembly');
  addCatalogueEntry(form, 'PN-SRCH-OWN', 'Heron catalogue wording');
  addCatalogueEntry(otherForm, 'PN-SRCH-ELSE', 'Osprey other form only');

  const fromCatalogue = addInspection(form, { part_number: 'pn-srch-cat' });
  const own = addInspection(form, { part_number: 'PN-SRCH-OWN', description: 'Plover recorded wording' });
  addInspection(form, { part_number: 'PN-SRCH-ELSE' });

  const byCatalogue = await list({ search: 'kestrel turbo', limit: 50 });
  assert.deepStrictEqual(byCatalogue.inspections.map((i) => i.id), [fromCatalogue]);
  assert.strictEqual(byCatalogue.total, 1, 'the total counts description matches');

  const byOwn = await list({ search: 'Plover recorded', limit: 50 });
  assert.deepStrictEqual(byOwn.inspections.map((i) => i.id), [own]);

  const byCatalogueBehindOwn = await list({ search: 'Heron catalogue', limit: 50 });
  assert.deepStrictEqual(byCatalogueBehindOwn.inspections.map((i) => i.id), [own],
    'the catalogue description of the part still finds it');

  const otherFormSearch = await list({ search: 'Osprey other form', limit: 50 });
  assert.strictEqual(otherFormSearch.total, 0, 'a catalogue entry on another form does not match');
});

test('assigned inspections carry the part description', async () => {
  const [form] = db.all('SELECT id, component_type, form_no FROM inspection_templates ORDER BY id LIMIT 1', []);
  addCatalogueEntry(form, 'PN-ASSIGNED', 'Falcon Fuel Injector');
  const id = addInspection(form, { part_number: 'PN-ASSIGNED', assigned_to: USER.id });

  const { inspections } = await request('/assigned');
  const row = inspections.find((i) => i.id === id);
  assert.ok(row, 'the assigned inspection is listed');
  assert.strictEqual(row.part_description, 'Falcon Fuel Injector');
});

test('sorting and paging keep their order with the part description attached', async () => {
  const [form] = db.all('SELECT id, component_type, form_no FROM inspection_templates ORDER BY id LIMIT 1', []);
  const parts = ['PN-PAGE-E', 'PN-PAGE-B', 'PN-PAGE-D', 'PN-PAGE-A', 'PN-PAGE-C'];
  for (const pn of parts) {
    addCatalogueEntry(form, pn, `Description of ${pn}`);
    addInspection(form, { part_number: pn });
  }
  const sorted = [...parts].sort();
  const query = { search: 'PN-PAGE-', sort_by: 'part_number', limit: 2 };

  const pages = [];
  for (const page of [1, 2, 3]) {
    pages.push(await list({ ...query, sort_dir: 'asc', page }));
  }
  assert.deepStrictEqual(pages.map((p) => p.total), [5, 5, 5]);
  assert.deepStrictEqual(pages.flatMap((p) => p.inspections.map((i) => i.part_number)), sorted);
  assert.deepStrictEqual(
    pages.flatMap((p) => p.inspections.map((i) => i.part_description)),
    sorted.map((pn) => `Description of ${pn}`)
  );

  const descending = await list({ ...query, sort_dir: 'desc', page: 1 });
  assert.deepStrictEqual(descending.inspections.map((i) => i.part_number), ['PN-PAGE-E', 'PN-PAGE-D']);
});
