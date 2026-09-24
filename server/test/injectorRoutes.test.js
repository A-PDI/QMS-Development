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
const { benchReport, benchBatch } = require('./helpers/benchData');
const ExcelJS = require('exceljs');
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
test('quick entry exposes the fixed table and saves measurements through the API', async () => {
  resetInjectorData();
  db.run("INSERT OR IGNORE INTO users (id,name,email,role,active) VALUES (?,?,?,'admin',1)",
    [ADMIN.id, ADMIN.name, 'quick-api@example.com']);
  carbonzapp.upsertReports([benchReport({
    id: 'quick-api', slot: 0, serial: 'FIX-QUICK-API', part: '4327147',
    datetime: '2026-09-10T10:00:00Z', flow: { IVM01: 255, IVM06: 260, IVM06_RETURN: 28 },
  })]);
  const injector = db.get('SELECT id FROM injector_test_reports WHERE report_ext_id = ?', ['quick-api']);
  await withUser(ADMIN, async (url) => {
    const endpoint = `${url}/api/injector-tests/${injector.id}/quick-entry`;
    const context = await (await fetch(endpoint)).json();
    assert.strictEqual(context.can_save, true);
    assert.deepStrictEqual(context.measurements.map((m) => m.label), [
      'Preload Screw Height', 'Armature Stroke', 'Needle Stroke',
      'Nozzle Nut Torque', 'Valve Body Torque', 'Solenoid Nut Torque',
    ]);
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repair_date: '2026-09-10T11:00:00Z', measurements: [
        { key: 'needle_stroke', before_value: '.247', after_value: '.232', unit: 'mm' },
      ] }),
    });
    assert.strictEqual(response.status, 201);
    const { repair_case: repair } = await response.json();
    assert.strictEqual(repair.attempts[0].changes[0].after_value, '.232');
    const history = await (await fetch(`${url}/api/injector-tests/${injector.id}/repair-history`)).json();
    assert.strictEqual(history.cases[0].id, repair.id);
    assert.strictEqual((await (await fetch(endpoint)).json()).can_save, false);
    const analyticsResponse = await fetch(`${url}/api/injector-tests/analytics?date_from=2026-09-10&date_to=2026-09-10`);
    assert.strictEqual(analyticsResponse.status, 200);
    const analytics = await analyticsResponse.json();
    assert.strictEqual(analytics.testing.test_runs, 1);
    assert.strictEqual(analytics.repairs.pending_retests, 1);
    const caseResponse = await fetch(`${url}/api/injector-tests/repairs/cases/${repair.id}`);
    assert.strictEqual(caseResponse.status, 200);
    assert.strictEqual((await caseResponse.json()).attempts[0].changes[0].parameter, 'Needle Stroke');
    const exportResponse = await fetch(`${url}/api/injector-tests/analytics/export.xlsx?date_from=2026-09-10`);
    assert.strictEqual(exportResponse.status, 200);
    assert.ok(exportResponse.headers.get('content-type').includes('spreadsheetml'));
    const invalid = await fetch(`${url}/api/injector-tests/analytics?date_from=not-a-date`);
    assert.strictEqual(invalid.status, 400);
  });
});

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
    ['GET', `/api/injector-tests/${ids[0]}/repair-history`, null],
    ['GET', '/api/injector-tests/analytics', null],
    ['GET', '/api/injector-tests/analytics/export.xlsx', null],
    ['GET', '/api/injector-tests/repairs/cases/not-a-case', null],
    ['GET', `/api/injector-tests/${ids[0]}/quick-entry`, null],
    ['POST', `/api/injector-tests/${ids[0]}/quick-entry`, {}],
    ['POST', '/api/injector-tests/repairs/cases', { initial_test_id: ids[0] }],
    ['POST', '/api/injector-tests/repairs/cases/not-a-case/attempts', {}],
    ['PATCH', '/api/injector-tests/repairs/cases/not-a-case/status', { status: 'HOLD' }],
    ['POST', '/api/injector-tests/repairs/attempts/not-an-attempt/retest', {}],
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

test('a preview of a single injector returns that one column, unchanged in shape', async () => {
  // The list's serial-number quick preview posts exactly one id to this same
  // endpoint, so a one-injector preview has to carry the full comparison table.
  const ids = await seedInjectors(3);
  const before = injectorInspectionCount();
  await withUser(ADMIN, async (url) => {
    const many = await fetch(`${url}/api/injector-tests/reports/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids }),
    });
    const res = await fetch(`${url}/api/injector-tests/reports/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: [ids[1]] }),
    });
    assert.strictEqual(res.status, 200);
    const one = (await res.json()).preview;
    const all = (await many.json()).preview;

    assert.strictEqual(one.injectors.length, 1, 'only the injector that was asked for');
    assert.strictEqual(one.injectors[0].id, ids[1]);
    assert.deepStrictEqual(
      one.rows.map((row) => row.key),
      all.rows.map((row) => row.key),
      'the same test steps as the multi-injector preview'
    );
    for (const row of one.rows) {
      assert.strictEqual(row.values.length, 1, `${row.key} has one value column`);
    }
  });
  assert.strictEqual(injectorInspectionCount(), before, 'a preview creates nothing');
});

test('repair routes create a case, offer a matching retest and close on pass', async () => {
  resetInjectorData();
  db.run(
    `INSERT OR IGNORE INTO users (id, name, email, role, active)
     VALUES (?, ?, ?, 'admin', 1)`,
    [ADMIN.id, ADMIN.name, 'injector-route-tests@example.com']
  );
  carbonzapp.upsertReports([benchReport({
    id: 'route-repair-before', serial: 'FIX-ROUTE-1', part: '4327147',
    datetime: '2026-09-11T10:00:00Z', flow: { IVM01: 250 },
  })]);
  const before = db.get('SELECT id FROM injector_test_reports WHERE report_ext_id = ?', ['route-repair-before']);

  await withUser(ADMIN, async (url) => {
    const initialHistory = await (await fetch(`${url}/api/injector-tests/${before.id}/repair-history`)).json();
    assert.strictEqual(initialHistory.can_start, true);

    const createdResponse = await fetch(`${url}/api/injector-tests/repairs/cases`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initial_test_id: before.id,
        failure_categories: ['High Delivery'],
        attempt: {
          repair_date: '2026-09-11T11:00:00Z', technician: ADMIN.name,
          diagnosis: 'Peak HP delivery is high.',
          hypothesis: 'Needle stroke is excessive.',
          expected_outcome: 'Peak HP delivery moves into specification.',
          changes: [{ component: 'Needle', action_type: 'Adjusted', parameter: 'Needle Stroke', before_value: '0.247', after_value: '0.232', unit: 'mm' }],
        },
      }),
    });
    assert.strictEqual(createdResponse.status, 201);
    const created = (await createdResponse.json()).repair_case;

    carbonzapp.upsertReports([benchReport({
      id: 'route-repair-after', serial: 'FIX-ROUTE-1', part: '4327147',
      datetime: '2026-09-11T12:00:00Z', flow: { IVM01: 235 },
    })]);
    const history = await (await fetch(`${url}/api/injector-tests/${before.id}/repair-history`)).json();
    assert.strictEqual(history.active_case_id, created.id);
    assert.strictEqual(history.candidate_retests.length, 1);
    const listWithRetest = await (await fetch(`${url}/api/injector-tests`)).json();
    const repairedRow = listWithRetest.injectors.find((row) => row.id === before.id);
    assert.strictEqual(repairedRow.repair_attempt_number, 1, 'the repair shows on the result it was recorded on');
    assert.strictEqual(repairedRow.repair_attempt_status, 'WAITING_RETEST');
    assert.strictEqual(repairedRow.repair_case_status, 'OPEN');
    const retestRow = listWithRetest.injectors.find((row) => row.id === history.candidate_retests[0].id);
    assert.strictEqual(retestRow.repair_attempt_number, undefined, 'a later result does not inherit the repair');
    assert.strictEqual(retestRow.retest_of_attempt, undefined, 'nor is it a retest until linked');

    const linkedResponse = await fetch(`${url}/api/injector-tests/repairs/attempts/${created.attempts[0].id}/retest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ after_test_id: history.candidate_retests[0].id }),
    });
    assert.strictEqual(linkedResponse.status, 200);
    const linked = (await linkedResponse.json()).repair_case;
    assert.strictEqual(linked.status, 'PASSED');
    assert.strictEqual(linked.attempts[0].outcome, 'PASS');
    assert.strictEqual(linked.attempts[0].deltas.find((row) => row.step_code === 'IVM01').absolute_delta, -15);

    const listAfterPass = await (await fetch(`${url}/api/injector-tests`)).json();
    const passRow = listAfterPass.injectors.find((row) => row.id === history.candidate_retests[0].id);
    assert.strictEqual(passRow.retest_of_attempt, 1);
    assert.strictEqual(passRow.retest_outcome, 'PASS');
    assert.strictEqual(listAfterPass.injectors.find((row) => row.id === before.id).repair_attempt_status, 'COMPLETED');
  });
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
test('the custom report is also served as an Excel workbook', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    const res = await fetch(`${url}/api/injector-tests/reports/custom.xlsx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: ids }),
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml\.sheet/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="CustomReport_.*_3\.xlsx"/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buffer.subarray(0, 2).toString(), 'PK', 'an xlsx file is a zip archive');
  });
});

test('the workbook columns follow the order the injectors were sent in', async () => {
  const ids = await seedInjectors(3);
  await withUser(ADMIN, async (url) => {
    const workbookFor = async (order) => {
      const res = await fetch(`${url}/api/injector-tests/reports/custom.xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ injector_ids: order }),
      });
      assert.strictEqual(res.status, 200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
      return wb.getWorksheet('Comparison').getRow(1).values.slice(4)
        .map((header) => String(header).split('SN ')[1]);
    };

    assert.deepStrictEqual(await workbookFor(ids), ['XT001', 'XT002', 'XT003']);
    assert.deepStrictEqual(await workbookFor([ids[2], ids[0], ids[1]]), ['XT003', 'XT001', 'XT002']);
  });
});

test('the two report formats accept exactly the same selections', async () => {
  const ids = await seedInjectors(2);
  // A record the bench never scored blocks BOTH formats, not just the PDF.
  db.run(
    "UPDATE injector_test_reports SET report_json = '{}', steps_total = 0 WHERE id = ?",
    [ids[1]]
  );
  await withUser(ADMIN, async (url) => {
    for (const path of ['/api/injector-tests/reports/custom', '/api/injector-tests/reports/custom.xlsx']) {
      const res = await fetch(url + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ injector_ids: ids }),
      });
      assert.strictEqual(res.status, 400, `${path} should refuse an unscored record`);
      assert.match((await res.json()).error, /no test-bench results/i);
    }
  });
});

test('a filter only chooses the records — it never shows up in the workbook', async () => {
  await seedForFiltering();
  await withUser(ADMIN, async (url) => {
    // The two injectors that failed Peak Torque - Return, found by filtering.
    const list = await (await fetch(`${url}/api/injector-tests?steps=IVM06-R&step_status=fail`)).json();
    assert.deepStrictEqual(list.injectors.map((row) => row.serial_number).sort(), ['SN002', 'SN004']);

    const res = await fetch(`${url}/api/injector-tests/reports/custom.xlsx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injector_ids: list.injectors.map((row) => row.id) }),
    });
    assert.strictEqual(res.status, 200);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const text = wb.worksheets
      .map((sheet) => sheet.getRows(1, sheet.rowCount).map((row) => row.values.join(' ')).join('\n'))
      .join('\n');
    assert.ok(!/filter/i.test(text), 'the workbook never mentions a filter');
    assert.match(text, /SN002/);
    assert.ok(!/SN001/.test(text), 'a passing injector is not in a failures workbook');
  });
});

test('the workbook and step routes are admin-only like every other injector route', async () => {
  const ids = await seedInjectors(2);
  for (const user of [QC_MANAGER, INSPECTOR]) {
    await withUser(user, async (url) => {
      const res = await fetch(`${url}/api/injector-tests/reports/custom.xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ injector_ids: ids }),
      });
      assert.strictEqual(res.status, 403, `${user.role} POST /reports/custom.xlsx should be 403`);
      const steps = await fetch(`${url}/api/injector-tests/steps`);
      assert.strictEqual(steps.status, 403, `${user.role} GET /steps should be 403`);
    });
  }
});

test('a serial filter also finds the same unit entered differently', async () => {
  resetInjectorData();
  const add = (id, part, serial) => carbonzapp.upsertReports([benchReport({
    id, serial, part, datetime: '2026-09-20T10:00:00Z', flow: { IVM01: 235 },
  })]);
  add('unit-a', '4327147', '260521828A');
  add('unit-b', '4327147', '828');
  add('unit-c', '4327147', '260521828');
  add('unit-other', '4327147', '260777000');
  add('other-part', '9999999', '828');
  await withUser(ADMIN, async (url) => {
    const get = async (query) => (await fetch(`${url}/api/injector-tests${query}`)).json();
    const rows = (await get('?serial_number=260521828A')).injectors;
    assert.deepStrictEqual(
      rows.map((r) => `${r.part_number}/${r.serial_number}`).sort(),
      ['4327147/260521828', '4327147/260521828A', '4327147/828'],
      "the unit's other spellings are included; another part's 828 is not"
    );
    const bySerial = Object.fromEntries(rows.map((r) => [r.serial_number, r.serial_unit_match]));
    assert.deepStrictEqual(bySerial['828'], ['260521828A'], 'rows found as the same unit say which typed serial they matched');
    assert.deepStrictEqual(bySerial['260521828'], ['260521828A']);
  });
});
