'use strict';
/**
 * The bench's part number translated to PDI's, which is what the Google Sheet
 * is read as a record of.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  PART_NUMBER_DISPLAY_MAP,
  lookupKey,
  isMapped,
  displayPartNumber,
  unmappedPartNumbers,
} = require('../services/injectorPartNumbers');

test('the table PDI supplied is translated exactly', () => {
  const expected = {
    '2872405': '7159417',
    '2897320': '7159419',
    '2897320 (Beta)': '7159419',
    'P4327147': '7159421',
    'P4327147 (Beta)': '7159421',
    'P4327147-Eval': '7159421',
    'P4327147-QC': '7159421',
  };
  assert.deepStrictEqual(PART_NUMBER_DISPLAY_MAP, expected, 'the stored table is the one supplied');
  for (const [bench, display] of Object.entries(expected)) {
    assert.strictEqual(displayPartNumber(bench), display, `${bench} should display as ${display}`);
    assert.strictEqual(isMapped(bench), true);
  }
});

test('every variant of a part lands on the same PDI number', () => {
  assert.deepStrictEqual(
    ['P4327147', 'P4327147 (Beta)', 'P4327147-Eval', 'P4327147-QC'].map(displayPartNumber),
    ['7159421', '7159421', '7159421', '7159421'],
  );
  assert.deepStrictEqual(
    ['2897320', '2897320 (Beta)'].map(displayPartNumber),
    ['7159419', '7159419'],
  );
});

test('case and stray whitespace do not stop a match', () => {
  for (const spelling of [
    '  2872405  ',
    'p4327147 (beta)',
    'P4327147  (Beta)',
    '\tP4327147-eval\n',
    'p4327147-QC',
  ]) {
    assert.strictEqual(isMapped(spelling), true, `"${spelling}" should still be recognised`);
  }
  assert.strictEqual(displayPartNumber('  p4327147 (BETA) '), '7159421');
  assert.strictEqual(lookupKey(' p4327147  (beta) '), 'P4327147 (BETA)');
});

test('a part that is not in the table passes through, rather than being guessed at', () => {
  // A suffix this table has never seen could be a variant or a different part.
  // Writing the bench's own value makes it visible in the sheet; inventing a
  // PDI number for it would file a new part under an existing one.
  assert.strictEqual(displayPartNumber('P4327147-Dev'), 'P4327147-Dev');
  assert.strictEqual(displayPartNumber('6513589PX'), '6513589PX');
  assert.strictEqual(displayPartNumber('0445120231'), '0445120231');
  assert.strictEqual(isMapped('P4327147-Dev'), false);
  // A near-miss on a mapped number is still not that number.
  assert.strictEqual(displayPartNumber('28724050'), '28724050');
  assert.strictEqual(displayPartNumber('2872405-X'), '2872405-X');
});

test('an empty part number stays empty', () => {
  for (const blank of ['', '   ', null, undefined]) {
    assert.strictEqual(displayPartNumber(blank), '');
    assert.strictEqual(isMapped(blank), false);
  }
});

test('unmapped parts are listed once each, in the order first seen', () => {
  assert.deepStrictEqual(
    unmappedPartNumbers(['2872405', '6513589PX', 'P4327147 (Beta)', '6513589PX', 'NEW-PART', '']),
    ['6513589PX', 'NEW-PART'],
  );
  assert.deepStrictEqual(unmappedPartNumbers(['2872405', 'P4327147-QC']), [], 'a fully mapped batch lists nothing');
  assert.deepStrictEqual(unmappedPartNumbers([]), []);
  // The same unmapped part spelled two ways is reported once.
  assert.deepStrictEqual(unmappedPartNumbers(['New-Part', 'NEW-PART ']), ['New-Part']);
});
