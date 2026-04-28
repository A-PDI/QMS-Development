import { useState } from 'react'
import PFNToggle from './PFNToggle'
import { PFN_COLORS } from '../../lib/constants'
import ItemAttachment from './ItemAttachment'
import { Pencil, Trash2, Check, X } from 'lucide-react'

export default function SectionDimensional({
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
  const [editMeasurement, setEditMeasurement] = useState('')
  const [editLocation, setEditLocation] = useState('')

  function startEdit(item) {
    setEditingId(item.id)
    setEditMeasurement(item.measurement || '')
    setEditLocation(item.location || '')
  }

  function commitEdit() {
    if (adminItemTools?.onEdit) adminItemTools.onEdit(editingId, editMeasurement, editLocation)
    setEditingId(null)
  }

  const showTools = !!adminItemTools
  function update(id, field, value) {
    const next = data.map(row => row.id === id ? { ...row, [field]: value } : row)
    onChange(next)
  }

  const showImages = !!sectionKey && !!onUploadItem

  return (
    <div>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-8">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-44">Measurement</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Location(s)</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-36">Spec / Limit</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-24">Actual 1</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-24">Actual 2</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-24">Actual 3</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-28">Status</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-36">Notes</th>
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
              const row = data.find(r => r.id === item.id) || { id: item.id, spec: item.spec || '', actual1: '', actual2: '', actual3: '', status: '', notes: '' }
              const isAccepted = row.status === 'A'
              const isFail = row.status === 'F'
              const needsNotes = isAccepted && !row.notes?.trim()
              const isEditing = editingId === item.id
              return (
                <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isFail ? 'bg-red-50' : isAccepted ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-2 text-gray-500">{item.id}</td>
                  <td className="px-3 py-2 font-medium text-gray-700 text-xs">
                    {isEditing ? (
                      <input type="text" value={editMeasurement} onChange={e => setEditMeasurement(e.target.value)}
                        className="w-full text-xs border border-pdi-navy rounded px-2 py-1 focus:outline-none" placeholder="Measurement…" />
                    ) : item.measurement}
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs">
                    {isEditing ? (
                      <input type="text" value={editLocation} onChange={e => setEditLocation(e.target.value)}
                        className="w-full text-xs border border-pdi-navy rounded px-2 py-1 focus:outline-none" placeholder="Location…" />
                    ) : item.location}
                  </td>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="font-mono text-xs">{row.spec || '\u2014'}</span>
                    ) : (
                      <input
                        type="text"
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                        value={row.spec || ''}
                        onChange={e => update(item.id, 'spec', e.target.value)}
                        placeholder="e.g. 85.00\u00b10.02"
                      />
                    )}
                  </td>
                  {['actual1', 'actual2', 'actual3'].map(field => (
                    <td key={field} className="px-3 py-2">
                      {readOnly ? (
                        <span className="font-mono text-xs">{row[field] || '\u2014'}</span>
                      ) : (
                        <input
                          type="text"
                          inputMode="decimal"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                          value={row[field] || ''}
                          onChange={e => update(item.id, field, e.target.value)}
                          placeholder="0.000"
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <PFNToggle
                      value={row.status}
                      onChange={v => update(item.id, 'status', v)}
                      readOnly={readOnly}
                      options={['P', 'F', 'A']}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="text-xs text-gray-600">{row.notes || '\u2014'}</span>
                    ) : (
                      <div>
                        <input
                          type="text"
                          className={`w-full text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pdi-navy ${
                            needsNotes ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                          }`}
                          value={row.notes || ''}
                          onChange={e => update(item.id, 'notes', e.target.value)}
                          placeholder={isAccepted ? 'Description required\u2026' : 'Notes\u2026'}
                        />
                        {needsNotes && <span className="text-xs text-amber-600">Required for Accepted</span>}
                      </div>
                    )}
                  </td>
                  {showImages && (
                    <td className="px-3 py-2">
                      <ItemAttachment sectionKey={sectionKey} itemId={item.id} isFail={isFail || isAccepted}
                        attachments={attachments} onUpload={onUploadItem} onDelete={onDeleteItem}
                        uploadingKey={uploadingKey} readOnly={readOnly} />
                    </td>
                  )}
                  {showTools && (
                    <td className="px-3 py-2 text-center">
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
          const row = data.find(r => r.id === item.id) || { id: item.id, spec: item.spec || '', actual1: '', actual2: '', actual3: '', status: '', notes: '' }
          const isAccepted = row.status === 'A'
          const isFail = row.status === 'F'
          const needsNotes = isAccepted && !row.notes?.trim()
          return (
            <div key={item.id} className={`border rounded-lg p-3 ${isFail ? 'bg-red-50 border-red-200' : isAccepted ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="font-mono text-xs font-bold text-pdi-navy">{item.id}.</span>
                <span className="text-xs text-gray-700 font-medium">{item.measurement || item.location || `Item ${item.id}`}</span>
              </div>
              {item.spec && <div className="text-xs text-gray-400 mb-2">Spec: {item.spec}</div>}
              <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                {['actual1','actual2','actual3'].map((f,i) => (
                  <div key={f}>
                    <label className="block text-xs text-gray-400 mb-0.5">M{i+1}</label>
                    {readOnly ? (
                      <span className="text-xs font-mono">{row[f] || '—'}</span>
                    ) : (
                      <input type="text" value={row[f] || ''} onChange={e => update(item.id, f, e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px]" />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {['P','F','A'].map(v => (
                  <button key={v} type="button" disabled={readOnly}
                    onClick={() => !readOnly && update(item.id, 'status', row.status === v ? '' : v)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded border min-h-[32px] ${row.status === v ? PFN_COLORS[v] : 'bg-white text-gray-400 border-gray-200'} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}>
                    {v === 'P' ? 'Pass' : v === 'F' ? 'Fail' : 'Acc'}
                  </button>
                ))}
              </div>
              {needsNotes && (
                <input type="text" value={row.notes || ''} onChange={e => update(item.id, 'notes', e.target.value)}
                  placeholder="Description required…"
                  className="mt-1.5 w-full text-xs border border-amber-400 bg-amber-50 rounded px-2 py-1.5 focus:outline-none min-h-[36px]" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
