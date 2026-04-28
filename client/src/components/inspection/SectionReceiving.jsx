import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'

export default function SectionReceiving({
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

  function rowClass(row) {
    if (row.status === 'F') return 'bg-red-50 border-red-200'
    if (row.status === 'A') return 'bg-amber-50 border-amber-200'
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
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-40">Check Item</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Requirement</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-48">Finding / Observation</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-28">Status</th>
              {showImages && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-24">Image</th>
              )}
            </tr>
          </thead>
          <tbody>
            {section.items.map(item => {
              const row = data.find(r => r.id === item.id) || { id: item.id, finding: '', status: '' }
              const isFail = row.status === 'F'
              const isAccepted = row.status === 'A'
              const needsFinding = (isFail || isAccepted) && !row.finding?.trim()
              const needsImage = showImages && isAccepted && !attachments.some(a => a.section_key === sectionKey && String(a.item_id) === String(item.id))
              return (
                <tr key={item.id} className={`border-b hover:bg-gray-50 ${isFail ? 'bg-red-50' : isAccepted ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-2 text-gray-500">{item.id}</td>
                  <td className="px-3 py-2 font-medium text-gray-700">{item.name}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs leading-relaxed">{item.requirement}</td>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="text-gray-700">{row.finding || '\u2014'}</span>
                    ) : (
                      <div>
                        <textarea
                          className={`w-full text-xs border rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy ${
                            needsFinding ? 'border-red-400 bg-red-50' : isAccepted ? 'border-amber-300' : 'border-gray-200'
                          }`}
                          rows={2}
                          value={row.finding}
                          onChange={e => update(item.id, 'finding', e.target.value)}
                          placeholder={isFail ? 'Description required\u2026' : isAccepted ? 'Description required for Accepted item\u2026' : 'Observation\u2026'}
                        />
                        {needsFinding && (
                          <span className="text-xs text-red-500">Description required</span>
                        )}
                        {isAccepted && needsImage && (
                          <span className="text-xs text-amber-600">Image required for Accepted item</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <PFNToggle
                      value={row.status}
                      onChange={v => update(item.id, 'status', v)}
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
          const row = data.find(r => r.id === item.id) || { id: item.id, finding: '', status: '' }
          const isFail = row.status === 'F'
          const isAccepted = row.status === 'A'
          const needsFinding = (isFail || isAccepted) && !row.finding?.trim()
          return (
            <div key={item.id} className={`border rounded-lg p-3 ${rowClass(row)}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs text-gray-400 font-mono">#{item.id}</span>
                    <span className="font-medium text-sm text-gray-800">{item.name}</span>
                  </div>
                  <div className="text-xs text-gray-600 leading-relaxed mt-1">{item.requirement}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-xs text-gray-500">Status:</span>
                <PFNToggle
                  value={row.status}
                  onChange={v => update(item.id, 'status', v)}
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
              <div className="mt-2">
                {readOnly ? (
                  <div className="text-sm text-gray-700">{row.finding || '\u2014'}</div>
                ) : (
                  <div>
                    <textarea
                      className={`w-full text-xs border rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[60px] ${
                        needsFinding ? 'border-red-400 bg-red-50' : isAccepted ? 'border-amber-300' : 'border-gray-200'
                      }`}
                      rows={2}
                      value={row.finding}
                      onChange={e => update(item.id, 'finding', e.target.value)}
                      placeholder={isFail ? 'Description required\u2026' : isAccepted ? 'Description required for Accepted item\u2026' : 'Observation\u2026'}
                    />
                    {needsFinding && <span className="text-xs text-red-500">Description required</span>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}