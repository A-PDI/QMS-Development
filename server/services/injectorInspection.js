'use strict';
/**
 * Auto-create / auto-fill a Fuel Injector (PDI-IQI-012) inspection from a
 * synced CarbonZapp injector test report.
 *
 * The test-bench results become the DIMENSIONAL INSPECTION section of the
 * fuel-injector form. Once populated, the inspection behaves like any other
 * inspection in the app (review, complete, PDF, etc.).
 *
 * section_data shape produced (matches what the client / PDF renderer expect):
 *   {
 *     __items: [ { <sectionKey>: <answer>, __disposition, __disposition_notes } ],
 *     __dimensional_added: true,
 *     __admin_sections: { ...template.sections, dimensional: {items: [...]} },
 *     __injector_source: { report_ext_id, slot_position }
 *   }
 * The dimensional answer is an array of { id, actual1, status } rows keyed to
 * the (per-inspection) dimensional item ids, so renderDimensional() shows the
 * measured flow result and a pass/fail glyph for each test step.
 */

const crypto = require('crypto');
const db = require('../db/adapter');

const FUEL_INJECTOR_FORM = 'PDI-IQI-012';

function getFuelInjectorTemplate() {
  // Prefer the active template for the fuel_injector component type.
  return db.get(
    `SELECT * FROM inspection_templates
       WHERE form_no = ? AND active = 1
       ORDER BY version DESC LIMIT 1`,
    [FUEL_INJECTOR_FORM]
  ) || db.get('SELECT * FROM inspection_templates WHERE form_no = ? LIMIT 1', [FUEL_INJECTOR_FORM]);
}

/**
 * Build the dimensional section definition (items) + the per-item answer rows
 * from an injector's normalised test steps.
 *
 * Returns { items, answers }:
 *   items:   [ { id, measurement, location, spec } ]  (one per scored test step)
 *   answers: [ { id, actual1, actual2, actual3, status } ]
 */
function buildDimensionalFromTests(tests) {
  const items = [];
  const answers = [];
  let id = 0;

  for (const t of tests) {
    // Skip steps that were skipped and have no measurable result.
    if (t.skipped && !t.primary) continue;
    if (!t.primary) continue;

    id += 1;
    const p = t.primary;
    const specParts = [];
    if (p.spec) specParts.push(p.spec);
    if (t.conditions) specParts.push(`(${t.conditions})`);

    // Map internal status → the checklist glyph value used by the PDF/UI.
    // renderDimensional expects a status string; the app treats 'pass'/'fail'.
    const statusVal = t.status === 'fail' ? 'fail' : (t.status === 'pass' ? 'pass' : 'na');

    items.push({
      id,
      measurement: t.name || t.raw_name || `Step ${id}`,
      location: p.tank_name ? `Tank ${p.tank_name}` : '',
      spec: specParts.join(' '),
    });
    answers.push({
      id,
      actual1: p.results || p.average || '',
      actual2: '',
      actual3: '',
      status: statusVal,
      __unit: p.unit || '',
    });

    // If there is a secondary tank, add it as its own row.
    if (t.secondary) {
      id += 1;
      const s = t.secondary;
      const sStatusVal = s.status === 'fail' ? 'fail' : (s.status === 'pass' ? 'pass' : 'na');
      items.push({
        id,
        measurement: `${t.name || t.raw_name} — ${s.tank_name || 'Secondary'}`,
        location: s.tank_name ? `Tank ${s.tank_name}` : '',
        spec: s.spec || '',
      });
      answers.push({
        id,
        actual1: s.results || s.average || '',
        actual2: '',
        actual3: '',
        status: sStatusVal,
        __unit: s.unit || '',
      });
    }
  }

  return { items, answers };
}

/**
 * Create or update a Fuel Injector inspection for a single synced injector row.
 * `inj` is the mapped injector object from carbonzapp.mapReportToInjector
 * (must include `id`, `tests`, and header fields).
 *
 * Returns true if a NEW inspection was created, false if an existing one was
 * updated (or nothing needed doing).
 */
function autoFillInjectorInspection(inj) {
  const template = getFuelInjectorTemplate();
  if (!template) {
    console.warn('[InjectorInspection] Fuel Injector template (PDI-IQI-012) not found — skipping auto-fill.');
    return false;
  }

  const templateSections = JSON.parse(template.sections || '{}');
  const tests = Array.isArray(inj.tests)
    ? inj.tests
    : (inj.report_json && Array.isArray(inj.report_json.tests) ? inj.report_json.tests : []);

  const { items, answers } = buildDimensionalFromTests(tests);

  // Per-inspection section overrides: replace the placeholder dimensional
  // section items with the actual test-step rows.
  const adminSections = JSON.parse(JSON.stringify(templateSections));
  adminSections.dimensional = {
    title: 'C. DIMENSIONAL INSPECTION — INJECTOR TEST BENCH RESULTS',
    section_type: 'dimensional',
    items,
  };

  const overallFail = inj.overall_pass === 0;
  const disposition = inj.overall_pass == null ? '' : (overallFail ? 'fail' : 'pass');

  const sectionData = {
    __items: [
      {
        dimensional: answers,
        __disposition: disposition,
        __disposition_notes: '',
      },
    ],
    __dimensional_added: true,
    __admin_sections: adminSections,
    __injector_source: {
      report_ext_id: inj.report_ext_id,
      slot_position: inj.slot_position,
      injector_report_id: inj.id,
    },
  };

  const now = new Date().toISOString();

  // Has an inspection already been created for this injector?
  const existingLink = db.get(
    'SELECT inspection_id FROM injector_test_reports WHERE id = ?',
    [inj.id]
  );

  if (existingLink && existingLink.inspection_id) {
    const insp = db.get('SELECT id, status FROM inspections WHERE id = ?', [existingLink.inspection_id]);
    if (insp) {
      // Only refresh inspections that haven't been manually completed, so we
      // don't clobber a QC sign-off.
      if (insp.status !== 'complete') {
        db.run(
          `UPDATE inspections SET
             part_number = ?, lot_serial_no = ?, po_number = ?, description = ?,
             date_received = ?, section_data = ?, disposition = ?, updated_at = ?
           WHERE id = ?`,
          [
            inj.part_number || null,
            inj.serial_number || null,
            inj.job_number || null,
            [inj.brand, inj.injector_type].filter(Boolean).join(' ') || null,
            (inj.test_datetime || now).slice(0, 10),
            JSON.stringify(sectionData),
            disposition || null,
            now,
            insp.id,
          ]
        );
      }
      return false;
    }
  }

  // Create a fresh inspection.
  const inspectionId = crypto.randomUUID();
  db.run(
    `INSERT INTO inspections
       (id, template_id, component_type, form_no, part_number, supplier, po_number, description,
        date_received, inspector_name, lot_serial_no, status, item_count, section_data,
        disposition, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
    [
      inspectionId,
      template.id,
      template.component_type,
      template.form_no,
      inj.part_number || null,
      inj.brand || null,
      inj.job_number || null,
      [inj.brand, inj.injector_type].filter(Boolean).join(' ') || null,
      (inj.test_datetime || now).slice(0, 10),
      'Injector Test Bench',
      inj.serial_number || null,
      JSON.stringify(sectionData),
      disposition || null,
      now,
      now,
    ]
  );

  // Link the injector row to the inspection.
  db.run('UPDATE injector_test_reports SET inspection_id = ? WHERE id = ?', [inspectionId, inj.id]);

  try {
    db.run(
      `INSERT INTO inspection_activity_log (id, inspection_id, action_type, actor_name, actor_id, created_at)
       VALUES (?, ?, 'started', 'Injector Test Bench Sync', NULL, ?)`,
      [crypto.randomUUID(), inspectionId, now]
    );
  } catch (_) {}

  return true;
}

module.exports = {
  FUEL_INJECTOR_FORM,
  getFuelInjectorTemplate,
  buildDimensionalFromTests,
  autoFillInjectorInspection,
};
