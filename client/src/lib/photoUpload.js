// Photos attached to inspection points.
//
// The server stores whatever multer accepts (one file per request, 25 MB by
// default); these checks stop an unusable file before it is sent and give the
// inspector a reason, file by file, so one bad file never blocks the others.

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// What the file inputs offer. iOS Safari converts HEIC photos to JPEG when the
// input only accepts these types.
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')

export const MAX_PHOTO_MB = 25
const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024

/** Why a file can't be attached, or null when it can. */
export function photoRejectionReason(file) {
  if (!file) return 'no file'
  const type = String(file.type || '').toLowerCase()
  const knownByName = /\.(jpe?g|png|webp|gif)$/i.test(file.name || '')
  if (type ? !ACCEPTED_IMAGE_TYPES.includes(type) : !knownByName) return 'only JPEG, PNG, WebP or GIF images can be attached'
  if (!file.size) return 'the file is empty'
  if (file.size > MAX_PHOTO_BYTES) return `larger than ${MAX_PHOTO_MB} MB`
  return null
}

/** Split picked files into those that can be uploaded and those that can't. */
export function partitionPhotos(files) {
  const accepted = []
  const rejected = []
  for (const file of Array.from(files || [])) {
    const reason = photoRejectionReason(file)
    if (reason) rejected.push({ file, reason })
    else accepted.push(file)
  }
  return { accepted, rejected }
}

/** Attachments filed against one inspection point. */
export function pointAttachments(attachments, sectionKey, itemId) {
  return (attachments || []).filter(a => a.section_key === sectionKey && String(a.item_id) === String(itemId))
}

/** Human-readable failure for an upload error. */
export function uploadErrorMessage(err) {
  if (!err) return 'upload failed'
  if (err.response?.data?.error) return err.response.data.error
  if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') return 'no connection — check the network and retry'
  if (err.code === 'ECONNABORTED') return 'the upload timed out — retry'
  return err.message || 'upload failed'
}

// ── In-app camera ───────────────────────────────────────────────────────────
// Phones and tablets get a live viewfinder inside the app: each tap of the
// shutter is a saved photo, with no "Use Photo" confirmation per shot (the
// file input hands off to the system camera, which always asks). It needs a
// secure page (https or localhost) and getUserMedia; desktops keep the file
// picker, which suits a mouse better.

/** Whether the in-app camera should be offered on this device. */
export function prefersInAppCamera(win = typeof window === 'undefined' ? undefined : window) {
  if (!win) return false
  if (!win.isSecureContext) return false
  if (typeof win.navigator?.mediaDevices?.getUserMedia !== 'function') return false
  try {
    return !!win.matchMedia?.('(pointer: coarse)')?.matches
  } catch {
    return false
  }
}

/** Why the camera could not start, in words an inspector can act on. */
export function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked. Allow the camera for this site in the browser settings (Safari: aA › Website Settings › Camera), or add photos from the library.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Add photos from the library instead.'
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is being used by another app. Close it and try again, or add photos from the library.'
    default:
      return 'The camera could not be started. Add photos from the library instead.'
  }
}

/** File name for a photo taken with the in-app camera. */
export function capturedPhotoName(date = new Date(), sequence = 1) {
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `photo-${stamp}-${pad(sequence, 3)}.jpg`
}
