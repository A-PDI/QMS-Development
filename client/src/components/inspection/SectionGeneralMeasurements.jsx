import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'

const FIELD_LABELS = {
  specification: 'Specification',
  actual_value: 'Actual Value',
  notes: 'Notes',
}

export default function SectionGeneralMeasurements({
  section,
  data = [],
  onChange,
  readOnly = false,
  sectionKey,
  attachments = [],
  onUploadItem,
  onDeleteItem,
  uploadingKey,
}) {
  function update(id, field, value) {
    const next = data.map(row => row.id === id ? { ...row, [field]: value } : row)
    onChange(next)
  }

  const showImages = !!sectionKey && !!onUploadItem

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-8">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-44">Measurement</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-40">Specification</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-40">Actual Value</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Notes</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-28">Result</th>
              {showImages && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-20">Image</th>
              )}
            </tr>
          </thead>
          <tbody>
            {section.items.map(item => {
              const row = data.find(r => r.id === item.id) || { id: item.id, specification: '', actual_value: '', notes: '', result: '' }
              const isAccepted = row.result === 'A'
              const isFail = row.result === 'F'
              const needsNotes = isAccepted && !row.notes?.trim()
              return (
                <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isFail ? 'bg-red-50' : isAccepted ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-2 text-gray-500">{item.id}</td>
                  <td className="px-3 py-2 font-medium text-gray-700">{item.measurement}</td>
                  {['specification', 'actual_value'].map(field => (
                    <td key={field} className="px-3 py-2">
                      {readOnly ? (
                        <span className="text-xs font-mono">{row[field] || '\u2014'}</span>
                      ) : (
                        <input
                          type="text"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                          value={row[field] || ''}
                          onChange={e => update(item.id, field, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="text-xs">{row.notes || '\u2014'}</span>
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
                  <td className="px-3 py-2">
                    <PFNToggle
                      value={row.result || ''}
                      onChange={v => update(item.id, 'result', v)}
                      readOnly={readOnly}
                    />
                  </td>
                  {showImages && (
                    <td className="px-3 py-2">
                      <ItemAttachment
                        sectionKey={sectionKey}
                        itemId={item.id}
                        isFail={isFail || isAccepted}
                        attachments={attachments}
                        onUpload={onUploadItem}
                        onDelete={onDeleteItem}
                        uploadingKey={uploadingKey}
                        readOnly={readOnly}
                      />
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
          const row = data.find(r => r.id === item.id) || { id: item.id, specification: '', actual_value: '', notes: '', result: '' }
          const isAccepted = row.result === 'A'
          const isFail = row.result === 'F'
          const needsNotes = isAccepted && !row.notes?.trim()
          return (
            <div key={item.id} className={`border rounded-lg p-3 ${isFail ? 'bg-red-50 border-red-200' : isAccepted ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-xs text-gray-400 font-mono">#{item.id}</span>
                <div className="font-medium text-sm text-gray-800 min-w-0 flex-1">{item.measurement}</div>
              </div>
              <div className="space-y-2">
                {['specification', 'actual_value'].map(field => (
                  <div key={field}>
                    <label className="block text-xs text-gray-500 mb-1">{FIELD_LABELS[field]}</label>
                    {readOnly ? (
                      <span className="text-sm font-mono">{row[field] || '\u2014'}</span>
                    ) : (
                      <input
                        type="text"
                        className="w-full text-sm border border-gray-200 rounded px-2 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                        value={row[field] || ''}
                        onChange={e => update(item.id, field, e.target.value)}
                      />
                    )}
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Notes</label>
                  {readOnly ? (
                    <span className="text-sm">{row.notes || '\u2014'}</span>
                  ) : (
                    <input
                      type="text"
                      className={`w-full text-sm border rounded px-2 py-2 focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px] ${
                        needsNotes ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                      }`}
                      value={row.notes || ''}
                      onChange={e => update(item.id, 'notes', e.target.value)}
                      placeholder={isAccepted ? 'Description required\u2026' : 'Notes\u2026'}
                    />
                  )}
                  {needsNotes && <span className="text-xs text-amber-600">Required for Accepted</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Result:</span>
                  <PFNToggle
                    value={row.result || ''}
                    onChange={v => update(item.id, 'result', v)}
                    readOnly={readOnly}
                  />
                  {showImages && (
                    <div className="ml-auto">
                      <ItemAttachment
                        sectionKey={sectionKey}
                        itemId={item.id}
                        isFail={isFail || isAccepted}
                        attachments={attachments}
                        onUpload={onUploadItem}
                        onDelete={onDeleteItem}
                        uploadingKey={uploadingKey}
                        readOnly={readOnly}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
