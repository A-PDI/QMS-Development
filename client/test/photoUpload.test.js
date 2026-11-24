/**
 * Photos at inspection points: which picked files can be attached, which
 * attachments belong to a point, and how upload failures are explained.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  photoRejectionReason, partitionPhotos, pointAttachments, uploadErrorMessage, IMAGE_ACCEPT,
  prefersInAppCamera, cameraErrorMessage, capturedPhotoName,
} from '../src/lib/photoUpload.js'

const file = (name, type, size = 1024) => ({ name, type, size })

test('JPEG, PNG, WebP and GIF photos are accepted', () => {
  for (const f of [file('a.jpg', 'image/jpeg'), file('b.png', 'image/png'), file('c.webp', 'image/webp'), file('d.gif', 'image/gif')]) {
    assert.strictEqual(photoRejectionReason(f), null, f.name)
  }
  assert.strictEqual(photoRejectionReason(file('camera.jpg', '')), null, 'a capture with no MIME type is judged by its name')
  assert.ok(IMAGE_ACCEPT.includes('image/jpeg'))
})

test('other files are refused with a reason', () => {
  assert.match(photoRejectionReason(file('doc.pdf', 'application/pdf')), /only JPEG/)
  assert.match(photoRejectionReason(file('x.heic', 'image/heic')), /only JPEG/)
  assert.match(photoRejectionReason(file('empty.jpg', 'image/jpeg', 0)), /empty/)
  assert.match(photoRejectionReason(file('huge.jpg', 'image/jpeg', 26 * 1024 * 1024)), /larger than 25 MB/)
})

test('five photos picked at once are all attached; a bad one does not block the rest', () => {
  const picked = [1, 2, 3, 4, 5].map(i => file(`IMG_${i}.jpg`, 'image/jpeg'))
  assert.strictEqual(partitionPhotos(picked).accepted.length, 5)
  const mixed = partitionPhotos([...picked, file('notes.txt', 'text/plain')])
  assert.strictEqual(mixed.accepted.length, 5)
  assert.deepStrictEqual(mixed.rejected.map(r => r.file.name), ['notes.txt'])
})

test('a point\'s photos are those filed under its section key and item id', () => {
  const attachments = [
    { id: 'a', section_key: 'dimensional', item_id: '3' },
    { id: 'b', section_key: 'dimensional', item_id: 3 },
    { id: 'c', section_key: 'item1__dimensional', item_id: '3' },
    { id: 'd', section_key: 'dimensional', item_id: '4' },
  ]
  assert.deepStrictEqual(pointAttachments(attachments, 'dimensional', 3).map(a => a.id), ['a', 'b'])
  assert.deepStrictEqual(pointAttachments(attachments, 'item1__dimensional', '3').map(a => a.id), ['c'])
})

test('upload errors are explained', () => {
  assert.strictEqual(uploadErrorMessage({ response: { data: { error: 'File too large. Maximum size is 25MB.' } } }), 'File too large. Maximum size is 25MB.')
  assert.match(uploadErrorMessage({ code: 'ERR_NETWORK', message: 'Network Error' }), /no connection/)
  assert.strictEqual(uploadErrorMessage(null), 'upload failed')
})

// ── In-app camera ───────────────────────────────────────────────────────────

const fakeWindow = ({ secure = true, gum = true, coarse = true } = {}) => ({
  isSecureContext: secure,
  navigator: { mediaDevices: gum ? { getUserMedia: () => {} } : undefined },
  matchMedia: q => ({ matches: q === '(pointer: coarse)' && coarse }),
})

test('phones and tablets on a secure page get the in-app camera', () => {
  assert.strictEqual(prefersInAppCamera(fakeWindow()), true)
})

test('desktops, insecure pages and browsers without camera access keep the file picker', () => {
  assert.strictEqual(prefersInAppCamera(fakeWindow({ coarse: false })), false, 'mouse / trackpad')
  assert.strictEqual(prefersInAppCamera(fakeWindow({ secure: false })), false, 'http page — the browser refuses the camera')
  assert.strictEqual(prefersInAppCamera(fakeWindow({ gum: false })), false, 'no getUserMedia')
  assert.strictEqual(prefersInAppCamera(undefined), false)
})

test('camera failures are explained with a way forward', () => {
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /blocked.*library/)
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /No camera/)
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /another app/)
  assert.match(cameraErrorMessage(null), /library/)
})

test('captured photos get distinct, sortable JPEG names', () => {
  const at = new Date(2026, 10, 24, 9, 5, 7)
  assert.strictEqual(capturedPhotoName(at, 1), 'photo-20261124-090507-001.jpg')
  assert.strictEqual(capturedPhotoName(at, 12), 'photo-20261124-090507-012.jpg')
})
