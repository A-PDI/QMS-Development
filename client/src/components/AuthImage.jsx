import { useState, useEffect } from 'react'
import api from '../lib/api'

/**
 * Fetches an attachment image through the authenticated API and renders it.
 * Avoids the "missing authorization header" issue with plain <img src="/api/..."> tags.
 */
export default function AuthImage({ attachmentId, className = '', alt = '', style = {}, onClick }) {
  const [objectUrl, setObjectUrl] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!attachmentId) return
    let url = null

    api.get(`/attachments/download/${attachmentId}`, { responseType: 'blob' })
      .then(res => {
        url = URL.createObjectURL(res.data)
        setObjectUrl(url)
      })
      .catch(() => setError(true))

    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [attachmentId])

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
    />
  )
}
