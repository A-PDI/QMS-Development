'use strict';
/**
 * Serial numbers entered differently for the same injector:
 *   260521828A = 260521828 = 828
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  serialCore,
  unitResolver,
  unitKeyer,
  sameUnitSerials,
  sameUnitRows,
} = require('../services/injectorUnits');

test('case, spacing, separators and a trailing letter suffix are ignored', () => {
  assert.strictEqual(serialCore('260521828A'), '260521828');
  assert.strictEqual(serialCore(' 260-521 828a '), '260521828');
  assert.strictEqual(serialCore('260521828AB'), '260521828');
  assert.strictEqual(serialCore('828'), '828');
  // Leading letters are part of the serial (an R prefix marks an RMA unit).
  assert.strictEqual(serialCore('SN260521828'), 'SN260521828');
  assert.strictEqual(serialCore('ABC'), 'ABC', 'an all-letter serial is kept whole');
  assert.strictEqual(serialCore(null), '');
});

test('260521828A, 260521828 and 828 are one unit', () => {
  const resolve = unitResolver(['260521828A', '260521828', '828']);
  const keys = new Set(['260521828A', '260521828', '828', '260521828 a'].map(resolve));
  assert.strictEqual(keys.size, 1);
  assert.deepStrictEqual(
    sameUnitSerials('828', ['260521828A', '260521828', '828', '999111222']).sort(),
    ['260521828', '260521828A', '828']
  );
});

test('a shortened serial must have at least 3 digits and end the full serial', () => {
  const resolve = unitResolver(['260521828', '28', '2605']);
  assert.notStrictEqual(resolve('28'), resolve('260521828'), 'two digits is too short to match');
  assert.notStrictEqual(resolve('2605'), resolve('260521828'), 'the start of a serial is not a match');
  assert.strictEqual(resolve('521828'), resolve('260521828'), 'any 3+ digit ending matches');
  const lettered = unitResolver(['SN260521828', '828']);
  assert.notStrictEqual(lettered('828'), lettered('SN260521828'), 'a lettered full serial is only matched exactly');
});

test('a shortened serial two units could own stays on its own', () => {
  const resolve = unitResolver(['260521828', '260777828', '828']);
  assert.notStrictEqual(resolve('260521828'), resolve('260777828'));
  assert.notStrictEqual(resolve('828'), resolve('260521828'));
  assert.notStrictEqual(resolve('828'), resolve('260777828'));
  assert.deepStrictEqual(sameUnitSerials('828', ['260521828', '260777828', '828']), ['828']);
  // Full serials are still matched exactly.
  assert.deepStrictEqual(sameUnitSerials('260521828A', ['260521828', '260777828', '828']).sort(), ['260521828', '260521828A']);
});

test('units are separated by part number', () => {
  const key = unitKeyer([
    { part_number: '4327147', serial_number: '260521828A' },
    { part_number: '4327147', serial_number: '828' },
    { part_number: '4327147 ', serial_number: '260521828' },
    { part_number: '9999999', serial_number: '828' },
  ]);
  const a = key({ part_number: '4327147', serial_number: '828' });
  assert.strictEqual(a, key({ part_number: '4327147', serial_number: '260521828A' }));
  assert.strictEqual(a, key({ part_number: '4327147', serial_number: '260521828' }));
  assert.notStrictEqual(a, key({ part_number: '9999999', serial_number: '828' }), 'another part is another unit');
});

test('filter rows: the typed serial finds its unit within each part number', () => {
  const rows = [
    { part_number: 'A', serial_number: '260521828A' },
    { part_number: 'A', serial_number: '828' },
    { part_number: 'A', serial_number: '555' },
    { part_number: 'B', serial_number: '828' },
    { part_number: 'B', serial_number: '111222333' },
  ];
  assert.deepStrictEqual(
    sameUnitRows(['260521828'], rows).map((r) => `${r.part_number}/${r.serial_number}`),
    ['A/260521828A', 'A/828'],
    "part B's 828 is not part A's unit"
  );
  assert.deepStrictEqual(sameUnitRows(['  '], rows), [], 'a blank token matches nothing');
});

test('resolving a large serial list stays fast', () => {
  const serials = Array.from({ length: 50000 }, (_, i) => String(260000000 + i * 7));
  const started = process.hrtime.bigint();
  const resolve = unitResolver(serials);
  serials.forEach(resolve);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 3000, `50,000 serials resolved in ${Math.round(ms)} ms`);
});
