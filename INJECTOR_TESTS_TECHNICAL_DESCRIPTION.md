# Injector Test Functionality — Technical Description

**Document date:** 2026-10-22
**Code baseline:** `main` at commit `9e53417` ("Match a bench part by the core number it contains")
**Scope:** Everything in the PDI QMS app that concerns fuel-injector testing: retrieving results from the CarbonZapp test bench, storing and classifying them, showing them to the user, every report/export generated from them, repair tracking, analytics, the daily Google Sheet export, configuration, tests and deployment.

Each rule below points to the source file that implements it (`path:line` where useful), so a copy can be checked against the original.

---

## Contents

1. [Overview](#1-overview)
2. [File inventory](#2-file-inventory)
3. [Runtime, dependencies and versions](#3-runtime-dependencies-and-versions)
4. [Configuration](#4-configuration)
5. [Retrieving results from the test bench (CarbonZapp API)](#5-retrieving-results-from-the-test-bench-carbonzapp-api)
6. [Synchronisation](#6-synchronisation)
7. [Normalising a bench report](#7-normalising-a-bench-report)
8. [Test-step naming, codes and error text](#8-test-step-naming-codes-and-error-text)
9. [Result classification (PASS / FAIL / DNF / UNKNOWN)](#9-result-classification-pass--fail--dnf--unknown)
10. [Database schema and migrations](#10-database-schema-and-migrations)
11. [Shop time zone handling](#11-shop-time-zone-handling)
12. [Same-unit serial matching](#12-same-unit-serial-matching)
13. [Server API reference](#13-server-api-reference)
14. [Client: navigation and access control](#14-client-navigation-and-access-control)
15. [Client: Injector Tests page](#15-client-injector-tests-page)
16. [Reports](#16-reports)
17. [Repair tracking](#17-repair-tracking)
18. [Injector Reports (analytics) page](#18-injector-reports-analytics-page)
19. [Daily Google Sheet export](#19-daily-google-sheet-export)
20. [Automated tests](#20-automated-tests)
21. [Deployment](#21-deployment)
22. [Known quirks and inconsistencies](#22-known-quirks-and-inconsistencies)
23. [Reference output for verifying a copy](#23-reference-output-for-verifying-a-copy)
24. [Rebuild checklist](#24-rebuild-checklist)

---

## 1. Overview

The feature is an **admin-only** module of the PDI QMS app (Express + SQLite server, React/Vite SPA). It works like this:

```
CarbonZapp cloud (cloudx.carbonzapp.com)
        │  POST /userapi/v1/client/getReports  (paged by date_from)
        ▼
services/carbonzapp.js ── fetchAllReports → import exclusions → normaliseTests/mapReportToInjector
        │                                                     → injectorResult (4-state scoring)
        ▼
SQLite: injector_test_reports  (1 row per physical injector = bench report _id + slot)
        │
        ├── GET /api/injector-tests ──────────► Injector Tests page (list, filters, selection)
        ├── POST /reports/preview ────────────► on-screen comparison table (modal)
        ├── POST /reports/custom(.xlsx) ──────► Custom Report PDF / Excel workbook
        ├── POST /reports/shipment-evaluation ► Shipment Evaluation PDF
        ├── POST /reports/inspection ─────────► PDI-IQI-012 inspection record(s) → /api/inspections/:id/pdf
        ├── repair routes ────────────────────► injector_repair_* tables (permanent history)
        ├── GET /analytics(.xlsx) ────────────► Injector Reports page / workbook
        └── nightly job (00:05 shop time) ────► Google Sheet: passed injectors of yesterday
```

Design principles the code holds to throughout:

- **Sync only imports test records.** Reports and inspection records are generated explicitly by the user from a selection (`services/carbonzapp.js:829-834`).
- **One row = one physical injector.** A bench test groups several injectors under one `_id`; the slot position separates them. The unique key is `(report_ext_id, slot_position)`.
- **One shared classifier** (`services/injectorResult.js`) decides PASS/FAIL/DNF/UNKNOWN for sync, list filters, reports, analytics and the Google Sheet export.
- **A bench error never renames a test step.** Step names always come from the step code mapping; errors only affect the value shown (`services/injectorSteps.js`).
- **Pass/fail is judged against the GREEN acceptance band** (`min_green…max_green`), not the bench's own `result_pass` flag, which reflects the tighter BLUE target band.
- **All dates are shown, filtered and grouped on the shop clock** (`America/Denver` by default).
- **Repair history is permanent**; the test table is a refreshable cache that can be cleared and re-synced without losing repair data.

---

## 2. File inventory

### Server (`server/`)

| File | Role |
|---|---|
| `routes/injector-tests.js` | All `/api/injector-tests` routes, admin-only guard, list querying/filtering SQL, report request validation, file streaming |
| `services/carbonzapp.js` | Bench API client, paging, import exclusions, normalisation, upsert, pruning, Clear All, settings storage |
| `services/injectorSteps.js` | Step display names, code normalisation, error-text parsing/formatting, measured-value helpers |
| `services/injectorResult.js` | Shared 4-state classifier and scorecard |
| `services/injectorFilters.js` | Criteria normalisation, measurement points, step catalog, step-outcome matching |
| `services/injectorUnits.js` | "Same physical unit" serial matching (260521828A = 260521828 = 828) |
| `services/injectorReports.js` | Selection loading/validation, Custom Report, preview JSON, Shipment Evaluation, inspection generation |
| `services/injectorEvaluation.js` | Shipment evaluation maths (summary, failures by test point, deviation analysis) |
| `services/injectorInspection.js` | Creates/refreshes PDI-IQI-012 inspection records from injector rows |
| `services/injectorExport.js` | Custom Report Excel workbook (exceljs) |
| `services/pdf.js` | All PDF rendering (inspection PDF, injector comparison grid, shipment evaluation) |
| `services/pdfCharts.js` | PDF bar chart, KPI cards, panels |
| `services/reportPagination.js` | Columns-per-page maths for the injector grid |
| `services/injectorRepairs.js` | Repair cases, attempts, changes, retest linking, deltas, Quick Entry, list badges |
| `services/injectorAnalytics.js` | Testing & repair analytics JSON and workbook |
| `services/injectorDailyExport.js` | Daily/backfill export of passed injectors |
| `services/injectorPartNumbers.js` | Bench part → PDI part translation for the sheet |
| `services/googleSheets.js` | Google Sheets service-account client (append rows) |
| `services/dailySchedule.js` | Once-a-day timer on the shop clock |
| `services/timeZone.js` | Shop-clock parsing/formatting/day ranges |
| `db/sqlite.js` | Tables `app_settings`, `injector_test_reports`, `injector_repair_*` and indexes |
| `db/migrations.js` | Injector-related one-time migrations |
| `db/seed.js` | PDI-IQI-012 Fuel Injector inspection template |
| `db/samples/carbonzapp_sample.json` | A real two-injector bench payload (reference) |
| `index.js` | Mounts routes, auto-links retests at start-up, schedules the daily sheet export |
| `assets/pdi-logo.png` | Logo drawn in every report banner |
| `.env.example`, `../render.yaml` | Environment variables |
| `test/injector*.test.js`, `test/googleSheets.test.js`, `test/dailySchedule.test.js`, `test/timeZone.test.js`, `test/reportPagination.test.js`, `test/helpers/{testEnv,benchData}.js` | Server tests |

### Client (`client/`)

| File | Role |
|---|---|
| `src/pages/InjectorTests.jsx` | The Injector Tests page (sync, settings, filters, selection, generate, list, preview modal) |
| `src/pages/InjectorReports.jsx` | Testing & repair analytics page |
| `src/components/InjectorRepairHistory.jsx` | Repair History tab (cases, attempts, forms, retest linker, delta table) |
| `src/components/InjectorQuickEntry.jsx` | Quick Entry modal (six before/after measurements) |
| `src/lib/injectorSelection.js` | Pure helpers: filters, selection/order, outputs/formats, validation, naming |
| `src/lib/injectorDateTime.js` | Shop-clock formatting on the client |
| `src/lib/injectorRepairBadge.js` | Repair badge text per list row |
| `src/lib/syncStatus.js` | Sync / connection result → banner message |
| `src/lib/download.js` | Save dialog / filename prompt / blob writing |
| `src/lib/nav.js`, `src/App.jsx`, `src/components/Sidebar.jsx` | Menu items and route guards |
| `src/lib/utils.js` (`getSharedInspectionKeys`) | Keeps `__injector_source` when an inspection is edited |
| `src/components/inspection/SectionDimensional.jsx` | `single_value` layout used by injector inspections |
| `.env.example` | `VITE_INJECTOR_TIME_ZONE` |
| `test/injector*.test.js`, `test/syncStatus.test.js`, `test/download.test.js`, `test/navigation.test.js` | Client tests |

---

## 3. Runtime, dependencies and versions

- **Node.js 22.5+** with `--experimental-sqlite` (built-in `node:sqlite` `DatabaseSync`). Verified on Node v22.22.0. Global `fetch` and `AbortController` are used for the bench API.
- Server scripts (`server/package.json`): `start` = `node --experimental-sqlite index.js`, `test` = `node --experimental-sqlite --test "test/*.test.js"`.
- Client scripts: `dev` = `vite`, `build` = `vite build`, `test` = `node --test "test/*.test.js"`.

Installed versions resolved from the lockfiles (`npm ci`) that the feature relies on:

| Package | Declared | Installed |
|---|---|---|
| `pdfkit` | ^0.15.0 | 0.15.2 |
| `exceljs` | ^4.4.0 | 4.4.0 |
| `@googleapis/sheets` | ^18.1.1 | 18.1.1 |
| `express` | ^4.19.2 | 4.22.1 |
| `uuid` | ^10.0.0 | 10.0.0 |
| `dotenv` | ^16.4.5 | 16.6.1 |
| `jsonwebtoken` | ^9.0.2 | 9.0.3 |
| `react` | ^18.3.1 | 18.3.1 |
| `@tanstack/react-query` | ^5.51.1 | 5.99.0 |
| `recharts` | ^2.12.7 | 2.15.4 |
| `lucide-react` | ^0.408.0 | 0.408.0 |
| `axios` | ^1.7.2 | 1.15.0 |
| `react-router-dom` | ^6.25.1 | 6.30.3 |
| `vite` | ^5.3.4 | 5.4.21 |
| `tailwindcss` | ^3.4.7 | 3.4.19 |

Theme colours used by the pages come from `client/tailwind.config.js`: `pdi-navy #1D2B4F`, `pdi-navy-light #2A3F72`, `pdi-teal #1A8C80`, etc.

---

## 4. Configuration

### 4.1 Server environment variables

| Variable | Default | Used by | Meaning |
|---|---|---|---|
| `CARBONZAPP_API_KEY` | — | `carbonzapp.getApiKey` | Bench API key. **Takes precedence** over the key saved in the UI; when set, the UI shows the key as "set from a server environment variable" and cannot edit it |
| `CARBONZAPP_TIMEOUT_MS` | `30000` | `fetchReports` | Per-request timeout (AbortController) |
| `CARBONZAPP_MAX_PAGES` | `100` | `fetchAllReports` | Max pages per sync (read per call) |
| `CARBONZAPP_FETCH_BUDGET_MS` | `240000` | `fetchAllReports` | Wall-clock budget per sync (read per call) |
| `CARBONZAPP_FULL_SYNC_FROM` | `2000-01-01T00:00:00.000Z` | `fullSyncDateFrom` | `date_from` sent by a Full Resync; `none`/`any`/`all`/`*` sends no filter |
| `CARBONZAPP_PRUNE_LIMIT_PCT` | `50` | `PRUNE_SHARE_LIMIT_PCT` | Largest share of stored rows a Full Resync may prune without confirmation (read **once at module load**) |
| `INJECTOR_TIME_ZONE` | `America/Denver` | `services/timeZone.js` | Shop clock (IANA zone) |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | — | `googleSheets.target` | Target spreadsheet id |
| `GOOGLE_SHEETS_RANGE` | `Sheet1!A:C` | `googleSheets.target` | A1 range; a tab name with a space must be single-quoted (`'Passed Injectors'!A:C`) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | — | `googleSheets.credentials` | Path to the service-account JSON key (preferred if set) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | — | same | `client_email` (used when no key file) |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | — | same | `private_key`; surrounding quotes stripped, literal `\n` turned into newlines |
| `GOOGLE_SHEETS_ROOT_URL` | — | `googleSheets.client` | Overrides the Google API root (tests/stubs only) |
| `INJECTOR_SHEET_EXPORT_AT` | `00:05` | `index.js` | Daily export time (HH:MM, shop clock) |
| `INJECTOR_SHEET_EXPORT_ENABLED` | `true` | `index.js` | `false` stops scheduling without removing credentials |

Generic app variables needed too: `JWT_SECRET` (required), `SQLITE_PATH`, `UPLOAD_DIR`, `NODE_ENV`, `PORT`, etc.

### 4.2 Client environment variable

| Variable | Default | Meaning |
|---|---|---|
| `VITE_INJECTOR_TIME_ZONE` | `America/Denver` | Shop clock for on-screen times and date filters. Must equal the server's `INJECTOR_TIME_ZONE`. Baked in at build time. |

### 4.3 Values stored in `app_settings`

| Key | Written by | Value |
|---|---|---|
| `carbonzapp_api_key` | `PUT /settings` | The API key (plain text, server-side only) |
| `carbonzapp_last_sync` | `syncNow` | ISO timestamp of the last sync that saw bench data |
| `injector_sheet_export_days` | `markSent` | JSON array of every day already exported (`["2026-10-01", …]`) |
| `injector_sheet_export_last_day` | `markSent` | Newest exported day |
| `injector_sheet_export_last_run` | `markSent` | ISO time of the last export write |

---

## 5. Retrieving results from the test bench (CarbonZapp API)

Implementation: `server/services/carbonzapp.js`.

### 5.1 Endpoint and authentication

```
POST https://cloudx.carbonzapp.com/userapi/v1/client/getReports
Content-Type: application/json
Accept: application/json
Authorization: Bearer <api_key>

{ "api_key": "<api_key>", "date_from": "<ISO>"?, "id": "<id>"?, "id_from": "<id>"? }
```

The key is sent **both** as the Bearer header and as `api_key` in the body (both forms authenticate). Only `date_from` is used by the app; `id` and `id_from` are supported by `fetchReports` but never sent by any caller.

API key source: `process.env.CARBONZAPP_API_KEY || app_settings.carbonzapp_api_key`. No key → error code `NO_API_KEY`, message `CarbonZapp API key is not configured. Add it in Admin → Injector Tests → Settings.`

### 5.2 Response handling (`fetchReports`)

1. Abort after `CARBONZAPP_TIMEOUT_MS` → `CARBONZAPP_TIMEOUT`: `CarbonZapp did not respond within <n>s. Check the bench connection and try again.`
2. Network failure → `CARBONZAPP_NETWORK`: `Could not reach CarbonZapp (<msg>). Check the server's network/firewall access to cloudx.carbonzapp.com.`
3. Body read as text. "Looks like HTML" = matches `/^\s*<(?:!doctype|html)/i` or `/auth0|<title>/i`.
4. `!resp.ok` or HTML → `CARBONZAPP_HTTP_ERROR` (with `status`). If HTML or HTTP 400/401/403/302: `CarbonZapp rejected the request (HTTP <s>). This usually means the API key is invalid or expired — open Settings and re-enter a freshly generated key.` Otherwise: `CarbonZapp API returned HTTP <s>: <first 160 chars, whitespace collapsed>`.
5. Non-JSON → `CARBONZAPP_BAD_RESPONSE`: `CarbonZapp returned a non-JSON response. The API key may be invalid, or the endpoint has changed.`
6. Accepted payload shapes: a JSON array; or an object with an array in `data`, `reports` or `results`; or a single object with `_id` (wrapped into an array). Anything else throws `CarbonZapp API returned an unexpected (non-array) response.`

Route-level HTTP mapping (`mapCarbonzappError`): `NO_API_KEY`→400, `CARBONZAPP_HTTP_ERROR`→502, `CARBONZAPP_TIMEOUT`→504, `CARBONZAPP_NETWORK`→502, `CARBONZAPP_BAD_RESPONSE`→502, anything else→500 with code `CARBONZAPP_ERROR`. Body `{ "error": <message>, "code": <code> }`.

### 5.3 Report object fields the app reads

One array element = one injector in one bench slot. Fields used (all others ignored):

| Field | Use |
|---|---|
| `_id` | `report_ext_id` (shared by every slot of one physical test) |
| `SlotsData.position` | `slot_position` (default 0) |
| `SlotsData.sn` | `serial_number` |
| `actuator_code` | `part_number` (bench spelling, e.g. `6513589PX`) |
| `actuator_Brand` | `brand` (e.g. `Cummins`) |
| `actuator_type` | `injector_type` (e.g. `XPI-CRIN`) |
| `machine_name`, `machine_sn` | bench identity |
| `datetime` (fallback `created_at`) | `test_datetime` — the **test** time, not the later API creation time |
| `status` | `ext_status` |
| `job` (fallback `drs_id`) | Job # — evaluated only for the RMA exclusion, **never stored** |
| `AllTests[]` | the test steps (see below) |

Each `AllTests[]` element:

| Field | Use |
|---|---|
| `TestInfo.test_name` | raw step name, may carry a note: `"eRL : SKIPPED"`, `"iVM.06 : HP ERROR (out of range) #1000"` |
| `TestInfo.test_order` | step order |
| `TestInfo.status` | `1` = skipped |
| `TestInfo.test_category_id` | stored as `category` |
| `TestInfo.rpm`, `hp`, `lp`, `inj_1`, `strk` | conditions text (`RPM 1050 · HP 2400 · LP 0.5 · Inj 1480 · Strk 400`) and `params` (`rail_pressure`=hp, `pulse_width`=inj_1, `strk`) |
| `PrimaryTank`, `SecondaryTank` | measurement tanks (null when not measured) |

Tank fields used: `tank_name` (`[D]`, `[R]`, `[RSP]`), `tank_unit` (`ml/min`, `mm3/STRK`, `usec`), `text_green` (`"8.5 +/- 4.5"`), `min_green`, `max_green`, `target_blue`, `tol_blue`, `AvrResult` (average reading), `results` (`"273.2~273.1~273.0"`), `result_pass` (1 pass / 2 fail / 4 no result — used only as a fallback).

A real payload is committed at `server/db/samples/carbonzapp_sample.json` (bench `ITB.4r-X [S]`, two Cummins XPI-CRIN injectors `26098M455` slot 0 and `26098M447` slot 2, 13 steps each).

### 5.4 Paged fetching (`fetchAllReports`)

The bench returns at most one page per request (observed ≈39 reports), **oldest first**; `date_from` is inclusive and is the only paging handle.

```
cursor = dateFrom; pages = 0; byKey = Map(); truncated = false
while pages < CARBONZAPP_MAX_PAGES:
    batch = fetchReports(date_from = cursor); pages++
    for r in batch:
        key = `${r._id}|${SlotsData.position ?? 0}`        # same key as the table's unique index
        if new key: store, added++
        newest = max(newest, date(r.datetime || r.created_at))
    if batch empty or added == 0 or no newest: break       # nothing new
    next = newest.toISOString()
    if cursor and next <= cursor: break                     # no forward progress
    cursor = next
    if elapsed > CARBONZAPP_FETCH_BUDGET_MS: truncated = true; break
    if pages >= limit: truncated = true; break
return { reports: [...byKey.values()], pages, truncated }
```

`truncated` means the result is incomplete and **must never be used to prune**. When more than one page was read, the server logs `[CarbonZapp] Fetched N report(s) over P page(s) covering YYYY-MM-DD → YYYY-MM-DD`.

### 5.5 Test Connection

`POST /api/injector-tests/test-connection` calls `fetchAllReports` with **no** `date_from` and writes nothing. It returns the count, pages, truncated flag, date range of what came back, `eligibleCount` (count minus exclusions) and the exclusion summary.

---

## 6. Synchronisation

Implementation: `carbonzapp.syncNow({ fullResync, allowLargePrune })`, called by `POST /api/injector-tests/sync`.

### 6.1 Date window

- **Sync Now** (incremental): `date_from` = `carbonzapp_last_sync` minus **5 minutes** (overlap guard). If no previous sync exists, **no `date_from` is sent**.
- **Full Resync**: `date_from` = `fullSyncDateFrom()` (default `2000-01-01T00:00:00.000Z`; see `CARBONZAPP_FULL_SYNC_FROM`). A wide date is used instead of "no filter" because some deployments answer an unfiltered request with an empty array.

### 6.2 Import exclusions (fixed rules)

A report object is **not imported** when either is true (`exclusionReasons`):

| Reason | Rule |
|---|---|
| `serial_starts_with_r` | `SlotsData.sn` trimmed matches `/^R/i` (repair/re-run serials) |
| `job_contains_rma` | `(job || drs_id)` trimmed matches `/RMA/i` |

`summariseExclusions` returns `{ excludedCount, serialStartsWithR, jobContainsRma, both }` (a report matching both counts once in `excludedCount`).

Every read query additionally applies the same rule in SQL (`BASE_EXCLUSIONS`):

```sql
(serial_number IS NULL OR UPPER(TRIM(serial_number)) NOT LIKE 'R%')
AND (job_number IS NULL OR UPPER(job_number) NOT LIKE '%RMA%')
```

### 6.3 Sync steps, in order

1. `fetchAllReports({ dateFrom })`.
2. `raw = fetched.filter(shouldImportReport)`.
3. `removeExcludedRows(fetched)`: any **stored** row whose (report id, slot) now matches an exclusion is deleted; if that leaves its linked inspection with no injector rows, the inspection is deleted via `deleteAutoInspection` (completed inspections are kept).
4. `upsertReports(raw)`: `mapReportToInjector` each; look up `(report_ext_id, slot_position)`; UPDATE all data columns + `synced_at` if it exists, else INSERT with `crypto.randomUUID()` id and `created_at = synced_at = now`. `job_number` is always written as `NULL`.
5. **No inspections are created** (`inspectionsCreated: 0`).
6. Pruning (Full Resync only — an incremental fetch only sees recent reports, so absence proves nothing). `presentExtIds` = the `_id`s of the imported reports. `stalePruneImpact` lists stored `report_ext_id`s not present and counts their rows:
   - fetch `truncated` and stale rows > 0 → skip, `pruneSkipped.reason = 'incomplete_fetch'`
   - else fetch returned **0** objects and stale rows > 0 → skip, `reason = 'empty_fetch'`
   - else if stale rows > 0 and share of stored rows > `PRUNE_SHARE_LIMIT_PCT` (50 %) and not `allowLargePrune` → skip, `reason = 'large_prune'` (with `sharePct`, `limitPct`)
   - otherwise `reconcileDeletions`: delete all rows of each stale report id and `deleteAutoInspection` each linked inspection.
   `pruneSkipped` carries `wouldDeleteRows`, `wouldDeleteReports`, `storedRows`.
7. Marker: `carbonzapp_last_sync = now` **unless** it was a Full Resync that fetched nothing.
8. Response (see §13). The route then runs `autoLinkRetests()` (§17.6) and adds `repairs_linked`.

`deleteAutoInspection(id)`: returns `'missing'` if not found; `'kept'` if `status = 'complete'`; otherwise detaches injector rows (`inspection_id = NULL`), deletes its `inspection_activity_log`, `inspection_attachments`, `inspection_notes` rows and the inspection → `'deleted'`.

### 6.4 Clear All

`DELETE /api/injector-tests` → `clearAllReports()`: `deleteAutoInspection` for every distinct linked inspection, `DELETE FROM injector_test_reports`, delete `carbonzapp_last_sync` (so the next Sync Now is unfiltered). Returns `{ reportsDeleted, inspectionsDeleted, inspectionsKept }`. Repair tables are **not** touched (their FKs to test rows are `ON DELETE SET NULL`).

---

## 7. Normalising a bench report

### 7.1 `normaliseTests(report)` → step objects

For each `AllTests[]` element:

```
parsed   = splitStepName(TestInfo.test_name)            # §8.2
errored  = parsed.errored
skipped  = TestInfo.status == 1 && !errored
errorRaw = errored ? parsed.errorRaw : ''
error_description = errored ? formatErrorDescription(errorRaw) : ''
errorValue        = errored ? formatErrorValue(error_description) : ''
primary   = tankView(PrimaryTank, 'primary')
secondary = SecondaryTank ? tankView(SecondaryTank, 'secondary') : null
```

`tankView(tank, role)` returns `null` when there is no tank and the step did not error; otherwise (with a missing tank treated as `{}`):

| Field | Value |
|---|---|
| `tank_name` | `tank_name` or `''` |
| `unit` | `tank_unit` or `''` |
| `spec` | `text_green` + (` ` + `tank_unit` if present); if no `text_green`, just the unit |
| `target`, `tolerance` | `String(target_blue)`, `String(tol_blue)` or `''` |
| `min_green`, `max_green` | numbers or `null` |
| `results` | raw reading list string |
| `average` | `String(AvrResult)` if numeric; otherwise `errorValue` when errored; else `''` |
| `error` | `errored` |
| `error_description` | as above |
| `status` | `tankStatus(tank)` (below) |
| `role` | `'primary'` / `'secondary'` |

`tankStatus(tank)`: `avr = AvrResult`, `lo = min_green`, `hi = max_green` (numeric or null). If `avr` and at least one bound exist → PASS when `avr >= lo - 1e-6` (if lo) and `avr <= hi + 1e-6` (if hi), else FAIL. Without a green band: `result_pass` 1→pass, 2→fail, else skip.

Preliminary step `status`: `skip`, unless not skipped, primary present and not errored → `fail` if any tank fails, `pass` if any passes, else `skip`. It is then **replaced** by `stepOutcome(step)` (§9).

Step object stored:

```js
{ name, code, display_name, raw_name, order, category, conditions,
  params: { rail_pressure, pulse_width, strk },
  skipped, status, errored, error_description, error_raw,
  internal,            // true for FL(W)
  primary, secondary }
```

- `name` = the step code without the note (`parsed.base`), `code` = `normaliseStepCode(name)`, `display_name` = `stepDisplayName(base, 'primary', PrimaryTank.tank_name)`.

### 7.2 `mapReportToInjector(report)` → row

```js
{ report_ext_id: String(_id), slot_position, part_number: actuator_code, serial_number: SlotsData.sn,
  job_number: null, brand, injector_type, machine_name, machine_sn,
  test_datetime: datetime || created_at, ext_status: status,
  overall_pass, result_status, steps_total, steps_passed, steps_failed,   // injectorScorecard
  tests,
  report_json: { report_ext_id, slot_position, part_number, serial_number, brand, injector_type,
                 machine_name, machine_sn, test_datetime, tests } }
```

`hydrateInjectorRow(row)` parses `report_json` back, sets `row.tests = report_json.tests || []`, and deletes `job_number` from the returned object.

---

## 8. Test-step naming, codes and error text

Implementation: `server/services/injectorSteps.js`.

### 8.1 Code normalisation

`normaliseStepCode(name)`: drop anything after the first `:`; upper-case; remove every non `[A-Z0-9]`; zero-pad a single trailing digit (`IVM1` → `IVM01`). Examples: `iVM.01`, `IVM01`, `IVM 01`, `ivm1` → `IVM01`; `eRL` → `ERL`; `Warm Up` → `WARMUP`; `FL(W)` → `FLW`; `LKT.01` → `LKT01`.

### 8.2 `splitStepName(rawName)`

- No `:` → `{ base: raw, errored: false }`.
- Suffix matches `/^skipped$/i` → `{ skipped: true }`.
- Suffix matches `ERROR_HINTS` **or** base is a known code → `{ errored: true, errorRaw: suffix }`.
  `ERROR_HINTS = /(error|fail|out\s*of\s*range|invalid|timeout|timed\s*out|communication|abort|overflow|no\s*result|not\s*measured)/i`
- Otherwise (unknown note on unknown code) → `base` = whole raw name, not errored.

### 8.3 Display names (`STEP_DISPLAY_NAMES`)

| Code | Display name |
|---|---|
| `ERL` | primary tank `Resistance`, secondary tank `Inductance` |
| `LKT01` | `Leak Test 200 bar` |
| `LKT02` | `Leak Test 1800 bar` |
| `LKT04` | `Leak Test 2400 bar` |
| `WARMUP` | `Warm Up` |
| `IVM01` | `Peak HP` |
| `IVM02` | `Emissions` |
| `IVM03` | `Low Idle` |
| `IVM04` | `Mid-Range` |
| `IVM05` | `Cranking` |
| `IVM06` | `Peak Torque - Delivery` / `Peak Torque - Return` (Return when tank is `[R]` or role is secondary) |
| `RSP` | `Response Time` |
| `ANOP` | `Opening Pressure` |
| `FLW` | `Flush` (internal; never a customer row) |

Rule (`stepDisplayName(rawName, role, tankName)`): IVM06 special case above; object entries pick by role; otherwise label (or the base code when unmapped, never error text) plus the suffix ` [R]` when the tank name (brackets stripped, upper-cased) is `R`. Hence the bench's leak tests (which use an `[R]` tank) print as `Leak Test 200 bar [R]`, and iVM.01's return tank as `Peak HP [R]`.

`IVM_FLOW_CODES = ['IVM01'…'IVM06']` drive the deviation analysis.

### 8.4 Error descriptions and values

`formatErrorDescription(raw)`:
1. empty → `Test Error`
2. named conditions: `/excess\s*return/i` → `Excess Return` (shown **without** the `Error:` prefix)
3. text inside the first parentheses containing a letter; else the raw text with `#<digits>`, the word(s) `error`/`errors`, and `: ; ,` removed
4. remove remaining `#<digits>`, collapse spaces; empty → `Test Error`
5. 1–3 upper-case letters only → `<X> Error` (e.g. `HP Error`)
6. title-case: all-caps words kept, small words (`of the a an and or in to at by for on with from`) lower-case except first.

Examples: `HP ERROR (out of range) #1000` → `Out of Range`; `ERROR: Communication Failure` → `Communication Failure`.

`formatErrorValue(desc)`: named condition → itself; else `Error: <desc>`; empty → `Error: Test Error`.
`isErrorValue(v)`: starts with `error` (case-insensitive) or equals a named condition.
`numericValue(v)`: null for empty / error values / non-finite.

### 8.5 Measured value and the value shown

- `averageOfRawResults(results)`: split on `~ , ; |`, ignore blanks, mean of finite numbers, rounded to the max number of decimals seen (cap 4); null if none.
- `measuredValue(tank)`: `tank.average` if non-empty and not an error value; else the mean of `tank.results`; else `''`.
- `stepResultLines(step, tank)` (what a cell shows):
  - errored and no measurement → `[<error value>]` (e.g. `["Excess Return"]`, `["Error: Out of Range"]`)
  - errored and measurement is **0** → `["No Test", <error value>]`
  - errored with a measurement → `[measured]` (failure shown by colour)
  - not errored → `[measured]` or `[]`
- `stepResultValue` = lines joined with ` / `.

---

## 9. Result classification (PASS / FAIL / DNF / UNKNOWN)

Implementation: `server/services/injectorResult.js`. Constants: `pass`, `fail`, `dnf`, `unknown`, `skip`; `EPS = 1e-6`.

**Tank level**

- `tankWasEvaluated(step, tank)`: a numeric measured value exists, and it is **not** a zero (|v| ≤ EPS) on an errored step (CarbonZapp writes 0/0.0 into interrupted steps that never ran).
- `tankHasDefinedRange(tank)`: `min_green` or `max_green` is numeric.
- `tankOutOfBounds(tank, step)`: evaluated, has a range, and `v < min - EPS` or `v > max + EPS`.
- `measurementOutcome(step, tank)`:
  - no tank → DNF if the step errored, else UNKNOWN
  - errored step → FAIL if out of bounds; PASS if evaluated with a range; else DNF
  - otherwise the tank's `status` (fail/pass/skip) else UNKNOWN

**Step level**

- `stepHasExplicitFailure(step)`: errored → any tank out of bounds; not errored → `step.status === 'fail'` or any tank status `fail`.
- `stepOutcome(step)`: SKIP if skipped; FAIL if explicit failure; DNF if errored; SKIP if status skip; PASS if any measurement passes or status pass; else UNKNOWN.

**Injector level — `injectorOutcome(injector)`**

1. No tests → stored outcome (`result_status` pass/passed, fail/failed, dnf; else `overall_pass` 1/0; else UNKNOWN).
2. Order tests by `order` (then original index). Find the **first errored step** (including FL(W)).
3. If there is one: FAIL if any earlier **customer** step (non-flush) has an explicit failure, or the errored step itself (if not flush) has an explicit failure; otherwise **DNF**.
4. No error: FAIL if any customer step has an explicit failure; PASS if any customer step's outcome is PASS; else stored outcome.

**Scorecard (`injectorScorecard`) — persisted on every row**

- points = customer steps (non-flush) that are not skipped and have a primary tank or errored
- `result_status` = `injectorOutcome`; `overall_pass` = 1 (pass) / 0 (fail) / null (dnf, unknown)
- `steps_total` = points; `steps_passed` = points with outcome PASS; `steps_failed` = points with explicit failure.

Two migrations (`classify_injector_dnf_results`, `reclassify_injector_dnf_zero_no_test_results`) re-score all cached rows with these rules.

---

## 10. Database schema and migrations

SQLite via `node:sqlite`, `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON`. Tables are created in `server/db/sqlite.js` (`migrateSchema` → `tableMigrations`, each `IF NOT EXISTS`).

### 10.1 DDL (verbatim)

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS injector_test_reports (
  id TEXT PRIMARY KEY,
  report_ext_id TEXT NOT NULL,
  slot_position INTEGER NOT NULL DEFAULT 0,
  part_number TEXT,
  serial_number TEXT,
  job_number TEXT,
  brand TEXT,
  injector_type TEXT,
  machine_name TEXT,
  machine_sn TEXT,
  test_datetime TEXT,
  ext_status INTEGER,
  overall_pass INTEGER,
  result_status TEXT,
  steps_total INTEGER DEFAULT 0,
  steps_passed INTEGER DEFAULT 0,
  steps_failed INTEGER DEFAULT 0,
  report_json TEXT NOT NULL DEFAULT '{}',
  inspection_id TEXT REFERENCES inspections(id) ON DELETE SET NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_injector_reports_unique ON injector_test_reports(report_ext_id, slot_position);
CREATE INDEX IF NOT EXISTS idx_injector_reports_datetime ON injector_test_reports(test_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_injector_reports_serial ON injector_test_reports(serial_number);
CREATE INDEX IF NOT EXISTS idx_injector_reports_job ON injector_test_reports(job_number);
CREATE INDEX IF NOT EXISTS idx_injector_reports_identity_datetime
  ON injector_test_reports(part_number COLLATE NOCASE, serial_number COLLATE NOCASE, test_datetime);

CREATE TABLE IF NOT EXISTS injector_repair_cases (
  id TEXT PRIMARY KEY,
  part_number TEXT,
  serial_number TEXT NOT NULL,
  initial_test_id TEXT REFERENCES injector_test_reports(id) ON DELETE SET NULL,
  initial_report_ext_id TEXT,
  initial_slot_position INTEGER,
  initial_test_datetime TEXT,
  initial_result_status TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PASSED', 'SCRAPPED', 'HOLD', 'ENGINEERING_REVIEW')),
  failure_categories_json TEXT NOT NULL DEFAULT '[]',
  opened_at TEXT NOT NULL,
  opened_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  opened_by_name TEXT,
  closed_at TEXT,
  closed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  closed_by_name TEXT,
  final_test_id TEXT REFERENCES injector_test_reports(id) ON DELETE SET NULL,
  final_report_ext_id TEXT,
  final_slot_position INTEGER,
  final_test_datetime TEXT,
  final_result_status TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_injector_repair_cases_identity
  ON injector_repair_cases(part_number COLLATE NOCASE, serial_number COLLATE NOCASE, opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_injector_repair_cases_one_active
  ON injector_repair_cases(part_number COLLATE NOCASE, serial_number COLLATE NOCASE)
  WHERE status IN ('OPEN', 'HOLD', 'ENGINEERING_REVIEW');

CREATE TABLE IF NOT EXISTS injector_repair_attempts (
  id TEXT PRIMARY KEY,
  repair_case_id TEXT NOT NULL REFERENCES injector_repair_cases(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  before_test_id TEXT REFERENCES injector_test_reports(id) ON DELETE SET NULL,
  before_report_ext_id TEXT,
  before_slot_position INTEGER,
  before_test_datetime TEXT,
  before_result_status TEXT,
  after_test_id TEXT REFERENCES injector_test_reports(id) ON DELETE SET NULL,
  after_report_ext_id TEXT,
  after_slot_position INTEGER,
  after_test_datetime TEXT,
  after_result_status TEXT,
  repair_date TEXT NOT NULL,
  technician TEXT NOT NULL,
  technician_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  diagnosis TEXT,
  hypothesis TEXT,
  expected_outcome TEXT,
  observed_outcome TEXT,
  repair_notes TEXT,
  status TEXT NOT NULL DEFAULT 'WAITING_RETEST'
    CHECK (status IN ('WAITING_RETEST', 'COMPLETED')),
  outcome TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (outcome IN ('PENDING', 'PASS', 'FAIL', 'DNF', 'UNKNOWN')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repair_case_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_injector_repair_attempts_case
  ON injector_repair_attempts(repair_case_id, attempt_number);

CREATE TABLE IF NOT EXISTS injector_repair_changes (
  id TEXT PRIMARY KEY,
  repair_attempt_id TEXT NOT NULL REFERENCES injector_repair_attempts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL DEFAULT 1,
  component TEXT NOT NULL,
  action_type TEXT NOT NULL,
  parameter TEXT,
  before_value TEXT,
  after_value TEXT,
  unit TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_injector_repair_changes_attempt
  ON injector_repair_changes(repair_attempt_id, sequence);

CREATE TABLE IF NOT EXISTS injector_repair_result_deltas (
  id TEXT PRIMARY KEY,
  repair_attempt_id TEXT NOT NULL REFERENCES injector_repair_attempts(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_code TEXT,
  step_name TEXT NOT NULL,
  tank_role TEXT NOT NULL,
  before_value REAL,
  after_value REAL,
  absolute_delta REAL,
  percent_delta REAL,
  target_value REAL,
  before_distance_from_target REAL,
  after_distance_from_target REAL,
  correction_effectiveness REAL,
  before_status TEXT,
  after_status TEXT,
  spec_min REAL,
  spec_max REAL,
  unit TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repair_attempt_id, step_key)
);
CREATE INDEX IF NOT EXISTS idx_injector_repair_deltas_attempt
  ON injector_repair_result_deltas(repair_attempt_id);
```

Also run on every start (ignored if it already exists): `ALTER TABLE injector_test_reports ADD COLUMN result_status TEXT`.

### 10.2 One-time migrations (`server/db/migrations.js`, tracked in `schema_migrations`)

| Id | Effect |
|---|---|
| `repair_injector_test_reports_schema` | If the table exists but lacks `report_ext_id`/`id`: DROP and recreate it (it is a re-fetchable cache). Otherwise ALTER-add any missing column. Re-create the three main indexes. |
| `classify_injector_dnf_results` | Re-score every cached row with `injectorScorecard` |
| `reclassify_injector_dnf_zero_no_test_results` | Same again (fixes zero-placeholder misclassification) |
| `repair_app_settings_schema` | Create/patch `app_settings` |
| `injector_reports_job_number_index` | Add `idx_injector_reports_job` on existing DBs |
| `injector_repair_history_v1` | Assert the repair tables exist; `PRAGMA optimize` |

Migrations run after `app.listen` in `server/index.js`.

### 10.3 The PDI-IQI-012 template

Seeded in `server/db/seed.js` (and inserted by `_migrateNewTemplates` for older DBs): `component_type 'fuel_injector'`, `form_no 'PDI-IQI-012'`, title `PDI Incoming Quality Inspection — Fuel Injector`, `form_type 'iqi_standard'`, `disposition_type 'pass_fail'`, header `['part_number','po_number','description','date_received','inspector_name','lot_serial_no']`. Sections:

- `receiving` — `A. RECEIVING & DOCUMENTATION VERIFICATION`, `pfn_checklist`, 5 items: Outer Carton Condition, Box / Package Label, Part Marking, Quantity Verification, Corrosion / Contamination Protection.
- `visual` — `B. VISUAL INSPECTION`, `pass_fail_checklist`, 8 items: Injector Body, Nozzle Tip, Sealing Cone / Seat, Threads & Fuel Ports, Electrical Connector, O-Rings & Seals, Filter Screen / Inlet, External Surfaces (requirement texts in `seed.js:355-362`).
- `dimensional` — `C. DIMENSIONAL INSPECTION`, `dimensional`, one placeholder row "Test Bench Results" (replaced per inspection).

---

## 11. Shop time zone handling

Server `services/timeZone.js` and client `src/lib/injectorDateTime.js` implement the same rules.

- Accepted timestamps: `/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i`. **No zone marker means UTC** (SQLite's own format). Impossible dates/times are rejected.
- A **date-only** value is a calendar day and is never shifted.
- `zonedTestDate(value)` → `YYYY-MM-DD` on the shop clock (via `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', … })`). This decides which day a test belongs to everywhere (filters, report date ranges, exports, analytics buckets).
- `formatZonedDateTime` / `formatInjectorTestDateTime` → `MM/DD/YY, hh:mm AM|PM` (12-hour, zero-padded; midnight and noon print as `12`). Date-only → `MM/DD/YY`. Client returns `—` for blank and the raw text for unparseable values; optional `withZone` appends `MST`/`MDT`.
- `zonedDayRange(day)` → `{ from, to }` ISO instants for `[00:00 that day, 00:00 next day)` in the zone (23/24/25 hours across DST). Date filters compare with `datetime(test_datetime) >= datetime(from)` and `< datetime(to)`.
- `zonedTimeToInstant(day, {hour, minute})`: two-pass offset solve; a repeated time resolves to its first occurrence, a skipped time (spring forward) to the instant the clock jumps to.
- `currentZonedDay`, `previousDay`, `zoneLabel` helpers.

---

## 12. Same-unit serial matching

`server/services/injectorUnits.js`. Technicians type serials by hand, so one unit can appear as `260521828A`, `260521828` or `828`. Two serials are the same unit when the **part numbers match** (trimmed, case-insensitive) and:

1. case, spaces and separators are ignored (`normaliseSerial`: upper-case, strip non `[A-Z0-9]`);
2. a **trailing** letter suffix is ignored (`serialCore`); leading letters are kept;
3. an all-digit serial of **≥ 3 digits** matches the full serial it ends — only when **exactly one** full serial of that part ends with it (otherwise it stays on its own).

`unitResolver(serials)` indexes every all-digit core under each ending of 3+ digits; `unitKeyer(rows)` gives `JSON.stringify([part, unitKey])`; `sameUnitSerials(serial, serials)`; `sameUnitRows(tokens, rows)`.

Used by: the list's serial filter (adds `(part_number IS ? AND serial_number = ?)` clauses and tags rows with `serial_unit_match`), repair case identity, retest candidates, and analytics unique-injector counts.

---

## 13. Server API reference

All routes are mounted at `/api/injector-tests` behind `authMiddleware` (Bearer JWT, user must be active) and then `requireAdmin`: **only `role === 'admin'`** passes; anyone else gets HTTP 403 `{ "error": "Unauthorized", "code": "INTERNAL_ERROR" }`. Errors use `{ error, code }`. Route order matters only in that fixed paths are declared before `/:id/...`.

### 13.1 Listing and settings

**`GET /`** — the injector list.
Query (snake_case or camelCase alias): `search`; `part_number`/`partNumbers` (list); `serial_number`/`serialNumbers` (list); `status`/`statuses` (list of `pass|passed|fail|failed|dnf|unscored|unknown`); `date_from`/`dateFrom`, `date_to`/`dateTo` (shop days); `steps`/`step_codes` (list of measurement-point codes); `step_status`/`stepStatus` (`fail` default, `pass`, `dnf`, `any`); `step_match`/`stepMatch` (`any` default, `all`). Lists split on commas, semicolons, pipes and whitespace, de-duplicated case-insensitively.

SQL: `SELECT <columns> FROM injector_test_reports WHERE <BASE_EXCLUSIONS> <filters> ORDER BY datetime(test_datetime) DESC, part_number ASC, serial_number ASC, report_ext_id ASC, slot_position ASC`. Filters: `search` → `part_number LIKE %s% OR serial_number LIKE %s%`; parts → any `LIKE %t%`; serials → any `LIKE %t%` OR same-unit pairs; statuses → `result_status = ?` (`unknown` = `result_status IS NULL OR = 'unknown'`); dates via `zonedDayRange`. Step criteria are applied in JavaScript over hydrated rows (`report_json` is only selected when a step filter is active).

Response:
```json
{ "injectors": [ { "id", "report_ext_id", "slot_position", "part_number", "serial_number", "brand",
                   "injector_type", "machine_name", "machine_sn", "test_datetime", "ext_status",
                   "overall_pass", "result_status", "steps_total", "steps_passed", "steps_failed",
                   "inspection_id", "synced_at",
                   "repair_case_id"?, "repair_case_status"?, "repair_attempt_number"?, "repair_attempt_status"?,
                   "retest_of_attempt"?, "retest_outcome"?,      // §17.7
                   "serial_unit_match"?: ["828"],                 // typed serials matched as the same unit
                   "matched_steps"?: ["Peak Torque - Return"] } ],// only with a step filter
  "total": 1203, "filtered": 42, "lastSync": "<iso>|null", "hasApiKey": true }
```
`total` counts all non-excluded rows; job numbers are never returned.

**`GET /steps`** — measurement-point catalog for the step filter: `{ steps: [{ code, label, total, pass, fail, dnf, other, order }], injectorCount }`. A measurement point is a customer step code, except IVM06 which is two points `IVM06-D` (primary) and `IVM06-R` (secondary). Ordered by the earliest bench `test_order` seen, then first-seen.

**`GET /settings`** → `{ hasApiKey, apiKeyMasked: "••••••••" + last 4 | null, apiKeyFromEnv, lastSync, exclusions: { serialStartsWith: "R", jobContains: "RMA" }, fullSyncFrom }`.

**`PUT /settings`** body `{ api_key }` (string, ≥ 8 chars after trim; else 400 `VALIDATION_ERROR` "A valid API key is required.") → `{ ok: true, apiKeyMasked }`.

**`POST /test-connection`** → `{ ok, count, pages, truncated, sampleDate, dateRange: { from, to }, eligibleCount, exclusions }`.

**`POST /sync`** body `{ full_resync?: bool, allow_large_prune?: bool }` →
```json
{ "ok": true, "fetched": <imported-eligible count>, "fetchedTotal": <objects from bench>,
  "exclusions": { "excludedCount", "serialStartsWithR", "jobContainsRma", "both" },
  "excludedRowsRemoved", "pagesFetched", "fetchTruncated", "dateRange": { "from", "to" },
  "imported", "updated", "inspectionsCreated": 0, "reportsDeleted", "inspectionsDeleted", "inspectionsKept",
  "pruneSkipped": null | { "reason": "incomplete_fetch|empty_fetch|large_prune", "wouldDeleteRows",
                           "wouldDeleteReports", "storedRows", "sharePct"?, "limitPct"? },
  "storedRows", "fullResync", "lastSync", "repairs_linked" }
```

**`DELETE /`** (Clear All) → `{ ok, reportsDeleted, inspectionsDeleted, inspectionsKept }`.

### 13.2 Reports

Common selection rules (`resolveSelection`): body `injector_ids` must be a non-empty array (400 "Select at least one injector."), at most **500** (400 "Select at most 500 injectors for one report."). Rows are loaded **in the given order** with the SQL exclusions; ids that no longer exist are dropped; none left → 404 `NOT_FOUND` "No matching injectors found. Refresh the list and try again." `validateSelection` blocks injectors with no scorable steps (non-flush steps with a primary tank): 400 `"<n> selected injector(s) have no test-bench results and cannot be included in a report: <first 5>[ and N more]. Re-sync the test bench or clear them from the selection."`; it warns (non-blocking) `"<n> selected injector(s) have no serial number; their report column is labelled "—"."` and `"<n> selected injector(s) have no part number."`. Unexpected failures are logged with user id/role and returned as 500 `REPORT_GENERATION_FAILED` "The report could not be generated. Please try again; if it keeps failing, contact support."

File responses set `Content-Type`, `Content-Disposition: attachment; filename="<f>"`, `X-Report-Filename: <f>`, `X-Report-Warnings: <encodeURIComponent(warnings joined by space)>` (only when warnings exist), `Access-Control-Expose-Headers: X-Report-Filename, X-Report-Warnings`.

| Route | Body | Returns |
|---|---|---|
| `POST /reports/preview` | `{ injector_ids }` | `{ ok, preview, warnings }` — JSON only, no file, no inspection (§16.2) |
| `POST /reports/custom` (aliases `/reports/customer`, `/report`) | `{ injector_ids, vendor_name? (≤120) }` | Custom Report PDF, filename `CustomReport_<sanitised first part>_<count>.pdf` |
| `POST /reports/custom.xlsx` | same (vendor sliced to 120) | Workbook, `CustomReport_<numeric first part>_<count>.xlsx` |
| `POST /reports/shipment-evaluation` (alias `/reports/supplier-evaluation`) | `{ injector_ids, vendor_name }` — **required**, ≤120 | PDF `ShipmentEvaluation_<part>_<vendor>_<count>.pdf` |
| `POST /reports/inspection` | `{ injector_ids }` | `{ ok, inspections: [{ inspection_id, report_ext_id, created, injector_count, part_number, serial_numbers, filename }], created, updated, warnings }` |

Vendor errors: "A vendor name is required for the Shipment Evaluation Report." / "The vendor name is too long (120 characters maximum)." (400 `VALIDATION_ERROR`). `sanitiseFilePart`: replace `[^a-zA-Z0-9._-]` with `_`, collapse `__`, trim `_`.

The inspection PDF is fetched separately from the existing **`GET /api/inspections/:id/pdf`** (filename `QC_<part>_<lot_serial_no>.pdf`).

### 13.3 Repairs (see §17)

| Route | Body | Returns |
|---|---|---|
| `GET /:id/repair-history` | — | `{ test, cases, active_case_id, candidate_retests, can_start, options: { components, actions } }` |
| `GET /:id/quick-entry` | — | `{ measurements, can_save, reason, attempt_number, links_previous_retest }` |
| `POST /:id/quick-entry` | `{ measurements: [{ key, before_value, after_value, unit }], repair_date?, notes? }` | 201 `{ ok, repair_case }` |
| `POST /repairs/cases` | `{ initial_test_id, failure_categories?: [], attempt: {...} }` | 201 `{ ok, repair_case }` |
| `GET /repairs/cases/:id` | — | the case (404 "Repair case not found.") |
| `POST /repairs/cases/:id/attempts` | attempt object | 201 `{ ok, repair_case }` |
| `PATCH /repairs/cases/:id/status` | `{ status: OPEN|HOLD|ENGINEERING_REVIEW|SCRAPPED }` | `{ ok, repair_case }` |
| `POST /repairs/attempts/:id/retest` | `{ after_test_id, observed_outcome? }` | `{ ok, repair_case }` |

Attempt object: `{ repair_date (ISO), technician, diagnosis, hypothesis?, expected_outcome?, repair_notes?, changes: [{ component, action_type, parameter?, before_value?, after_value?, unit?, notes? }] }`.

### 13.4 Analytics and sheet export

| Route | Notes |
|---|---|
| `GET /analytics?date_from&date_to&part_number&interval` | `interval` = `day|week|month` (default `week`); returns the analytics report plus `definitions` (§18) |
| `GET /analytics/export.xlsx` | Same query; attachment `Injector-Repair-Analytics.xlsx` |
| `GET /exports/google-sheet` | `{ configured, missing, spreadsheetId, range, serviceAccount, timeZone, lastExportedDay, lastRunAt, columns, nextDay, pendingRows }` |
| `POST /exports/google-sheet` | `{}` (yesterday) / `{ day }` / `{ from, to }` / `{ month: true }`, plus `dry_run`, `force` (§19) |

---

## 14. Client: navigation and access control

`client/src/lib/nav.js` `NAV_ITEMS` — the two injector items come directly after Admin:

```js
{ to: '/injector-tests',   icon: 'gauge', label: 'Injector Tests',   adminOnly: true, roles: ['admin'] },
{ to: '/injector-reports', icon: 'chart', label: 'Injector Reports', adminOnly: true, roles: ['admin'] },
```

`isNavVisible`: an item with `roles` is visible only to those roles (so `qc_manager` and `inspector` never see them). Sidebar icons: `gauge` → lucide `Gauge`, `chart` → `BarChart2`.

`App.jsx` routes (inside the authenticated `Layout`):

```jsx
<Route path="injector-tests"   element={<RoleRoute path="/injector-tests"><InjectorTests /></RoleRoute>} />
<Route path="injector-reports" element={<RoleRoute path="/injector-reports"><InjectorReports /></RoleRoute>} />
```

`RoleRoute` uses `canAccessRoute(path, getUser())` (same rule as the menu) and redirects to `/` otherwise. The Reports page shows a link "Injector testing & repairs" to `/injector-reports` for admins.

HTTP client: axios instance `baseURL '/api'`, Bearer token from `localStorage.pdi_token`; a 401 clears auth and redirects to `/login`.

---

## 15. Client: Injector Tests page

File: `client/src/pages/InjectorTests.jsx`. Container `min-h-full bg-gray-50` → `mx-auto max-w-[1600px] px-3 sm:px-6 pt-4 sm:pt-8 pb-12 sm:pb-16 space-y-4 sm:space-y-5`. All touch targets are ≥ 44 px on mobile (`min-h-[44px] sm:min-h-[40px]`).

### 15.1 Data loading (TanStack Query)

| Query key | Request | Notes |
|---|---|---|
| `['injector-tests', listQuery]` | `GET /injector-tests` with `buildInjectorQuery(settledFilters)` | `placeholderData: previous` keeps rows visible while refetching |
| `['injector-tests-settings']` | `GET /injector-tests/settings` | |
| `['injector-tests-steps']` | `GET /injector-tests/steps` | step catalog |

Filters are held in one object (`emptyFilters()`: `partNumber, serialNumber, status, dateFrom, dateTo, steps: [], stepStatus: 'fail', stepMatch: 'any'`). The server is re-queried after typing settles for **300 ms** (`FILTER_DEBOUNCE_MS`); meanwhile `filterInjectors(injectors, filters)` re-applies the row-level filters on the client so typing feels instant (step filters are server-only). `buildInjectorQuery` only sends set filters (`part_number`, `serial_number` comma-joined; `status`; `date_from`; `date_to`; `steps`, `step_status`, `step_match` only when steps are chosen).

The client list is sorted newest first (`sortByTestDate`: `Date.parse(test_datetime)` desc, then part, then serial).

### 15.2 Layout, top to bottom

1. **Header** — `h1` "Injector Tests" with `Gauge` icon (navy); a bordered link button "Testing & Repair Analytics" (`BarChart3`) to `/injector-reports`; subtitle "Import results from the CarbonZapp test bench, then select injectors and generate reports."
2. **Sync toolbar** — buttons: **Sync Now** (navy, `RefreshCw` spinning while syncing, label "Syncing…"); **Full Resync** (navy outline; tooltip "Fetch the complete report set and reconcile any reports deleted from the test bench"); **Settings** (toggles the settings panel); **Clear All** (red outline; tooltip "Delete all synced reports and the inspections generated from them (completed inspections are kept)"). Sync/Full/Clear are disabled while syncing or clearing. Right side: "Last sync: <browser-local toLocaleString>" or "Never synced", plus amber "· No API key" when none.
3. **Status banner** — `statusMsg { type, text }`: error (red, `AlertTriangle`), success (green, `CheckCircle2`), warning (amber, `AlertTriangle`), info (blue, spinning `Loader2`); dismiss `X`.
4. **Held-back prune panel** (amber, `ShieldAlert`) when the last Full Resync returned `pruneSkipped.reason === 'large_prune'`: "<rows> of <stored> records are no longer on the test bench" / "That is <pct>% of your injector records — more than the <limit>% safety limit — so nothing was deleted. …". Buttons: **Remove them** (re-runs Full Resync with `allow_large_prune: true`), **Run the resync again**, **Keep them** (dismiss).
5. **Clear-all confirmation** (red): "Clear all synced reports?" explanation that completed inspections are kept; **Yes, clear all** / **Cancel**.
6. **Settings panel** (white card) — "CarbonZapp Test Bench Settings". If `apiKeyFromEnv`: note that the key comes from `CARBONZAPP_API_KEY` and cannot be edited. Otherwise "Current key: ••••••••abcd." + password input "CarbonZapp API key" + **Save Key** (client requires ≥ 8 chars; success toast "API key saved", panel closes). **Test Connection** (disabled without a key) — "Verifies the key can reach the bench without importing anything." Import rules text (serial beginning with `R`, Job # containing `RMA`), "Full resync window: from YYYY-MM-DD" (or "no date filter sent") and a hint about `CARBONZAPP_FULL_SYNC_FROM`.
7. **Filter + generate card** (white):
   - Filter grid (1 / 2 / 3 columns, 6 at 2xl): "Part number(s)…" and "Serial number(s)…" inputs with search icons (several values separated by commas/spaces; pasting a spreadsheet column works); `From` / `To` date inputs (each bounds the other); status select (All statuses / Passed / Failed / DNF / No result → values `''|pass|fail|dnf|unscored`); **Test steps** menu (§15.3).
   - Summary line: "Showing **N** of T injectors[ · filtering…]", one pill per active filter (`describeActiveFilters`, e.g. "Part 6513589", "Serial 828", "Result Failed", "Tested 2026-10-01 – 2026-10-14", "Failed any of Peak Torque - Return, Low Idle"), "Clear filters" link; right: **Select all visible** / **Deselect visible**, **Clear selection**.
   - **Generate** block: caption "select injectors first" or "N injectors selected" + "hide order/arrange order" toggle. Output toggles (multi-select, navy when active): **Preview** (`Eye`, "Show the report on screen"), **Report** (`FileText`, "Custom Report — Excel or PDF"), **Inspection** (`FileText`, "Fuel Injector inspection record (PDF)"), **Evaluation** (`BarChart3`, "Shipment Evaluation (PDF)"). "Report format" toggles (teal when active): **Excel** (`FileSpreadsheet`), **PDF** (`FileDown`) — disabled until Preview or Report is chosen; hint "Applies to Preview and Report. Inspection and Evaluation are always PDF." / "Pick Preview or Report to choose a file format." **Generate** button (`Play`/spinner) enabled when ≥1 injector is selected, outputs are valid and nothing is running; a description of the chosen outputs (`describeOutputs`, e.g. "Preview, Report (Excel + PDF), Evaluation") and a "Clear" link.
   - Inline messages: amber output issue ("Choose at least one of Preview, Report, Inspection or Evaluation." / "Choose Excel or PDF for the report."), red selection blocker, amber selection warnings.
8. **Report order panel** ("Selected Injectors · Report Order", shown by default when something is selected): numbered navy circles (position 1 = first report column), "<part> · SN <serial>", "Tested <MM/DD/YY, hh:mm AM>", up/down arrows, remove `X`, HTML5 drag-and-drop between rows (target highlighted teal), **Sort by serial** (natural order, blanks last), **Clear**.
9. **Test Results list** (§15.4).
10. **Preview modal** and **Quick Entry modal** when open.

Selections persist across filter changes: the page keeps the full record of every selected injector (`selectedRecords`) even when a filter hides it. `selectedIds` order is the report column order; a newly ticked injector is appended.

### 15.3 Test step filter menu (`StepFilterMenu`)

A dropdown button showing "Test steps" or "<Failed|Passed|Did not finish|Was tested> · N steps" (navy styling when active). Panel (w-80, closes on outside click / Escape): "Show injectors that [Failed | Passed | Did not finish | Was tested]"; when ≥2 steps are ticked, a segmented control "any of these steps / all of these steps"; checkbox list of catalog points (label + count for the chosen outcome: fail/pass/dnf/total); "No test steps yet — sync the test bench first." when empty; "Clear test step filter".

Server matching (`matchesStepCriteria`): for each selected code, look up the injector's measurement point; `any` outcome means "point exists"; otherwise the point's outcome must equal the wanted one (IVM06-D/-R use `measurementOutcome`, other codes `stepOutcome`). `stepMatch = all` requires every code to match. Unknown codes match nothing.

### 15.4 Test Results list (`InjectorList`)

Header: "Test Results", "<n> results · newest first · times in Mountain Time", hint "Tick a row to build a report · tap a serial number to preview it".

Desktop table (md+): columns `[select] | Part Number | Serial Number | Flow Results | Tested | Repair`. Mobile: cards with the checkbox, part, flow badge, "SN <serial button>", matched steps, tested time, Quick Entry button. Selected rows get `bg-pdi-navy/5`.

- **Checkbox** inside a 44×44 label; toggles selection only.
- **Serial number button** (dotted underline + `Eye`) opens the **quick preview** of that one injector; `stopPropagation` so selection is untouched.
- **Flow badge** (`InjectorFlowBadge`): no results or unknown → grey "No result"; otherwise pill `Passed` (green, `CheckCircle2`), `DNF` (orange, `AlertTriangle`) or `Failed` (red, `XCircle`) + "<steps_passed>/<steps_total> steps" + repair badge (§17.7).
- **Matched steps**: small navy chips with the step labels the step filter matched.
- **Tested**: `formatInjectorTestDateTime`.
- **Repair**: **Quick Entry** button (`Wrench`).

Empty states: "No injector tests synced yet. Click "Sync Now" to pull results from the test bench." / "No injectors match the current filters." / "No injectors to show." Loading: "Loading…".

### 15.5 Preview modal (`ReportPreviewModal`)

One component for both previews. Overlay `fixed inset-0 bg-black/50` with safe-area padding (`.overlay-safe-padding`); dialog `max-w-7xl`, closes on backdrop mouse-down, `X`, Escape and the footer button; body scroll is locked while open.

- Header: title (quick preview = `SN <serial> · <part>`; selection preview = preview title "Custom Report Preview"); subtitle (quick: "Quick preview — this injector only. Nothing has been generated or selected."; selection: "<n> injectors, in report order. Preview only — no PDF or inspection has been created.").
- Quick preview only: tabs **Test Results** / **Repair History** (teal underline); Quick Entry's "View Repair History" opens the preview on the Repair History tab.
- Info strip: "Part: <numeric parts>", "Brand: <brands>", "Test date: <from> – <to>".
- Table: navy sticky header; sticky first column "Test Step"; "Specification" (`<min> - <max> <unit>`); one column per injector with `<part>` over `SN <serial>`; cells show each value line; styling: DNF `bg-orange-50 font-semibold text-orange-700`, error or fail `bg-red-50 font-semibold text-red-700`, pass `text-green-700`, else gray. Final row "Overall Result" (`PASS` green / `FAIL` red / `DNF` orange).
- Footer button "Close Preview" (or "Close Details" for a quick preview).

A token (`quickPreviewToken`) discards stale responses when another row is opened or the modal is closed.

### 15.6 Generate run (`runOutputs`)

1. Ignore repeated clicks (`generatingRef`). Validate outputs and selection (client mirrors server rules: blocked when any selected injector has `steps_total == 0`: "<n> selected injector(s) have no test-bench results: … Remove them from the selection or re-sync the test bench.").
2. If **Evaluation** is chosen: `window.prompt('Vendor name for the Shipment Evaluation Report', <last vendor>)`. Cancel → toast "Cancelled — nothing was generated"; empty → error "A vendor name is required for the Shipment Evaluation Report." The vendor is remembered for the next run. (Custom Report never prompts; it falls back to the bench brand.)
3. If any file will be produced (`producesFiles`: a format chosen with Preview/Report, or Inspection, or Evaluation): `chooseSaveTarget(suggestReportName('InjectorReport', selection, { vendor }))` — suggested stem `InjectorReport_<first part>_<vendor>_<count>` (spaces → `-`). Uses `window.showSaveFilePicker` when available (extension `.xlsx` only when Excel without PDF, else `.pdf`), else `window.prompt('Base file name for this run', …)`. Cancel → nothing is requested.
4. Requests, in this order, with the ids in panel order:
   - Preview → `POST /reports/preview`, opens the modal.
   - each chosen format (Excel then PDF) → `POST /reports/custom.xlsx` / `POST /reports/custom` (`responseType: 'blob'`, body includes `vendor_name`).
   - Inspection → `POST /reports/inspection`, then for each returned inspection `GET /inspections/:id/pdf` (blob); invalidates the list query.
   - Evaluation → `POST /reports/shipment-evaluation`.
5. File naming (`deriveFilename(chosenName, suffix, ext)`): with one document kind the chosen name is used as-is (Excel and PDF differ by extension); with several kinds suffixes `_Report`, `_Inspection`, `_Evaluation` are added; several inspections add `-1`, `-2`… (e.g. `Base_Inspection-2.pdf`, or `Base_2.pdf` if inspections are the only kind). Only the first file whose extension matches the picked handle is written through the handle; others download via an `<a download>` link. Server filenames (`X-Report-Filename`) are not used.
6. Banner: "<outputs> generated for <n> injectors — saved <files>." (warning type with server warnings appended from `X-Report-Warnings` / `warnings`); toast "<outputs> generated". Errors: blob error bodies are parsed for `error`; banner + toast "Generate failed: <msg>".

### 15.7 Sync and connection messages (`client/src/lib/syncStatus.js`)

`describeSyncResult(res, { fullResync })` precedence:

| Condition | Type | Text (abridged) / toast |
|---|---|---|
| `pruneSkipped.reason = incomplete_fetch` | warning | "The bench's history was too large to read in one go, so this resync only saw part of it (covering …) — N records were left in place rather than deleted. Imported X new and updated Y record(s). Run the resync again to continue, or raise CARBONZAPP_MAX_PAGES on the server." / "Partial resync — nothing was deleted" |
| `empty_fetch` | warning | "Full resync imported nothing, so your existing N records were left untouched (nothing was deleted). The bench returned no reports at all — check the API key, …" |
| `large_prune` | warning | "Imported X new and updated Y record(s). The bench no longer lists N records of your S (P%) — more than the L% safety limit — so they were NOT removed. Confirm below if the bench really did drop them." |
| fetched 0, excluded > 0 | warning | "The bench returned N reports (covering …), but none were imported: <exclusions>." |
| fetchedTotal 0 | info | Full: "Full resync succeeded, but the bench returned no reports. …"; else "Sync succeeded, but the bench has no new reports since the last sync." / "No new reports from the test bench" |
| otherwise | success | "Synced N reports (covering A → B, P pages): X new, Y updated." + exclusions sentence + "Removed N previously imported record(s) that now matches an exclusion rule." + prune sentence + "N injector records available." + "No inspection reports were created — select injectors below and generate reports." / toast "Synced X new / Y updated test record(s)" |

`linkedRepairsMessage(n)` appends "Linked N new retest(s) to their repairs." `describeConnectionResult`: "Connection OK — the bench returned N reports (covering …). E reports eligible for import; <exclusions>." (+ truncated hint about `CARBONZAPP_MAX_PAGES`); warning type when everything was excluded. A `NO_API_KEY` sync error opens the Settings panel with "No API key configured — open Settings and add your CarbonZapp API key."

After sync/clear the page invalidates `injector-tests`, `injector-tests-steps`, `injector-tests-settings` (and `injector-repair-history` when retests were linked). Clear All also empties the selection.

---

## 16. Reports

All injector-grid PDFs share: pdfkit, **Letter landscape** (792 × 612 pt), margin `INJ_LM = 28`, usable width 736, `bufferPages: true`, fonts Helvetica / Helvetica-Bold. Palette (`services/pdf.js`): NAVY `#1D2B4F`, TEAL `#1A8C80`, RED `#C0392B`, GREEN `#27AE60`, AMBER `#D4943A`, BLACK `#111827`, DGRAY `#374151`, MGRAY `#6B7280`, LGRAY `#9CA3AF`, BORDER `#D1D5DB`, ROWALT `#F9FAFB`, THBG `#E5E7EB`, SECBG `#EEF2F7`, WHITE.

Selected injectors are shaped by `toReportInjectors` (`id, part_number, serial_number, brand, injector_type, machine_name, machine_sn, test_datetime, overall_pass, result_status, tests`) and keep the user's order.

### 16.1 Shared banner (`drawInjectorBanner`)

- Navy rectangle at (28, 28), 736 × 60.
- Logo `server/assets/pdi-logo.png`: height 34, `fit [110, 34]`, at x+14, vertically centred (a missing logo never fails a report).
- Title: Helvetica-Bold 16 white at `x = left + 110 + 24`, `y = top + (60-16)/2 - 2`, single line with ellipsis.
- Right block, width `min(260, max(150, width*0.36))`, right-aligned, ending 14 pt from the edge, starting at `top + 9` (or `top + 5` with a page line):
  - `Part: <numeric part numbers>` — Helvetica-Bold 9.5 white. `numericPartNumber` strips every non-digit (`6513589PX` → `6513589`); duplicates removed **after** stripping; `—` if none.
  - `Vendor: <vendor or —>` — Helvetica 8 `#A5B4C8` (+13).
  - `Report Date: MM/DD/YYYY` — today (UTC date of `toISOString`) (+11).
  - optional page line — Helvetica-Bold 8 `#A5B4C8` (+11): `Page X of Y · Injectors a–b of N`.

### 16.2 Comparison model (`buildInjectorComparisonModel`)

- Rows are keyed `"<step code>|1"` (primary tank) and `"<step code>|2"` (secondary), in first-seen order across the **whole selection**; steps without a primary tank and the FL(W) flush step never get a row.
- Row: `{ label: stepLabel(step, role, tank_name), spec, min: min_green, max: max_green, unit }`. If the first injector seen lacks a band/spec/unit, later injectors fill the gaps.
- Cells: `{ value, lines: stepResultLines(step, tank), status: measurementOutcome(step, tank), error, error_description }`.
- An errored FL(W) step puts its error value (status DNF) into the injector's **first empty row**.
- Per-injector `overall`: `PASS` / `FAIL` / `DNF` / `—` from `injectorOutcome`.

**Preview JSON** (`buildReportPreview`):
```json
{ "title": "Custom Report Preview", "parts": ["6513589"], "brands": ["Cummins"],
  "dateFrom": "2026-06-30", "dateTo": "2026-06-30",
  "injectors": [{ "id", "partNumber", "serialNumber" /* or "—" */, "result": "PASS|FAIL|DNF|—" }],
  "rows": [{ "key": "IVM01|1", "label": "Peak HP", "specification": "220.9 - 249.1", "unit": "mm3/STRK",
             "values": [{ "lines": ["230.3"], "status": "pass", "error": false }] }] }
```
`specification` = `<min> - <max>` when both are numeric (integers printed with one decimal, `4` → `4.0`, other numbers as-is), else the bench spec text, else `—`. Empty cells read `["—"]`; missing status `unknown`.

### 16.3 Custom Report — PDF

Generated by `buildCustomerReport` → `generateInjectorComparisonPdf(list, { vendorName, title: 'Injector Test Report' })`. **Banner title "Injector Test Report"**; vendor = request `vendor_name`, or the distinct bench brands joined by `, `.

Layout (`computeComparisonLayout`, `drawInjectorComparisonTable`) — computed once from the full selection so every page matches:

- Table top = 28 + 60 + 10 = 98; bottom limit = 612 − 28 = 584.
- Header row 22 pt, result row 20 pt. Data row height `rowH = floor((584 − 98 − 22 − 20 − 6) / rows)` clamped to **[20, 32]**; if 20 overflows, `max(16, floor(avail/rows))`.
- `nameFont = max(7.5, rowH ≥ 26 ? 8 : rowH ≥ 20 ? 7 : 6.2)`; step names fixed **9 pt bold**; spec font = `nameFont`. **No table text is drawn below 7.5 pt.**
- Column widths:
  - Test Step: `min(736 × 0.22, max(90, widest label at 9pt bold + 16))`
  - Spec: `min(736 × 0.22, widest(range text at spec font + 3 + unit width) + 16)`
  - Injector minimum: `max(44, min(120, widest serial line at 7.5pt + 8), min(160, ceil(widest value line at 7.5pt + 8)))`
  - Columns per page (`planInjectorPages`): `max(1, floor((736 − stepW − specW) / minInjColW))`; `injColW = (736 − stepW − specW) / min(perPage, count)`. If that is still below the minimum, the fixed columns shrink (`stepW = max(104, leftover×0.58)`, `specW = max(66, leftover×0.42)`). Columns keep their width on every page, so the last page ends early.
- **Header row**: navy; `TEST STEP` and `SPEC` (Helvetica-Bold 8 white); separators `#3A4A6B` 0.4 pt. Injector columns show the **serial number only**, centred; serials longer than 8 characters wrap with their **last 4 characters on a second line** (`26098M455` → `26098` / `M455`); font is the largest size from 9 down to 7.5 (0.5 steps) that fits.
- **Data rows**: alternating white / `#F9FAFB`; bottom border BORDER 0.3; vertical separators BORDER 0.3.
  - Test Step: label, bold 9 black, single line, ellipsis.
  - Spec: `"<min> - <max>"` from the green band with `max(1, decimals of min, decimals of max)` decimals; fallback: `text_green` "target +/- tol" converted to a range; else the raw spec; else `—`. The unit follows 3 pt after the max value in 6 pt `DGRAY`; any unit starting `mm3` prints as `mm` + a raised 4.3 pt `3` (raised 1.6 pt), i.e. `mm³`.
  - Injector cells: the measured value, centred, **green** (pass, bold) / **red** (fail, bold) / **amber** (DNF) / dark grey; value font `max(7.5, min(rowCap, (injColW − 6) / (longest numeric string × 0.6)))` with `rowCap = rowH ≥ 28 ? 10 : rowH ≥ 22 ? 8.5 : 7.5`. Error / "No Test" lines go through `drawErrorValue`: red (amber for DNF), bold, one line if it fits, else split after `Error:` (or the last space), shrinking to ≥ 7.5 pt and centring the lines; empty cells print `—`.
- **Result row**: fill `#EDF1F7`, `RESULT` bold 8 navy; per injector `PASS`/`FAIL`/`DNF`/`—` bold 9 (8 when the column is < 58 pt), green/red/amber/grey; a navy 0.8 pt line above it.
- Outer border BORDER 0.6, plus full-height separators after the Step and Spec columns.
- **Footer** (if space): Helvetica 6.5 `LGRAY`, right-aligned at `584 − 8`: `[Page X of Y · ]Generated YYYY-MM-DD HH:MM:SS · Flow value = average reading · Green = Pass · Red = Fail · Orange = DNF` (UTC time).
- **Pagination**: additional pages repeat the banner (with the page line), header row and the same rows in the same order.

Filename: `CustomReport_<sanitised first part>_<count>.pdf`.

### 16.4 Custom Report — Excel workbook

`services/injectorExport.js`: `buildExportModel(injectors, { vendorName })` → `buildInjectorWorkbook(model)` (exceljs, `creator = 'PDI Quality Management System'`). The page filters never appear in or change the file.

| Sheet | Content |
|---|---|
| **Comparison** | Columns `Test Step` (26), `Specification` (18), `Unit` (12), then one column per injector (width 16) headed `"<part>\nSN <serial>"`. One row per preview row; cells are the value lines joined with ` / `; a lone numeric reading is written **as a number**. Font colours: pass `FF1E7A45`, fail `FFB03225` (bold), DNF `FFB07520`; values right-aligned; step names bold. Last row `Overall Result` (bold, coloured). Header: navy fill `FF1D2B4F`, white bold 10, wrap text, height 30. Frozen panes `xSplit 3, ySplit 1`. |
| **Injectors** | One row per injector, columns (width): `#`(6), `Part Number`(18), `Serial Number`(18), `Result`(12, coloured PASS/FAIL/DNF/"No result"), `Steps Passed`(13), `Steps Failed`(13), `Steps Total`(12), `Failed Test Steps`(40; labels of measurement points that FAILED, comma-joined), `Test Date`(12, shop day), `Test Time`(10, `HH:MM` from the stored string — UTC), `Brand`(16), `Injector Type`(16), `Test Bench`(18), `Bench Serial`(15), `Bench Report ID`(26), `Slot`(7). Navy header, frozen first row, auto-filter. |
| **Test Steps** | One row per injector × tank of every customer step: `Part Number`, `Serial Number`, `Test Date`, `Step Code`, `Test Step`, `Specification` (`min - max` or bench spec), `Unit`, `Measured` (`stepResultValue`), `Result` (upper-case, coloured), `Bench Note` (error description). Navy header, frozen, auto-filter. |
| **Summary** | `Field`(24) / `Value`(70): Report ("Injector Test Results"), Generated, Injectors Exported, Passed, Failed, DNF, No Result (only if > 0), Part Numbers, Test Dates (`from` or `from to to`). |

Filename: `CustomReport_<first numeric part or "Injectors">_<count>.xlsx`.

### 16.5 Shipment Evaluation Report — PDF

`buildShipmentEvaluationReport` → `generateShipmentEvaluationPdf(list, { vendorName })`. Vendor name is **required**.

**Calculations** (`services/injectorEvaluation.js`):

- `summarise`: `total`, `passed`, `failed`, `dnf`, `untested` (UNKNOWN) by `injectorOutcome`; `passPct`, `failPct`, `dnfPct` (0 when total is 0); distinct part numbers, shop-clock test dates, brands, injector types.
- `failuresByTestPoint`: for every customer step code, count injectors with an explicit failure (`stepHasExplicitFailure`); IVM06 is counted as two points `IVM06-D` / `IVM06-R` using `measurementOutcome === FAIL` per tank. `pct = count / total × 100`. Sorted by count desc, then first-seen.
- `consistencyOfPassingInjectors` for `IVM01…IVM06` using **only injectors whose outcome is PASS**: value = primary tank `average` (excluded if the step errored or the value is not numeric — excluded from that point only). `mean`, `deviation_i = |(v − mean)/mean| × 100`, `avgDeviationPct = mean(deviation_i)`, `rangeDeviationPct = (max − min)/min × 100` (null if min is 0), `maxIndividualDeviationPct`; `insufficient` when fewer than 2 samples (notes: "No valid measurements from passing injectors", "Mean is zero — percentage deviation is undefined", "Only one valid measurement — consistency not meaningful"). Label for IVM06 is "Peak Torque - Delivery".
- `consistencyOverall` (rated points only): average of `avgDeviationPct`, best/worst point, widest `rangeDeviationPct`.

**Page 1 (summary)**:
- Banner title **"Shipment Evaluation Report"**, Part / Vendor / Report Date.
- KPI cards at y = 98, height 58, gap 8 (`drawStatCards`): rounded white card, BORDER outline, 3.5 pt coloured stripe, label 6.8 pt bold MGRAY upper-case, value 17 pt bold in the card colour, sub-line 6.8 pt. Cards: **Total Tested** (navy); **Total Passed** (green, "<pct>% · Yield"); **Total Failed** (red, "<pct>% · Component"); **Total DNF** (amber, "<pct>% · Bench interrupted"); **No Result** (grey, "not scored") only if any.
- **"Actual Component Failures by Test Point"** bar chart, full width, height 150 (y = 164). Note: "DNF bench interruptions are excluded. Delivery and Return are counted independently. An injector can fail more than one test point." Up to 8 bars (count > 0), label `Failed: <label> (<code>)`, value text `<n> failed  ·  <pct>% of batch`, red. Empty: "No test-point failures in this batch" ("No injectors selected" for an empty batch).
- Two half-width charts (gap 10) from y = 322 to the footer (height `max(120, 566 − y)`):
  - **"Average Deviation"** (teal): note "Passing injectors only (P of T); Failed and DNF injectors are excluded. Average absolute % deviation from the mean delivery flow at each test point. Lower is more consistent. Group average: x.xx%." Rows `<label> (<code>)` with `x.xx%`, or the note text greyed when not computable.
  - **"Maximum Deviation"** (amber): note "… % difference between the lowest and the highest passing reading at each test point. Widest spread: x.xx%."
  - Empty: "No passing injectors — deviation cannot be calculated".
- Footer: "Shipment Evaluation · Generated <UTC timestamp> · Test detail follows on the next page(s)" (6.5 pt, right-aligned, y = 576).

Chart primitive (`drawHorizontalBarChart`): white panel with BORDER outline; title 9.5 pt bold navy; note 6.8 pt MGRAY (max height 16); label font 7.5 pt (6.5 pt with > 8 rows); label column ≤ 42 % of the width; value column ≤ 22 %; row slot `min(areaH/rows, 30)`; bar height `clamp(slot − 4, 4, 16)`; track `#F9FAFB`; scale max rounded up to 1 / 1.5 / 2 / 3 / 5 / 10 × 10ⁿ; non-zero bars at least 1.5 pt long.

**Pages 2+ (detail)**: the same comparison grid as §16.3 with banner title **"Shipment Evaluation — Test Detail"**, numbered from page 2 (`pageOffset 1`), so every detail page carries "Page X of Y · Injectors a–b of N".

Filename: `ShipmentEvaluation_<part>_<vendor>_<count>.pdf`.

### 16.6 Inspection Report — record + PDF

`generateInspectionReports(injectors, { actor })` groups the selection **by `report_ext_id`** (one inspection per physical bench test; a row without one gets `single:<id>`) and calls `autoFillReportInspection(reportExtId, group, { actor })` (`services/injectorInspection.js`):

- Template: active PDI-IQI-012 with the highest version (fallback any PDI-IQI-012). Missing → skipped with a warning log.
- Injectors are ordered by `slot_position`, then serial.
- `__admin_sections` = template sections with `dimensional` replaced by:
  ```js
  { title: 'C. DIMENSIONAL INSPECTION — INJECTOR TEST BENCH RESULTS', section_type: 'dimensional',
    layout: 'single_value', items }   // items from the FIRST injector's steps
  ```
- `buildDimensionalFromTests(tests)`: for every non-flush step with a primary tank → item `{ id, measurement: stepLabel(...), spec: primary.spec }` and answer `{ id, spec, actual1: stepResultValue(...), status: 'P'|'F'|'' (from measurementOutcome; DNF → ''), __unit, __error }`; a secondary tank adds its own row (label disambiguated as `"<label> — <tank_name>"` if identical to the primary's).
- `section_data`:
  ```js
  { __shared: { receiving: [{ id, status: 'P', result: 'P', notes: '', finding: '' }, …] },   // Section A once, auto-PASS
    __items: [ { __serial_no, visual: [{ id, result, status, notes: '', finding: '' }], dimensional: [answers],
                 __disposition: 'PASS'|'FAIL'|'', __disposition_notes: '' } ],
    __dimensional_added: true, __admin_sections, 
    __injector_source: { report_ext_id, injectors: [{ id, slot_position, serial }] } }
  ```
  Visual results are `'P'` when `overall_pass === 1`, otherwise left **open** (`''`) so QC must inspect a failing/DNF injector. Item disposition: `PASS` / `FAIL` / `''` (when `overall_pass` is null).
- Inspection columns: `part_number` (first injector), `supplier` = brand, `po_number` NULL, `description` = `"<brand> <injector_type>"`, `date_received` = first 10 chars of `test_datetime` (or today), `inspector_name` = actor name or `'Injector Test Bench'`, `lot_serial_no` = serials joined `, `, `status 'draft'`, `item_count`, overall `disposition` = `''` unless every injector is scored, then `FAIL` if any failed else `PASS`.
- **Idempotent**: if any injector row of the group already has `inspection_id`, that inspection is updated (unless its status is `complete`, which is never touched) and all rows are re-linked; otherwise a new inspection is inserted, rows linked, and an activity-log entry `started` written. Returns created/updated counts.

The PDF is the standard inspection PDF (`generateInspectionPdf`, **Letter portrait**, margin 40, usable width 532):
- Navy banner (532 × 56): logo (height 26), "INCOMING QUALITY INSPECTION" (13 pt bold white, centred), "PDI-IQI-012 · FUEL INJECTOR" (8 pt `#A5B4C8`).
- Two-column info grid (18 pt rows): Part Number, Supplier, Lot / Serial, Date Received, Inspector, Description (empty fields omitted).
- Section A once (checklist with green tick glyphs).
- Per injector (each after the first on a new page): navy item banner `ITEM n OF N · SN <serial>`; **B. VISUAL INSPECTION**; **C. DIMENSIONAL INSPECTION — INJECTOR TEST BENCH RESULTS** table with columns `# | Measurement | Spec / Limit | Actual | Status` (widths 24 / 168 / 160 / 116 / 64; spec shows the bench text, e.g. `235.0 +/- 14.1 mm3/STRK`; status P → green tick, F → red X); disposition box (32 pt, green PASS / red FAIL) titled `Item n · SN <serial> — Disposition` (or `Final Result` for a single item).
- "Overall Disposition" box when there is more than one item.
- Footer on every page: `PDI Quality Control  ·  QC-<po>-<part>` and `Page i of N  ·  <server-local date>`.

In the app, these inspections behave like any other draft inspection: they appear in the Inspections list and can be edited; `getSharedInspectionKeys` keeps `__dimensional_added`, `__admin_sections`, `__shared`, `__injector_source` when the form saves, and `SectionDimensional.jsx` renders `layout: 'single_value'` as `# | Measurement | Spec / Limit | Actual | Status | Notes` (no Location, single Actual).

---

## 17. Repair tracking

`server/services/injectorRepairs.js` + `client/src/components/InjectorRepairHistory.jsx` + `client/src/components/InjectorQuickEntry.jsx`. Repair data lives in its own tables and survives Clear All / resync.

### 17.1 Concepts and constants

- **Case** = one repair episode of one unit (part + serial). Statuses: `OPEN`, `PASSED`, `SCRAPPED`, `HOLD`, `ENGINEERING_REVIEW`. Active = `OPEN|HOLD|ENGINEERING_REVIEW`; at most one active case per unit (partial unique index).
- **Attempt** = one repair round: recorded on a "before" test result, closed by a linked "after" retest. Status `WAITING_RETEST` → `COMPLETED`; outcome `PENDING|PASS|FAIL|DNF|UNKNOWN`.
- **Change** = structured physical change. `COMPONENT_OPTIONS`: Nozzle, Needle, Control Valve, Control Ball, Armature, Stator, Solenoid, Spring, Nozzle Nut, Valve Body, Housing, Other. `ACTION_OPTIONS`: Adjusted, Replaced, Reworked, Cleaned, Retorqued, Lapped, Inspected, No Change. Max 25 changes per attempt.
- **Delta** = per measurement snapshot (`step_key = "<code>|1|2"`) before and after.
- Field limits: technician 120, diagnosis 2000 (required), hypothesis 3000, expected/observed outcome 3000, repair notes 4000, parameter 120, before/after 100, unit 40, change notes 500, up to 20 failure categories (100 chars each).

### 17.2 Starting a case (`createRepairCase`)

Requirements: test exists (404 "The injector test could not be found. Refresh the list and try again."); has a serial (400); `result_status` is FAIL (400 "Repair tracking can only be started from a failed injector test."); no active case for the unit (409 `ACTIVE_REPAIR_CASE`); the test is newer than any test already in the unit's repair history (409 `OLDER_THAN_HISTORY`); ≥ 1 valid change; repair date not before the failed test. In one savepoint transaction: insert the case (`OPEN`, snapshot of the initial test, `opened_by`), attempt #1 (`before_*` = the failed test) with its changes and the **before snapshot** of every customer tank, then `autoLinkRetests({ caseId })`.

Before snapshot per tank: `before_value` = numeric `average`, `target_value` = `tank.target` if numeric else midpoint of the green band, `before_distance_from_target`, `before_status` (tank status upper-case), `spec_min`, `spec_max`, `unit`.

### 17.3 Next attempt (`addRepairAttempt`)

Case must be `OPEN` (409 `CASE_NOT_OPEN`); the previous attempt must be `COMPLETED` with a retest (409 `RETEST_REQUIRED`) and not PASS (409 `CASE_RESOLVED`). The new attempt's "before" test is the previous attempt's retest; its repair date cannot be earlier than that retest.

### 17.4 Linking a retest (`linkRetest`)

Attempt must be `WAITING_RETEST` without a retest (409 `RETEST_ALREADY_LINKED`); the retest must be the same unit (400 `IDENTITY_MISMATCH`), strictly later than the attempt's before test (400 `INVALID_RETEST_DATE`), and not used by another attempt. For every step key in before ∪ after:

```
absolute      = after − before
percent       = absolute / before × 100           (null if before = 0)
beforeDist    = before − target ; afterDist = after − target
effectiveness = (|beforeDist| − |afterDist|) / |beforeDist| × 100   (null if beforeDist = 0)
after_status  = after tank status, or 'MISSING'
```
(rows only present after the retest are inserted with `before_status 'MISSING'`). The attempt becomes `COMPLETED` with `outcome` = retest status (PASS/FAIL/DNF/UNKNOWN) and `observed_outcome`. A PASS closes the case: `PASSED`, `closed_*`, `final_*` snapshot.

### 17.5 Case status (`setCaseStatus`)

Allowed manual statuses: OPEN, HOLD, ENGINEERING_REVIEW, SCRAPPED (400 "Choose Open, Hold, Engineering Review, or Scrapped."). A PASSED case cannot be changed (409). SCRAPPED sets `closed_at/closed_by`; others clear them.

### 17.6 Automatic retest linking (`autoLinkRetests`)

For every attempt `WAITING_RETEST` in an active case (oldest repair date first), the first candidate retest is linked. Candidates: tests of the same unit (all same-unit serial spellings, same part), `datetime(test_datetime) > datetime(before_test_datetime or repair_date)`, not the before test itself, not already some attempt's retest (by id or by report id + slot), oldest first. Runs after each sync, after recording a repair, and at server start-up.

### 17.7 List badges (`repairRolesForTests` + `client/src/lib/injectorRepairBadge.js`)

Each list row gets only its own role (matched by test id, or report id + slot so it survives re-imports): `repair_case_id`, `repair_case_status`, `repair_attempt_number` (a repair was recorded on this result), `repair_attempt_status`, `retest_of_attempt` (this result is the retest of attempt n), `retest_outcome`. Badge:

| Row role | Badge (tone) |
|---|---|
| repair recorded | `Repair #n[ · awaiting retest][ · Hold|Engineering Review|Scrapped]` (purple `bg-purple-100 text-purple-800`, `Wrench`) |
| passing retest | `Pass · after Repair #n` (green, `CheckCircle2`) |
| other retest | `Retest of Repair #n[ · case note]` (blue) |

Tooltip: `Retest of Repair #n — <OUTCOME>`.

### 17.8 Quick Entry

`QUICK_MEASUREMENTS` (component, allowed units):

| Key | Label | Component | Units |
|---|---|---|---|
| `preload_screw_height` | Preload Screw Height | Spring | mm, in |
| `armature_stroke` | Armature Stroke | Armature | mm, in |
| `needle_stroke` | Needle Stroke | Needle | mm, in |
| `nozzle_nut_torque` | Nozzle Nut Torque | Nozzle Nut | ft-lb, in-lb, N·m |
| `valve_body_torque` | Valve Body Torque | Valve Body | ft-lb, in-lb, N·m |
| `solenoid_nut_torque` | Solenoid Nut Torque | Solenoid | ft-lb, in-lb, N·m |

`GET /:id/quick-entry` decides `can_save` / `reason`:
- no serial → "A serial number is required to record a repair."
- active case on HOLD/REVIEW → "This repair is on hold or under engineering review. Reopen it in Repair History first."
- test not FAIL/DNF/UNKNOWN, or no case and not FAIL → "Quick Entry records repairs after an unsuccessful test. Use Repair History to link a passing retest."
- previous attempt waiting: on this same result → "Repair #n is already recorded on this result. Run and sync the retest, then record the next repair on that result."; this result is a candidate retest → `links_previous_retest: true`; else "This result is older than Repair #n. Record repairs on the latest result for this injector."
- previous completed and this is not its retest → "Record Repair #n+1 on the retest of Repair #n."
- no case and older than history → the OLDER_THAN_HISTORY message.

`POST` validates each pair: both blank → skipped; otherwise both must match `/^(?:\d+(?:\.\d*)?|\.\d+)$/` ("<Label>: enter a nonnegative number in both Before and After, or leave both blank.") and the unit must be allowed ("<Label>: select the measurement unit."); at least one pair. Each pair becomes a change (`action_type` `No Change` when equal, else `Adjusted`; `parameter` = label). Attempt: technician = signed-in user, diagnosis "Measurements recorded via Quick Entry.", `repair_notes` = `notes`. In one transaction: start a case, or link the previous attempt's retest then add the next attempt.

Modal UI: title "Quick Entry", "<part> · SN <serial>", "Test: <time>"; amber reason box when `!can_save`; blue box "Saving will use this test as the result of the previous repair and record Repair #n."; table Measurement (with unit select, default `mm` where allowed) | Before | After (`inputMode="decimal"`); "Recorded as <user> at the time of saving."; footer "View Repair History" (opens the preview on the Repair History tab) and **Save Measurements**. Focus is trapped, Escape closes, body scroll locked. Success toast "Measurements saved. Repair history updated."

### 17.9 Repair History tab (`InjectorRepairHistory`)

Query `['injector-repair-history', testId]` → `GET /:id/repair-history`. Shows:
- Empty state "No repair history recorded" with **Start Repair** (when `can_start`) or the rule text.
- Each case: header "Repair Case" + status pill (Open blue, Passed green, Scrapped grey, Hold amber, Engineering Review purple); "Opened <time> by <name> · n attempts"; failure category chips; for the active non-passed case a status select + **Update** (Scrapped asks `window.confirm`). Timeline: red "Initial failed test", one `AttemptCard` per attempt, green "Case closed · Passed".
- `AttemptCard`: "Repair #n" (+ "Recorded on this result" when viewing that test), "On the <time> result (<STATUS>) · SN x", "Entered <time> · <technician>", status/outcome, Diagnosis/Hypothesis/Expected/Observed, Changes list (`component`, `action · parameter`, `before → after unit`, notes), repair notes, "Retested <time> SN x <STATUS>" (+ "This result"), and a delta table: Test point | Before | After | Change (abs and %) | Toward target (correction effectiveness %, green ≥ 0 else red) | Result.
- `RetestLinker` (blue) for a waiting attempt: candidate select (`<time> · <STATUS> · n failed`), optional observed outcome, **Link Retest & Calculate Changes**; without candidates: "Waiting for the next test of this injector. It is linked to this repair automatically when the retest is synced."
- **Add Repair #n+1** when the case is OPEN and the last attempt completed with FAIL/DNF/UNKNOWN; **Start New Repair Case** when allowed and no active case.
- `RepairAttemptForm` (start / next): repair date (`datetime-local`, default now), technician (default signed-in user), failure categories (comma separated, start only), Diagnosis*, Repair hypothesis, Expected outcome, Structured changes* (component select, action select, parameter, before, after, unit, change notes; add/remove), repair notes; **Start Repair Case** / **Save Repair Attempt**.

---

## 18. Injector Reports (analytics) page

Server: `services/injectorAnalytics.js`. Client: `client/src/pages/InjectorReports.jsx` (route `/injector-reports`).

### 18.1 Filters and cohort

`filters`: `date_from`, `date_to` (strict `YYYY-MM-DD`, from ≤ to), `part_number` (single string), `interval` `day|week|month` (default week). Errors: "Choose a valid date range.", "Start date must be on or before end date.", "Choose day, week, or month.", "Choose one part number." (400).

- Tests: `injector_test_reports` with serial not `R…`, job not `%RMA%`, test date within the shop-day range, optional part (trimmed, case-insensitive).
- Repair cohort: cases whose **initial failed test** is in the window (serial not `R…`), with all their attempts, changes and deltas (even outside the window).
- Unique injectors: `unitKeyer` over all known part/serial pairs (tests + cases), so spelling variants count once; tests without a serial count only as test runs.
- Trend bucket: shop day; week = Monday of that week; month = `YYYY-MM`.

### 18.2 Output (`GET /analytics`)

```
{ filters, generated_at, last_sync, coverage: { first_test, last_test, available_tests }, parts: [...],
  testing: { test_runs, unique_injectors, missing_serial_tests, outcomes{PASS,FAIL,DNF,UNKNOWN},
             first_outcomes, latest_outcomes, test_pass_pct, test_fail_pct, first_pass_pct, first_fail_pct,
             needing_repair, needing_repair_pct, tracked_failed_injectors, tracked_failed_pct },
  trend: [{ period, PASS, FAIL, DNF, UNKNOWN, injectors }],
  repairs: { cases, unique_injectors, dispositions{status:count}, attempts, completed_attempts, pending_retests,
             passed_attempts, attempt_pass_pct, passed_cases, passed_after_one, first_retested_cases,
             injectors_passed_after_one, first_repair_pass_pct, avg_attempts_to_pass, attempts_to_pass[{attempts,cases}] },
  actions: [{ key, part_number, component, parameter, action, unit, direction, attempts, completed, passed,
              pending, multi_change, pass_pct }],
  evidence: [{ key, part_number, failure: High|Low|Reported fail, parameter, component, action, direction,
               measurement_unit, step, step_key, test_unit, spec_min, spec_max, observations[...], samples,
               corrected, correction_pct, measured_samples, mean_test_delta, multi_change }],
  cases: [{ id, part_number, serial_number, initial_test_datetime, status, closed_at, attempts, pending }],
  definitions: [[term, text], …] }
```

Key rules: a change "counts" unless its action is `No Change`/`Inspected` or an `Adjusted` change with equal numeric before/after; direction = Increased / Decreased / Unchanged / "Recorded action"; each action group counts an attempt at most once; evidence groups pair a changed parameter with each test point that was FAIL before the attempt (failure High/Low against spec); numeric test deltas only when after status is PASS/FAIL. The `DEFINITIONS` array (shown verbatim on the page and in the workbook) covers: Test window, Pass / fail percentages, Needing repair, Repair cohort, Average attempts to pass, First repair pass rate, Attempt pass rate, No linked retest, Failure / adjustment associations, Interpretation, Coverage (text in `injectorAnalytics.js:262-274`).

### 18.3 Workbook (`GET /analytics/export.xlsx`)

Sheets (navy header, frozen, auto-filter, width 24; "No data for these filters" when empty): **Summary** (section/metric/value), **Definitions** (generated at, filters, coverage, definitions), **Test trend**, **Attempts to pass**, **Repair cases**, **Adjustments**, **Failure associations**, **Observed changes**, **Test runs**, **Repair attempts**, **Measurements** (changes), **Test evidence** (deltas).

### 18.4 Page layout

- Header: "Injector Reports" (`BarChart3`), "Testing volume, repair outcomes, and adjustment history", link back to Injector Tests.
- Filter form (applied on **Apply**): From / Through (default last 90 days, local dates), Part number select ("All parts" + `data.parts`), Trend (Daily/Weekly/Monthly), refresh button, **Export Excel** (downloads `Injector-Repair-Analytics.xlsx`).
- Context lines: applied window, synced coverage, last sync, cache caveat, missing-serial warning.
- Metric cards: Injectors tested; Test-run pass / fail; Injectors needing repair; Failed injectors with a repair case.
- Charts (recharts, colours PASS `#16806a`, FAIL `#c0392b`, DNF `#bd771a`, UNKNOWN `#7c8798`): stacked "Testing volume and outcomes" by period (+ "View numbers" table); "First and latest test in the window".
- "Repair effectiveness" cards: Repair cases; Average repairs to pass; Injectors passed after one repair; Repair-attempt pass rate. Charts: "Repairs needed to achieve a pass" (bar), "Current repair-case status" (horizontal bar).
- "Adjustment outcomes" table; "Failure → adjustment → response" explorer (group select, summary sentence, "Show only attempts with one recorded change", scatter of measurement Δ vs test Δ with reference lines at 0, observations table); "Repair-case history" (serial search, status filter, 25 per page) → "Selected repair case" with two line charts (physical measurement before/after per repair; test value initial → after each repair) and the attempt cards; collapsible "Metric definitions and data coverage".

---

## 19. Daily Google Sheet export

### 19.1 What is written

One row per injector that **PASSED** (`injectorOutcome === PASS`) on a shop-clock day, ordered by test time, then part, then serial; retests are separate rows. Columns `COLUMNS = ['Test Date', 'Part Number', 'Serial Number']`:

- Test Date: shop day `YYYY-MM-DD` (sent `USER_ENTERED`, so it lands as a date).
- Part Number: **PDI's part number** (`displayPartNumber`). A rule matches when its core appears anywhere in the bench part (upper-cased, spaces collapsed, also with all separators removed). Rules: core `2872405` → `7159417`; `2897320` → `7159419`; `4327147` → `7159421`. Unmapped parts pass through unchanged and are listed in `unmappedParts`.
- Serial Number: trimmed (empty cell if missing).

Same exclusions as the page (no `R…` serials, no RMA jobs).

### 19.2 Logic (`services/injectorDailyExport.js`)

- `exportDay(day = yesterday, { force, dryRun })`: invalid day → `{ ok: false, reason: 'invalid_day' }`; already sent and not forced → `already_exported`; dry run → `dry_run`; no rows → mark sent, `no_passed_injectors`; otherwise `appendRows(rows, { header: COLUMNS })`, mark sent.
- `exportRange(from, to)`: rejects `backwards_range`; clamps `to` to **yesterday** (`askedTo` reported) so today is never half-sent (`no_complete_days` if nothing remains); max **366** days (`range_too_long`) and **5000** rows (`too_many_rows`); skips sent days unless `force`; all rows appended in **one** request; days marked sent only after a successful append; returns `perDay`.
- `exportMonthToDate()`: 1st of the current month through yesterday.
- Sent days are tracked as a JSON array in `app_settings` (§4.3).

### 19.3 Google Sheets client (`services/googleSheets.js`)

- Library `@googleapis/sheets` (`auth.JWT` with scope `https://www.googleapis.com/auth/spreadsheets`, `sheets({ version: 'v4', auth })`).
- Credentials: key file JSON (`client_email`, `private_key`) or the two env variables. `missingConfig()` lists what is missing and parses the private key with `crypto.createPrivateKey` to catch keys whose line breaks were lost.
- `appendRows`: read `<tab>!1:1` (or `1:1`); if empty, prepend the header; `spreadsheets.values.append({ range, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values } })`. Returns `{ appended (excluding header), updatedRange, headerWritten, spreadsheetId }`.
- Setup: create a Google Cloud project, enable the Sheets API, create a service account and JSON key, **share the spreadsheet with the service-account email as Editor**, set the env variables.

### 19.4 Scheduling (`server/index.js`, `services/dailySchedule.js`)

On start-up, unless `INJECTOR_SHEET_EXPORT_ENABLED=false` or the configuration is incomplete (logged "Not scheduled — missing …"), `startDailyJob({ time: INJECTOR_SHEET_EXPORT_AT || '00:05', timeZone })` runs `exportDay()` daily. `nextRunAt` computes the next wall-clock occurrence in the shop zone (keeps its slot across DST); the timer is `unref()`'d, capped at 2³¹−1 ms, rescheduled after each run, and errors are logged without stopping the schedule. Single-process only (PM2 fork / one Render instance).

Route results are logged as `[InjectorSheetExport] <day|from..to (n day(s))>: <rows> passed injector(s), appended <n>|skipped (<reason>) (user=<id>)`. Route errors: 400 `NOT_CONFIGURED` "Google Sheets export is not configured. Set <missing> on the server."; 400 range refusals ("The range ends before it starts.", "A range covers at most 366 days.", "That range holds N rows, more than the 5000 one request sends. Export it in smaller spans.", "Give the day as YYYY-MM-DD."); 502 `SHEET_EXPORT_FAILED` "The Google Sheet could not be updated: <msg>". There is **no UI** for this export; it is driven by the schedule and the two routes.

---

## 20. Automated tests

Run with `cd server && npm test` and `cd client && npm test` (Node's built-in test runner). Results on this baseline: **server 270/270 pass, client 119/119 pass**.

Server test bootstrap (`test/helpers/testEnv.js`): sets `SQLITE_PATH`/`UPLOAD_DIR` to a temp dir (DB seeded from `db/seed/inspection.db`), deletes `CARBONZAPP_API_KEY`, applies migrations, and provides `extractPdfPages/extractPdfText` (inflates pdfkit content streams and decodes hex text) and `resetInjectorData`. `test/helpers/benchData.js` builds fake bench reports (`benchReport`, `benchBatch`) with FL(W), iVM.01 and iVM.06 (delivery + return) steps.

| Suite | Tests | Covers |
|---|---|---|
| `server/test/injectorSync.test.js` | 18 | date windows, paging, truncation, exclusions, prune safety rules, marker |
| `server/test/injectorSteps.test.js` | 13 | code normalisation, names, error parsing, DNF classification, test datetime |
| `server/test/injectorFilters.test.js` | 14 | criteria parsing, measurement points, step catalog, step filters, shop-day dates |
| `server/test/injectorReports.test.js` | 32 | sync creates no inspections, preview, column order, pagination, serial wrapping, 7.5 pt floor, spec band, No Test, inspections |
| `server/test/injectorRoutes.test.js` | 28 | admin-only access, all routes, vendor rules, workbook, filters, sheet export routes |
| `server/test/injectorEvaluation.test.js` | 17 | summary, failures by point, deviation formulas, edge cases |
| `server/test/injectorExport.test.js` | 15 | workbook sheets, numeric cells, order, filename |
| `server/test/injectorRepairs.test.js` | 12 | cases, quick entry, retest linking, deltas, survives cache clear, unit matching |
| `server/test/injectorAnalytics.test.js` | 10 | windows, cohorts, grouping, DNF exclusion, workbook |
| `server/test/injectorDailyExport.test.js` | 27 | day selection, rows, idempotency, ranges, part translation |
| `server/test/injectorUnits.test.js` | 7 | same-unit rules |
| `server/test/injectorPartNumbers.test.js` | 9 | part translation rules |
| `server/test/googleSheets.test.js` | 8 | append, header, key formats |
| `server/test/dailySchedule.test.js` | 7 | schedule maths, DST, error survival |
| `server/test/timeZone.test.js` | 10 | shop-clock helpers |
| `server/test/reportPagination.test.js` | 7 | columns per page |
| `client/test/injectorSelection.test.js` | 34 | filters, selection order, outputs/formats, quick preview |
| `client/test/syncStatus.test.js` | 13 | banner messages |
| `client/test/injectorDateTime.test.js` | 11 | shop-clock formatting |
| `client/test/download.test.js` | 11 | save dialog / naming |
| `client/test/navigation.test.js` | 7 | admin-only nav and routes |
| `client/test/injectorRepairBadge.test.js` | 5 | badges |

---

## 21. Deployment

- **Render** (`render.yaml`): web service `pdi-inspection`, Node 22.11.0, build `cd server && npm install --omit=dev && cd ../client && npm install && npm run build`, start `cd server && npm start`, health `/health`, 1 GB disk at `/var/pdi-data` (`SQLITE_PATH=/var/pdi-data/inspection.db`). Injector variables declared: `INJECTOR_TIME_ZONE=America/Denver`, `GOOGLE_SHEETS_SPREADSHEET_ID` (sync:false), `GOOGLE_SHEETS_RANGE=Sheet1!A:C`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` (sync:false), `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (sync:false), `INJECTOR_SHEET_EXPORT_AT="00:05"`. The CarbonZapp key is entered in the UI (or add `CARBONZAPP_API_KEY`). The client build needs `VITE_INJECTOR_TIME_ZONE` if the zone is changed.
- **Windows Server / PM2** (`ecosystem.config.cjs`, `STARTUP.md`): single fork instance with `--experimental-sqlite` (required by SQLite and by the in-process daily timer).
- Outbound HTTPS needed to `cloudx.carbonzapp.com` and (for the sheet export) `oauth2.googleapis.com` / `sheets.googleapis.com`.
- CSP in production allows `connect-src 'self'` only — all bench and Google calls are made server-side.

---

## 22. Known quirks and inconsistencies

These are present in the current code. A faithful copy reproduces them; a copy that "fixes" them will diverge from the original.

1. The missing-key error says "Add it in Admin → Injector Tests → Settings", but the settings now live on the Injector Tests page itself (`carbonzapp.js:290`).
2. `client/src/lib/nav.js` comments that `ADMIN_ROLES = ['admin','qc_manager']` matches the server, but the injector routes' `ADMIN_ROLES` is `['admin']`. Behaviour is consistent only because the two injector nav items set `roles: ['admin']` explicitly.
3. The 403 from `requireAdmin` carries `code: "INTERNAL_ERROR"` (AppError default) rather than an auth-specific code.
4. The list header always says "times in Mountain Time", even if `VITE_INJECTOR_TIME_ZONE` is changed.
5. "Last sync" on the page and the analytics page use the browser's own time zone (`toLocaleString`), not the shop zone.
6. `job_number` is always stored as NULL, so the SQL `%RMA%` exclusion and the `idx_injector_reports_job` index are effectively unused (RMA exclusion happens at import).
7. A first-ever Sync Now (or the first after Clear All) sends **no** `date_from`, while Full Resync sends the wide `2000-01-01` window; Test Connection also sends no `date_from`. The code itself notes that some deployments return an empty array without a `date_from`.
8. The Custom Report PDF banner says "Injector Test Report" (title passed by `buildCustomerReport`), while the UI and file names say "Custom Report" (`drawInjectorComparisonTable`'s own default title is "Custom Report").
9. Inspection `date_received` is the first 10 characters of the UTC `test_datetime`, not the shop-clock day used elsewhere; the inspection PDF footer reads `QC--<part>` because `po_number` is NULL.
10. The Excel "Test Time" column is the `HH:MM` of the stored (UTC) string, while "Test Date" is the shop-clock day.
11. Preview/workbook specification formatting (`4` → `4.0`, `4.25` → `4.25`) differs slightly from the PDF (`max(1, decimals)` applied to both bounds, so `4.25 - 13.00`).
12. `App.jsx` declares the `injector-reports` route after the `*` catch-all; React Router v6 ranks routes by specificity, so it still matches.
13. Server-supplied filenames (`X-Report-Filename`, `inspections[].filename`) are not used by the client, which names files from the user's chosen base name.
14. The route-file header comment does not list `POST /test-connection`, `DELETE /`, `/analytics*`, `/:id/quick-entry`, `GET /repairs/cases/:id` or `/reports/supplier-evaluation`, though all exist.
15. Report Date in banners is the UTC calendar date of generation, not the shop day.

---

## 23. Reference output for verifying a copy

Feeding `server/db/samples/carbonzapp_sample.json` through `mapReportToInjector` (verified on this baseline) gives two injectors from report `6a444e5386a20ae0bc0f37d6`: `26098M455` (slot 0) and `26098M447` (slot 2), both **pass, 10/10 steps**. Step outcomes: Resistance skip, Flush skip, Leak Test 200 bar [R] pass, Leak Test 1800 bar [R] pass, Warm Up, Peak HP, Emissions, Low Idle, Mid-Range, Cranking, Peak Torque - Delivery, Response Time pass, Opening Pressure skip.

Custom Report grid (rows, spec, 26098M455, 26098M447):

| Test Step | Spec | 26098M455 | 26098M447 |
|---|---|---|---|
| Leak Test 200 bar [R] | 0.0 - 20.0 ml/min | 0 | 0 |
| Leak Test 1800 bar [R] | 0.0 - 20.0 ml/min | 0 | 0 |
| Warm Up | 0.0 - 500.0 mm³ | 254.6 | 259.8 |
| Peak HP | 220.9 - 249.1 mm³ | 230.3 | 235.8 |
| Peak HP [R] | 0.0 - 80.0 mm³ | 25.4 | 25.3 |
| Emissions | 24.6 - 34.6 mm³ | 28.7 | 33.1 |
| Low Idle | 4.0 - 13.0 mm³ | 12.6 | 11.1 |
| Mid-Range | 66.3 - 82.3 mm³ | 72 | 76.9 |
| Cranking | 29.2 - 41.2 mm³ | 36.2 | 37.5 |
| Peak Torque - Delivery | 0.0 - 500.0 mm³ | 273.1 | 278.2 |
| Peak Torque - Return | 0.0 - 80.0 mm³ | 28.4 | 28.6 |
| Response Time | 290.0 - 690.0 usec | 465 | 498 |
| RESULT | | PASS | PASS |

Shipment Evaluation summary: Total Tested 2, Passed 2 (100.0 % · Yield), Failed 0, DNF 0; "No test-point failures in this batch". Average Deviation: Peak HP 1.18 %, Emissions 7.12 %, Low Idle 6.33 %, Mid-Range 3.29 %, Cranking 1.76 %, Peak Torque - Delivery 0.93 % (group average 3.43 %). Maximum Deviation: 2.39 %, 15.33 %, 13.51 %, 6.81 %, 3.59 %, 1.87 % (widest spread 15.33 %).

Inspection Report: one inspection (both injectors share the report id), `lot_serial_no` "26098M455, 26098M447", supplier Cummins, description "Cummins XPI-CRIN", date received 2026-06-30, 4 pages (Section A + item 1 visual on page 1, item 1 dimensional + PASS on page 2, item 2 on pages 3–4, with its PASS disposition and the "Overall Disposition" PASS box on page 4); dimensional row 1 `Leak Test 200 bar [R] | 10.0 +/- 10.0 ml/min | 0 | ✓`.

---

## 24. Rebuild checklist

1. Node 22.5+ with `--experimental-sqlite`; server deps `pdfkit`, `exceljs`, `@googleapis/sheets`, `uuid`; client deps `@tanstack/react-query`, `recharts`, `lucide-react`, `axios`, `react-router-dom`, Tailwind with the `pdi` colours.
2. Create the tables and indexes in §10.1 and the `app_settings` table; seed the PDI-IQI-012 template (§10.3).
3. Implement the step module (§8), classifier (§9), normaliser (§7), bench client + paging (§5), sync with exclusions and prune safety (§6), shop-clock helpers (§11) and unit matching (§12).
4. Implement the routes in §13 behind JWT auth and an admin-only guard; keep the error codes and messages.
5. Implement the report builders (§16) with the exact geometry, fonts and colours; the preview JSON and the workbook must come from the same comparison model as the PDF.
6. Implement repair tracking (§17) and analytics (§18).
7. Implement the daily sheet export and scheduler (§19); configure Google credentials.
8. Build the client pages (§14, §15, §17.8–17.9, §18.4) with the query keys, debounce, selection-order and Generate flow described.
9. Set the environment variables in §4 (server and client zone must match) and deploy as a single process (§21).
10. Port the test suites (§20) and check the reference output (§23).
