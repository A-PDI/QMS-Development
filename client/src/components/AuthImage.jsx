import { useState, useEffect, useRef } from 'react'
import api from '../lib/api'

/**
 * Fetches an attachment image through the authenticated API and renders it.
 * Avoids the "missing authorization header" issue with plain <img src="/api/..."> tags.
 *
 * Pass `attachmentId` for an inspection attachment, or `src` for any other API
 * image path (e.g. an NCR photo). `onSettled` fires once, when the image has
 * finished loading or has failed.
 */
export default function AuthImage({ attachmentId, src, className = '', alt = '', style = {}, onClick, onSettled }) {
  const [objectUrl, setObjectUrl] = useState(null)
  const [error, setError] = useState(false)
  const settledRef = useRef(false)
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled
  const path = src || (attachmentId ? `/attachments/download/${attachmentId}` : null)

  function settle() {
    if (settledRef.current) return
    settledRef.current = true
    if (onSettledRef.current) onSettledRef.current()
  }

  useEffect(() => {
    if (!path) return
    let url = null
    let cancelled = false
    settledRef.current = false
    setError(false)
    setObjectUrl(null)

    api.get(path, { responseType: 'blob' })
      .then(res => {
        if (cancelled) return
        url = URL.createObjectURL(res.data)
        setObjectUrl(url)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
        settle()
      })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  if (error) {
    return (
      <div
        className={`bg-gray-100 flex items-center justify-center text-gray-400 text-xs ${className}`}
        style={style}
      >
        ?
      </div>
    )
  }

  if (!objectUrl) {
    return (
      <div
        className={`bg-gray-100 animate-pulse ${className}`}
        style={style}
      />
    )
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      style={style}
      onClick={onClick}
      onLoad={settle}
      onError={settle}
    />
  )
}
