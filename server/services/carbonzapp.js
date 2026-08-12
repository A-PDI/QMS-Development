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
const {
  injectorOutcome,
  outcomeToOverallPass,
  stepHasExplicitFailure,
  stepOutcome,
} = require('./injectorResult');

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
        // A step the bench flagged (e.g. an excess return) still reports what it
        // MEASURED — the reading is kept and the failure is carried by `status`
        // and `error_description`. The error text is only used as the value when
        // the bench recorded no reading at all.
        average: avr != null ? String(avr) : (errored ? errorValue : ''),
        error: errored,
        error_description: errorDescription,
        // Keep the measurement's independent band result even when the bench
        // interrupted the step. The shared classifier decides whether that
        // proves a component failure or represents a DNF.
        status: tankStatus(t2),
        // Which display label this tank uses ("Resistance" vs "Inductance").
        role,
      };
    }

    const primary = tankView(pt, 'primary');
    const secondary = st ? tankView(st, 'secondary') : null;

    // Overall step status. An interrupted step is DNF unless one of its
    // measured tanks is explicitly outside the green acceptance range.
    let status = SKIP;
    if (!skipped && primary && !errored) {
      const parts = [primary.status, secondary ? secondary.status : null].filter(Boolean);
      if (parts.includes(FAIL)) status = FAIL;
      else if (parts.includes(PASS)) status = PASS;
      else status = SKIP;
    }

    const normalised = {
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
    normalised.status = stepOutcome(normalised);
    return normalised;
  });
}

/**
 * Convert one CarbonZapp report object into an injector row for our DB.
 */
function mapReportToInjector(report) {
  const slot = report.SlotsData || {};
  const tests = normaliseTests(report);
  // Customer-facing steps only (FL(W) is internal). A bench interruption does
  // not count as a component failure unless a preceding point failed or the
  // interrupted point contains an out-of-band measured value.
  const scored = tests.filter((t) => !t.internal && !t.skipped && (t.primary || t.errored));
  const failed = scored.filter(stepHasExplicitFailure).length;
  const passed = scored.filter((t) => t.status === PASS).length;
  const resultStatus = injectorOutcome({ tests });
  const overallPass = outcomeToOverallPass(resultStatus);

  return {
    report_ext_id: report._id != null ? String(report._id) : '',
    slot_position: slot.position != null ? Number(slot.position) : 0,
    part_number: report.actuator_code || null,
    serial_number: slot.sn || null,
    // Job # is evaluated transiently by the import-exclusion rules below but
    // is not retained as application data.
    job_number: null,
    brand: report.actuator_Brand || null,
    injector_type: report.actuator_type || null,
    machine_name: report.machine_name || null,
    machine_sn: report.machine_sn || null,
    test_datetime: report.datetime || report.created_at || null,
    ext_status: report.status != null ? Number(report.status) : null,
    overall_pass: overallPass,
    result_status: resultStatus,
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

// ── Paged fetching ────────────────────────────────────────────────────────────
// The bench answers ONE request with at most a page of reports (observed: ~39),
// oldest first. A single request therefore shows only a slice of the history —
// which is why a sync could see nothing but the oldest jobs while newer ones sat
// on the bench. `date_from` is the only filter available, so we page forward
// with it: each round asks for reports from the newest timestamp the previous
// round returned, until a round brings nothing new.
// Read per call so the limits can be changed without restarting the process.
const maxFetchPages = () => Number(process.env.CARBONZAPP_MAX_PAGES) || 100;
const fetchBudgetMs = () => Number(process.env.CARBONZAPP_FETCH_BUDGET_MS) || 240000;

/**
 * Unique key for one report object = one INJECTOR. A single bench test returns
 * several objects sharing `_id`, one per slot, so the slot is part of the key
 * (this mirrors the injector_test_reports unique index).
 */
function reportKey(report) {
  if (!report || report._id == null) return null;
  const slot = report.SlotsData && report.SlotsData.position != null
    ? Number(report.SlotsData.position)
    : 0;
  return `${String(report._id)}|${slot}`;
}

/** The report's test timestamp as a Date, or null. */
function reportDate(report) {
  const raw = report && (report.datetime || report.created_at);
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Oldest/newest test date across a set of reports (ISO strings). */
function reportDateRange(reports = []) {
  const dates = reports.map(reportDate).filter(Boolean).sort((a, b) => a - b);
  if (!dates.length) return { from: null, to: null };
  return { from: dates[0].toISOString(), to: dates[dates.length - 1].toISOString() };
}

/**
 * Fetch reports from `dateFrom` onwards, following the bench's paging until it
 * stops producing new reports.
 *
 * Returns { reports, pages, truncated } — `truncated` means we stopped on the
 * page/time budget rather than because the bench ran out, i.e. the result is
 * NOT a complete view and must never be used to prune local records.
 */
async function fetchAllReports({ apiKey, dateFrom = null, maxPages = null } = {}) {
  const pageLimit = maxPages || maxFetchPages();
  const budgetMs = fetchBudgetMs();
  const byId = new Map();
  const startedAt = Date.now();
  let cursor = dateFrom;
  let pages = 0;
  let truncated = false;

  while (pages < pageLimit) {
    const batch = await fetchReports({ apiKey, dateFrom: cursor });
    pages += 1;

    let added = 0;
    let newest = null;
    for (const r of batch) {
      // One physical test arrives as SEVERAL report objects that share `_id`
      // and differ by slot — the same key the injector table is unique on. Key
      // the page cache the same way or sibling injectors are dropped.
      const key = reportKey(r);
      if (!key) continue;
      if (!byId.has(key)) { byId.set(key, r); added += 1; }
      const d = reportDate(r);
      if (d && (!newest || d > newest)) newest = d;
    }

    // The bench has nothing more to give: an empty page, a page we have already
    // seen in full, or reports with no usable timestamp to page on.
    if (batch.length === 0 || added === 0 || !newest) break;

    // `date_from` is inclusive, so the newest report of this page repeats on the
    // next one and is deduped — that repetition is what proves we are done.
    const next = newest.toISOString();
    if (cursor && next <= cursor) break; // no forward progress
    cursor = next;

    if (Date.now() - startedAt > budgetMs) { truncated = true; break; }
    if (pages >= pageLimit) { truncated = true; break; }
  }

  if (pages > 1) {
    const range = reportDateRange([...byId.values()]);
    console.log(`[CarbonZapp] Fetched ${byId.size} report(s) over ${pages} page(s)`
      + `${range.from ? ` covering ${range.from.slice(0, 10)} → ${range.to.slice(0, 10)}` : ''}`
      + `${truncated ? ' (STOPPED on the page/time budget — result is incomplete)' : ''}.`);
  }
  return { reports: [...byId.values()], pages, truncated };
}

/** Lightweight connectivity/auth test that does not persist anything. */
async function testConnection({ apiKey } = {}) {
  const { reports, pages, truncated } = await fetchAllReports({ apiKey });
  const range = reportDateRange(reports);
  const exclusions = summariseExclusions(reports);

  return {
    ok: true,
    count: reports.length,
    pages,
    truncated,
    sampleDate: range.to,
    dateRange: range,
    eligibleCount: reports.length - exclusions.excludedCount,
    exclusions,
  };
}

// ── Import exclusions ─────────────────────────────────────────────────────────
// Import every bench result except an injector whose serial starts with R or
// whose raw bench Job # contains RMA. Job # is used only for this decision and
// is deliberately not stored or exposed by the application.
function jobNumberOf(report) {
  return String((report && (report.job || report.drs_id)) || '').trim();
}

function serialNumberOf(report) {
  return String((report && report.SlotsData && report.SlotsData.sn) || '').trim();
}

function exclusionReasons(report) {
  const reasons = [];
  if (/^R/i.test(serialNumberOf(report))) reasons.push('serial_starts_with_r');
  if (/RMA/i.test(jobNumberOf(report))) reasons.push('job_contains_rma');
  return reasons;
}

function shouldImportReport(report) {
  return exclusionReasons(report).length === 0;
}

function summariseExclusions(reports = []) {
  let serialStartsWithR = 0;
  let jobContainsRma = 0;
  let both = 0;
  let excludedCount = 0;
  for (const report of reports) {
    const reasons = exclusionReasons(report);
    if (!reasons.length) continue;
    excludedCount += 1;
    if (reasons.includes('serial_starts_with_r')) serialStartsWithR += 1;
    if (reasons.includes('job_contains_rma')) jobContainsRma += 1;
    if (reasons.length === 2) both += 1;
  }
  return { excludedCount, serialStartsWithR, jobContainsRma, both };
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
  if (['none', 'any', 'all', '*'].includes(configured.toLowerCase())) return null;
  return configured || FULL_SYNC_FROM_DEFAULT;
}

/**
 * Turn a stored injector_test_reports DB row back into the shape the
 * inspection auto-fill expects (with a parsed `tests` array).
 */
function hydrateInjectorRow(row) {
  let rj = {};
  try { rj = row.report_json ? JSON.parse(row.report_json) : {}; } catch (_) { rj = {}; }
  const hydrated = {
    ...row,
    tests: Array.isArray(rj.tests) ? rj.tests : [],
    report_json: rj,
  };
  // The compatibility column can still exist in older databases, but Job # is
  // no longer part of the application model after the import decision.
  delete hydrated.job_number;
  return hydrated;
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
           machine_name = ?, machine_sn = ?, test_datetime = ?, ext_status = ?, overall_pass = ?, result_status = ?,
           steps_total = ?, steps_passed = ?, steps_failed = ?, report_json = ?, synced_at = ?
         WHERE id = ?`,
        [
          inj.part_number, inj.serial_number, inj.job_number, inj.brand, inj.injector_type,
          inj.machine_name, inj.machine_sn, inj.test_datetime, inj.ext_status, inj.overall_pass, inj.result_status,
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
            machine_name, machine_sn, test_datetime, ext_status, overall_pass, result_status,
            steps_total, steps_passed, steps_failed, report_json, synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, inj.report_ext_id, inj.slot_position, inj.part_number, inj.serial_number, inj.job_number,
          inj.brand, inj.injector_type, inj.machine_name, inj.machine_sn, inj.test_datetime, inj.ext_status,
          inj.overall_pass, inj.result_status, inj.steps_total, inj.steps_passed, inj.steps_failed,
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
 * Remove previously imported rows that the latest bench payload now places
 * outside the import rules. This is keyed by report + slot because one bench
 * test can contain both eligible and excluded injectors under the same report
 * id.
 */
function removeExcludedRows(rawReports = []) {
  let rowsRemoved = 0;
  let inspectionsDeleted = 0;
  let inspectionsKept = 0;

  for (const raw of rawReports) {
    if (shouldImportReport(raw) || !raw || raw._id == null) continue;
    const slot = raw.SlotsData && raw.SlotsData.position != null
      ? Number(raw.SlotsData.position)
      : 0;
    const existing = db.get(
      `SELECT id, inspection_id FROM injector_test_reports
        WHERE report_ext_id = ? AND slot_position = ?`,
      [String(raw._id), slot]
    );
    if (!existing) continue;

    db.run('DELETE FROM injector_test_reports WHERE id = ?', [existing.id]);
    rowsRemoved += 1;

    if (existing.inspection_id) {
      const remaining = db.get(
        'SELECT COUNT(*) AS c FROM injector_test_reports WHERE inspection_id = ?',
        [existing.inspection_id]
      );
      if (!remaining || remaining.c === 0) {
        const outcome = deleteAutoInspection(existing.inspection_id);
        if (outcome === 'deleted') inspectionsDeleted += 1;
        else if (outcome === 'kept') inspectionsKept += 1;
      }
    }
  }

  return { rowsRemoved, inspectionsDeleted, inspectionsKept };
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
 *   1. The bench returned nothing at all → prune NOTHING. An empty response
 *      means "we can't see the bench's data", not "the bench has no data".
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

  console.log(`[CarbonZapp] Sync starting (fullResync=${fullResync}, dateFrom=${dateFrom || 'none'}, exclusions=serial starts R or Job # contains RMA)`);
  // Paged: one request only returns a slice of the bench's history.
  const { reports: fetched, pages: pagesFetched, truncated: fetchTruncated } =
    await fetchAllReports({ apiKey, dateFrom });
  const fetchedRange = reportDateRange(fetched);
  const raw = fetched.filter(shouldImportReport);
  const exclusions = summariseExclusions(fetched);
  // If an existing injector now matches an exclusion, remove that exact slot
  // even during an incremental sync. Shared report ids can contain a mixture
  // of eligible and excluded injectors, so report-id-only pruning is not enough.
  const excludedRemoval = removeExcludedRows(fetched);
  console.log(
    `[CarbonZapp] Fetched ${fetched.length} report object(s) from the bench `
      + `(${exclusions.excludedCount} excluded: ${exclusions.serialStartsWithR} serial-prefix, `
      + `${exclusions.jobContainsRma} RMA-job).`
  );
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

    if (fetchTruncated) {
      // The paged fetch stopped on its budget, so this is not the complete set.
      const impact = stalePruneImpact(presentExtIds);
      if (impact.staleRows > 0) {
        pruneSkipped = {
          reason: 'incomplete_fetch',
          wouldDeleteRows: impact.staleRows,
          wouldDeleteReports: impact.staleReports,
          storedRows: impact.storedRows,
        };
        console.warn(`[CarbonZapp] Full resync could not read the bench's complete history — SKIPPED pruning ${impact.staleRows} injector row(s).`);
      }
    } else if (fetched.length === 0) {
      // Rule 1 — never treat "we got nothing" as "the bench has nothing".
      const impact = stalePruneImpact(presentExtIds);
      if (impact.staleRows > 0) {
        pruneSkipped = {
          reason: 'empty_fetch',
          wouldDeleteRows: impact.staleRows,
          wouldDeleteReports: impact.staleReports,
          storedRows: impact.storedRows,
        };
        console.warn(`[CarbonZapp] Full resync returned no reports — SKIPPED pruning ${impact.staleRows} existing injector row(s). Existing data left untouched.`);
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
    exclusions,
    excludedRowsRemoved: excludedRemoval.rowsRemoved,
    // How much of the bench's history this sync actually saw.
    pagesFetched,
    fetchTruncated,
    dateRange: fetchedRange,
    imported: result.imported,
    updated: result.updated,
    inspectionsCreated,
    reportsDeleted: deletion.reportsDeleted,
    inspectionsDeleted: deletion.inspectionsDeleted + excludedRemoval.inspectionsDeleted,
    inspectionsKept: deletion.inspectionsKept + excludedRemoval.inspectionsKept,
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
  fetchAllReports,
  reportDate,
  reportDateRange,
  testConnection,
  mapReportToInjector,
  normaliseTests,
  hydrateInjectorRow,
  fullSyncDateFrom,
  jobNumberOf,
  serialNumberOf,
  exclusionReasons,
  shouldImportReport,
  summariseExclusions,
  upsertReports,
  syncNow,
  removeExcludedRows,
  clearAllReports,
  reconcileDeletions,
  stalePruneImpact,
  deleteAutoInspection,
  PASS,
  FAIL,
  SKIP,
};
