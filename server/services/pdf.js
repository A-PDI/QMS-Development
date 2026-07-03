'use strict';
const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '../assets/pdi-logo.png');

// ── Palette ───────────────────────────────────────────────────────────────────
const NAVY    = '#1D2B4F';
const TEAL    = '#1A8C80';
const RED     = '#C0392B';
const GREEN   = '#27AE60';
const AMBER   = '#D4943A';
const BLACK   = '#111827';
const DGRAY   = '#374151';
const MGRAY   = '#6B7280';
const LGRAY   = '#9CA3AF';
const BORDER  = '#D1D5DB';
const ROWALT  = '#F9FAFB';
const THBG    = '#E5E7EB';  // table column-header background
const SECBG   = '#EEF2F7';  // section header background
const WHITE   = '#FFFFFF';

// Normalize a disposition value to its UPPERCASE code so PASS/FAIL colour +
// label consistently regardless of how it was stored (e.g. legacy 'fail').
function normalizeDisp(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}
// Solid colour for a disposition badge: PASS/ACCEPT → green, FAIL/REJECT → red,
// everything else (CONDITIONAL/ACCEPTED) → amber.
function dispColor(value) {
  const v = normalizeDisp(value);
  if (['FAIL', 'REJECT'].includes(v)) return RED;
  if (['PASS', 'ACCEPT'].includes(v)) return GREEN;
  return AMBER;
}

// ── Page geometry ─────────────────────────────────────────────────────────────
const M       = 40;           // left/right margin
const PW      = 612 - M * 2; // usable width  (= 532 pt on Letter)
const PH      = 792;          // Letter height
const FOOT    = 36;           // footer reserve at bottom

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────
function generateInspectionPdf(inspection, template, attachments = []) {
  return new Promise((resolve, reject) => {
    try {
      const doc    = new PDFDocument({ bufferPages: true, margin: M, size: 'Letter' });
      const chunks = [];
      doc.on('data',  c => chunks.push(c));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Page 1 header ─────────────────────────────────────────────────────
      renderPageHeader(doc, inspection, template);

      // ── Inspection metadata ───────────────────────────────────────────────
      renderInfoGrid(doc, inspection);
      vspace(doc, 10);

      // ── Sections ──────────────────────────────────────────────────────────
      const sd      = inspection.section_data || {};
      const generalAtts = attachments.filter(a => !a.section_key);

      // Resolve admin section overrides (stored in shared flags).
      const secDefs = (sd.__admin_sections && typeof sd.__admin_sections === 'object')
        ? sd.__admin_sections
        : (template.sections || {});

      // Build the per-item list. New inspections store answers under __items;
      // legacy inspections keep answers as top-level section keys (= item 0).
      let itemList;
      if (Array.isArray(sd.__items) && sd.__items.length > 0) {
        itemList = sd.__items;
      } else {
        const legacy = {};
        for (const k of Object.keys(sd)) {
          if (k.startsWith('__')) continue;
          legacy[k] = sd[k];
        }
        itemList = [legacy];
      }
      const dimensionalAdded = !!sd.__dimensional_added;

      itemList.forEach((itemData, itemIdx) => {
        // Each item after the first starts on a fresh page with its own header.
        if (itemIdx > 0) doc.addPage();
        if (itemList.length > 1) {
          renderItemBanner(doc, itemIdx + 1, itemList.length);
        }

        for (const [key, def] of Object.entries(secDefs)) {
          if (key.startsWith('__')) continue;
          if (def.optional && !dimensionalAdded) continue;

          const data    = (itemData && typeof itemData === 'object') ? itemData[key] : undefined;
          // Attachments are scoped per item: item 0 uses the raw key, items 1+
          // use the namespaced `item{N}__{key}` form (mirrors the client).
          const attKey  = itemIdx === 0 ? key : `item${itemIdx}__${key}`;
          const secAtts = attachments.filter(a => a.section_key === attKey);

          switch (def.section_type) {
            case 'pfn_checklist':
              renderPfnChecklist(doc, def, data, secAtts); break;
            case 'pfn_visual':
              renderPfnVisual(doc, def, data, secAtts); break;
            case 'dimensional':
              renderDimensional(doc, def, data, secAtts); break;
            case 'pass_fail_checklist':
              renderPassFail(doc, def, data, secAtts); break;
            case 'general_measurements':
              renderGeneralMeasurements(doc, def, data, secAtts); break;
            case 'groove_specs':
              renderGrooveSpecs(doc, def, data, secAtts); break;
            case 'camshaft_bore':
              renderCamshaftBore(doc, def, data, secAtts); break;
            case 'fire_ring_protrusion':
              renderFireRing(doc, def, data, secAtts); break;
            case 'valve_recession':
              renderValveRecession(doc, def, data, secAtts); break;
            case 'vacuum_test':
              renderVacuumTest(doc, def, data, secAtts); break;
            default: break;
          }
          vspace(doc, 8);
        }

        // ── Per-item disposition ───────────────────────────────────────────
        // New inspections store the disposition per item (__disposition). Fall
        // back to the inspection-level disposition for item 0 of legacy data.
        let itemDisp = (itemData && itemData.__disposition) || '';
        let itemDispNotes = (itemData && itemData.__disposition_notes) || '';
        if (!itemDisp && itemIdx === 0 && !(Array.isArray(sd.__items) && sd.__items.length > 0)) {
          itemDisp = inspection.disposition || '';
          itemDispNotes = inspection.disposition_notes || '';
        }
        if (itemDisp) {
          ensureSpace(doc, 60);
          renderSectionTitle(doc, itemList.length > 1 ? `Item ${itemIdx + 1} — Disposition` : 'Final Result');
          const color = dispColor(itemDisp);
          const bY = doc.y;
          doc.roundedRect(M, bY, PW, 32, 3).fillColor(color).fill();
          const tY = bY + (32 - 12) / 2;
          doc.fontSize(12).font('Helvetica-Bold').fillColor(WHITE)
            .text(normalizeDisp(itemDisp), M, tY, { width: PW, align: 'center', lineBreak: false });
          doc.y = bY + 32 + 6;
          if (itemDispNotes) {
            doc.fontSize(9).font('Helvetica').fillColor(DGRAY)
              .text(itemDispNotes, M, doc.y, { width: PW });
            doc.y += 4;
          }
        }
      });

      // ── Overall disposition (multi-item summary only) ─────────────────────
      if (inspection.disposition && Array.isArray(sd.__items) && sd.__items.length > 1) {
        ensureSpace(doc, 60);
        renderSectionTitle(doc, 'Overall Disposition');

        const color = dispColor(inspection.disposition);

        const bY = doc.y;
        doc.roundedRect(M, bY, PW, 32, 3).fillColor(color).fill();
        const tY = bY + (32 - 12) / 2;
        doc.fontSize(12).font('Helvetica-Bold').fillColor(WHITE)
          .text(normalizeDisp(inspection.disposition), M, tY, { width: PW, align: 'center', lineBreak: false });
        doc.y = bY + 32 + 6;

        if (inspection.disposition_notes) {
          doc.fontSize(9).font('Helvetica').fillColor(DGRAY)
            .text(inspection.disposition_notes, M, doc.y, { width: PW });
          vspace(doc, 4);
        }
        vspace(doc, 8);
      }

      // ── General photo attachments ─────────────────────────────────────────
      const photoAtts = generalAtts.filter(a =>
        (a.mime_type || '').startsWith('image/') &&
        a.file_path && fs.existsSync(a.file_path)
      );
      if (photoAtts.length > 0) {
        ensureSpace(doc, 60);
        renderSectionTitle(doc, 'Attachments');
        renderPhotoGrid(doc, photoAtts);
      }

      // ── Footers on every page ─────────────────────────────────────────────
      // IMPORTANT: doc.text() auto-adds a page when called below page.maxY()
      // (= page.height - margins.bottom = 792 - 40 = 752).  The footer sits at
      // PH - 22 = 770 which is past that limit.  We temporarily set the bottom
      // margin to 5 so PDFKit allows rendering there without adding blank pages.
      const range      = doc.bufferedPageRange();
      const totalPages = range.count;
      const po   = (inspection.po_number   || '').replace(/\s/g, '');
      const part = (inspection.part_number || '').replace(/\s/g, '');
      const fy   = PH - 22;

      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(range.start + i);
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 5;

        doc.strokeColor(BORDER).lineWidth(0.5)
          .moveTo(M, fy - 4).lineTo(M + PW, fy - 4).stroke();

        doc.fontSize(7).font('Helvetica').fillColor(LGRAY);
        doc.text(
          `PDI Quality Control  ·  QC-${po}-${part}`,
          M, fy, { width: PW / 2, align: 'left', lineBreak: false }
        );
        doc.text(
          `Page ${i + 1} of ${totalPages}  ·  ${new Date().toLocaleDateString()}`,
          M + PW / 2, fy, { width: PW / 2, align: 'right', lineBreak: false }
        );

        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Add vertical space without using moveDown (which depends on line height). */
function vspace(doc, pts) {
  doc.y = Math.min(doc.y + pts, PH - FOOT);
}

/** If fewer than `needed` points remain on the page, start a new page. */
function ensureSpace(doc, needed) {
  if (doc.y + needed > PH - FOOT) doc.addPage();
}

/** True if a value counts as actual entered data (not blank / whitespace). */
function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

/**
 * For dimensional / general-measurement sections, decide whether a single
 * item row has any inspector-entered data. Spec/measurement/location come
 * from the template definition and do NOT count — only the recorded values
 * (actuals, notes, status/result) make a row "filled in".
 */
function isMeasurementRowFilled(d) {
  if (!d || typeof d !== 'object') return false;
  return [
    d.actual1, d.actual2, d.actual3,        // dimensional
    d.actual_value, d.specification,        // general measurements (entered spec)
    d.notes, d.status, d.result,            // shared
  ].some(hasValue);
}

/**
 * Normalise a status cell value to one of 'P' | 'F' | 'A' | '' so we can pick
 * the right glyph (a status column may hold P/F/A, PASS/FAIL/ACCEPT/REJECT, or
 * the lowercase pass/fail used by the vacuum-test section).
 */
function statusToGlyph(value) {
  const sv = String(value == null ? '' : value).trim().toUpperCase();
  if (['P', 'PASS'].includes(sv)) return 'P';
  if (['F', 'FAIL', 'REJECT'].includes(sv)) return 'F';
  if (['A', 'ACCEPT', 'ACCEPTED'].includes(sv)) return 'A';
  return '';
}

/**
 * Draw a Pass / Fail / Accepted indicator centred in a cell:
 *   P → green check, F → red X, A → amber "A".
 * Replaces the old full-row colour fill.
 */
function drawStatusGlyph(doc, glyph, cellX, cellY, cellW, cellH) {
  const cx = cellX + cellW / 2;
  const cy = cellY + cellH / 2;
  if (glyph === 'P') {
    // Check mark
    const s = 5;
    doc.save().strokeColor(GREEN).lineWidth(1.6).lineJoin('round').lineCap('round');
    doc.moveTo(cx - s, cy)
      .lineTo(cx - s * 0.25, cy + s * 0.85)
      .lineTo(cx + s * 1.05, cy - s * 0.9)
      .stroke();
    doc.restore();
  } else if (glyph === 'F') {
    // X mark
    const s = 4.2;
    doc.save().strokeColor(RED).lineWidth(1.6).lineCap('round');
    doc.moveTo(cx - s, cy - s).lineTo(cx + s, cy + s).stroke();
    doc.moveTo(cx + s, cy - s).lineTo(cx - s, cy + s).stroke();
    doc.restore();
  } else if (glyph === 'A') {
    doc.save().fontSize(9).font('Helvetica-Bold').fillColor(AMBER);
    doc.text('A', cellX, cy - 5, { width: cellW, align: 'center', lineBreak: false });
    doc.restore();
  }
}

/**
 * Draw text at an explicit (x, y) position, then restore doc.y to `afterY`
 * so cursor drift between columns is impossible.
 */
function put(doc, text, x, y, opts, afterY) {
  doc.text(String(text == null ? '' : text), x, y, opts);
  if (afterY !== undefined) doc.y = afterY;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page-level components
// ─────────────────────────────────────────────────────────────────────────────

function renderPageHeader(doc, inspection, template) {
  const bannerH = 56;
  const top     = M - 10;

  // Navy banner
  doc.rect(M, top, PW, bannerH).fillColor(NAVY).fill();

  // Logo
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M + 10, top + 12, { height: 26, fit: [80, 26] }); } catch (_) {}
  }

  // Title block on the right side of the banner
  const titleX = M + 100;
  const titleW = PW - 110;

  doc.fontSize(13).font('Helvetica-Bold').fillColor(WHITE);
  put(doc, 'INCOMING QUALITY INSPECTION', titleX, top + 10, {
    width: titleW, align: 'center', lineBreak: false,
  }, top + 26);

  const sub = [
    template.form_no,
    (template.component_type || '').replace(/_/g, ' '),
    template.revision ? `Rev ${template.revision}` : null,
  ].filter(Boolean).join('  ·  ');

  doc.fontSize(8).font('Helvetica').fillColor('#A5B4C8');
  put(doc, sub.toUpperCase(), titleX, top + 30, {
    width: titleW, align: 'center', lineBreak: false,
  }, top + bannerH + 14);
}

/**
 * Render a two-column key-value grid of inspection header fields.
 * Uses explicit coordinates for all text so doc.y cannot drift mid-grid.
 */
function renderInfoGrid(doc, inspection) {
  const pairs = [
    ['Part Number',    inspection.part_number],
    ['PO Number',      inspection.po_number],
    ['Supplier',       inspection.supplier],
    ['Lot / Serial',   inspection.lot_serial_no],
    ['Date Received',  inspection.date_received],
    ['Inspector',      inspection.inspector_name],
    ['Description',    inspection.description],
    ['Lot Size',       inspection.lot_size],
    ['Sample Size',    inspection.sample_size],
    ['AQL Level',      inspection.aql_level],
  ].filter(([, v]) => v != null && v !== '');

  const colW  = PW / 2;
  const rowH  = 18;
  const startY = doc.y;
  const rows  = Math.ceil(pairs.length / 2);

  // Outer border
  doc.rect(M, startY, PW, rows * rowH).strokeColor(BORDER).lineWidth(0.5).stroke();

  // Row backgrounds + borders
  for (let r = 0; r < rows; r++) {
    const ry = startY + r * rowH;
    if (r % 2 === 1) {
      doc.rect(M, ry, PW, rowH).fillColor(ROWALT).fill();
    }
    if (r > 0) {
      doc.strokeColor(BORDER).lineWidth(0.3)
        .moveTo(M, ry).lineTo(M + PW, ry).stroke();
    }
  }

  // Vertical divider
  doc.strokeColor(BORDER).lineWidth(0.3)
    .moveTo(M + colW, startY).lineTo(M + colW, startY + rows * rowH).stroke();

  // Text — all at explicit positions; afterY = startY so nothing drifts
  pairs.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x   = M + col * colW;
    const y   = startY + row * rowH;

    doc.fontSize(7).font('Helvetica-Bold').fillColor(MGRAY);
    put(doc, label.toUpperCase(), x + 5, y + 4, { width: 72, lineBreak: false }, startY);

    doc.fontSize(9).font('Helvetica').fillColor(BLACK);
    put(doc, String(value), x + 82, y + 3, { width: colW - 88, lineBreak: false }, startY);
  });

  doc.y = startY + rows * rowH + 2;
}

/**
 * Render an item banner (e.g. "ITEM 2 OF 5") at the top of a multi-item page.
 */
function renderItemBanner(doc, itemNo, totalItems) {
  const h = 22;
  const y = doc.y;
  doc.rect(M, y, PW, h).fillColor(NAVY).fill();
  doc.fontSize(10).font('Helvetica-Bold').fillColor(WHITE);
  put(doc, `ITEM ${itemNo} OF ${totalItems}`, M + 10, y + 6, {
    width: PW - 20, lineBreak: false,
  }, y + h + 6);
}

/**
 * Render a clean section title: light background bar with navy bold text.
 */
function renderSectionTitle(doc, title, suffix) {
  const h  = 20;
  const y  = doc.y;
  const label = suffix ? `${title}${suffix}` : title;

  doc.rect(M, y, PW, h).fillColor(SECBG).fill();
  doc.rect(M, y, 3,  h).fillColor(NAVY).fill();   // left accent bar

  doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY);
  put(doc, label.toUpperCase(), M + 10, y + 5, {
    width: PW - 14, lineBreak: false,
  }, y + h + 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Table renderer — with page-break aware header repetition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param doc
 * @param {string[]}   headerRow
 * @param {string[][]} dataRows
 * @param {number[]}   colWidths   — must sum to PW
 * @param {object}     opts
 *   statusColIdx  — column index used for pass/fail row colouring
 *   sectionTitle  — re-drawn above table header on continuation pages
 * @param {number}     pad         — cell padding
 */
function renderTable(doc, headerRow, dataRows, colWidths, opts = {}, pad = 5) {
  const { statusColIdx = -1, sectionTitle = null } = opts;
  const totalW = colWidths.reduce((a, b) => a + b, 0);

  // ── Inner helpers ──────────────────────────────────────────────────────────

  function cellHeight(row) {
    let h = 16;
    doc.font('Helvetica').fontSize(8);
    row.forEach((cell, ci) => {
      const w  = (colWidths[ci] || 60) - pad * 2;
      const ch = doc.heightOfString(String(cell == null ? '' : cell), { width: w });
      h = Math.max(h, ch + pad * 2);
    });
    return h;
  }

  function drawRow(y, row, rowH, isHeader, rowIndex) {
    // Background — neutral zebra striping only (Pass/Fail is now shown by a
    // glyph in the status cell, not by tinting the whole row).
    let bg = WHITE;
    if (isHeader) {
      bg = THBG;
    } else if (rowIndex % 2 === 1) {
      bg = ROWALT;
    }
    doc.rect(M, y, totalW, rowH).fillColor(bg).fill();

    // Bottom border
    doc.strokeColor(BORDER).lineWidth(0.3)
      .moveTo(M, y + rowH).lineTo(M + totalW, y + rowH).stroke();

    // Cell text — explicit y, cursor restored after every cell
    let xc = M;
    row.forEach((cell, ci) => {
      const cw = colWidths[ci] || 60;
      // Status column on data rows → draw a check / X / A glyph instead of text
      if (!isHeader && ci === statusColIdx) {
        const glyph = statusToGlyph(cell);
        if (glyph) drawStatusGlyph(doc, glyph, xc, y, cw, rowH);
        xc += cw;
        return;
      }
      doc.fontSize(isHeader ? 7 : 8)
        .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(isHeader ? DGRAY : BLACK);
      put(doc, cell, xc + pad, y + pad, { width: cw - pad * 2, lineBreak: true }, y);
      xc += cw;
    });

    doc.y = y + rowH;
  }

  function drawHeader(y) {
    const h = 16;
    drawRow(y, headerRow, h, true, 0);
    return h;
  }

  // Top border of table
  doc.strokeColor(BORDER).lineWidth(0.5)
    .moveTo(M, doc.y).lineTo(M + totalW, doc.y).stroke();

  // Header row
  drawHeader(doc.y);

  // Data rows
  dataRows.forEach((row, ri) => {
    const rh = cellHeight(row);
    if (doc.y + rh > PH - FOOT) {
      doc.addPage();
      if (sectionTitle) renderSectionTitle(doc, sectionTitle, ' (cont.)');
      drawHeader(doc.y);
    }
    drawRow(doc.y, row, rh, false, ri + 1);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Image helpers
// ─────────────────────────────────────────────────────────────────────────────

function renderItemImages(doc, itemId, sectionAtts) {
  const imgs = sectionAtts.filter(a =>
    String(a.item_id) === String(itemId) &&
    (a.mime_type || '').startsWith('image/') &&
    a.file_path && fs.existsSync(a.file_path)
  );
  if (!imgs.length) return;

  const maxW = 140, maxH = 105, gap = 8;
  let xp      = M + 20;
  let rowBaseY = null;  // y of the top of the current image row

  vspace(doc, 4);

  for (const att of imgs) {
    // Start a new row if this image won't fit horizontally
    if (xp + maxW > M + PW) {
      doc.y = rowBaseY + maxH + gap;
      xp    = M + 20;
    }
    ensureSpace(doc, maxH + 4);
    if (rowBaseY === null || xp === M + 20) rowBaseY = doc.y;

    try {
      doc.image(att.file_path, xp, rowBaseY, { fit: [maxW, maxH] });
    } catch (err) {
      console.error(`[PDF] Failed to embed item image ${att.file_name}:`, err.message);
    }
    xp += maxW + gap;
  }
  // Advance cursor past the last row of images
  if (rowBaseY !== null) doc.y = rowBaseY + maxH + gap + 2;
}

function renderPhotoGrid(doc, atts) {
  const COLS = 3;
  const gap  = 8;                                          // pts between columns
  const imgW = Math.floor((PW - (COLS - 1) * gap) / COLS); // ≈172 pt (≈2.39")
  const imgH = Math.round(imgW * (3.25 / 2.45));           // ≈228 pt (≈3.17")

  let col      = 0;
  let rowBaseY = doc.y;
  let hasImage = false;

  for (const att of atts) {
    if (!att.file_path || !fs.existsSync(att.file_path)) continue;
    hasImage = true;

    if (col === 0) {
      ensureSpace(doc, imgH + gap + 4);
      rowBaseY = doc.y;
    }

    const xp = M + col * (imgW + gap);

    // Clip to cell bounds so images never bleed into adjacent cells or rows
    doc.save();
    doc.rect(xp, rowBaseY, imgW, imgH).clip();
    try {
      doc.image(att.file_path, xp, rowBaseY, { cover: [imgW, imgH], align: 'center', valign: 'center' });
    } catch (err) {
      console.error(`[PDF] Failed to embed attachment ${att.file_name}:`, err.message);
    }
    doc.restore();

    // Light border around each cell
    doc.rect(xp, rowBaseY, imgW, imgH).strokeColor(BORDER).lineWidth(0.5).stroke();

    col++;
    if (col >= COLS) {
      col      = 0;
      doc.y    = rowBaseY + imgH + gap;
      rowBaseY = doc.y;
    }
  }

  // Advance cursor past the last (possibly partial) row
  if (hasImage) {
    doc.y = rowBaseY + imgH + gap + 4;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section-type renderers
// ─────────────────────────────────────────────────────────────────────────────

function renderPfnChecklist(doc, section, data, secAtts = []) {
  const title = section.title || 'Receiving Checklist';
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  const items   = section.items || [];
  const dataArr = Array.isArray(data) ? data : [];

  const header = ['#', 'Check Item', 'Requirement', 'Finding', 'Status'];
  const cw     = [24, 175, 183, 114, 36]; // sum = 532
  const rows   = items.map(item => {
    const d = dataArr.find(r => r.id === item.id) || {};
    return [String(item.id), item.name || '', item.requirement || '', d.finding || '', d.status || ''];
  });

  renderTable(doc, header, rows, cw, { statusColIdx: 4, sectionTitle: title });

  const allImgsPfn = secAtts.filter(a =>
    (a.mime_type || '').startsWith('image/') && a.file_path && fs.existsSync(a.file_path)
  );
  if (allImgsPfn.length > 0) { vspace(doc, 4); renderPhotoGrid(doc, allImgsPfn); }
}

function renderPfnVisual(doc, section, data, secAtts = []) {
  const title = section.title || 'Visual Inspection';
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  const items   = section.items || [];
  const dataArr = Array.isArray(data) ? data : [];

  const header = ['#', 'CTQ Area', 'Failure Mode', 'Criteria', 'Method', 'Result'];
  const cw     = [24, 100, 108, 152, 100, 48]; // sum = 532
  const rows   = items.map(item => {
    const d = dataArr.find(r => r.id === item.id) || {};
    return [String(item.id), item.ctq_area || '', item.failure_mode || '',
      item.criteria || '', item.method || '', d.result || ''];
  });

  renderTable(doc, header, rows, cw, { statusColIdx: 5, sectionTitle: title });

  const allImgsVis = secAtts.filter(a =>
    (a.mime_type || '').startsWith('image/') && a.file_path && fs.existsSync(a.file_path)
  );
  if (allImgsVis.length > 0) { vspace(doc, 4); renderPhotoGrid(doc, allImgsVis); }
}

function renderDimensional(doc, section, data, secAtts = []) {
  const title = section.title || 'Dimensional Inspection';

  const items   = section.items || [];
  const dataArr = Array.isArray(data) ? data : [];

  // Only include items the inspector actually filled in. If none are filled,
  // omit the whole section from the PDF.
  const filledItems = items.filter(item => {
    const d = dataArr.find(r => r.id === item.id);
    return isMeasurementRowFilled(d);
  });
  if (filledItems.length === 0) return;

  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  // 'single_value' layout (injector test-bench results): drop the Location and
  // Actual 2 / Actual 3 columns, rename Actual 1 → Actual, and widen the spec.
  const singleValue = section.layout === 'single_value';
  let header, cw, statusColIdx;
  if (singleValue) {
    header = ['#', 'Measurement', 'Spec / Limit', 'Actual', 'Status'];
    cw     = [24, 214, 130, 100, 64]; // sum = 532
    statusColIdx = 4;
  } else {
    header = ['#', 'Measurement', 'Location', 'Spec', 'Actual 1', 'Actual 2', 'Actual 3', 'Status'];
    cw     = [24, 130, 80, 68, 60, 60, 60, 50]; // sum = 532
    statusColIdx = 7;
  }
  const rows = filledItems.map(item => {
    const d = dataArr.find(r => r.id === item.id) || {};
    // Fall back to the item's spec so the Spec/Limit column is never blank.
    const spec = d.spec || item.spec || '';
    if (singleValue) {
      return [String(item.id), item.measurement || '', spec, d.actual1 || '', d.status || ''];
    }
    return [String(item.id), item.measurement || '', item.location || '', spec,
      d.actual1 || '', d.actual2 || '', d.actual3 || '', d.status || ''];
  });

  renderTable(doc, header, rows, cw, { statusColIdx, sectionTitle: title });

  const allImgsDim = secAtts.filter(a =>
    (a.mime_type || '').startsWith('image/') && a.file_path && fs.existsSync(a.file_path)
  );
  if (allImgsDim.length > 0) { vspace(doc, 4); renderPhotoGrid(doc, allImgsDim); }
}

function renderPassFail(doc, section, data, secAtts = []) {
  const title = section.title || 'Visual / Quality Checklist';
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  const items   = section.items || [];
  const dataArr = Array.isArray(data) ? data : [];

  // Normalise old {pass,fail} boolean format to result string
  function getResult(d) {
    if (d.result !== undefined) return d.result || '';
    if (d.pass === true) return 'P';
    if (d.fail === true) return 'F';
    return '';
  }

  const header = ['#', 'Inspection Item', 'Requirement', 'Notes', 'Status'];
  const cw     = [24, 170, 160, 134, 44]; // sum = 532
  const rows   = items.map(item => {
    const d = dataArr.find(r => r.id === item.id) || {};
    return [String(item.id), item.name || item.description || '', item.requirement || '',
      d.notes || '', getResult(d)];
  });

  renderTable(doc, header, rows, cw, { statusColIdx: 4, sectionTitle: title });

  const allImgs = secAtts.filter(a =>
    (a.mime_type || '').startsWith('image/') && a.file_path && fs.existsSync(a.file_path)
  );
  if (allImgs.length > 0) { vspace(doc, 4); renderPhotoGrid(doc, allImgs); }
}

function renderGeneralMeasurements(doc, section, data, secAtts = []) {
  const title = section.title || 'General Measurements';

  const items   = section.items || [];
  const dataArr = Array.isArray(data) ? data : [];

  // Only include items the inspector actually filled in. If none are filled,
  // omit the whole section from the PDF.
  const filledItems = items.filter(item => {
    const d = dataArr.find(r => r.id === item.id);
    return isMeasurementRowFilled(d);
  });
  if (filledItems.length === 0) return;

  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  const notesW = Math.max(40, PW - 22 - 116 - 110 - 110 - 44);
  const header = ['#', 'Measurement', 'Specification', 'Actual Value', 'Notes', 'Result'];
  const cw     = [22, 116, 110, 110, notesW, 44];
  const rows   = filledItems.map(item => {
    const d = dataArr.find(r => r.id === item.id) || {};
    return [String(item.id), item.measurement || '', d.specification || '',
      d.actual_value || '', d.notes || '', d.result || ''];
  });

  renderTable(doc, header, rows, cw, { statusColIdx: 5, sectionTitle: title });

  const allImgsGm = secAtts.filter(a =>
    (a.mime_type || '').startsWith('image/') && a.file_path && fs.existsSync(a.file_path)
  );
  if (allImgsGm.length > 0) { vspace(doc, 4); renderPhotoGrid(doc, allImgsGm); }
}

function renderCamshaftBore(doc, section, data, secAtts = []) {
  const title = section.title || 'Camshaft Bore';

  data       = data || {};
  const bc   = section.bore_count || 7;
  // Omit if no bore actuals recorded.
  const boresFilled = Array.isArray(data.bores) && data.bores.some(hasValue);
  if (!boresFilled) return;

  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);
  const cw0  = 48;
  const cw1  = Math.floor((PW - cw0) / bc);
  const cws  = [cw0, ...Array(bc).fill(cw1)];

  const header    = ['', ...Array.from({ length: bc }, (_, i) => `Bore ${i + 1}`)];
  const bores     = Array.isArray(data.bores) ? data.bores : Array(bc).fill('');
  const dataRows  = [
    ['Spec',   ...Array(bc).fill(data.spec   || '')],
    ['Actual', ...bores.map((v, i) => bores[i] || '')],
  ];

  renderTable(doc, header, dataRows, cws, { sectionTitle: title });
}

function renderFireRing(doc, section, data, secAtts = []) {
  const title = section.title || 'Fire Ring Protrusion';

  data       = data || {};
  const cc   = section.cylinder_count || 6;
  // Omit if no cylinder actuals recorded.
  const cylsFilled = Array.isArray(data.cylinders) && data.cylinders.some(hasValue);
  if (!cylsFilled) return;

  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);
  const cw0  = 48;
  const cw1  = Math.floor((PW - cw0) / cc);
  const cws  = [cw0, ...Array(cc).fill(cw1)];

  const header   = ['', ...Array.from({ length: cc }, (_, i) => `Cyl ${i + 1}`)];
  const cyls     = Array.isArray(data.cylinders) ? data.cylinders : Array(cc).fill('');
  const dataRows = [
    ['Spec',   ...Array(cc).fill(data.spec  || '')],
    ['Actual', ...cyls.map((v, i) => cyls[i] || '')],
  ];

  renderTable(doc, header, dataRows, cws, { sectionTitle: title });
}

function renderValveRecession(doc, section, data, secAtts = []) {
  const title = section.title || 'Valve Recession';

  data       = data || {};
  const cc   = section.cylinder_count || 6;
  const cyls = Array.isArray(data.cylinders) ? data.cylinders : Array(cc).fill({});
  // Omit if no cylinder has any value (int/exh/result) recorded.
  const anyFilled = cyls.some(c => c && [c.int1, c.int2, c.exh1, c.exh2, c.result].some(hasValue));
  if (!anyFilled) return;

  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  const hasResult = cyls.some(c => c && String(c.result || '').trim() !== '');

  let header, cw, dataRows, statusColIdx;
  if (hasResult) {
    header = ['Cyl', 'Int 1', 'Int 2', 'Exh 1', 'Exh 2', 'Result'];
    cw     = [52, 100, 100, 100, 100, 80]; // sum = 532
    statusColIdx = 5;
    dataRows = Array.from({ length: cc }, (_, i) => {
      const c = cyls[i] || {};
      return [`C${i + 1}`, c.int1 || '', c.int2 || '', c.exh1 || '', c.exh2 || '', c.result || ''];
    });
  } else {
    header = ['Cyl', 'Int 1', 'Int 2', 'Exh 1', 'Exh 2'];
    cw     = [56, 119, 119, 119, 119]; // sum = 532
    statusColIdx = -1;
    dataRows = Array.from({ length: cc }, (_, i) => {
      const c = cyls[i] || {};
      return [`C${i + 1}`, c.int1 || '', c.int2 || '', c.exh1 || '', c.exh2 || ''];
    });
  }

  renderTable(doc, header, dataRows, cw, { statusColIdx, sectionTitle: title });
}

function renderGrooveSpecs(doc, section, data, secAtts = []) {
  const title = section.title || 'Fire Ring';

  data        = data || {};
  const cc    = section.cylinder_count || 6;
  const items = section.items || [];
  const meas  = Array.isArray(data.measurements) ? data.measurements : [];

  // All specs are listed in the header; only items flagged for entry get a
  // per-cylinder data row.
  const entryItems = items.filter(it =>
    it.entry === true || (it.entry === undefined && /wire protrusion/i.test(it.measurement || ''))
  );

  // Omit the whole section if none of the entry items have any cylinder value
  // or status recorded.
  const anyFilled = entryItems.some(item => {
    const m = meas.find(r => r.id === item.id);
    if (!m) return false;
    const cyls = Array.isArray(m.cylinders) ? m.cylinders : [];
    return cyls.some(hasValue) || hasValue(m.status) || hasValue(m.notes);
  });
  if (!anyFilled) return;

  ensureSpace(doc, 80);
  renderSectionTitle(doc, title);

  // ── Specifications block (reference only) ───────────────────────────────
  doc.fontSize(8).font('Helvetica-Bold').fillColor(DGRAY);
  put(doc, 'Specifications', M, doc.y, { width: PW }, doc.y + 12);
  doc.fontSize(8).font('Helvetica').fillColor(BLACK);
  for (const item of items) {
    const line = item.spec ? `${item.measurement}:  ${item.spec}` : item.measurement;
    put(doc, line, M + 6, doc.y, { width: PW - 6 }, doc.y + 12);
  }
  vspace(doc, 4);

  // ── Data-entry chart(s) ─────────────────────────────────────────────────
  if (entryItems.length === 0) return;

  const labelW  = 150;
  const statusW = 40;
  const cylW    = Math.floor((PW - labelW - statusW) / cc);
  // Absorb rounding into the label column so widths still sum to PW.
  const realLabelW = PW - statusW - cylW * cc;
  const cws     = [realLabelW, ...Array(cc).fill(cylW), statusW];

  const header = ['Measurement', ...Array.from({ length: cc }, (_, i) => `Cyl ${i + 1}`), 'Result'];
  const rows   = entryItems.map(item => {
    const m = meas.find(r => r.id === item.id) || {};
    const cyls = Array.isArray(m.cylinders) ? m.cylinders : [];
    const label = item.spec ? `${item.measurement}\n${item.spec}` : (item.measurement || '');
    return [label, ...Array.from({ length: cc }, (_, i) => cyls[i] || ''), m.status || ''];
  });

  renderTable(doc, header, rows, cws, { statusColIdx: cc + 1, sectionTitle: title });

  const allImgs = secAtts.filter(a =>
    (a.mime_type || '').startsWith('image/') && a.file_path && fs.existsSync(a.file_path)
  );
  if (allImgs.length > 0) { vspace(doc, 4); renderPhotoGrid(doc, allImgs); }
}

function renderVacuumTest(doc, section, data, secAtts = []) {
  const title = section.title || 'Vacuum Test';

  data       = data || {};
  const cc   = section.cylinder_count || 6;
  const cyls = Array.isArray(data.cylinders) ? data.cylinders : Array(cc).fill({});

  // Omit if no cylinder has any result or sub-result recorded.
  const anyFilled = cyls.some(c => c && [c.overall, c.int1, c.int2, c.exh1, c.exh2].some(hasValue));
  if (!anyFilled) return;

  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  // The Int/Exh sub-results only apply to a failing cylinder. If none of the
  // cylinders have any sub-results recorded, omit those columns entirely so the
  // report shows just Cylinder # and the Pass/Fail/Accepted result.
  const SUBS = ['int1', 'int2', 'exh1', 'exh2'];
  const hasSubs = Array.from({ length: cc }).some((_, i) => {
    const c = cyls[i] || {};
    return SUBS.some(f => String(c[f] || '').trim() !== '');
  });

  if (hasSubs) {
    const cw     = [44, 98, 98, 98, 98, 96]; // sum = 532
    const header = ['Cyl', 'Int 1', 'Int 2', 'Exh 1', 'Exh 2', 'Result'];
    const rows   = Array.from({ length: cc }, (_, i) => {
      const c = cyls[i] || {};
      return [`C${i + 1}`, c.int1 || '', c.int2 || '', c.exh1 || '', c.exh2 || '', c.overall || ''];
    });
    renderTable(doc, header, rows, cw, { statusColIdx: 5, sectionTitle: title });
  } else {
    const cw     = [266, 266]; // sum = 532
    const header = ['Cylinder', 'Result'];
    const rows   = Array.from({ length: cc }, (_, i) => {
      const c = cyls[i] || {};
      return [`Cylinder ${i + 1}`, c.overall || ''];
    });
    renderTable(doc, header, rows, cw, { statusColIdx: 1, sectionTitle: title });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Injector Test Bench — custom side-by-side comparison report (LANDSCAPE)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generate a landscape PDF comparing one or more selected injectors side by
 * side. Columns:
 *   1. Test Step   — step name + Rail Pressure / Pulse Width / Strk parameters
 *   2. Specification — Target, +/- range, Units
 *   3+. one column per injector (serial #) holding the AVERAGE flow value,
 *       coloured green (pass) / red (fail).
 * Everything is scaled to fit on a single landscape page.
 *
 * injectors: array of {
 *   part_number, serial_number, job_number, brand, injector_type,
 *   machine_name, machine_sn, test_datetime,
 *   tests: [ { name, params:{rail_pressure,pulse_width,strk}, status,
 *              primary:{unit,target,tolerance,average,status}, secondary:{...}|null } ]
 * }
 */
function generateInjectorComparisonPdf(injectors = []) {
  return new Promise((resolve, reject) => {
    try {
      const LM = 28; // landscape margin
      const doc = new PDFDocument({ bufferPages: true, margin: LM, size: 'Letter', layout: 'landscape' });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = 792;             // Letter landscape width
      const pageH = 612;             // Letter landscape height
      const usableW = pageW - LM * 2;
      const list = Array.isArray(injectors) ? injectors : [];

      // ── Build the unified list of test-step rows across all injectors ─────
      // Each row = one test step (+ optional secondary tank). Rows are keyed by
      // a stable label so the same step lines up across injectors.
      const rowOrder = [];
      const rowMap = new Map(); // key -> { label, params, target, tolerance, unit }
      function rowKey(label) { return label.toLowerCase(); }

      for (const inj of list) {
        for (const t of (inj.tests || [])) {
          if (!t.primary) continue;
          const params = t.params || {};
          const pLabel = t.name || t.raw_name || 'Step';
          const pKey = rowKey(pLabel + '|1');
          if (!rowMap.has(pKey)) {
            rowMap.set(pKey, {
              label: pLabel,
              params,
              // Specification shown = green-band spec (e.g. "8.5 +/- 4.5 mm3/STRK").
              spec: t.primary.spec || '',
              unit: t.primary.unit || '',
            });
            rowOrder.push(pKey);
          }
          if (t.secondary) {
            const sLabel = `${pLabel} — ${t.secondary.tank_name || 'Secondary'}`;
            const sKey = rowKey(sLabel + '|2');
            if (!rowMap.has(sKey)) {
              rowMap.set(sKey, {
                label: sLabel,
                params,
                spec: t.secondary.spec || '',
                unit: t.secondary.unit || '',
              });
              rowOrder.push(sKey);
            }
          }
        }
      }

      // Per-injector lookup: key -> { value(=average flow), status }
      const injValues = list.map((inj) => {
        const m = new Map();
        for (const t of (inj.tests || [])) {
          if (!t.primary) continue;
          const pLabel = t.name || t.raw_name || 'Step';
          m.set(rowKey(pLabel + '|1'), {
            value: t.primary.average || '',
            status: t.primary.status,
          });
          if (t.secondary) {
            const sLabel = `${pLabel} — ${t.secondary.tank_name || 'Secondary'}`;
            m.set(rowKey(sLabel + '|2'), {
              value: t.secondary.average || '',
              status: t.secondary.status,
            });
          }
        }
        return m;
      });

      // ── Header banner (logo + part number + general info) ─────────────────
      const bannerH = 54;
      const top = LM;
      doc.rect(LM, top, usableW, bannerH).fillColor(NAVY).fill();
      if (fs.existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, LM + 10, top + 14, { height: 26, fit: [90, 26] }); } catch (_) {}
      }

      const firstInj = list[0] || {};
      const partNo = firstInj.part_number || '—';
      const titleX = LM + 112;
      const titleW = usableW - 122;
      doc.fontSize(14).font('Helvetica-Bold').fillColor(WHITE);
      doc.text(`INJECTOR TEST REPORT — ${partNo}`, titleX, top + 9, { width: titleW, align: 'center', lineBreak: false });

      const brands = [...new Set(list.map(i => [i.brand, i.injector_type].filter(Boolean).join(' ')).filter(Boolean))];
      const machines = [...new Set(list.map(i => i.machine_name).filter(Boolean))];
      const dates = list.map(i => (i.test_datetime || '').slice(0, 10)).filter(Boolean);
      const genInfo = [
        `${list.length} injector${list.length === 1 ? '' : 's'}`,
        brands.length ? brands.join(', ') : null,
        machines.length ? `Bench: ${machines.join(', ')}` : null,
        dates.length ? `Tested: ${dates.sort()[0]}${dates.length > 1 ? ' – ' + dates.sort()[dates.length - 1] : ''}` : null,
      ].filter(Boolean).join('   ·   ');
      doc.fontSize(8).font('Helvetica').fillColor('#A5B4C8');
      doc.text(genInfo.toUpperCase(), titleX, top + 30, { width: titleW, align: 'center', lineBreak: false });

      // ── Column geometry ───────────────────────────────────────────────────
      // Fixed columns: Test Step (multi-line) + Specification (narrow). The
      // remaining width is split evenly across the injector columns.
      const tableTop = top + bannerH + 10;
      const n = Math.max(list.length, 1);
      // Test Step is the widest fixed column (holds Step Name + Pressure/Pulse/
      // Strk lines) but is kept NARROW to free horizontal space for the injector
      // value columns. Specification sits beside it with a distinct value/unit
      // treatment.
      let stepW = Math.max(120, Math.min(168, usableW * 0.17));
      let specW = Math.max(78, Math.min(104, usableW * 0.13));
      const MIN_INJ_COL = 44;
      let injColW = (usableW - stepW - specW) / n;
      if (injColW < MIN_INJ_COL) {
        // Shrink the fixed columns to guarantee everything fits on one page.
        const need = MIN_INJ_COL * n;
        const leftover = usableW - need;
        stepW = Math.max(104, leftover * 0.58);
        specW = Math.max(66, leftover * 0.42);
        injColW = (usableW - stepW - specW) / n;
      }
      const col1X = LM;
      const col2X = LM + stepW;
      const injStartX = LM + stepW + specW;

      // The Test Step cell needs up to 4 lines (name + 3 params); reserve a
      // taller minimum row height so it isn't cramped.
      const headerRowH = 22;
      const resultRowH = 20; // Pass/Fail summary row at the bottom
      const availH = pageH - LM - tableTop - headerRowH - resultRowH - 6;
      const dataRowCount = rowOrder.length || 1;
      let rowH = Math.floor(availH / dataRowCount);
      rowH = Math.max(30, Math.min(rowH, 44)); // room for the 4-line test step
      // If min row height overflows the page, fall back to the largest that fits.
      if (rowH * dataRowCount > availH) rowH = Math.max(24, Math.floor(availH / dataRowCount));
      const nameFont = rowH >= 38 ? 8 : (rowH >= 30 ? 7 : 6.2);
      const subFont = Math.max(5.2, nameFont - 1.6);
      // ── Dynamic measured-value font scaling ───────────────────────────────
      // The measured flow value must stay readable but never overflow its
      // column. Scale the font to the AVAILABLE COLUMN WIDTH (fewer injectors =
      // wider columns = larger font) as well as the row height. Widest sample
      // value determines how large we can safely go for the given injColW.
      let widestVal = 4; // at least a few chars ("—")
      injValues.forEach((m) => {
        m.forEach((cell) => {
          const s = String((cell && cell.value) || '');
          if (s.length > widestVal) widestVal = s.length;
        });
      });
      const rowValCap = rowH >= 38 ? 11 : (rowH >= 30 ? 9.5 : 8);
      // Width the value cell can use (minus padding), and the per-char width at
      // Helvetica-Bold is ~0.6em, so max font ≈ availWidth / (chars * 0.6).
      const valAvail = injColW - 6;
      const widthCappedFont = valAvail / (Math.max(widestVal, 1) * 0.6);
      const valFont = Math.max(6, Math.min(rowValCap, widthCappedFont));

      // ── Draw table header row ─────────────────────────────────────────────
      let y = tableTop;
      doc.rect(LM, y, usableW, headerRowH).fillColor(NAVY).fill();

      doc.fontSize(8).font('Helvetica-Bold').fillColor(WHITE);
      doc.text('TEST STEP', col1X + 4, y + 7, { width: stepW - 8, height: headerRowH - 6, lineBreak: false });
      doc.text('SPECIFICATION', col2X + 3, y + 7, { width: specW - 6, height: headerRowH - 6, align: 'center', lineBreak: false });

      // Header column separators
      doc.strokeColor('#3A4A6B').lineWidth(0.4).moveTo(col2X, y).lineTo(col2X, y + headerRowH).stroke();
      doc.strokeColor('#3A4A6B').lineWidth(0.4).moveTo(injStartX, y).lineTo(injStartX, y + headerRowH).stroke();

      // Injector column headers — SERIAL NUMBER ONLY.
      let x = injStartX;
      list.forEach((inj) => {
        doc.strokeColor('#3A4A6B').lineWidth(0.4).moveTo(x, y).lineTo(x, y + headerRowH).stroke();
        doc.fontSize(injColW < 58 ? 6.5 : 7.5).font('Helvetica-Bold').fillColor(WHITE);
        const sn = inj.serial_number || '—';
        doc.text(sn, x + 3, y + 7, { width: injColW - 6, height: headerRowH - 8, align: 'center', lineBreak: false, ellipsis: true });
        x += injColW;
      });

      y += headerRowH;

      // ── Draw data rows ────────────────────────────────────────────────────
      rowOrder.forEach((key, ri) => {
        const row = rowMap.get(key);
        const bg = ri % 2 === 1 ? ROWALT : WHITE;
        doc.rect(LM, y, usableW, rowH).fillColor(bg).fill();
        doc.strokeColor(BORDER).lineWidth(0.3).moveTo(LM, y + rowH).lineTo(LM + usableW, y + rowH).stroke();

        // ── Column 1: Test Step — Step Name + Pressure/Pulse/Strk lines ─────
        const p = row.params || {};
        const stepLines = [
          { t: row.label, bold: true },
          { t: `Pressure: ${p.rail_pressure || '—'}`, bold: false },
          { t: `Pulse: ${p.pulse_width || '—'}`, bold: false },
          { t: `Strk: ${p.strk || '—'}`, bold: false },
        ];
        const lineH = Math.min((rowH - 4) / stepLines.length, nameFont + 2.5);
        let ly = y + 2;
        stepLines.forEach((ln, li) => {
          doc.fontSize(li === 0 ? nameFont : subFont)
             .font(ln.bold ? 'Helvetica-Bold' : 'Helvetica')
             .fillColor(li === 0 ? BLACK : DGRAY);
          doc.text(ln.t, col1X + 4, ly, { width: stepW - 8, height: lineH + 1, lineBreak: false, ellipsis: true });
          ly += lineH;
        });

        // ── Column 2: Specification — value visually distinct from units ────
        // Split "8.5 +/- 4.5 mm3/STRK" into the numeric spec (bold, larger) and
        // the trailing unit (lighter, smaller) so the value stands out.
        const rawSpec = (row.spec || '').trim();
        const unitStr = (row.unit || '').trim();
        let specValue = rawSpec;
        if (unitStr && rawSpec.toLowerCase().endsWith(unitStr.toLowerCase())) {
          specValue = rawSpec.slice(0, rawSpec.length - unitStr.length).trim();
        }
        const specValFont = nameFont;
        const specUnitFont = Math.max(5, subFont - 0.3);
        if (specValue || unitStr) {
          // Two stacked lines: value on top (bold), unit below (light grey).
          const hasUnit = !!unitStr;
          const blockH = specValFont + (hasUnit ? specUnitFont + 1.5 : 0);
          let sy = y + (rowH - blockH) / 2 - 0.5;
          doc.fontSize(specValFont).font('Helvetica-Bold').fillColor(BLACK);
          doc.text(specValue || unitStr, col2X + 2, sy, {
            width: specW - 4, align: 'center', lineBreak: false, ellipsis: true,
          });
          if (hasUnit && specValue) {
            sy += specValFont + 1.5;
            doc.fontSize(specUnitFont).font('Helvetica').fillColor(LGRAY);
            doc.text(unitStr, col2X + 2, sy, {
              width: specW - 4, align: 'center', lineBreak: false, ellipsis: true,
            });
          }
        } else {
          doc.fontSize(nameFont).font('Helvetica').fillColor(DGRAY);
          doc.text('—', col2X + 2, y + (rowH - nameFont) / 2 - 1, {
            width: specW - 4, align: 'center', lineBreak: false,
          });
        }

        // Fixed-column separators
        doc.strokeColor(BORDER).lineWidth(0.3).moveTo(col2X, y).lineTo(col2X, y + rowH).stroke();
        doc.strokeColor(BORDER).lineWidth(0.3).moveTo(injStartX, y).lineTo(injStartX, y + rowH).stroke();

        // ── Injector columns: AVERAGE flow value, green/red ─────────────────
        let cx = injStartX;
        injValues.forEach((m) => {
          doc.strokeColor(BORDER).lineWidth(0.3).moveTo(cx, y).lineTo(cx, y + rowH).stroke();
          const cell = m.get(key);
          const val = cell ? (cell.value || '') : '';
          let color = DGRAY;
          if (cell) {
            if (cell.status === 'pass') color = GREEN;
            else if (cell.status === 'fail') color = RED;
          }
          doc.fontSize(valFont).font(cell && (cell.status === 'pass' || cell.status === 'fail') ? 'Helvetica-Bold' : 'Helvetica').fillColor(color);
          doc.text(val || '—', cx + 2, y + (rowH - valFont) / 2 - 1, { width: injColW - 4, align: 'center', lineBreak: false, ellipsis: true });
          cx += injColW;
        });

        y += rowH;
      });

      // ── Result row (overall Pass/Fail per injector) at the bottom ─────────
      const resultTop = y;
      doc.rect(LM, y, usableW, resultRowH).fillColor('#EDF1F7').fill();
      doc.fontSize(8).font('Helvetica-Bold').fillColor(NAVY);
      doc.text('RESULT', col1X + 4, y + (resultRowH - 8) / 2, { width: stepW - 8, height: resultRowH - 4, lineBreak: false });
      doc.text('', col2X + 2, y + 4, { width: specW - 4, align: 'center', lineBreak: false });
      doc.strokeColor(BORDER).lineWidth(0.3).moveTo(col2X, y).lineTo(col2X, y + resultRowH).stroke();
      doc.strokeColor(BORDER).lineWidth(0.3).moveTo(injStartX, y).lineTo(injStartX, y + resultRowH).stroke();
      let rx = injStartX;
      list.forEach((inj) => {
        doc.strokeColor(BORDER).lineWidth(0.3).moveTo(rx, y).lineTo(rx, y + resultRowH).stroke();
        const scored = (inj.tests || []).filter(t => t.primary && t.status !== 'skip');
        const failed = scored.filter(t => t.status === 'fail').length;
        const overall = scored.length === 0 ? '—' : (failed === 0 ? 'PASS' : 'FAIL');
        doc.fontSize(injColW < 58 ? 8 : 9).font('Helvetica-Bold')
           .fillColor(overall === 'FAIL' ? RED : (overall === 'PASS' ? GREEN : DGRAY));
        doc.text(overall, rx + 2, y + (resultRowH - 9) / 2, { width: injColW - 4, align: 'center', lineBreak: false });
        rx += injColW;
      });
      y += resultRowH;

      // ── Outer border ──────────────────────────────────────────────────────
      const tableBottom = y;
      doc.strokeColor(BORDER).lineWidth(0.6).rect(LM, tableTop, usableW, tableBottom - tableTop).stroke();
      doc.strokeColor(BORDER).lineWidth(0.4).moveTo(col2X, tableTop).lineTo(col2X, tableBottom).stroke();
      doc.strokeColor(BORDER).lineWidth(0.4).moveTo(injStartX, tableTop).lineTo(injStartX, tableBottom).stroke();
      // Line above the result row.
      doc.strokeColor(NAVY).lineWidth(0.8).moveTo(LM, resultTop).lineTo(LM + usableW, resultTop).stroke();

      // ── Footer ────────────────────────────────────────────────────────────
      const footY = pageH - LM - 8;
      if (footY > tableBottom + 2) {
        doc.fontSize(6.5).font('Helvetica').fillColor(LGRAY);
        doc.text(
          `Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · Flow value = average reading · Green = Pass · Red = Fail`,
          LM, footY, { width: usableW, align: 'right', lineBreak: false, height: 8 }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateInspectionPdf, generateInjectorComparisonPdf };
