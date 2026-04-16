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
      const secDefs = template.sections        || {};
      const itemAtts    = attachments.filter(a => a.section_key);
      const generalAtts = attachments.filter(a => !a.section_key);

      for (const [key, def] of Object.entries(secDefs)) {
        if (key === '__dimensional_added') continue;
        if (def.optional && !sd.__dimensional_added) continue;

        const data     = sd[key];
        const secAtts  = itemAtts.filter(a => a.section_key === key);

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

      // ── Final disposition ─────────────────────────────────────────────────
      if (inspection.disposition) {
        ensureSpace(doc, 60);
        renderSectionTitle(doc, 'Final Result');

        const color = ['FAIL', 'REJECT'].includes(inspection.disposition) ? RED
          : ['PASS', 'ACCEPT'].includes(inspection.disposition) ? GREEN : AMBER;

        const bY = doc.y;
        doc.roundedRect(M, bY, PW, 32, 3).fillColor(color).fill();
        const tY = bY + (32 - 12) / 2;
        doc.fontSize(12).font('Helvetica-Bold').fillColor(WHITE)
          .text(inspection.disposition, M, tY, { width: PW, align: 'center', lineBreak: false });
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
    // Background
    let bg = WHITE;
    if (isHeader) {
      bg = THBG;
    } else if (statusColIdx >= 0) {
      const sv = String(row[statusColIdx] == null ? '' : row[statusColIdx]).toUpperCase();
      if      (['F', 'FAIL', 'REJECT'].includes(sv)) bg = '#FEE2E2';
      else if (['P', 'PASS', 'ACCEPT'].includes(sv)) bg = '#DCFCE7';
      else if (rowIndex % 2 === 1)                   bg = ROWALT;
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
  const maxW = 180, maxH = 135, gap = 10;
  let xp      = M;
  let rowBaseY = null;

  for (const att of atts) {
    if (!att.file_path || !fs.existsSync(att.file_path)) continue;

    // Start a new row if this image won't fit horizontally
    if (xp + maxW > M + PW) {
      doc.y = rowBaseY + maxH + gap;
      xp    = M;
    }
    ensureSpace(doc, maxH + 4);
    if (rowBaseY === null || xp === M) rowBaseY = doc.y;

    try {
      doc.image(att.file_path, xp, rowBaseY, { fit: [maxW, maxH] });
    } catch (err) {
      console.error(`[PDF] Failed to embed attachment ${att.file_name}:`, err.message);
    }
    xp += maxW + gap;
  }
  // Advance cursor past the last row of images
  if (rowBaseY !== null) doc.y = rowBaseY + maxH + gap + 4;
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

  for (const item of items) {
    renderItemImages(doc, item.id, secAtts);
  }
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

  for (const item of items) {
    renderItemImages(doc, item.id, secAtts);
  }
}

function renderDimensional(doc, section, data, secAtts = []) {
  const title = section.title || 'Dimensional Inspection';
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  const items   = section.items || [];
  const dataArr = Array.isArray(data) ? data : [];

  const header = ['#', 'Measurement', 'Location', 'Spec', 'Actual 1', 'Actual 2', 'Actual 3', 'Status'];
  const cw     = [24, 130, 80, 68, 60, 60, 60, 50]; // sum = 532
  const rows   = items.map(item => {
    const d = dataArr.find(r => r.id === item.id) || {};
    return [String(item.id), item.measurement || '', item.location || '', item.spec || '',
      d.actual1 || '', d.actual2 || '', d.actual3 || '', d.status || ''];
  });

  renderTable(doc, header, rows, cw, { statusColIdx: 7, sectionTitle: title });

  for (const item of items) {
    renderItemImages(doc, item.id, secAtts);
  }
}

function renderPassFail(doc, section, data, secAtts = []) {
  const title = section.title || 'Pass / Fail Checklist';
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  const items   = section.items || [];
  const dataArr = Array.isArray(data) ? data : [];

  const header = ['#', 'Inspection Item', 'Requirement', 'Pass', 'Fail', 'Notes'];
  const cw     = [24, 150, 160, 32, 32, 134]; // sum = 532
  const rows   = items.map(item => {
    const d = dataArr.find(r => r.id === item.id) || {};
    return [String(item.id), item.name || item.description || '', item.requirement || '',
      d.pass ? '✓' : '', d.fail ? '✗' : '', d.notes || ''];
  });

  renderTable(doc, header, rows, cw, { sectionTitle: title });

  for (const item of items) {
    renderItemImages(doc, item.id, secAtts);
  }
}

function renderGeneralMeasurements(doc, section, data, secAtts = []) {
  const title = section.title || 'General Measurements';
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  const items   = section.items || [];
  const dataArr = Array.isArray(data) ? data : [];

  const notesW = Math.max(40, PW - 22 - 128 - 128 - 128);
  const header = ['#', 'Measurement', 'Specification', 'Actual Value', 'Notes'];
  const cw     = [22, 128, 128, 128, notesW];
  const rows   = items.map(item => {
    const d = dataArr.find(r => r.id === item.id) || {};
    return [String(item.id), item.measurement || '', d.specification || '',
      d.actual_value || '', d.notes || ''];
  });

  renderTable(doc, header, rows, cw, { sectionTitle: title });

  for (const item of items) {
    renderItemImages(doc, item.id, secAtts);
  }
}

function renderCamshaftBore(doc, section, data, secAtts = []) {
  const title = section.title || 'Camshaft Bore';
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  data       = data || {};
  const bc   = section.bore_count || 7;
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
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  data       = data || {};
  const cc   = section.cylinder_count || 6;
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
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  data       = data || {};
  const cc   = section.cylinder_count || 6;
  const cw   = [56, 119, 119, 119, 119]; // sum = 532

  const header   = ['Cyl', 'Int 1', 'Int 2', 'Exh 1', 'Exh 2'];
  const cyls     = Array.isArray(data.cylinders) ? data.cylinders : Array(cc).fill({});
  const dataRows = Array.from({ length: cc }, (_, i) => {
    const c = cyls[i] || {};
    return [`C${i + 1}`, c.int1 || '', c.int2 || '', c.exh1 || '', c.exh2 || ''];
  });

  renderTable(doc, header, dataRows, cw, { sectionTitle: title });
}

function renderVacuumTest(doc, section, data, secAtts = []) {
  const title = section.title || 'Vacuum Test';
  ensureSpace(doc, 60);
  renderSectionTitle(doc, title);

  data       = data || {};
  const cc   = section.cylinder_count || 6;
  const cw   = [44, 98, 98, 98, 98, 96]; // sum = 532

  const header   = ['Cyl', 'Int 1', 'Int 2', 'Exh 1', 'Exh 2', 'Overall'];
  const cyls     = Array.isArray(data.cylinders) ? data.cylinders : Array(cc).fill({});
  const dataRows = Array.from({ length: cc }, (_, i) => {
    const c = cyls[i] || {};
    return [`C${i + 1}`, c.int1 || '', c.int2 || '', c.exh1 || '', c.exh2 || '', c.overall || ''];
  });

  renderTable(doc, header, dataRows, cw, { sectionTitle: title });
}

module.exports = { generateInspectionPdf };
