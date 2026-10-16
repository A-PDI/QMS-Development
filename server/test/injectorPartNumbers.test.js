'use strict';
/**
 * The bench's part number translated to PDI's, which is what the Google Sheet
 * is read as a record of.
 *
 * Matching is on the core number appearing anywhere in the bench part, so the
 * cases below are mostly about spellings the bench has produced or could.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  PART_NUMBER_RULES,
  ruleFor,
  isMapped,
  displayPartNumber,
  unmappedPartNumbers,
} = require('../services/injectorPartNumbers');

test('the rules are the three PDI supplied', () => {
  assert.deepStrictEqual(PART_NUMBER_RULES, [
    { core: '2872405', display: '7159417' },
    { core: '2897320', display: '7159419' },
    { core: '4327147', display: '7159421' },
  ]);
});

test('no core contains another, so the result never depends on rule order', () => {
  for (const outer of PART_NUMBER_RULES) {
    for (const inner of PART_NUMBER_RULES) {
      if (outer === inner) continue;
      assert.ok(
        !outer.core.includes(inner.core),
        `${outer.core} contains ${inner.core}; a bench part matching one would match both`,
      );
    }
  }
});

test('every spelling from the original chart still translates', () => {
  const chart = [
    ['2872405', '7159417'],
    ['2897320', '7159419'],
    ['2897320 (Beta)', '7159419'],
    ['P4327147', '7159421'],
    ['P4327147 (Beta)', '7159421'],
    ['P4327147-Eval', '7159421'],
    ['P4327147-QC', '7159421'],
  ];
  for (const [bench, display] of chart) {
    assert.strictEqual(displayPartNumber(bench), display, `${bench} should display as ${display}`);
  }
});

test('the spacing the bench actually produced is matched', () => {
  // These are the spellings that an exact-match table missed.
  assert.strictEqual(displayPartNumber('P4327147 - Eval'), '7159421');
  assert.strictEqual(displayPartNumber('P4327147 - QC'), '7159421');
  assert.strictEqual(displayPartNumber('2897320 - Beta'), '7159419');
});

test('a core found anywhere in the value translates it', () => {
  const variants = [
    'P4327147', '4327147', 'p4327147', 'P4327147 (Beta)', 'P4327147 - Eval',
    'P4327147_QC', 'PDI-4327147', '4327147 REV B', 'P4327147/2', '  p4327147  -  qc  ',
    'XYZ 4327147 ABC',
  ];
  for (const bench of variants) {
    assert.strictEqual(displayPartNumber(bench), '7159421', `"${bench}" should translate`);
    assert.strictEqual(isMapped(bench), true);
  }
  assert.strictEqual(displayPartNumber('2872405-Eval'), '7159417');
  assert.strictEqual(displayPartNumber('CZ 2897320 (QC)'), '7159419');
});

test('a core broken up by a stray separator is still found', () => {
  // Matching also runs against the value with separators stripped, so a space
  // or hyphen dropped into the middle of the number does not lose the part.
  assert.strictEqual(displayPartNumber('P4327 147'), '7159421');
  assert.strictEqual(displayPartNumber('4327-147'), '7159421');
  assert.strictEqual(displayPartNumber('287 2405'), '7159417');
});

test('a part no rule covers passes through, and is reported', () => {
  for (const bench of ['6513589PX', '0445120231', '1234567', 'P9999999-Eval']) {
    assert.strictEqual(displayPartNumber(bench), bench);
    assert.strictEqual(isMapped(bench), false);
    assert.strictEqual(ruleFor(bench), null);
  }
  assert.deepStrictEqual(
    unmappedPartNumbers(['P4327147 - QC', '6513589PX', '2872405', '6513589PX', 'NEW-PART']),
    ['6513589PX', 'NEW-PART'],
  );
});

test('an empty part number stays empty and is not reported', () => {
  for (const blank of ['', '   ', null, undefined]) {
    assert.strictEqual(displayPartNumber(blank), '');
    assert.strictEqual(isMapped(blank), false);
  }
  assert.deepStrictEqual(unmappedPartNumbers(['', null, '   ']), []);
});

test('unmapped parts are listed once each however they were spelled', () => {
  assert.deepStrictEqual(unmappedPartNumbers(['New-Part', 'NEW-PART ', 'new-part']), ['New-Part']);
  assert.deepStrictEqual(unmappedPartNumbers([]), []);
});
