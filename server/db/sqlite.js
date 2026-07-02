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
    // Application-wide key/value settings (e.g. CarbonZapp API key, last sync time)
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // Injector test-bench results synced from the CarbonZapp test bench.
    // One row = one physical injector (a report groups >1 injector by slot).
    // Unique key = report_ext_id + slot_position.
    `CREATE TABLE IF NOT EXISTS injector_test_reports (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_injector_reports_unique ON injector_test_reports(report_ext_id, slot_position)`,
    `CREATE INDEX IF NOT EXISTS idx_injector_reports_datetime ON injector_test_reports(test_datetime DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_injector_reports_serial ON injector_test_reports(serial_number)`,
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
    // The Dimensional Inspection for the Fuel Injector is populated from the
    // CarbonZapp injector test-bench report (flow / response results). These
    // placeholder rows are replaced per-inspection by the synced test steps.
    dimensional_items: [
      { id: 1, measurement: 'Test Bench Results', location: 'Flow / response measurements are populated automatically from the linked CarbonZapp injector test report.', spec: '' },
    ],
  },

  // ── PDI-IQI-013  Cylinder Block ───────────────────────────────────────────
  {
    form_no: 'PDI-IQI-013', component_type: 'cylinder_block',
    title: 'PDI Incoming Quality Inspection — Cylinder Block',
    visual_items: [
      { id: 1, name: 'Casting & Fire Deck Integrity', requirement: 'Zero visible cracks, porosity, cold-shuts, or inclusions on the top deck face, water jackets, or exterior crankcase structures.' },
      { id: 2, name: 'Liner Seats & Packing Grooves', requirement: 'Machined liner counterbore steps and lower O-ring packing grooves are sharp and free of fretting, scoring, rust, or residual machining steps.' },
      { id: 3, name: 'Main Bearing Saddles & Caps',   requirement: 'Cap-to-block mating serrations or flat locator surfaces are completely clean, unbruised, and free of nicks or handling damage.' },
      { id: 4, name: 'Thread & Tap Condition',        requirement: 'All cylinder head bolt holes, main cap bolt holes, and auxiliary oil gallery tapped threads are clean, fully formed, and free of cross-threading or trapped metal swarf.' },
      { id: 5, name: 'Oil & Coolant Galleries',       requirement: 'All internal oil cross-drillings and cooling passages are completely unobstructed; verified free of residual casting sand, scale, or machining chips.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Liner Counterbore Depth',     location: 'Measured at 4 points (90° intervals) around the perimeter of each cylinder liner seating step.',                                spec: '' },
      { id: 2, measurement: 'Main Bearing Bore Diameter',  location: 'Across all main journals with caps installed and torqued to specification (0° and 90° vertical/horizontal axes).',                 spec: '' },
      { id: 3, measurement: 'Block Deck Flatness',         location: 'Precision straight-edge and feeler gauge checks along longitudinal, transverse, and diagonal axes of the cylinder head mating face.', spec: '' },
      { id: 4, measurement: 'Camshaft Bore Diameter',      location: 'Inside diameter check at all internal cam tunnel bearing positions (0° and 90° axes).',                                            spec: '' },
    ],
  },

  // ── PDI-IQI-014  Crankshaft ───────────────────────────────────────────────
  {
    form_no: 'PDI-IQI-014', component_type: 'crankshaft',
    title: 'PDI Incoming Quality Inspection — Crankshaft',
    visual_items: [
      { id: 1, name: 'Journal Surface Finish',   requirement: 'All main and connecting rod journals ground to a mirror finish; zero evidence of linear scoring, micro-pitting, transit scratches, or heat discoloration.' },
      { id: 2, name: 'Fillet Radii Transitions', requirement: 'Journal fillet radii are perfectly smooth and continuous; free of machining steps, grinding burn marks, or sharp undercut transitions.' },
      { id: 3, name: 'Oil Holes & Chamfers',     requirement: 'Lubrication cross-holes are fully open and deburred; chamfered edges are smooth with zero loose grinding fins or trapped debris inside the oil pathways.' },
      { id: 4, name: 'Keyways, Splines & Snout', requirement: 'Front snout keyways, timing gear press-fit areas, and rear flange bolt holes are crisp, clean, and free of burrs or rolled-over metal edges.' },
      { id: 5, name: 'Thrust Face Alignment',    requirement: 'Machined thrust walls adjacent to the indexing main journal are clean and free of grinding tears or handling nicks.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Main Journal Outer Diameter (OD)',                   location: 'At the front, center, and rear sections of each main journal across 0° and 90° axes.',                                          spec: '' },
      { id: 2, measurement: 'Crankpin / Rod Journal Outer Diameter (OD)',          location: 'At the center section of each rod journal across 0° and 90° axes.',                                                       spec: '' },
      { id: 3, measurement: 'Journal Taper & Out-of-Round',                        location: 'Calculated max-to-min diameter difference across the width and circumference of each individual journal.',                    spec: '' },
      { id: 4, measurement: 'Total Indicator Runout (Crankshaft Straightness)',    location: 'Supported on V-blocks at the front and rear main journals; dial indicator on the center main journal through a 360° rotation.', spec: '' },
    ],
  },

  // ── PDI-IQI-015  Dampener (Vibration Damper) ──────────────────────────────
  {
    form_no: 'PDI-IQI-015', component_type: 'dampener',
    title: 'PDI Incoming Quality Inspection — Dampener',
    visual_items: [
      { id: 1, name: 'Housing & Seal Integrity (Viscous Type)', requirement: 'Laser-welded or crimped housing is continuous and completely sealed; zero evidence of silicone fluid weeping, exterior dents, or housing bulges.' },
      { id: 2, name: 'Elastomer Element (Rubber Type)',         requirement: 'Bonded rubber strip is fully intact; zero cracking, separation from metal rings, dry-rot pits, or extrusion gaps between the hub and inertia ring.' },
      { id: 3, name: 'Indexing & Timing Marks',                 requirement: 'Top Dead Center (TDC) and degree alignment marks are permanently stamped, clean, legible, and unmarred.' },
      { id: 4, name: 'Mounting Flange Face',                    requirement: 'Crankshaft snout mounting surface and bolt holes are flat and free of burrs, paint overspray, rust, or impact nicks.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Crankshaft Pilot Bore Inner Diameter (ID)', location: 'Inside diameter of the center registration hub bore (measured across 2 perpendicular axes).',                                            spec: '' },
      { id: 2, measurement: 'Mounting Flange Thickness',                  location: 'At 4 equidistant points around the bolt circle flange layout.',                                                                          spec: '' },
      { id: 3, measurement: 'Radial and Axial Runout (TIR)',              location: 'Mounted to a true test arbor; dial indicator tracked on the outermost perimeter face and front lateral face through a full rotation.',  spec: '' },
    ],
  },

  // ── PDI-IQI-016  Exhaust Manifold Spacer ──────────────────────────────────
  {
    form_no: 'PDI-IQI-016', component_type: 'exhaust_manifold_spacer',
    title: 'PDI Incoming Quality Inspection — Exhaust Manifold Spacer',
    visual_items: [
      { id: 1, name: 'Sealing Flange Surface Finish', requirement: 'Machined gasket seating faces are smooth and uniform; zero deep scratches, pitting, casting voids, or transport gouges.' },
      { id: 2, name: 'Gas Passage Profiles',          requirement: 'Internal exhaust gas path is completely free of casting fins, flash, metal inclusions, or loose scale that could disrupt gas flow.' },
      { id: 3, name: 'Fastener Clearance Holes',       requirement: 'Through-bolt holes are clean, round, and free of edge crushing, burrs, or drilling exit steps.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Overall Thickness',    location: 'With a micrometer at all 4 corners/edges of the spacer block.',                                                          spec: '' },
      { id: 2, measurement: 'Parallelism',          location: 'Maximum thickness variation calculated between all measured points on the parallel seating planes.',                  spec: '' },
      { id: 3, measurement: 'Flange Face Flatness', location: 'Across the sealing planes using a precision surface plate layout or a knife-edge straight-edge.',                       spec: '' },
    ],
  },

  // ── PDI-IQI-017  Piston Oiler (Cooling Jet) ───────────────────────────────
  {
    form_no: 'PDI-IQI-017', component_type: 'piston_oiler',
    title: 'PDI Incoming Quality Inspection — Piston Oiler',
    visual_items: [
      { id: 1, name: 'Tube Alignment & Nozzle Shape',    requirement: 'Oiler target tubes are perfectly formed and visually straight; zero crimps, handling kinks, flattening, or tool indentation marks along the thin-wall tubing.' },
      { id: 2, name: 'Braze / Weld Joint Integrity',     requirement: 'Brazed or welded joints anchoring the target tubes to the mounting banjo base block are continuous, uniform, and free of pinholes or cracking.' },
      { id: 3, name: 'Jet Discharge Orifice',            requirement: 'The final fluid exit orifice is perfectly round, crisp, and 100% free of internal swarf, burrs, or storage preservative blockage.' },
      { id: 4, name: 'Locating Dowel Pin / Tab',         requirement: 'The alignment pin or anti-rotation tab on the mounting base is unbent, rigid, and completely free of casting or stamping defects.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Nozzle Jet Tip Orifice Diameter',           location: 'Internal diameter verification at the tube exit tip using a calibrated Go/No-Go pin gauge.',                              spec: '' },
      { id: 2, measurement: 'Banjo Base Mounting Inner Diameter (ID)',    location: 'Inside diameter of the bolt fastening bore (2 axes at 90°).',                                                          spec: '' },
      { id: 3, measurement: 'Nozzle Tip Protrusion Height & Offset',      location: 'Via a height gauge fixture from the flat mounting base face to the center point of the nozzle tip orifice.',             spec: '' },
    ],
  },

  // ── PDI-IQI-018  Piston Oiler Bolt (Banjo Bolt w/ Check Valve) ────────────
  {
    form_no: 'PDI-IQI-018', component_type: 'piston_oiler_bolt',
    title: 'PDI Incoming Quality Inspection — Piston Oiler Bolt',
    visual_items: [
      { id: 1, name: 'Thread Roll Quality',                      requirement: 'Threads are fully formed, clean, and uniform; zero flat spots, rolling nicks, crest tearing, or cross-threaded areas.' },
      { id: 2, name: 'Fluid Feed Ports',                         requirement: 'Cross-drilled fluid passages and the central axial feed hole are entirely open; free of drilling burrs, loose flakes, or residual metal shavings.' },
      { id: 3, name: 'Internal Check Valve Mechanical Freedom',  requirement: 'Internal spring-loaded ball or plunger moves smoothly when depressed with a brass test probe; snaps back securely into its seat with no binding or sticking.' },
      { id: 4, name: 'Under-Head Sealing Shoulder',             requirement: 'The flat shoulder face that contacts the oiler block/crush washer is entirely free of radial scratches, burrs, or machining spirals.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Major Thread Diameter & Pitch', location: 'Thread section check using a micrometer and thread pitch ring gauge.',                          spec: '' },
      { id: 2, measurement: 'Under-Head Shank Length',       location: 'From the flat bearing shoulder to the absolute end of the bolt shank.',                          spec: '' },
      { id: 3, measurement: 'Cross-Drilled Port Diameter',   location: 'Inside diameter verification of fluid escape cross-holes via pin gauges.',                      spec: '' },
    ],
  },

  // ── PDI-IQI-019  Rocker Shaft ─────────────────────────────────────────────
  {
    form_no: 'PDI-IQI-019', component_type: 'rocker_shaft',
    title: 'PDI Incoming Quality Inspection — Rocker Shaft',
    visual_items: [
      { id: 1, name: 'Journal Seating Surface Finish', requirement: 'Centerless-ground shaft OD at all rocker arm journal locations must be mirror-smooth; zero scoring, ridges, pitting, handling bruises, or chrome-plating flaking.' },
      { id: 2, name: 'Oil Distribution Passages',      requirement: 'All radial oil supply feed holes are smoothly deburred and radiused; internal oil tunnel is clear of honing residue or factory debris.' },
      { id: 3, name: 'End-Plug Sealing',               requirement: 'Pressed-in or welded end retention plugs are tight, seated flush, and show zero micro-cracks or loose fitment.' },
      { id: 4, name: 'Mounting Pedestal Bosses',       requirement: 'Flat relief cuts or mounting notches for hold-down bolts are free of sharp burrs or alignment distortion.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Shaft Outer Diameter (OD)',          location: 'At each separate rocker arm journal position along 2 axes spaced 90° apart.',                             spec: '' },
      { id: 2, measurement: 'Shaft Straightness',                 location: 'Total Indicator Runout (TIR) along the center span of the shaft while supported on V-blocks at both ends.', spec: '' },
      { id: 3, measurement: 'Pedestal Mount Bolt Hole Location',  location: 'Center-to-center pitch distance checked between all adjacent hold-down bolt paths.',                       spec: '' },
    ],
  },

  // ── PDI-IQI-020  Connecting Rod Bearing (Shell Half) ──────────────────────
  {
    form_no: 'PDI-IQI-020', component_type: 'connecting_rod_bearing',
    title: 'PDI Incoming Quality Inspection — Connecting Rod Bearing',
    visual_items: [
      { id: 1, name: 'Antifriction Lining Overlay',     requirement: 'The interior bearing lining surface is 100% flawless and uniform; zero scratches, scuffs, layer blistering, exposed mid-layers, or embedded foreign matter.' },
      { id: 2, name: 'Steel Backing Condition',         requirement: 'The rear steel shell face is smooth, clean, and uniform; zero rust stains, pitting, fretting shadows, or deep stamping indentations.' },
      { id: 3, name: 'Locating Tangs & Parting Lines',  requirement: 'Anti-rotation locating tangs are sharp, crisp, and completely unbent; parting line mating faces are flat and free of upset metal or handling burrs.' },
      { id: 4, name: 'Oil Grooves & Holes',             requirement: 'Oil supply channels and cross-holes are cleanly punched/machined with smoothly chamfered edges; no loose backing burrs.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Bearing Shell Wall Thickness', location: 'At the exact center apex of the bearing half using a specialized ball-anvil micrometer.',            spec: '' },
      { id: 2, measurement: 'Overall Shell Width',          location: 'Parallel to the bearing centerline across the parting line edges.',                                  spec: '' },
      { id: 3, measurement: 'Bearing Free Spread',          location: 'Distance across the extreme outer tips of the bearing shell parting lines in its relaxed state.',     spec: '' },
    ],
  },

  // ── PDI-IQI-021  Spacer Plate (Block-to-Head) ─────────────────────────────
  {
    form_no: 'PDI-IQI-021', component_type: 'spacer_plate',
    title: 'PDI Incoming Quality Inspection — Spacer Plate',
    visual_items: [
      { id: 1, name: 'Sealing Face Flatness & Finish',   requirement: 'Parallel sealing faces are flat and uniform; zero scratches, deep handling gouges, corrosion pits, or distorted areas caused by improper wire-wheel cleanup.' },
      { id: 2, name: 'Inner & Outer Edge Cleanliness',   requirement: 'Cylinder liner bore cutouts and outer perimeter profiles are clean-stamped/machined; completely free of heavy dross, hanging burrs, or edge distortions.' },
      { id: 3, name: 'Transfer Passages',                requirement: 'All stamped water-jacket holes, oil pressure feeds, and pushrod passages are fully formed, clear, and perfectly aligned with no obstruction or restricted corners.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Plate Thickness',                          location: 'With a micrometer at 6 standardized locations across the plate perimeter layout (ends and center bridges).', spec: '' },
      { id: 2, measurement: 'Parallelism (Thickness Variation)',        location: 'Calculated total difference between maximum and minimum thickness readings across the entire plate body.',    spec: '' },
      { id: 3, measurement: 'Cylinder Liner Cutout Inner Diameter (ID)', location: 'Across 2 perpendicular axes at each cylinder opening loop.',                                                spec: '' },
    ],
  },

  // ── PDI-IQI-022  Thermostat ───────────────────────────────────────────────
  {
    form_no: 'PDI-IQI-022', component_type: 'thermostat',
    title: 'PDI Incoming Quality Inspection — Thermostat',
    visual_items: [
      { id: 1, name: 'Housing Frame & Valve Seat',     requirement: 'Stainless steel or brass support bridge is straight and free of bending deformation; valve seating face is uniform with no nicks or uneven gaps.' },
      { id: 2, name: 'Expansion Element & Spring',     requirement: 'Return spring is uniformly coiled, concentric, and free of distortion; copper wax pellet capsule is completely sealed with zero wax leakage or cracking.' },
      { id: 3, name: 'Bleed Valve / Jiggle Pin Freedom', requirement: 'Bypass air bleed hole is open and clean; jiggle pin or check ball is loose and moves freely within its slot without binding.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Flange Outer Diameter (OD)',                location: 'Across the outermost edge of the main mounting seating flange (2 axes at 90°).',                                  spec: '' },
      { id: 2, measurement: 'Overall Assembly Height (Closed)',          location: 'From the apex of the frame bridge to the base of the closed bypass sealing disk.',                              spec: '' },
      { id: 3, measurement: 'Valve Opening Stroke (Functional Check)',    location: 'Submerged hot water bath testing; measuring total valve lift distance at the fully open rated temperature spec.', spec: '' },
    ],
  },

  // ── PDI-IQI-023  Thrust Washer ────────────────────────────────────────────
  {
    form_no: 'PDI-IQI-023', component_type: 'thrust_washer',
    title: 'PDI Incoming Quality Inspection — Thrust Washer',
    visual_items: [
      { id: 1, name: 'Running Face & Oil Grooves', requirement: 'The anti-friction thrust face overlay is entirely uniform; oil distribution grooves are clean, full-depth, and entirely free of machining burrs, scoring, or flaking.' },
      { id: 2, name: 'Steel Backing Flatness',     requirement: 'The raw steel backing face is smooth, clean, flat, and completely free of localized high spots, transport nicks, or oxidation.' },
      { id: 3, name: 'Locating Tabs / Tabs Profile', requirement: 'Anti-rotation locking tabs or outer ear locations are clean-cut, unbent, and square.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Washer Total Thickness',              location: 'With a micrometer at 4 equidistant points (90° intervals) around the center circle of the washer body.', spec: '' },
      { id: 2, measurement: 'Outer Diameter (OD) and Inner Diameter (ID)', location: 'Across 2 perpendicular axes using a digital caliper.',                                          spec: '' },
      { id: 3, measurement: 'Flatness Deviation',                  location: 'On a certified precision surface plate with a feeler gauge to ensure zero warping.',                   spec: '' },
    ],
  },

  // ── PDI-IQI-024  Water Pump ───────────────────────────────────────────────
  {
    form_no: 'PDI-IQI-024', component_type: 'water_pump',
    title: 'PDI Incoming Quality Inspection — Water Pump',
    visual_items: [
      { id: 1, name: 'Casting & Housing Integrity',    requirement: 'Pump body volute and mounting flanges are entirely free of casting voids, hairline cracks, or sand inclusions.' },
      { id: 2, name: 'Impeller Seating & Vanes',       requirement: 'Impeller blades are complete and undamaged; zero cavitation pitting, casting slag, or distortion; securely pressed onto the pump shaft.' },
      { id: 3, name: 'Rotational Freedom & Bearing Feel', requirement: 'Shaft rotates smoothly by hand through a full 360° loop; zero evidence of internal roughness, tight spots, clicking, or excessive dry friction feel.' },
      { id: 4, name: 'Weep Hole Openness',             requirement: 'The internal cartridge seal weep hole is open and completely free of excess sealant, metal chips, or signs of transit oil leaks.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Mounting Flange Flatness',            location: 'Straight-edge and feeler gauge check across the block-mating flange face surface.',                    spec: '' },
      { id: 2, measurement: 'Drive Pulley / Hub Protrusion Height', location: 'From the flat block-mounting flange plane to the outer face of the drive pulley/gear hub.',           spec: '' },
      { id: 3, measurement: 'Impeller Back-Clearance',             location: 'Distance between the rear edge of the impeller vanes and the inner volute casting wall.',             spec: '' },
    ],
  },

  // ── PDI-IQI-025  Flywheel ─────────────────────────────────────────────────
  {
    form_no: 'PDI-IQI-025', component_type: 'flywheel',
    title: 'PDI Incoming Quality Inspection — Flywheel',
    visual_items: [
      { id: 1, name: 'Clutch Friction Surface Finish',          requirement: 'Ground clutch interface area is flat and mirror-smooth; zero evidence of heat checking, grinding scoring, radial scratches, or deep handling dents.' },
      { id: 2, name: 'Starter Ring Gear Teeth',                 requirement: 'All ring gear teeth are complete and fully formed; zero chipped, broken, or cracked teeth; leading engagement chamfers are clean and uniform.' },
      { id: 3, name: 'Crank Snout Centering Pilot & Thread Holes', requirement: 'Center locating pilot bore and crankshaft mounting bolt paths are free of rust, burrs, cross-drilling edge steps, or metal chips.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Friction Face Flatness (Total Sweep)',   location: 'Via a dial indicator sweep across the outer radial friction surface while anchored on a true rotation fixture.', spec: '' },
      { id: 2, measurement: 'Pilot Bearing Pocket Inner Diameter (ID)', location: 'Inside diameter of the center pilot bearing bore (measured across 2 perpendicular axes).',                    spec: '' },
      { id: 3, measurement: 'Starter Ring Gear Outer Diameter (OD)',   location: 'At 3 points (120° intervals) across the top tips of the ring gear teeth.',                                   spec: '' },
    ],
  },

  // ── PDI-IQI-026  Stud Kit (Cylinder Head / Main Bearing Studs) ────────────
  {
    form_no: 'PDI-IQI-026', component_type: 'stud_kit',
    title: 'PDI Incoming Quality Inspection — Stud Kit',
    visual_items: [
      { id: 1, name: 'Rolled Thread Profiles',        requirement: 'Threads on both ends (block engagement and nut engagement) are fully formed and crisp; zero flat crests, cross-thread nicks, or razor burrs.' },
      { id: 2, name: 'Unthreaded Center Shank',       requirement: 'The solid intermediate shank body is straight and uniform; zero machining tool gouges, linear stretch marks, or hydrogen embrittlement micro-cracks.' },
      { id: 3, name: 'Hex Nut Internal Threading',    requirement: 'Kit fasteners/nuts are fully tapped; threads are clean and free of plating build-up or loose internal metal flakes.' },
      { id: 4, name: 'Hardened Washer Face Uniformity', requirement: 'Parallel surfaces of parallel washers are smooth and clean; zero stamping burrs, edge splitting, or uneven dish warping.' },
    ],
    dimensional_items: [
      { id: 1, measurement: 'Total Stud Length',                     location: 'End-to-end parallel to the central stud axis.',                                                 spec: '' },
      { id: 2, measurement: 'Block-End & Nut-End Thread Lengths',    location: 'Axial length check of the short and long thread segments using a digital caliper depth rod.',    spec: '' },
      { id: 3, measurement: 'Nut Hex Parallel Width',                location: 'Micrometer measurement across the flat driving faces of a sample nut from the kit.',             spec: '' },
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

    // Optional dimensional inspection section (C). Forms that supply
    // dimensional_items get a standard always-visible dimensional table.
    if (Array.isArray(tpl.dimensional_items) && tpl.dimensional_items.length) {
      sections.dimensional = {
        title: 'C. DIMENSIONAL INSPECTION',
        section_type: 'dimensional',
        items: tpl.dimensional_items,
      };
    }

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