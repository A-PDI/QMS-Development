import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react'
import AuthImage from '../AuthImage'
import { ncrImagePath } from '../../hooks/useNCRs'
import { NCR_IMAGE_ACCEPT, NCR_LIMITS, imageFileProblem, imageFromFile, moveItem } from '../../lib/ncrReport'

/**
 * Captioned photos for one block of the NCR (the Photos block or a section).
 * Photos picked here stay local (with an object-URL preview) until the NCR is
 * saved; `onRemove` lets the editor record removed photos for that save.
 */
export default function NcrImageEditor({ images, onChange, onRemove, onError, disabled = false }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  function addFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const problems = []
    const added = []
    for (const file of files) {
      const problem = imageFileProblem(file)
      if (problem) { problems.push(problem); continue }
      added.push(imageFromFile(file, URL.createObjectURL(file)))
    }
    if (problems.length && onError) onError(problems.join('. '))
    if (added.length) onChange([...images, ...added])
  }

  function setCaption(index, caption) {
    onChange(images.map((img, i) => (i === index ? { ...img, caption } : img)))
  }

  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {images.map((img, i) => (
            <div key={img.key} className="border border-gray-200 rounded-lg overflow-hidden bg-white flex flex-col">
              <div className="relative bg-gray-100 aspect-[4/3] overflow-hidden">
                {img.previewUrl ? (
                  <img src={img.previewUrl} alt={img.caption || 'New photo'} className="absolute inset-0 w-full h-full object-contain" />
                ) : (
                  <AuthImage src={ncrImagePath(img.id)} alt={img.caption || 'Photo'} className="absolute inset-0 w-full h-full object-contain" />
                )}
                {!img.id && (
                  <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold bg-amber-500 text-white px-1.5 py-0.5 rounded">
                    Not saved
                  </span>
                )}
              </div>
              <div className="p-2 space-y-2 flex-1 flex flex-col">
                <textarea
                  rows={2}
                  maxLength={NCR_LIMITS.captionLength}
                  value={img.caption}
                  disabled={disabled}
                  onChange={e => setCaption(i, e.target.value)}
                  placeholder="Caption (optional)"
                  aria-label={`Caption for photo ${i + 1}`}
                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                />
                <div className="flex items-center justify-between mt-auto">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onChange(moveItem(images, i, -1))}
                      disabled={disabled || i === 0}
                      title="Move earlier"
                      aria-label="Move photo earlier"
                      className="p-2 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <ArrowLeft size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(moveItem(images, i, 1))}
                      disabled={disabled || i === images.length - 1}
                      title="Move later"
                      aria-label="Move photo later"
                      className="p-2 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(img)}
                    disabled={disabled}
                    title="Remove photo"
                    aria-label="Remove photo"
                    className="p-2 rounded-md border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled) addFiles(e.dataTransfer.files) }}
        className={`w-full border-2 border-dashed rounded-lg px-4 py-4 text-center transition-colors disabled:opacity-50 ${
          dragging ? 'border-pdi-navy bg-blue-50' : 'border-gray-200 hover:border-pdi-navy hover:bg-pdi-frost'
        }`}
      >
        <ImagePlus size={20} className="text-gray-400 mx-auto mb-1" />
        <span className="block text-sm text-gray-600">Add photos</span>
        <span className="block text-xs text-gray-400 mt-0.5">JPEG or PNG — max {NCR_LIMITS.fileSizeMb} MB each. Drop files here or tap to browse.</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={NCR_IMAGE_ACCEPT}
        className="hidden"
        onChange={e => { addFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
