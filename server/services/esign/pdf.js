'use strict';
/**
 * PDF work for e-sign: page geometry, the working copy signers see, stamping
 * filled fields, the certificate of completion, and the digital seal.
 *
 * Coordinates are PDF user-space points (origin bottom-left), the same space
 * the detector and pdf.js report. Rotated pages are handled: a field's box is
 * stored in user space and its content is drawn rotated with the page, so it
 * reads upright on screen.
 */

const fs = require('fs');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');
const signpdf = require('@signpdf/signpdf').default;
const { P12Signer } = require('@signpdf/signer-p12');
const config = require('./config');

const NAVY = rgb(0x1d / 255, 0x2b / 255, 0x4f / 255);
const INK = rgb(0.1, 0.12, 0.2);
const GREY = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const FIELD_INK = rgb(0.05, 0.1, 0.35);

class PdfError extends Error {
  constructor(message, code = 'BAD_PDF') {
    super(message);
    this.code = code;
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function loadPdf(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(err.message)) {
      throw new PdfError('The PDF is password-protected. Remove the password and upload it again.', 'ENCRYPTED_PDF');
    }
    throw new PdfError('The file could not be read as a PDF.', 'BAD_PDF');
  }
}

function normalizeRotation(angle) {
  const r = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return r;
}

/** Page sizes, crop boxes and rotation — what the editor needs to lay fields out. */
async function inspectPdf(bytes) {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  if (pages.length === 0) throw new PdfError('The PDF has no pages.', 'BAD_PDF');
  return pages.map((page, index) => {
    const crop = page.getCropBox();
    return {
      index,
      width: round2(crop.width),
      height: round2(crop.height),
      rotation: normalizeRotation(page.getRotation().angle),
      crop: [round2(crop.x), round2(crop.y), round2(crop.x + crop.width), round2(crop.y + crop.height)],
    };
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * The copy signers see and fields are stamped onto. Any fillable form fields
 * in the original are flattened so a signer's PDF viewer cannot edit them
 * outside the signing flow.
 */
async function prepareWorkingCopy(bytes) {
  const doc = await loadPdf(bytes);
  try {
    const form = doc.getForm();
    if (form.hasXFA()) form.deleteXFA();
    if (form.getFields().length > 0) form.flatten();
  } catch (err) {
    // A malformed form should not stop the envelope; the fields stay as-is.
    console.warn('[esign] Could not flatten form fields:', err.message);
  }
  return Buffer.from(await doc.save());
}

// ── Text helpers ─────────────────────────────────────────────────────────────

const glyphCache = new WeakMap();

/** Replace characters the standard (WinAnsi) font cannot encode. */
function safeText(font, text) {
  let cache = glyphCache.get(font);
  if (!cache) { cache = new Map(); glyphCache.set(font, cache); }
  let out = '';
  for (const ch of String(text ?? '').replace(/[\r\n\t]+/g, ' ')) {
    if (!cache.has(ch)) {
      try { font.encodeText(ch); cache.set(ch, true); } catch (_) { cache.set(ch, false); }
    }
    out += cache.get(ch) ? ch : '?';
  }
  return out;
}

function fitText(font, text, maxWidth, size, minSize = 5) {
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  if (font.widthOfTextAtSize(text, s) <= maxWidth) return { text, size: s };
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', s) > maxWidth) t = t.slice(0, -1);
  return { text: t + '…', size: s };
}

function wrapText(font, text, size, maxWidth) {
  const lines = [];
  for (const para of String(text ?? '').split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
      } else {
        if (line) lines.push(line);
        // A single word wider than the column is hard-broken.
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

function formatDateOnly(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

function formatDateTime(value, timeZone) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'short', day: '2-digit',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }).format(d);
}

// ── Stamping ─────────────────────────────────────────────────────────────────

/**
 * Map a point in a field's upright "display" frame (px to the right, py up,
 * origin at the field's bottom-left as seen on screen) to user space.
 */
function displayFrame(field, rotation) {
  const { x, y, width: w, height: h } = field;
  switch (rotation) {
    case 90:  return { dispW: h, dispH: w, toUser: (px, py) => [x + w - py, y + px] };
    case 180: return { dispW: w, dispH: h, toUser: (px, py) => [x + w - px, y + h - py] };
    case 270: return { dispW: h, dispH: w, toUser: (px, py) => [x + py, y + h - px] };
    default:  return { dispW: w, dispH: h, toUser: (px, py) => [x + px, y + py] };
  }
}

function drawFieldText(page, font, field, rotation, text) {
  const { dispW, dispH, toUser } = displayFrame(field, rotation);
  const clean = safeText(font, text);
  if (!clean) return;
  const fitted = fitText(font, clean, Math.max(dispW - 4, 4), Math.min(11, Math.max(dispH * 0.72, 5)));
  const baseline = Math.max((dispH - fitted.size) / 2 + fitted.size * 0.22, 1);
  const [ux, uy] = toUser(2, baseline);
  page.drawText(fitted.text, { x: ux, y: uy, size: fitted.size, font, color: FIELD_INK, rotate: degrees(rotation) });
}

function drawFieldImage(page, image, field, rotation) {
  const { dispW, dispH, toUser } = displayFrame(field, rotation);
  const pad = 2;
  const scale = Math.min((dispW - pad * 2) / image.width, (dispH - pad * 2) / image.height);
  if (!(scale > 0)) return;
  const iw = image.width * scale;
  const ih = image.height * scale;
  const [ux, uy] = toUser(pad, (dispH - ih) / 2);
  page.drawImage(image, { x: ux, y: uy, width: iw, height: ih, rotate: degrees(rotation) });
}

function drawCheck(page, field, rotation) {
  const { dispW, dispH, toUser } = displayFrame(field, rotation);
  const s = Math.min(dispW, dispH);
  const ox = (dispW - s) / 2;
  const oy = (dispH - s) / 2;
  const pts = [[0.18, 0.52], [0.42, 0.24], [0.84, 0.8]].map(([a, b]) => toUser(ox + a * s, oy + b * s));
  const thickness = Math.max(s * 0.12, 1);
  page.drawLine({ start: { x: pts[0][0], y: pts[0][1] }, end: { x: pts[1][0], y: pts[1][1] }, thickness, color: FIELD_INK });
  page.drawLine({ start: { x: pts[1][0], y: pts[1][1] }, end: { x: pts[2][0], y: pts[2][1] }, thickness, color: FIELD_INK });
}

/**
 * Draw filled fields onto the PDF.
 *
 * @param {Buffer} bytes            the working PDF
 * @param {Array}  fields           { page, x, y, width, height, type, value, recipient_id }
 * @param {Object} images           recipientId → { signature?: Buffer(PNG), initials?: Buffer(PNG) }
 */
async function stampFields(bytes, fields, images = {}) {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const embedded = new Map();

  async function png(buffer) {
    if (!embedded.has(buffer)) embedded.set(buffer, await doc.embedPng(buffer));
    return embedded.get(buffer);
  }

  for (const field of fields) {
    const page = pages[field.page];
    if (!page) continue;
    const rotation = normalizeRotation(page.getRotation().angle);
    const assets = images[field.recipient_id] || {};
    if (field.type === 'signature' || field.type === 'initials') {
      const buffer = field.type === 'signature' ? assets.signature : assets.initials;
      if (buffer) drawFieldImage(page, await png(buffer), field, rotation);
    } else if (field.type === 'checkbox') {
      if (field.value === 'true') drawCheck(page, field, rotation);
    } else if (field.value) {
      drawFieldText(page, font, field, rotation, field.value);
    }
  }
  return Buffer.from(await doc.save());
}

// ── Certificate of completion ────────────────────────────────────────────────

const EVENT_LABELS = {
  created: 'Envelope created',
  sent: 'Sent for signature',
  invited: 'Signing invitation sent',
  resent: 'Signing invitation re-sent',
  viewed: 'Document viewed',
  consented: 'Agreed to sign electronically',
  signed: 'Signed',
  declined: 'Declined to sign',
  completed: 'All parties signed',
  voided: 'Voided',
  sealed: 'Document sealed',
  email_failed: 'E-mail delivery failed',
};

async function appendCertificate(doc, data) {
  const tz = config.timeZone();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 54;
  const created = [];
  let page;
  let y;

  const t = (s) => safeText(font, s);

  function newPage() {
    page = doc.addPage([W, H]);
    created.push(page);
    page.drawRectangle({ x: 0, y: H - 64, width: W, height: 64, color: NAVY });
    page.drawText('CERTIFICATE OF COMPLETION', { x: M, y: H - 38, size: 16, font: bold, color: rgb(1, 1, 1) });
    page.drawText(t(`${data.sealName} · e-Sign`), { x: M, y: H - 54, size: 8.5, font, color: rgb(0.8, 0.84, 0.9) });
    y = H - 92;
  }

  function ensure(space) {
    if (y - space < 64) newPage();
  }

  function heading(text) {
    ensure(36);
    y -= 6;
    page.drawText(t(text).toUpperCase(), { x: M, y, size: 9.5, font: bold, color: NAVY });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.75, color: RULE });
    y -= 14;
  }

  function row(label, value, opts = {}) {
    const labelW = opts.labelW || 130;
    const lines = wrapText(font, t(value ?? '—'), 9, W - M * 2 - labelW);
    ensure(lines.length * 12 + 2);
    page.drawText(t(label), { x: M, y, size: 9, font: bold, color: GREY });
    for (const line of lines) {
      page.drawText(line, { x: M + labelW, y, size: 9, font, color: INK });
      y -= 12;
    }
    y -= 1;
  }

  newPage();

  heading('Envelope');
  row('Document', data.title);
  row('Original file', data.originalName);
  row('Envelope ID', data.envelopeId);
  row('Original SHA-256', data.originalSha256);
  row('Pages', String(data.pageCount));
  row('Sender', `${data.senderName || '—'}${data.senderEmail ? ` <${data.senderEmail}>` : ''}`);
  row('Sent', formatDateTime(data.sentAt, tz));
  row('Completed', formatDateTime(data.completedAt, tz));
  row('Signing order', data.routing === 'parallel' ? 'All signers at once' : 'One after another');

  heading('Signers');
  for (const r of data.recipients) {
    const sigBox = 46;
    ensure(150);
    page.drawText(t(r.name), { x: M, y, size: 11, font: bold, color: INK });
    page.drawText(t(`<${r.email}>${r.role_label ? `  ·  ${r.role_label}` : ''}`), {
      x: M + bold.widthOfTextAtSize(t(r.name), 11) + 8, y, size: 9, font, color: GREY,
    });
    y -= 16;
    if (r.signatureImage) {
      try {
        const img = await doc.embedPng(r.signatureImage);
        const scale = Math.min(200 / img.width, sigBox / img.height);
        page.drawRectangle({ x: W - M - 214, y: y - sigBox - 4, width: 214, height: sigBox + 10, borderColor: RULE, borderWidth: 0.75 });
        page.drawImage(img, { x: W - M - 207, y: y - sigBox, width: img.width * scale, height: img.height * scale });
      } catch (err) {
        console.warn('[esign] Could not embed signature on certificate:', err.message);
      }
    }
    const labelW = 96;
    const col = (label, value) => {
      const lines = wrapText(font, t(value ?? '—'), 8.5, W - M * 2 - labelW - 224);
      ensure(lines.length * 11);
      page.drawText(t(label), { x: M, y, size: 8.5, font: bold, color: GREY });
      for (const line of lines) {
        page.drawText(line, { x: M + labelW, y, size: 8.5, font, color: INK });
        y -= 11;
      }
    };
    col('Status', r.status === 'signed' ? 'Signed' : r.status);
    col('Authentication', r.auth_method === 'account' ? 'Microsoft account sign-in + e-mail link' : 'E-mail link (unique, single-recipient)');
    col('Signature', r.signature_method === 'typed'
      ? `Typed: "${r.signature_text || ''}"`
      : r.signature_method === 'drawn' ? 'Drawn by hand' : '—');
    col('Viewed', formatDateTime(r.viewed_at, tz));
    col('Consented', formatDateTime(r.consented_at, tz));
    col('Signed', formatDateTime(r.signed_at, tz));
    col('IP address', r.signer_ip || '—');
    col('Device', r.signer_user_agent ? String(r.signer_user_agent).slice(0, 140) : '—');
    y -= 10;
  }

  heading('History');
  for (const e of data.audit) {
    const label = EVENT_LABELS[e.event] || e.event;
    const who = e.actor ? ` — ${e.actor}` : '';
    const ip = e.ip ? ` (IP ${e.ip})` : '';
    row(formatDateTime(e.created_at, tz), `${label}${who}${ip}${e.summary ? `: ${e.summary}` : ''}`, { labelW: 180 });
  }

  heading('Notice');
  for (const line of wrapText(font, t(
    'Each signer received a unique link and agreed to use an electronic signature before signing. ' +
    'The signed document, including this certificate, is sealed with a digital signature; any change ' +
    'made after sealing invalidates the seal when the file is opened in a PDF reader that checks signatures.'
  ), 8.5, W - M * 2)) {
    ensure(11);
    page.drawText(line, { x: M, y, size: 8.5, font, color: GREY });
    y -= 11;
  }

  created.forEach((p, i) => {
    p.drawText(t(`Envelope ${data.envelopeId}  ·  Certificate page ${i + 1} of ${created.length}`), {
      x: M, y: 30, size: 7.5, font, color: GREY,
    });
  });
}

// ── Sealing ──────────────────────────────────────────────────────────────────

let p12Cache = null;

/**
 * A signer for the configured sealing certificate, or null when none is set up.
 *
 * A new P12Signer is made for every document: it keeps the .p12 in a
 * node-forge buffer that its sign() reads to the end, so an instance can only
 * sign once. The file bytes are cached instead.
 */
function loadSigner() {
  const p12Path = config.p12Path();
  if (!p12Path) return null;
  let stat;
  try {
    stat = fs.statSync(p12Path);
  } catch (err) {
    throw new PdfError(`ESIGN_P12_PATH does not exist: ${p12Path}`, 'SEAL_CONFIG');
  }
  const key = `${p12Path}|${stat.mtimeMs}|${stat.size}`;
  if (!p12Cache || p12Cache.key !== key) {
    p12Cache = { key, bytes: fs.readFileSync(p12Path) };
  }
  return new P12Signer(p12Cache.bytes, { passphrase: config.p12Passphrase() });
}

/**
 * Append the certificate of completion and seal the document.
 * Returns { bytes, sealed } — sealed is false when no certificate is set up.
 */
async function finalizeDocument(workingBytes, certificateData) {
  const doc = await loadPdf(workingBytes);
  await appendCertificate(doc, { ...certificateData, sealName: config.sealName() });

  const signer = loadSigner();
  if (!signer) {
    return { bytes: Buffer.from(await doc.save()), sealed: false };
  }
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: `Signed by all parties via ${config.sealName()} e-Sign`,
    contactInfo: config.sealContact() || certificateData.senderEmail || '',
    name: config.sealName(),
    location: config.sealLocation(),
  });
  const unsigned = Buffer.from(await doc.save());
  try {
    const signed = await signpdf.sign(unsigned, signer);
    return { bytes: Buffer.from(signed), sealed: true };
  } catch (err) {
    throw new PdfError(`Sealing failed: ${err.message}`, 'SEAL_FAILED');
  }
}

module.exports = {
  PdfError,
  sha256,
  inspectPdf,
  prepareWorkingCopy,
  stampFields,
  finalizeDocument,
  formatDateOnly,
  formatDateTime,
  // exported for tests
  safeText,
  displayFrame,
  normalizeRotation,
};
