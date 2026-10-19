/**
 * E-sign helpers shared by the editor, the envelope pages and the signing
 * page. No React here, so they can be unit-tested with node --test.
 *
 * Field geometry is always PDF user space (points, origin bottom-left) — the
 * same numbers the server stamps with. Screen rectangles come from a pdf.js
 * viewport, which also handles rotated pages.
 */

export const FIELD_TYPES = [
  { type: 'signature', label: 'Signature', w: 180, h: 36 },
  { type: 'initials',  label: 'Initials',  w: 60,  h: 30 },
  { type: 'date',      label: 'Date signed', w: 100, h: 18 },
  { type: 'name',      label: 'Name',      w: 170, h: 18 },
  { type: 'title',     label: 'Title',     w: 150, h: 18 },
  { type: 'company',   label: 'Company',   w: 180, h: 18 },
  { type: 'email',     label: 'E-mail',    w: 180, h: 18 },
  { type: 'text',      label: 'Text',      w: 160, h: 18 },
  { type: 'checkbox',  label: 'Checkbox',  w: 14,  h: 14 },
]

export const FIELD_META = Object.fromEntries(FIELD_TYPES.map((f) => [f.type, f]))

/** One color per recipient, in order. Tailwind can't build class names at runtime, so these are raw colors. */
export const RECIPIENT_COLORS = [
  { border: '#2563eb', fill: 'rgba(37, 99, 235, 0.10)', text: '#1d4ed8' },
  { border: '#d97706', fill: 'rgba(217, 119, 6, 0.10)', text: '#b45309' },
  { border: '#059669', fill: 'rgba(5, 150, 105, 0.10)', text: '#047857' },
  { border: '#7c3aed', fill: 'rgba(124, 58, 237, 0.10)', text: '#6d28d9' },
  { border: '#db2777', fill: 'rgba(219, 39, 119, 0.10)', text: '#be185d' },
  { border: '#0891b2', fill: 'rgba(8, 145, 178, 0.10)', text: '#0e7490' },
]
export const UNASSIGNED_COLOR = { border: '#9ca3af', fill: 'rgba(156, 163, 175, 0.12)', text: '#6b7280' }

export function recipientColor(index) {
  if (index === null || index === undefined || index < 0) return UNASSIGNED_COLOR
  return RECIPIENT_COLORS[index % RECIPIENT_COLORS.length]
}

export const ENVELOPE_STATUS = {
  draft:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-700 ring-1 ring-gray-300' },
  sent:      { label: 'Out for signature', cls: 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' },
  completed: { label: 'Completed', cls: 'bg-pdi-green-light text-pdi-green ring-1 ring-green-300' },
  declined:  { label: 'Declined',  cls: 'bg-pdi-red-light text-pdi-red ring-1 ring-red-300' },
  voided:    { label: 'Voided',    cls: 'bg-gray-100 text-gray-500 ring-1 ring-gray-300 line-through' },
  expired:   { label: 'Expired',   cls: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300' },
}

export const RECIPIENT_STATUS = {
  pending:  { label: 'Waiting',  cls: 'text-gray-500' },
  sent:     { label: 'Invited',  cls: 'text-blue-600' },
  viewed:   { label: 'Viewed',   cls: 'text-indigo-600' },
  signed:   { label: 'Signed',   cls: 'text-pdi-green' },
  declined: { label: 'Declined', cls: 'text-pdi-red' },
}

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/

export function isEmail(value) {
  return EMAIL_RE.test(String(value || '').trim())
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Screen rectangle {left, top, width, height} (CSS px within the page) for a
 * field, given a pdf.js viewport (anything with convertToViewportRectangle).
 */
export function fieldToScreen(field, viewport) {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
    field.x, field.y, field.x + field.width, field.y + field.height,
  ])
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/** The inverse: a screen rectangle back to a user-space field box. */
export function screenToField(rect, viewport) {
  const [ax, ay] = viewport.convertToPdfPoint(rect.left, rect.top)
  const [bx, by] = viewport.convertToPdfPoint(rect.left + rect.width, rect.top + rect.height)
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  }
}

/** Keep a field box inside the page's crop box ([left, bottom, right, top]). */
export function clampToPage(box, page) {
  const [l, b, r, t] = page.crop || [0, 0, page.width, page.height]
  const width = Math.min(Math.max(box.width, 6), r - l)
  const height = Math.min(Math.max(box.height, 6), t - b)
  const x = Math.min(Math.max(box.x, l), r - width)
  const y = Math.min(Math.max(box.y, b), t - height)
  return { x: round2(x), y: round2(y), width: round2(width), height: round2(height) }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Default box for a new field centered on a user-space point. On a rotated
 * page the box's user-space width/height swap so it looks right on screen.
 */
export function newFieldBox(type, center, page) {
  const meta = FIELD_META[type] || FIELD_META.text
  const sideways = page.rotation === 90 || page.rotation === 270
  const w = sideways ? meta.h : meta.w
  const h = sideways ? meta.w : meta.h
  return clampToPage({ x: center.x - w / 2, y: center.y - h / 2, width: w, height: h }, page)
}

// ── Assignment ───────────────────────────────────────────────────────────────

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Which recipient a detected field most likely belongs to:
 *   1. a {{sig:N}} tag's signer number (Nth recipient in signing order)
 *   2. a role hint from the label/field name ("supplier", "pdi") matching a
 *      recipient's role or name
 *   3. the only recipient, when there is just one
 * Returns a recipient id or null.
 */
export function guessRecipient(field, recipients) {
  if (!recipients.length) return null
  const ordered = [...recipients].sort((a, b) => (a.routing_order || 1) - (b.routing_order || 1))
  if (Number.isInteger(field.recipient_index) && field.recipient_index >= 1 && field.recipient_index <= ordered.length) {
    return ordered[field.recipient_index - 1].id
  }
  const hint = norm(field.role_hint)
  if (hint) {
    const match = recipients.find((r) => {
      const role = norm(r.role_label)
      const name = norm(r.name)
      return (role && (role === hint || role.includes(hint) || hint.includes(role)))
        || (name && name.split(' ').includes(hint))
    })
    if (match) return match.id
  }
  return recipients.length === 1 ? recipients[0].id : null
}

/** Assign every unassigned field we can; returns a new array. */
export function autoAssignFields(fields, recipients) {
  return fields.map((f) => (f.recipient_id ? f : { ...f, recipient_id: guessRecipient(f, recipients) }))
}

// ── Checks before sending ────────────────────────────────────────────────────

/** Human-readable problems that would stop the envelope from being sent. */
export function sendProblems(recipients, fields) {
  const problems = []
  if (!recipients.length) problems.push('Add at least one recipient.')
  recipients.forEach((r, i) => {
    if (!String(r.name || '').trim()) problems.push(`Recipient ${i + 1} needs a name.`)
    if (!isEmail(r.email)) problems.push(`Recipient ${i + 1} needs a valid e-mail address.`)
  })
  const emails = recipients.map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean)
  if (new Set(emails).size !== emails.length) problems.push('Each recipient needs a different e-mail address.')
  const unassigned = fields.filter((f) => !f.recipient_id).length
  if (unassigned) problems.push(`${unassigned} field${unassigned === 1 ? ' is' : 's are'} not assigned to anyone.`)
  for (const r of recipients) {
    if (!fields.some((f) => f.recipient_id === r.id && f.type === 'signature')) {
      problems.push(`${r.name || r.email || 'A recipient'} has no signature field.`)
    }
  }
  return problems
}

// ── Signing page ─────────────────────────────────────────────────────────────

/** Is this field filled enough to finish? (signature/initials need an adopted mark). */
export function fieldComplete(field, values, marks) {
  if (field.type === 'signature') return !!marks.signature
  if (field.type === 'initials') return !!marks.initials
  if (field.type === 'date') return true
  if (!field.required) return true
  const v = values[field.id]
  if (field.type === 'checkbox') return v === true
  return String(v ?? '').trim().length > 0
}

export function remainingFields(fields, values, marks) {
  return fields.filter((f) => !fieldComplete(f, values, marks))
}

/** Initials from a full name: "Mary Ann Smith" → "MAS". */
export function initialsOf(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('')
    .slice(0, 4)
}

/**
 * A download name every OS and browser accepts: accents folded, dashes and
 * quotes made plain, characters Windows forbids replaced. Some browser setups
 * ignore a non-ASCII download name entirely and save as "download".
 */
export function safeFilename(name, fallback = 'document.pdf') {
  const cleaned = String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trimStart()
  const ext = (cleaned.match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0]
  const stem = cleaned.slice(0, cleaned.length - ext.length).replace(/^[. ]+|[. ]+$/g, '')
  return /[A-Za-z0-9]/.test(stem) ? stem + ext : fallback
}
