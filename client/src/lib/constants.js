export const COMPONENT_TYPE_LABELS = {
  piston: 'Piston',
  cylinder_liner: 'Cylinder Liner',
  piston_pin: 'Piston Pin',
  piston_ring: 'Piston Ring',
  cylinder_head: 'Cylinder Head',
  camshaft: 'Camshaft',
  radiator: 'Radiator',
  clutch: 'Clutch',
  oil_cooler: 'Oil Cooler',
  turbocharger: 'Turbocharger',
  fuel_injector: 'Fuel Injector',
  cylinder_block: 'Cylinder Block',
  crankshaft: 'Crankshaft',
  dampener: 'Dampener',
  exhaust_manifold_spacer: 'Exhaust Manifold Spacer',
  piston_oiler: 'Piston Oiler',
  piston_oiler_bolt: 'Piston Oiler Bolt',
  rocker_shaft: 'Rocker Shaft',
  connecting_rod_bearing: 'Connecting Rod Bearing',
  spacer_plate: 'Spacer Plate',
  thermostat: 'Thermostat',
  thrust_washer: 'Thrust Washer',
  water_pump: 'Water Pump',
  flywheel: 'Flywheel',
  stud_kit: 'Stud Kit',
  main_bearing: 'Main Bearing (Shell Half)',
  cam_bearing: 'Cam Bearing (Bushing / Sleeve)',
  connecting_rod: 'Connecting Rod',
  miscellaneous: 'Miscellaneous',
}

export const STATUS_LABELS = {
  draft:               'Open',
  partially_complete:  'Partially Completed',
  complete:            'Complete',
  submitted:           'Complete',
  approved:            'Complete',
  rejected:            'Complete',
  pending_review:      'Pending Review',
}

export const STATUS_COLORS = {
  draft:               'bg-blue-100 text-blue-700 ring-1 ring-blue-300',
  partially_complete:  'bg-orange-100 text-orange-700 ring-1 ring-orange-300',
  complete:            'bg-pdi-green-light text-pdi-green ring-1 ring-green-300',
  submitted:           'bg-pdi-green-light text-pdi-green ring-1 ring-green-300',
  approved:            'bg-pdi-green-light text-pdi-green ring-1 ring-green-300',
  rejected:            'bg-pdi-red-light text-pdi-red ring-1 ring-red-300',
  pending_review:      'bg-amber-100 text-amber-700 ring-1 ring-amber-300',
}

// Disposition badge styling. PASS/ACCEPT = solid green + white text;
// FAIL/REJECT = solid red + white text; ACCEPTED/CONDITIONAL = solid amber.
// Keyed by the UPPERCASE disposition code — use normalizeDisposition() before
// lookup so lowercase legacy values ('pass'/'fail') resolve correctly.
export const DISPOSITION_COLORS = {
  ACCEPT:      'bg-green-600 text-white border-green-700',
  PASS:        'bg-green-600 text-white border-green-700',
  REJECT:      'bg-red-600 text-white border-red-700',
  FAIL:        'bg-red-600 text-white border-red-700',
  CONDITIONAL: 'bg-amber-500 text-white border-amber-600',
  ACCEPTED:    'bg-amber-500 text-white border-amber-600',
}

// Dispositions are ALWAYS displayed in uppercase.
export const DISPOSITION_LABELS = {
  PASS:        'PASS',
  FAIL:        'FAIL',
  ACCEPTED:    'ACCEPTED',
  ACCEPT:      'ACCEPT',
  REJECT:      'REJECT',
  CONDITIONAL: 'CONDITIONAL',
}

/**
 * Normalize any disposition value to its canonical UPPERCASE code.
 * Accepts legacy lowercase ('pass'/'fail'/'na') and returns '' for blanks.
 */
export function normalizeDisposition(value) {
  const v = String(value == null ? '' : value).trim().toUpperCase()
  if (v === 'NA' || v === 'N/A') return ''
  return v
}

/** Uppercase display label for a disposition (falls back to the code itself). */
export function dispositionLabel(value) {
  const code = normalizeDisposition(value)
  return DISPOSITION_LABELS[code] || code
}

/** Tailwind classes for a disposition badge (normalizes case first). */
export function dispositionColor(value) {
  const code = normalizeDisposition(value)
  return DISPOSITION_COLORS[code] || 'bg-gray-500 text-white border-gray-600'
}

export const ALERT_TYPE_LABELS = {
  accepted_disposition: 'Accepted Disposition',
  repeat_occurrence:    'Repeat Occurrence',
}

export const PFN_COLORS = {
  P: 'bg-green-100 text-green-700 border-green-300',
  F: 'bg-red-100 text-red-700 border-red-300',
  N: 'bg-gray-100 text-gray-500 border-gray-300',
  A: 'bg-amber-100 text-amber-700 border-amber-300',
}

export const HEADER_FIELD_LABELS = {
  part_number: 'Part Number',
  supplier: 'Supplier',
  po_number: 'PDI PO No.',
  date_received: 'Date Received',
  inspector_name: 'Inspector',
  lot_size: 'Lot Size',
  aql_level: 'AQL Level',
  sample_size: 'Sample Size',
  signature: 'Signature',
  description: 'Description',
  lot_serial_no: 'Lot / Serial No.',
}

export const NCR_SEVERITY_LABELS = { minor: 'Minor', major: 'Major', critical: 'Critical' }
export const NCR_SEVERITY_COLORS = {
  minor:    'bg-yellow-100 text-yellow-700 border-yellow-300',
  major:    'bg-orange-100 text-orange-700 border-orange-300',
  critical: 'bg-red-100 text-red-700 border-red-300',
}
export const NCR_STATUS_LABELS  = { open: 'Open', closed: 'Closed', in_progress: 'In Progress' }
export const NCR_DISPOSITION_LABELS = {
  accepted_as_is: 'Accepted As-Is',
  rework: 'Rework',
  return_to_supplier: 'Return to Supplier',
  scrap: 'Scrap',
  use_as_is: 'Use As-Is',
  other: 'Other',
}
export const NCR_STATUS_COLORS  = {
  open:        'bg-blue-100 text-blue-700 ring-1 ring-blue-300',
  in_progress: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300',
  closed:      'bg-gray-100 text-gray-500 ring-1 ring-gray-300',
}