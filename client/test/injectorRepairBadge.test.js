/**
 * Each test result shows only its own part in a repair:
 *   Result 1, 2 → nothing · Result 3 → Repair #1 · Result 4 → Repair #2 · Result 5 → Pass
 */

import test from 'node:test'
import assert from 'node:assert'

import { repairBadge, linkedRepairsMessage } from '../src/lib/injectorRepairBadge.js'

test('a result with no part in a repair has no badge', () => {
  assert.strictEqual(repairBadge({ id: 'r1', result_status: 'fail' }), null)
  assert.strictEqual(repairBadge(null), null)
})

test('the result a repair was recorded on shows that repair', () => {
  assert.deepStrictEqual(
    repairBadge({ repair_attempt_number: 1, repair_attempt_status: 'COMPLETED', repair_case_status: 'OPEN' }),
    { tone: 'repair', label: 'Repair #1', title: undefined }
  )
  assert.strictEqual(
    repairBadge({ repair_attempt_number: 1, repair_attempt_status: 'WAITING_RETEST', repair_case_status: 'HOLD' }).label,
    'Repair #1 · awaiting retest · Hold'
  )
})

test('a failed retest that was repaired again shows the new repair', () => {
  const badge = repairBadge({
    repair_attempt_number: 2, repair_attempt_status: 'COMPLETED',
    retest_of_attempt: 1, retest_outcome: 'FAIL', repair_case_status: 'PASSED',
  })
  assert.strictEqual(badge.label, 'Repair #2')
  assert.strictEqual(badge.title, 'Retest of Repair #1 — FAIL')
})

test('a passing retest shows the pass and the repair it verified', () => {
  assert.deepStrictEqual(
    repairBadge({ retest_of_attempt: 2, retest_outcome: 'PASS', repair_case_status: 'PASSED' }),
    { tone: 'pass', label: 'Pass · after Repair #2', title: 'Retest of Repair #2 — PASS' }
  )
  assert.strictEqual(repairBadge({ retest_of_attempt: 1, retest_outcome: 'FAIL', repair_case_status: 'OPEN' }).label, 'Retest of Repair #1')
})

test('the sync summary says how many retests were linked', () => {
  assert.strictEqual(linkedRepairsMessage(0), '')
  assert.strictEqual(linkedRepairsMessage(undefined), '')
  assert.strictEqual(linkedRepairsMessage(1), 'Linked 1 new retest to its repair.')
  assert.strictEqual(linkedRepairsMessage(3), 'Linked 3 new retests to their repairs.')
})
