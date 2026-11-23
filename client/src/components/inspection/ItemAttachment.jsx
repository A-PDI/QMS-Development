import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ImagePlus, X, Loader2, RotateCcw, AlertTriangle, Trash2, Check } from 'lucide-react'
import AuthImage from '../AuthImage'
import { Dialog } from '../ui/dialog'
import { useToast } from '../../hooks/useToast'
import { IMAGE_ACCEPT, partitionPhotos, pointAttachments, uploadErrorMessage } from '../../lib/photoUpload'

let nextEntryId = 1

// Photos shown inline on the point; the rest open in a gallery so a point
// with many photos doesn't stretch its row.
const MAX_INLINE_PHOTOS = 3

/**
 * Photos for one inspection point — one button.
 *
 * The button opens the device's own picker: on iOS / Android that offers
 * "Take Photo" or the photo library, where several photos can be selected at
 * once; on a desktop it is the file picker. Once photos are added a dialog
 * keeps the session open — "Add more photos" or "Done" — so photos can be
 * taken one after another without starting over each time.
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

  // Photo session: { id, sectionKey, itemId } while open; uploaded ids shown in it.
  const [session, setSession] = useState(null)
  const [sessionUploads, setSessionUploads] = useState([])
  const [preview, setPreview] = useState(null)
  const [galleryOpen, setGalleryOpen] = useState(false)

  function setQueue(updater) {
    queueRef.current = updater(queueRef.current)
    setQueueState(queueRef.current)
  }

  // Release the local previews when the point goes away.
  useEffect(() => () => {
    for (const entry of queueRef.current) URL.revokeObjectURL(entry.url)
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
          URL.revokeObjectURL(next.url)
          setQueue(q => q.filter(e => e.id !== next.id))
          if (next.session && attachment?.id) {
            setSessionUploads(list => [...list, { session: next.session, id: attachment.id }])
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

  // Opened straight from the tap — the user gesture mobile browsers require.
  function openPicker() {
    pickerRef.current?.click()
  }

  function closeSession() {
    setSession(null)
    setSessionUploads([])
  }

  function handlePicked(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''   // allow picking the same photos again
    if (!files.length) return   // picker cancelled
    let sessionId = session?.id
    if (!sessionId) {
      sessionId = `s${nextEntryId++}`
      setSession({ id: sessionId, sectionKey, itemId })
      setSessionUploads([])
    }
    addFiles(files, sessionId)
  }

  async function removeAttachment(attachmentId) {
    setPreview(null)
    setSessionUploads(list => list.filter(u => u.id !== attachmentId))
    await onDelete?.(attachmentId)
  }

  const sessionEntries = session ? queue.filter(e => e.session === session.id) : []
  const sessionSaved = session
    ? sessionUploads.filter(u => u.session === session.id).map(u => attachments.find(a => a.id === u.id) || { id: u.id, file_name: 'Photo' })
    : []
  const sessionCount = sessionSaved.length + sessionEntries.length
  const sessionBusy = sessionEntries.some(e => e.status !== 'failed')

  const inlinePhotos = itemAttachments.slice(0, MAX_INLINE_PHOTOS)
  const morePhotos = itemAttachments.length - inlinePhotos.length

  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid="point-photos" data-photo-count={itemAttachments.length}>
      {!readOnly && (
        <>
          <button
            type="button"
            onClick={openPicker}
            title={isFail
              ? 'Add photos — required for failed items (camera or library, several at once)'
              : 'Add photos (camera or library, several at once)'}
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
              every mobile browser. No `capture` attribute: that would force the
              camera and hide the library — without it iOS and Android offer both. */}
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

      {/* Photo session */}
      {session && createPortal(
        <Dialog open onClose={closeSession} title="Photos" className="sm:max-w-md">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {sessionCount === 0
                ? 'No photos added in this session.'
                : `${sessionCount} photo${sessionCount === 1 ? '' : 's'} added to this inspection point.`}
              {' '}Add more with the camera or from the library, or finish.
            </p>
            {sessionCount > 0 && (
              <div className="grid grid-cols-4 gap-2" data-testid="photo-session-photos">
                {sessionSaved.map(att => (
                  <div key={att.id} className="relative aspect-square">
                    <AuthImage attachmentId={att.id} alt={att.file_name} className="w-full h-full object-cover rounded border border-gray-200" />
                    <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-pdi-green text-white flex items-center justify-center" title="Saved"><Check size={10} strokeWidth={3} /></span>
                    <button type="button" onClick={() => removeAttachment(att.id)} aria-label="Remove photo" title="Remove photo"
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center"><X size={12} /></button>
                  </div>
                ))}
                {sessionEntries.map(entry => (
                  <div key={entry.id} className="relative aspect-square">
                    <img src={entry.url} alt={entry.file.name} className={`w-full h-full object-cover rounded border ${entry.status === 'failed' ? 'border-red-500 opacity-60' : 'border-gray-200 opacity-70'}`} />
                    {entry.status !== 'failed'
                      ? <span className="absolute inset-0 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-pdi-navy" /></span>
                      : (
                        <span className="absolute inset-x-0 bottom-1 flex justify-center gap-1">
                          <button type="button" onClick={() => retry(entry.id)} className="px-1.5 py-0.5 text-[10px] rounded bg-pdi-navy text-white">Retry</button>
                          <button type="button" onClick={() => discard(entry.id)} className="px-1.5 py-0.5 text-[10px] rounded bg-gray-600 text-white">Discard</button>
                        </span>
                      )}
                  </div>
                ))}
              </div>
            )}
            {sessionEntries.some(e => e.status === 'failed') && (
              <p className="flex items-start gap-1.5 text-xs text-red-600" role="alert">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                Some photos didn’t upload. Retry them, or they stay on the inspection point to retry later.
              </p>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-gray-100">
              <button type="button" onClick={closeSession}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[44px]">
                {sessionBusy ? 'Done (finishing uploads)' : 'Done'}
              </button>
              <button type="button" onClick={openPicker}
                className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[44px]">
                <ImagePlus size={15} /> Add more photos
              </button>
            </div>
          </div>
        </Dialog>,
        document.body
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
                  <button type="button" onClick={() => removeAttachment(preview.id)}
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
