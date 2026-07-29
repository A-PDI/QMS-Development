'use strict';
/**
 * Admin "Reopen Inspection" action — POST /api/inspections/:id/reopen.
 *
 * Covers who may reopen a completed and closed report, which statuses can be
 * reopened, the mandatory reason, and what the reopen does (and does not do) to
 * the stored record.
 *
 * The router runs on a throwaway express app with the authenticated user
 * injected, which is how index.js wires it (authMiddleware sets req.user before
 * these routes run).
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const crypto = require('node:crypto');

const { db } = require('./helpers/testEnv');
const { errorHandler } = require('../middleware/error');
const inspectionsRoutes = require('../routes/inspections');

const ADMIN = { id: 'u-admin', name: 'Alex Admin', role: 'admin' };
const QC_MANAGER = { id: 'u-qc', name: 'Quinn QC', role: 'qc_manager' };
const INSPECTOR = { id: 'u-insp', name: 'Ivy Inspector', role: 'inspector' };

// Foreign keys are on, so the actors have to be real rows before anything can
// reference them (quality_alerts.triggered_by, for one).
for (const user of [ADMIN, QC_MANAGER, INSPECTOR]) {
  db.run(
    'INSERT OR IGNORE INTO users (id, name, email, role, active) VALUES (?, ?, ?, ?, 1)',
    [user.id, user.name, `${user.id}@test.local`, user.role]
  );
}

/** Start the router on an ephemeral port as `user`; returns { url, close }. */
async function serve(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/inspections', inspectionsRoutes);
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
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

function reopen(url, id, body) {
  return fetch(`${url}/api/inspections/${id}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

const SECTION_DATA = { receiving: { 1: 'P' }, __disposition: 'PASS' };

/** Insert an inspection in the given status and return its id. */
function makeInspection(status = 'complete', overrides = {}) {
  const template = db.get('SELECT id, component_type, form_no FROM inspection_templates LIMIT 1', []);
  assert.ok(template, 'the seeded test database has at least one template');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO inspections
       (id, template_id, component_type, form_no, part_number, inspector_name,
        disposition, section_data, status, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, template.id, template.component_type, template.form_no,
      overrides.part_number || 'PN-REOPEN-1', 'Test User',
      overrides.disposition === undefined ? 'PASS' : overrides.disposition,
      JSON.stringify(SECTION_DATA), status,
      overrides.completed_at === undefined ? now : overrides.completed_at,
      now, now,
    ]
  );
  return id;
}

function getInspection(id) {
  return db.get('SELECT * FROM inspections WHERE id = ?', [id]);
}

function activityFor(id) {
  return db.all(
    'SELECT action_type, actor_name, actor_id, notes FROM inspection_activity_log WHERE inspection_id = ? ORDER BY created_at DESC',
    [id]
  );
}

// ── Happy path ───────────────────────────────────────────────────────────────

test('an admin reopens a completed inspection back to the editable draft state', async () => {
  const id = makeInspection('complete');
  await withUser(ADMIN, async (url) => {
    const res = await reopen(url, id, { reason: 'Measurements logged against the wrong lot' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.inspection.status, 'draft');
    assert.strictEqual(body.inspection.completed_at, null);
  });

  const row = getInspection(id);
  assert.strictEqual(row.status, 'draft');
  assert.strictEqual(row.completed_at, null);
});

test('reopening keeps the recorded inspection data and disposition', async () => {
  const id = makeInspection('complete');
  await withUser(ADMIN, async (url) => {
    const res = await reopen(url, id, { reason: 'Re-check surface finish' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    // section_data comes back parsed, exactly as the other inspection routes return it.
    assert.deepStrictEqual(body.inspection.section_data, SECTION_DATA);
    assert.strictEqual(body.inspection.disposition, 'PASS');
  });

  const row = getInspection(id);
  assert.deepStrictEqual(JSON.parse(row.section_data), SECTION_DATA);
  assert.strictEqual(row.disposition, 'PASS');
});

test('the reopen is recorded in the activity log with its reason and actor', async () => {
  const id = makeInspection('complete');
  await withUser(ADMIN, async (url) => {
    const res = await reopen(url, id, { reason: '  Wrong PO number on the header  ' });
    assert.strictEqual(res.status, 200);
  });

  const entries = activityFor(id);
  const entry = entries.find((e) => e.action_type === 'reopened');
  assert.ok(entry, 'a "reopened" entry is logged');
  assert.strictEqual(entry.notes, 'Wrong PO number on the header', 'the reason is trimmed and stored');
  assert.strictEqual(entry.actor_name, ADMIN.name);
  assert.strictEqual(entry.actor_id, ADMIN.id);
});

test('a qc_manager may also reopen — same roles as the other admin actions', async () => {
  const id = makeInspection('complete');
  await withUser(QC_MANAGER, async (url) => {
    const res = await reopen(url, id, { reason: 'Supplier submitted a corrected cert' });
    assert.strictEqual(res.status, 200);
  });
  assert.strictEqual(getInspection(id).status, 'draft');
});

test('legacy closed statuses can be reopened too', async () => {
  for (const status of ['submitted', 'approved', 'rejected']) {
    const id = makeInspection(status);
    await withUser(ADMIN, async (url) => {
      const res = await reopen(url, id, { reason: `Reopening a ${status} record` });
      assert.strictEqual(res.status, 200, `${status} should be reopenable`);
    });
    assert.strictEqual(getInspection(id).status, 'draft');
  }
});

// ── Reopen → complete again ──────────────────────────────────────────────────

test('a reopened inspection can be completed again', async () => {
  const id = makeInspection('complete');
  await withUser(ADMIN, async (url) => {
    assert.strictEqual((await reopen(url, id, { reason: 'Correcting the lot number' })).status, 200);
    const res = await fetch(`${url}/api/inspections/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.inspection.status, 'complete');
    assert.ok(body.inspection.completed_at, 'a fresh completion stamp is set');
  });
});

test('completing a reopened failure reuses its open quality alert', async () => {
  const id = makeInspection('complete', { disposition: 'fail' });
  const alerts = () => db.all(
    "SELECT id, acknowledged_at FROM quality_alerts WHERE inspection_id = ?", [id]
  );

  await withUser(ADMIN, async (url) => {
    const complete = () => fetch(`${url}/api/inspections/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual((await reopen(url, id, { reason: 'Re-measure the bore' })).status, 200);
    assert.strictEqual((await complete()).status, 200);
    assert.strictEqual(alerts().length, 1, 'the failure raises one alert');

    // Reopen and complete again — the still-unacknowledged alert is reused.
    assert.strictEqual((await reopen(url, id, { reason: 'Second look' })).status, 200);
    assert.strictEqual((await complete()).status, 200);
    assert.strictEqual(alerts().length, 1, 'no duplicate alert while the first is unacknowledged');

    // Once the alert is acknowledged, a later failure raises a new one.
    db.run("UPDATE quality_alerts SET acknowledged_at = ? WHERE inspection_id = ?", [new Date().toISOString(), id]);
    assert.strictEqual((await reopen(url, id, { reason: 'Third look' })).status, 200);
    assert.strictEqual((await complete()).status, 200);
    assert.strictEqual(alerts().length, 2, 'a closed-out alert does not suppress the next one');
  });
});

// ── Authorisation ────────────────────────────────────────────────────────────

test('an inspector cannot reopen a closed inspection', async () => {
  const id = makeInspection('complete');
  await withUser(INSPECTOR, async (url) => {
    const res = await reopen(url, id, { reason: 'I would like to edit this' });
    assert.strictEqual(res.status, 403);
  });
  assert.strictEqual(getInspection(id).status, 'complete', 'the record stays closed');
});

// ── Validation ───────────────────────────────────────────────────────────────

test('an inspection that is not closed cannot be reopened', async () => {
  for (const status of ['draft', 'partially_complete', 'pending_review']) {
    const id = makeInspection(status, { completed_at: null });
    await withUser(ADMIN, async (url) => {
      const res = await reopen(url, id, { reason: 'Not applicable' });
      assert.strictEqual(res.status, 400, `${status} is not a closed status`);
    });
    assert.strictEqual(getInspection(id).status, status, 'the status is untouched');
  }
});

test('a reason is required, and a blank one leaves the inspection closed', async () => {
  const id = makeInspection('complete');
  await withUser(ADMIN, async (url) => {
    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: null }]) {
      const res = await reopen(url, id, body);
      assert.strictEqual(res.status, 400, `${JSON.stringify(body)} should be rejected`);
    }
  });
  assert.strictEqual(getInspection(id).status, 'complete');
  assert.strictEqual(activityFor(id).length, 0, 'nothing is logged for a rejected reopen');
});

test('an over-long reason is rejected', async () => {
  const id = makeInspection('complete');
  await withUser(ADMIN, async (url) => {
    const res = await reopen(url, id, { reason: 'x'.repeat(501) });
    assert.strictEqual(res.status, 400);
  });
  assert.strictEqual(getInspection(id).status, 'complete');
});

test('reopening an unknown inspection is a 404', async () => {
  await withUser(ADMIN, async (url) => {
    const res = await reopen(url, `no-such-inspection-${crypto.randomUUID()}`, { reason: 'Missing' });
    assert.strictEqual(res.status, 404);
  });
});
