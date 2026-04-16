import { useRef } from 'react'
import { Camera, X, Loader2 } from 'lucide-react'
import AuthImage from '../AuthImage'

/**
 * Per-inspection-point image attachment widget.
 *
 * Props:
 *  inspectionId  — parent inspection UUID
 *  sectionKey    — e.g. "section_b"
 *  itemId        — numeric item id from template
 *  isFail        — when true, an image is required
 *  attachments   — full attachments array for the inspection (filtered internally)
 *  onUpload(file, sectionKey, itemId)  — called when user picks a file
 *  onDelete(attachmentId)              — called when user removes a thumbnail
 *  uploadingKey  — string "${sectionKey}_${itemId}" while uploading; shows spinner
 *  readOnly      — disable interactions
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
  const inputRef = useRef(null)

  const itemAttachments = attachments.filter(
    a => a.section_key === sectionKey && String(a.item_id) === String(itemId)
  )
  const hasImage = itemAttachments.length > 0
  const isUploading = uploadingKey === `${sectionKey}_${itemId}`
  const requiresImage = isFail && !hasImage && !isUploading

  function handlePickFile(e) {
    const file = e.target.files?.[0]
    if (file) onUpload(file, sectionKey, itemId)
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Camera icon button */}
      {!readOnly && (
        <>
          <button
            type="button"
            title={isFail ? 'Add image (required for failed items)' : 'Add image'}
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className={`inline-flex items-center justify-center w-6 h-6 rounded transition-colors
              ${requiresImage
                ? 'text-red-500 bg-red-50 hover:bg-red-100 ring-1 ring-red-400 animate-pulse'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
          >
            {isUploading
              ? <Loader2 size={12} className="animate-spin" />
              : <Camera size={12} />
            }
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handlePickFile}
          />
        </>
      )}

      {/* Thumbnails */}
      {itemAttachments.map(att => (
        <div key={att.id} className="relative group flex-shrink-0">
          <AuthImage
            attachmentId={att.id}
            alt={att.file_name}
            className="w-8 h-8 object-cover rounded border border-gray-200 cursor-pointer"
            style={{ width: 32, height: 32 }}
            title={att.file_name}
            onClick={() => {
              // Open a new tab using the API with auth
              import('../../lib/api').then(({ default: api }) => {
                api.get(`/attachments/download/${att.id}`, { responseType: 'blob' }).then(res => {
                  const url = URL.createObjectURL(res.data)
                  window.open(url, '_blank')
                })
              })
            }}
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => onDelete(att.id)}
              title="Remove image"
              className="absolute -top-1.5 -right-1.5 hidden group-hover:flex bg-red-500 hover:bg-red-600 text-white rounded-full w-4 h-4 items-center justify-center transition-colors"
            >
              <X size={9} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
