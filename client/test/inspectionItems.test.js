/**
 * Per-item identity: the serial number entered for each inspected item, the
 * inspection-level Lot / Serial No. derived from it, and the seeding that keeps
 * inspections recorded before serials moved to the item level intact.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  ITEM_SERIAL_KEY,
  getItemSerial,
  getItemLabel,
  deriveLotSerial,
  seedItemSerials,
} from '../src/lib/itemCompletion.js'

const item = (serial, rest = {}) => ({ [ITEM_SERIAL_KEY]: serial, ...rest })

// ── Reading a serial ────────────────────────────────────────────────────────
test('an item reports the serial number entered against it', () => {
  assert.strictEqual(getItemSerial(item('SN-1001')), 'SN-1001')
  assert.strictEqual(getItemSerial(item('  SN-1001  ')), 'SN-1001', 'stray whitespace is trimmed')
  assert.strictEqual(getItemSerial({}), '')
  assert.strictEqual(getItemSerial(null), '')
})

test('an item is labelled by its serial number once it has one', () => {
  assert.strictEqual(getItemLabel(item('SN-1001'), 0), 'Item 1 · SN-1001')
  assert.strictEqual(getItemLabel({}, 2), 'Item 3')
})

// ── The inspection-level Lot / Serial No. ───────────────────────────────────
test('the inspection Lot / Serial No. lists every item serial in order', () => {
  assert.strictEqual(deriveLotSerial([item('SN-2'), item('SN-10')]), 'SN-2, SN-10')
})

test('a serial shared by several items is listed once', () => {
  assert.strictEqual(deriveLotSerial([item('SN-2'), item('SN-2')]), 'SN-2')
})

test('items with no serial contribute nothing', () => {
  assert.strictEqual(deriveLotSerial([{}, item('SN-2'), item('')]), 'SN-2')
  assert.strictEqual(deriveLotSerial([{}, {}]), '')
  assert.strictEqual(deriveLotSerial([]), '')
})

// ── Seeding from an inspection recorded before the move ─────────────────────
test('a single-item inspection takes the serial off the inspection row', () => {
  assert.deepStrictEqual(seedItemSerials([{}], 'SN-1001'), [item('SN-1001')])
})

test('a list of serials maps onto the items in order', () => {
  assert.deepStrictEqual(
    seedItemSerials([{}, {}, {}], 'SN-1, SN-2, SN-3'),
    [item('SN-1'), item('SN-2'), item('SN-3')]
  )
})

test('a serial list that does not match the item count is left alone', () => {
  const items = [{}, {}, {}]
  assert.deepStrictEqual(
    seedItemSerials(items, 'LOT-42'),
    items,
    'one lot number says nothing about which item is which'
  )
})

test('serials already entered are never overwritten', () => {
  const items = [item('SN-A'), {}]
  assert.deepStrictEqual(seedItemSerials(items, 'SN-1, SN-2'), [item('SN-A'), item('SN-2')])
})

test('an inspection with no serial on the row is left alone', () => {
  const items = [{}, {}]
  assert.deepStrictEqual(seedItemSerials(items, ''), items)
  assert.deepStrictEqual(seedItemSerials(items, null), items)
})
