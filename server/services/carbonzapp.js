'use strict';
/**
 * CarbonZapp Injector Test Bench integration.
 *
 * The test bench exposes a single reporting endpoint:
 *   POST https://cloudx.carbonzapp.com/userapi/v1/client/getReports
 *   Auth: Authorization: Bearer <api_key>
 *   Body: { date_from?, id_from?, id? }  (all optional filters)
 *   Response: JSON array of report objects.
 *
 * Data-model notes (confirmed against live data):
 *  - One report object === one physical injector, identified by its slot
 *    (SlotsData.position / SlotsData.sn). A single physical test groups >1
 *    injector: they share the same `_id` but differ by slot position.
 *    Unique injector key = `_id` + `SlotsData.position`.
 *  - Pass/fail per test step comes from PrimaryTank.result_pass:
 *      1 = PASS (green, result_color 5)
 *      2 = FAIL (red,   result_color 6)
 *      4 = third/no-result state (skipped, result_color 8)
 *  - `text_green` holds the human-readable spec (e.g. "10.0 +/- 10.0"),
 *    `tank_unit` the unit, `results` the raw measured values.
 *  - Steps with TestInfo.status === 1 are SKIPPED (no tank data).
 */

const db = require('../db/adapter');

const CARBONZAPP_URL = 'https://cloudx.carbonzapp.com/userapi/v1/client/getReports';

// ── Settings helpers ──────────────────────────────────────────────────────────

function getSetting(key) {
  const row = db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const now = new Date().toISOString();
  const existing = db.get('SELECT key FROM app_settings WHERE key = ?', [key]);
  if (existing) {
    db.run('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?', [value, now, key]);
  } else {
    db.run('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', [key, value, now]);
  }
}

function getApiKey() {
  // Env var takes precedence so the key can be provided securely in production.
  return process.env.CARBONZAPP_API_KEY || getSetting('carbonzapp_api_key') || null;
}

// ── Pass/fail interpretation ────────────────────────────────────────────────

const PASS = 'pass';
const FAIL = 'fail';
const SKIP = 'skip';

function tankStatus(tank) {
  if (!tank) return null;
  const p = Number(tank.result_pass);
  if (p === 1) return PASS;
  if (p === 2) return FAIL;
  return SKIP; // 4 / anything else
}

/**
 * Build a normalised list of test steps for a single injector report object.
 * Each step: { name, category, conditions, spec, unit, results, status,
 *              secondary: {...}|null }
 */
function normaliseTests(report) {
  const tests = Array.isArray(report.AllTests) ? report.AllTests : [];
  return tests.map((t) => {
    const ti = t.TestInfo || {};
    const pt = t.PrimaryTank || null;
    const st = t.SecondaryTank || null;
    const skipped = Number(ti.status) === 1;

    const conditionParts = [];
    if (ti.rpm != null && ti.rpm !== '') conditionParts.push(`RPM ${ti.rpm}`);
    if (ti.hp != null && ti.hp !== '') conditionParts.push(`HP ${ti.hp}`);
    if (ti.lp != null && ti.lp !== '') conditionParts.push(`LP ${ti.lp}`);
    if (ti.inj_1 != null && ti.inj_1 !== '') conditionParts.push(`Inj ${ti.inj_1}`);
    if (ti.strk != null && ti.strk !== '') conditionParts.push(`Strk ${ti.strk}`);

    // Structured test-step parameters used by the custom comparison report.
    //   hp    → "Rail Pressure"
    //   inj_1 → "Pulse Width"
    //   strk  → stroke count
    const clean = (v) => (v == null || v === '' ? '' : String(v));
    const params = {
      rail_pressure: clean(ti.hp),   // "Rail Pressure"
      pulse_width: clean(ti.inj_1),  // "Pulse Width"
      strk: clean(ti.strk),
    };

    function tankView(tank) {
      if (!tank) return null;
      const specText = tank.text_green != null && tank.text_green !== ''
        ? `${tank.text_green}${tank.tank_unit ? ' ' + tank.tank_unit : ''}`
        : (tank.tank_unit || '');
      return {
        tank_name: tank.tank_name || '',
        unit: tank.tank_unit || '',
        spec: specText,
        // Structured specification pieces for the comparison report columns.
        target: tank.target_blue != null ? String(tank.target_blue) : '',
        tolerance: tank.tol_blue != null ? String(tank.tol_blue) : '',
        results: tank.results != null ? String(tank.results) : '',
        // The single "flow" value reported per injector = the average reading.
        average: tank.AvrResult != null ? String(tank.AvrResult) : '',
        status: tankStatus(tank),
      };
    }

    const primary = tankView(pt);
    const secondary = tankView(st);

    // Overall step status: skipped if TestInfo says so or no tank; otherwise the
    // worst of primary/secondary (FAIL beats PASS).
    let status = SKIP;
    if (!skipped && primary) {
      const parts = [primary.status, secondary ? secondary.status : null].filter(Boolean);
      if (parts.includes(FAIL)) status = FAIL;
      else if (parts.includes(PASS)) status = PASS;
      else status = SKIP;
    }

    return {
      name: (ti.test_name || '').replace(/\s*:\s*SKIPPED\s*$/i, '').trim() || (ti.test_name || ''),
      raw_name: ti.test_name || '',
      order: ti.test_order != null ? Number(ti.test_order) : 0,
      category: ti.test_category_id != null ? Number(ti.test_category_id) : null,
      conditions: conditionParts.join(' · '),
      params,
      skipped,
      status,
      primary,
      secondary,
    };
  });
}

/**
 * Convert one CarbonZapp report object into an injector row for our DB.
 */
function mapReportToInjector(report) {
  const slot = report.SlotsData || {};
  const tests = normaliseTests(report);
  const scored = tests.filter((t) => !t.skipped && t.primary);
  const failed = scored.filter((t) => t.status === FAIL).length;
  const passed = scored.filter((t) => t.status === PASS).length;
  const overallPass = scored.length > 0 && failed === 0 ? 1 : (scored.length === 0 ? null : 0);

  return {
    report_ext_id: report._id != null ? String(report._id) : '',
    slot_position: slot.position != null ? Number(slot.position) : 0,
    part_number: report.actuator_code || null,
    serial_number: slot.sn || null,
    job_number: report.job || report.drs_id || null,
    brand: report.actuator_Brand || null,
    injector_type: report.actuator_type || null,
    machine_name: report.machine_name || null,
    machine_sn: report.machine_sn || null,
    test_datetime: report.datetime || report.created_at || null,
    ext_status: report.status != null ? Number(report.status) : null,
    overall_pass: overallPass,
    steps_total: scored.length,
    steps_passed: passed,
    steps_failed: failed,
    tests,
    // Keep the trimmed but complete data we need for the custom PDF.
    report_json: {
      report_ext_id: report._id != null ? String(report._id) : '',
      slot_position: slot.position != null ? Number(slot.position) : 0,
      part_number: report.actuator_code || null,
      serial_number: slot.sn || null,
      job_number: report.job || report.drs_id || null,
      brand: report.actuator_Brand || null,
      injector_type: report.actuator_type || null,
      machine_name: report.machine_name || null,
      machine_sn: report.machine_sn || null,
      test_datetime: report.datetime || report.created_at || null,
      tests,
    },
  };
}

// ── Remote fetch ──────────────────────────────────────────────────────────────

/**
 * Call the CarbonZapp API. Returns the parsed JSON array of report objects.
 * `opts.dateFrom` is an ISO date string used for incremental sync.
 */
async function fetchReports({ apiKey, dateFrom, id, idFrom } = {}) {
  const key = apiKey || getApiKey();
  if (!key) {
    const err = new Error('CarbonZapp API key is not configured. Add it in Admin → Injector Tests → Settings.');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const body = {};
  if (dateFrom) body.date_from = dateFrom;
  if (id) body.id = id;
  if (idFrom) body.id_from = idFrom;

  const resp = await fetch(CARBONZAPP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`CarbonZapp API returned HTTP ${resp.status}${text ? ': ' + text.slice(0, 200) : ''}`);
    err.code = 'CARBONZAPP_HTTP_ERROR';
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  if (!Array.isArray(data)) {
    // Some deployments wrap the array in { data: [...] } / { reports: [...] }.
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.reports)) return data.reports;
    throw new Error('CarbonZapp API returned an unexpected (non-array) response.');
  }
  return data;
}

/**
 * Persist a list of raw CarbonZapp report objects. Dedupes on
 * (report_ext_id, slot_position): existing rows are updated, new ones inserted.
 * Returns { imported, updated, injectors: [row...] }.
 */
function upsertReports(rawReports) {
  const crypto = require('crypto');
  let imported = 0;
  let updated = 0;
  const injectors = [];

  for (const raw of rawReports) {
    if (!raw || raw._id == null) continue;
    const inj = mapReportToInjector(raw);
    if (!inj.report_ext_id) continue;

    const existing = db.get(
      'SELECT id FROM injector_test_reports WHERE report_ext_id = ? AND slot_position = ?',
      [inj.report_ext_id, inj.slot_position]
    );
    const now = new Date().toISOString();

    if (existing) {
      db.run(
        `UPDATE injector_test_reports SET
           part_number = ?, serial_number = ?, job_number = ?, brand = ?, injector_type = ?,
           machine_name = ?, machine_sn = ?, test_datetime = ?, ext_status = ?, overall_pass = ?,
           steps_total = ?, steps_passed = ?, steps_failed = ?, report_json = ?, synced_at = ?
         WHERE id = ?`,
        [
          inj.part_number, inj.serial_number, inj.job_number, inj.brand, inj.injector_type,
          inj.machine_name, inj.machine_sn, inj.test_datetime, inj.ext_status, inj.overall_pass,
          inj.steps_total, inj.steps_passed, inj.steps_failed, JSON.stringify(inj.report_json), now,
          existing.id,
        ]
      );
      updated += 1;
      injectors.push({ id: existing.id, ...inj });
    } else {
      const id = crypto.randomUUID();
      db.run(
        `INSERT INTO injector_test_reports
           (id, report_ext_id, slot_position, part_number, serial_number, job_number, brand, injector_type,
            machine_name, machine_sn, test_datetime, ext_status, overall_pass,
            steps_total, steps_passed, steps_failed, report_json, synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, inj.report_ext_id, inj.slot_position, inj.part_number, inj.serial_number, inj.job_number,
          inj.brand, inj.injector_type, inj.machine_name, inj.machine_sn, inj.test_datetime, inj.ext_status,
          inj.overall_pass, inj.steps_total, inj.steps_passed, inj.steps_failed,
          JSON.stringify(inj.report_json), now, now,
        ]
      );
      imported += 1;
      injectors.push({ id, ...inj });
    }
  }

  return { imported, updated, injectors };
}

/**
 * Full sync: fetch new reports since last sync, persist them, auto-create/fill
 * a Fuel Injector inspection for each, and record the sync timestamp.
 */
async function syncNow({ apiKey, fullResync = false } = {}) {
  const lastSync = fullResync ? null : getSetting('carbonzapp_last_sync');
  // The bench uses date_from as an inclusive filter. Fetch from the last sync
  // (minus a small overlap so nothing is missed); dedupe handles overlaps.
  let dateFrom = null;
  if (lastSync) {
    const d = new Date(lastSync);
    if (!isNaN(d.getTime())) {
      d.setMinutes(d.getMinutes() - 5); // 5-min overlap guard
      dateFrom = d.toISOString();
    }
  }

  const raw = await fetchReports({ apiKey, dateFrom });
  const result = upsertReports(raw);

  // Auto-create/fill inspections for each injector.
  const { autoFillInjectorInspection } = require('./injectorInspection');
  let inspectionsCreated = 0;
  for (const inj of result.injectors) {
    try {
      const created = autoFillInjectorInspection(inj);
      if (created) inspectionsCreated += 1;
    } catch (err) {
      console.error('[CarbonZapp] auto-fill inspection failed:', err.message);
    }
  }

  const now = new Date().toISOString();
  setSetting('carbonzapp_last_sync', now);

  return {
    fetched: raw.length,
    imported: result.imported,
    updated: result.updated,
    inspectionsCreated,
    lastSync: now,
  };
}

module.exports = {
  CARBONZAPP_URL,
  getSetting,
  setSetting,
  getApiKey,
  fetchReports,
  mapReportToInjector,
  normaliseTests,
  upsertReports,
  syncNow,
  PASS,
  FAIL,
  SKIP,
};
