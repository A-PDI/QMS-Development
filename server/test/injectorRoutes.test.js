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

const { db, extractPdfText, resetInjectorData, injectorInspectionCount } = require('./helpers/testEnv');
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
  carbonzapp.upsertReports(benchBatch(count, { job: 'Production', prefix: 'XT' }));
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
    ['POST', '/api/injector-tests/reports/preview', { injector_ids: ids }],
    ['POST', '/api/injector-tests/reports/custom', { injector_ids: ids }],
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
    const res = await fetch(`${url}/api/injector-tests/reports/custom`, {
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
    const res = await fetch(`${url}/api/injector-tests/reports/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ['does-not-exist'] }),
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual((await res.json()).code, 'NOT_FOUND');
  });
});

test('report preview returns JSON and creates no PDF or inspection', async () => {
  const ids = await seedInjectors(3);
  const before = injectorInspectionCount();
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/reports/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids }),
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.strictEqual(res.headers.get('content-disposition'), null);
    const body = await res.json();
    assert.strictEqual(body.preview.title, 'Custom Report Preview');
    assert.strictEqual(body.preview.injectors.length, 3);
    assert.ok(body.preview.rows.length > 0);
  });
  assert.strictEqual(injectorInspectionCount(), before);
});

test('a custom report is streamed as a PDF with a filename header', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/reports/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids }),
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="CustomReport_.*\.pdf"/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buffer.subarray(0, 4).toString(), '%PDF');
  });
});

test('the injector list is newest-first, contains no job field and supports all filters', async () => {
  const ids = await seedInjectors(4);
  db.run('UPDATE injector_test_reports SET test_datetime = ?, part_number = ?, serial_number = ?, overall_pass = ?, result_status = ? WHERE id = ?',
    ['2026-08-01T10:00:00Z', 'PN-A100', 'SER-A', 1, 'pass', ids[0]]);
  db.run('UPDATE injector_test_reports SET test_datetime = ?, part_number = ?, serial_number = ?, overall_pass = ?, result_status = ? WHERE id = ?',
    ['2026-08-04T10:00:00Z', 'PN-B200', 'SER-B', 0, 'fail', ids[1]]);
  db.run('UPDATE injector_test_reports SET test_datetime = ?, part_number = ?, serial_number = ?, overall_pass = ?, result_status = ? WHERE id = ?',
    ['2026-08-03T10:00:00Z', 'PN-A300', 'SER-C', 1, 'pass', ids[2]]);
  db.run('UPDATE injector_test_reports SET test_datetime = ?, part_number = ?, serial_number = ?, overall_pass = ?, result_status = ? WHERE id = ?',
    ['2026-08-02T10:00:00Z', 'PN-C400', 'SER-D', null, 'dnf', ids[3]]);

  await withUser(ADMIN, async (url) => {
    const all = await (await fetch(`${url}/api/injector-tests`)).json();
    assert.deepStrictEqual(all.injectors.map((row) => row.serial_number), ['SER-B', 'SER-C', 'SER-D', 'SER-A']);
    assert.ok(all.injectors.every((row) => !Object.hasOwn(row, 'job_number')));

    const part = await (await fetch(`${url}/api/injector-tests?part_number=PN-A`)).json();
    assert.deepStrictEqual(part.injectors.map((row) => row.serial_number), ['SER-C', 'SER-A']);

    const serial = await (await fetch(`${url}/api/injector-tests?serial_number=SER-B`)).json();
    assert.deepStrictEqual(serial.injectors.map((row) => row.serial_number), ['SER-B']);

    const passed = await (await fetch(`${url}/api/injector-tests?status=pass`)).json();
    assert.deepStrictEqual(passed.injectors.map((row) => row.serial_number), ['SER-C', 'SER-A']);

    const failed = await (await fetch(`${url}/api/injector-tests?status=fail`)).json();
    assert.deepStrictEqual(failed.injectors.map((row) => row.serial_number), ['SER-B']);

    const dnf = await (await fetch(`${url}/api/injector-tests?status=dnf`)).json();
    assert.deepStrictEqual(dnf.injectors.map((row) => row.serial_number), ['SER-D']);

    const dateRange = await (await fetch(`${url}/api/injector-tests?date_from=2026-08-02&date_to=2026-08-03`)).json();
    assert.deepStrictEqual(dateRange.injectors.map((row) => row.serial_number), ['SER-C', 'SER-D']);
  });
});

test('a custom report carries the requested vendor in the shared header', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/reports/custom`, {
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

// ── Granular filtering ───────────────────────────────────────────────────────
/**
 * Six injectors of two part numbers: SN002 and SN004 fail Peak Torque -
 * Return, SN005 fails Peak HP, the rest pass.
 */
async function seedForFiltering() {
  resetInjectorData();
  carbonzapp.upsertReports(benchBatch(4, {
    job: 'Production', prefix: 'SN', part: '6513589PX',
    customise: (i) => (i === 1 || i === 3 ? { flow: { IVM06_RETURN: 120 } } : {}),
  }));
  carbonzapp.upsertReports(benchBatch(2, {
    job: 'Production', prefix: 'ZZ', part: '0445120067', idPrefix: 'rep-ZZ',
    customise: (i) => (i === 0 ? { flow: { IVM01: 40 } } : {}),
  }));
}

const serialsOf = (body) => body.injectors.map((row) => row.serial_number).sort();

test('the list filters on several part numbers and several serial numbers', async () => {
  await seedForFiltering();
  await withUser(ADMIN, async (url) => {
    const get = async (query) => (await fetch(`${url}/api/injector-tests${query}`)).json();

    const all = await get('');
    assert.strictEqual(all.injectors.length, 6);
    assert.strictEqual(all.total, 6);

    const onePart = await get('?part_number=0445120067');
    assert.deepStrictEqual(serialsOf(onePart), ['ZZ001', 'ZZ002']);

    const twoParts = await get('?part_number=6513589PX,0445120067');
    assert.strictEqual(twoParts.injectors.length, 6);
    assert.strictEqual(twoParts.total, 6, 'the unfiltered total is reported alongside the matches');

    const twoSerials = await get('?serial_number=SN002%20ZZ001');
    assert.deepStrictEqual(serialsOf(twoSerials), ['SN002', 'ZZ001']);

    const combined = await get('?part_number=6513589PX&serial_number=SN002,ZZ001');
    assert.deepStrictEqual(serialsOf(combined), ['SN002'], 'part and serial filters intersect');
  });
});

test('the list filters on which test step an injector failed or passed', async () => {
  await seedForFiltering();
  await withUser(ADMIN, async (url) => {
    const get = async (query) => (await fetch(`${url}/api/injector-tests${query}`)).json();

    const failedReturn = await get('?steps=IVM06-R&step_status=fail');
    assert.deepStrictEqual(serialsOf(failedReturn), ['SN002', 'SN004']);
    assert.deepStrictEqual(
      failedReturn.injectors[0].matched_steps, ['Peak Torque - Return'],
      'each row says which step put it in the list'
    );

    const failedPeakHp = await get('?steps=IVM01&step_status=fail');
    assert.deepStrictEqual(serialsOf(failedPeakHp), ['ZZ001']);

    const eitherStep = await get('?steps=IVM01,IVM06-R&step_status=fail');
    assert.deepStrictEqual(serialsOf(eitherStep), ['SN002', 'SN004', 'ZZ001']);

    const bothSteps = await get('?steps=IVM01,IVM06-R&step_status=fail&step_match=all');
    assert.deepStrictEqual(serialsOf(bothSteps), [], 'no injector failed both points');

    const passedReturn = await get('?steps=IVM06-R&step_status=pass');
    assert.deepStrictEqual(serialsOf(passedReturn), ['SN001', 'SN003', 'ZZ001', 'ZZ002']);

    const scoped = await get('?part_number=6513589PX&steps=IVM06-R&step_status=fail');
    assert.deepStrictEqual(serialsOf(scoped), ['SN002', 'SN004']);
  });
});

test('rows carry no step filter noise when no step filter was asked for', async () => {
  await seedForFiltering();
  await withUser(ADMIN, async (url) => {
    const body = await (await fetch(`${url}/api/injector-tests`)).json();
    assert.ok(body.injectors.every((row) => !Object.hasOwn(row, 'matched_steps')));
    assert.ok(body.injectors.every((row) => !Object.hasOwn(row, 'report_json')), 'the raw bench JSON never leaves the server');
    assert.ok(body.injectors.every((row) => !Object.hasOwn(row, 'tests')));
  });
});

test('the step catalog lists the points in the synced data with their counts', async () => {
  await seedForFiltering();
  await withUser(ADMIN, async (url) => {
    const body = await (await fetch(`${url}/api/injector-tests/steps`)).json();
    assert.deepStrictEqual(body.steps.map((s) => s.code), ['IVM01', 'IVM06-D', 'IVM06-R']);
    assert.deepStrictEqual(body.steps.map((s) => s.label),
      ['Peak HP', 'Peak Torque - Delivery', 'Peak Torque - Return']);

    const byCode = Object.fromEntries(body.steps.map((s) => [s.code, s]));
    assert.strictEqual(byCode['IVM06-R'].fail, 2);
    assert.strictEqual(byCode.IVM01.fail, 1);
    assert.strictEqual(byCode.IVM01.total, 6);
    assert.strictEqual(body.injectorCount, 6);
  });
});

// ── Export ───────────────────────────────────────────────────────────────────
test('the selected injectors export as an Excel workbook', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/export/xlsx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids }),
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml\.sheet/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="InjectorTestResults_.*_3\.xlsx"/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buffer.subarray(0, 2).toString(), 'PK', 'an xlsx file is a zip archive');
  });
});

test('the selected injectors export as a PDF listing', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('x-report-filename'), /^InjectorTestResults_.*_3\.pdf$/);
    const text = extractPdfText(Buffer.from(await res.arrayBuffer())).join(' ');
    assert.match(text, /Injector Test Results/);
    assert.match(text, /XT001/, 'every selected serial is listed');
  });
});

test('an export can be driven by the filters instead of by a list of ids', async () => {
  await seedForFiltering();
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: { steps: 'IVM06-R', step_status: 'fail' } }),
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('x-report-filename'), /_2\.pdf$/, 'only the two failing injectors are exported');

    const text = extractPdfText(Buffer.from(await res.arrayBuffer())).join(' ');
    assert.match(text, /failed Peak Torque - Return/, 'the export records the filter that produced it');
    assert.match(text, /SN002/);
    assert.match(text, /SN004/);
    assert.ok(!text.includes('SN001'), 'a passing injector is not in a failures export');
  });
});

test('an export with neither a selection nor a filter is refused', async () => {
  await seedInjectors(2);
  await withUser(ADMIN, async (url) => {
    for (const path of ['/api/injector-tests/export/xlsx', '/api/injector-tests/export/pdf']) {
      const res = await fetch(url + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 400);
      const err = await res.json();
      assert.match(err.error, /at least one injector, or apply a filter/i);
      assert.strictEqual(err.code, 'VALIDATION_ERROR');
    }
  });
});

test('an export includes a record with no bench results instead of refusing it', async () => {
  const ids = await seedInjectors(2);
  // A record the bench never scored — blocked for reports, listable in an export.
  db.run(
    "UPDATE injector_test_reports SET report_json = '{}', steps_total = 0, steps_passed = 0, " +
    "steps_failed = 0, result_status = 'unknown', overall_pass = NULL WHERE id = ?",
    [ids[1]]
  );
  await withUser(ADMIN, async (url) => {
    const report = await fetch(`${url}/api/injector-tests/reports/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids }),
    });
    assert.strictEqual(report.status, 400, 'a report still refuses an unscored record');

    const res = await fetch(`${url}/api/injector-tests/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids }),
    });
    assert.strictEqual(res.status, 200);
    const text = extractPdfText(Buffer.from(await res.arrayBuffer())).join(' ');
    assert.match(text, /No result/, 'the unscored record is listed as having no result');
  });
});

test('the export routes are admin-only like every other injector route', async () => {
  const ids = await seedInjectors(2);
  for (const user of [QC_MANAGER, INSPECTOR]) {
    await withUser(user, async (url) => {
      for (const path of ['/api/injector-tests/export/xlsx', '/api/injector-tests/export/pdf']) {
        const res = await fetch(url + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ injector_ids: ids }),
        });
        assert.strictEqual(res.status, 403, `${user.role} POST ${path} should be 403`);
      }
      const steps = await fetch(`${url}/api/injector-tests/steps`);
      assert.strictEqual(steps.status, 403, `${user.role} GET /steps should be 403`);
    });
  }
});
