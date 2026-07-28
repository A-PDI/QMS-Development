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
const {
  splitStepName,
  normaliseStepCode,
  isFlushStep,
  stepDisplayName,
  formatErrorDescription,
  formatErrorValue,
} = require('./injectorSteps');

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
 * Each step: { code, name, display_name, category, conditions, spec, unit,
 *              results, status, errored, error_description, error_raw,
 *              internal, secondary: {...}|null }
 *
 * NAME vs ERROR: the bench appends anomaly text to the step name itself
 * ("iVM.06 : HP ERROR (out of range) #1000"). `name` is always the step code
 * with that text removed, so a failing result can never rename a test step;
 * the error only ever surfaces through `errored` / `error_description` and the
 * result value ("Error: Out of Range").
 *
 * FL(W) — the internal flush/prep diagnostic — is kept in the list but flagged
 * `internal: true` so consumers can exclude it from customer-facing rows while
 * still seeing an aborted-run error.
 */
function normaliseTests(report) {
  const tests = Array.isArray(report.AllTests) ? report.AllTests : [];
  return tests.map((t) => {
    const ti = t.TestInfo || {};
    const pt = t.PrimaryTank || null;
    const st = t.SecondaryTank || null;
    const parsed = splitStepName(ti.test_name);
    const errored = parsed.errored;
    const skipped = Number(ti.status) === 1 && !errored;

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

    // The API error description, preserved verbatim plus a cleaned-up form for
    // display ("HP ERROR (out of range) #1000" → "Out of Range").
    const errorRaw = errored ? parsed.errorRaw : '';
    const errorDescription = errored ? formatErrorDescription(errorRaw) : '';
    const errorValue = errored ? formatErrorValue(errorDescription) : '';

    function tankView(tank, role) {
      if (!tank && !errored) return null;
      const t2 = tank || {};
      const specText = t2.text_green != null && t2.text_green !== ''
        ? `${t2.text_green}${t2.tank_unit ? ' ' + t2.tank_unit : ''}`
        : (t2.tank_unit || '');
      const avr = toNum(t2.AvrResult);
      return {
        tank_name: t2.tank_name || '',
        unit: t2.tank_unit || '',
        // Human-readable green-band spec, e.g. "8.5 +/- 4.5 mm3/STRK".
        spec: specText,
        // Structured specification pieces for the comparison report columns.
        target: t2.target_blue != null ? String(t2.target_blue) : '',
        tolerance: t2.tol_blue != null ? String(t2.tol_blue) : '',
        // Green acceptance band (the true pass/fail range).
        min_green: toNum(t2.min_green),
        max_green: toNum(t2.max_green),
        results: t2.results != null ? String(t2.results) : '',
        // The single "flow" value reported per injector = the average reading.
        // An errored step has no trustworthy measurement, so the value cell
        // carries the error text instead — the step NAME is left untouched.
        average: errored ? errorValue : (avr != null ? String(avr) : ''),
        error: errored,
        error_description: errorDescription,
        status: errored ? FAIL : tankStatus(t2),
        // Which display label this tank uses ("Resistance" vs "Inductance").
        role,
      };
    }

    const primary = tankView(pt, 'primary');
    const secondary = st ? tankView(st, 'secondary') : null;

    // Overall step status: errors always fail; otherwise skipped if TestInfo
    // says so or no tank; otherwise the worst of primary/secondary.
    let status = SKIP;
    if (errored) {
      status = FAIL;
    } else if (!skipped && primary) {
      const parts = [primary.status, secondary ? secondary.status : null].filter(Boolean);
      if (parts.includes(FAIL)) status = FAIL;
      else if (parts.includes(PASS)) status = PASS;
      else status = SKIP;
    }

    return {
      // Step code with any bench anomaly text removed — never the error message.
      name: parsed.base || (ti.test_name || ''),
      code: normaliseStepCode(parsed.base),
      display_name: stepDisplayName(parsed.base, 'primary', pt && pt.tank_name),
      raw_name: ti.test_name || '',
      order: ti.test_order != null ? Number(ti.test_order) : 0,
      category: ti.test_category_id != null ? Number(ti.test_category_id) : null,
      conditions: conditionParts.join(' · '),
      params,
      skipped,
      status,
      errored,
      error_description: errorDescription,
      // The untouched API text, kept for troubleshooting (never shown raw).
      error_raw: errorRaw,
      internal: isFlushStep(parsed.base),
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
  // Customer-facing steps only (FL(W) is internal). An errored step is scored
  // as a FAIL — a step the bench could not measure is not a pass.
  const scored = tests.filter((t) => !t.internal && !t.skipped && (t.primary || t.errored));
  const failed = scored.filter((t) => t.status === FAIL).length;
  const passed = scored.filter((t) => t.status === PASS).length;
  // An error on the internal flush step aborts the whole run → not a pass.
  const internalError = tests.some((t) => t.internal && t.errored);
  const overallPass = internalError
    ? 0
    : (scored.length === 0 ? null : (failed === 0 ? 1 : 0));

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

// ── Job-number routing ────────────────────────────────────────────────────────
// The test bench is shared with the Warranty_SQL app. Technicians prefix the
// bench "Job #" to say which system a result belongs to:
//   "QMS…" → an internal quality inspection → belongs here (QMS-Development)
//   "RMA…" → a warranty return evaluation → belongs to Warranty_SQL only
// A report is only synced here if its Job # begins with OUR prefix — anything
// else (the other system's prefix, no prefix, or any other text) is excluded.
//
// The prefix is configurable so a change of convention on the bench doesn't
// silently exclude every report:
//   CARBONZAPP_JOB_PREFIX=QMS    (default)
//   CARBONZAPP_JOB_PREFIX=none   import everything, whatever the Job # says
// It can also be stored in app_settings under `carbonzapp_job_prefix`.
const OWN_JOB_PREFIX = 'QMS';
const ROUTING_DISABLED = ['none', 'any', 'all', '*'];

function jobPrefix() {
  const configured = (process.env.CARBONZAPP_JOB_PREFIX || getSetting('carbonzapp_job_prefix') || '').trim();
  return configured || OWN_JOB_PREFIX;
}

/** True when job-number routing is switched off (every report is imported). */
function routingDisabled() {
  return ROUTING_DISABLED.includes(jobPrefix().toLowerCase());
}

function jobNumberOf(report) {
  return String((report && (report.job || report.drs_id)) || '').trim();
}

function belongsToThisApp(report) {
  if (routingDisabled()) return true;
  const job = jobNumberOf(report);
  return new RegExp(`^${jobPrefix()}`, 'i').test(job);
}

// ── Full-resync fetch window ──────────────────────────────────────────────────
// A full resync asks the bench for EVERYTHING. Some deployments return an empty
// array when no `date_from` filter is supplied at all, which used to make a full
// resync look like "the bench has no reports" — and prune the local cache. We
// therefore send a deliberately wide start date instead of no filter.
//   CARBONZAPP_FULL_SYNC_FROM=2015-01-01  narrow the window
//   CARBONZAPP_FULL_SYNC_FROM=none        send no date filter (legacy behaviour)
const FULL_SYNC_FROM_DEFAULT = '2000-01-01T00:00:00.000Z';

function fullSyncDateFrom() {
  const configured = (process.env.CARBONZAPP_FULL_SYNC_FROM || '').trim();
  if (ROUTING_DISABLED.includes(configured.toLowerCase())) return null;
  return configured || FULL_SYNC_FROM_DEFAULT;
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
/**
 * Which stored reports the bench no longer has, and how much of the local cache
 * they represent. Used to decide whether pruning them is safe.
 */
function stalePruneImpact(presentExtIds) {
  const present = new Set([...presentExtIds].map(String));
  const staleReportIds = db.all('SELECT DISTINCT report_ext_id FROM injector_test_reports', [])
    .map(r => String(r.report_ext_id))
    .filter(id => id && !present.has(id));

  const storedRows = db.get('SELECT COUNT(*) AS c FROM injector_test_reports', []);
  const staleRows = staleReportIds.length
    ? db.get(
        `SELECT COUNT(*) AS c FROM injector_test_reports
          WHERE report_ext_id IN (${staleReportIds.map(() => '?').join(',')})`,
        staleReportIds
      )
    : { c: 0 };

  const total = storedRows ? storedRows.c : 0;
  const rows = staleRows ? staleRows.c : 0;
  return {
    staleReportIds,
    staleReports: staleReportIds.length,
    staleRows: rows,
    storedRows: total,
    sharePct: total > 0 ? (rows / total) * 100 : 0,
  };
}

function reconcileDeletions(presentExtIds) {
  const { staleReportIds } = stalePruneImpact(presentExtIds);

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

// A full resync may prune reports the bench no longer has. If that would wipe
// out more than this share of the local cache, the prune is SKIPPED and
// reported instead — a partial or filtered bench response must never be able to
// empty the app's data. The caller can confirm with { allowLargePrune: true }.
const PRUNE_SHARE_LIMIT_PCT = Number(process.env.CARBONZAPP_PRUNE_LIMIT_PCT) || 50;

/**
 * Full sync: fetch reports from the bench and persist them (test records only —
 * reports are generated manually, see services/injectorReports.js).
 *
 * When `fullResync` is true the entire report set is fetched and reports that
 * no longer exist on the bench are pruned — subject to two safety rules that
 * exist because pruning is destructive and a fetch can come back short:
 *
 *   1. Nothing usable came back → prune NOTHING. An empty response (or one
 *      where every report was excluded by job-number routing) means "we can't
 *      see the bench's data", not "the bench has no data".
 *   2. The prune would remove more than PRUNE_SHARE_LIMIT_PCT of the local
 *      records → skip it and report `pruneSkipped` so the user can confirm.
 */
async function syncNow({ apiKey, fullResync = false, allowLargePrune = false } = {}) {
  const lastSync = fullResync ? null : getSetting('carbonzapp_last_sync');
  // The bench uses date_from as an inclusive filter. Fetch from the last sync
  // (minus a small overlap so nothing is missed); dedupe handles overlaps.
  // A full resync uses a deliberately wide window instead of no filter at all.
  let dateFrom = fullResync ? fullSyncDateFrom() : null;
  if (!fullResync && lastSync) {
    const d = new Date(lastSync);
    if (!isNaN(d.getTime())) {
      d.setMinutes(d.getMinutes() - 5); // 5-min overlap guard
      dateFrom = d.toISOString();
    }
  }

  console.log(`[CarbonZapp] Sync starting (fullResync=${fullResync}, dateFrom=${dateFrom || 'none'}, jobPrefix=${routingDisabled() ? 'disabled' : jobPrefix()})`);
  const fetched = await fetchReports({ apiKey, dateFrom });
  // Route by Job # prefix — reports belonging to the Warranty app are excluded
  // here.
  const raw = fetched.filter(belongsToThisApp);
  const excludedByRouting = fetched.length - raw.length;
  // A sample of the Job #s that were filtered out, so "nothing imported" can be
  // diagnosed from the UI instead of the server log.
  const excludedJobNumbers = [...new Set(
    fetched.filter(r => !belongsToThisApp(r)).map(r => jobNumberOf(r) || '(blank)')
  )].slice(0, 10);
  console.log(`[CarbonZapp] Fetched ${fetched.length} report object(s) from the bench (${excludedByRouting} excluded by job-number routing${excludedJobNumbers.length ? ': ' + excludedJobNumbers.join(', ') : ''}).`);
  const result = upsertReports(raw);

  // NOTE: synchronisation IMPORTS TEST RECORDS ONLY. Inspection reports are no
  // longer created here — the user selects the injectors they want on the
  // Injector Tests page and generates reports explicitly (see
  // services/injectorReports.js). Keeping the two workflows separate stops the
  // bench from filling the app with unwanted draft inspections.
  const inspectionsCreated = 0;

  // Deletion handling: a normal incremental sync only returns RECENT reports,
  // so a missing report does NOT imply deletion. Only a full resync fetches the
  // complete set, so only then can pruning be considered at all.
  let deletion = { reportsDeleted: 0, inspectionsDeleted: 0, inspectionsKept: 0 };
  let pruneSkipped = null;
  if (fullResync) {
    const presentExtIds = raw
      .filter(r => r && r._id != null)
      .map(r => String(r._id));

    if (presentExtIds.length === 0) {
      // Rule 1 — never treat "we got nothing" as "the bench has nothing".
      const impact = stalePruneImpact(presentExtIds);
      if (impact.staleRows > 0) {
        pruneSkipped = {
          reason: 'empty_fetch',
          wouldDeleteRows: impact.staleRows,
          wouldDeleteReports: impact.staleReports,
          storedRows: impact.storedRows,
        };
        console.warn(`[CarbonZapp] Full resync returned no usable reports — SKIPPED pruning ${impact.staleRows} existing injector row(s). Existing data left untouched.`);
      }
    } else {
      const impact = stalePruneImpact(presentExtIds);
      const tooMuch = impact.staleRows > 0
        && impact.storedRows > 0
        && impact.sharePct > PRUNE_SHARE_LIMIT_PCT;
      if (tooMuch && !allowLargePrune) {
        // Rule 2 — a suspiciously large prune needs confirmation.
        pruneSkipped = {
          reason: 'large_prune',
          wouldDeleteRows: impact.staleRows,
          wouldDeleteReports: impact.staleReports,
          storedRows: impact.storedRows,
          sharePct: impact.sharePct,
          limitPct: PRUNE_SHARE_LIMIT_PCT,
        };
        console.warn(`[CarbonZapp] Full resync would prune ${impact.staleRows}/${impact.storedRows} injector row(s) (${impact.sharePct.toFixed(0)}%) — SKIPPED pending confirmation.`);
      } else {
        deletion = reconcileDeletions(presentExtIds);
      }
    }
  }

  // Advance the incremental marker only when we actually saw the bench's data.
  // A full resync that returned nothing leaves it alone, so the next ordinary
  // "Sync Now" still reaches back to where it left off.
  const now = new Date().toISOString();
  const markerAdvanced = !(fullResync && fetched.length === 0);
  if (markerAdvanced) setSetting('carbonzapp_last_sync', now);
  console.log(`[CarbonZapp] Sync complete: ${result.imported} new, ${result.updated} updated, ${deletion.reportsDeleted} pruned (no inspections created — reports are generated manually).`);

  return {
    fetched: raw.length,
    fetchedTotal: fetched.length,
    excludedByRouting,
    // Diagnostics for "the bench answered but nothing was imported".
    excludedJobNumbers,
    jobPrefix: routingDisabled() ? null : jobPrefix(),
    imported: result.imported,
    updated: result.updated,
    inspectionsCreated,
    reportsDeleted: deletion.reportsDeleted,
    inspectionsDeleted: deletion.inspectionsDeleted,
    inspectionsKept: deletion.inspectionsKept,
    // Present when a destructive prune was held back (see syncNow).
    pruneSkipped,
    storedRows: db.get('SELECT COUNT(*) AS c FROM injector_test_reports', []).c,
    fullResync: !!fullResync,
    lastSync: markerAdvanced ? now : lastSync,
  };
}

module.exports = {
  CARBONZAPP_URL,
  PRUNE_SHARE_LIMIT_PCT,
  getSetting,
  setSetting,
  getApiKey,
  fetchReports,
  testConnection,
  mapReportToInjector,
  normaliseTests,
  hydrateInjectorRow,
  jobPrefix,
  routingDisabled,
  fullSyncDateFrom,
  jobNumberOf,
  belongsToThisApp,
  upsertReports,
  syncNow,
  clearAllReports,
  reconcileDeletions,
  stalePruneImpact,
  deleteAutoInspection,
  PASS,
  FAIL,
  SKIP,
};
