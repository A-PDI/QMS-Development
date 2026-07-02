'use strict';
/**
 * Client + sync engine for the third-party injector flow-test-bench API
 * (cloudx.carbonzapp.com). One bench "report" covers one or more physical
 * injectors tested in the same session (one per test slot); we split each
 * report into individual injector rows (injector_test_results) so they can
 * be listed, selected, and turned into inspection records independently.
 *
 * NOTE on SlotsData / AllTests mapping: the vendor's field-level doc
 * describes SlotsData as a single object with position/sn/codes, but the
 * app supports multi-slot machines (see `single_slot_machine`), so
 * SlotsData is treated as either one slot object or a map of slot objects
 * keyed by index. Each AllTests entry carries PrimaryTank/SecondaryTank
 * readings with a `tank_position` — that's used to route a test's results
 * back to the matching slot. This is a best-effort interpretation (no raw
 * sample response was available); the full raw payload is always stored in
 * injector_test_reports.raw_json / injector_test_results.raw_slot_json so
 * the mapping can be corrected without losing data if it's wrong.
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');

const BASE_URL = process.env.INJECTOR_API_BASE_URL || 'https://cloudx.carbonzapp.com/userapi/v1/client/getReports';
const API_KEY = process.env.INJECTOR_API_KEY || '';
// Auth header name/scheme aren't specified in the vendor doc we have. Default
// to a standard Bearer header; override via env if the vendor's actual
// scheme differs (e.g. INJECTOR_API_AUTH_HEADER=X-Api-Key, INJECTOR_API_AUTH_SCHEME=).
const AUTH_HEADER = process.env.INJECTOR_API_AUTH_HEADER || 'Authorization';
const AUTH_SCHEME = process.env.INJECTOR_API_AUTH_SCHEME !== undefined
  ? process.env.INJECTOR_API_AUTH_SCHEME
  : 'Bearer';
const PAGE_GUARD = 20; // max pagination loops per sync, to avoid runaway polling

// ── Settings (sync cursor) ─────────────────────────────────────────────────

function getSetting(key) {
  const row = db.get('SELECT value FROM system_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.run(
    `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value == null ? null : String(value), new Date().toISOString()]
  );
}

function getSyncStatus() {
  return {
    configured: !!API_KEY,
    lastRunAt: getSetting('injector_sync_last_run_at'),
    lastStatus: getSetting('injector_sync_last_status'),
    lastError: getSetting('injector_sync_last_error') || null,
    lastCursorId: getSetting('injector_sync_last_id'),
  };
}

// ── HTTP client ─────────────────────────────────────────────────────────────

async function callGetReports(body) {
  if (!API_KEY) {
    const err = new Error('INJECTOR_API_KEY is not configured on the server.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const headers = { 'Content-Type': 'application/json' };
  headers[AUTH_HEADER] = AUTH_SCHEME ? `${AUTH_SCHEME} ${API_KEY}` : API_KEY;

  // Auth mechanism is under-documented — send the key as both the
  // configurable header above AND as a body field. An extra unrecognized
  // body field is harmless; a missing auth mechanism breaks every request.
  const payload = { ...body, api_key: API_KEY };

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }

  if (!res.ok) {
    const err = new Error(`Injector API request failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = text ? text.slice(0, 500) : '';
    throw err;
  }
  return json;
}

function extractReportsArray(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const key of ['reports', 'data', 'results', 'items']) {
    if (Array.isArray(json[key])) return json[key];
  }
  if (json._id) return [json]; // single-report response (`id` param lookup)
  return [];
}

// ── Normalization: SlotsData / AllTests → per-injector rows ────────────────

function extractSlots(rawSlotsData) {
  if (!rawSlotsData || typeof rawSlotsData !== 'object') return [];
  if ('sn' in rawSlotsData || 'position' in rawSlotsData) {
    return [normalizeSlot(rawSlotsData, 0)];
  }
  return Object.entries(rawSlotsData)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([key, v]) => normalizeSlot(v, key));
}

/**
 * Field types are inconsistent across this API (e.g. vdo_auth is a string
 * "0"/"1", single_slot_machine is an int, result_pass has been observed as
 * 1 AND 2). Coerce loosely rather than trusting a single JS type.
 */
function toBool(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

function normalizeSlot(v, fallbackKey) {
  return {
    enabled: toBool(v.enabled),
    new_code: v.new_code ?? null,
    old_code: v.old_code ?? null,
    position: v.position !== undefined && v.position !== null ? Number(v.position) : (Number(fallbackKey) || 0),
    sn: v.sn ?? null,
    statuscolor: v.statuscolor,
    raw: v,
  };
}

function buildTestRow(t, tank) {
  const info = t.TestInfo || {};
  const rsp = t.RspResults || {};
  const name = String(info.test_name || 'Test').replace(/:\s*SKIPPED$/i, '').trim();

  let spec = '';
  let actual = '';
  let pass = null;
  if (tank) {
    spec = [tank.text_green, tank.tank_unit].filter(Boolean).join(' ');
    actual = tank.results || '';
    // Observed result_pass values: 1 (pass), 2 (fail) — treat anything that
    // isn't an explicit pass flag as a fail, but corroborate with
    // result_color (5 = green = pass) since the two have been seen to agree.
    pass = toBool(tank.result_pass) || Number(tank.result_color) === 5;
  } else if (rsp.result !== undefined) {
    spec = 'Visual Pass';
    actual = String(rsp.result);
    pass = String(rsp.result) === '5';
  }

  const notesParts = [];
  if (info.hp) notesParts.push(`HP ${info.hp}`);
  if (info.lp) notesParts.push(`LP ${info.lp}`);
  if (info.rpm) notesParts.push(`${info.rpm} RPM`);
  if (info.test_time) notesParts.push(`${info.test_time}s`);

  return {
    test_order: Number(info.test_order) || 0,
    name: name || 'Test',
    spec,
    actual,
    pass,
    notes: notesParts.join(' · '),
  };
}

/**
 * Bucket AllTests entries onto the slot (injector) they belong to.
 *
 * A confirmed live sample showed PrimaryTank/SecondaryTank.tank_position
 * values of 1 and 2 even though SlotsData held 7 total slot entries (most
 * disabled/unloaded) — i.e. tank_position looks like a fixed "1st tank /
 * 2nd tank" channel number, not a reference to a specific slot's own
 * `position` field, and only two tanks are ever populated per test
 * regardless of how many slots exist. So rather than trying to match
 * tank_position against a slot's position value (unverified and, per that
 * sample, likely wrong), Primary always maps to the first *enabled* slot
 * and Secondary to the second, ranked by slot position.
 */
function attachTestsToSlots(slots, allTests) {
  const ordered = [...slots].sort((a, b) => a.position - b.position);
  const bucket = new Map(slots.map(s => [s.position, []]));

  for (const t of (Array.isArray(allTests) ? allTests : [])) {
    if (!t || (t.TestInfo && Number(t.TestInfo.status) === 1)) continue; // skip SKIPPED tests
    const primary = t.PrimaryTank;
    const secondary = t.SecondaryTank;
    if (primary && ordered[0]) {
      bucket.get(ordered[0].position).push(buildTestRow(t, primary));
    } else if (!primary && t.RspResults && ordered[0]) {
      bucket.get(ordered[0].position).push(buildTestRow(t, null));
    }
    if (secondary) {
      const slot = ordered[1] || ordered[0];
      if (slot) bucket.get(slot.position).push(buildTestRow(t, secondary));
    }
  }
  return bucket;
}

function computeOverallResult(tests) {
  if (!tests.length) return '';
  if (tests.some(t => t.pass === false)) return 'FAIL';
  if (tests.some(t => t.pass === true)) return 'PASS';
  return '';
}

function extractJobNumber(job) {
  if (!job || typeof job !== 'object') return null;
  return job.job_number || job.number || job.id || job.name || null;
}

// ── Persistence ──────────────────────────────────────────────────────────────

function syncReportToDb(raw) {
  if (!raw || raw._id === undefined || raw._id === null) {
    throw new Error('Report is missing _id');
  }
  const externalId = String(raw._id);
  const now = new Date().toISOString();
  const jobNumber = extractJobNumber(raw.job);
  const brand = raw.actuator_Brand || raw.actuator_brand || null;

  const existingReport = db.get('SELECT id FROM injector_test_reports WHERE external_id = ?', [externalId]);
  const reportId = existingReport ? existingReport.id : uuidv4();

  const reportCols = [
    raw.coding_name || null, raw.issuer_name || null, raw.machine_name || null, raw.machine_sn || null,
    raw.drs_id || null, raw.workshop_info || null, raw.customer_name || null, raw.customer_phone || null,
    raw.customer_mail || null, raw.customer_notes || null, raw.actuator_code || null, brand,
    raw.actuator_type || null, raw.pump_code || null, raw.notes || null, raw.machine_details || null,
    jobNumber, raw.status !== undefined ? Number(raw.status) : null, raw.datetime || null,
    raw.created_at || null, JSON.stringify(raw), now,
  ];

  if (existingReport) {
    db.run(
      `UPDATE injector_test_reports SET
        coding_name=?, issuer_name=?, machine_name=?, machine_sn=?, drs_id=?, workshop_info=?,
        customer_name=?, customer_phone=?, customer_mail=?, customer_notes=?, actuator_code=?,
        actuator_brand=?, actuator_type=?, pump_code=?, notes=?, machine_details=?, job_number=?,
        report_status=?, report_datetime=?, source_created_at=?, raw_json=?, synced_at=?
       WHERE id=?`,
      [...reportCols, reportId]
    );
  } else {
    db.run(
      `INSERT INTO injector_test_reports
        (id, external_id, coding_name, issuer_name, machine_name, machine_sn, drs_id, workshop_info,
         customer_name, customer_phone, customer_mail, customer_notes, actuator_code, actuator_brand,
         actuator_type, pump_code, notes, machine_details, job_number, report_status, report_datetime,
         source_created_at, raw_json, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [reportId, externalId, ...reportCols]
    );
  }

  // Only slots actually loaded/tested (SlotsData.enabled) become injector
  // rows — a report's SlotsData can list every physical slot the bench has
  // (a confirmed live sample had 7), most of them idle. If the enabled flag
  // doesn't resolve to true for anything (unexpected shape), fall back to
  // all slots rather than silently syncing zero injectors.
  const allSlots = extractSlots(raw.SlotsData);
  const enabledSlots = allSlots.filter(s => s.enabled);
  const slots = enabledSlots.length > 0 ? enabledSlots : allSlots;
  const testBuckets = attachTestsToSlots(slots, raw.AllTests);

  const existingResults = db.all(
    'SELECT id, slot_position FROM injector_test_results WHERE report_id = ?',
    [reportId]
  );
  const existingByPos = new Map(existingResults.map(r => [r.slot_position, r.id]));

  let injectorCount = 0;
  for (const slot of slots) {
    const testsForSlot = (testBuckets.get(slot.position) || []).sort((a, b) => a.test_order - b.test_order);
    const overall = computeOverallResult(testsForSlot);
    const partNumber = slot.new_code || slot.old_code || raw.actuator_code || null;
    const existingId = existingByPos.get(slot.position);
    const resultId = existingId || uuidv4();

    const resultCols = [
      slot.sn || null, partNumber, slot.old_code || null, brand, raw.actuator_type || null,
      overall, JSON.stringify(testsForSlot), JSON.stringify(slot.raw),
    ];

    if (existingId) {
      db.run(
        `UPDATE injector_test_results SET serial_number=?, part_number=?, old_code=?, injector_brand=?,
          injector_type=?, overall_result=?, tests_json=?, raw_slot_json=?, updated_at=? WHERE id=?`,
        [...resultCols, now, resultId]
      );
    } else {
      db.run(
        `INSERT INTO injector_test_results
          (id, report_id, slot_position, serial_number, part_number, old_code, injector_brand,
           injector_type, overall_result, tests_json, raw_slot_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [resultId, reportId, slot.position, ...resultCols, now, now]
      );
    }
    injectorCount++;
  }

  return { reportId, injectorCount };
}

// ── Sync orchestration ───────────────────────────────────────────────────────

async function syncNow() {
  const startedAt = new Date().toISOString();
  let cursorId = getSetting('injector_sync_last_id');
  let maxSeenId = cursorId;
  let reportsFetched = 0;
  let reportsSynced = 0;
  let injectorsSynced = 0;

  try {
    if (!cursorId) {
      const lookbackDays = parseInt(process.env.INJECTOR_SYNC_INITIAL_LOOKBACK_DAYS, 10) || 30;
      const dateFrom = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const json = await callGetReports({ date_from: dateFrom });
      const reports = extractReportsArray(json);
      reportsFetched = reports.length;
      for (const raw of reports) {
        const { injectorCount } = syncReportToDb(raw);
        reportsSynced++;
        injectorsSynced += injectorCount;
        if (raw._id && String(raw._id) > String(maxSeenId || '')) maxSeenId = raw._id;
      }
    } else {
      let loops = 0;
      let cursor = cursorId;
      while (loops < PAGE_GUARD) {
        const json = await callGetReports({ id_from: cursor });
        const reports = extractReportsArray(json);
        if (reports.length === 0) break;
        reportsFetched += reports.length;
        for (const raw of reports) {
          const { injectorCount } = syncReportToDb(raw);
          reportsSynced++;
          injectorsSynced += injectorCount;
          if (raw._id && String(raw._id) > String(maxSeenId || '')) maxSeenId = raw._id;
        }
        if (reports.length < 50 || maxSeenId === cursor) break; // caught up
        cursor = maxSeenId;
        loops++;
      }
    }

    if (maxSeenId) setSetting('injector_sync_last_id', maxSeenId);
    setSetting('injector_sync_last_run_at', new Date().toISOString());
    setSetting('injector_sync_last_status', 'ok');
    setSetting('injector_sync_last_error', '');
  } catch (err) {
    setSetting('injector_sync_last_run_at', new Date().toISOString());
    setSetting('injector_sync_last_status', 'error');
    setSetting('injector_sync_last_error', err.message || String(err));
    throw err;
  }

  return { startedAt, reportsFetched, reportsSynced, injectorsSynced };
}

// ── Dimensional-section builder (for auto-populating inspections) ──────────

function parseTests(testsJson) {
  let tests = testsJson;
  if (typeof tests === 'string') {
    try { tests = JSON.parse(tests || '[]'); } catch { tests = []; }
  }
  return Array.isArray(tests) ? tests : [];
}

function buildDimensionalSectionFromTests(testsJson) {
  const tests = parseTests(testsJson);
  const items = [];
  const values = [];
  tests.forEach((t, idx) => {
    const id = idx + 1;
    items.push({ id, measurement: t.name || `Test ${id}`, location: '', spec: t.spec || '' });
    values.push({
      id,
      spec: t.spec || '',
      actual1: t.actual || '',
      actual2: '',
      actual3: '',
      status: t.pass === true ? 'P' : t.pass === false ? 'F' : '',
      notes: t.notes || '',
    });
  });
  return { items, values };
}

/**
 * Build ONE shared dimensional item list (measurement/spec definitions) for
 * a group of injectors on the same report, so a multi-item inspection can
 * use a single `__admin_sections.dimensional` definition while each item
 * keeps its own actual values. Items are the union of test-step names seen
 * across the group (by first-seen order); each injector's values are
 * matched back to items by test name (not by index), so per-injector test
 * count/order differences don't misalign columns.
 */
function buildSharedDimensionalSection(resultRows) {
  const parsed = resultRows.map(r => parseTests(r.tests_json));

  const items = [];
  const nameToId = new Map();
  parsed.forEach(tests => {
    tests.forEach(t => {
      const name = t.name || 'Test';
      if (!nameToId.has(name)) {
        const id = items.length + 1;
        nameToId.set(name, id);
        items.push({ id, measurement: name, location: '', spec: t.spec || '' });
      } else if (!items[nameToId.get(name) - 1].spec && t.spec) {
        items[nameToId.get(name) - 1].spec = t.spec;
      }
    });
  });

  const perInjectorValues = parsed.map(tests => {
    const byName = new Map(tests.map(t => [t.name || 'Test', t]));
    return items.map(item => {
      const t = byName.get(item.measurement);
      return {
        id: item.id,
        spec: (t && t.spec) || item.spec || '',
        actual1: (t && t.actual) || '',
        actual2: '',
        actual3: '',
        status: t ? (t.pass === true ? 'P' : (t.pass === false ? 'F' : '')) : '',
        notes: (t && t.notes) || '',
      };
    });
  });

  return { items, perInjectorValues };
}

module.exports = {
  syncNow,
  getSyncStatus,
  buildDimensionalSectionFromTests,
  buildSharedDimensionalSection,
  // exported for testing / inspection only
  _internal: { extractSlots, attachTestsToSlots, computeOverallResult, extractReportsArray, extractJobNumber },
};
