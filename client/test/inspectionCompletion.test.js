/**
 * Completing an inspection: save first, then complete, and leave for the
 * Inspections list only once the server has confirmed the completion.
 */

import test from 'node:test'
import assert from 'node:assert'

import { saveAndComplete, INSPECTIONS_LIST_PATH } from '../src/lib/inspectionCompletion.js'

function recorder({ saveFails = false, completeFails = false } = {}) {
  const calls = []
  return {
    calls,
    save: async () => { calls.push('save'); if (saveFails) throw new Error('save failed') },
    complete: async () => { calls.push('complete'); if (completeFails) throw new Error('complete failed'); return { inspection: { status: 'complete' } } },
  }
}

test('a successful completion saves, completes, then goes to the Inspections list', async () => {
  const r = recorder()
  const outcome = await saveAndComplete({ uploadsInFlight: 0, save: r.save, complete: r.complete })
  assert.deepStrictEqual(r.calls, ['save', 'complete'], 'data is committed before completion')
  assert.strictEqual(outcome.status, 'completed')
  assert.strictEqual(outcome.destination, '/inspections')
  assert.strictEqual(INSPECTIONS_LIST_PATH, '/inspections')
  assert.strictEqual(outcome.result.inspection.status, 'complete')
})

test('a failed completion stays on the form with the error', async () => {
  const r = recorder({ completeFails: true })
  const outcome = await saveAndComplete({ save: r.save, complete: r.complete })
  assert.strictEqual(outcome.status, 'failed')
  assert.strictEqual(outcome.stage, 'complete')
  assert.strictEqual(outcome.error.message, 'complete failed')
  assert.strictEqual(outcome.destination, undefined, 'no navigation target')
})

test('a failed save never attempts completion', async () => {
  const r = recorder({ saveFails: true })
  const outcome = await saveAndComplete({ save: r.save, complete: r.complete })
  assert.deepStrictEqual(r.calls, ['save'])
  assert.strictEqual(outcome.status, 'failed')
  assert.strictEqual(outcome.stage, 'save')
})

test('photos still uploading hold completion back', async () => {
  const r = recorder()
  const outcome = await saveAndComplete({ uploadsInFlight: 2, save: r.save, complete: r.complete })
  assert.deepStrictEqual(r.calls, [], 'nothing is saved or completed')
  assert.deepStrictEqual(outcome, { status: 'uploads_pending', count: 2 })
})
