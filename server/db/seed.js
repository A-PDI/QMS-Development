'use strict';
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('./adapter');

// ─── Shared receiving items (identical across 001–004) ───────────────────────
const RECEIVING_ITEMS = [
  { id: 1, name: 'Outer Carton Condition',             requirement: 'Carton undamaged — no crushing, tears, moisture staining, or exposed contents' },
  { id: 2, name: 'Box / Package Label',                requirement: 'Label present; part number, description, and quantity match purchase order exactly' },
  { id: 3, name: 'Part Marking',                       requirement: 'PDI logo and part number permanently marked on part; matches purchase order' },
  { id: 4, name: 'Quantity Verification',              requirement: 'Physical count matches packing slip and purchase order line item; no shorts or mixed counts' },
  { id: 5, name: 'Corrosion / Contamination Protection', requirement: 'Parts wrapped in VCI film or oil-coated; no visible rust, oxidation, or contamination on arrival' },
];

// ─── Shared header for forms 001–005 ────────────────────────────────────────
const STANDARD_HEADER = ['part_number', 'po_number', 'description', 'date_received', 'inspector_name', 'lot_serial_no'];

const TEMPLATES = [
  // ── PDI-IQI-001  Piston ──────────────────────────────────────────────────
  {
    component_type: 'piston',
    form_no: 'PDI-IQI-001',
    title: 'PDI Incoming Quality Inspection — Piston',
    form_type: 'iqi_standard',
    disposition_type: 'pass_fail',
    revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: {
        title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
        section_type: 'pfn_checklist',
        items: RECEIVING_ITEMS,
      },
      visual: {
        title: 'B. VISUAL INSPECTION',
        section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Crown / Combustion Bowl',      requirement: 'Zero cracks, porosity, or cold-shuts on crown face and bowl rim; surface as-cast/machined with no heat discoloration' },
          { id: 2, name: 'Ring Grooves',                 requirement: 'Groove sidewalls parallel and square as-machined; edges sharp, free of burrs, nicks, or machining tears; no debris in grooves' },
          { id: 3, name: 'Piston Skirt Coating',         requirement: 'Friction-reducing coating 100% intact; zero bare metal patches, flaking, or handling abrasion on skirt surface' },
          { id: 4, name: 'Pin Bore',                     requirement: 'Bore surface smooth and as-machined; no corrosion from transit or storage; finish within drawing Ra specification' },
          { id: 5, name: 'Oil Drain Passages',           requirement: 'All drain holes and slots clear of swarf, sealant, and preservative; verified with compressed-air probe' },
          { id: 6, name: 'Part Identification Marking',  requirement: 'Part number engraved or laser-marked on part body; permanent and legible; matches purchase order' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION',
        section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Skirt OD',                                    location: '90° to pin axis, 15 mm from skirt bottom',    spec: '' },
          { id: 2, measurement: 'Pin Bore Diameter',                            location: 'Center of bore — 0° and 90° axes',             spec: '' },
          { id: 3, measurement: 'Ring Groove Width — Top Compression (No. 1)', location: '3 pts at 120° intervals',                      spec: '' },
          { id: 4, measurement: 'Ring Groove Width — Oil Control (No. 3)',     location: '3 pts at 120° intervals',                      spec: '' },
          { id: 5, measurement: 'Abutment Face Flatness (two-piece only)',     location: '4 pts across abutment mating face',            spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-002  Cylinder Liner ──────────────────────────────────────────
  {
    component_type: 'cylinder_liner',
    form_no: 'PDI-IQI-002',
    title: 'PDI Incoming Quality Inspection — Cylinder Liner',
    form_type: 'iqi_standard',
    disposition_type: 'pass_fail',
    revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: {
        title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
        section_type: 'pfn_checklist',
        items: RECEIVING_ITEMS,
      },
      visual: {
        title: 'B. VISUAL INSPECTION',
        section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Bore Surface — Cracks',       requirement: 'Zero cracks anywhere on bore surface; any crack indication = immediate rejection' },
          { id: 2, name: 'Bore Honing Pattern',         requirement: 'Cross-hatch present, uniform, and undamaged as-machined; angle 25–35°; no burnished or polished areas from machining error; no smearing or torn metal from mishandling' },
          { id: 3, name: 'O-Ring Groove',               requirement: 'Groove walls sharp and smooth as-machined; no burrs, nicks, or pitting; free of all preservative and debris' },
          { id: 4, name: 'Flange Seating Face',         requirement: 'Seating face flat and undamaged as-machined; no cracks, chips, or impact marks from handling' },
          { id: 5, name: 'Part Identification Marking', requirement: 'Part number and size code permanently marked and legible; matches purchase order' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION',
        section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Bore Diameter',    location: 'Top / mid / bottom — 2 axes 90° at each plane (6 total readings)', spec: '' },
          { id: 2, measurement: 'Bore Out-of-Round', location: 'Max - min reading within each cross-sectional plane',              spec: '' },
          { id: 3, measurement: 'Bore Taper',        location: 'Top bore diameter minus bottom bore diameter',                     spec: '' },
          { id: 4, measurement: 'Flange Thickness',  location: '4 pts at 90° intervals around flange',                            spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-003  Piston Pin ──────────────────────────────────────────────
  {
    component_type: 'piston_pin',
    form_no: 'PDI-IQI-003',
    title: 'PDI Incoming Quality Inspection — Piston Pin',
    form_type: 'iqi_standard',
    disposition_type: 'pass_fail',
    revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: {
        title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
        section_type: 'pfn_checklist',
        items: RECEIVING_ITEMS,
      },
      visual: {
        title: 'B. VISUAL INSPECTION',
        section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'OD Surface — Spalling / Flaking', requirement: 'OD surface mirror-smooth as ground; zero spalling, flaking, or pitting of any size — immediate rejection' },
          { id: 2, name: 'OD Surface — Scoring',            requirement: 'No longitudinal scratch marks or galling; surface as-manufactured with no handling damage' },
          { id: 3, name: 'Straightness',                    requirement: 'No visible bow; max 0.013 mm deviation on V-block surface-plate check' },
          { id: 4, name: 'Snap Ring Groove / End Faces',    requirement: 'Groove edges sharp and undamaged as-machined; end faces free of burrs and handling nicks' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION',
        section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Pin OD',          location: 'Center + 25 mm from each end — 0° and 90° axes (6 total readings)', spec: '' },
          { id: 2, measurement: 'OD Taper',        location: 'Center reading minus end reading',                                   spec: '' },
          { id: 3, measurement: 'OD Out-of-Round', location: 'Max - min at any single cross-section',                              spec: '' },
          { id: 4, measurement: 'Overall Length',  location: 'Parallel to pin axis',                                               spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-004  Piston Ring ─────────────────────────────────────────────
  {
    component_type: 'piston_ring',
    form_no: 'PDI-IQI-004',
    title: 'PDI Incoming Quality Inspection — Piston Ring',
    form_type: 'iqi_standard',
    disposition_type: 'pass_fail',
    revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: {
        title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
        section_type: 'pfn_checklist',
        items: RECEIVING_ITEMS,
      },
      visual: {
        title: 'B. VISUAL INSPECTION',
        section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Running Face Coating', requirement: 'Coating 100% intact and uniform; zero flaking, chipping, or bare patches of any size' },
          { id: 2, name: 'Gap End Faces',        requirement: 'End faces square, smooth, and as-manufactured; no chips, burrs, or deformation at gap ends' },
          { id: 3, name: 'Orientation Mark',     requirement: "'TOP', dot, or pip mark present on all rings, clearly legible; per approved specification" },
          { id: 4, name: 'Ring Body',            requirement: 'Ring body flat with no visible twist, kink, or corrosion; free of storage damage and preservative residue' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION',
        section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Free End Gap (relaxed)',   location: 'Ring uncompressed; measure gap opening with calipers or feeler gauge',             spec: '' },
          { id: 2, measurement: 'Installed End Gap',        location: 'Ring squared in calibrated reference bore at 25 mm depth; feeler gauge',           spec: '' },
          { id: 3, measurement: 'Axial Width (ring height)', location: 'Micrometer at 3 pts 120° apart on ring body',                                     spec: '' },
          { id: 4, measurement: 'Radial Wall Thickness',    location: 'Micrometer at 3 pts 120° apart',                                                   spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-005  Cylinder Head (Visual + optional Dimensional) ──────────
  {
    component_type: 'cylinder_head',
    form_no: 'PDI-IQI-005',
    title: 'PDI Incoming Quality Inspection — Cylinder Head',
    form_type: 'iqi_combined',
    disposition_type: 'pass_fail',
    revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      // ── Visual sections (always shown) ──────────────────────────────────
      visual: {
        title: 'A. VISUAL INSPECTION',
        section_type: 'pass_fail_checklist',
        items: [
          { id: 1, description: 'Check for visible cracks, casting voids, or porosity' },
          { id: 2, description: 'Inspect all machined surfaces for finish quality and damage' },
          { id: 3, description: 'Verify proper placement of all casting identification marks' },
          { id: 4, description: 'Ensure no rust, oxidation, or excessive contaminants' },
          { id: 5, description: 'Confirm correct thread condition on all bolt holes' },
        ],
      },
      port_galley: {
        title: 'B. PORT & GALLEY INSPECTION',
        section_type: 'pass_fail_checklist',
        items: [
          { id: 1, description: 'Inspect intake ports for proper casting and machining' },
          { id: 2, description: 'Inspect exhaust ports for proper casting and machining' },
          { id: 3, description: 'Check coolant galleries for cleanliness' },
          { id: 4, description: 'Check oil galleries for cleanliness' },
          { id: 5, description: 'Confirm oil drain passages are properly sized and free from flaws' },
        ],
      },
      injector_bore: {
        title: 'C. INJECTOR BORE INSPECTION',
        section_type: 'pass_fail_checklist',
        items: [
          { id: 1, description: 'Verify that injector bores are properly machined' },
          { id: 2, description: 'Ensure injector cups are installed correctly' },
          { id: 3, description: 'Check for o-rings in injector bores and ensure proper fitment' },
          { id: 4, description: 'Inspect sealing surfaces for machining issues' },
        ],
      },
      valvetrain: {
        title: 'D. VALVETRAIN INSPECTION',
        section_type: 'pass_fail_checklist',
        items: [
          { id: 1, description: 'Inspect valve springs for visible damage, corrosion, or uneven seating' },
          { id: 2, description: 'Check spring seats/retainers for cracks, wear, or improper installation' },
          { id: 3, description: 'Verify valve stem seals are properly seated and free from visible damage' },
          { id: 4, description: 'Inspect valve stems for proper alignment — check for bent or misaligned valves' },
          { id: 5, description: 'Confirm all valve keepers are fully engaged and properly seated' },
        ],
      },
      packaging: {
        title: 'E. PACKAGING',
        section_type: 'pass_fail_checklist',
        items: [
          { id: 1, description: 'Verify proper rust prevention measures applied' },
          { id: 2, description: 'Ensure packaging prevents shipping damage' },
          { id: 3, description: 'All required documentation included' },
          { id: 4, description: 'Shipping labels correct and legible' },
        ],
      },
      // ── Dimensional sections (optional — shown only when user clicks "Add Dimensional") ──
      general_measurements: {
        title: 'F. GENERAL MEASUREMENTS',
        section_type: 'general_measurements',
        optional: true,
        items: [
          { id: 1, measurement: 'Cylinder Head Height' },
          { id: 2, measurement: 'Surface Finish (Ra)' },
          { id: 3, measurement: 'Flatness' },
          { id: 4, measurement: 'Valve Stem Height' },
        ],
      },
      camshaft_bore: {
        title: 'G. CAMSHAFT BORE DIMENSION',
        section_type: 'camshaft_bore',
        optional: true,
        bore_count: 7,
      },
      fire_ring_protrusion: {
        title: 'H. FIRE RING PROTRUSION',
        section_type: 'fire_ring_protrusion',
        optional: true,
        cylinder_count: 6,
      },
      valve_recession: {
        title: 'I. VALVE RECESSION',
        section_type: 'valve_recession',
        optional: true,
        cylinder_count: 6,
        intake_count: 2,
        exhaust_count: 2,
      },
      vacuum_test: {
        title: 'J. VACUUM TEST',
        section_type: 'vacuum_test',
        optional: true,
        cylinder_count: 6,
        intake_count: 2,
        exhaust_count: 2,
      },
    },
  },
];

async function seed() {
  try {
    // ── Admin user ──────────────────────────────────────────────────────────
    const existingAdmin = db.get("SELECT id FROM users WHERE email = ?", ['admin@pdi.com']);
    if (!existingAdmin) {
      const isProd = process.env.NODE_ENV === 'production';
      const suppliedPassword = process.env.ADMIN_PASSWORD;

      // In production the default "changeme" password is not acceptable — refuse
      // to create the admin until ADMIN_PASSWORD is explicitly provided and long
      // enough. The production deploy should also migrate to Entra sign-in
      // (password_hash left NULL) for real users.
      if (isProd) {
        if (!suppliedPassword || suppliedPassword.length < 12) {
          console.error('[Seed] Refusing to create default admin: set ADMIN_PASSWORD (>= 12 chars) before seeding in production.');
          process.exit(1);
        }
      }

      const adminId = uuidv4();
      const password = suppliedPassword || 'changeme';
      const hash = bcrypt.hashSync(password, 10);
      db.run(
        "INSERT INTO users (id, name, email, role, password_hash, active) VALUES (?, ?, ?, ?, ?, ?)",
        [adminId, 'PDI Admin', 'admin@pdi.com', 'admin', hash, 1]
      );
      console.log('[Seed] Created admin user: admin@pdi.com');
      if (!suppliedPassword) {
        console.warn('[Seed] WARNING: Using default password "changeme". Acceptable only for local development.');
      }
    } else {
      console.log('[Seed] Admin user already exists');
    }

    // ── Templates — insert or update ────────────────────────────────────────
    for (const template of TEMPLATES) {
      const existing = db.get("SELECT id FROM inspection_templates WHERE form_no = ?", [template.form_no]);
      if (!existing) {
        const templateId = uuidv4();
        db.run(
          `INSERT INTO inspection_templates
            (id, component_type, form_no, revision, title, form_type, disposition_type, header_schema, sections, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            templateId,
            template.component_type,
            template.form_no,
            template.revision,
            template.title,
            template.form_type,
            template.disposition_type,
            JSON.stringify(template.header_schema),
            JSON.stringify(template.sections),
            1,
          ]
        );
        console.log(`[Seed] Created template: ${template.form_no}`);
      } else {
        // Update content but preserve the existing UUID so inspections stay linked
        db.run(
          `UPDATE inspection_templates
           SET component_type = ?, title = ?, form_type = ?, disposition_type = ?,
               header_schema = ?, sections = ?, revision = ?
           WHERE form_no = ?`,
          [
            template.component_type,
            template.title,
            template.form_type,
            template.disposition_type,
            JSON.stringify(template.header_schema),
            JSON.stringify(template.sections),
            template.revision,
            template.form_no,
          ]
        );
        console.log(`[Seed] Updated template: ${template.form_no}`);
      }
    }

    // Deactivate the old standalone IQI-006 (now merged into IQI-005)
    const old006 = db.get("SELECT id FROM inspection_templates WHERE form_no = ?", ['PDI-IQI-006']);
    if (old006) {
      db.run("UPDATE inspection_templates SET active = 0 WHERE form_no = ?", ['PDI-IQI-006']);
      console.log('[Seed] Deactivated legacy template: PDI-IQI-006 (merged into PDI-IQI-005)');
    }

    console.log('[Seed] Database seeding complete');
    process.exit(0);
  } catch (err) {
    console.error('[Seed] Error:', err.message);
    process.exit(1);
  }
}

seed();
