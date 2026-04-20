import { useState } from 'react'
import { FileImage, Download, Upload, Search, ChevronDown, ChevronUp, Trash2, Star } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { getUser } from '../lib/auth'
import { useToast } from '../hooks/useToast'
import { formatDate } from '../lib/utils'

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export default function Drawings() {
  const user = getUser()
  const isAdminRole = user && (user.role === 'admin' || user.role === 'qc_manager')
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [uploadForm, setUploadForm] = useState({ part_number: '', version: '', notes: '' })
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [expandedParts, setExpandedParts] = useState({})

  const { data: drawings = [], isLoading } = useQuery({
    queryKey: ['drawings-all'],
    queryFn: async () => {
      const { data } = await api.get('/drawings')
      return data.drawings || []
    },
    refetchInterval: 30000,
  })

  // Group by part number
  const grouped = {}
  for (const d of drawings) {
    if (!grouped[d.part_number]) grouped[d.part_number] = []
    grouped[d.part_number].push(d)
  }

  const filteredKeys = Object.keys(grouped).filter(p =>
    !search || p.toLowerCase().includes(search.toLowerCase())
  ).sort()

  async function handleUpload(e) {
    e.preventDefault()
    if (!uploadFile || !uploadForm.part_number || !uploadForm.version) {
      showToast('Part number, version, and file are required', 'error')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', uploadFile)
      fd.append('part_number', uploadForm.part_number)
      fd.append('version', uploadForm.version)
      fd.append('notes', uploadForm.notes)
      await api.post('/drawings', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      qc.invalidateQueries({ queryKey: ['drawings-all'] })
      setUploadForm({ part_number: '', version: '', notes: '' })
      setUploadFile(null)
      setShowUpload(false)
      showToast('Drawing uploaded', 'success')
    } catch (err) {
      showToast(err?.response?.data?.error || 'Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleSetCurrent(drawingId) {
    try {
      await api.patch(`/drawings/${drawingId}/set-current`)
      qc.invalidateQueries({ queryKey: ['drawings-all'] })
      showToast('Set as current revision', 'success')
    } catch (err) {
      showToast('Failed to update', 'error')
    }
  }

  async function handleDelete(drawingId) {
    if (!window.confirm('Delete this drawing?')) return
    try {
      await api.delete(`/drawings/${drawingId}`)
      qc.invalidateQueries({ queryKey: ['drawings-all'] })
      showToast('Drawing deleted', 'success')
    } catch (err) {
      showToast('Delete failed', 'error')
    }
  }

  function handleDownload(drawing) {
    window.open(`${import.meta.env.VITE_API_URL || ''}/api/drawings/${drawing.id}/download`, '_blank')
  }

  function togglePart(part) {
    setExpandedParts(e => ({ ...e, [part]: !e[part] }))
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <FileImage size={22} className="text-pdi-navy" />
          <h1 className="text-xl font-bold text-pdi-navy">Engineering Drawings</h1>
        </div>
        <div className="sm:ml-auto flex items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search part number..."
              className="w-full sm:w-56 pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
            />
          </div>
          {isAdminRole && (
            <button
              onClick={() => setShowUpload(s => !s)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px]"
            >
              <Upload size={15} /> Upload
            </button>
          )}
        </div>
      </div>

      {/* Upload form (admins only) */}
      {isAdminRole && showUpload && (
        <div className="bg-white rounded-xl border border-pdi-navy/30 p-4 sm:p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-pdi-navy">Upload New Drawing</h3>
          <form onSubmit={handleUpload} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Part Number <span className="text-red-500">*</span></label>
                <input
                  value={uploadForm.part_number}
                  onChange={e => setUploadForm(f => ({ ...f, part_number: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                  placeholder="e.g. 12345-A"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Revision / Version <span className="text-red-500">*</span></label>
                <input
                  value={uploadForm.version}
                  onChange={e => setUploadForm(f => ({ ...f, version: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                  placeholder="e.g. Rev C"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <input
                value={uploadForm.notes}
                onChange={e => setUploadForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                placeholder="Optional notes..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">File (PDF or Image) <span className="text-red-500">*</span></label>
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-pdi-navy file:text-white min-h-[40px]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowUpload(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">Cancel</button>
              <button type="submit" disabled={uploading} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light min-h-[40px] disabled:opacity-50">
                {uploading ? 'Uploading...' : 'Upload Drawing'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Drawings list grouped by part number */}
      {isLoading ? (
        <div className="text-center text-gray-400 py-16">Loading...</div>
      ) : filteredKeys.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileImage size={40} className="mx-auto mb-3 opacity-30" />
          <p>{search ? 'No drawings match your search.' : 'No engineering drawings uploaded yet.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredKeys.map(part => {
            const partDrawings = grouped[part].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            const current = partDrawings.find(d => d.is_current) || partDrawings[0]
            const isExpanded = expandedParts[part]
            return (
              <div key={part} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Part header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => togglePart(part)}
                >
                  <FileImage size={18} className="text-pdi-navy flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 text-sm">{part}</div>
                    {current && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Current: {current.version} \u00b7 {formatDate(current.created_at)}
                        {current.notes && ` \u00b7 ${current.notes}`}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{partDrawings.length} revision{partDrawings.length !== 1 ? 's' : ''}</span>
                    {current && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDownload(current) }}
                        title="Download current revision"
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-pdi-navy text-white rounded hover:bg-pdi-navy-light min-h-[32px]"
                      >
                        <Download size={13} /> Download
                      </button>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>

                {/* Expanded revisions list */}
                {isExpanded && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {partDrawings.map(drawing => (
                      <div key={drawing.id} className={`flex items-center gap-3 px-4 py-3 ${drawing.is_current ? 'bg-pdi-frost' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">{drawing.version}</span>
                            {drawing.is_current && (
                              <span className="text-xs bg-pdi-teal/10 text-pdi-teal font-semibold px-1.5 py-0.5 rounded">Current</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {formatDate(drawing.created_at)}
                            {drawing.notes && ` \u00b7 ${drawing.notes}`}
                            {drawing.file_size_bytes ? ` \u00b7 ${formatBytes(drawing.file_size_bytes)}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleDownload(drawing)}
                            title="Download"
                            className="p-1.5 text-pdi-navy hover:bg-pdi-frost rounded min-h-[32px] min-w-[32px] flex items-center justify-center"
                          >
                            <Download size={15} />
                          </button>
                          {isAdminRole && !drawing.is_current && (
                            <button
                              onClick={() => handleSetCurrent(drawing.id)}
                              title="Set as current"
                              className="p-1.5 text-amber-500 hover:bg-amber-50 rounded min-h-[32px] min-w-[32px] flex items-center justify-center"
                            >
                              <Star size={15} />
                            </button>
                          )}
                          {isAdminRole && (
                            <button
                              onClick={() => handleDelete(drawing.id)}
                              title="Delete"
                              className="p-1.5 text-red-400 hover:bg-red-50 rounded min-h-[32px] min-w-[32px] flex items-center justify-center"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
