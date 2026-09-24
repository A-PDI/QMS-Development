'use strict';
/**
 * GET /api/inspections?exclude_disposition= — used by the NCR "Link to
 * Inspection" picker so passed inspections are not offered.
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

async function list(query) {
  const app = express();
  app.use((req, res, next) => { req.user = USER; next(); });
  app.use('/api/inspections', inspectionsRoutes);
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/inspections?${new URLSearchParams(query)}`);
    assert.strictEqual(res.status, 200);
    return res.json();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
