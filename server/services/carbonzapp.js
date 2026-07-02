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

/**
 * Determine PASS / FAIL / SKIP for a tank.
 *
 * IMPORTANT — pass/fail is judged against the GREEN acceptance band
 * (min_green … max_green), which is exactly the spec shown to the operator as
 * `text_green` (e.g. "8.5 +/- 4.5" → 4.0 … 13.0). The bench's own
 * `result_pass` / `result_color` fields instead reflect the much tighter BLUE
 * *target* band (min_blue … max_blue), so relying on them makes in-spec
 * injectors show up as FAIL. We therefore compute status from AvrResult vs the
 * green band and only fall back to result_pass when the green bounds are
 * unavailable.
 */
function tankStatus(tank) {
  if (!tank) return null;

  const avr = toNum(tank.AvrResult);
  const lo = toNum(tank.min_green);
  const hi = toNum(tank.max_green);

  // Preferred path: green acceptance band + a measured average.
  if (avr != null && (lo != null || hi != null)) {
    const okLo = lo == null || avr >= lo - EPS;
    const okHi = hi == null || avr <= hi + EPS;
    return okLo && okHi ? PASS : FAIL;
  }

  // Fallback: no green band available — trust the bench's own flag.
  const p = Number(tank.result_pass);
  if (p === 1) return PASS;
  if (p === 2) return FAIL;
  return SKIP; // 4 / anything else / no data
}

// Small helpers for numeric tolerance comparison.
const EPS = 1e-6;
function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
      const avr = toNum(tank.AvrResult);
      return {
        tank_name: tank.tank_name || '',
        unit: tank.tank_unit || '',
        // Human-readable green-band spec, e.g. "8.5 +/- 4.5 mm3/STRK".
        spec: specText,
        // Structured specification pieces for the comparison report columns.
        target: tank.target_blue != null ? String(tank.target_blue) : '',
        tolerance: tank.tol_blue != null ? String(tank.tol_blue) : '',
        // Green acceptance band (the true pass/fail range).
        min_green: toNum(tank.min_green),
        max_green: toNum(tank.max_green),
        results: tank.results != null ? String(tank.results) : '',
        // The single "flow" value reported per injector = the average reading.
        average: avr != null ? String(avr) : '',
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

  // Send the key BOTH as a Bearer header and as `api_key` in the JSON body.
  // Both forms have been observed to authenticate successfully against the
  // bench; sending both maximises compatibility across deployments.
  const body = { api_key: key };
  if (dateFrom) body.date_from = dateFrom;
  if (id) body.id = id;
  if (idFrom) body.id_from = idFrom;

  // Abort the request if the bench doesn't respond in time so the UI never
  // hangs silently ("nothing happened").
  const controller = new AbortController();
  const timeoutMs = Number(process.env.CARBONZAPP_TIMEOUT_MS) || 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp;
  try {
    resp = await fetch(CARBONZAPP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      const err = new Error(`CarbonZapp did not respond within ${Math.round(timeoutMs / 1000)}s. Check the bench connection and try again.`);
      err.code = 'CARBONZAPP_TIMEOUT';
      throw err;
    }
    const err = new Error(`Could not reach CarbonZapp (${e.message}). Check the server's network/firewall access to cloudx.carbonzapp.com.`);
    err.code = 'CARBONZAPP_NETWORK';
    throw err;
  }
  clearTimeout(timer);

  const rawText = await resp.text().catch(() => '');
  const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(rawText) || /auth0|<title>/i.test(rawText);

  if (!resp.ok || looksLikeHtml) {
    // An HTML/Auth0 body almost always means the API key was rejected.
    let friendly;
    if (looksLikeHtml || resp.status === 400 || resp.status === 401 || resp.status === 403 || resp.status === 302) {
      friendly = `CarbonZapp rejected the request (HTTP ${resp.status}). This usually means the API key is invalid or expired — open Settings and re-enter a freshly generated key.`;
    } else {
      friendly = `CarbonZapp API returned HTTP ${resp.status}${rawText ? ': ' + rawText.replace(/\s+/g, ' ').slice(0, 160) : ''}`;
    }
    const err = new Error(friendly);
    err.code = 'CARBONZAPP_HTTP_ERROR';
    err.status = resp.status;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (_) {
    const err = new Error('CarbonZapp returned a non-JSON response. The API key may be invalid, or the endpoint has changed.');
    err.code = 'CARBONZAPP_BAD_RESPONSE';
    throw err;
  }

  if (!Array.isArray(data)) {
    // Some deployments wrap the array in { data: [...] } / { reports: [...] }.
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.reports)) return data.reports;
    if (data && Array.isArray(data.results)) return data.results;
    // A single object → treat as one report.
    if (data && data._id) return [data];
    throw new Error('CarbonZapp API returned an unexpected (non-array) response.');
  }
  return data;
}

/**
 * Lightweight connectivity/auth test that doesn't persist anything.
 * Returns { ok, count, sampleDate }.
 */
async function testConnection({ apiKey } = {}) {
  const reports = await fetchReports({ apiKey });
  const dates = reports.map(r => r && (r.datetime || r.created_at)).filter(Boolean).sort();
  return {
    ok: true,
    count: reports.length,
    sampleDate: dates.length ? dates[dates.length - 1] : null,
  };
}

/**
 * Turn a stored injector_test_reports DB row back into the shape the
 * inspection auto-fill expects (with a parsed `tests` array).
 */
function hydrateInjectorRow(row) {
  let rj = {};
  try { rj = row.report_json ? JSON.parse(row.report_json) : {}; } catch (_) { rj = {}; }
  return {
    ...row,
    tests: Array.isArray(rj.tests) ? rj.tests : [],
    report_json: rj,
  };
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
 * Delete a Fuel Injector inspection that was auto-created from the bench,
 * UNLESS it has been manually completed (we never destroy a QC sign-off).
 * Returns 'deleted' | 'kept' | 'missing'.
 */
function deleteAutoInspection(inspectionId) {
  if (!inspectionId) return 'missing';
  const insp = db.get('SELECT id, status FROM inspections WHERE id = ?', [inspectionId]);
  if (!insp) return 'missing';
  if (insp.status === 'complete') return 'kept';
  // Detach any injector rows still pointing here, then remove dependent rows.
  db.run('UPDATE injector_test_reports SET inspection_id = NULL WHERE inspection_id = ?', [inspectionId]);
  try { db.run('DELETE FROM inspection_activity_log WHERE inspection_id = ?', [inspectionId]); } catch (_) {}
  try { db.run('DELETE FROM inspection_attachments WHERE inspection_id = ?', [inspectionId]); } catch (_) {}
  try { db.run('DELETE FROM inspection_notes WHERE inspection_id = ?', [inspectionId]); } catch (_) {}
  db.run('DELETE FROM inspections WHERE id = ?', [inspectionId]);
  return 'deleted';
}

/**
 * Remove ALL synced injector reports and their auto-created inspections, then
 * reset the last-sync marker so the next sync is a full re-import.
 * Manually-completed inspections are preserved (only detached).
 * Returns { reportsDeleted, inspectionsDeleted, inspectionsKept }.
 */
function clearAllReports() {
  const inspectionIds = db.all(
    'SELECT DISTINCT inspection_id FROM injector_test_reports WHERE inspection_id IS NOT NULL', []
  ).map(r => r.inspection_id);

  let inspectionsDeleted = 0;
  let inspectionsKept = 0;
  for (const id of inspectionIds) {
    const outcome = deleteAutoInspection(id);
    if (outcome === 'deleted') inspectionsDeleted += 1;
    else if (outcome === 'kept') inspectionsKept += 1;
  }

  const before = db.get('SELECT COUNT(*) AS c FROM injector_test_reports', []);
  db.run('DELETE FROM injector_test_reports', []);
  const reportsDeleted = before ? before.c : 0;

  // Force the next sync to be a full re-import.
  db.run("DELETE FROM app_settings WHERE key = 'carbonzapp_last_sync'", []);

  console.log(`[CarbonZapp] Cleared ${reportsDeleted} injector row(s); deleted ${inspectionsDeleted} inspection(s), kept ${inspectionsKept} completed.`);
  return { reportsDeleted, inspectionsDeleted, inspectionsKept };
}

/**
 * Reconcile deletions after a FULL fetch. `presentExtIds` is the set of
 * report_ext_id values the bench returned. Any injector row (and its
 * auto-created inspection) whose report is no longer on the bench is removed.
 * Only safe to call when the fetch returned the COMPLETE report set
 * (i.e. a full resync with no date_from filter).
 * Returns { reportsDeleted, inspectionsDeleted, inspectionsKept }.
 */
function reconcileDeletions(presentExtIds) {
  const present = new Set([...presentExtIds].map(String));
  const dbReports = db.all('SELECT DISTINCT report_ext_id FROM injector_test_reports', []);
  const staleReportIds = dbReports
    .map(r => String(r.report_ext_id))
    .filter(id => id && !present.has(id));

  let reportsDeleted = 0;
  let inspectionsDeleted = 0;
  let inspectionsKept = 0;

  for (const extId of staleReportIds) {
    // Gather the inspection(s) linked to this report before deleting rows.
    const linked = db.all(
      'SELECT DISTINCT inspection_id FROM injector_test_reports WHERE report_ext_id = ? AND inspection_id IS NOT NULL',
      [extId]
    ).map(r => r.inspection_id);

    const del = db.run('DELETE FROM injector_test_reports WHERE report_ext_id = ?', [extId]);
    reportsDeleted += del && del.changes ? del.changes : 0;

    for (const id of linked) {
      const outcome = deleteAutoInspection(id);
      if (outcome === 'deleted') inspectionsDeleted += 1;
      else if (outcome === 'kept') inspectionsKept += 1;
    }
  }

  if (staleReportIds.length) {
    console.log(`[CarbonZapp] Reconciled deletions: ${reportsDeleted} injector row(s) from ${staleReportIds.length} removed report(s); ${inspectionsDeleted} inspection(s) deleted, ${inspectionsKept} kept.`);
  }
  return { reportsDeleted, inspectionsDeleted, inspectionsKept };
}

/**
 * Full sync: fetch new reports since last sync, persist them, auto-create/fill
 * a Fuel Injector inspection for each, and record the sync timestamp.
 *
 * When `fullResync` is true the entire report set is fetched (no date filter)
 * and reports that no longer exist on the bench are pruned (deletion handling).
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

  console.log(`[CarbonZapp] Sync starting (fullResync=${fullResync}, dateFrom=${dateFrom || 'none'})`);
  const raw = await fetchReports({ apiKey, dateFrom });
  console.log(`[CarbonZapp] Fetched ${raw.length} report object(s) from the bench.`);
  const result = upsertReports(raw);

  // Auto-create/fill inspections — ONE inspection per test report, grouping all
  // injectors that share the same report_ext_id into a single multi-item form.
  const { autoFillReportInspection } = require('./injectorInspection');
  const byReport = new Map();
  for (const inj of result.injectors) {
    const key = inj.report_ext_id;
    if (!byReport.has(key)) byReport.set(key, []);
    byReport.get(key).push(inj);
  }
  let inspectionsCreated = 0;
  for (const [reportExtId] of byReport) {
    try {
      // Load ALL injectors for this report from the DB (not just the ones that
      // changed in this sync) so an incremental sync never drops sibling
      // injectors from the multi-item inspection.
      const rows = db.all(
        'SELECT * FROM injector_test_reports WHERE report_ext_id = ? ORDER BY slot_position',
        [reportExtId]
      ).map(hydrateInjectorRow);
      const created = autoFillReportInspection(reportExtId, rows);
      if (created) inspectionsCreated += 1;
    } catch (err) {
      console.error('[CarbonZapp] auto-fill inspection failed:', err.message);
    }
  }

  // Deletion handling: a normal incremental sync only returns RECENT reports,
  // so a missing report does NOT imply deletion. Only a full resync fetches the
  // complete set, so only then can we safely prune reports the bench no longer
  // has.
  let deletion = { reportsDeleted: 0, inspectionsDeleted: 0, inspectionsKept: 0 };
  if (fullResync) {
    const presentExtIds = raw
      .filter(r => r && r._id != null)
      .map(r => String(r._id));
    deletion = reconcileDeletions(presentExtIds);
  }

  const now = new Date().toISOString();
  setSetting('carbonzapp_last_sync', now);
  console.log(`[CarbonZapp] Sync complete: ${result.imported} new, ${result.updated} updated, ${inspectionsCreated} inspection(s) created, ${deletion.reportsDeleted} pruned.`);

  return {
    fetched: raw.length,
    imported: result.imported,
    updated: result.updated,
    inspectionsCreated,
    reportsDeleted: deletion.reportsDeleted,
    inspectionsDeleted: deletion.inspectionsDeleted,
    inspectionsKept: deletion.inspectionsKept,
    fullResync: !!fullResync,
    lastSync: now,
  };
}

module.exports = {
  CARBONZAPP_URL,
  getSetting,
  setSetting,
  getApiKey,
  fetchReports,
  testConnection,
  mapReportToInjector,
  normaliseTests,
  hydrateInjectorRow,
  upsertReports,
  syncNow,
  clearAllReports,
  reconcileDeletions,
  deleteAutoInspection,
  PASS,
  FAIL,
  SKIP,
};
