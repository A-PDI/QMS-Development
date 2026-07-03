'use strict';
/**
 * Auto-create / auto-fill a Fuel Injector (PDI-IQI-012) inspection from synced
 * CarbonZapp injector test reports.
 *
 * MODEL: one INSPECTION per physical TEST REPORT (grouped by report_ext_id).
 * A single test report may contain several injectors (one per bench slot); each
 * injector becomes ONE ITEM inside the inspection (section_data.__items[]).
 *
 * For every item:
 *   • DIMENSIONAL section  = that injector's flow / response test-bench steps.
 *   • RECEIVING & VISUAL   = auto-marked PASS ('P') when the injector passed all
 *                            of its flow tests; left OPEN ('') when it failed,
 *                            so a QC reviewer must inspect a failing injector.
 *
 * section_data shape produced (matches the client / PDF renderer):
 *   {
 *     __items: [ { receiving:[...], visual:[...], dimensional:[...],
 *                  __disposition, __disposition_notes }, ... ],
 *     __dimensional_added: true,
 *     __admin_sections: { ...template.sections, dimensional: {items:[...]} },
 *     __injector_source: { report_ext_id, injectors:[{id, slot_position, serial}] }
 *   }
 */

const crypto = require('crypto');
const db = require('../db/adapter');

const FUEL_INJECTOR_FORM = 'PDI-IQI-012';

function getFuelInjectorTemplate() {
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
 * The user-facing test-results layout is: Test Point | Specification | Value |
 * Pass/Fail. We store:
 *   item.measurement = test-step name (Test Point)
 *   item.spec        = green-band spec, flow tests only (e.g. "8.5 +/- 4.5 …")
 *   answer.actual1   = the AVERAGE reading only (Value)
 *   answer.status    = pass / fail / na (Pass/Fail)
 *
 * Returns { items, answers }.
 */
function buildDimensionalFromTests(tests) {
  const items = [];
  const answers = [];
  let id = 0;

  for (const t of tests) {
    if (!t.primary) continue;            // no measurable result (skipped steps)

    id += 1;
    const p = t.primary;
    // Show the flow spec (green band) only; do NOT append bench conditions here
    // — the user asked for Specification = flow spec only.
    const spec = p.spec || '';
    // Dimensional status uses the shared P/F/A code so it renders in the app
    // (PFNToggle) and PDF (statusToGlyph) identically. '' when not scored.
    const statusVal = t.status === 'fail' ? 'F' : (t.status === 'pass' ? 'P' : '');

    items.push({
      id,
      measurement: t.name || t.raw_name || `Step ${id}`,
      spec,
    });
    answers.push({
      id,
      // Persist the spec on the answer row too so it is visible in the app view
      // (the client reads row.spec; without this the Spec/Limit column is blank).
      spec,
      actual1: p.average || '',          // single AVERAGE value ("Actual")
      status: statusVal,
      __unit: p.unit || '',
    });

    // Secondary tank (if any) gets its own row.
    if (t.secondary) {
      id += 1;
      const s = t.secondary;
      const sStatusVal = s.status === 'fail' ? 'F' : (s.status === 'pass' ? 'P' : '');
      items.push({
        id,
        measurement: `${t.name || t.raw_name} — ${s.tank_name || 'Secondary'}`,
        spec: s.spec || '',
      });
      answers.push({
        id,
        spec: s.spec || '',
        actual1: s.average || '',
        status: sStatusVal,
        __unit: s.unit || '',
      });
    }
  }

  return { items, answers };
}

// Normalised test steps for an injector row (from live sync or DB report_json).
function testsFor(inj) {
  if (Array.isArray(inj.tests)) return inj.tests;
  if (inj.report_json) {
    const rj = typeof inj.report_json === 'string'
      ? safeParse(inj.report_json)
      : inj.report_json;
    if (rj && Array.isArray(rj.tests)) return rj.tests;
  }
  return [];
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

/**
 * Build the per-item section_data (checklists + dimensional) for one injector.
 * Receiving & Visual auto-pass when the injector passed all flow tests.
 */
function buildItemForInjector(inj, templateSections) {
  const tests = testsFor(inj);
  const { answers } = buildDimensionalFromTests(tests);

  const passed = inj.overall_pass === 1;
  const failed = inj.overall_pass === 0;

  // Receiving (pfn_checklist) and Visual (pass_fail_checklist) both use the
  // unified {id, result} shape.
  //
  //  • SECTION A — Receiving & Documentation Verification (pfn_checklist):
  //    always auto-marked PASS on generation. These checks (carton condition,
  //    labels, part marking, quantity, corrosion protection) are independent of
  //    the flow-test outcome, so they are populated regardless of pass/fail.
  //  • VISUAL / quality checklist (pass_fail_checklist): auto-marked PASS when
  //    the injector passed every flow test, left OPEN when it failed so a QC
  //    reviewer must inspect a failing injector.
  const visualResult = passed ? 'P' : '';
  const item = {};

  for (const [key, section] of Object.entries(templateSections)) {
    if (key === 'dimensional') continue; // handled below
    const srcItems = Array.isArray(section.items) ? section.items : [];
    if (section.section_type === 'pfn_checklist') {
      // Section A (Receiving & Documentation) — always Pass.
      // IMPORTANT: the pfn_checklist renderer (SectionReceiving.jsx) and the PDF
      // read the per-item value from `status` (NOT `result`, which is what the
      // pass_fail_checklist renderer uses). Populate BOTH so the mark shows up
      // regardless of which renderer reads the row.
      item[key] = srcItems.map((it) => ({ id: it.id, status: 'P', result: 'P', notes: '', finding: '' }));
    } else if (section.section_type === 'pass_fail_checklist') {
      // Visual checklist (SectionChecklist.jsx / PDF) reads `result`.
      item[key] = srcItems.map((it) => ({ id: it.id, result: visualResult, status: visualResult, notes: '', finding: '' }));
    }
  }

  item.dimensional = answers;
  // Disposition uses the app's UPPERCASE codes (PASS / FAIL) so badges, the
  // detail view, and the PDF all colour + label it consistently.
  item.__disposition = inj.overall_pass == null ? '' : (failed ? 'FAIL' : 'PASS');
  item.__disposition_notes = '';
  return item;
}

/**
 * Create or update ONE Fuel Injector inspection for a whole test report.
 *
 * @param {string} reportExtId  the CarbonZapp report _id
 * @param {Array}  injectorRows mapped injector objects that belong to that
 *                              report (each with id, slot_position, tests, …)
 * Returns true if a NEW inspection was created.
 */
function autoFillReportInspection(reportExtId, injectorRows) {
  if (!reportExtId || !Array.isArray(injectorRows) || injectorRows.length === 0) return false;

  const template = getFuelInjectorTemplate();
  if (!template) {
    console.warn('[InjectorInspection] Fuel Injector template (PDI-IQI-012) not found — skipping auto-fill.');
    return false;
  }
  const templateSections = JSON.parse(template.sections || '{}');

  // Stable ordering: by slot position, then serial.
  const injectors = [...injectorRows].sort((a, b) => {
    const s = (a.slot_position || 0) - (b.slot_position || 0);
    if (s !== 0) return s;
    return String(a.serial_number || '').localeCompare(String(b.serial_number || ''));
  });

  // The dimensional section item list is per-injector; the client applies
  // __admin_sections to ALL items, so use the first injector's steps to define
  // the row labels/specs. (All injectors on a report run the same test plan.)
  const { items: dimItems } = buildDimensionalFromTests(testsFor(injectors[0]));
  const adminSections = JSON.parse(JSON.stringify(templateSections));
  adminSections.dimensional = {
    title: 'C. DIMENSIONAL INSPECTION — INJECTOR TEST BENCH RESULTS',
    section_type: 'dimensional',
    // 'single_value' layout: one measured value per row (renamed "Actual"),
    // no Location column and no Actual 2 / Actual 3 columns. The test bench
    // reports a single averaged flow value, so the extra columns don't apply.
    layout: 'single_value',
    items: dimItems,
  };

  const __items = injectors.map((inj) => buildItemForInjector(inj, adminSections));

  const sectionData = {
    __items,
    __dimensional_added: true,
    __admin_sections: adminSections,
    __injector_source: {
      report_ext_id: reportExtId,
      injectors: injectors.map((i) => ({
        id: i.id, slot_position: i.slot_position, serial: i.serial_number,
      })),
    },
  };

  // Overall disposition: pass only if every injector passed; fail if any failed.
  // UPPERCASE to match the app's disposition vocabulary (PASS / FAIL).
  const anyFail = injectors.some((i) => i.overall_pass === 0);
  const allScored = injectors.every((i) => i.overall_pass != null);
  const disposition = !allScored ? '' : (anyFail ? 'FAIL' : 'PASS');

  // Header info from the first injector (shared across the report).
  const head = injectors[0];
  const serials = injectors.map((i) => i.serial_number).filter(Boolean).join(', ');
  const now = new Date().toISOString();

  // Is there already an inspection for this report? (Any injector row that is
  // already linked points at it.)
  let inspectionId = null;
  for (const inj of injectors) {
    const link = db.get('SELECT inspection_id FROM injector_test_reports WHERE id = ?', [inj.id]);
    if (link && link.inspection_id) { inspectionId = link.inspection_id; break; }
  }

  if (inspectionId) {
    const insp = db.get('SELECT id, status FROM inspections WHERE id = ?', [inspectionId]);
    if (insp) {
      if (insp.status !== 'complete') {
        db.run(
          `UPDATE inspections SET
             part_number = ?, lot_serial_no = ?, po_number = ?, description = ?,
             date_received = ?, item_count = ?, section_data = ?, disposition = ?, updated_at = ?
           WHERE id = ?`,
          [
            head.part_number || null,
            serials || null,
            head.job_number || null,
            [head.brand, head.injector_type].filter(Boolean).join(' ') || null,
            (head.test_datetime || now).slice(0, 10),
            injectors.length,
            JSON.stringify(sectionData),
            disposition || null,
            now,
            insp.id,
          ]
        );
      }
      // Ensure every injector row on this report links to the inspection.
      for (const inj of injectors) {
        db.run('UPDATE injector_test_reports SET inspection_id = ? WHERE id = ?', [insp.id, inj.id]);
      }
      return false;
    }
  }

  // Create a fresh inspection for the whole report.
  inspectionId = crypto.randomUUID();
  db.run(
    `INSERT INTO inspections
       (id, template_id, component_type, form_no, part_number, supplier, po_number, description,
        date_received, inspector_name, lot_serial_no, status, item_count, section_data,
        disposition, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    [
      inspectionId,
      template.id,
      template.component_type,
      template.form_no,
      head.part_number || null,
      head.brand || null,
      head.job_number || null,
      [head.brand, head.injector_type].filter(Boolean).join(' ') || null,
      (head.test_datetime || now).slice(0, 10),
      'Injector Test Bench',
      serials || null,
      injectors.length,
      JSON.stringify(sectionData),
      disposition || null,
      now,
      now,
    ]
  );

  for (const inj of injectors) {
    db.run('UPDATE injector_test_reports SET inspection_id = ? WHERE id = ?', [inspectionId, inj.id]);
  }

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
  buildItemForInjector,
  autoFillReportInspection,
};
