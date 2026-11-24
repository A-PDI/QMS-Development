import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, X, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import AuthImage from '../AuthImage'
import { Dialog } from '../ui/dialog'
import CameraCapture from './CameraCapture'
import { useToast } from '../../hooks/useToast'
import {
  IMAGE_ACCEPT, partitionPhotos, pointAttachments, uploadErrorMessage, prefersInAppCamera,
} from '../../lib/photoUpload'

let nextEntryId = 1

// Photos shown inline on the point; the rest open in a gallery so a point
// with many photos doesn't stretch its row.
const MAX_INLINE_PHOTOS = 3

/**
 * Photos for one inspection point — one button, as few taps as possible.
 *
 * - Phones and tablets: the button opens the in-app camera. Every tap of the
 *   shutter is a saved photo (no per-photo confirmation); "Library" in the
 *   camera adds existing photos, several at once; "Done" returns to the form.
 * - Desktops (or when the in-app camera can't run): the button opens the file
 *   picker, where several photos can be chosen at once.
 *
 * Every photo is uploaded on its own (in the order it was taken or picked) and
 * filed against this point's section key + item id at the moment it was
 * captured, so switching items mid-upload can't move it. A photo that fails
 * stays on the point with Retry / Discard; the ones that succeeded are saved
 * regardless. New photos are added — existing ones are never replaced.
 *
 * Props:
 *  sectionKey    — attachment section key of the point (item-namespaced)
 *  itemId        — item id within the section
 *  isFail        — when true, a photo is required
 *  attachments   — all attachments of the inspection (filtered here)
 *  onUpload(file, sectionKey, itemId) → Promise<attachment>; rejects on failure
 *  onDelete(attachmentId)
 *  uploadingKey  — legacy: "${sectionKey}_${itemId}", or a Set of such keys
 *  readOnly      — view only
 */
export default function ItemAttachment({
  sectionKey,
  itemId,
  isFail = false,
  attachments = [],
  onUpload,
  onDelete,
  uploadingKey = null,
  readOnly = false,
}) {
  const pickerRef = useRef(null)
  const { showToast } = useToast()

  // Upload queue: [{ id, file, url, sectionKey, itemId, status: 'queued'|'uploading'|'failed', error, session }]
  const [queue, setQueueState] = useState([])
  const queueRef = useRef([])
  const runningRef = useRef(false)
  const onUploadRef = useRef(onUpload)
  onUploadRef.current = onUpload

  // Camera session: its id while the in-app camera is open, and the photos it
  // has saved ({ id: attachment id, url: local preview, order }).
  const [session, setSession] = useState(null)
  const sessionRef = useRef(null)
  const [sessionSaved, setSessionSaved] = useState([])
  const sessionSavedRef = useRef([])
  const [preview, setPreview] = useState(null)
  const [galleryOpen, setGalleryOpen] = useState(false)

  function setQueue(updater) {
    queueRef.current = updater(queueRef.current)
    setQueueState(queueRef.current)
  }

  function setSaved(updater) {
    sessionSavedRef.current = updater(sessionSavedRef.current)
    setSessionSaved(sessionSavedRef.current)
  }

  // Release the local previews when the point goes away.
  useEffect(() => () => {
    for (const entry of queueRef.current) URL.revokeObjectURL(entry.url)
    for (const saved of sessionSavedRef.current) URL.revokeObjectURL(saved.url)
  }, [])

  const key = `${sectionKey}_${itemId}`
  const itemAttachments = pointAttachments(attachments, sectionKey, itemId)
  const pending = queue.filter(e => e.sectionKey === sectionKey && String(e.itemId) === String(itemId))
  const inFlight = pending.filter(e => e.status !== 'failed')
  const failed = pending.filter(e => e.status === 'failed')
  const legacyUploading = uploadingKey instanceof Set ? uploadingKey.has(key) : uploadingKey === key
  const busy = inFlight.length > 0 || legacyUploading
  const hasImage = itemAttachments.length > 0
  const requiresImage = isFail && !hasImage && !busy

  async function runQueue() {
    if (runningRef.current) return
    runningRef.current = true
    try {
      for (;;) {
        const next = queueRef.current.find(e => e.status === 'queued')
        if (!next) break
        setQueue(q => q.map(e => (e.id === next.id ? { ...e, status: 'uploading', error: '' } : e)))
        try {
          const attachment = await onUploadRef.current(next.file, next.sectionKey, next.itemId)
          setQueue(q => q.filter(e => e.id !== next.id))
          // Still in the camera: keep the local preview so the strip doesn't
          // download the photo it just sent.
          if (next.session && next.session === sessionRef.current && attachment?.id) {
            setSaved(list => [...list, { id: attachment.id, url: next.url, order: next.id }])
          } else {
            URL.revokeObjectURL(next.url)
          }
        } catch (err) {
          setQueue(q => q.map(e => (e.id === next.id ? { ...e, status: 'failed', error: uploadErrorMessage(err) } : e)))
        }
      }
    } finally {
      runningRef.current = false
    }
  }

  function addFiles(fileList, sessionId = null) {
    const { accepted, rejected } = partitionPhotos(fileList)
    if (rejected.length) {
      const names = rejected.map(r => `${r.file?.name || 'photo'} (${r.reason})`).join('; ')
      showToast(`Not attached: ${names}`, 'error')
    }
    if (!accepted.length) return
    const entries = accepted.map(file => ({
      id: nextEntryId++,
      file,
      url: URL.createObjectURL(file),
      sectionKey,
      itemId,
      status: 'queued',
      error: '',
      session: sessionId,
    }))
    setQueue(q => [...q, ...entries])
    runQueue()
  }

  function retry(entryId) {
    setQueue(q => q.map(e => (e.id === entryId ? { ...e, status: 'queued', error: '' } : e)))
    runQueue()
  }

  function discard(entryId) {
    setQueue(q => {
      const entry = q.find(e => e.id === entryId)
      if (entry) URL.revokeObjectURL(entry.url)
      return q.filter(e => e.id !== entryId)
    })
  }

  // One button. Opened straight from the tap — the user gesture mobile
  // browsers require for the camera and the file picker.
  function handleAddPhotos() {
    if (prefersInAppCamera()) {
      const id = `s${nextEntryId++}`
      sessionRef.current = id
      setSession(id)
      return
    }
    pickerRef.current?.click()
  }

  function closeCamera() {
    for (const saved of sessionSavedRef.current) URL.revokeObjectURL(saved.url)
    setSaved(() => [])
    sessionRef.current = null
    setSession(null)
  }

  function handlePicked(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''   // allow picking the same photos again
    if (files.length) addFiles(files, sessionRef.current)
  }

  async function removeSaved(attachmentId) {
    setPreview(null)
    setSaved(list => {
      const hit = list.find(s => s.id === attachmentId)
      if (hit) URL.revokeObjectURL(hit.url)
      return list.filter(s => s.id !== attachmentId)
    })
    await onDelete?.(attachmentId)
  }

  // The camera strip: this session's photos in the order they were taken.
  const cameraPhotos = session
    ? [
        ...sessionSaved.map(s => ({
          key: `a${s.id}`, order: s.order, url: s.url, attachmentId: s.id, status: 'saved',
          onRemove: () => removeSaved(s.id),
        })),
        ...queue.filter(e => e.session === session).map(e => ({
          key: `q${e.id}`, order: e.id, url: e.url,
          status: e.status === 'failed' ? 'failed' : 'uploading',
          onRetry: e.status === 'failed' ? () => retry(e.id) : undefined,
          onRemove: e.status === 'uploading' ? undefined : () => discard(e.id),
        })),
      ].sort((a, b) => a.order - b.order)
    : []

  const inlinePhotos = itemAttachments.slice(0, MAX_INLINE_PHOTOS)
  const morePhotos = itemAttachments.length - inlinePhotos.length

  return (
    // `relative`: the visually hidden file input is absolutely positioned, and
    // without a positioned ancestor it is placed against the page body — far
    // down a long form, stretching the document so phones could scroll the
    // whole page past the app and show blank space.
    <div className="relative flex items-center gap-1 flex-wrap" data-testid="point-photos" data-photo-count={itemAttachments.length}>
      {!readOnly && (
        <>
          <button
            type="button"
            onClick={handleAddPhotos}
            title={isFail ? 'Add photos — required for failed items' : 'Add photos'}
            aria-label={isFail ? 'Add photos (required)' : 'Add photos'}
            className={`inline-flex items-center justify-center w-8 h-8 sm:w-7 sm:h-7 rounded transition-colors
              ${requiresImage
                ? 'text-red-500 bg-red-50 hover:bg-red-100 ring-1 ring-red-400 animate-pulse'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 bg-gray-50 sm:bg-transparent'
              }`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          </button>
          {/* Visually hidden (not display:none) so programmatic clicks work on
              every mobile browser. No `capture` attribute, so a phone's picker
              still offers the photo library. */}
          <input
            ref={pickerRef}
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="photo-input"
            onChange={handlePicked}
          />
        </>
      )}

      {/* Saved photos */}
      {inlinePhotos.map(att => (
        <div key={att.id} className="relative group flex-shrink-0">
          <button type="button" onClick={() => setPreview(att)} title={`Preview ${att.file_name}`} className="block" aria-label={`Preview ${att.file_name}`}>
            <AuthImage
              attachmentId={att.id}
              alt={att.file_name}
              className="w-8 h-8 object-cover rounded border border-gray-200 cursor-pointer"
              style={{ width: 32, height: 32 }}
            />
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onDelete(att.id)}
              title="Remove image"
              aria-label="Remove image"
              className="absolute -top-1.5 -right-1.5 flex md:hidden group-hover:md:flex bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 items-center justify-center transition-colors"
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}
      {morePhotos > 0 && (
        <button
          type="button"
          onClick={() => setGalleryOpen(true)}
          title={`Show all ${itemAttachments.length} photos`}
          aria-label={`Show all ${itemAttachments.length} photos`}
          className="inline-flex items-center justify-center h-8 min-w-[32px] px-1 rounded border border-gray-200 bg-gray-50 text-[11px] font-semibold text-pdi-navy hover:bg-pdi-frost"
        >
          +{morePhotos}
        </button>
      )}

      {/* Photos still uploading, or that failed */}
      {!readOnly && pending.map(entry => (
        <div key={entry.id} className="relative flex-shrink-0" title={entry.status === 'failed' ? `Upload failed: ${entry.error}` : 'Uploading…'}>
          <img
            src={entry.url}
            alt={entry.file.name}
            className={`w-8 h-8 object-cover rounded border ${entry.status === 'failed' ? 'border-red-500 opacity-60' : 'border-gray-200 opacity-70'}`}
            style={{ width: 32, height: 32 }}
          />
          {entry.status !== 'failed' && (
            <span className="absolute inset-0 flex items-center justify-center"><Loader2 size={13} className="animate-spin text-pdi-navy" /></span>
          )}
          {entry.status === 'failed' && (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 flex gap-0.5">
              <button type="button" onClick={() => retry(entry.id)} aria-label="Retry upload" title="Retry upload"
                className="w-5 h-5 rounded-full bg-pdi-navy text-white flex items-center justify-center"><RotateCcw size={10} /></button>
              <button type="button" onClick={() => discard(entry.id)} aria-label="Discard photo" title="Discard photo"
                className="w-5 h-5 rounded-full bg-gray-500 text-white flex items-center justify-center"><X size={10} /></button>
            </span>
          )}
        </div>
      ))}
      {!readOnly && inFlight.length > 1 && (
        <span className="text-[10px] text-gray-500 whitespace-nowrap">{inFlight.length} uploading…</span>
      )}
      {!readOnly && failed.length > 0 && (
        <span className="text-[10px] text-red-600 whitespace-nowrap" role="alert">{failed.length} failed</span>
      )}

      {/* In-app camera */}
      {session && (
        <CameraCapture
          photos={cameraPhotos}
          onCapture={file => addFiles([file], session)}
          onPickLibrary={() => pickerRef.current?.click()}
          onDone={closeCamera}
        />
      )}

      {/* All photos of the point */}
      {galleryOpen && createPortal(
        <Dialog open onClose={() => setGalleryOpen(false)} title={`Photos (${itemAttachments.length})`} className="sm:max-w-2xl">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="point-photo-gallery">
            {itemAttachments.map(att => (
              <div key={att.id} className="relative aspect-square">
                <button type="button" onClick={() => setPreview(att)} className="block w-full h-full" aria-label={`Preview ${att.file_name}`}>
                  <AuthImage attachmentId={att.id} alt={att.file_name} className="w-full h-full object-cover rounded border border-gray-200" />
                </button>
                {!readOnly && (
                  <button type="button" onClick={() => onDelete(att.id)} aria-label="Remove photo" title="Remove photo"
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center"><X size={12} /></button>
                )}
              </div>
            ))}
          </div>
          {itemAttachments.length === 0 && <p className="text-sm text-gray-500">No photos.</p>}
        </Dialog>,
        document.body
      )}

      {/* Preview */}
      {preview && createPortal(
        <Dialog open onClose={() => setPreview(null)} title="Photo" className="sm:max-w-2xl">
          <div className="space-y-3">
            <AuthImage attachmentId={preview.id} alt={preview.file_name} className="w-full max-h-[65vh] object-contain rounded bg-gray-50" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500 truncate">{preview.file_name}</span>
              <div className="flex gap-2 flex-shrink-0">
                {!readOnly && (
                  <button type="button" onClick={() => removeSaved(preview.id)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 min-h-[40px]">
                    <Trash2 size={14} /> Remove photo
                  </button>
                )}
                <button type="button" onClick={() => setPreview(null)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">Close</button>
              </div>
            </div>
          </div>
        </Dialog>,
        document.body
      )}
    </div>
  )
}
