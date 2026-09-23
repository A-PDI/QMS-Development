/**
 * NCR report editor rules: section / photo ordering, what a save sends, and
 * which picked files are accepted.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  editorContentFromNcr,
  emptySection,
  imageFromFile,
  moveItem,
  imageFileProblem,
  contentProblem,
  pendingUploads,
  markUploaded,
  buildContentPayload,
  assignSectionIds,
  figureNumbers,
  ncrPdfFilename,
  NCR_LIMITS,
} from '../src/lib/ncrReport.js'

const SAVED_NCR = {
  photos: [{ id: 'p1', caption: 'As received' }],
  sections: [
    { id: 's1', title: 'Root Cause', body: 'Worn tool', images: [{ id: 'i1', caption: 'Tool' }, { id: 'i2', caption: '' }] },
    { id: 's2', title: 'Corrective Action', body: '', images: [] },
  ],
}

test('a saved NCR loads into the editor with its order and captions', () => {
  const content = editorContentFromNcr(SAVED_NCR)
  assert.deepStrictEqual(content.photos.map((p) => [p.id, p.caption]), [['p1', 'As received']])
  assert.deepStrictEqual(content.sections.map((s) => [s.id, s.title, s.body]), [
    ['s1', 'Root Cause', 'Worn tool'],
    ['s2', 'Corrective Action', ''],
  ])
  assert.deepStrictEqual(content.sections[0].images.map((i) => i.id), ['i1', 'i2'])
  const keys = [...content.photos, ...content.sections, ...content.sections.flatMap((s) => s.images)].map((x) => x.key)
  assert.strictEqual(new Set(keys).size, keys.length, 'every row has its own key')
})

test('sections and photos move up and down without leaving the list', () => {
  assert.deepStrictEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'])
  assert.deepStrictEqual(moveItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b'])
  const list = ['a', 'b']
  assert.strictEqual(moveItem(list, 0, -1), list, 'first item cannot move up')
  assert.strictEqual(moveItem(list, 1, 1), list, 'last item cannot move down')
})

test('only JPEG and PNG photos within the size limit are accepted', () => {
  assert.strictEqual(imageFileProblem({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }), '')
  assert.strictEqual(imageFileProblem({ name: 'a.png', type: 'image/png', size: 1000 }), '')
  assert.strictEqual(imageFileProblem({ name: 'IMG_1.JPEG', type: '', size: 1000 }), '', 'no type: judged by name')
  assert.match(imageFileProblem({ name: 'a.heic', type: 'image/heic', size: 1000 }), /not a JPEG or PNG/)
  assert.match(imageFileProblem({ name: 'a.pdf', type: 'application/pdf', size: 1000 }), /not a JPEG or PNG/)
  assert.match(imageFileProblem({ name: 'big.jpg', type: 'image/jpeg', size: (NCR_LIMITS.fileSizeMb + 1) * 1024 * 1024 }), /larger than/)
})

test('every section needs a title before the report can be saved', () => {
  const content = { photos: [], sections: [{ ...emptySection('Root Cause') }, emptySection('  ')] }
  assert.strictEqual(contentProblem(content), 'Section 2 needs a title')
  content.sections[1].title = 'Containment'
  assert.strictEqual(contentProblem(content), '')
  content.photos.push({ ...imageFromFile({ name: 'x.jpg' }), caption: 'x'.repeat(NCR_LIMITS.captionLength + 1) })
  assert.match(contentProblem(content), /Captions can be at most/)
})

test('a save uploads new photos, then sends the layout with their new ids', () => {
  const content = editorContentFromNcr(SAVED_NCR)
  const fresh = { ...imageFromFile({ name: 'new.jpg' }, 'blob:x'), caption: '  Close-up ' }
  const newSection = { ...emptySection('Containment'), body: 'Quarantined', images: [fresh] }
  content.sections.push(newSection)

  assert.deepStrictEqual(pendingUploads(content).map((i) => i.key), [fresh.key])

  // Before the upload the new photo is left out of the layout…
  let payload = buildContentPayload(content, ['gone'])
  assert.deepStrictEqual(payload.sections[2], { title: 'Containment', body: 'Quarantined', images: [] })
  assert.deepStrictEqual(payload.removed_image_ids, ['gone'])

  // …and once uploaded it is sent with its server id and trimmed caption.
  const uploaded = markUploaded(content, new Map([[fresh.key, 'i9']]))
  assert.deepStrictEqual(pendingUploads(uploaded), [])
  payload = buildContentPayload(uploaded)
  assert.deepStrictEqual(payload.sections[2].images, [{ id: 'i9', caption: 'Close-up' }])
  assert.deepStrictEqual(payload.sections[0], {
    id: 's1', title: 'Root Cause', body: 'Worn tool', images: [{ id: 'i1', caption: 'Tool' }, { id: 'i2', caption: '' }],
  })
  assert.deepStrictEqual(payload.photos, [{ id: 'p1', caption: 'As received' }])

  // The server's ids for new sections are kept so the next save updates them.
  const saved = assignSectionIds(uploaded, { sections: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] })
  assert.deepStrictEqual(saved.sections.map((s) => s.id), ['s1', 's2', 's3'])
})

test('figures are numbered through the Photos block and then each section', () => {
  const numbers = figureNumbers(SAVED_NCR)
  assert.deepStrictEqual([...numbers.entries()], [['p1', 1], ['i1', 2], ['i2', 3]])
})

test('the PDF filename carries the NCR and part numbers', () => {
  assert.strictEqual(ncrPdfFilename({ ncr_number: 'NCR-0007', part_number: '38/03 567' }), 'NCR-0007_38_03_567.pdf')
  assert.strictEqual(ncrPdfFilename({ ncr_number: 'NCR-0007', part_number: '' }), 'NCR-0007.pdf')
})
