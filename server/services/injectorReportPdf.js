'use strict';
/**
 * Landscape "Custom Report" comparing multiple injectors side by side:
 * column 1 = test step name + spec, one column per selected injector with
 * its own values, colour-coded green (pass) / red (fail). Column width
 * scales down to fit every selected injector on one page width-wise.
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '../assets/pdi-logo.png');

const NAVY   = '#1D2B4F';
const RED    = '#C0392B';
const GREEN  = '#27AE60';
const GRAY   = '#6B7280';
const LGRAY  = '#9CA3AF';
const BORDER = '#D1D5DB';
const THBG   = '#E5E7EB';
const ROWALT = '#F9FAFB';
const WHITE  = '#FFFFFF';
const DGRAY  = '#374151';

const M       = 36;
const PAGE_W  = 792; // Letter landscape
const PAGE_H  = 612;
const PW      = PAGE_W - M * 2;
const FOOT    = 26;

const FIRST_COL_W = 190;
const MIN_COL_W   = 50;
const MAX_FONT    = 8;
const MIN_FONT    = 5.5;

function generateInjectorComparisonPdf(injectors) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ bufferPages: true, margin: M, size: 'Letter', layout: 'landscape' });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const count = injectors.length || 1;
      const availableForCols = PW - FIRST_COL_W;
      const colW = Math.max(MIN_COL_W, availableForCols / count);
      const fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, MAX_FONT - Math.max(0, count - 8) * 0.25));

      const partNumbers = new Set(injectors.map(i => i.part_number).filter(Boolean));
      const partLabel = partNumbers.size === 1
        ? [...partNumbers][0]
        : (partNumbers.size > 1 ? 'Multiple Part Numbers' : '—');

      let y = renderHeader(doc, { partLabel, count: injectors.length });
      y = renderColumnHeader(doc, injectors, y, colW, fontSize);

      // Union of test-step rows across all selected injectors, first-seen order.
      const stepOrder = [];
      const stepSpecs = new Map();
      for (const inj of injectors) {
        for (const t of inj.tests) {
          if (!stepOrder.includes(t.name)) {
            stepOrder.push(t.name);
            stepSpecs.set(t.name, t.spec || '');
          }
        }
      }

      const rowH = 18;
      stepOrder.forEach((stepName, idx) => {
        if (y + rowH > PAGE_H - FOOT) {
          doc.addPage();
          y = renderHeader(doc, { partLabel, count: injectors.length });
          y = renderColumnHeader(doc, injectors, y, colW, fontSize);
        }
        if (idx % 2 === 1) {
          doc.rect(M, y, PW, rowH).fillColor(ROWALT).fill();
        }
        doc.fontSize(fontSize).font('Helvetica-Bold').fillColor(DGRAY)
          .text(stepName, M + 4, y + 2, { width: FIRST_COL_W - 8, lineBreak: false });
        const spec = stepSpecs.get(stepName);
        if (spec) {
          doc.fontSize(Math.max(fontSize - 1, 5)).font('Helvetica').fillColor(GRAY)
            .text(spec, M + 4, y + 2 + fontSize + 1, { width: FIRST_COL_W - 8, lineBreak: false });
        }
        injectors.forEach((inj, ci) => {
          const cx = M + FIRST_COL_W + ci * colW;
          const t = inj.tests.find(tt => tt.name === stepName);
          const val = t ? (t.actual || '—') : '—';
          const color = !t ? LGRAY : (t.pass === true ? GREEN : (t.pass === false ? RED : DGRAY));
          doc.fontSize(fontSize).font('Helvetica-Bold').fillColor(color)
            .text(val, cx + 2, y + rowH / 2 - fontSize / 2, { width: colW - 4, align: 'center', lineBreak: false });
        });
        doc.strokeColor(BORDER).lineWidth(0.4).moveTo(M, y + rowH).lineTo(M + PW, y + rowH).stroke();
        y += rowH;
      });

      // doc.text() auto-adds a page when called below page.maxY() (height -
      // margins.bottom = 612 - 36 = 576); the footer sits at 594. Temporarily
      // shrink the bottom margin so pdfkit allows rendering there without
      // silently appending a blank trailing page (same fix as services/pdf.js).
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 5;
        doc.fontSize(7).font('Helvetica').fillColor(LGRAY)
          .text(`Page ${i + 1} of ${range.count}  ·  Generated ${new Date().toLocaleString()}`,
            M, PAGE_H - 18, { width: PW, align: 'right', lineBreak: false });
        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function renderHeader(doc, { partLabel, count }) {
  const top = M - 10;
  const bannerH = 44;
  doc.rect(M, top, PW, bannerH).fillColor(NAVY).fill();
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M + 10, top + 9, { height: 26, fit: [80, 26] }); } catch (_) { /* logo optional */ }
  }
  doc.fontSize(13).font('Helvetica-Bold').fillColor(WHITE)
    .text('INJECTOR FLOW TEST — COMPARISON REPORT', M + 100, top + 7, { width: PW - 110, align: 'center', lineBreak: false });
  doc.fontSize(9).font('Helvetica').fillColor(WHITE)
    .text(`Part Number: ${partLabel}   ·   ${count} injector(s)   ·   Generated ${new Date().toLocaleString()}`,
      M + 100, top + 25, { width: PW - 110, align: 'center', lineBreak: false });
  return top + bannerH + 14;
}

function renderColumnHeader(doc, injectors, y, colW, fontSize) {
  const h = 32;
  doc.rect(M, y, PW, h).fillColor(THBG).fill();
  doc.fontSize(8).font('Helvetica-Bold').fillColor(DGRAY)
    .text('Test Step / Specification', M + 4, y + 11, { width: FIRST_COL_W - 8, lineBreak: false });
  injectors.forEach((inj, ci) => {
    const cx = M + FIRST_COL_W + ci * colW;
    const resultColor = inj.overall_result === 'PASS' ? GREEN : (inj.overall_result === 'FAIL' ? RED : GRAY);
    doc.fontSize(Math.max(fontSize, 6)).font('Helvetica-Bold').fillColor(NAVY)
      .text(inj.serial_number || `#${ci + 1}`, cx + 2, y + 4, { width: colW - 4, align: 'center', lineBreak: false });
    doc.fontSize(Math.max(fontSize - 1, 5.5)).font('Helvetica-Bold').fillColor(resultColor)
      .text(inj.overall_result || '—', cx + 2, y + 17, { width: colW - 4, align: 'center', lineBreak: false });
  });
  doc.strokeColor(BORDER).lineWidth(0.6).moveTo(M, y + h).lineTo(M + PW, y + h).stroke();
  return y + h + 2;
}

module.exports = { generateInjectorComparisonPdf };
