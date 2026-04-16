import { useState } from 'react'
import { FileText, X } from 'lucide-react'
import { Dialog } from './ui/dialog'
import { formatFileSize } from '@/lib/utils'
import { AuthImg } from './AuthImg'
import { openWithAuth } from '@/lib/authFetch'

export function FileGrid({ attachments = [], canDelete = false, onDelete }) {
  const [lightbox, setLightbox] = useState(null)
  const [confirmId, setConfirmId] = useState(null)

  if (!attachments.length) {
    return <p className="text-sm text-pdi-steel italic">No files uploaded.</p>
  }

  function handleDelete(e, att) {
    e.stopPropagation()
    setConfirmId(att.id)
  }

  function confirmDelete() {
    if (onDelete && confirmId != null) onDelete(confirmId)
    setConfirmId(null)
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {attachments.map(att => {
          const isImage = att.mime_type?.startsWith('image/')
          const url = `/api/attachments/download/${att.id}`
          return (
            <div
              key={att.id}
              className="relative border border-pdi-steel rounded-lg overflow-hidden cursor-pointer hover:border-pdi-navy transition-colors bg-white"
              onClick={() => isImage ? setLightbox(att) : openWithAuth(url).catch(console.error)}
            >
              {canDelete && (
                <button
                  onClick={(e) => handleDelete(e, att)}
                  className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow"
                  title="Remove attachment"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              {isImage ? (
                <AuthImg src={url} alt={att.file_name} className="w-full h-24 object-cover" />
              ) : (
                <div className="w-full h-24 bg-pdi-frost flex items-center justify-center">
                  <FileText className="w-10 h-10 text-pdi-steel" />
                </div>
              )}
              <div className="p-2">
                <p className="text-xs font-medium text-pdi-charcoal truncate">{att.file_name}</p>
                <p className="text-xs text-pdi-steel">{formatFileSize(att.file_size_bytes)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {lightbox && (
        <Dialog open={!!lightbox} onClose={() => setLightbox(null)} title={lightbox.file_name} className="max-w-3xl">
          <AuthImg
            src={`/api/attachments/download/${lightbox.id}`}
            alt={lightbox.file_name}
            className="w-full rounded"
          />
        </Dialog>
      )}

      {confirmId != null && (
        <Dialog open={true} onClose={() => setConfirmId(null)} title="Remove Attachment">
          <p className="text-sm text-pdi-charcoal mb-4">Are you sure you want to permanently remove this file? This cannot be undone.</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setConfirmId(null)}
              className="px-4 py-2 text-sm border border-pdi-steel rounded-lg text-pdi-charcoal hover:bg-pdi-frost"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg"
            >
              Remove
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
