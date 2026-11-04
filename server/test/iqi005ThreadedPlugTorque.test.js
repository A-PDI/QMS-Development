'use strict';
/**
 * PDI-IQI-005 (Cylinder Head) — "Threaded Plug Torque" inspection point.
 *
 * The active revision's Section B (Visual Inspection) lists the new point
 * directly below Block-off Plugs. Existing points keep their ids, because saved
 * answers and photos are matched to an item by id.
 */

const test = require('node:test');
const assert = require('node:assert');

const { db, extractPdfText } = require('./helpers/testEnv');
const { applyMigrations } = require('../db/migrations');
const { generateInspectionPdf } = require('../services/pdf');

const FORM_NO = 'PDI-IQI-005';
const NAME = 'Threaded Plug Torque';
const REQUIREMENT = 'Verify all installed threaded plugs are torqued to specification.';

// Section B of Rev B as issued, before this change.
const ORIGINAL_VISUAL = [
  [1, 'Oxidation / Markings'],
  [2, 'Edge Debur'],
  [3, 'Block-off Plugs'],
  [4, 'Heat Tab'],
  [5, 'Casting Quality'],
  [6, 'Finish'],
  [7, 'Machining Quality'],
  [8, 'Material Type'],
  [9, 'Pass-through bore (Cummins)'],
  [10, 'Correct Valves'],
  [11, 'Springs / Retainers / Keepers'],
];

function activeTemplate() {
  const rows = db.all('SELECT * FROM inspection_templates WHERE form_no = ? AND active = 1', [FORM_NO]);
  assert.strictEqual(rows.length, 1, 'exactly one PDI-IQI-005 revision is active');
  return { ...rows[0], sections: JSON.parse(rows[0].sections) };
}

const visualItems = (template) => template.sections.visual.items;

test('the active revision lists Threaded Plug Torque directly below Block-off Plugs', () => {
  const template = activeTemplate();
  assert.strictEqual(template.revision, 'B', 'Rev B is the active revision');

  const items = visualItems(template);
  const names = items.map((it) => it.name);
  const at = names.indexOf(NAME);
  assert.notStrictEqual(at, -1, 'the point is on the form');
  assert.strictEqual(names[at - 1], 'Block-off Plugs', 'it sits directly below Block-off Plugs');
  assert.strictEqual(names[at + 1], 'Heat Tab', 'and directly above Heat Tab');

  assert.deepStrictEqual(items[at], { id: 12, name: NAME, requirement: REQUIREMENT });
});

test('every existing Section B point keeps its id and its order', () => {
  const items = visualItems(activeTemplate()).filter((it) => it.name !== NAME);
  assert.deepStrictEqual(items.map((it) => [it.id, it.name]), ORIGINAL_VISUAL);
});

test('no other Section B point and no other revision is changed', () => {
  const others = db.all('SELECT sections FROM inspection_templates WHERE form_no = ? AND active = 0', [FORM_NO]);
  for (const row of others) {
    assert.ok(!row.sections.includes(NAME), 'inactive revisions are left as issued');
  }
});

test('running the migration again does not add the point twice', () => {
  db.run("DELETE FROM schema_migrations WHERE id = 'iqi_005_threaded_plug_torque'", []);
  applyMigrations(db);
  const matches = visualItems(activeTemplate()).filter((it) => it.name === NAME);
  assert.strictEqual(matches.length, 1);
});

test('the report lists the point below Block-off Plugs and keeps earlier answers on their own points', async () => {
  const template = activeTemplate();
  // An inspection answered before the change: one row per original point.
  const visual = ORIGINAL_VISUAL.map(([id]) => ({ id, status: 'P', finding: '' }));
  visual[3] = { id: 4, status: 'F', finding: 'heat tab missing' };

  const buffer = await generateInspectionPdf(
    { form_no: FORM_NO, part_number: '1234567', po_number: 'PO-1', inspector_name: 'Test User', section_data: { visual } },
    { title: template.title, form_no: FORM_NO, revision: template.revision, sections: { visual: template.sections.visual } }
  );
  const strings = extractPdfText(buffer);
  const text = strings.join(' ');

  const blockOff = text.indexOf('Block-off Plugs');
  const torque = text.indexOf(NAME);
  const heatTab = text.indexOf('Heat Tab');
  assert.ok(blockOff !== -1 && torque !== -1 && heatTab !== -1, 'all three points are reported');
  assert.ok(blockOff < torque && torque < heatTab, 'Threaded Plug Torque is reported between them');

  // The Heat Tab failure is still reported against Heat Tab, not the new point.
  const heatTabRow = text.slice(heatTab, text.indexOf('Casting Quality'));
  assert.ok(heatTabRow.includes('heat tab missing'), 'the Heat Tab finding stays on Heat Tab');
  const torqueRow = text.slice(torque, heatTab);
  assert.ok(!torqueRow.includes('heat tab missing'), 'and is not shown on the new point');
});
