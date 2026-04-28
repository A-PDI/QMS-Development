import { useState } from 'react'
import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'
import { Pencil, Trash2, Check, X } from 'lucide-react'

// Normalize old {pass:bool, fail:bool} format to new {result:'P'|'F'|'A'|''}
function normalizeRow(row) {
  if (row.result !== undefined) return row
  if (row.pass === true) return { ...row, result: 'P' }
  if (row.fail === true) return { ...row, result: 'F' }
  return { ...row, result: '' }
}

export default function SectionChecklist({
  section,
  data = [],
  onChange,
  readOnly = false,
  sectionKey,
  attachments = [],
  onUploadItem,
  onDeleteItem,
  uploadingKey,
  adminItemTools, // { onDelete(itemId), onEdit(itemId, name, requirement) }
}) {
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editReq, setEditReq] = useState('')

  function update(id, field, value) {
    const next = data.map(row => {
      if (row.id !== id) return row
      const norm = normalizeRow(row)
      return { ...norm, [field]: value }
    })
    onChange(next)
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditName(item.name || '')
    setEditReq(item.requirement || '')
  }

  function commitEdit() {
    if (adminItemTools?.onEdit) adminItemTools.onEdit(editingId, editName, editReq)
    setEditingId(null)
  }

  const showImages = !!sectionKey && (!!onUploadItem || readOnly)
  const showTools = !!adminItemTools

  function rowBg(row) {
    const r = normalizeRow(row)
    if (r.result === 'F') return 'bg-red-50 border-red-200'
    if (r.result === 'A') return 'bg-amber-50 border-amber-200'
    if (r.result === 'P') return 'bg-green-50 border-green-200'
    return 'bg-white border-gray-200'
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-8">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Inspection Item</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-44">Finding / Observation</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-28">Status</th>
              {showImages && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-20">Image</th>
              )}
              {showTools && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-20">Tools</th>
              )}
            </tr>
          </thead>
          <tbody>
            {section.items.map(item => {
              const rawRow = data.find(r => r.id === item.id) || { id: item.id, notes: '' }
              const row = normalizeRow(rawRow)
              const isFail = row.result === 'F'
              const isAccepted = row.result === 'A'
              const needsNotes = (isFail || isAccepted) && !row.notes?.trim()
              const isEditing = editingId === item.id
              return (
                <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isFail ? 'bg-red-50' : isAccepted ? 'bg-amber-50' : row.result === 'P' ? 'bg-green-50' : ''}`}>
                  <td className="px-3 py-2 text-gray-500 align-top pt-3">{item.id}</td>
                  <td className="px-3 py-2 text-gray-700 align-top pt-2">
                    {isEditing ? (
                      <div className="space-y-1">
                        <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                          className="w-full text-xs border border-pdi-navy rounded px-2 py-1 focus:outline-none" placeholder="Item name…" />
                        <input type="text" value={editReq} onChange={e => setEditReq(e.target.value)}
                          className="w-full text-xs border border-pdi-navy rounded px-2 py-1 focus:outline-none" placeholder="Requirement…" />
                      </div>
                    ) : (
                      <>
                        <div className="font-medium">{item.name}</div>
                        {item.requirement && <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.requirement}</div>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top pt-2">
                    {readOnly ? (
                      <span className="text-xs text-gray-600">{row.notes || '—'}</span>
                    ) : (
                      <div>
                        <input type="text"
                          className={`w-full text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pdi-navy ${needsNotes ? 'border-red-400 bg-red-50' : isAccepted ? 'border-amber-300' : 'border-gray-200'}`}
                          value={row.notes || ''}
                          onChange={e => update(item.id, 'notes', e.target.value)}
                          placeholder={isFail ? 'Description required…' : isAccepted ? 'Description required for Accepted…' : 'Notes…'}
                        />
                        {needsNotes && <span className="text-xs text-red-500">Description required</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top pt-3">
                    <PFNToggle value={row.result} onChange={v => update(item.id, 'result', v)} readOnly={readOnly} />
                  </td>
                  {showImages && (
                    <td className="px-3 py-2 align-top pt-2 text-center">
                      <ItemAttachment sectionKey={sectionKey} itemId={item.id} isFail={isFail || isAccepted}
                        attachments={attachments} onUpload={onUploadItem} onDelete={onDeleteItem}
                        uploadingKey={uploadingKey} readOnly={readOnly} />
                    </td>
                  )}
                  {showTools && (
                    <td className="px-3 py-2 align-top pt-2 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={commitEdit} title="Save" className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={13} /></button>
                          <button onClick={() => setEditingId(null)} title="Cancel" className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={13} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => startEdit(item)} title="Edit item" className="p-1 text-blue-500 hover:bg-blue-50 rounded"><Pencil size={13} /></button>
                          <button onClick={() => adminItemTools.onDelete(item.id)} title="Delete item" className="p-1 text-red-400 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {section.items.map(item => {
          const rawRow = data.find(r => r.id === item.id) || { id: item.id, notes: '' }
          const row = normalizeRow(rawRow)
          const isFail = row.result === 'F'
          const isAccepted = row.result === 'A'
          const needsNotes = (isFail || isAccepted) && !row.notes?.trim()
          return (
            <div key={item.id} className={`border rounded-lg p-3 ${rowBg(rawRow)}`}>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs text-gray-400 font-mono">#{item.id}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-gray-800">{item.name}</div>
                  {item.requirement && <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.requirement}</div>}
                </div>
                {showTools && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(item)} className="p-1 text-blue-500 hover:bg-blue-50 rounded"><Pencil size={12} /></button>
                    <button onClick={() => adminItemTools.onDelete(item.id)} className="p-1 text-red-400 hover:bg-red-50 rounded"><Trash2 size={12} /></button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className="text-xs text-gray-500">Status:</span>
                <PFNToggle value={row.result} onChange={v => update(item.id, 'result', v)} readOnly={readOnly} />
                {showImages && (
                  <div className="ml-auto">
                    <ItemAttachment sectionKey={sectionKey} itemId={item.id} isFail={isFail || isAccepted}
                      attachments={attachments} onUpload={onUploadItem} onDelete={onDeleteItem}
                      uploadingKey={uploadingKey} readOnly={readOnly} />
                  </div>
                )}
              </div>
              <div className="mt-2">
                {readOnly ? (
                  <div className="text-sm text-gray-700">{row.notes || '—'}</div>
                ) : (
                  <>
                    <input type="text"
                      className={`w-full text-sm border rounded px-2 py-2 focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px] ${needsNotes ? 'border-red-400 bg-red-50' : isAccepted ? 'border-amber-300' : 'border-gray-200'}`}
                      value={row.notes || ''} onChange={e => update(item.id, 'notes', e.target.value)}
                      placeholder={isFail ? 'Description required…' : isAccepted ? 'Description required for Accepted…' : 'Notes…'}
                    />
                    {needsNotes && <span className="text-xs text-red-500">Description required</span>}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
