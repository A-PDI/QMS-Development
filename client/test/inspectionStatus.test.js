/**
 * Which inspections the Admin → Data tab offers a "Reopen" action for.
 *
 * CLOSED_STATUSES here must stay in step with the same list in
 * server/routes/inspections.js — the button and the API have to agree on what
 * "completed and closed" means.
 */

import test from 'node:test'
import assert from 'node:assert'

import { CLOSED_STATUSES, STATUS_LABELS, isReopenable } from '../src/lib/constants.js'

test('every closed status is one the UI labels "Complete"', () => {
  for (const status of CLOSED_STATUSES) {
    assert.strictEqual(STATUS_LABELS[status], 'Complete', `${status} should read as Complete`)
  }
})

test('a completed inspection can be reopened', () => {
  assert.ok(isReopenable({ id: 'i1', status: 'complete' }))
})

test('the legacy closed statuses can be reopened', () => {
  for (const status of ['submitted', 'approved', 'rejected']) {
    assert.ok(isReopenable({ status }), `${status} should be reopenable`)
  }
})

test('an inspection that is still in progress cannot be reopened', () => {
  for (const status of ['draft', 'partially_complete', 'pending_review', 'review']) {
    assert.strictEqual(isReopenable({ status }), false, `${status} is not closed`)
  }
})

test('a bare status string works as well as an inspection object', () => {
  assert.ok(isReopenable('complete'))
  assert.strictEqual(isReopenable('draft'), false)
})

test('a missing inspection or status is never reopenable', () => {
  for (const value of [null, undefined, {}, { status: null }, { status: '' }]) {
    assert.strictEqual(isReopenable(value), false)
  }
})
