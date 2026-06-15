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
    title: 'C. DIMENSIONAL INSPECTION — Groove Specs',
    section_type: 'dimensional',
    optional: true,
    items: [
      { id: 1, measurement: 'Groove diameter', location: '', spec: '6.300" Groove OD for CAT, 5.990" Groove OD for Cummins' },
      { id: 2, measurement: 'Groove Depth',    location: '', spec: '.029-.031"' },
      { id: 3, measurement: 'Wire Protrusion', location: '', spec: '.008-.010"' },
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
    title: 'C. DIMENSIONAL INSPECTION — Test Valves (Vacuum)',
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
}

module.exports = { applyMigrations };
