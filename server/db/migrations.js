'use strict';
/**
 * One-time database migrations.
 * Each migration has a unique id and is tracked in the schema_migrations table.
 * Safe to call on every startup — already-applied migrations are no-ops.
 */

const { v4: uuidv4 } = require('uuid');

// ─── PDI-IQI-005 Rev B sections ──────────────────────────────────────────────
const RECEIVING_ITEMS = [
  { id: 1, name: 'Outer Carton Condition',              requirement: 'Carton undamaged — no crushing, tears, moisture staining, or exposed contents' },
  { id: 2, name: 'Box / Package Label',                 requirement: 'Label present; part number, description, and quantity match purchase order exactly' },
  { id: 3, name: 'Part Marking',                        requirement: 'PDI logo and part number permanently marked on part; matches purchase order' },
  { id: 4, name: 'Quantity Verification',               requirement: 'Physical count matches packing slip and purchase order line item; no shorts or mixed counts' },
  { id: 5, name: 'Corrosion / Contamination Protection', requirement: 'Parts wrapped in VCI film or oil-coated; no visible rust, oxidation, or contamination on arrival' },
];

const IQI_005_V2_SECTIONS = {
  receiving: {
    title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
    section_type: 'pfn_checklist',
    items: RECEIVING_ITEMS,
  },
  visual: {
    title: 'B. VISUAL INSPECTION',
    section_type: 'pfn_checklist',
    items: [
      { id: 1,  name: 'Oxidation / Markings',           requirement: 'Should be free of rust, pitting, or other material oxidation' },
      { id: 2,  name: 'Edge Debur',                      requirement: 'Check machined edges for sharp edges' },
      { id: 3,  name: 'Block-off Plugs',                 requirement: 'Confirm all required plugs are in place and torqued to spec' },
      { id: 4,  name: 'Heat Tab',                        requirement: 'Confirm Heat Tab in installed appropriately' },
      { id: 5,  name: 'Casting Quality',                 requirement: 'Using bore-scope verify casting quality in all intake and exhaust ports' },
      { id: 6,  name: 'Finish',                          requirement: 'Confirm machining finish and casting quality' },
      { id: 7,  name: 'Machining Quality',               requirement: 'Verify machining quality in all intake and exhaust ports if applicable' },
      { id: 8,  name: 'Material Type',                   requirement: 'Confirm injector cup material type' },
      { id: 9,  name: 'Pass-through bore (Cummins)',     requirement: 'Confirm pass through tube fits bore' },
      { id: 10, name: 'Correct Valves',                  requirement: 'Confirm intake/exhaust in correct locations' },
      { id: 11, name: 'Springs / Retainers / Keepers',  requirement: 'Confirm correct spring assemblies and everything assembled properly' },
    ],
  },
  general_measurements: {
    title: 'C. DIMENSIONAL INSPECTION — General',
    section_type: 'general_measurements',
    optional: true,
    items: [
      { id: 1, measurement: 'Cylinder Head Height' },
      { id: 2, measurement: 'Surface Finish (Ra)' },
      { id: 3, measurement: 'Flatness' },
      { id: 4, measurement: 'Valve Stem Height' },
    ],
  },
  groove_specs: {
    title: 'C. DIMENSIONAL INSPECTION — Fire Ring',
    section_type: 'groove_specs',
    optional: true,
    cylinder_count: 6,
    // All three specs are shown in the section header. Only items flagged
    // `entry: true` get per-cylinder data-entry fields (Wire Protrusion only).
    items: [
      { id: 1, measurement: 'Groove Diameter', location: '', spec: '6.300" Groove OD for CAT, 5.990" Groove OD for Cummins', entry: false },
      { id: 2, measurement: 'Groove Depth',    location: '', spec: '.029-.031"', entry: false },
      { id: 3, measurement: 'Wire Protrusion', location: '', spec: '.008-.010"', entry: true },
    ],
  },
  valve_recession: {
    title: 'C. DIMENSIONAL INSPECTION — Valve Recession',
    section_type: 'valve_recession',
    optional: true,
    cylinder_count: 6,
    intake_count: 2,
    exhaust_count: 2,
  },
  vacuum_test: {
    title: 'C. DIMENSIONAL INSPECTION — Vacuum Test',
    section_type: 'vacuum_test',
    optional: true,
    cylinder_count: 6,
    intake_count: 2,
    exhaust_count: 2,
  },
};

// ─── Migration runner ─────────────────────────────────────────────────────────

function applyMigrations(db) {
  // Ensure tracking table exists
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    db.all('SELECT id FROM schema_migrations', []).map(r => r.id)
  );

  function once(id, fn) {
    if (applied.has(id)) return;
    try {
      fn();
      db.run('INSERT INTO schema_migrations (id) VALUES (?)', [id]);
      console.log(`[Migration] Applied: ${id}`);
    } catch (err) {
      console.error(`[Migration] Failed: ${id} —`, err.message);
    }
  }

  // ── Migration: PDI-IQI-005 Rev B ──────────────────────────────────────────
  once('pdi_iqi_005_rev_b', () => {
    const FORM_NO = 'PDI-IQI-005';
    const TITLE   = 'PDI Incoming Quality Inspection — Cylinder Head';
    const now     = new Date().toISOString();

    // Rev B already exists — nothing to do
    if (db.get("SELECT id FROM inspection_templates WHERE form_no = ? AND revision = 'B'", [FORM_NO])) return;

    // Find (or create) the Rev A baseline
    let revA = db.get("SELECT id, version FROM inspection_templates WHERE form_no = ? AND revision = 'A'", [FORM_NO]);

    if (!revA) {
      // Stamp any existing blank-revision record as Rev A and deactivate it
      const legacy = db.get(
        "SELECT id, version FROM inspection_templates WHERE form_no = ? AND (revision = '' OR revision IS NULL)",
        [FORM_NO]
      );
      if (legacy) {
        db.run("UPDATE inspection_templates SET revision = 'A', active = 0 WHERE id = ?", [legacy.id]);
        revA = { id: legacy.id, version: legacy.version || 1 };
      } else {
        // No IQI-005 at all in this DB — skip (fresh DB will get it from seed binary)
        return;
      }
    }

    // Insert Rev B as the active version
    const revBId = uuidv4();
    db.run(
      `INSERT INTO inspection_templates
         (id, component_type, form_no, revision, title, form_type, disposition_type,
          header_schema, sections, active, created_at, version, parent_template_id)
       VALUES (?, ?, ?, 'B', ?, 'iqi_combined', 'pass_fail', ?, ?, 1, ?, ?, ?)`,
      [
        revBId, 'cylinder_head', FORM_NO, TITLE,
        JSON.stringify(['part_number', 'po_number', 'description', 'date_received', 'inspector_name', 'lot_serial_no']),
        JSON.stringify(IQI_005_V2_SECTIONS),
        now, (revA.version || 1) + 1, revA.id,
      ]
    );
    // Deactivate all other IQI-005 variants
    db.run("UPDATE inspection_templates SET active = 0 WHERE form_no = ? AND id != ?", [FORM_NO, revBId]);
  });

  // ── Migration: rename Vacuum Test section title ───────────────────────────
  // The original Rev B insert used "C. DIMENSIONAL INSPECTION — Test Valves
  // (Vacuum)". For databases that already have Rev B, patch the stored sections
  // JSON so the section header reads "C. DIMENSIONAL INSPECTION — Vacuum Test".
  once('iqi_005_vacuum_test_rename', () => {
    const OLD_TITLE = 'C. DIMENSIONAL INSPECTION — Test Valves (Vacuum)';
    const NEW_TITLE = 'C. DIMENSIONAL INSPECTION — Vacuum Test';
    const rows = db.all(
      "SELECT id, sections FROM inspection_templates WHERE sections LIKE ?",
      [`%${OLD_TITLE}%`]
    );
    for (const row of rows) {
      let sections;
      try {
        sections = JSON.parse(row.sections);
      } catch {
        continue;
      }
      let changed = false;
      for (const key of Object.keys(sections)) {
        if (sections[key] && sections[key].title === OLD_TITLE) {
          sections[key].title = NEW_TITLE;
          changed = true;
        }
      }
      if (changed) {
        db.run('UPDATE inspection_templates SET sections = ? WHERE id = ?', [
          JSON.stringify(sections),
          row.id,
        ]);
      }
    }
  });

  // ── Migration: Groove Specs chart layout ──────────────────────────────────
  // Originally the Groove Specs section reused the generic 'dimensional'
  // renderer. It now has its own 'groove_specs' chart renderer (specs in the
  // header, one 6-cylinder chart per measurement). Patch existing templates so
  // the section_type and cylinder_count match the new component.
  once('iqi_005_groove_specs_chart', () => {
    const rows = db.all(
      "SELECT id, sections FROM inspection_templates WHERE sections LIKE ?",
      ['%Groove Specs%']
    );
    for (const row of rows) {
      let sections;
      try {
        sections = JSON.parse(row.sections);
      } catch {
        continue;
      }
      let changed = false;
      for (const key of Object.keys(sections)) {
        const s = sections[key];
        if (s && typeof s.title === 'string' && s.title.includes('Groove Specs')) {
          if (s.section_type !== 'groove_specs') { s.section_type = 'groove_specs'; changed = true; }
          if (!s.cylinder_count) { s.cylinder_count = 6; changed = true; }
          if (Array.isArray(s.items)) {
            for (const it of s.items) {
              if (it.measurement === 'Groove diameter') { it.measurement = 'Groove Diameter'; changed = true; }
            }
          }
        }
      }
      if (changed) {
        db.run('UPDATE inspection_templates SET sections = ? WHERE id = ?', [
          JSON.stringify(sections),
          row.id,
        ]);
      }
    }
  });

  // ── Migration: Fire Ring rename + entry flags ─────────────────────────────
  // "Groove Specs" is renamed to "Fire Ring". All three specs stay in the
  // section header, but only Wire Protrusion gets per-cylinder data-entry
  // fields (entry: true); Groove Diameter / Groove Depth are header-only.
  once('iqi_005_groove_specs_to_fire_ring', () => {
    const rows = db.all(
      "SELECT id, sections FROM inspection_templates WHERE sections LIKE ?",
      ['%"section_type":"groove_specs"%']
    );
    for (const row of rows) {
      let sections;
      try {
        sections = JSON.parse(row.sections);
      } catch {
        continue;
      }
      let changed = false;
      for (const key of Object.keys(sections)) {
        const s = sections[key];
        if (!s || s.section_type !== 'groove_specs') continue;
        if (typeof s.title === 'string' && s.title.includes('Groove Specs')) {
          s.title = s.title.replace('Groove Specs', 'Fire Ring');
          changed = true;
        }
        if (Array.isArray(s.items)) {
          for (const it of s.items) {
            const wantEntry = /wire protrusion/i.test(it.measurement || '');
            if (it.entry !== wantEntry) { it.entry = wantEntry; changed = true; }
          }
        }
      }
      if (changed) {
        db.run('UPDATE inspection_templates SET sections = ? WHERE id = ?', [
          JSON.stringify(sections),
          row.id,
        ]);
      }
    }
  });

  // ── Migration: multi-item inspection support ──────────────────────────────
  // Adds an item_count column so a single inspection record can represent
  // multiple inspected items. Per-item answers live in section_data.__items
  // (an array); item_count tracks how many items the inspection covers.
  once('add_item_count_column', () => {
    const cols = db.all('PRAGMA table_info(inspections)', []).map(c => c.name);
    if (!cols.includes('item_count')) {
      db.run('ALTER TABLE inspections ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1');
    }
  });

  // ── Migration: injector flow test bench integration ───────────────────────
  // Tables for synced injector-flow-test-bench reports. A single bench report
  // covers one or more physical injectors (test slots); each slot becomes one
  // row in injector_test_results, linked back to its parent report.
  once('injector_test_bench_schema', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS injector_test_reports (
      id TEXT PRIMARY KEY,
      external_id TEXT UNIQUE NOT NULL,
      coding_name TEXT,
      issuer_name TEXT,
      machine_name TEXT,
      machine_sn TEXT,
      drs_id TEXT,
      workshop_info TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      customer_mail TEXT,
      customer_notes TEXT,
      actuator_code TEXT,
      actuator_brand TEXT,
      actuator_type TEXT,
      pump_code TEXT,
      notes TEXT,
      machine_details TEXT,
      job_number TEXT,
      report_status INTEGER,
      report_datetime TEXT,
      source_created_at TEXT,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS injector_test_results (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES injector_test_reports(id) ON DELETE CASCADE,
      slot_position INTEGER NOT NULL DEFAULT 0,
      serial_number TEXT,
      part_number TEXT,
      old_code TEXT,
      injector_brand TEXT,
      injector_type TEXT,
      overall_result TEXT,
      tests_json TEXT NOT NULL DEFAULT '[]',
      raw_slot_json TEXT,
      inspection_id TEXT REFERENCES inspections(id) ON DELETE SET NULL,
      inspection_item_index INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_injector_results_report ON injector_test_results(report_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_injector_results_serial ON injector_test_results(serial_number)');

    // Small key/value table for non-secret app config (currently just the
    // injector-bench sync cursor). No existing precedent for this in the
    // codebase — secrets stay in env vars, this is only for cursor state.
    db.exec(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  });

  // ── Migration: Fuel Injector Dimensional Inspection section ───────────────
  // PDI-IQI-012 (Fuel Injector) originally shipped with only Receiving +
  // Visual sections. Add a "C. DIMENSIONAL INSPECTION — Flow Test" section
  // (standard `dimensional` renderer) so synced test-bench results have a
  // place to land. Starts with an empty items array; rows are populated
  // per-inspection (via section_data.__admin_sections) when an inspection is
  // auto-created from synced injector data — see injectorTestBench.js.
  once('fuel_injector_dimensional_section', () => {
    const rows = db.all("SELECT id, sections FROM inspection_templates WHERE form_no = 'PDI-IQI-012'", []);
    for (const row of rows) {
      let sections;
      try {
        sections = JSON.parse(row.sections);
      } catch {
        continue;
      }
      if (sections.dimensional) continue;
      sections.dimensional = {
        title: 'C. DIMENSIONAL INSPECTION — Flow Test',
        section_type: 'dimensional',
        items: [],
      };
      db.run('UPDATE inspection_templates SET sections = ? WHERE id = ?', [JSON.stringify(sections), row.id]);
    }
  });
}

module.exports = { applyMigrations };
