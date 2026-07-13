'use strict';
/**
 * One-time database migrations.
 * Each migration has a unique id and is tracked in the schema_migrations table.
 * Safe to call on every startup — already-applied migrations are no-ops.
 */

const { v4: uuidv4 } = require('uuid');
const { TEMPLATES } = require('./seed');

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

  // ── Migration: repair injector_test_reports schema ────────────────────────
  // Some early deployments created an `injector_test_reports` table with an
  // incomplete schema (missing `report_ext_id` and the other CarbonZapp
  // columns), so `CREATE TABLE IF NOT EXISTS` in sqlite.js was a no-op and the
  // Sync failed with "no such column: report_ext_id".
  //
  // This migration brings the table up to the expected shape. Missing columns
  // are added in-place via ALTER TABLE where possible. If the table is present
  // but so far off that it can't be patched (e.g. missing the NOT NULL
  // report_ext_id that the unique index needs), it is rebuilt — the table only
  // holds a cache of test-bench data that is re-fetchable from CarbonZapp on the
  // next Sync, so dropping it is safe.
  once('repair_injector_test_reports_schema', () => {
    const info = db.all("PRAGMA table_info(injector_test_reports)", []);
    // Table doesn't exist yet — sqlite.js will have created it correctly. Skip.
    if (!info || info.length === 0) return;

    const existing = new Set(info.map(c => c.name));

    // Columns that can be safely added in place (nullable / defaulted).
    const addable = [
      ['slot_position', "INTEGER NOT NULL DEFAULT 0"],
      ['part_number',   'TEXT'],
      ['serial_number', 'TEXT'],
      ['job_number',    'TEXT'],
      ['brand',         'TEXT'],
      ['injector_type', 'TEXT'],
      ['machine_name',  'TEXT'],
      ['machine_sn',    'TEXT'],
      ['test_datetime', 'TEXT'],
      ['ext_status',    'INTEGER'],
      ['overall_pass',  'INTEGER'],
      ['steps_total',   'INTEGER DEFAULT 0'],
      ['steps_passed',  'INTEGER DEFAULT 0'],
      ['steps_failed',  'INTEGER DEFAULT 0'],
      ['report_json',   "TEXT NOT NULL DEFAULT '{}'"],
      ['inspection_id', 'TEXT'],
      ['synced_at',     "TEXT NOT NULL DEFAULT (datetime('now'))"],
      ['created_at',    "TEXT NOT NULL DEFAULT (datetime('now'))"],
    ];

    // `report_ext_id` is NOT NULL with no default and is part of the unique
    // index, so it can't be added to a table that already has rows. If it's
    // missing we rebuild the whole table.
    const needsRebuild = !existing.has('report_ext_id') || !existing.has('id');

    if (needsRebuild) {
      db.exec('DROP TABLE IF EXISTS injector_test_reports');
      db.exec(`CREATE TABLE injector_test_reports (
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
        steps_total INTEGER DEFAULT 0,
        steps_passed INTEGER DEFAULT 0,
        steps_failed INTEGER DEFAULT 0,
        report_json TEXT NOT NULL DEFAULT '{}',
        inspection_id TEXT REFERENCES inspections(id) ON DELETE SET NULL,
        synced_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    } else {
      // Table has the key columns — just add any that are still missing.
      for (const [name, decl] of addable) {
        if (!existing.has(name)) {
          try {
            db.run(`ALTER TABLE injector_test_reports ADD COLUMN ${name} ${decl}`);
          } catch (e) {
            console.error(`[Migration] could not add column ${name}:`, e.message);
          }
        }
      }
    }

    // (Re)create the indexes — no-ops if they already exist.
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_injector_reports_unique ON injector_test_reports(report_ext_id, slot_position)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_injector_reports_datetime ON injector_test_reports(test_datetime DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_injector_reports_serial ON injector_test_reports(serial_number)');
  });

  // ── Migration: ensure app_settings table exists with the right shape ──────
  // Guards against an early deployment that created app_settings without the
  // expected columns (used to store the CarbonZapp API key + last sync time).
  once('repair_app_settings_schema', () => {
    const info = db.all("PRAGMA table_info(app_settings)", []);
    if (!info || info.length === 0) {
      db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      return;
    }
    const existing = new Set(info.map(c => c.name));
    if (!existing.has('value')) {
      try { db.run('ALTER TABLE app_settings ADD COLUMN value TEXT'); }
      catch (e) { console.error('[Migration] could not add app_settings.value:', e.message); }
    }
    if (!existing.has('updated_at')) {
      try { db.run("ALTER TABLE app_settings ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))"); }
      catch (e) { console.error('[Migration] could not add app_settings.updated_at:', e.message); }
    }
  });

  // ── Migration: new inspection forms + Miscellaneous base template ─────────
  // The server only runs migrations on startup (not the seed), so templates
  // added to seed.js must also be inserted here to reach existing databases.
  // Inserts PDI-IQI-027 (Main Bearing), 028 (Cam Bearing), 029 (Connecting
  // Rod), and the hidden PDI-IQI-MISC base template used by one-off
  // Miscellaneous inspections — each only if not already present, using the
  // definitions from seed.js as the single source of truth.
  once('add_forms_bearings_conrod_misc', () => {
    const now = new Date().toISOString();
    const FORM_NOS = ['PDI-IQI-027', 'PDI-IQI-028', 'PDI-IQI-029', 'PDI-IQI-MISC'];
    for (const formNo of FORM_NOS) {
      if (db.get('SELECT id FROM inspection_templates WHERE form_no = ?', [formNo])) continue;
      const t = (TEMPLATES || []).find(x => x.form_no === formNo);
      if (!t) { console.error(`[Migration] template definition missing for ${formNo}`); continue; }
      db.run(
        `INSERT INTO inspection_templates
           (id, component_type, form_no, revision, title, form_type, disposition_type,
            header_schema, sections, active, created_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)`,
        [
          uuidv4(), t.component_type, t.form_no, t.revision || '', t.title,
          t.form_type, t.disposition_type || 'pass_fail',
          JSON.stringify(t.header_schema || []),
          JSON.stringify(t.sections || {}), now,
        ]
      );
      console.log(`[Migration] Inserted template: ${formNo}`);
    }
  });
}

module.exports = { applyMigrations };
