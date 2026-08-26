/**
 * Report filename / save-location workflow.
 *
 * Covers requirement scenarios 15–16: the user can change the filename before
 * the report is downloaded, and cancelling the dialog downloads nothing.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  sanitizeFilename,
  ensureExtension,
  deriveFilename,
  chooseSaveTarget,
  writeBlobToTarget,
  saveBlobAs,
  isSaveFilePickerSupported,
} from '../src/lib/download.js'

// ── Fakes ────────────────────────────────────────────────────────────────────
function fakePickerWindow({ name = 'Chosen Name.pdf', abort = false } = {}) {
  const written = []
  const win = {
    calls: [],
    written,
    URL: { createObjectURL: () => 'blob:url', revokeObjectURL: () => {} },
    async showSaveFilePicker(options) {
      win.calls.push(options)
      if (abort) {
        const err = new Error('The user aborted a request.')
        err.name = 'AbortError'
        throw err
      }
      return {
        name,
        async createWritable() {
          return {
            async write(data) { written.push(data) },
            async close() {},
          }
        },
      }
    },
  }
  return win
}

function fakePromptWindow(answer) {
  const win = {
    prompts: [],
    URL: { createObjectURL: () => 'blob:url', revokeObjectURL: () => {} },
    prompt(message, suggested) {
      win.prompts.push({ message, suggested })
      return answer
    },
  }
  return win
}

function fakeDocument() {
  const clicks = []
  return {
    clicks,
    body: { appendChild() {} },
    createElement() {
      return {
        set href(v) { this._href = v },
        get href() { return this._href },
        click() { clicks.push({ download: this.download, href: this._href }) },
        remove() {},
      }
    },
  }
}

// ── Filename helpers ─────────────────────────────────────────────────────────
test('filenames keep their extension whatever the user types', () => {
  assert.strictEqual(ensureExtension('My Report', '.pdf'), 'My Report.pdf')
  assert.strictEqual(ensureExtension('My Report.pdf', '.pdf'), 'My Report.pdf')
  assert.strictEqual(ensureExtension('My Report.PDF', '.pdf'), 'My Report.PDF')
  assert.strictEqual(ensureExtension('report.', '.pdf'), 'report.pdf')
})

test('illegal filename characters are replaced, useful ones are kept', () => {
  assert.strictEqual(sanitizeFilename('QMS-724/3 report'), 'QMS-724_3 report')
  assert.strictEqual(sanitizeFilename('a:b*c?d"e<f>g|h'), 'a_b_c_d_e_f_g_h')
  assert.strictEqual(sanitizeFilename('   '), 'report')
  assert.strictEqual(sanitizeFilename(null), 'report')
})

test('related filenames derive from the chosen one', () => {
  assert.strictEqual(deriveFilename('Batch 12.pdf', 'Inspection'), 'Batch 12_Inspection.pdf')
  assert.strictEqual(deriveFilename('Batch 12_Inspection.pdf', '2'), 'Batch 12_Inspection_2.pdf')

  // Switching format must not leave the old extension inside the name.
  assert.strictEqual(deriveFilename('Batch 12.pdf', 'Report', '.xlsx'), 'Batch 12_Report.xlsx')
  assert.strictEqual(deriveFilename('Batch 12.pdf', '', '.xlsx'), 'Batch 12.xlsx')
  assert.strictEqual(deriveFilename('Batch 12.xlsx', '', '.pdf'), 'Batch 12.pdf')
  assert.strictEqual(deriveFilename('Batch 12', 'Report', '.xlsx'), 'Batch 12_Report.xlsx')
  assert.strictEqual(deriveFilename('Rev 2.1 batch.pdf', '', '.xlsx'), 'Rev 2.1 batch.xlsx',
    'a dot inside the name is not an extension')
})

// ── Scenario 15: the user can change the filename ────────────────────────────
test('the save dialog proposes a name the user can change', async () => {
  const win = fakePickerWindow({ name: 'Shipment 42.pdf' })
  assert.ok(isSaveFilePickerSupported(win))

  const target = await chooseSaveTarget('InjectorReport_PN_12', { win })

  assert.strictEqual(target.cancelled, false)
  assert.strictEqual(win.calls[0].suggestedName, 'InjectorReport_PN_12.pdf', 'a sensible name is proposed')
  assert.strictEqual(target.filename, 'Shipment 42.pdf', 'the user\'s name is used')
  assert.ok(target.handle, 'a save location was chosen')
})

test('without a save dialog the user is prompted for a filename', async () => {
  const win = fakePromptWindow('My Custom Report')
  const target = await chooseSaveTarget('InjectorReport_PN_3', { win })

  assert.strictEqual(target.cancelled, false)
  assert.strictEqual(win.prompts[0].suggested, 'InjectorReport_PN_3.pdf')
  assert.strictEqual(target.filename, 'My Custom Report.pdf', 'extension retained automatically')
})

test('an emptied filename box falls back to the proposed name', async () => {
  const win = fakePromptWindow('   ')
  const target = await chooseSaveTarget('InjectorReport_PN_3', { win })
  assert.strictEqual(target.cancelled, false)
  assert.strictEqual(target.filename, 'InjectorReport_PN_3.pdf')
})

test('the chosen file is written to the chosen location', async () => {
  const win = fakePickerWindow({ name: 'Chosen.pdf' })
  const target = await chooseSaveTarget('suggested', { win })
  const blob = { size: 3, type: 'application/pdf' }

  const saved = await writeBlobToTarget(target, blob, { win })
  assert.strictEqual(saved, true)
  assert.deepStrictEqual(win.written, [blob])
})

test('without a file handle the report downloads under the chosen name', async () => {
  const win = fakePromptWindow('Downloaded Report')
  const doc = fakeDocument()
  const target = await chooseSaveTarget('suggested', { win })

  const saved = await writeBlobToTarget(target, { size: 1 }, { win, doc })
  assert.strictEqual(saved, true)
  assert.strictEqual(doc.clicks.length, 1)
  assert.strictEqual(doc.clicks[0].download, 'Downloaded Report.pdf')
})

// ── Scenario 16: cancelling downloads nothing ────────────────────────────────
test('cancelling the save dialog downloads nothing', async () => {
  const win = fakePickerWindow({ abort: true })
  const doc = fakeDocument()

  const target = await chooseSaveTarget('InjectorReport', { win })
  assert.strictEqual(target.cancelled, true)

  const saved = await writeBlobToTarget(target, { size: 1 }, { win, doc })
  assert.strictEqual(saved, false, 'nothing is written after a cancel')
  assert.strictEqual(doc.clicks.length, 0, 'no download was triggered')
  assert.strictEqual(win.written.length, 0)
})

test('cancelling the filename prompt downloads nothing', async () => {
  const win = fakePromptWindow(null) // Cancel returns null
  const doc = fakeDocument()

  const target = await chooseSaveTarget('InjectorReport', { win })
  assert.strictEqual(target.cancelled, true)

  const saved = await saveBlobAs({ size: 1 }, 'InjectorReport', { win, doc })
  assert.strictEqual(saved, false)
  assert.strictEqual(doc.clicks.length, 0)
})

test('a blocked save dialog falls back to the filename prompt', async () => {
  // A picker that throws for a reason other than user cancellation (e.g. the
  // page is not a secure context) must not lose the report.
  const win = {
    prompts: [],
    URL: { createObjectURL: () => 'blob:url', revokeObjectURL: () => {} },
    async showSaveFilePicker() { throw new Error('SecurityError: not allowed') },
    prompt(message, suggested) { win.prompts.push(suggested); return 'Fallback Name' },
  }
  const target = await chooseSaveTarget('InjectorReport_2', { win })

  assert.strictEqual(target.cancelled, false)
  assert.strictEqual(target.filename, 'Fallback Name.pdf')
  assert.strictEqual(win.prompts.length, 1)
})
