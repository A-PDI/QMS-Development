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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100">
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-8">#</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-40">Check Item</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Requirement</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-48">Finding / Observation</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-24">Status</th>
            {showImages && (
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-24">Image</th>
            )}
          </tr>
        </thead>
        <tbody>
          {section.items.map(item => {
            const row = data.find(r => r.id === item.id) || { id: item.id, finding: '', status: 'N' }
            const isFail = row.status === 'F'
            const failNeedsFinding = isFail && !row.finding?.trim()
            return (
              <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isFail ? 'bg-red-50' : ''}`}>
                <td className="px-3 py-2 text-gray-500">{item.id}</td>
                <td className="px-3 py-2 font-medium text-gray-700">{item.name}</td>
                <td className="px-3 py-2 text-gray-600 text-xs leading-relaxed">{item.requirement}</td>
                <td className="px-3 py-2">
                  {readOnly ? (
                    <span className="text-gray-700">{row.finding || '—'}</span>
                  ) : (
                    <div>
                      <textarea
                        className={`w-full text-xs border rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy ${
                          failNeedsFinding ? 'border-red-400 bg-red-50' : 'border-gray-200'
                        }`}
                        rows={2}
                        value={row.finding}
                        onChange={e => update(item.id, 'finding', e.target.value)}
                        placeholder={isFail ? 'Description required…' : 'Observation…'}
                      />
                      {failNeedsFinding && (
                        <span className="text-xs text-red-500">Required for failed item</span>
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
                      isFail={isFail}
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
  )
}
