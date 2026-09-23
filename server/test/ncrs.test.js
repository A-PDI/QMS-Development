'use strict';
/**
 * NCR reports — /api/ncrs.
 *
 * Covers the NCR fields (create / edit), captioned photo uploads, the
 * user-created section layout, the finished PDF, and admin-only deletion
 * (which also removes the photos from disk).
 *
 * The router runs on a throwaway express app with the authenticated user
 * injected, which is how index.js wires it.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('fs');
const path = require('path');

const { db, extractPdfText } = require('./helpers/testEnv');
const { errorHandler } = require('../middleware/error');
const ncrsRoutes = require('../routes/ncrs');
const { pdfSafe, ncrPdfFilename } = require('../services/ncrPdf');

const ADMIN = { id: 'u-ncr-admin', name: 'Alex Admin', role: 'admin' };
const QC_MANAGER = { id: 'u-ncr-qc', name: 'Quinn QC', role: 'qc_manager' };
const INSPECTOR = { id: 'u-ncr-insp', name: 'Ivy Inspector', role: 'inspector' };

for (const user of [ADMIN, QC_MANAGER, INSPECTOR]) {
  db.run(
    'INSERT OR IGNORE INTO users (id, name, email, role, active) VALUES (?, ?, ?, ?, 1)',
    [user.id, user.name, `${user.id}@test.local`, user.role]
  );
}

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAADAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDCooorzj7E/9k=',
  'base64'
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const NCR_UPLOADS = path.join(process.env.UPLOAD_DIR, 'ncrs');

/** Start the router on an ephemeral port as `user`; returns { url, close }. */
async function serve(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/ncrs', ncrsRoutes);
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api/ncrs`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withUser(user, fn) {
  const s = await serve(user);
  try {
    return await fn(s.url);
  } finally {
    await s.close();
  }
}

async function json(res) {
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function sendJson(url, method, body) {
  return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);
}

function upload(url, id, bytes, { name = 'photo.jpg', type = 'image/jpeg', caption } = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  if (caption !== undefined) form.append('caption', caption);
  return fetch(`${url}/${id}/images`, { method: 'POST', body: form }).then(json);
}

async function createNcr(url, extra = {}) {
  const res = await sendJson(url, 'POST', { description_of_defect: 'Skirt diameter oversize', ...extra });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  return res.body.ncr;
}

function filesIn(ncrId) {
  const dir = path.join(NCR_UPLOADS, ncrId);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

// ── NCR fields ───────────────────────────────────────────────────────────────

test('create and edit accept the values the NCR form sends', async () => {
  await withUser(INSPECTOR, async (url) => {
    const ncr = await createNcr(url, {
      part_number: ' 3803567 ', quantity_affected: '', corrective_action_required: true,
      severity: 'critical', ncr_disposition: 'pending', status: 'open',
    });
    assert.strictEqual(ncr.part_number, '3803567');
    assert.strictEqual(ncr.quantity_affected, null);
    assert.strictEqual(ncr.corrective_action_required, 1);
    assert.deepStrictEqual(ncr.sections, []);
    assert.deepStrictEqual(ncr.photos, []);

    // The edit form sends booleans and numeric strings — this used to fail
    // because node:sqlite cannot bind a boolean.
    const res = await sendJson(`${url}/${ncr.id}`, 'PATCH', {
      corrective_action_required: false, quantity_affected: '12', status: 'closed',
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ncr.corrective_action_required, 0);
    assert.strictEqual(res.body.ncr.quantity_affected, 12);
    assert.ok(res.body.ncr.closed_at, 'closing stamps closed_at');

    const reopened = await sendJson(`${url}/${ncr.id}`, 'PATCH', { status: 'open' });
    assert.strictEqual(reopened.body.ncr.closed_at, null, 'reopening clears closed_at');
  });
});

test('invalid NCR field values are rejected', async () => {
  await withUser(INSPECTOR, async (url) => {
    const ncr = await createNcr(url);
    assert.strictEqual((await sendJson(`${url}/${ncr.id}`, 'PATCH', { status: 'done' })).status, 400);
    assert.strictEqual((await sendJson(`${url}/${ncr.id}`, 'PATCH', { quantity_affected: '2.5' })).status, 400);
    assert.strictEqual((await sendJson(`${url}/${ncr.id}`, 'PATCH', { description_of_defect: '  ' })).status, 400);
    assert.strictEqual((await sendJson(url, 'POST', { description_of_defect: '' })).status, 400);
  });
});

// ── Photos ───────────────────────────────────────────────────────────────────

test('JPEG and PNG photos upload with a caption and can be viewed', async () => {
  await withUser(INSPECTOR, async (url) => {
    const ncr = await createNcr(url);
    const jpg = await upload(url, ncr.id, JPEG, { caption: 'Scored skirt' });
    assert.strictEqual(jpg.status, 201, JSON.stringify(jpg.body));
    assert.strictEqual(jpg.body.image.caption, 'Scored skirt');
    assert.strictEqual(jpg.body.image.mime_type, 'image/jpeg');
    assert.strictEqual(jpg.body.image.file_path, undefined, 'the server path is never exposed');

    // The stored type comes from the file's bytes, not the browser's claim.
    const png = await upload(url, ncr.id, PNG, { name: 'screen.png', type: 'application/octet-stream' });
    assert.strictEqual(png.status, 201);
    assert.strictEqual(png.body.image.mime_type, 'image/png');

    const view = await fetch(`${url}/images/${jpg.body.image.id}`);
    assert.strictEqual(view.status, 200);
    assert.strictEqual(view.headers.get('content-type'), 'image/jpeg');
    assert.ok(Buffer.from(await view.arrayBuffer()).equals(JPEG));

    const detail = await json(await fetch(`${url}/${ncr.id}`));
    assert.deepStrictEqual(detail.body.ncr.photos.map((p) => p.id), [jpg.body.image.id, png.body.image.id]);
  });
});

test('files that are not JPEG or PNG are refused and not kept', async () => {
  await withUser(INSPECTOR, async (url) => {
    const ncr = await createNcr(url);
    const res = await upload(url, ncr.id, Buffer.from('GIF89a-not-a-supported-photo'), { name: 'fake.jpg' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'INVALID_FILE_TYPE');
    assert.deepStrictEqual(filesIn(ncr.id), []);

    const missing = await upload(url, '00000000-0000-4000-8000-000000000000', JPEG);
    assert.strictEqual(missing.status, 404);
    assert.ok(!fs.existsSync(path.join(NCR_UPLOADS, '00000000-0000-4000-8000-000000000000')));
  });
});

// ── Sections ─────────────────────────────────────────────────────────────────

test('sections save with text, ordered captioned photos, and can be reordered or removed', async () => {
  await withUser(INSPECTOR, async (url) => {
    const ncr = await createNcr(url);
    const a = (await upload(url, ncr.id, JPEG)).body.image;
    const b = (await upload(url, ncr.id, PNG, { name: 'b.png', type: 'image/png' })).body.image;
    const c = (await upload(url, ncr.id, JPEG)).body.image;

    const saved = await sendJson(`${url}/${ncr.id}/content`, 'PUT', {
      sections: [
        { title: 'Root Cause', body: 'Worn tool at OP-40', images: [{ id: b.id, caption: 'Tool wear' }, { id: a.id, caption: 'Chip' }] },
        { title: 'Corrective Action', body: 'Replace tooling', images: [] },
      ],
      photos: [{ id: c.id, caption: 'As received' }],
    });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const [rootCause, action] = saved.body.sections;
    assert.strictEqual(rootCause.title, 'Root Cause');
    assert.strictEqual(rootCause.body, 'Worn tool at OP-40');
    assert.deepStrictEqual(rootCause.images.map((i) => [i.id, i.caption]), [[b.id, 'Tool wear'], [a.id, 'Chip']]);
    assert.strictEqual(action.title, 'Corrective Action');
    assert.deepStrictEqual(saved.body.photos.map((p) => [p.id, p.caption]), [[c.id, 'As received']]);

    // Swap the section order, move a photo between blocks, drop a section.
    const second = await sendJson(`${url}/${ncr.id}/content`, 'PUT', {
      sections: [
        { id: action.id, title: 'Corrective Action', body: 'Replace tooling', images: [{ id: c.id, caption: 'After fix' }] },
      ],
      photos: [{ id: b.id, caption: 'Tool wear' }],
      removed_image_ids: [a.id],
    });
    assert.strictEqual(second.status, 200, JSON.stringify(second.body));
    assert.deepStrictEqual(second.body.sections.map((s) => s.id), [action.id]);
    assert.deepStrictEqual(second.body.sections[0].images.map((i) => i.id), [c.id]);
    assert.deepStrictEqual(second.body.photos.map((p) => p.id), [b.id]);
    assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM ncr_sections WHERE id = ?', [rootCause.id]).n, 0);
    assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM ncr_images WHERE id = ?', [a.id]).n, 0);
    assert.strictEqual(filesIn(ncr.id).length, 2, 'the removed photo is deleted from disk');
  });
});

test('photos a save does not mention are kept, not deleted', async () => {
  await withUser(INSPECTOR, async (url) => {
    const ncr = await createNcr(url);
    const known = (await upload(url, ncr.id, JPEG)).body.image;
    const other = (await upload(url, ncr.id, JPEG)).body.image; // e.g. added by a colleague meanwhile
    const res = await sendJson(`${url}/${ncr.id}/content`, 'PUT', {
      sections: [{ title: 'Evidence', body: '', images: [{ id: known.id, caption: '' }] }],
      photos: [],
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.photos.map((p) => p.id), [other.id]);
  });
});

test('invalid section layouts are rejected without changing anything', async () => {
  await withUser(INSPECTOR, async (url) => {
    const ncr = await createNcr(url);
    const otherNcr = await createNcr(url);
    const mine = (await upload(url, ncr.id, JPEG)).body.image;
    const theirs = (await upload(url, otherNcr.id, JPEG)).body.image;
    const put = (body) => sendJson(`${url}/${ncr.id}/content`, 'PUT', body);

    assert.strictEqual((await put({ sections: [{ title: '  ', body: 'x' }] })).status, 400, 'a section needs a title');
    assert.strictEqual((await put({ photos: [{ id: theirs.id }] })).status, 400, "another NCR's photo");
    assert.strictEqual((await put({ photos: [{ id: mine.id }], removed_image_ids: [mine.id] })).status, 400, 'used twice');
    assert.strictEqual((await put({ sections: [{ id: 'not-a-section', title: 'x' }] })).status, 400);
    assert.strictEqual((await put({ sections: 'nope' })).status, 400);

    const unchanged = await json(await fetch(`${url}/${ncr.id}`));
    assert.deepStrictEqual(unchanged.body.ncr.sections, []);
    assert.deepStrictEqual(unchanged.body.ncr.photos.map((p) => p.id), [mine.id]);
  });
});

// ── PDF ──────────────────────────────────────────────────────────────────────

test('the PDF shows the NCR, its photos with captions and every section in order', async () => {
  await withUser(INSPECTOR, async (url) => {
    const ncr = await createNcr(url, { part_number: '3803567', supplier: 'Acme Castings', severity: 'critical' });
    const photo = (await upload(url, ncr.id, JPEG, { caption: 'Lot as received' })).body.image;
    const detail = (await upload(url, ncr.id, PNG, { name: 'd.png', type: 'image/png' })).body.image;
    await sendJson(`${url}/${ncr.id}/content`, 'PUT', {
      photos: [{ id: photo.id, caption: 'Lot as received' }],
      sections: [
        { title: 'Root Cause', body: 'Worn finishing tool ≤ spec life', images: [{ id: detail.id, caption: 'Tool edge' }] },
        { title: 'Containment', body: 'All stock quarantined', images: [] },
      ],
    });

    const res = await fetch(`${url}/${ncr.id}/pdf`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    assert.ok(res.headers.get('content-disposition').includes(`${ncr.ncr_number}_3803567.pdf`));

    const text = extractPdfText(Buffer.from(await res.arrayBuffer())).join(' ');
    for (const expected of [
      'NON-CONFORMANCE REPORT', ncr.ncr_number, 'Acme Castings', 'Critical', 'Skirt diameter oversize',
      'PHOTOS', 'Figure 1', 'Lot as received', 'ROOT CAUSE', 'Worn finishing tool <= spec life',
      'Figure 2', 'Tool edge', 'CONTAINMENT', 'All stock quarantined',
    ]) {
      assert.ok(text.includes(expected), `PDF shows "${expected}"`);
    }
    const order = ['DESCRIPTION OF DEFECT', 'PHOTOS', 'ROOT CAUSE', 'CONTAINMENT'].map((t) => text.indexOf(t));
    assert.deepStrictEqual([...order].sort((x, y) => x - y), order, 'sections print in report order');
  });
});

test('PDF text is limited to characters the report font can print', () => {
  assert.strictEqual(pdfSafe('0.5 ≤ x ≥ 0.2 ✓'), '0.5 <= x >= 0.2 OK');
  assert.strictEqual(pdfSafe('Ø 25 ±0.01 °C “ok” — done'), 'Ø 25 ±0.01 °C “ok” — done');
  assert.strictEqual(pdfSafe('crack 😀 found'), 'crack ? found');
  assert.strictEqual(pdfSafe('a\r\nb\tc'), 'a\nb    c');
});

test('the PDF filename carries the NCR and part numbers', () => {
  assert.strictEqual(ncrPdfFilename({ ncr_number: 'NCR-0007', part_number: '38/03 567' }), 'NCR-0007_38_03_567.pdf');
  assert.strictEqual(ncrPdfFilename({ ncr_number: 'NCR-0007' }), 'NCR-0007.pdf');
});

// ── Delete ───────────────────────────────────────────────────────────────────

test('only admin-level users can delete an NCR', async () => {
  const ncr = await withUser(INSPECTOR, (url) => createNcr(url));
  const denied = await withUser(INSPECTOR, (url) => fetch(`${url}/${ncr.id}`, { method: 'DELETE' }).then(json));
  assert.strictEqual(denied.status, 403);
  assert.ok(db.get('SELECT id FROM ncrs WHERE id = ?', [ncr.id]), 'the NCR is still there');

  const allowed = await withUser(QC_MANAGER, (url) => fetch(`${url}/${ncr.id}`, { method: 'DELETE' }).then(json));
  assert.strictEqual(allowed.status, 200);
  assert.strictEqual(db.get('SELECT id FROM ncrs WHERE id = ?', [ncr.id]), undefined);

  const gone = await withUser(ADMIN, (url) => fetch(`${url}/${ncr.id}`, { method: 'DELETE' }).then(json));
  assert.strictEqual(gone.status, 404);
});

test('deleting an NCR removes its sections, photos and files', async () => {
  const ncr = await withUser(INSPECTOR, async (url) => {
    const created = await createNcr(url);
    const img = (await upload(url, created.id, JPEG)).body.image;
    await sendJson(`${url}/${created.id}/content`, 'PUT', {
      sections: [{ title: 'Root Cause', body: 'x', images: [{ id: img.id, caption: 'y' }] }],
    });
    return created;
  });
  assert.strictEqual(filesIn(ncr.id).length, 1);

  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/${ncr.id}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
  });
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM ncr_sections WHERE ncr_id = ?', [ncr.id]).n, 0);
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM ncr_images WHERE ncr_id = ?', [ncr.id]).n, 0);
  assert.ok(!fs.existsSync(path.join(NCR_UPLOADS, ncr.id)), 'the photo folder is removed');
});
