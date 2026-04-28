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

  // ── PDI-IQI-007  Camshaft ────────────────────────────────────────────────
  {
    component_type: 'camshaft',
    form_no: 'PDI-IQI-007',
    title: 'PDI Incoming Quality Inspection — Camshaft',
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
          { id: 1, name: 'Cam Lobes',                    requirement: 'Cam lobes are free from chips, dents, scratches, scoring, pitting, rust, or discoloration.' },
          { id: 2, name: 'Bearing Journals',             requirement: 'Bearing journals have a smooth, uniform finish with no nicks, bruising, or corrosion.' },
          { id: 3, name: 'Thrust Faces',                 requirement: 'Thrust faces are clean and undamaged, with no burrs or gouges.' },
          { id: 4, name: 'Gear / Keyway / Timing Features', requirement: 'Gear, keyway, dowel, or timing-feature areas are free from cracks, chips, and burrs.' },
          { id: 5, name: 'Oil Passages',                 requirement: 'Oil holes/passages visible from the outside are open and free from burrs, metal chips, or debris.' },
          { id: 6, name: 'Shaft Straightness',           requirement: 'Shaft is visually straight with no obvious bending or handling damage.' },
          { id: 7, name: 'Edges & Machined Transitions', requirement: 'Edges and machined transitions are clean, with no sharp burrs or loose material.' },
          { id: 8, name: 'Surface Cleanliness',          requirement: 'Overall surface is free from contamination such as dirt, grinding residue, preservative buildup, or foreign material.' },
        ],
      },
    },
  },

  // ── PDI-IQI-008  Radiator ────────────────────────────────────────────────
  {
    component_type: 'radiator',
    form_no: 'PDI-IQI-008',
    title: 'PDI Incoming Quality Inspection — Radiator',
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
          { id: 1, name: 'Cooling Fins',               requirement: 'Cooling fins are straight, evenly spaced, and not crushed, folded, torn, or missing.' },
          { id: 2, name: 'Tubes',                      requirement: 'Tubes are free from dents, punctures, cracks, or visible deformation.' },
          { id: 3, name: 'Header Plates & Tank Joints', requirement: 'Header plates and tank-to-core joints show uniform brazing/crimping with no gaps, cracks, or separation.' },
          { id: 4, name: 'Tanks',                      requirement: 'Tanks are free from cracks, dents, warping, or molding/casting defects.' },
          { id: 5, name: 'Inlet & Outlet Necks',       requirement: 'Inlet and outlet necks are round, clean, and free from dents, cracks, burrs, or deformation.' },
          { id: 6, name: 'Mounting Brackets & Frames', requirement: 'Mounting brackets, side plates, and support frames are not bent, cracked, or loose.' },
          { id: 7, name: 'Core Alignment',             requirement: 'Core is visually square and not twisted, bowed, or misaligned.' },
          { id: 8, name: 'Surface Cleanliness',        requirement: 'External surfaces are free from corrosion, loose flux, debris, oil, or other contamination.' },
        ],
      },
    },
  },

  // ── PDI-IQI-009  Clutch ──────────────────────────────────────────────────
  {
    component_type: 'clutch',
    form_no: 'PDI-IQI-009',
    title: 'PDI Incoming Quality Inspection — Clutch',
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
    },
  },

  // ── PDI-IQI-010  Oil Cooler ──────────────────────────────────────────────
  {
    component_type: 'oil_cooler',
    form_no: 'PDI-IQI-010',
    title: 'PDI Incoming Quality Inspection — Oil Cooler',
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
          { id: 1, name: 'Cooling Fins / Core',        requirement: 'Cooling fins, plates, or core surfaces are straight and free from crushed, torn, or missing sections.' },
          { id: 2, name: 'Body Integrity',             requirement: 'Tubes, plates, or cooler body are free from dents, cracks, punctures, or deformation.' },
          { id: 3, name: 'Brazed / Welded Joints',     requirement: 'Brazed, welded, or bonded joints appear continuous with no visible gaps, cracks, voids, or separation.' },
          { id: 4, name: 'Oil & Coolant Ports',        requirement: 'Oil and coolant ports are clean, round, and free from burrs, dents, thread damage, or contamination.' },
          { id: 5, name: 'Sealing Faces',              requirement: 'Sealing faces are smooth and free from scratches, gouges, corrosion, or embedded debris.' },
          { id: 6, name: 'Mounting Tabs & Brackets',   requirement: 'Mounting tabs, brackets, and bosses are intact and not cracked, bent, or broken.' },
          { id: 7, name: 'Exterior Surfaces',          requirement: 'Exterior surfaces are free from rust, oxidation, loose scale, oil residue, or foreign material.' },
          { id: 8, name: 'Internal Port Areas',        requirement: 'Visible internal port areas are free from metal chips, casting sand, loose particles, or blockage.' },
        ],
      },
    },
  },

  // ── PDI-IQI-011  Turbocharger ────────────────────────────────────────────
  {
    component_type: 'turbocharger',
    form_no: 'PDI-IQI-011',
    title: 'PDI Incoming Quality Inspection — Turbocharger',
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
          { id: 1, name: 'Compressor Wheel Blades',    requirement: 'Compressor wheel blades are free from chips, cracks, bends, nicks, or foreign-object damage.' },
          { id: 2, name: 'Turbine Wheel Blades',       requirement: 'Turbine wheel blades are free from cracks, missing material, bends, or visible impact damage.' },
          { id: 3, name: 'Compressor & Turbine Housings', requirement: 'Compressor and turbine housings are free from cracks, dents, casting defects, or broken flanges.' },
          { id: 4, name: 'Inlet & Outlet Openings',    requirement: 'Inlet and outlet openings are clean and free from debris, metal chips, or loose material.' },
          { id: 5, name: 'Mounting Flanges',           requirement: 'Mounting flanges and gasket faces are smooth and free from scratches, gouges, dents, or corrosion.' },
          { id: 6, name: 'Studs & Threaded Holes',     requirement: 'Studs, threaded holes, and fastener areas are visually undamaged and free from burrs or deformation.' },
          { id: 7, name: 'Actuator & Wastegate',       requirement: 'Actuator, linkage, and wastegate/VGT external components are intact, correctly seated, and not bent or damaged.' },
          { id: 8, name: 'Oil & Coolant Connections',  requirement: 'Oil and coolant connection areas are clean and free from cracks, damaged threads, or sealing-surface defects.' },
        ],
      },
    },
  },

  // ── PDI-IQI-012  Fuel Injector ───────────────────────────────────────────
  {
    component_type: 'fuel_injector',
    form_no: 'PDI-IQI-012',
    title: 'PDI Incoming Quality Inspection — Fuel Injector',
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
          { id: 1, name: 'Injector Body',              requirement: 'Injector body is free from cracks, dents, corrosion, scratches, or handling damage.' },
          { id: 2, name: 'Nozzle Tip',                 requirement: 'Nozzle tip is clean and free from dents, cracks, burrs, contamination, or blocked visible spray holes.' },
          { id: 3, name: 'Sealing Cone / Seat',        requirement: 'Sealing cone, seat, or sealing washer contact areas are smooth and free from gouges, nicks, or debris.' },
          { id: 4, name: 'Threads & Fuel Ports',       requirement: 'Threads and fuel connection ports are clean and free from burrs, dents, cross-threading, or deformation.' },
          { id: 5, name: 'Electrical Connector',       requirement: 'Electrical connector body and pins, if applicable, are straight, clean, intact, and free from cracks or bent terminals.' },
          { id: 6, name: 'O-Rings & Seals',            requirement: "O-rings, seals, or visible sealing elements are present, seated correctly, and free from cuts, twists, flattening, or contamination." },
          { id: 7, name: 'Filter Screen / Inlet',      requirement: 'Filter screen or inlet area, where visible, is clean and free from metal chips, dirt, or obstruction.' },
          { id: 8, name: 'External Surfaces',          requirement: 'External surfaces show no oil, grease, rust, preservative buildup, or foreign material that could affect installation or cleanliness.' },
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

    console.log('[Seed] Completed successfully.');
  } catch (err) {
    console.error('[Seed] Fatal error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  seed().catch(err => {
    console.error('[Seed] Unhandled error:', err);
    process.exit(1);
  });
}

module.exports = { seed };