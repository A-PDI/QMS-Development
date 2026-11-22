/**
 * Dimensional specifications and automatic Pass/Fail evaluation.
 *
 * This is the ONE implementation of the rules. The React client imports it
 * (client/src/lib/dimensional.js re-exports it) and the Express server loads it
 * with import() (server/services/dimensionalEvaluation.js), so the result an
 * inspector sees while typing is the result the server saves and completes.
 *
 * Contents
 *  - Exact decimal arithmetic: limits such as 25.000 - 0.050 are computed on
 *    scaled integers, never binary floats, so a reading exactly on a limit is
 *    always judged as being on it.
 *  - Specifications: a part spec value is either a structured object
 *      { type: 'tolerance', nominal, lower_tol, upper_tol, unit }
 *      { type: 'limits', min, max, unit }        (either limit may be blank)
 *      { type: 'text', text }                    (not evaluable)
 *    or a legacy free-text string ("45.00 ± 0.05", ".029-.031\"", "Max 0.002").
 *  - Inspection points: every dimensional point a form defines, with a stable
 *    key `${sectionKey}.${itemId}` that part specs are stored against.
 *  - Evaluation: measurement(s) against a spec, and whole sections / items /
 *    inspections with the status fields each section type stores.
 */

// ─── Exact decimal arithmetic ────────────────────────────────────────────────

const UNSIGNED = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
const SIGNED = `[+-]?${UNSIGNED}`
const NUMBER_RE = new RegExp(`^${SIGNED}$`)
const TEN = BigInt(10)
const ZERO = BigInt(0)

/** A decimal string as { units, scale } meaning units / 10^scale, or null. */
export function parseDecimal(raw) {
  const text = String(raw ?? '').trim()
  if (!NUMBER_RE.test(text)) return null
  const negative = text[0] === '-'
  const body = text.replace(/^[+-]/, '')
  const [whole, fraction = ''] = body.split('.')
  let units = BigInt(`${whole || '0'}${fraction}`)
  if (negative) units = -units
  return { units, scale: fraction.length }
}

function rescale(d, scale) {
  return d.units * TEN ** BigInt(scale - d.scale)
}

/** -1, 0 or 1 as a is below, equal to or above b. */
export function compareDecimal(a, b) {
  const scale = Math.max(a.scale, b.scale)
  const x = rescale(a, scale)
  const y = rescale(b, scale)
  if (x < y) return -1
  return x > y ? 1 : 0
}

function addDecimal(a, b) {
  const scale = Math.max(a.scale, b.scale)
  return { units: rescale(a, scale) + rescale(b, scale), scale }
}

function negateDecimal(d) {
  return { units: -d.units, scale: d.scale }
}

function absDecimal(d) {
  return d.units < ZERO ? negateDecimal(d) : d
}

/** Decimal as text with at least `scale` places (precision is never dropped). */
export function formatDecimal(d, scale = d.scale) {
  const places = Math.max(scale, d.scale)
  const units = rescale(d, places)
  const negative = units < ZERO
  let digits = (negative ? -units : units).toString()
  if (places > 0) {
    digits = digits.padStart(places + 1, '0')
    digits = `${digits.slice(0, -places)}.${digits.slice(-places)}`
  }
  return `${negative ? '-' : ''}${digits}`
}

function formatSigned(d, scale) {
  const text = formatDecimal(d, scale)
  return d.units < ZERO ? text : `+${text}`
}

// ─── Units ───────────────────────────────────────────────────────────────────

const UNIT_ALIASES = {
  '"': 'in', in: 'in', inch: 'in', inches: 'in',
  mm: 'mm',
  'µm': 'µm', 'μm': 'µm', um: 'µm', micron: 'µm', microns: 'µm',
  'µin': 'µin', 'μin': 'µin', uin: 'µin',
  deg: 'deg', '°': 'deg',
}

/** Units offered by the specification editor. */
export const SPEC_UNITS = ['in', 'mm', 'µm', 'µin', 'deg']

// A unit only counts when it directly follows a number (so "min" is not "in").
const UNIT_TAIL_RE = /^(.*?[\d.])\s*(inches|inch|in|mm|µm|μm|um|microns?|µin|μin|uin|deg|°)\.?$/i

/** Canonical unit name, or the trimmed text when it is not a known unit. */
export function normalizeUnit(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  return UNIT_ALIASES[text.toLowerCase()] || UNIT_ALIASES[text] || text.slice(0, 12)
}

/** Split a trailing unit off numeric text: { core, unit }. */
function splitUnit(text) {
  let core = String(text ?? '').trim()
  let unit = ''
  if (core.includes('"')) {
    unit = 'in'
    core = core.replace(/"/g, '').trim()
  }
  const m = core.match(UNIT_TAIL_RE)
  if (m) {
    core = m[1].trim()
    unit = normalizeUnit(m[2])
  }
  return { core, unit }
}

// ─── Measurements ────────────────────────────────────────────────────────────

/**
 * One entered measurement.
 *   { state: 'empty' }
 *   { state: 'valid', value }                         value is a decimal
 *   { state: 'invalid', reason: 'not_a_number' | 'unit_mismatch' }
 * A unit typed after the number is accepted when it matches the spec's unit.
 */
export function parseMeasurement(raw, specUnit = '') {
  const text = String(raw ?? '').trim()
  if (!text) return { state: 'empty' }
  const { core, unit } = splitUnit(text)
  const value = parseDecimal(core)
  if (!value) return { state: 'invalid', reason: 'not_a_number' }
  if (unit && specUnit && normalizeUnit(specUnit) !== unit) {
    return { state: 'invalid', reason: 'unit_mismatch' }
  }
  return { state: 'valid', value }
}

// ─── Specifications ──────────────────────────────────────────────────────────

export const SPEC_TYPES = ['tolerance', 'limits', 'text']

export const SPEC_ERROR_MESSAGES = {
  not_numeric: 'Not a numeric specification — Pass/Fail is selected manually.',
  incomplete_tolerance: 'Enter the nominal value and both tolerances (use 0 for none).',
  missing_limits: 'Enter a minimum, a maximum, or both.',
  invalid_number: 'Limits and tolerances must be numbers, e.g. 25.000 or -0.050.',
  min_gt_max: 'The lower limit is greater than the upper limit.',
}

/** True when a stored spec value carries nothing. */
export function isSpecEmpty(value) {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value !== 'object') return true
  return !['nominal', 'lower_tol', 'upper_tol', 'min', 'max', 'text']
    .some(field => String(value[field] ?? '').trim() !== '')
}

/** A tolerance: unsigned lower tolerances are below nominal, unsigned upper above. */
function signedTolerance(raw, defaultNegative) {
  const text = String(raw ?? '').replace(/\s+/g, '')
  if (!text) return { missing: true }
  const d = parseDecimal(text)
  if (!d) return { invalid: true }
  if (/^[+-]/.test(text)) return { value: d }
  return { value: defaultNegative ? negateDecimal(d) : d }
}

function fail(error, text) {
  return { evaluable: false, error, text: text || '' }
}

function unitSuffix(unit) {
  return unit ? ` ${unit}` : ''
}

/** Build the resolved form of a tolerance spec from decimals. */
function fromTolerance(nominal, lower, upper, unit, sourceText) {
  const scale = Math.max(nominal.scale, lower.scale, upper.scale)
  const min = addDecimal(nominal, lower)
  const max = addDecimal(nominal, upper)
  if (compareDecimal(min, max) > 0) return fail('min_gt_max', sourceText)
  const symmetric = compareDecimal(absDecimal(lower), upper) === 0 && lower.units <= ZERO
  const text = symmetric
    ? `${formatDecimal(nominal, scale)} ± ${formatDecimal(upper, scale)}${unitSuffix(unit)}`
    : `${formatDecimal(nominal, scale)} ${formatSigned(upper, scale)} / ${formatSigned(lower, scale)}${unitSuffix(unit)}`
  return finish({
    kind: 'tolerance', min, max, scale, unit, text,
    fields: {
      type: 'tolerance',
      nominal: formatDecimal(nominal, scale),
      lower_tol: formatSigned(lower, scale),
      upper_tol: formatSigned(upper, scale),
      unit,
    },
  })
}

/** Build the resolved form of a min/max spec (either limit may be null). */
function fromLimits(min, max, unit, sourceText) {
  if (!min && !max) return fail('missing_limits', sourceText)
  if (min && max && compareDecimal(min, max) > 0) return fail('min_gt_max', sourceText)
  const scale = Math.max(min ? min.scale : 0, max ? max.scale : 0)
  let text
  if (min && max) text = `${formatDecimal(min, scale)} to ${formatDecimal(max, scale)}${unitSuffix(unit)}`
  else if (min) text = `Min ${formatDecimal(min, scale)}${unitSuffix(unit)}`
  else text = `Max ${formatDecimal(max, scale)}${unitSuffix(unit)}`
  return finish({
    kind: 'limits', min, max, scale, unit, text,
    fields: {
      type: 'limits',
      min: min ? formatDecimal(min, scale) : '',
      max: max ? formatDecimal(max, scale) : '',
      unit,
    },
  })
}

function finish(spec) {
  const minText = spec.min ? formatDecimal(spec.min, spec.scale) : ''
  const maxText = spec.max ? formatDecimal(spec.max, spec.scale) : ''
  let rangeText
  if (spec.min && spec.max) rangeText = `${minText} to ${maxText}${unitSuffix(spec.unit)}`
  else if (spec.min) rangeText = `${minText}${unitSuffix(spec.unit)} or more`
  else rangeText = `${maxText}${unitSuffix(spec.unit)} or less`
  return { evaluable: true, error: null, ...spec, minText, maxText, rangeText }
}

/**
 * Parse a legacy free-text spec. Only unambiguous numeric forms are accepted;
 * anything else (words, several numbers, a bare nominal) returns null so the
 * point keeps manual Pass/Fail rather than being judged against a guess.
 */
export function parseSpecText(raw) {
  let text = String(raw ?? '')
    .replace(/−/g, '-')              // minus sign
    .replace(/[–—]/g, '-')      // en / em dash
    .replace(/\+\s*\/\s*-|\+-/g, '±')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  const { core, unit } = splitUnit(text)
  text = core

  const dec = s => parseDecimal(String(s).replace(/\s+/g, ''))
  let m

  // 25.000 ± 0.050
  if ((m = text.match(new RegExp(`^(${SIGNED})\\s*±\\s*(${UNSIGNED})$`)))) {
    const t = dec(m[2])
    return fromTolerance(dec(m[1]), negateDecimal(t), t, unit, raw)
  }
  // 25.000 +0.050/-0.020  (either order, both signs explicit)
  if ((m = text.match(new RegExp(`^(${SIGNED})\\s+([+-]\\s*${UNSIGNED})\\s*[/,]?\\s*([+-]\\s*${UNSIGNED})$`)))) {
    const a = dec(m[2])
    const b = dec(m[3])
    const [lower, upper] = compareDecimal(a, b) <= 0 ? [a, b] : [b, a]
    return fromTolerance(dec(m[1]), lower, upper, unit, raw)
  }
  // Min 0.029 / Max 0.031  ·  0.029 min - 0.031 max
  if ((m = text.match(new RegExp(`^min(?:imum)?\\.?:?\\s*(${SIGNED})\\s*[/,;]?\\s*max(?:imum)?\\.?:?\\s*(${SIGNED})$`, 'i')))
    || (m = text.match(new RegExp(`^(${SIGNED})\\s*min(?:imum)?\\.?\\s*[/,;-]?\\s*(${SIGNED})\\s*max(?:imum)?\\.?$`, 'i')))) {
    return fromLimits(dec(m[1]), dec(m[2]), unit, raw)
  }
  // 24.950 - 25.050  ·  24.950 to 25.050
  if ((m = text.match(new RegExp(`^(${SIGNED})\\s*(?:-|to)\\s*(${SIGNED})$`, 'i')))) {
    return fromLimits(dec(m[1]), dec(m[2]), unit, raw)
  }
  // Min 0.5 · 0.5 min · >= 0.5
  if ((m = text.match(new RegExp(`^(?:min(?:imum)?\\.?:?|>=|≥)\\s*(${SIGNED})$`, 'i')))
    || (m = text.match(new RegExp(`^(${SIGNED})\\s*min(?:imum)?\\.?$`, 'i')))) {
    return fromLimits(dec(m[1]), null, unit, raw)
  }
  // Max 0.002 · 0.002 max · <= 0.002
  if ((m = text.match(new RegExp(`^(?:max(?:imum)?\\.?:?|<=|≤)\\s*(${SIGNED})$`, 'i')))
    || (m = text.match(new RegExp(`^(${SIGNED})\\s*max(?:imum)?\\.?$`, 'i')))) {
    return fromLimits(null, dec(m[1]), unit, raw)
  }
  return null
}

/**
 * The usable form of a stored spec value, or null when there is no spec.
 * Evaluable specs carry { min, max } decimals (either may be null for a
 * one-sided limit), display text, the acceptable range and editor fields.
 * Non-evaluable specs carry { evaluable: false, error, text }.
 */
export function resolveSpec(value) {
  if (isSpecEmpty(value)) return null
  if (typeof value === 'string') {
    const text = value.trim()
    const parsed = parseSpecText(text)
    if (parsed) return parsed.evaluable ? parsed : { ...parsed, text }
    return fail('not_numeric', text)
  }
  const unit = normalizeUnit(value.unit)
  const type = SPEC_TYPES.includes(value.type)
    ? value.type
    : (String(value.nominal ?? '').trim() ? 'tolerance'
      : (String(value.min ?? '').trim() || String(value.max ?? '').trim()) ? 'limits' : 'text')

  if (type === 'text') return fail('not_numeric', String(value.text ?? '').trim())

  if (type === 'tolerance') {
    const nominalText = String(value.nominal ?? '').trim()
    const lower = signedTolerance(value.lower_tol, true)
    const upper = signedTolerance(value.upper_tol, false)
    if (!nominalText || lower.missing || upper.missing) {
      if (nominalText && !parseDecimal(nominalText)) return fail('invalid_number')
      return fail('incomplete_tolerance')
    }
    const nominal = parseDecimal(nominalText)
    if (!nominal || lower.invalid || upper.invalid) return fail('invalid_number')
    return fromTolerance(nominal, lower.value, upper.value, unit)
  }

  const minText = String(value.min ?? '').trim()
  const maxText = String(value.max ?? '').trim()
  const min = minText ? parseDecimal(minText) : null
  const max = maxText ? parseDecimal(maxText) : null
  if ((minText && !min) || (maxText && !max)) return fail('invalid_number')
  return fromLimits(min, max, unit)
}

/** Whether two stored spec values mean the same thing (same limits and unit). */
export function specsEqual(a, b) {
  const ra = resolveSpec(a)
  const rb = resolveSpec(b)
  if (!ra || !rb) return !ra && !rb
  if (ra.evaluable !== rb.evaluable) return false
  if (!ra.evaluable) return ra.text.trim().toLowerCase() === rb.text.trim().toLowerCase()
  const same = (x, y) => (!x && !y) || (!!x && !!y && compareDecimal(x, y) === 0)
  return same(ra.min, rb.min) && same(ra.max, rb.max) && (ra.unit || '') === (rb.unit || '')
}

/** Human-readable text for any stored spec value ('' when empty). */
export function specDisplayText(value) {
  const spec = resolveSpec(value)
  return spec ? spec.text : ''
}

/**
 * Clean one spec value for storage.
 * Returns { value } (null = nothing to store) or { error } when the admin
 * entered numeric fields that do not form a valid range.
 */
export function normalizeSpecValue(value) {
  if (isSpecEmpty(value)) return { value: null }
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length > 200) return { error: 'Specification text is longer than 200 characters.' }
    return { value: text }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return { error: 'Unrecognised specification value.' }
  const str = (v, max = 40) => String(v ?? '').trim().slice(0, max)
  const type = SPEC_TYPES.includes(value.type) ? value.type : null
  let cleaned
  if (type === 'text' || (!type && str(value.text, 200) && !str(value.nominal) && !str(value.min) && !str(value.max))) {
    const text = str(value.text, 200)
    return text ? { value: { type: 'text', text } } : { value: null }
  }
  if (type === 'tolerance' || (!type && str(value.nominal))) {
    cleaned = { type: 'tolerance', nominal: str(value.nominal), lower_tol: str(value.lower_tol), upper_tol: str(value.upper_tol), unit: normalizeUnit(value.unit) }
  } else {
    cleaned = { type: 'limits', min: str(value.min), max: str(value.max), unit: normalizeUnit(value.unit) }
  }
  const resolved = resolveSpec(cleaned)
  if (!resolved) return { value: null }
  if (!resolved.evaluable) return { error: SPEC_ERROR_MESSAGES[resolved.error] || 'Invalid specification.' }
  return { value: cleaned }
}

/**
 * Clean a whole spec_data object (point key → spec value) for storage.
 * Returns { data, errors: [{ key, message }] }.
 */
export function sanitizeSpecData(specData) {
  const data = {}
  const errors = []
  if (specData == null) return { data, errors }
  if (typeof specData !== 'object' || Array.isArray(specData)) {
    return { data, errors: [{ key: '', message: 'spec_data must be an object.' }] }
  }
  for (const [key, value] of Object.entries(specData)) {
    if (typeof key !== 'string' || !key.trim() || key.length > 120 || /[\u0000-\u001f]/.test(key)) {
      errors.push({ key, message: 'Invalid inspection point key.' })
      continue
    }
    const { value: cleaned, error } = normalizeSpecValue(value)
    if (error) errors.push({ key, message: error })
    else if (cleaned !== null) data[key] = cleaned
  }
  return { data, errors }
}

// ─── Inspection points ───────────────────────────────────────────────────────

/** Section types that carry dimensional measurement points. */
export const DIMENSIONAL_SECTION_TYPES = [
  'dimensional', 'general_measurements', 'groove_specs',
  'camshaft_bore', 'fire_ring_protrusion', 'valve_recession',
]

/** Stable key a part spec is stored against. */
export function pointKey(sectionKey, itemId) {
  return `${sectionKey}.${itemId}`
}

/** Fire Ring items that get a per-cylinder entry chart (older forms: Wire Protrusion). */
export function isGrooveEntryItem(item) {
  return item?.entry === true || (item?.entry === undefined && /wire protrusion/i.test(item?.measurement || ''))
}

/** Sections whose rows are filled from the injector test bench, never re-judged here. */
function isBenchSection(section) {
  return section?.layout === 'single_value'
}

/**
 * Every dimensional inspection point a set of form sections defines.
 * Returns { points, issues }: points in form order, each
 *   { key, sectionKey, sectionTitle, sectionType, itemId, label, location, defaultSpec }
 * and issues for items that cannot be addressed reliably (no id, or an id
 * used twice in one section — only the first is listed).
 */
export function listDimensionalPoints(sections) {
  const points = []
  const issues = []
  const seen = new Set()
  for (const [sectionKey, section] of Object.entries(sections || {})) {
    if (sectionKey.startsWith('__') || !section || typeof section !== 'object') continue
    const type = section.section_type
    if (!DIMENSIONAL_SECTION_TYPES.includes(type)) continue
    const base = { sectionKey, sectionTitle: section.title || sectionKey, sectionType: type }
    const add = (itemId, label, extra = {}) => {
      const key = pointKey(sectionKey, itemId)
      if (seen.has(key)) { issues.push({ ...base, itemId: String(itemId), label, reason: 'duplicate_id' }); return }
      seen.add(key)
      points.push({ ...base, key, itemId: String(itemId), label, location: '', defaultSpec: '', ...extra })
    }
    const items = Array.isArray(section.items) ? section.items : []
    switch (type) {
      case 'dimensional':
      case 'general_measurements':
      case 'groove_specs':
        for (const item of items) {
          if (!item || typeof item !== 'object') continue
          if (type === 'groove_specs' && !isGrooveEntryItem(item)) continue
          const label = String(item.measurement || item.name || '').trim() || `Item ${item.id ?? '?'}`
          if (item.id === undefined || item.id === null || String(item.id).trim() === '') {
            issues.push({ ...base, itemId: '', label, reason: 'missing_id' })
            continue
          }
          add(item.id, label, {
            location: item.location || '',
            defaultSpec: typeof item.spec === 'string' ? item.spec : '',
          })
        }
        break
      case 'camshaft_bore':
        add('0', 'Bore diameter (all bores)')
        break
      case 'fire_ring_protrusion':
        add('0', 'Fire ring protrusion (all cylinders)')
        break
      case 'valve_recession':
        add('intake', 'Intake valve recession')
        add('exhaust', 'Exhaust valve recession')
        break
      default:
        break
    }
  }
  return { points, issues }
}

/**
 * The spec in force for each point: the part number's own spec when one is
 * configured, otherwise a numeric default written on the form itself.
 * Returns { [pointKey]: resolvedSpec & { source: 'part' | 'form', point } }.
 */
export function buildSpecIndex(sections, partSpecData) {
  const index = {}
  const specData = partSpecData && typeof partSpecData === 'object' ? partSpecData : {}
  for (const point of listDimensionalPoints(sections).points) {
    const partValue = specData[point.key]
    let resolved = null
    let source = null
    if (!isSpecEmpty(partValue)) {
      resolved = resolveSpec(partValue)
      source = 'part'
    } else if (point.defaultSpec && point.defaultSpec.trim()) {
      resolved = resolveSpec(point.defaultSpec)
      source = 'form'
    }
    if (resolved) index[point.key] = { ...resolved, source, point }
  }
  return index
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

/**
 * Judge entered measurement(s) against a spec. Every entered value has to be
 * within the limits (limits inclusive) for a Pass.
 *   state 'manual'        — no evaluable spec: Pass/Fail stays the inspector's
 *   state 'not_evaluated' — nothing entered                         result ''
 *   state 'invalid'       — an entry is not a number / wrong unit    result ''
 *   state 'pass'                                                     result 'P'
 *   state 'fail'          — an entry is below min or above max       result 'F'
 */
export function evaluateMeasurements(spec, rawValues) {
  if (!spec || !spec.evaluable) return { state: 'manual', result: null, invalidIndexes: [], failingIndexes: [] }
  const parsed = (rawValues || []).map(v => parseMeasurement(v, spec.unit))
  const invalidIndexes = []
  const failingIndexes = []
  let entered = 0
  parsed.forEach((p, i) => {
    if (p.state === 'empty') return
    entered++
    if (p.state === 'invalid') { invalidIndexes.push(i); return }
    if ((spec.min && compareDecimal(p.value, spec.min) < 0) || (spec.max && compareDecimal(p.value, spec.max) > 0)) {
      failingIndexes.push(i)
    }
  })
  if (entered === 0) return { state: 'not_evaluated', result: '', invalidIndexes, failingIndexes }
  if (invalidIndexes.length) return { state: 'invalid', result: '', invalidIndexes, failingIndexes }
  if (failingIndexes.length) return { state: 'fail', result: 'F', invalidIndexes, failingIndexes }
  return { state: 'pass', result: 'P', invalidIndexes, failingIndexes }
}

/** One value against a spec: 'empty' | 'invalid' | 'within' | 'below' | 'above' | 'manual'. */
export function classifyMeasurement(spec, raw) {
  if (!spec || !spec.evaluable) return 'manual'
  const p = parseMeasurement(raw, spec.unit)
  if (p.state !== 'valid') return p.state
  if (spec.min && compareDecimal(p.value, spec.min) < 0) return 'below'
  if (spec.max && compareDecimal(p.value, spec.max) > 0) return 'above'
  return 'within'
}

/**
 * The status to store. An automatic Fail may be dispositioned Accepted ('A',
 * which still needs notes and a photo); an automatic Pass, or a point with no
 * usable reading, cannot be overridden.
 */
export function resolveStatus(evaluation, current) {
  if (!evaluation || evaluation.state === 'manual') return current
  if (evaluation.result === 'F') return current === 'A' ? 'A' : 'F'
  return evaluation.result
}

/** Status options an inspector may still pick for a point. */
export function allowedStatusOptions(evaluation, options = ['P', 'F', 'A']) {
  if (!evaluation || evaluation.state === 'manual') return options
  if (evaluation.state === 'pass') return options.filter(o => o === 'P')
  if (evaluation.state === 'fail') return options.filter(o => o === 'F' || o === 'A')
  return []
}

/** Short message for an evaluation state. */
export function evaluationMessage(evaluation) {
  switch (evaluation?.state) {
    case 'pass': return 'Within specification'
    case 'fail': return 'Out of specification'
    case 'invalid': return 'Enter a number, e.g. 25.000 (use a period for decimals)'
    case 'not_evaluated': return 'Not evaluated — no measurement entered'
    default: return ''
  }
}

// Row-based sections: which fields hold the measurement(s), status and spec text.
const ROW_SECTIONS = {
  dimensional: {
    status: 'status',
    spec: 'spec',
    values: (row, section) => (section.layout === 'single_value'
      ? [row.actual1]
      : [row.actual1, row.actual2, row.actual3]),
  },
  general_measurements: {
    status: 'result',
    spec: 'specification',
    values: row => [row.actual_value],
  },
}

const SINGLE_POINT_SECTIONS = {
  camshaft_bore: { values: data => data.bores },
  fire_ring_protrusion: { values: data => data.cylinders },
}

const sameValues = (a, b) => JSON.stringify((a || []).map(v => String(v ?? '').trim()))
  === JSON.stringify((b || []).map(v => String(v ?? '').trim()))

/** Measurement values of the row for a point, by section type. */
export function rowMeasurementValues(section, row) {
  const cfg = ROW_SECTIONS[section?.section_type]
  if (cfg) return cfg.values(row || {}, section)
  if (section?.section_type === 'groove_specs') return Array.isArray(row?.cylinders) ? row.cylinders : []
  return []
}

/** Evaluation of one valve recession cylinder against intake / exhaust specs. */
export function evaluateValveCylinder(cylinder, intakeSpec, exhaustSpec) {
  const cyl = cylinder || {}
  const intakeValues = [cyl.int1, cyl.int2]
  const exhaustValues = [cyl.exh1, cyl.exh2]
  const intake = intakeSpec?.evaluable ? evaluateMeasurements(intakeSpec, intakeValues) : null
  const exhaust = exhaustSpec?.evaluable ? evaluateMeasurements(exhaustSpec, exhaustValues) : null
  const manual = { state: 'manual', result: null, intake, exhaust }
  if (!intake && !exhaust) return manual
  if (intake?.state === 'invalid' || exhaust?.state === 'invalid') return { state: 'invalid', result: '', intake, exhaust }
  if (intake?.state === 'fail' || exhaust?.state === 'fail') return { state: 'fail', result: 'F', intake, exhaust }
  const entered = values => values.some(v => String(v ?? '').trim() !== '')
  // A reading on a side with no usable spec can't be judged automatically.
  if ((!intake && entered(intakeValues)) || (!exhaust && entered(exhaustValues))) return manual
  if (intake?.state === 'pass' || exhaust?.state === 'pass') return { state: 'pass', result: 'P', intake, exhaust }
  return { state: 'not_evaluated', result: '', intake, exhaust }
}

/**
 * Apply automatic evaluation to one section's saved answers.
 *
 * options.previous     — the section's answers as last stored
 * options.onlyChanged  — re-judge only points whose readings changed since
 *                        `previous` (used on closed inspections so recorded
 *                        results are never re-judged against a newer spec)
 *
 * Returns { data, changed, invalid: [{ key, label, detail }] }. Points with no
 * evaluable spec are left exactly as they are.
 */
export function evaluateSection(sectionKey, section, data, specIndex, options = {}) {
  const unchanged = { data, changed: false, invalid: [] }
  if (!section || isBenchSection(section) || data == null) return unchanged
  const type = section.section_type
  const { previous, onlyChanged = false } = options
  const invalid = []
  let changed = false

  const specFor = id => {
    const spec = specIndex?.[pointKey(sectionKey, id)]
    return spec && spec.evaluable ? spec : null
  }

  if (ROW_SECTIONS[type]) {
    if (!Array.isArray(data)) return unchanged
    const cfg = ROW_SECTIONS[type]
    const prevRows = Array.isArray(previous) ? previous : []
    const next = data.map(row => {
      if (!row || typeof row !== 'object') return row
      const spec = specFor(row.id)
      if (!spec) return row
      const values = cfg.values(row, section)
      if (onlyChanged) {
        const prev = prevRows.find(r => r && String(r.id) === String(row.id))
        if (prev && sameValues(cfg.values(prev, section), values)) return row
      }
      const ev = evaluateMeasurements(spec, values)
      if (ev.state === 'invalid') invalid.push({ key: pointKey(sectionKey, row.id), label: spec.point?.label || `#${row.id}` })
      const status = resolveStatus(ev, row[cfg.status] ?? '')
      if (status === row[cfg.status] && row[cfg.spec] === spec.text) return row
      changed = true
      return { ...row, [cfg.status]: status, [cfg.spec]: spec.text }
    })
    return { data: changed ? next : data, changed, invalid }
  }

  if (type === 'groove_specs') {
    if (!Array.isArray(data.measurements)) return unchanged
    const prevRows = Array.isArray(previous?.measurements) ? previous.measurements : []
    const measurements = data.measurements.map(m => {
      if (!m || typeof m !== 'object') return m
      const spec = specFor(m.id)
      if (!spec) return m
      const values = Array.isArray(m.cylinders) ? m.cylinders : []
      if (onlyChanged) {
        const prev = prevRows.find(r => r && String(r.id) === String(m.id))
        if (prev && sameValues(prev.cylinders, values)) return m
      }
      const ev = evaluateMeasurements(spec, values)
      if (ev.state === 'invalid') invalid.push({ key: pointKey(sectionKey, m.id), label: spec.point?.label || `#${m.id}` })
      const status = resolveStatus(ev, m.status ?? '')
      if (status === m.status && m.spec === spec.text) return m
      changed = true
      return { ...m, status, spec: spec.text }
    })
    return { data: changed ? { ...data, measurements } : data, changed, invalid }
  }

  if (SINGLE_POINT_SECTIONS[type]) {
    if (typeof data !== 'object') return unchanged
    const spec = specFor('0')
    if (!spec) return unchanged
    const values = SINGLE_POINT_SECTIONS[type].values(data) || []
    if (onlyChanged && previous && sameValues(SINGLE_POINT_SECTIONS[type].values(previous), values)) return unchanged
    const ev = evaluateMeasurements(spec, values)
    if (ev.state === 'invalid') invalid.push({ key: pointKey(sectionKey, '0'), label: spec.point?.label || sectionKey })
    const result = resolveStatus(ev, data.result ?? '')
    if (result === data.result && data.spec === spec.text) return { data, changed: false, invalid }
    return { data: { ...data, result, spec: spec.text }, changed: true, invalid }
  }

  if (type === 'valve_recession') {
    if (typeof data !== 'object' || !Array.isArray(data.cylinders)) return unchanged
    const intakeSpec = specFor('intake')
    const exhaustSpec = specFor('exhaust')
    if (!intakeSpec && !exhaustSpec) return unchanged
    const next = { ...data }
    const setLimit = (field, value) => { if (next[field] !== value) { next[field] = value; changed = true } }
    if (intakeSpec) { setLimit('intake_min', intakeSpec.minText); setLimit('intake_max', intakeSpec.maxText) }
    if (exhaustSpec) { setLimit('exhaust_min', exhaustSpec.minText); setLimit('exhaust_max', exhaustSpec.maxText) }
    const prevCyls = Array.isArray(previous?.cylinders) ? previous.cylinders : []
    const readings = c => [c?.int1, c?.int2, c?.exh1, c?.exh2]
    next.cylinders = data.cylinders.map((cyl, i) => {
      if (!cyl || typeof cyl !== 'object') return cyl
      if (onlyChanged && prevCyls[i] && sameValues(readings(prevCyls[i]), readings(cyl))) return cyl
      const ev = evaluateValveCylinder(cyl, intakeSpec, exhaustSpec)
      if (ev.state === 'invalid') invalid.push({ key: pointKey(sectionKey, 'cylinder'), label: `Cylinder ${i + 1}` })
      const result = resolveStatus(ev, cyl.result ?? '')
      if (result === cyl.result) return cyl
      changed = true
      return { ...cyl, result }
    })
    return { data: changed ? next : data, changed, invalid }
  }

  return unchanged
}

/**
 * Apply automatic evaluation to every dimensional section of one item.
 * Returns { item, changed, invalid }.
 */
export function evaluateItem(itemData, sections, specIndex, options = {}) {
  let item = itemData
  let changed = false
  const invalid = []
  if (!itemData || typeof itemData !== 'object') return { item, changed, invalid }
  for (const [key, section] of Object.entries(sections || {})) {
    if (key.startsWith('__') || !DIMENSIONAL_SECTION_TYPES.includes(section?.section_type)) continue
    if (itemData[key] === undefined) continue
    const result = evaluateSection(key, section, item[key], specIndex, {
      previous: options.previousItem ? options.previousItem[key] : undefined,
      onlyChanged: options.onlyChanged,
    })
    invalid.push(...result.invalid.map(entry => ({ ...entry, sectionKey: key, sectionTitle: section.title || key })))
    if (result.changed) {
      if (!changed) item = { ...item }
      item[key] = result.data
      changed = true
    }
  }
  return { item, changed, invalid }
}

/**
 * Apply automatic evaluation to a whole inspection's section_data.
 *
 *   templateSections — the inspection template's sections
 *   partSpecData     — the part number's spec_data (may be null)
 *   previous         — section_data as last stored (for onlyChanged)
 *   onlyChanged      — see evaluateSection
 *
 * The sections in force are the inspection's own (__admin_sections) when it
 * has them. Inspections generated from the injector test bench are returned
 * untouched. Returns { sectionData, changed, invalid: [{ itemIndex, ... }] }.
 */
export function evaluateSectionData(sectionData, { templateSections, partSpecData, previous, onlyChanged = false } = {}) {
  const none = { sectionData, changed: false, invalid: [] }
  if (!sectionData || typeof sectionData !== 'object' || sectionData.__injector_source) return none
  const sections = sectionData.__admin_sections && typeof sectionData.__admin_sections === 'object'
    ? sectionData.__admin_sections
    : (templateSections || {})
  const specIndex = buildSpecIndex(sections, partSpecData)
  if (Object.keys(specIndex).length === 0) return none

  const invalid = []
  if (Array.isArray(sectionData.__items)) {
    const prevItems = Array.isArray(previous?.__items) ? previous.__items : []
    let changed = false
    const items = sectionData.__items.map((it, itemIndex) => {
      const r = evaluateItem(it, sections, specIndex, { previousItem: prevItems[itemIndex], onlyChanged })
      invalid.push(...r.invalid.map(entry => ({ ...entry, itemIndex })))
      if (r.changed) changed = true
      return r.item
    })
    return { sectionData: changed ? { ...sectionData, __items: items } : sectionData, changed, invalid }
  }
  // Legacy single-item format: answers are top-level section keys.
  const r = evaluateItem(sectionData, sections, specIndex, { previousItem: previous, onlyChanged })
  return { sectionData: r.item, changed: r.changed, invalid: r.invalid.map(entry => ({ ...entry, itemIndex: 0 })) }
}
