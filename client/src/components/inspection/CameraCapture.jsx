import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Images, Loader2, RotateCcw, X, AlertTriangle, Check } from 'lucide-react'
import AuthImage from '../AuthImage'
import { cameraErrorMessage, capturedPhotoName } from '../../lib/photoUpload'

// Rear camera, Full HD frames: sharp enough to document a part, small enough
// to upload quickly from the shop floor. `ideal` never fails — the browser
// picks the closest the camera offers.
const CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
}
const JPEG_QUALITY = 0.9

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop()
}

/**
 * Full-screen camera inside the app. Every tap of the shutter is a photo —
 * there is no "Use Photo" step per shot as with the system camera — and it is
 * handed to `onCapture(file)` straight away, so uploading runs while the
 * inspector keeps shooting.
 *
 * Props:
 *  photos        — this session's photos for the strip:
 *                  [{ key, url?, attachmentId?, status: 'uploading'|'saved'|'failed', onRemove?, onRetry? }]
 *  onCapture(file)
 *  onPickLibrary() — opens the device picker (called from a tap, as iOS requires)
 *  onDone()
 */
export default function CameraCapture({ photos = [], onCapture, onPickLibrary, onDone }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const sequenceRef = useRef(0)
  const stripRef = useRef(null)
  const [status, setStatus] = useState('starting')   // starting | live | error
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // Start (or restart) the camera; always release it when leaving.
  useEffect(() => {
    let cancelled = false
    setStatus('starting')
    setError('')
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) {
      setStatus('error')
      setError(cameraErrorMessage(null))
      return undefined
    }
    media.getUserMedia(CONSTRAINTS)
      .then(async (stream) => {
        if (cancelled) { stopStream(stream); return }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.muted = true            // iOS only autoplays muted, inline video
          video.srcObject = stream
          try { await video.play() } catch (_) { /* autoPlay takes over */ }
        }
        const track = stream.getVideoTracks()[0]
        track?.addEventListener('ended', () => {
          if (cancelled) return
          setStatus('error')
          setError('The camera stopped. Tap Try again to restart it.')
        })
        if (!cancelled) setStatus('live')
      })
      .catch((err) => {
        if (cancelled) return
        setStatus('error')
        setError(cameraErrorMessage(err))
      })
    return () => {
      cancelled = true
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [attempt])

  // The page underneath must not scroll while the camera is up.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onDoneRef.current?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // Keep the newest photo in view.
  useEffect(() => {
    const strip = stripRef.current
    if (strip) strip.scrollLeft = strip.scrollWidth
  }, [photos.length])

  function takePhoto() {
    const video = videoRef.current
    if (status !== 'live' || !video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    sequenceRef.current += 1
    const name = capturedPhotoName(new Date(), sequenceRef.current)
    setFlash(true)
    setTimeout(() => setFlash(false), 120)
    canvas.toBlob((blob) => {
      if (!blob) return
      onCapture?.(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }))
    }, 'image/jpeg', JPEG_QUALITY)
  }

  const savedCount = photos.filter(p => p.status === 'saved').length
  const pendingCount = photos.filter(p => p.status === 'uploading').length
  const failedCount = photos.filter(p => p.status === 'failed').length

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black text-white h-dvh select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Camera"
      data-testid="in-app-camera"
    >
      {/* Status line */}
      <div
        className="flex items-center justify-between px-4 text-xs"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))', paddingBottom: '0.5rem' }}
      >
        <span aria-live="polite">
          {photos.length === 0 ? 'Tap the shutter for each photo' : `${photos.length} photo${photos.length === 1 ? '' : 's'}`}
          {pendingCount > 0 && <span className="text-white/60"> · {pendingCount} uploading</span>}
          {failedCount > 0 && <span className="text-red-300"> · {failedCount} failed</span>}
        </span>
        {savedCount > 0 && <span className="text-white/60">{savedCount} saved</span>}
      </div>

      {/* Viewfinder — shows the whole frame that will be saved */}
      <div className="relative flex-1 min-h-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-contain"
        />
        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
            <Loader2 size={18} className="animate-spin" /> Starting camera…
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center" role="alert">
            <AlertTriangle size={28} className="text-amber-300" />
            <p className="text-sm text-white/90 max-w-sm">{error}</p>
            <button type="button" onClick={() => setAttempt(a => a + 1)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/15 hover:bg-white/25 text-sm min-h-[44px]">
              <RotateCcw size={15} /> Try again
            </button>
          </div>
        )}
        <div className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-100 ${flash ? 'opacity-70' : 'opacity-0'}`} />
      </div>

      {/* This session's photos */}
      {photos.length > 0 && (
        <div ref={stripRef} className="flex gap-2 overflow-x-auto px-4 pt-3 pb-1" data-testid="camera-photos">
          {photos.map(photo => (
            <div key={photo.key} className="relative flex-shrink-0 w-14 h-14">
              {photo.url
                ? <img src={photo.url} alt="Captured photo" className={`w-14 h-14 object-cover rounded-md border ${photo.status === 'failed' ? 'border-red-400 opacity-60' : 'border-white/30'}`} />
                : <AuthImage attachmentId={photo.attachmentId} alt="Captured photo" className="w-14 h-14 object-cover rounded-md border border-white/30" />}
              {photo.status === 'uploading' && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-md"><Loader2 size={16} className="animate-spin" /></span>
              )}
              {photo.status === 'saved' && (
                <span className="absolute bottom-0.5 left-0.5 w-4 h-4 rounded-full bg-pdi-green flex items-center justify-center" title="Saved">
                  <Check size={10} strokeWidth={3} />
                </span>
              )}
              {photo.status === 'failed' && photo.onRetry && (
                <button type="button" onClick={photo.onRetry} aria-label="Retry upload"
                  className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-md"><RotateCcw size={16} /></button>
              )}
              {photo.onRemove && (
                <button type="button" onClick={photo.onRemove} aria-label="Remove photo"
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center shadow">
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div
        className="grid grid-cols-3 items-center px-4 pt-3"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <button type="button" onClick={onPickLibrary}
          className="justify-self-start flex flex-col items-center gap-1 text-xs text-white/90 min-w-[64px] min-h-[56px] justify-center">
          <Images size={24} /> Library
        </button>
        <button type="button" onClick={takePhoto} disabled={status !== 'live'} aria-label="Take photo"
          className="justify-self-center w-[72px] h-[72px] rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform">
          <span className="block w-[56px] h-[56px] rounded-full bg-white" />
        </button>
        <button type="button" onClick={onDone}
          className="justify-self-end px-4 py-2 rounded-full bg-white text-pdi-navy text-sm font-semibold min-h-[44px] min-w-[64px]">
          Done
        </button>
      </div>
    </div>,
    document.body
  )
}
