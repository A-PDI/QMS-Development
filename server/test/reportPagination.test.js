'use strict';
/**
 * Page-capacity maths for the column-per-injector reports.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  MIN_INJECTOR_COL_W,
  maxInjectorColumnsPerPage,
  chunk,
  planInjectorPages,
} = require('../services/reportPagination');

test('column capacity comes from the usable width and the minimum column width', () => {
  // Landscape Letter: 792pt − 2×28pt margins = 736pt usable.
  // With 160pt of fixed columns and a 44pt minimum: floor(576 / 44) = 13.
  assert.strictEqual(maxInjectorColumnsPerPage(736, 160, 44), 13);
  assert.strictEqual(maxInjectorColumnsPerPage(736, 208, 44), 12);
  assert.strictEqual(maxInjectorColumnsPerPage(736, 160, 60), 9);
  assert.strictEqual(MIN_INJECTOR_COL_W, 44);
});

test('capacity never drops below one column, even in impossible geometry', () => {
  assert.strictEqual(maxInjectorColumnsPerPage(100, 100, 44), 1);
  assert.strictEqual(maxInjectorColumnsPerPage(0, 0, 44), 1);
  assert.strictEqual(maxInjectorColumnsPerPage(NaN, 10, 44), 1);
});

test('chunk splits a batch into ordered pages', () => {
  const items = Array.from({ length: 30 }, (_, i) => i + 1);
  const pages = chunk(items, 12);

  assert.strictEqual(pages.length, 3);
  assert.deepStrictEqual(pages[0], items.slice(0, 12));
  assert.deepStrictEqual(pages[1], items.slice(12, 24));
  assert.deepStrictEqual(pages[2], items.slice(24));
  // Nothing lost, nothing duplicated, order preserved.
  assert.deepStrictEqual(pages.flat(), items);
});

test('the documented example: 12 per page, 30 injectors → 12 / 12 / 6', () => {
  const injectors = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));
  const plan = planInjectorPages(injectors, { usableWidth: 736, fixedWidth: 208, minColumnWidth: 44 });

  assert.strictEqual(plan.perPage, 12);
  assert.strictEqual(plan.pageCount, 3);
  assert.deepStrictEqual(plan.pages.map((p) => p.items.length), [12, 12, 6]);
  assert.deepStrictEqual(plan.pages.map((p) => [p.firstItemNumber, p.lastItemNumber]), [[1, 12], [13, 24], [25, 30]]);
});

test('a batch that fits stays on one page', () => {
  const plan = planInjectorPages(Array.from({ length: 4 }, (_, i) => ({ id: i })), {
    usableWidth: 736, fixedWidth: 208, minColumnWidth: 44,
  });
  assert.strictEqual(plan.pageCount, 1);
  assert.strictEqual(plan.pages[0].items.length, 4);
});

test('an empty selection still yields one (empty) page rather than crashing', () => {
  const plan = planInjectorPages([], { usableWidth: 736, fixedWidth: 208 });
  assert.strictEqual(plan.pageCount, 1);
  assert.deepStrictEqual(plan.pages[0].items, []);
});

test('100 injectors paginate without exceeding the per-page capacity', () => {
  const plan = planInjectorPages(Array.from({ length: 100 }, (_, i) => ({ id: i })), {
    usableWidth: 736, fixedWidth: 208, minColumnWidth: 44,
  });
  assert.strictEqual(plan.pageCount, Math.ceil(100 / plan.perPage));
  assert.ok(plan.pages.every((p) => p.items.length <= plan.perPage));
  assert.strictEqual(plan.pages.reduce((a, p) => a + p.items.length, 0), 100);
});
