'use strict';
/**
 * Manual report generation for selected injector test records.
 *
 * Synchronisation only imports test data (see services/carbonzapp.js). Reports
 * are produced HERE, on demand, for the injectors the user picked on the
 * Injector Tests page:
 *
 *   customer            → "Custom Report" landscape comparison PDF
 *   inspection          → Fuel Injector (PDI-IQI-012) inspection record(s),
 *                         whose PDF is served by /api/inspections/:id/pdf
 *   supplier_evaluation → "Shipment Evaluation Report" (summary + detail PDF)
 *
 * Selection order is preserved everywhere so a report is reproducible.
 */

const db = require('../db/adapter');
const { hydrateInjectorRow } = require('./carbonzapp');
const { autoFillReportInspection } = require('./injectorInspection');
const {
  generateInjectorComparisonPdf,
  generateShipmentEvaluationPdf,
  buildInjectorComparisonModel,
  numericPartNumbers,
} = require('./pdf');
const { isFlushStep } = require('./injectorSteps');

const REPORT_TYPES = {
  CUSTOMER: 'customer',
  INSPECTION: 'inspection',
  SUPPLIER_EVALUATION: 'supplier_evaluation',
};

// User-facing names for the report types (kept next to the internal ids so the
// two never drift apart).
const REPORT_TYPE_LABELS = {
  [REPORT_TYPES.CUSTOMER]: 'Custom Report',
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
  const rows = db.all(
    `SELECT * FROM injector_test_reports
      WHERE id IN (${placeholders})
        AND (serial_number IS NULL OR UPPER(TRIM(serial_number)) NOT LIKE 'R%')
        AND (job_number IS NULL OR UPPER(job_number) NOT LIKE '%RMA%')`,
    ids
  );
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
function validateSelection(injectors = []) {
  const list = Array.isArray(injectors) ? injectors : [];
  if (list.length === 0) {
    return { ok: false, message: 'Select at least one injector.', blocking: [], warnings: [] };
  }

  const label = (inj) => inj.serial_number || inj.part_number || inj.id;
  const noResults = list.filter((inj) => scorableSteps(inj).length === 0).map(label);
  const noSerial = list.filter((inj) => !inj.serial_number).map(label);
  const noPart = list.filter((inj) => !inj.part_number).map(label);

  const warnings = [];
  if (noSerial.length) warnings.push(`${noSerial.length} selected injector(s) have no serial number; their report column is labelled "—".`);
  if (noPart.length) warnings.push(`${noPart.length} selected injector(s) have no part number.`);

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
  return { ok: true, message: '', blocking: [], warnings };
}

/** Shape the DB rows into the structure the PDF renderers expect. */
function toReportInjectors(injectors = []) {
  return injectors.map((r) => ({
    id: r.id,
    part_number: r.part_number,
    serial_number: r.serial_number,
    brand: r.brand,
    injector_type: r.injector_type,
    machine_name: r.machine_name,
    machine_sn: r.machine_sn,
    test_datetime: r.test_datetime,
    overall_pass: r.overall_pass,
    tests: Array.isArray(r.tests) ? r.tests : [],
  }));
}

/**
 * Landscape side-by-side comparison PDF for the selection.
 * The Custom Report header mirrors Shipment Evaluation (Part / Vendor / Report
 * Date). New callers supply vendorName; legacy callers fall back to the synced
 * bench brand so the existing endpoint remains compatible.
 */
async function buildCustomerReport(injectors = [], opts = {}) {
  const list = toReportInjectors(injectors);
  const brands = [...new Set(list.map((i) => String(i.brand || '').trim()).filter(Boolean))];
  const vendorName = String(opts.vendorName || '').trim() || brands.join(', ');
  const buffer = await generateInjectorComparisonPdf(list, {
    ...opts,
    vendorName,
    title: 'Injector Test Report',
  });
  const part = sanitiseFilePart(list[0] && list[0].part_number, 'Injectors');
  return { buffer, filename: `CustomReport_${part}_${list.length}.pdf` };
}

/**
 * JSON view of the same comparison model used by the PDF. It is intentionally
 * side-effect free: no PDF buffer, file download or inspection row is created.
 */
function buildReportPreview(injectors = []) {
  const list = toReportInjectors(injectors);
  const model = buildInjectorComparisonModel(list);
  const bound = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
  const dates = [...new Set(list.map((i) => String(i.test_datetime || '').slice(0, 10)).filter(Boolean))].sort();

  return {
    title: 'Custom Report Preview',
    parts: numericPartNumbers(list.map((i) => i.part_number)),
    brands: [...new Set(list.map((i) => String(i.brand || '').trim()).filter(Boolean))],
    dateFrom: dates[0] || '',
    dateTo: dates.length ? dates[dates.length - 1] : '',
    injectors: list.map((injector, index) => ({
      id: injector.id,
      partNumber: injector.part_number || '',
      serialNumber: injector.serial_number || '—',
      result: (model.results[index] && model.results[index].overall) || '—',
    })),
    rows: model.rowOrder.map((key) => {
      const row = model.rowMap.get(key);
      const hasRange = Number.isFinite(row.min) && Number.isFinite(row.max);
      return {
        key,
        label: row.label,
        specification: hasRange ? `${bound(row.min)} - ${bound(row.max)}` : (row.spec || '—'),
        unit: row.unit || '',
        values: model.injValues.map((values) => {
          const cell = values.get(key);
          const lines = cell && Array.isArray(cell.lines) ? cell.lines.filter(Boolean) : [];
          return {
            lines: lines.length ? lines : ['—'],
            status: cell && cell.status ? cell.status : 'unknown',
            error: Boolean(cell && cell.error),
          };
        }),
      };
    }),
  };
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
  buildReportPreview,
  buildShipmentEvaluationReport,
  generateInspectionReports,
};
