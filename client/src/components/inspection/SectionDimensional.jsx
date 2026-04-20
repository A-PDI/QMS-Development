import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'

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
}) {
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
            </tr>
          </thead>
          <tbody>
            {section.items.map(item => {
              const row = data.find(r => r.id === item.id) || { id: item.id, spec: item.spec || '', actual1: '', actual2: '', actual3: '', status: '', notes: '' }
              const isAccepted = row.status === 'A'
              const isFail = row.status === 'F'
              const needsNotes = isAccepted && !row.notes?.trim()
              return (
                <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isFail ? 'bg-red-50' : isAccepted ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-2 text-gray-500">{item.id}</td>
                  <td className="px-3 py-2 font-medium text-gray-700 text-xs">{item.measurement}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{item.location}</td>
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
          const row = data.find(r => r.id === item.id) || { id: item.id, spec: item.spec || '', actual1: '', actual2: '', actual3: '', status: '', notes: '' }
          const isAccepted = row.status === 'A'
          const isFail = row.status === 'F'
          const needsNotes = isAccepted && !row.notes?.trim()
          return (
            <div key={item.id} className={`border rounded-lg p-3 ${isFail ? 'bg-red-50 border-red-200' : isAccepted ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-xs text-gray-400 font-mono">#{item.id}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-gray-800">{item.measurement}</div>
                  <div className="text-xs text-gray-500 leading-relaxed">{item.location}</div>
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-xs text-gray-500 mb-1">Spec / Limit</label>
                {readOnly ? (
                  <span className="font-mono text-sm">{row.spec || '\u2014'}</span>
                ) : (
                  <input
                    type="text"
                    className="w-full text-sm border border-gray-200 rounded px-2 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                    value={row.spec || ''}
                    onChange={e => update(item.id, 'spec', e.target.value)}
                    placeholder="e.g. 85.00\u00b10.02"
                  />
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {['actual1', 'actual2', 'actual3'].map((field, i) => (
                  <div key={field}>
                    <label className="block text-xs text-gray-500 mb-1">Actual {i + 1}</label>
                    {readOnly ? (
                      <span className="font-mono text-sm">{row[field] || '\u2014'}</span>
                    ) : (
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-full text-sm border border-gray-200 rounded px-2 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                        value={row[field] || ''}
                        onChange={e => update(item.id, field, e.target.value)}
                        placeholder="0.000"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">Status:</span>
                <PFNToggle
                  value={row.status}
                  onChange={v => update(item.id, 'status', v)}
                  readOnly={readOnly}
                  options={['P', 'F', 'A']}
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
              {!readOnly && (
                <div className="mt-2">
                  <input
                    type="text"
                    className={`w-full text-sm border rounded px-2 py-2 focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px] ${
                      needsNotes ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                    }`}
                    value={row.notes || ''}
                    onChange={e => update(item.id, 'notes', e.target.value)}
                    placeholder={isAccepted ? 'Description required for Accepted\u2026' : 'Notes\u2026'}
                  />
                  {needsNotes && <span className="text-xs text-amber-600">Required for Accepted</span>}
                </div>
              )}
              {readOnly && row.notes && (
                <div className="mt-1 text-xs text-gray-600">{row.notes}</div>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-gray-400 mt-2 px-1 sm:px-3">
        All measurements at 20\u00b0C (68\u00b0F) \u00b7 Dimensions in mm unless noted
      </p>
    </div>
  )
}
