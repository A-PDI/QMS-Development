'use strict';
/**
 * Reusable pagination maths for column-per-injector reports.
 *
 * The injector comparison grid puts one COLUMN per injector. A large batch
 * (30, 100 …) cannot fit legibly on a single landscape page, so instead of
 * squeezing columns below a readable width we cap the columns per page and
 * continue on further pages.
 *
 * Kept free of pdfkit so the page-capacity rules can be unit-tested on their
 * own and reused by any other column-based report.
 */

// Narrowest injector column that still renders a readable serial-number header
// and measured value at the report's font sizes (points, landscape Letter).
const MIN_INJECTOR_COL_W = 44;

/**
 * How many injector columns fit on one page.
 *
 * @param {number} usableWidth    page width minus both margins
 * @param {number} fixedWidth     width taken by the fixed columns (step + spec)
 * @param {number} minColumnWidth minimum readable injector column width
 * @returns {number} at least 1 (a single column always gets its own page)
 */
function maxInjectorColumnsPerPage(usableWidth, fixedWidth, minColumnWidth = MIN_INJECTOR_COL_W) {
  const available = Number(usableWidth) - Number(fixedWidth);
  const min = Number(minColumnWidth) > 0 ? Number(minColumnWidth) : MIN_INJECTOR_COL_W;
  if (!Number.isFinite(available) || available < min) return 1;
  return Math.max(1, Math.floor(available / min));
}

/**
 * Split a list into fixed-size pages, preserving order.
 * chunk([1..30], 12) → [[1..12], [13..24], [25..30]]
 */
function chunk(items, perPage) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.floor(Number(perPage) || 1));
  const pages = [];
  for (let i = 0; i < list.length; i += size) pages.push(list.slice(i, i + size));
  return pages.length ? pages : [[]];
}

/**
 * Full page plan for a column-per-injector report.
 * Returns { perPage, pageCount, pages: [{ index, items, firstItemNumber, lastItemNumber }] }
 */
function planInjectorPages(injectors, { usableWidth, fixedWidth, minColumnWidth = MIN_INJECTOR_COL_W } = {}) {
  const list = Array.isArray(injectors) ? injectors : [];
  const perPage = maxInjectorColumnsPerPage(usableWidth, fixedWidth, minColumnWidth);
  const groups = chunk(list, perPage);
  const pages = groups.map((items, index) => ({
    index,
    items,
    firstItemNumber: index * perPage + 1,
    lastItemNumber: index * perPage + items.length,
  }));
  return { perPage, pageCount: pages.length, pages };
}

module.exports = {
  MIN_INJECTOR_COL_W,
  maxInjectorColumnsPerPage,
  chunk,
  planInjectorPages,
};
