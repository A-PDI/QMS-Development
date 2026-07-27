'use strict';
/**
 * Manual report generation for selected injector test records.
 *
 * Synchronisation only imports test data (see services/carbonzapp.js). Reports
 * are produced HERE, on demand, for the injectors the user picked on the
 * Injector Tests page:
 *
 *   customer            → landscape side-by-side comparison PDF
 *   inspection          → Fuel Injector (PDI-IQI-012) inspection record(s),
 *                         whose PDF is served by /api/inspections/:id/pdf
 *   supplier_evaluation → "Shipment Evaluation Report" (summary + detail PDF)
 *
 * Selection order is preserved everywhere so a report is reproducible.
 */

const db = require('../db/adapter');
const { hydrateInjectorRow } = require('./carbonzapp');
const { autoFillReportInspection } = require('./injectorInspection');
const { generateInjectorComparisonPdf, generateShipmentEvaluationPdf } = require('./pdf');
const { isFlushStep } = require('./injectorSteps');

const REPORT_TYPES = {
  CUSTOMER: 'customer',
  INSPECTION: 'inspection',
  SUPPLIER_EVALUATION: 'supplier_evaluation',
};

// User-facing names for the report types (kept next to the internal ids so the
// two never drift apart).
const REPORT_TYPE_LABELS = {
  [REPORT_TYPES.CUSTOMER]: 'Customer Report',
  [REPORT_TYPES.INSPECTION]: 'Inspection Report',
  [REPORT_TYPES.SUPPLIER_EVALUATION]: 'Shipment Evaluation Report',
};

/** Filesystem-safe filename fragment. */
function sanitiseFilePart(value, fallback) {
  const s = String(value == null ? '' : value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || fallback;
}

/**
 * Load the selected injector rows, hydrated with their normalised test steps,
 * in the caller's selection order (which drives report column order).
 */
function loadSelectedInjectors(injectorIds = []) {
  const ids = (Array.isArray(injectorIds) ? injectorIds : []).map(String).filter(Boolean);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.all(`SELECT * FROM injector_test_reports WHERE id IN (${placeholders})`, ids);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  // Preserve the caller's order; drop ids that no longer exist.
  return ids.map((id) => byId.get(id)).filter(Boolean).map(hydrateInjectorRow);
}

/** Customer-facing steps of one injector (excludes the internal flush step). */
function scorableSteps(injector) {
  return (injector.tests || []).filter((t) => !isFlushStep(t) && t.primary);
}

/**
 * Check that the selected records carry the data a report needs.
 * Returns { ok, message, blocking: [...], warnings: [...] }.
 *   blocking — records that cannot be rendered at all (no test results)
 *   warnings — records missing helpful-but-optional identifying data
 */
function validateSelection(injectors = [], { requireJobNumber = false } = {}) {
  const list = Array.isArray(injectors) ? injectors : [];
  if (list.length === 0) {
    return { ok: false, message: 'Select at least one injector.', blocking: [], warnings: [] };
  }

  const label = (inj) => inj.serial_number || inj.part_number || inj.id;
  const noResults = list.filter((inj) => scorableSteps(inj).length === 0).map(label);
  const noSerial = list.filter((inj) => !inj.serial_number).map(label);
  const noPart = list.filter((inj) => !inj.part_number).map(label);
  const noJob = list.filter((inj) => !inj.job_number).map(label);

  const warnings = [];
  if (noSerial.length) warnings.push(`${noSerial.length} selected injector(s) have no serial number; their report column is labelled "—".`);
  if (noPart.length) warnings.push(`${noPart.length} selected injector(s) have no part number.`);
  if (noJob.length && !requireJobNumber) warnings.push(`${noJob.length} selected injector(s) have no job number.`);

  if (noResults.length) {
    const shown = noResults.slice(0, 5).join(', ');
    const more = noResults.length > 5 ? ` and ${noResults.length - 5} more` : '';
    return {
      ok: false,
      message: `${noResults.length} selected injector(s) have no test-bench results and cannot be included in a report: ${shown}${more}. Re-sync the test bench or clear them from the selection.`,
      blocking: noResults,
      warnings,
    };
  }
  if (requireJobNumber && noJob.length) {
    const shown = noJob.slice(0, 5).join(', ');
    return {
      ok: false,
      message: `A job number is required for this report. Missing on: ${shown}${noJob.length > 5 ? ` and ${noJob.length - 5} more` : ''}.`,
      blocking: noJob,
      warnings,
    };
  }

  return { ok: true, message: '', blocking: [], warnings };
}

/** Shape the DB rows into the structure the PDF renderers expect. */
function toReportInjectors(injectors = []) {
  return injectors.map((r) => ({
    id: r.id,
    part_number: r.part_number,
    serial_number: r.serial_number,
    job_number: r.job_number,
    brand: r.brand,
    injector_type: r.injector_type,
    machine_name: r.machine_name,
    machine_sn: r.machine_sn,
    test_datetime: r.test_datetime,
    overall_pass: r.overall_pass,
    tests: Array.isArray(r.tests) ? r.tests : [],
  }));
}

/** Landscape side-by-side comparison PDF for the selection. */
async function buildCustomerReport(injectors = [], opts = {}) {
  const list = toReportInjectors(injectors);
  const buffer = await generateInjectorComparisonPdf(list, opts);
  const part = sanitiseFilePart(list[0] && list[0].part_number, 'Injectors');
  return { buffer, filename: `InjectorReport_${part}_${list.length}.pdf` };
}

/**
 * Shipment Evaluation Report (summary page + test detail pages).
 * `opts.vendorName` identifies the shipment on both headers and is required —
 * the report is an assessment of a vendor's batch.
 */
async function buildShipmentEvaluationReport(injectors = [], opts = {}) {
  const list = toReportInjectors(injectors);
  const vendorName = String(opts.vendorName || '').trim();
  const buffer = await generateShipmentEvaluationPdf(list, { ...opts, vendorName });
  const part = sanitiseFilePart(list[0] && list[0].part_number, 'Injectors');
  const vendor = sanitiseFilePart(vendorName, '');
  const name = ['ShipmentEvaluation', part, vendor, String(list.length)].filter(Boolean).join('_');
  return { buffer, filename: `${name}.pdf` };
}

/**
 * Create (or refresh) the Fuel Injector inspection record(s) covering the
 * selection, grouped by bench test report — the app's existing model of one
 * inspection per report with one item per injector.
 *
 * Re-running for the same injectors UPDATES the existing inspection instead of
 * creating a second one, so repeated clicks cannot produce duplicates.
 */
function generateInspectionReports(injectors = [], opts = {}) {
  const list = Array.isArray(injectors) ? injectors : [];
  const byReport = new Map();
  for (const inj of list) {
    const key = inj.report_ext_id || `single:${inj.id}`;
    if (!byReport.has(key)) byReport.set(key, []);
    byReport.get(key).push(inj);
  }

  const inspections = [];
  let created = 0;
  let updated = 0;

  for (const [reportExtId, group] of byReport) {
    const wasCreated = autoFillReportInspection(reportExtId, group, { actor: opts.actor });
    // The auto-fill links every injector row to the inspection it produced.
    const link = db.get('SELECT inspection_id FROM injector_test_reports WHERE id = ?', [group[0].id]);
    const inspectionId = link ? link.inspection_id : null;
    if (wasCreated) created += 1; else updated += 1;
    inspections.push({
      inspection_id: inspectionId,
      report_ext_id: reportExtId,
      created: !!wasCreated,
      injector_count: group.length,
      part_number: group[0].part_number || null,
      job_number: group[0].job_number || null,
      serial_numbers: group.map((g) => g.serial_number).filter(Boolean),
      filename: `QC_${sanitiseFilePart(group[0].part_number, 'NoPart')}_${sanitiseFilePart(group.map((g) => g.serial_number).filter(Boolean).join('-'), 'NoSerial')}.pdf`,
    });
  }

  return { inspections, created, updated };
}

module.exports = {
  REPORT_TYPES,
  REPORT_TYPE_LABELS,
  sanitiseFilePart,
  loadSelectedInjectors,
  validateSelection,
  toReportInjectors,
  buildCustomerReport,
  buildShipmentEvaluationReport,
  generateInspectionReports,
};
