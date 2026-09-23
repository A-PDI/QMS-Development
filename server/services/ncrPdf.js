'use strict';
/**
 * Non-Conformance Report PDF (Letter portrait).
 *
 * Page order mirrors the NCR editor and the on-screen report so what the user
 * builds is what prints:
 *   banner → status summary → NCR details → description of defect →
 *   Photos → user sections (title, text, captioned photos) → page footers.
 *
 * Shares the inspection report's primitives and palette (services/pdf.js).
 */

const fs = require('fs');
const PDFDocument = require('pdfkit');
const {
  renderSectionTitle,
  ensureSpace,
  vspace,
  put,
  PORTRAIT: { M, PW, PH },
  PALETTE: { NAVY, RED, GREEN, AMBER, BLACK, DGRAY, MGRAY, LGRAY, BORDER, ROWALT, WHITE },
  LOGO_PATH,
} = require('./pdf');

const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', closed: 'Closed' };
const SEVERITY_LABELS = { minor: 'Minor', major: 'Major', critical: 'Critical' };
const DISPOSITION_LABELS = {
  pending: 'Pending',
  accepted_as_is: 'Accepted As-Is',
  rework: 'Rework',
  return_to_supplier: 'Return to Supplier',
  scrap: 'Scrap',
  use_as_is: 'Use As-Is',
  other: 'Other',
};
const STATUS_COLORS = { open: NAVY, in_progress: AMBER, closed: GREEN };
const SEVERITY_COLORS = { minor: '#A16207', major: AMBER, critical: RED };

// ── Text safety ──────────────────────────────────────────────────────────────
// The standard Helvetica fonts only carry the WinAnsi character set; pdfkit
// writes anything else as a raw code that prints as garbage. Swap the symbols
// inspectors commonly type for readable equivalents and mark the rest with '?'.
const WIN_ANSI_EXTRA = new Set([
  338, 339, 352, 353, 376, 381, 382, 402, 710, 732, 8211, 8212, 8216, 8217, 8218,
  8220, 8221, 8222, 8224, 8225, 8226, 8230, 8240, 8249, 8250, 8364, 8482,
]);
const SYMBOL_SWAPS = {
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '−': '-', '′': "'", '″': '"',
  '→': '->', '←': '<-', '⇒': '=>', '⌀': 'Ø', 'Δ': 'delta ', 'Ω': 'ohm',
  '✓': 'OK', '✔': 'OK', '☑': 'OK', '✗': 'X', '✘': 'X', '☒': 'X',
};

function pdfSafe(value) {
  const text = String(value == null ? '' : value)
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ');
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 10 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(code)) {
      out += ch;
    } else if (SYMBOL_SWAPS[ch]) {
      out += SYMBOL_SWAPS[ch];
    } else if (code >= 0x20) {
      out += '?';
    }
  }
  return out;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "2026-03-04" → 03/04/2026 as written; timestamps → local MM/DD/YYYY. */
function fmtDate(value) {
  if (!value) return '';
  const s = String(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) return `${dateOnly[2]}/${dateOnly[3]}/${dateOnly[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

function labelFor(map, value) {
  if (!value) return '—';
  return map[value] || String(value).replace(/_/g, ' ');
}

function display(value) {
  return value === null || value === undefined || String(value).trim() === '' ? '—' : pdfSafe(value);
}

function sanitizeFilenamePart(value) {
  return String(value ?? '').trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
}

/** Download name: NCR-0001_<Part#>.pdf (part omitted when blank). */
function ncrPdfFilename(ncr = {}) {
  const number = sanitizeFilenamePart(ncr.ncr_number) || 'NCR';
  const part = sanitizeFilenamePart(ncr.part_number);
  return `${number}${part ? `_${part}` : ''}.pdf`;
}

// ── Page components ──────────────────────────────────────────────────────────

function renderBanner(doc, ncr) {
  const bannerH = 56;
  const top = M - 10;
  doc.rect(M, top, PW, bannerH).fillColor(NAVY).fill();

  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M + 10, top + 12, { height: 26, fit: [80, 26] }); } catch (_) { /* never fail a report over the logo */ }
  }

  const titleX = M + 100;
  const titleW = PW - 110;
  doc.fontSize(13).font('Helvetica-Bold').fillColor(WHITE);
  put(doc, 'NON-CONFORMANCE REPORT', titleX, top + 10, { width: titleW, align: 'center', lineBreak: false }, top + 26);

  const sub = [ncr.ncr_number, ncr.part_number ? `Part ${ncr.part_number}` : null].filter(Boolean).join('  ·  ');
  doc.fontSize(8).font('Helvetica').fillColor('#A5B4C8');
  put(doc, pdfSafe(sub).toUpperCase(), titleX, top + 30, { width: titleW, align: 'center', lineBreak: false }, top + bannerH + 12);
}

/** Four-cell strip: Status · Severity · Disposition · Corrective Action. */
function renderSummaryStrip(doc, ncr) {
  const caRequired = !!Number(ncr.corrective_action_required);
  const cells = [
    ['Status', labelFor(STATUS_LABELS, ncr.status), STATUS_COLORS[ncr.status] || BLACK],
    ['Severity', labelFor(SEVERITY_LABELS, ncr.severity), SEVERITY_COLORS[ncr.severity] || BLACK],
    ['Disposition', labelFor(DISPOSITION_LABELS, ncr.ncr_disposition), BLACK],
    ['Corrective Action',
      caRequired ? (ncr.corrective_action_due_date ? `Due ${fmtDate(ncr.corrective_action_due_date)}` : 'Required') : 'Not required',
      caRequired ? RED : DGRAY],
  ];
  const h = 34;
  const y = doc.y;
  const w = PW / cells.length;
  doc.rect(M, y, PW, h).strokeColor(BORDER).lineWidth(0.5).stroke();
  cells.forEach(([label, value, color], i) => {
    const x = M + i * w;
    if (i > 0) doc.strokeColor(BORDER).lineWidth(0.3).moveTo(x, y).lineTo(x, y + h).stroke();
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(MGRAY);
    put(doc, label.toUpperCase(), x + 6, y + 6, { width: w - 12, lineBreak: false }, y);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(color);
    put(doc, pdfSafe(value), x + 6, y + 17, { width: w - 12, lineBreak: false, ellipsis: true }, y);
  });
  doc.y = y + h + 10;
}

/** Two-column label/value grid; rows grow to fit wrapped values. */
function renderDetailsGrid(doc, pairs) {
  const colW = PW / 2;
  const labelW = 88;
  const valueW = colW - labelW - 10;
  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) rows.push(pairs.slice(i, i + 2));

  doc.fontSize(9).font('Helvetica');
  const rowHeights = rows.map((row) => Math.max(18, ...row.map(([, v]) => doc.heightOfString(v, { width: valueW }) + 7)));
  const total = rowHeights.reduce((a, b) => a + b, 0);
  ensureSpace(doc, total);

  const startY = doc.y;
  let y = startY;
  rows.forEach((row, r) => {
    const rh = rowHeights[r];
    if (r % 2 === 1) doc.rect(M, y, PW, rh).fillColor(ROWALT).fill();
    if (r > 0) doc.strokeColor(BORDER).lineWidth(0.3).moveTo(M, y).lineTo(M + PW, y).stroke();
    row.forEach(([label, value], c) => {
      const x = M + c * colW;
      doc.fontSize(7).font('Helvetica-Bold').fillColor(MGRAY);
      put(doc, label.toUpperCase(), x + 5, y + 5, { width: labelW - 5, lineBreak: false }, startY);
      doc.fontSize(9).font('Helvetica').fillColor(BLACK);
      put(doc, value, x + labelW, y + 4, { width: valueW }, startY);
    });
    y += rh;
  });
  doc.rect(M, startY, PW, total).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.strokeColor(BORDER).lineWidth(0.3).moveTo(M + colW, startY).lineTo(M + colW, startY + total).stroke();
  doc.y = startY + total + 12;
}

/** Free text under a section title. Long text flows onto following pages. */
function renderBodyText(doc, text, emptyLabel) {
  const safe = pdfSafe(text).trim();
  if (!safe) {
    if (!emptyLabel) return;
    doc.fontSize(9).font('Helvetica-Oblique').fillColor(LGRAY).text(emptyLabel, M + 4, doc.y, { width: PW - 8 });
  } else {
    doc.fontSize(9.5).font('Helvetica').fillColor(BLACK).text(safe, M + 4, doc.y, { width: PW - 8, lineGap: 2 });
  }
  vspace(doc, 8);
}

/** Natural display size of a stored photo (EXIF-rotated), or null if unreadable. */
function measureImage(doc, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const img = doc.openImage(filePath);
    const rotated = img.orientation > 4; // EXIF 5–8 swap width and height
    return { width: rotated ? img.height : img.width, height: rotated ? img.width : img.height };
  } catch (err) {
    console.error(`[NCR PDF] Could not read image ${filePath}:`, err.message);
    return null;
  }
}

function fitWithin(size, boxW, boxH) {
  const scale = Math.min(boxW / size.width, boxH / size.height);
  return { w: size.width * scale, h: size.height * scale };
}

/**
 * Photos with numbered captions. One photo is shown large and centred; more
 * are laid out two per row. An image and its caption never split across a
 * page; when a row moves to a new page the section title is repeated.
 */
function renderCaptionedImages(doc, images, figure, sectionTitle) {
  if (!images.length) return;
  const cols = images.length === 1 ? 1 : 2;
  const gap = 14;
  const cellW = cols === 1 ? PW : (PW - gap) / 2;
  const boxW = cols === 1 ? Math.min(PW, 420) : cellW;
  const boxH = cols === 1 ? 300 : 200;
  const captionFont = 8.5;

  for (let i = 0; i < images.length; i += cols) {
    const row = images.slice(i, i + cols).map((img) => {
      const size = measureImage(doc, img.file_path);
      const fitted = size ? fitWithin(size, boxW, boxH) : { w: boxW, h: Math.min(boxH, 110) };
      const label = `Figure ${figure.next++}`;
      const caption = pdfSafe(img.caption).trim();
      doc.fontSize(captionFont).font('Helvetica-Bold');
      const labelH = doc.heightOfString(label, { width: cellW });
      doc.font('Helvetica');
      const textH = caption ? doc.heightOfString(caption, { width: cellW, lineGap: 1 }) : 0;
      return { img, ok: !!size, ...fitted, label, labelH, caption, captionH: labelH + (caption ? 1 + textH : 0) };
    });

    const imgRowH = Math.max(...row.map((c) => c.h));
    const captionRowH = Math.max(...row.map((c) => c.captionH));
    const rowH = imgRowH + 5 + captionRowH + gap;
    if (doc.y + rowH > PH - 36) {
      doc.addPage();
      if (sectionTitle) renderSectionTitle(doc, pdfSafe(sectionTitle), ' (cont.)');
    }

    const top = doc.y;
    row.forEach((cell, c) => {
      const cellX = M + c * (cellW + gap);
      const x = cellX + (cellW - cell.w) / 2;
      const y = top + (imgRowH - cell.h); // bottom-align so captions sit under their photo
      if (cell.ok) {
        try {
          doc.image(cell.img.file_path, x, y, { width: cell.w, height: cell.h });
        } catch (err) {
          console.error(`[NCR PDF] Failed to embed ${cell.img.file_name}:`, err.message);
          cell.ok = false;
        }
      }
      if (!cell.ok) {
        doc.rect(x, y, cell.w, cell.h).fillColor(ROWALT).fill();
        doc.fontSize(8).font('Helvetica-Oblique').fillColor(LGRAY);
        put(doc, 'Image unavailable', x, y + cell.h / 2 - 4, { width: cell.w, align: 'center', lineBreak: false }, top);
      }
      doc.rect(x, y, cell.w, cell.h).strokeColor(BORDER).lineWidth(0.5).stroke();

      // Label and caption are separate calls: pdfkit's `continued` text
      // overlaps itself when centre-aligned.
      const capY = top + imgRowH + 5;
      doc.fontSize(captionFont).font('Helvetica-Bold').fillColor(NAVY);
      put(doc, cell.label, cellX, capY, { width: cellW, align: 'center' }, top);
      if (cell.caption) {
        doc.font('Helvetica').fillColor(DGRAY);
        put(doc, cell.caption, cellX, capY + cell.labelH + 1, { width: cellW, align: 'center', lineGap: 1 }, top);
      }
    });
    doc.y = top + rowH;
  }
}

function renderFooters(doc, ncr) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const fy = PH - 22;
  const printed = fmtDate(new Date().toISOString());
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    // Text below page.maxY() would otherwise trigger an automatic new page.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 5;
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(M, fy - 4).lineTo(M + PW, fy - 4).stroke();
    doc.fontSize(7).font('Helvetica').fillColor(LGRAY);
    doc.text(`PDI Quality Control  ·  ${pdfSafe(ncr.ncr_number || 'NCR')}`, M, fy, { width: PW / 2, align: 'left', lineBreak: false });
    doc.text(`Page ${i + 1} of ${total}  ·  Printed ${printed}`, M + PW / 2, fy, { width: PW / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * @param {object} ncr      ncrs row (plus form_no of a linked inspection)
 * @param {object} content  loadNcrContent(id, { withPaths: true })
 * @returns {Promise<Buffer>}
 */
function generateNcrPdf(ncr, content = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        bufferPages: true,
        margin: M,
        size: 'Letter',
        info: { Title: `Non-Conformance Report ${ncr.ncr_number || ''}`.trim(), Author: 'PDI Quality Control' },
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      renderBanner(doc, ncr);
      renderSummaryStrip(doc, ncr);

      const details = [
        ['NCR Number', display(ncr.ncr_number)],
        ['Date Opened', display(fmtDate(ncr.created_at))],
        ['Part Number', display(ncr.part_number)],
        ['Supplier', display(ncr.supplier)],
        ['PO Number', display(ncr.po_number)],
        ['Qty Affected', display(ncr.quantity_affected)],
        ['Inspection', display(ncr.form_no)],
        ['Opened By', display(ncr.created_by_name)],
      ];
      if (ncr.closed_at) details.push(['Date Closed', display(fmtDate(ncr.closed_at))]);
      renderSectionTitle(doc, 'NCR Details');
      renderDetailsGrid(doc, details);

      ensureSpace(doc, 60);
      renderSectionTitle(doc, 'Description of Defect');
      renderBodyText(doc, ncr.description_of_defect, 'No description entered.');

      const figure = { next: 1 };
      const photos = Array.isArray(content.photos) ? content.photos : [];
      if (photos.length) {
        ensureSpace(doc, 80);
        renderSectionTitle(doc, 'Photos');
        renderCaptionedImages(doc, photos, figure, 'Photos');
        vspace(doc, 4);
      }

      for (const section of (Array.isArray(content.sections) ? content.sections : [])) {
        const images = Array.isArray(section.images) ? section.images : [];
        ensureSpace(doc, 70);
        renderSectionTitle(doc, pdfSafe(section.title || 'Section'));
        renderBodyText(doc, section.body, images.length ? '' : 'No details entered.');
        renderCaptionedImages(doc, images, figure, section.title);
        vspace(doc, 4);
      }

      renderFooters(doc, ncr);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateNcrPdf, ncrPdfFilename, pdfSafe };
