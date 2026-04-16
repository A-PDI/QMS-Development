import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

export default function FileUploadZone({ onUpload }) {
  const inputRef = useRef()
  const [dragging, setDragging] = useState(false)

  function handleFiles(fileList) {
    const files = Array.from(fileList)
    if (files.length > 0) onUpload(files)
  }

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
        dragging ? 'border-pdi-navy bg-blue-50' : 'border-gray-200 hover:border-pdi-navy hover:bg-pdi-frost'
      }`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
    >
      <Upload size={20} className="text-gray-400 mx-auto mb-2" />
      <p className="text-sm text-gray-500">Drop files here or click to browse</p>
      <p className="text-xs text-gray-400 mt-0.5">JPG, PNG, PDF — max 25 MB each</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.pdf"
        className="hidden"
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
