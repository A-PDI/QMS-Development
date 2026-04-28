'use strict';
// Uses Node.js 22's built-in SQLite — no native compilation required.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { bootstrapFromSeed } = require('./bootstrap');

const dbPath = process.env.SQLITE_PATH || './data/inspection.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

try {
  bootstrapFromSeed(dbPath);
} catch (err) {
  console.error('[SQLite] Bootstrap from seed failed (continuing with empty DB):', err.message);
}

let rawDb = null;

function getDb() {
  if (!rawDb) {
    try {
      rawDb = new DatabaseSync(dbPath);
      rawDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      initSchema();
    } catch (err) {
      console.error('[SQLite] Failed to open database:', err.message);
      throw err;
    }
  }
  return rawDb;
}

function initSchema() {
  const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'inspector',
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspection_templates (
  id TEXT PRIMARY KEY,
  component_type TEXT NOT NULL,
  form_no TEXT NOT NULL,
  revision TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  form_type TEXT NOT NULL,
  disposition_type TEXT NOT NULL,
  header_schema TEXT NOT NULL,
  sections TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES inspection_templates(id),
  component_type TEXT NOT NULL,
  form_no TEXT NOT NULL,
  part_number TEXT,
  supplier TEXT,
  po_number TEXT,
  description TEXT,
  date_received TEXT,
  inspector_name TEXT,
  lot_size TEXT,
  aql_level TEXT,
  sample_size TEXT,
  lot_serial_no TEXT,
  signature TEXT,
  disposition TEXT,
  disposition_notes TEXT,
  section_data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT REFERENCES users(id),
  submitted_by TEXT REFERENCES users(id),
  submitted_at TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspection_attachments (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  uploaded_by TEXT REFERENCES users(id),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspection_notes (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  note_type TEXT NOT NULL DEFAULT 'internal',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
  try {
    rawDb.exec(schema);
    console.log('[SQLite] Schema initialized');
  } catch (err) {
    console.error('[SQLite] Schema init error:', err.message);
  }
  migrateSchema();
}

function migrateSchema() {
  // Column additions (try/catch — safe if column already exists)
  const columnMigrations = [
    'ALTER TABLE inspection_attachments ADD COLUMN section_key TEXT',
    'ALTER TABLE inspection_attachments ADD COLUMN item_id TEXT',
    'ALTER TABLE inspections ADD COLUMN completed_at TEXT',
    // Assignment & timing
    'ALTER TABLE inspections ADD COLUMN assigned_to TEXT',
    'ALTER TABLE inspections ADD COLUMN assigned_at TEXT',
    'ALTER TABLE inspections ADD COLUMN assigned_by TEXT',
    'ALTER TABLE inspections ADD COLUMN due_date TEXT',
    'ALTER TABLE inspections ADD COLUMN started_at TEXT',
    // Template versioning
    'ALTER TABLE inspection_templates ADD COLUMN version INTEGER DEFAULT 1',
    'ALTER TABLE inspection_templates ADD COLUMN parent_template_id TEXT',
    // Per-user page permissions
    'ALTER TABLE users ADD COLUMN permissions TEXT',
  ];
  for (const sql of columnMigrations) {
    try { rawDb.exec(sql); } catch (_) {}
  }

  // New tables (IF NOT EXISTS — always safe to run)
  const tableMigrations = [
    `CREATE TABLE IF NOT EXISTS inspection_activity_log (
      id TEXT PRIMARY KEY,
      inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      actor_name TEXT,
      actor_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_activity_log_created ON inspection_activity_log(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_log_inspection ON inspection_activity_log(inspection_id)`,
    `CREATE TABLE IF NOT EXISTS part_specs (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
      part_number TEXT NOT NULL,
      description TEXT,
      spec_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_part_specs_unique ON part_specs(template_id, part_number)`,
    `CREATE TABLE IF NOT EXISTS ncrs (
      id TEXT PRIMARY KEY,
      ncr_number TEXT UNIQUE NOT NULL,
      inspection_id TEXT REFERENCES inspections(id),
      part_number TEXT,
      supplier TEXT,
      po_number TEXT,
      description_of_defect TEXT NOT NULL,
      quantity_affected INTEGER,
      severity TEXT NOT NULL DEFAULT 'major',
      ncr_disposition TEXT NOT NULL DEFAULT 'pending',
      corrective_action_required INTEGER NOT NULL DEFAULT 0,
      corrective_action_due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_by_name TEXT,
      created_by TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ncrs_status ON ncrs(status)`,
    // Engineering drawings (per part number, versioned)
    `CREATE TABLE IF NOT EXISTS engineering_drawings (
      id TEXT PRIMARY KEY,
      part_number TEXT NOT NULL,
      version TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      file_size_bytes INTEGER,
      notes TEXT,
      uploaded_by TEXT REFERENCES users(id),
      is_current INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_drawings_part ON engineering_drawings(part_number)`,
    // Quality alerts — triggered by ACCEPTED disposition
    `CREATE TABLE IF NOT EXISTS quality_alerts (
      id TEXT PRIMARY KEY,
      inspection_id TEXT REFERENCES inspections(id) ON DELETE SET NULL,
      part_number TEXT,
      supplier TEXT,
      alert_type TEXT NOT NULL DEFAULT 'accepted_disposition',
      triggered_by TEXT REFERENCES users(id),
      acknowledged_by TEXT REFERENCES users(id),
      acknowledged_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_quality_alerts_part ON quality_alerts(part_number)`,
    `CREATE INDEX IF NOT EXISTS idx_quality_alerts_ack ON quality_alerts(acknowledged_at)`,
    // Saved report configurations
    `CREATE TABLE IF NOT EXISTS saved_reports (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT REFERENCES users(id),
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const sql of tableMigrations) {
    try { rawDb.exec(sql); } catch (_) {}
  }

  // Data migrations — idempotent status normalisation
  try {
    rawDb.exec(`UPDATE inspections
      SET status = 'complete',
          completed_at = COALESCE(reviewed_at, submitted_at, updated_at)
      WHERE status IN ('submitted', 'approved', 'rejected')`);
  } catch (_) {}

  // New templates migration — insert PDI-IQI-007 through PDI-IQI-012 if missing
  // (handles existing deployments that already have a live DB from before these
  //  forms were added to seed.js)
  _migrateNewTemplates();
}

const STANDARD_HEADER_FIELDS = JSON.stringify(['part_number', 'po_number', 'description', 'date_received', 'inspector_name', 'lot_serial_no']);
const RECEIVING_ITEMS_JSON = JSON.stringify([
  { id: 1, name: 'Outer Carton Condition',                requirement: 'Carton undamaged — no crushing, tears, moisture staining, or exposed contents' },
  { id: 2, name: 'Box / Package Label',                   requirement: 'Label present; part number, description, and quantity match purchase order exactly' },
  { id: 3, name: 'Part Marking',                          requirement: 'PDI logo and part number permanently marked on part; matches purchase order' },
  { id: 4, name: 'Quantity Verification',                 requirement: 'Physical count matches packing slip and purchase order line item; no shorts or mixed counts' },
  { id: 5, name: 'Corrosion / Contamination Protection',  requirement: 'Parts wrapped in VCI film or oil-coated; no visible rust, oxidation, or contamination on arrival' },
]);

const NEW_TEMPLATES = [
  {
    form_no: 'PDI-IQI-007', component_type: 'camshaft',
    title: 'PDI Incoming Quality Inspection — Camshaft',
    visual_items: [
      { id: 1, name: 'Cam Lobes',                       requirement: 'Cam lobes are free from chips, dents, scratches, scoring, pitting, rust, or discoloration.' },
      { id: 2, name: 'Bearing Journals',                requirement: 'Bearing journals have a smooth, uniform finish with no nicks, bruising, or corrosion.' },
      { id: 3, name: 'Thrust Faces',                    requirement: 'Thrust faces are clean and undamaged, with no burrs or gouges.' },
      { id: 4, name: 'Gear / Keyway / Timing Features', requirement: 'Gear, keyway, dowel, or timing-feature areas are free from cracks, chips, and burrs.' },
      { id: 5, name: 'Oil Passages',                    requirement: 'Oil holes/passages visible from the outside are open and free from burrs, metal chips, or debris.' },
      { id: 6, name: 'Shaft Straightness',              requirement: 'Shaft is visually straight with no obvious bending or handling damage.' },
      { id: 7, name: 'Edges & Machined Transitions',    requirement: 'Edges and machined transitions are clean, with no sharp burrs or loose material.' },
      { id: 8, name: 'Surface Cleanliness',             requirement: 'Overall surface is free from contamination such as dirt, grinding residue, preservative buildup, or foreign material.' },
    ],
  },
  {
    form_no: 'PDI-IQI-008', component_type: 'radiator',
    title: 'PDI Incoming Quality Inspection — Radiator',
    visual_items: [
      { id: 1, name: 'Cooling Fins',                requirement: 'Cooling fins are straight, evenly spaced, and not crushed, folded, torn, or missing.' },
      { id: 2, name: 'Tubes',                       requirement: 'Tubes are free from dents, punctures, cracks, or visible deformation.' },
      { id: 3, name: 'Header Plates & Tank Joints', requirement: 'Header plates and tank-to-core joints show uniform brazing/crimping with no gaps, cracks, or separation.' },
      { id: 4, name: 'Tanks',                       requirement: 'Tanks are free from cracks, dents, warping, or molding/casting defects.' },
      { id: 5, name: 'Inlet & Outlet Necks',        requirement: 'Inlet and outlet necks are round, clean, and free from dents, cracks, burrs, or deformation.' },
      { id: 6, name: 'Mounting Brackets & Frames',  requirement: 'Mounting brackets, side plates, and support frames are not bent, cracked, or loose.' },
      { id: 7, name: 'Core Alignment',              requirement: 'Core is visually square and not twisted, bowed, or misaligned.' },
      { id: 8, name: 'Surface Cleanliness',         requirement: 'External surfaces are free from corrosion, loose flux, debris, oil, or other contamination.' },
    ],
  },
  {
    form_no: 'PDI-IQI-009', component_type: 'clutch',
    title: 'PDI Incoming Quality Inspection — Clutch',
    visual_items: [
      { id: 1, name: 'Friction Facings',          requirement: 'Friction facings are clean and free from cracks, chips, glazing, oil, grease, or foreign material.' },
      { id: 2, name: 'Rivets & Fasteners',        requirement: 'Rivets or fasteners are fully seated and show no looseness, distortion, or damage.' },
      { id: 3, name: 'Hub Splines',               requirement: 'Hub splines are clean and free from burrs, dents, corrosion, or damaged teeth.' },
      { id: 4, name: 'Damper Springs',            requirement: 'Damper springs are correctly seated, intact, and not cracked, broken, or displaced.' },
      { id: 5, name: 'Pressure Plate Surface',    requirement: 'Pressure plate contact surface is smooth and free from scratches, scoring, rust, dents, or contamination.' },
      { id: 6, name: 'Diaphragm Fingers',         requirement: 'Diaphragm fingers or release levers are uniform in position and not bent, cracked, or damaged.' },
      { id: 7, name: 'Clutch Cover / Housing',    requirement: 'Clutch cover/housing is free from cracks, dents, distortion, or damaged mounting holes.' },
      { id: 8, name: 'Edges & Machined Surfaces', requirement: 'Edges, stamped areas, and machined surfaces are free from loose burrs, sharp damage, or metal debris.' },
    ],
  },
  {
    form_no: 'PDI-IQI-010', component_type: 'oil_cooler',
    title: 'PDI Incoming Quality Inspection — Oil Cooler',
    visual_items: [
      { id: 1, name: 'Cooling Fins / Core',      requirement: 'Cooling fins, plates, or core surfaces are straight and free from crushed, torn, or missing sections.' },
      { id: 2, name: 'Body Integrity',           requirement: 'Tubes, plates, or cooler body are free from dents, cracks, punctures, or deformation.' },
      { id: 3, name: 'Brazed / Welded Joints',   requirement: 'Brazed, welded, or bonded joints appear continuous with no visible gaps, cracks, voids, or separation.' },
      { id: 4, name: 'Oil & Coolant Ports',      requirement: 'Oil and coolant ports are clean, round, and free from burrs, dents, thread damage, or contamination.' },
      { id: 5, name: 'Sealing Faces',            requirement: 'Sealing faces are smooth and free from scratches, gouges, corrosion, or embedded debris.' },
      { id: 6, name: 'Mounting Tabs & Brackets', requirement: 'Mounting tabs, brackets, and bosses are intact and not cracked, bent, or broken.' },
      { id: 7, name: 'Exterior Surfaces',        requirement: 'Exterior surfaces are free from rust, oxidation, loose scale, oil residue, or foreign material.' },
      { id: 8, name: 'Internal Port Areas',      requirement: 'Visible internal port areas are free from metal chips, casting sand, loose particles, or blockage.' },
    ],
  },
  {
    form_no: 'PDI-IQI-011', component_type: 'turbocharger',
    title: 'PDI Incoming Quality Inspection — Turbocharger',
    visual_items: [
      { id: 1, name: 'Compressor Wheel Blades',       requirement: 'Compressor wheel blades are free from chips, cracks, bends, nicks, or foreign-object damage.' },
      { id: 2, name: 'Turbine Wheel Blades',          requirement: 'Turbine wheel blades are free from cracks, missing material, bends, or visible impact damage.' },
      { id: 3, name: 'Compressor & Turbine Housings', requirement: 'Compressor and turbine housings are free from cracks, dents, casting defects, or broken flanges.' },
      { id: 4, name: 'Inlet & Outlet Openings',       requirement: 'Inlet and outlet openings are clean and free from debris, metal chips, or loose material.' },
      { id: 5, name: 'Mounting Flanges',              requirement: 'Mounting flanges and gasket faces are smooth and free from scratches, gouges, dents, or corrosion.' },
      { id: 6, name: 'Studs & Threaded Holes',        requirement: 'Studs, threaded holes, and fastener areas are visually undamaged and free from burrs or deformation.' },
      { id: 7, name: 'Actuator & Wastegate',          requirement: 'Actuator, linkage, and wastegate/VGT external components are intact, correctly seated, and not bent or damaged.' },
      { id: 8, name: 'Oil & Coolant Connections',     requirement: 'Oil and coolant connection areas are clean and free from cracks, damaged threads, or sealing-surface defects.' },
    ],
  },
  {
    form_no: 'PDI-IQI-012', component_type: 'fuel_injector',
    title: 'PDI Incoming Quality Inspection — Fuel Injector',
    visual_items: [
      { id: 1, name: 'Injector Body',          requirement: 'Injector body is free from cracks, dents, corrosion, scratches, or handling damage.' },
      { id: 2, name: 'Nozzle Tip',             requirement: 'Nozzle tip is clean and free from dents, cracks, burrs, contamination, or blocked visible spray holes.' },
      { id: 3, name: 'Sealing Cone / Seat',    requirement: 'Sealing cone, seat, or sealing washer contact areas are smooth and free from gouges, nicks, or debris.' },
      { id: 4, name: 'Threads & Fuel Ports',   requirement: 'Threads and fuel connection ports are clean and free from burrs, dents, cross-threading, or deformation.' },
      { id: 5, name: 'Electrical Connector',   requirement: 'Electrical connector body and pins, if applicable, are straight, clean, intact, and free from cracks or bent terminals.' },
      { id: 6, name: 'O-Rings & Seals',        requirement: 'O-rings, seals, or visible sealing elements are present, seated correctly, and free from cuts, twists, flattening, or contamination.' },
      { id: 7, name: 'Filter Screen / Inlet',  requirement: 'Filter screen or inlet area, where visible, is clean and free from metal chips, dirt, or obstruction.' },
      { id: 8, name: 'External Surfaces',      requirement: 'External surfaces show no oil, grease, rust, preservative buildup, or foreign material that could affect installation or cleanliness.' },
    ],
  },
];

function _migrateNewTemplates() {
  const crypto = require('crypto');
  const checkStmt = rawDb.prepare('SELECT id FROM inspection_templates WHERE form_no = ?');
  const insertStmt = rawDb.prepare(
    `INSERT INTO inspection_templates
       (id, component_type, form_no, revision, title, form_type, disposition_type, header_schema, sections, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const tpl of NEW_TEMPLATES) {
    const existing = checkStmt.get(tpl.form_no);
    if (existing) continue;

    const sections = {
      receiving: {
        title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
        section_type: 'pfn_checklist',
        items: JSON.parse(RECEIVING_ITEMS_JSON),
      },
      visual: {
        title: 'B. VISUAL INSPECTION',
        section_type: 'pass_fail_checklist',
        items: tpl.visual_items,
      },
    };

    try {
      insertStmt.run(
        crypto.randomUUID(),
        tpl.component_type,
        tpl.form_no,
        '',
        tpl.title,
        'iqi_standard',
        'pass_fail',
        STANDARD_HEADER_FIELDS,
        JSON.stringify(sections),
        1
      );
      console.log(`[SQLite] Migrated template: ${tpl.form_no}`);
    } catch (err) {
      console.error(`[SQLite] Failed to migrate template ${tpl.form_no}:`, err.message);
    }
  }
}

module.exports = {
  get(sql, params = []) {
    return getDb().prepare(sql).get(...params);
  },
  all(sql, params = []) {
    return getDb().prepare(sql).all(...params);
  },
  run(sql, params = []) {
    return getDb().prepare(sql).run(...params);
  },
  exec(sql) {
    return getDb().exec(sql);
  },
  prepare(sql) {
    return getDb().prepare(sql);
  },
  close() {
    if (rawDb) { rawDb.close(); rawDb = null; }
  },
};