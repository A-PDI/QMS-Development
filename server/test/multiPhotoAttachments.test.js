'use strict';
/**
 * Several photos at one inspection point — /api/attachments.
 *
 * The inspection form uploads each photo of a multi-select or camera session
 * as its own request. Every one must be stored against the same point, none
 * may replace an existing photo, and a failed request must not take the
 * successful ones with it.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const crypto = require('node:crypto');

const { db } = require('./helpers/testEnv');
const { errorHandler } = require('../middleware/error');
const attachmentsRoutes = require('../routes/attachments');

const USER = { id: 'u-photo-insp', name: 'Ivy Inspector', role: 'inspector' };
db.run('INSERT OR IGNORE INTO users (id, name, email, role, active) VALUES (?, ?, ?, ?, 1)',
  [USER.id, USER.name, `${USER.id}@test.local`, USER.role]);

const template = db.get("SELECT id, component_type, form_no FROM inspection_templates WHERE active = 1 LIMIT 1", []);
const INSPECTION = crypto.randomUUID();
db.run(
  `INSERT INTO inspections (id, template_id, component_type, form_no, status, section_data, created_by)
   VALUES (?, ?, ?, ?, 'draft', '{}', ?)`,
  [INSPECTION, template.id, template.component_type, template.form_no, USER.id]
);

// Smallest valid JPEG header + payload; content is irrelevant to the route.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

let base;
let server;
test.before(async () => {
  const app = express();
  app.use((req, res, next) => { req.user = USER; next(); });
  app.use('/api/attachments', attachmentsRoutes);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/attachments`;
});
test.after(() => new Promise(r => server.close(r)));

async function upload(name, { sectionKey = 'dimensional', itemId = '2', withFile = true } = {}) {
  const form = new FormData();
  if (withFile) form.append('file', new Blob([JPEG], { type: 'image/jpeg' }), name);
  form.append('section_key', sectionKey);
  form.append('item_id', itemId);
  const res = await fetch(`${base}/${INSPECTION}`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

async function list() {
  const res = await fetch(`${base}/${INSPECTION}`);
  return (await res.json()).attachments;
}

test('five photos uploaded for one point are all kept against that point', async () => {
  const existing = await upload('existing.jpg');
  assert.strictEqual(existing.status, 201);

  for (let i = 1; i <= 5; i++) {
    const r = await upload(`IMG_000${i}.jpg`);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  }
  const atPoint = (await list()).filter(a => a.section_key === 'dimensional' && a.item_id === '2');
  assert.deepStrictEqual(atPoint.map(a => a.file_name),
    ['existing.jpg', 'IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg', 'IMG_0004.jpg', 'IMG_0005.jpg'],
    'the existing photo is kept and the new ones follow it in capture order');
  assert.strictEqual(new Set(atPoint.map(a => a.id)).size, 6, 'every photo is its own attachment');
});

test('a failed upload in the middle of a batch does not lose the others', async () => {
  const before = (await list()).length;
  const first = await upload('batch-1.jpg', { itemId: '7' });
  const broken = await upload('batch-2.jpg', { itemId: '7', withFile: false });
  const third = await upload('batch-3.jpg', { itemId: '7' });
  assert.strictEqual(first.status, 201);
  assert.strictEqual(broken.status, 400);
  assert.strictEqual(third.status, 201);
  const after = await list();
  assert.strictEqual(after.length, before + 2);
  assert.deepStrictEqual(after.filter(a => a.item_id === '7').map(a => a.file_name), ['batch-1.jpg', 'batch-3.jpg']);
});

test('photos for another item of a multi-item inspection stay separate', async () => {
  await upload('item2.jpg', { sectionKey: 'item1__dimensional', itemId: '2' });
  const all = await list();
  assert.strictEqual(all.filter(a => a.section_key === 'item1__dimensional').length, 1);
  assert.strictEqual(all.filter(a => a.section_key === 'dimensional' && a.item_id === '2').length, 6);
});

test('removing one photo leaves the rest of the point\'s photos', async () => {
  const atPoint = (await list()).filter(a => a.section_key === 'dimensional' && a.item_id === '2');
  db.run('UPDATE inspection_attachments SET uploaded_by = ? WHERE id = ?', [USER.id, atPoint[2].id]);
  const res = await fetch(`${base}/${atPoint[2].id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);
  const remaining = (await list()).filter(a => a.section_key === 'dimensional' && a.item_id === '2');
  assert.strictEqual(remaining.length, 5);
  assert.ok(!remaining.some(a => a.id === atPoint[2].id));
});
