'use strict';
/**
 * API-level authorisation and request validation for /api/injector-tests.
 *
 * The router is mounted on a throwaway express app with the authenticated user
 * injected, which is exactly how index.js wires it (authMiddleware sets
 * req.user before these routes run).
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { db, extractPdfText, resetInjectorData } = require('./helpers/testEnv');
const { benchBatch } = require('./helpers/benchData');
const { errorHandler } = require('../middleware/error');
const injectorRoutes = require('../routes/injector-tests');
const carbonzapp = require('../services/carbonzapp');

const ADMIN = { id: 'u-admin', name: 'Alex Admin', role: 'admin' };
const QC_MANAGER = { id: 'u-qc', name: 'Quinn QC', role: 'qc_manager' };
const INSPECTOR = { id: 'u-insp', name: 'Ivy Inspector', role: 'inspector' };

/** Start the router on an ephemeral port as `user`; returns { url, close }. */
async function serve(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/injector-tests', injectorRoutes);
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

/** Import a small batch of injectors and return their ids. */
async function seedInjectors(count = 4) {
  resetInjectorData();
  carbonzapp.upsertReports(benchBatch(count, { job: 'QMS-500', prefix: 'RT' }));
  return db.all('SELECT id FROM injector_test_reports ORDER BY slot_position', []).map((r) => r.id);
}

// ── Authorisation: admin role only ───────────────────────────────────────────
test('an admin can reach the injector list', async () => {
  await seedInjectors(2);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.injectors.length, 2);
  });
});

test('qc_manager and inspector are refused by every injector route', async () => {
  const ids = await seedInjectors(2);
  const calls = [
    ['GET', '/api/injector-tests', null],
    ['POST', '/api/injector-tests/sync', {}],
    ['POST', '/api/injector-tests/reports/customer', { injector_ids: ids }],
    ['POST', '/api/injector-tests/reports/inspection', { injector_ids: ids }],
    ['POST', '/api/injector-tests/reports/shipment-evaluation', { injector_ids: ids, vendor_name: 'Acme' }],
    ['POST', '/api/injector-tests/report', { injector_ids: ids }],
    ['DELETE', '/api/injector-tests', null],
  ];

  for (const user of [QC_MANAGER, INSPECTOR]) {
    await withUser(user, async (url) => {
      for (const [method, path, body] of calls) {
        const res = await fetch(url + path, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.strictEqual(res.status, 403, `${user.role} ${method} ${path} should be 403`);
      }
    });
  }
});

// ── Shipment evaluation: vendor name ─────────────────────────────────────────
test('the shipment evaluation requires a vendor name', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    for (const body of [{ injector_ids: ids }, { injector_ids: ids, vendor_name: '   ' }]) {
      const res = await fetch(`${url}/api/injector-tests/reports/shipment-evaluation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.strictEqual(res.status, 400);
      const err = await res.json();
      assert.match(err.error, /vendor name is required/i);
      assert.strictEqual(err.code, 'VALIDATION_ERROR');
    }
  });
});

test('the shipment evaluation is generated with the vendor name', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/reports/shipment-evaluation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids, vendor_name: 'Acme Diesel Supply' }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('x-report-filename'), /^ShipmentEvaluation_.*Acme_Diesel_Supply_3\.pdf$/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buffer.subarray(0, 4).toString(), '%PDF');
  });
});

// ── Selection validation ─────────────────────────────────────────────────────
test('report requests without a selection are rejected', async () => {
  await seedInjectors(2);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/reports/customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: [] }),
    });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /at least one injector/i);
  });
});

test('unknown injector ids produce a not-found response, not a broken report', async () => {
  await seedInjectors(2);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/reports/customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ['does-not-exist'] }),
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual((await res.json()).code, 'NOT_FOUND');
  });
});

test('a customer report is streamed as a PDF with a filename header', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/reports/customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids }),
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="InjectorReport_.*\.pdf"/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buffer.subarray(0, 4).toString(), '%PDF');
  });
});

test('a customer report carries the requested vendor in the shared header', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/reports/customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids, vendor_name: 'Acme Diesel Supply' }),
    });
    assert.strictEqual(res.status, 200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = extractPdfText(buffer).join('\n');
    assert.ok(text.includes('Vendor: Acme Diesel Supply'));
    assert.ok(text.includes('Part: 6513589'));
    assert.ok(/Report Date: \d{2}\/\d{2}\/\d{4}/.test(text));
  });
});
