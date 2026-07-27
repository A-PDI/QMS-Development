'use strict';
/**
 * Small, dependency-free chart/stat primitives drawn straight onto a pdfkit
 * document. Used by the Shipment Evaluation Report; kept separate from the
 * report layouts so the same building blocks can be reused elsewhere.
 *
 * Everything here is pure presentation — callers pass in already-calculated
 * numbers (see services/injectorEvaluation.js).
 */

const NAVY = '#1D2B4F';
const TEAL = '#1A8C80';
const RED = '#C0392B';
const GREEN = '#27AE60';
const AMBER = '#D4943A';
const BLACK = '#111827';
const DGRAY = '#374151';
const MGRAY = '#6B7280';
const LGRAY = '#9CA3AF';
const BORDER = '#D1D5DB';
const PANEL = '#F9FAFB';
const WHITE = '#FFFFFF';

/** Panel with a title bar — the shared frame for charts and side tables. */
function drawPanel(doc, { x, y, width, height, title, note }) {
  doc.rect(x, y, width, height).fillColor(WHITE).fill();
  doc.strokeColor(BORDER).lineWidth(0.6).rect(x, y, width, height).stroke();

  let cursor = y + 8;
  if (title) {
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(NAVY);
    doc.text(title, x + 10, cursor, { width: width - 20, lineBreak: false, ellipsis: true });
    cursor += 13;
  }
  if (note) {
    doc.fontSize(6.8).font('Helvetica').fillColor(MGRAY);
    doc.text(note, x + 10, cursor, { width: width - 20, height: 16 });
    cursor = Math.max(cursor + 8, doc.y + 2);
  }
  return cursor;
}

/**
 * Horizontal bar chart.
 *
 * rows: [{ label, value, valueText?, color?, muted? }]
 * Bars are drawn in the order given — callers rank them beforehand.
 */
function drawHorizontalBarChart(doc, {
  x, y, width, height, title, note, rows = [],
  color = TEAL, maxValue = null, emptyMessage = 'No data', valueSuffix = '',
}) {
  const contentTop = drawPanel(doc, { x, y, width, height, title, note });
  const areaX = x + 10;
  const areaY = contentTop + 4;
  const areaW = width - 20;
  const areaH = y + height - areaY - 10;

  const visible = rows.filter((r) => r && r.label != null);
  if (visible.length === 0 || areaH <= 12) {
    doc.fontSize(8).font('Helvetica-Oblique').fillColor(MGRAY);
    doc.text(emptyMessage, areaX, areaY + Math.max(0, areaH / 2 - 5), { width: areaW, align: 'center', lineBreak: false });
    return y + height;
  }

  // Label column sized to content, capped so bars keep at least half the width.
  const labelFont = visible.length > 8 ? 6.5 : 7.5;
  doc.font('Helvetica').fontSize(labelFont);
  let labelW = 0;
  visible.forEach((r) => { labelW = Math.max(labelW, doc.widthOfString(String(r.label))); });
  labelW = Math.min(areaW * 0.42, labelW + 6);

  // Value column sized to the widest value text.
  doc.font('Helvetica-Bold').fontSize(labelFont);
  let valueW = 0;
  visible.forEach((r) => {
    const txt = r.valueText != null ? String(r.valueText) : `${r.value}${valueSuffix}`;
    valueW = Math.max(valueW, doc.widthOfString(txt));
  });
  valueW = Math.min(areaW * 0.22, valueW + 8);

  const barsX = areaX + labelW + 4;
  const barsW = Math.max(10, areaW - labelW - valueW - 8);
  // Keep rows compact when there are only a few of them, instead of spreading
  // two bars over the whole panel.
  const slotH = Math.min(areaH / visible.length, 30);
  const barH = Math.max(4, Math.min(16, slotH - 4));

  // Scale to a slightly rounded-up maximum so the longest bar doesn't run the
  // full width of its track (which reads as "100%").
  const rawMax = Math.max(...visible.map((r) => Number(r.value) || 0), 0);
  const max = maxValue != null && maxValue > 0 ? maxValue : niceCeiling(rawMax);

  visible.forEach((r, i) => {
    const slotY = areaY + i * slotH;
    const barY = slotY + (slotH - barH) / 2;
    const value = Number(r.value) || 0;
    const len = max > 0 ? Math.max(value > 0 ? 1.5 : 0, (value / max) * barsW) : 0;

    doc.fontSize(labelFont).font('Helvetica').fillColor(r.muted ? LGRAY : DGRAY);
    doc.text(String(r.label), areaX, barY + (barH - labelFont) / 2, {
      width: labelW, align: 'left', lineBreak: false, ellipsis: true,
    });

    // Track + bar
    doc.rect(barsX, barY, barsW, barH).fillColor(PANEL).fill();
    if (len > 0) doc.rect(barsX, barY, len, barH).fillColor(r.color || color).fill();

    const txt = r.valueText != null ? String(r.valueText) : `${value}${valueSuffix}`;
    doc.fontSize(labelFont).font('Helvetica-Bold').fillColor(r.muted ? MGRAY : BLACK);
    doc.text(txt, barsX + barsW + 4, barY + (barH - labelFont) / 2, {
      width: valueW, align: 'left', lineBreak: false, ellipsis: true,
    });
  });

  return y + height;
}

/** Round a chart maximum up to a readable step (2 → 2, 1.97 → 2, 13 → 15). */
function niceCeiling(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(v)));
  const scaled = v / magnitude;
  const step = scaled <= 1 ? 1 : (scaled <= 1.5 ? 1.5 : (scaled <= 2 ? 2 : (scaled <= 3 ? 3 : (scaled <= 5 ? 5 : 10))));
  return step * magnitude;
}

/**
 * A row of KPI cards (Total / Passed / Failed / Pass % / Fail %).
 * cards: [{ label, value, sub?, color? }]
 */
function drawStatCards(doc, { x, y, width, height, cards = [], gap = 8 }) {
  if (!cards.length) return y;
  const cardW = (width - gap * (cards.length - 1)) / cards.length;

  cards.forEach((card, i) => {
    const cx = x + i * (cardW + gap);
    doc.roundedRect(cx, y, cardW, height, 4).fillColor(WHITE).fill();
    doc.strokeColor(BORDER).lineWidth(0.6).roundedRect(cx, y, cardW, height, 4).stroke();
    // Accent stripe
    doc.rect(cx, y, 3.5, height).fillColor(card.color || NAVY).fill();

    doc.fontSize(6.8).font('Helvetica-Bold').fillColor(MGRAY);
    doc.text(String(card.label || '').toUpperCase(), cx + 10, y + 8, {
      width: cardW - 16, lineBreak: false, ellipsis: true,
    });

    doc.fontSize(height >= 56 ? 17 : 14).font('Helvetica-Bold').fillColor(card.color || NAVY);
    doc.text(String(card.value == null ? '—' : card.value), cx + 10, y + 22, {
      width: cardW - 16, lineBreak: false, ellipsis: true,
    });

    if (card.sub) {
      doc.fontSize(6.8).font('Helvetica').fillColor(MGRAY);
      doc.text(String(card.sub), cx + 10, y + height - 14, {
        width: cardW - 16, lineBreak: false, ellipsis: true,
      });
    }
  });

  return y + height;
}

/**
 * Compact table used inside a panel.
 * columns: [{ header, width, align?, key }]
 * rows:    [{ [key]: value, __color?: '#hex' }]
 */
function drawCompactTable(doc, { x, y, width, height, title, note, columns = [], rows = [], emptyMessage = 'No data' }) {
  const contentTop = drawPanel(doc, { x, y, width, height, title, note });
  const tableX = x + 10;
  const tableW = width - 20;
  let cursor = contentTop + 2;

  const totalDeclared = columns.reduce((a, c) => a + (c.width || 0), 0) || 1;
  const widths = columns.map((c) => (c.width ? (c.width / totalDeclared) * tableW : tableW / columns.length));

  // Header row
  const headerH = 14;
  doc.rect(tableX, cursor, tableW, headerH).fillColor('#EEF2F7').fill();
  let hx = tableX;
  columns.forEach((c, i) => {
    doc.fontSize(6.8).font('Helvetica-Bold').fillColor(NAVY);
    doc.text(String(c.header || ''), hx + 4, cursor + 4, {
      width: widths[i] - 8, align: c.align || 'left', lineBreak: false, ellipsis: true,
    });
    hx += widths[i];
  });
  cursor += headerH;

  const bodyBottom = y + height - 8;
  if (!rows.length) {
    doc.fontSize(8).font('Helvetica-Oblique').fillColor(MGRAY);
    doc.text(emptyMessage, tableX, cursor + 8, { width: tableW, align: 'center', lineBreak: false });
    return y + height;
  }

  const rowH = Math.max(10, Math.min(16, (bodyBottom - cursor) / rows.length));
  const fontSize = rowH >= 13 ? 7.5 : 6.6;

  rows.forEach((row, ri) => {
    if (cursor + rowH > bodyBottom + 0.5) return; // never overflow the panel
    if (ri % 2 === 1) doc.rect(tableX, cursor, tableW, rowH).fillColor(PANEL).fill();
    let cx = tableX;
    columns.forEach((c, i) => {
      const raw = row[c.key];
      doc.fontSize(fontSize).font(c.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(row.__color && c.colored ? row.__color : DGRAY);
      doc.text(raw == null ? '—' : String(raw), cx + 4, cursor + (rowH - fontSize) / 2, {
        width: widths[i] - 8, align: c.align || 'left', lineBreak: false, ellipsis: true,
      });
      cx += widths[i];
    });
    doc.strokeColor(BORDER).lineWidth(0.25)
      .moveTo(tableX, cursor + rowH).lineTo(tableX + tableW, cursor + rowH).stroke();
    cursor += rowH;
  });

  return y + height;
}

module.exports = {
  drawPanel,
  drawHorizontalBarChart,
  drawStatCards,
  drawCompactTable,
  COLORS: { NAVY, TEAL, RED, GREEN, AMBER, BLACK, DGRAY, MGRAY, LGRAY, BORDER, PANEL, WHITE },
};
