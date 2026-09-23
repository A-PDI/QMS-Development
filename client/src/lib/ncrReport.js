/**
 * NCR report editor helpers — pure functions, no React, so the editor's rules
 * can be unit-tested.
 *
 * Editor state:
 *   {
 *     sections: [{ key, id, title, body, images: [image] }],
 *     photos:   [image],                  // the report's general Photos block
 *   }
 *   image = { key, id, caption, file, previewUrl }
 *
 * `key` is a local identity for React lists. `id` is the server id — null for
 * a section or photo that has not been saved yet. An unsaved photo carries the
 * picked `file` and a `previewUrl` (object URL) for its thumbnail.
 */

// Mirrors LIMITS in server/services/ncrContent.js.
export const NCR_LIMITS = {
  sections: 50,
  images: 100,
  titleLength: 200,
  bodyLength: 20000,
  captionLength: 500,
  fileSizeMb: 25,
}

// Common NCR headings offered when naming a section (free text is allowed).
export const NCR_SECTION_SUGGESTIONS = [
  'Containment Action',
  'Root Cause',
  'Corrective Action',
  'Preventive Action',
  'Verification of Effectiveness',
  'Supplier Response',
  'Additional Notes',
]

// Only formats the PDF generator can embed.
export const NCR_IMAGE_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png'

let keySeq = 0
export function newKey(prefix = 'k') {
  keySeq += 1
  return `${prefix}-${Date.now().toString(36)}-${keySeq}`
}

/** Editor state from an NCR returned by GET /api/ncrs/:id. */
export function editorContentFromNcr(ncr) {
  const toImage = (img) => ({ key: newKey('img'), id: img.id, caption: img.caption || '', file: null, previewUrl: null })
  return {
    sections: (ncr?.sections || []).map((s) => ({
      key: newKey('sec'),
      id: s.id,
      title: s.title || '',
      body: s.body || '',
      images: (s.images || []).map(toImage),
    })),
    photos: (ncr?.photos || []).map(toImage),
  }
}

export function emptySection(title = '') {
  return { key: newKey('sec'), id: null, title, body: '', images: [] }
}

export function imageFromFile(file, previewUrl = null) {
  return { key: newKey('img'), id: null, caption: '', file, previewUrl }
}

/** Copy of `list` with the item at `index` moved by `delta` (clamped). */
export function moveItem(list, index, delta) {
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function allImages(content) {
  return [...(content?.photos || []), ...(content?.sections || []).flatMap((s) => s.images || [])]
}

/** Why a picked file cannot be added, or '' when it can. */
export function imageFileProblem(file) {
  if (!file) return 'No file selected'
  const type = String(file.type || '').toLowerCase()
  const byType = type === 'image/jpeg' || type === 'image/png'
  const byName = !type && /\.(jpe?g|png)$/i.test(String(file.name || ''))
  if (!byType && !byName) return `${file.name || 'File'} is not a JPEG or PNG image`
  if (file.size > NCR_LIMITS.fileSizeMb * 1024 * 1024) return `${file.name} is larger than ${NCR_LIMITS.fileSizeMb} MB`
  return ''
}

/** First problem that would stop the content from saving, or ''. */
export function contentProblem(content) {
  const sections = content?.sections || []
  if (sections.length > NCR_LIMITS.sections) return `An NCR can have at most ${NCR_LIMITS.sections} sections`
  for (let i = 0; i < sections.length; i++) {
    const title = String(sections[i].title || '').trim()
    if (!title) return `Section ${i + 1} needs a title`
    if (title.length > NCR_LIMITS.titleLength) return `Section ${i + 1} title is too long (max ${NCR_LIMITS.titleLength} characters)`
    if (String(sections[i].body || '').length > NCR_LIMITS.bodyLength) return `Section ${i + 1} text is too long (max ${NCR_LIMITS.bodyLength} characters)`
  }
  const images = allImages(content)
  if (images.length > NCR_LIMITS.images) return `An NCR can have at most ${NCR_LIMITS.images} photos`
  if (images.some((img) => String(img.caption || '').length > NCR_LIMITS.captionLength)) {
    return `Captions can be at most ${NCR_LIMITS.captionLength} characters`
  }
  return ''
}

/** Photos that still have to be uploaded, in report order. */
export function pendingUploads(content) {
  return allImages(content).filter((img) => !img.id && img.file)
}

/** State with server ids recorded for the photos that just uploaded (key → id). */
export function markUploaded(content, uploadedIds) {
  const mark = (img) => (uploadedIds.has(img.key) ? { ...img, id: uploadedIds.get(img.key), file: null } : img)
  return {
    ...content,
    sections: content.sections.map((s) => ({ ...s, images: s.images.map(mark) })),
    photos: content.photos.map(mark),
  }
}

/**
 * Body for PUT /api/ncrs/:id/content. Photos without a server id (an upload
 * that failed) are left out; they stay in the editor for the next save.
 */
export function buildContentPayload(content, removedImageIds = []) {
  const ref = (img) => ({ id: img.id, caption: String(img.caption || '').trim() })
  return {
    sections: content.sections.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      title: String(s.title || '').trim(),
      body: String(s.body || ''),
      images: s.images.filter((img) => img.id).map(ref),
    })),
    photos: content.photos.filter((img) => img.id).map(ref),
    removed_image_ids: [...removedImageIds],
  }
}

/** Record the ids the server gave new sections (returned in the same order). */
export function assignSectionIds(content, saved) {
  const ids = (saved?.sections || []).map((s) => s.id)
  return { ...content, sections: content.sections.map((s, i) => ({ ...s, id: ids[i] || s.id })) }
}

/** Figure numbers for the report: Photos first, then each section in order. */
export function figureNumbers(ncr) {
  const numbers = new Map()
  let n = 1
  for (const img of ncr?.photos || []) numbers.set(img.id, n++)
  for (const s of ncr?.sections || []) for (const img of s.images || []) numbers.set(img.id, n++)
  return numbers
}

/** Download name: NCR-0001_<Part#>.pdf (mirrors server/services/ncrPdf.js). */
export function ncrPdfFilename(ncr = {}) {
  const clean = (v) => String(v ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '')
  const number = clean(ncr.ncr_number) || 'NCR'
  const part = clean(ncr.part_number)
  return `${number}${part ? `_${part}` : ''}.pdf`
}
