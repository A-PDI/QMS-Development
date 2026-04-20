export const COMPONENT_TYPE_LABELS = {
  piston: 'Piston',
  cylinder_liner: 'Cylinder Liner',
  piston_pin: 'Piston Pin',
  piston_ring: 'Piston Ring',
  cylinder_head: 'Cylinder Head',
}

export const STATUS_LABELS = {
  draft:    'Open',
  complete: 'Complete',
  submitted: 'Complete',
  approved:  'Complete',
  rejected:  'Complete',
}

export const STATUS_COLORS = {
  draft:     'bg-blue-100 text-blue-700 ring-1 ring-blue-300',
  complete:  'bg-pdi-green-light text-pdi-green ring-1 ring-green-300',
  submitted: 'bg-pdi-green-light text-pdi-green ring-1 ring-green-300',
  approved:  'bg-pdi-green-light text-pdi-green ring-1 ring-green-300',
  rejected:  'bg-pdi-red-light text-pdi-red ring-1 ring-red-300',
}

export const DISPOSITION_COLORS = {
  ACCEPT:      'bg-pdi-green-light text-pdi-green border-green-400',
  PASS:        'bg-pdi-green-light text-pdi-green border-green-400',
  REJECT:      'bg-pdi-red-light text-pdi-red border-red-400',
  FAIL:        'bg-pdi-red-light text-pdi-red border-red-400',
  CONDITIONAL: 'bg-pdi-amber-light text-pdi-amber border-pdi-amber',
  ACCEPTED:    'bg-amber-100 text-amber-700 border-amber-400',
}

export const DISPOSITION_LABELS = {
  PASS:        'Pass',
  FAIL:        'Fail',
  ACCEPTED:    'Accepted',
  ACCEPT:      'Accept',
  REJECT:      'Reject',
  CONDITIONAL: 'Conditional',
}

export const ALERT_TYPE_LABELS = {
  accepted_disposition: 'Accepted Disposition',
  repeat_occurrence:    'Repeat Occurrence',
}

export const PFN_COLORS = {
  P: 'bg-green-100 text-green-700 border-green-300',
  F: 'bg-red-100 text-red-700 border-red-300',
  N: 'bg-gray-100 text-gray-500 border-gray-300',
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

export const NCR_STATUS_LABELS = { open: 'Open', pending_supplier: 'Pending Supplier', closed: 'Closed' }
export const NCR_STATUS_COLORS = {
  open:             'bg-red-100 text-red-700 border-red-300',
  pending_supplier: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  closed:           'bg-gray-100 text-gray-500 border-gray-300',
}

export const NCR_DISPOSITION_LABELS = {
  pending:              'Pending',
  use_as_is:            'Use As-Is',
  rework:               'Rework',
  return_to_supplier:   'Return to Supplier',
  scrap:                'Scrap',
}
