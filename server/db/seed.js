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
      // The Dimensional Inspection for the Fuel Injector holds the CarbonZapp
      // test-bench results. These placeholder rows are replaced per-inspection
      // by the synced test steps when a report is imported.
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Test Bench Results', location: 'Flow / response measurements are populated automatically from the linked CarbonZapp injector test report.', spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-013  Cylinder Block ──────────────────────────────────────────
  {
    component_type: 'cylinder_block', form_no: 'PDI-IQI-013',
    title: 'PDI Incoming Quality Inspection — Cylinder Block',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Casting & Fire Deck Integrity', requirement: 'Zero visible cracks, porosity, cold-shuts, or inclusions on the top deck face, water jackets, or exterior crankcase structures.' },
          { id: 2, name: 'Liner Seats & Packing Grooves', requirement: 'Machined liner counterbore steps and lower O-ring packing grooves are sharp and free of fretting, scoring, rust, or residual machining steps.' },
          { id: 3, name: 'Main Bearing Saddles & Caps',   requirement: 'Cap-to-block mating serrations or flat locator surfaces are completely clean, unbruised, and free of nicks or handling damage.' },
          { id: 4, name: 'Thread & Tap Condition',        requirement: 'All cylinder head bolt holes, main cap bolt holes, and auxiliary oil gallery tapped threads are clean, fully formed, and free of cross-threading or trapped metal swarf.' },
          { id: 5, name: 'Oil & Coolant Galleries',       requirement: 'All internal oil cross-drillings and cooling passages are completely unobstructed; verified free of residual casting sand, scale, or machining chips.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Liner Counterbore Depth',    location: 'Measured at 4 points (90° intervals) around the perimeter of each cylinder liner seating step.',                                spec: '' },
          { id: 2, measurement: 'Main Bearing Bore Diameter', location: 'Across all main journals with caps installed and torqued to specification (0° and 90° vertical/horizontal axes).',                 spec: '' },
          { id: 3, measurement: 'Block Deck Flatness',        location: 'Precision straight-edge and feeler gauge checks along longitudinal, transverse, and diagonal axes of the cylinder head mating face.', spec: '' },
          { id: 4, measurement: 'Camshaft Bore Diameter',     location: 'Inside diameter check at all internal cam tunnel bearing positions (0° and 90° axes).',                                            spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-014  Crankshaft ──────────────────────────────────────────────
  {
    component_type: 'crankshaft', form_no: 'PDI-IQI-014',
    title: 'PDI Incoming Quality Inspection — Crankshaft',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Journal Surface Finish',   requirement: 'All main and connecting rod journals ground to a mirror finish; zero evidence of linear scoring, micro-pitting, transit scratches, or heat discoloration.' },
          { id: 2, name: 'Fillet Radii Transitions', requirement: 'Journal fillet radii are perfectly smooth and continuous; free of machining steps, grinding burn marks, or sharp undercut transitions.' },
          { id: 3, name: 'Oil Holes & Chamfers',     requirement: 'Lubrication cross-holes are fully open and deburred; chamfered edges are smooth with zero loose grinding fins or trapped debris inside the oil pathways.' },
          { id: 4, name: 'Keyways, Splines & Snout', requirement: 'Front snout keyways, timing gear press-fit areas, and rear flange bolt holes are crisp, clean, and free of burrs or rolled-over metal edges.' },
          { id: 5, name: 'Thrust Face Alignment',    requirement: 'Machined thrust walls adjacent to the indexing main journal are clean and free of grinding tears or handling nicks.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Main Journal Outer Diameter (OD)',                location: 'At the front, center, and rear sections of each main journal across 0° and 90° axes.',                                          spec: '' },
          { id: 2, measurement: 'Crankpin / Rod Journal Outer Diameter (OD)',       location: 'At the center section of each rod journal across 0° and 90° axes.',                                                       spec: '' },
          { id: 3, measurement: 'Journal Taper & Out-of-Round',                     location: 'Calculated max-to-min diameter difference across the width and circumference of each individual journal.',                    spec: '' },
          { id: 4, measurement: 'Total Indicator Runout (Crankshaft Straightness)', location: 'Supported on V-blocks at the front and rear main journals; dial indicator on the center main journal through a 360° rotation.', spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-015  Dampener (Vibration Damper) ─────────────────────────────
  {
    component_type: 'dampener', form_no: 'PDI-IQI-015',
    title: 'PDI Incoming Quality Inspection — Dampener',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Housing & Seal Integrity (Viscous Type)', requirement: 'Laser-welded or crimped housing is continuous and completely sealed; zero evidence of silicone fluid weeping, exterior dents, or housing bulges.' },
          { id: 2, name: 'Elastomer Element (Rubber Type)',         requirement: 'Bonded rubber strip is fully intact; zero cracking, separation from metal rings, dry-rot pits, or extrusion gaps between the hub and inertia ring.' },
          { id: 3, name: 'Indexing & Timing Marks',                 requirement: 'Top Dead Center (TDC) and degree alignment marks are permanently stamped, clean, legible, and unmarred.' },
          { id: 4, name: 'Mounting Flange Face',                    requirement: 'Crankshaft snout mounting surface and bolt holes are flat and free of burrs, paint overspray, rust, or impact nicks.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Crankshaft Pilot Bore Inner Diameter (ID)', location: 'Inside diameter of the center registration hub bore (measured across 2 perpendicular axes).',                                           spec: '' },
          { id: 2, measurement: 'Mounting Flange Thickness',                  location: 'At 4 equidistant points around the bolt circle flange layout.',                                                                         spec: '' },
          { id: 3, measurement: 'Radial and Axial Runout (TIR)',              location: 'Mounted to a true test arbor; dial indicator tracked on the outermost perimeter face and front lateral face through a full rotation.', spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-016  Exhaust Manifold Spacer ─────────────────────────────────
  {
    component_type: 'exhaust_manifold_spacer', form_no: 'PDI-IQI-016',
    title: 'PDI Incoming Quality Inspection — Exhaust Manifold Spacer',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Sealing Flange Surface Finish', requirement: 'Machined gasket seating faces are smooth and uniform; zero deep scratches, pitting, casting voids, or transport gouges.' },
          { id: 2, name: 'Gas Passage Profiles',          requirement: 'Internal exhaust gas path is completely free of casting fins, flash, metal inclusions, or loose scale that could disrupt gas flow.' },
          { id: 3, name: 'Fastener Clearance Holes',      requirement: 'Through-bolt holes are clean, round, and free of edge crushing, burrs, or drilling exit steps.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Overall Thickness',    location: 'With a micrometer at all 4 corners/edges of the spacer block.',                                          spec: '' },
          { id: 2, measurement: 'Parallelism',          location: 'Maximum thickness variation calculated between all measured points on the parallel seating planes.',     spec: '' },
          { id: 3, measurement: 'Flange Face Flatness', location: 'Across the sealing planes using a precision surface plate layout or a knife-edge straight-edge.',          spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-017  Piston Oiler (Cooling Jet) ──────────────────────────────
  {
    component_type: 'piston_oiler', form_no: 'PDI-IQI-017',
    title: 'PDI Incoming Quality Inspection — Piston Oiler',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Tube Alignment & Nozzle Shape', requirement: 'Oiler target tubes are perfectly formed and visually straight; zero crimps, handling kinks, flattening, or tool indentation marks along the thin-wall tubing.' },
          { id: 2, name: 'Braze / Weld Joint Integrity',  requirement: 'Brazed or welded joints anchoring the target tubes to the mounting banjo base block are continuous, uniform, and free of pinholes or cracking.' },
          { id: 3, name: 'Jet Discharge Orifice',         requirement: 'The final fluid exit orifice is perfectly round, crisp, and 100% free of internal swarf, burrs, or storage preservative blockage.' },
          { id: 4, name: 'Locating Dowel Pin / Tab',      requirement: 'The alignment pin or anti-rotation tab on the mounting base is unbent, rigid, and completely free of casting or stamping defects.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Nozzle Jet Tip Orifice Diameter',        location: 'Internal diameter verification at the tube exit tip using a calibrated Go/No-Go pin gauge.',                  spec: '' },
          { id: 2, measurement: 'Banjo Base Mounting Inner Diameter (ID)', location: 'Inside diameter of the bolt fastening bore (2 axes at 90°).',                                              spec: '' },
          { id: 3, measurement: 'Nozzle Tip Protrusion Height & Offset',   location: 'Via a height gauge fixture from the flat mounting base face to the center point of the nozzle tip orifice.', spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-018  Piston Oiler Bolt (Banjo Bolt w/ Check Valve) ───────────
  {
    component_type: 'piston_oiler_bolt', form_no: 'PDI-IQI-018',
    title: 'PDI Incoming Quality Inspection — Piston Oiler Bolt',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Thread Roll Quality',                     requirement: 'Threads are fully formed, clean, and uniform; zero flat spots, rolling nicks, crest tearing, or cross-threaded areas.' },
          { id: 2, name: 'Fluid Feed Ports',                        requirement: 'Cross-drilled fluid passages and the central axial feed hole are entirely open; free of drilling burrs, loose flakes, or residual metal shavings.' },
          { id: 3, name: 'Internal Check Valve Mechanical Freedom', requirement: 'Internal spring-loaded ball or plunger moves smoothly when depressed with a brass test probe; snaps back securely into its seat with no binding or sticking.' },
          { id: 4, name: 'Under-Head Sealing Shoulder',            requirement: 'The flat shoulder face that contacts the oiler block/crush washer is entirely free of radial scratches, burrs, or machining spirals.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Major Thread Diameter & Pitch', location: 'Thread section check using a micrometer and thread pitch ring gauge.',     spec: '' },
          { id: 2, measurement: 'Under-Head Shank Length',       location: 'From the flat bearing shoulder to the absolute end of the bolt shank.',     spec: '' },
          { id: 3, measurement: 'Cross-Drilled Port Diameter',   location: 'Inside diameter verification of fluid escape cross-holes via pin gauges.', spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-019  Rocker Shaft ────────────────────────────────────────────
  {
    component_type: 'rocker_shaft', form_no: 'PDI-IQI-019',
    title: 'PDI Incoming Quality Inspection — Rocker Shaft',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Journal Seating Surface Finish', requirement: 'Centerless-ground shaft OD at all rocker arm journal locations must be mirror-smooth; zero scoring, ridges, pitting, handling bruises, or chrome-plating flaking.' },
          { id: 2, name: 'Oil Distribution Passages',      requirement: 'All radial oil supply feed holes are smoothly deburred and radiused; internal oil tunnel is clear of honing residue or factory debris.' },
          { id: 3, name: 'End-Plug Sealing',               requirement: 'Pressed-in or welded end retention plugs are tight, seated flush, and show zero micro-cracks or loose fitment.' },
          { id: 4, name: 'Mounting Pedestal Bosses',       requirement: 'Flat relief cuts or mounting notches for hold-down bolts are free of sharp burrs or alignment distortion.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Shaft Outer Diameter (OD)',         location: 'At each separate rocker arm journal position along 2 axes spaced 90° apart.',                             spec: '' },
          { id: 2, measurement: 'Shaft Straightness',                location: 'Total Indicator Runout (TIR) along the center span of the shaft while supported on V-blocks at both ends.', spec: '' },
          { id: 3, measurement: 'Pedestal Mount Bolt Hole Location', location: 'Center-to-center pitch distance checked between all adjacent hold-down bolt paths.',                       spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-020  Connecting Rod Bearing (Shell Half) ─────────────────────
  {
    component_type: 'connecting_rod_bearing', form_no: 'PDI-IQI-020',
    title: 'PDI Incoming Quality Inspection — Connecting Rod Bearing',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Antifriction Lining Overlay',    requirement: 'The interior bearing lining surface is 100% flawless and uniform; zero scratches, scuffs, layer blistering, exposed mid-layers, or embedded foreign matter.' },
          { id: 2, name: 'Steel Backing Condition',        requirement: 'The rear steel shell face is smooth, clean, and uniform; zero rust stains, pitting, fretting shadows, or deep stamping indentations.' },
          { id: 3, name: 'Locating Tangs & Parting Lines', requirement: 'Anti-rotation locating tangs are sharp, crisp, and completely unbent; parting line mating faces are flat and free of upset metal or handling burrs.' },
          { id: 4, name: 'Oil Grooves & Holes',            requirement: 'Oil supply channels and cross-holes are cleanly punched/machined with smoothly chamfered edges; no loose backing burrs.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Bearing Shell Wall Thickness', location: 'At the exact center apex of the bearing half using a specialized ball-anvil micrometer.',        spec: '' },
          { id: 2, measurement: 'Overall Shell Width',          location: 'Parallel to the bearing centerline across the parting line edges.',                              spec: '' },
          { id: 3, measurement: 'Bearing Free Spread',          location: 'Distance across the extreme outer tips of the bearing shell parting lines in its relaxed state.', spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-021  Spacer Plate (Block-to-Head) ────────────────────────────
  {
    component_type: 'spacer_plate', form_no: 'PDI-IQI-021',
    title: 'PDI Incoming Quality Inspection — Spacer Plate',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Sealing Face Flatness & Finish', requirement: 'Parallel sealing faces are flat and uniform; zero scratches, deep handling gouges, corrosion pits, or distorted areas caused by improper wire-wheel cleanup.' },
          { id: 2, name: 'Inner & Outer Edge Cleanliness', requirement: 'Cylinder liner bore cutouts and outer perimeter profiles are clean-stamped/machined; completely free of heavy dross, hanging burrs, or edge distortions.' },
          { id: 3, name: 'Transfer Passages',              requirement: 'All stamped water-jacket holes, oil pressure feeds, and pushrod passages are fully formed, clear, and perfectly aligned with no obstruction or restricted corners.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Plate Thickness',                          location: 'With a micrometer at 6 standardized locations across the plate perimeter layout (ends and center bridges).', spec: '' },
          { id: 2, measurement: 'Parallelism (Thickness Variation)',        location: 'Calculated total difference between maximum and minimum thickness readings across the entire plate body.',    spec: '' },
          { id: 3, measurement: 'Cylinder Liner Cutout Inner Diameter (ID)', location: 'Across 2 perpendicular axes at each cylinder opening loop.',                                                spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-022  Thermostat ──────────────────────────────────────────────
  {
    component_type: 'thermostat', form_no: 'PDI-IQI-022',
    title: 'PDI Incoming Quality Inspection — Thermostat',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Housing Frame & Valve Seat',       requirement: 'Stainless steel or brass support bridge is straight and free of bending deformation; valve seating face is uniform with no nicks or uneven gaps.' },
          { id: 2, name: 'Expansion Element & Spring',       requirement: 'Return spring is uniformly coiled, concentric, and free of distortion; copper wax pellet capsule is completely sealed with zero wax leakage or cracking.' },
          { id: 3, name: 'Bleed Valve / Jiggle Pin Freedom', requirement: 'Bypass air bleed hole is open and clean; jiggle pin or check ball is loose and moves freely within its slot without binding.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Flange Outer Diameter (OD)',             location: 'Across the outermost edge of the main mounting seating flange (2 axes at 90°).',                                  spec: '' },
          { id: 2, measurement: 'Overall Assembly Height (Closed)',       location: 'From the apex of the frame bridge to the base of the closed bypass sealing disk.',                              spec: '' },
          { id: 3, measurement: 'Valve Opening Stroke (Functional Check)', location: 'Submerged hot water bath testing; measuring total valve lift distance at the fully open rated temperature spec.', spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-023  Thrust Washer ───────────────────────────────────────────
  {
    component_type: 'thrust_washer', form_no: 'PDI-IQI-023',
    title: 'PDI Incoming Quality Inspection — Thrust Washer',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Running Face & Oil Grooves',  requirement: 'The anti-friction thrust face overlay is entirely uniform; oil distribution grooves are clean, full-depth, and entirely free of machining burrs, scoring, or flaking.' },
          { id: 2, name: 'Steel Backing Flatness',      requirement: 'The raw steel backing face is smooth, clean, flat, and completely free of localized high spots, transport nicks, or oxidation.' },
          { id: 3, name: 'Locating Tabs / Tabs Profile', requirement: 'Anti-rotation locking tabs or outer ear locations are clean-cut, unbent, and square.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Washer Total Thickness',                       location: 'With a micrometer at 4 equidistant points (90° intervals) around the center circle of the washer body.', spec: '' },
          { id: 2, measurement: 'Outer Diameter (OD) and Inner Diameter (ID)', location: 'Across 2 perpendicular axes using a digital caliper.',                                                  spec: '' },
          { id: 3, measurement: 'Flatness Deviation',                           location: 'On a certified precision surface plate with a feeler gauge to ensure zero warping.',                     spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-024  Water Pump ──────────────────────────────────────────────
  {
    component_type: 'water_pump', form_no: 'PDI-IQI-024',
    title: 'PDI Incoming Quality Inspection — Water Pump',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Casting & Housing Integrity',       requirement: 'Pump body volute and mounting flanges are entirely free of casting voids, hairline cracks, or sand inclusions.' },
          { id: 2, name: 'Impeller Seating & Vanes',          requirement: 'Impeller blades are complete and undamaged; zero cavitation pitting, casting slag, or distortion; securely pressed onto the pump shaft.' },
          { id: 3, name: 'Rotational Freedom & Bearing Feel', requirement: 'Shaft rotates smoothly by hand through a full 360° loop; zero evidence of internal roughness, tight spots, clicking, or excessive dry friction feel.' },
          { id: 4, name: 'Weep Hole Openness',                requirement: 'The internal cartridge seal weep hole is open and completely free of excess sealant, metal chips, or signs of transit oil leaks.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Mounting Flange Flatness',             location: 'Straight-edge and feeler gauge check across the block-mating flange face surface.',          spec: '' },
          { id: 2, measurement: 'Drive Pulley / Hub Protrusion Height', location: 'From the flat block-mounting flange plane to the outer face of the drive pulley/gear hub.', spec: '' },
          { id: 3, measurement: 'Impeller Back-Clearance',              location: 'Distance between the rear edge of the impeller vanes and the inner volute casting wall.',    spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-025  Flywheel ────────────────────────────────────────────────
  {
    component_type: 'flywheel', form_no: 'PDI-IQI-025',
    title: 'PDI Incoming Quality Inspection — Flywheel',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Clutch Friction Surface Finish',            requirement: 'Ground clutch interface area is flat and mirror-smooth; zero evidence of heat checking, grinding scoring, radial scratches, or deep handling dents.' },
          { id: 2, name: 'Starter Ring Gear Teeth',                   requirement: 'All ring gear teeth are complete and fully formed; zero chipped, broken, or cracked teeth; leading engagement chamfers are clean and uniform.' },
          { id: 3, name: 'Crank Snout Centering Pilot & Thread Holes', requirement: 'Center locating pilot bore and crankshaft mounting bolt paths are free of rust, burrs, cross-drilling edge steps, or metal chips.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Friction Face Flatness (Total Sweep)',     location: 'Via a dial indicator sweep across the outer radial friction surface while anchored on a true rotation fixture.', spec: '' },
          { id: 2, measurement: 'Pilot Bearing Pocket Inner Diameter (ID)', location: 'Inside diameter of the center pilot bearing bore (measured across 2 perpendicular axes).',                    spec: '' },
          { id: 3, measurement: 'Starter Ring Gear Outer Diameter (OD)',    location: 'At 3 points (120° intervals) across the top tips of the ring gear teeth.',                                   spec: '' },
        ],
      },
    },
  },

  // ── PDI-IQI-026  Stud Kit (Cylinder Head / Main Bearing Studs) ───────────
  {
    component_type: 'stud_kit', form_no: 'PDI-IQI-026',
    title: 'PDI Incoming Quality Inspection — Stud Kit',
    form_type: 'iqi_standard', disposition_type: 'pass_fail', revision: '',
    header_schema: STANDARD_HEADER,
    sections: {
      receiving: { title: 'A. RECEIVING & DOCUMENTATION VERIFICATION', section_type: 'pfn_checklist', items: RECEIVING_ITEMS },
      visual: {
        title: 'B. VISUAL INSPECTION', section_type: 'pass_fail_checklist',
        items: [
          { id: 1, name: 'Rolled Thread Profiles',          requirement: 'Threads on both ends (block engagement and nut engagement) are fully formed and crisp; zero flat crests, cross-thread nicks, or razor burrs.' },
          { id: 2, name: 'Unthreaded Center Shank',         requirement: 'The solid intermediate shank body is straight and uniform; zero machining tool gouges, linear stretch marks, or hydrogen embrittlement micro-cracks.' },
          { id: 3, name: 'Hex Nut Internal Threading',      requirement: 'Kit fasteners/nuts are fully tapped; threads are clean and free of plating build-up or loose internal metal flakes.' },
          { id: 4, name: 'Hardened Washer Face Uniformity', requirement: 'Parallel surfaces of parallel washers are smooth and clean; zero stamping burrs, edge splitting, or uneven dish warping.' },
        ],
      },
      dimensional: {
        title: 'C. DIMENSIONAL INSPECTION', section_type: 'dimensional',
        items: [
          { id: 1, measurement: 'Total Stud Length',                  location: 'End-to-end parallel to the central stud axis.',                                              spec: '' },
          { id: 2, measurement: 'Block-End & Nut-End Thread Lengths', location: 'Axial length check of the short and long thread segments using a digital caliper depth rod.', spec: '' },
          { id: 3, measurement: 'Nut Hex Parallel Width',             location: 'Micrometer measurement across the flat driving faces of a sample nut from the kit.',          spec: '' },
        ],
      },
    },
  },
];

// ─── PDI-IQI-005 Rev A sections (preserved, inactive after Rev B seeds) ────────
const PDI_IQI_005_V1_SECTIONS = {
  receiving: {
    title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
    section_type: 'pfn_checklist',
    items: RECEIVING_ITEMS,
  },
  visual: {
    title: 'B. VISUAL INSPECTION',
    section_type: 'pfn_checklist',
    items: [
      { id: 1, name: 'Casting Integrity',                    requirement: 'No visible cracks, voids, or porosity on any casting surface; combustion deck, port walls, and coolant jacket areas are free from casting defects.' },
      { id: 2, name: 'Combustion Deck & Machined Surfaces',  requirement: 'Deck face and all machined surfaces are clean and free from scratches, gouges, pitting, or handling damage; surface finish appears within specification.' },
      { id: 3, name: 'Thread Condition',                     requirement: 'All bolt holes, port threads, and tapped features are clean and correctly formed; no cross-threading, stripping, or debris lodged in threaded areas.' },
      { id: 4, name: 'Intake & Exhaust Ports',               requirement: 'Port walls are correctly cast and machined; free from casting fins, metal intrusions, burrs, or machining tears that would affect flow path or port geometry.' },
      { id: 5, name: 'Coolant & Oil Galleries',              requirement: 'Coolant passages and oil galleries are clear and unobstructed; no visible debris, casting sand, swarf, or blockage at accessible openings.' },
      { id: 6, name: 'Oil Drain Passages',                   requirement: 'Oil drain passages are correctly sized and unobstructed; free from casting burrs, fins, or blockage that would restrict return flow.' },
      { id: 7, name: 'Injector Bores & Sealing Surfaces',   requirement: 'Injector bores are correctly machined; cups are properly seated and undamaged; o-rings are correctly installed and free from damage or distortion; sealing surfaces are free from machining defects.' },
      { id: 8, name: 'Valvetrain Components',                requirement: 'Valve springs, seats, and retainers show no visible cracks, damage, or improper installation; valve stems are straight and correctly aligned; all keepers are fully engaged and correctly seated; stem seals are properly positioned and undamaged.' },
    ],
  },
  general_measurements: {
    title: 'C. DIMENSIONAL INSPECTION',
    section_type: 'general_measurements',
    optional: true,
    items: [
      { id: 1, measurement: 'Cylinder Head Height' },
      { id: 2, measurement: 'Surface Finish (Ra)' },
      { id: 3, measurement: 'Flatness' },
      { id: 4, measurement: 'Valve Stem Height' },
    ],
  },
  camshaft_bore:        { title: 'C5. CAMSHAFT BORE DIMENSION', section_type: 'camshaft_bore',        optional: true, bore_count: 7 },
  fire_ring_protrusion: { title: 'C6. FIRE RING PROTRUSION',   section_type: 'fire_ring_protrusion', optional: true, cylinder_count: 6 },
  valve_recession:      { title: 'C7. VALVE RECESSION',         section_type: 'valve_recession',      optional: true, cylinder_count: 6, intake_count: 2, exhaust_count: 2 },
  vacuum_test:          { title: 'C8. VACUUM TEST',             section_type: 'vacuum_test',          optional: true, cylinder_count: 6, intake_count: 2, exhaust_count: 2 },
};

// ─── PDI-IQI-005 Rev B sections (active revision) ────────────────────────────
const PDI_IQI_005_V2_SECTIONS = {
  receiving: {
    title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
    section_type: 'pfn_checklist',
    items: RECEIVING_ITEMS,
  },
  visual: {
    title: 'B. VISUAL INSPECTION',
    section_type: 'pfn_checklist',
    items: [
      { id: 1,  name: 'Oxidation / Markings',            requirement: 'Should be free of rust, pitting, or other material oxidation' },
      { id: 2,  name: 'Edge Debur',                       requirement: 'Check machined edges for sharp edges' },
      { id: 3,  name: 'Block-off Plugs',                  requirement: 'Confirm all required plugs are in place and torqued to spec' },
      { id: 4,  name: 'Heat Tab',                         requirement: 'Confirm Heat Tab in installed appropriately' },
      { id: 5,  name: 'Casting Quality',                  requirement: 'Using bore-scope verify casting quality in all intake and exhaust ports' },
      { id: 6,  name: 'Finish',                           requirement: 'Confirm machining finish and casting quality' },
      { id: 7,  name: 'Machining Quality',                requirement: 'Verify machining quality in all intake and exhaust ports if applicable' },
      { id: 8,  name: 'Material Type',                    requirement: 'Confirm injector cup material type' },
      { id: 9,  name: 'Pass-through bore (Cummins)',      requirement: 'Confirm pass through tube fits bore' },
      { id: 10, name: 'Correct Valves',                   requirement: 'Confirm intake/exhaust in correct locations' },
      { id: 11, name: 'Springs / Retainers / Keepers',   requirement: 'Confirm correct spring assemblies and everything assembled properly' },
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
    // All specs are shown in the header; only Wire Protrusion (entry: true)
    // has per-cylinder data-entry fields.
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

    // ── PDI-IQI-005 versioning ─────────────────────────────────────────────────
    // Rev A (old content) is preserved inactive; Rev B (new content) is active.
    // Admins can reactivate Rev A from Admin > Inspection Forms at any time.
    {
      const now = new Date().toISOString();
      const FORM_NO = 'PDI-IQI-005';
      const TITLE   = 'PDI Incoming Quality Inspection — Cylinder Head';

      // Locate or create Rev A ------------------------------------------------
      let revA = db.get(
        "SELECT id, version FROM inspection_templates WHERE form_no = ? AND revision = 'A'",
        [FORM_NO]
      );

      if (!revA) {
        // Existing template with blank revision (pre-versioning seed) → stamp as Rev A
        const legacy = db.get(
          "SELECT id, version FROM inspection_templates WHERE form_no = ? AND (revision = '' OR revision IS NULL)",
          [FORM_NO]
        );
        if (legacy) {
          db.run(
            "UPDATE inspection_templates SET revision = 'A', active = 0 WHERE id = ?",
            [legacy.id]
          );
          revA = { id: legacy.id, version: legacy.version || 1 };
          console.log('[Seed] Stamped existing PDI-IQI-005 as Rev A (inactive)');
        } else {
          // Fresh DB with no existing IQI-005 — insert Rev A as inactive baseline
          const revAId = uuidv4();
          db.run(
            `INSERT INTO inspection_templates
               (id, component_type, form_no, revision, title, form_type, disposition_type,
                header_schema, sections, active, created_at, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`,
            [revAId, 'cylinder_head', FORM_NO, 'A', TITLE, 'iqi_combined', 'pass_fail',
             JSON.stringify(STANDARD_HEADER), JSON.stringify(PDI_IQI_005_V1_SECTIONS), now]
          );
          revA = { id: revAId, version: 1 };
          console.log('[Seed] Created PDI-IQI-005 Rev A (inactive baseline)');
        }
      }

      // Locate or create Rev B ------------------------------------------------
      const revB = db.get(
        "SELECT id FROM inspection_templates WHERE form_no = ? AND revision = 'B'",
        [FORM_NO]
      );
      if (!revB) {
        const revBId = uuidv4();
        db.run(
          `INSERT INTO inspection_templates
             (id, component_type, form_no, revision, title, form_type, disposition_type,
              header_schema, sections, active, created_at, version, parent_template_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [revBId, 'cylinder_head', FORM_NO, 'B', TITLE, 'iqi_combined', 'pass_fail',
           JSON.stringify(STANDARD_HEADER), JSON.stringify(PDI_IQI_005_V2_SECTIONS),
           now, (revA.version || 1) + 1, revA.id]
        );
        // Ensure no other IQI-005 variant is left active
        db.run(
          "UPDATE inspection_templates SET active = 0 WHERE form_no = ? AND id != ?",
          [FORM_NO, revBId]
        );
        console.log('[Seed] Created PDI-IQI-005 Rev B (active)');
      } else {
        console.log('[Seed] PDI-IQI-005 Rev B already exists — skipping');
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