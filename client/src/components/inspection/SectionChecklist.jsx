import ItemAttachment from './ItemAttachment'

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
}) {
  function update(id, field, value) {
    let next = data.map(row => {
      if (row.id !== id) return row
      if (field === 'pass' && value) return { ...row, pass: true, fail: false }
      if (field === 'fail' && value) return { ...row, pass: false, fail: true }
      return { ...row, [field]: value }
    })
    onChange(next)
  }

  const showImages = !!sectionKey && !!onUploadItem

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100">
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-8">#</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Inspection Item</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-14">Pass</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-14">Fail</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-48">Notes</th>
            {showImages && (
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-24">Image</th>
            )}
          </tr>
        </thead>
        <tbody>
          {section.items.map(item => {
            const row = data.find(r => r.id === item.id) || { id: item.id, pass: false, fail: false, notes: '' }
            const failNeedsNotes = row.fail && !row.notes?.trim()
            return (
              <tr
                key={item.id}
                className={`border-b border-gray-100 hover:bg-gray-50 ${
                  row.fail ? 'bg-red-50' : row.pass ? 'bg-green-50' : ''
                }`}
              >
                <td className="px-3 py-2 text-gray-500 align-top pt-3">{item.id}</td>
                <td className="px-3 py-2 text-gray-700">
                  {item.name ? (
                    <>
                      <div className="font-medium">{item.name}</div>
                      {item.requirement && (
                        <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.requirement}</div>
                      )}
                    </>
                  ) : (
                    <span>{item.description}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center align-top pt-3">
                  <input
                    type="checkbox"
                    checked={!!row.pass}
                    disabled={readOnly}
                    onChange={e => update(item.id, 'pass', e.target.checked)}
                    className="w-4 h-4 accent-green-600"
                  />
                </td>
                <td className="px-3 py-2 text-center align-top pt-3">
                  <input
                    type="checkbox"
                    checked={!!row.fail}
                    disabled={readOnly}
                    onChange={e => update(item.id, 'fail', e.target.checked)}
                    className="w-4 h-4 accent-red-600"
                  />
                </td>
                <td className="px-3 py-2 align-top pt-3">
                  {readOnly ? (
                    <span className="text-xs text-gray-600">{row.notes || '—'}</span>
                  ) : (
                    <div>
                      <input
                        type="text"
                        className={`w-full text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pdi-navy ${
                          failNeedsNotes ? 'border-red-400 bg-red-50' : 'border-gray-200'
                        }`}
                        value={row.notes}
                        onChange={e => update(item.id, 'notes', e.target.value)}
                        placeholder={row.fail ? 'Description required…' : 'Notes…'}
                      />
                      {failNeedsNotes && (
                        <span className="text-xs text-red-500">Required for failed item</span>
                      )}
                    </div>
                  )}
                </td>
                {showImages && (
                  <td className="px-3 py-2 align-top pt-3">
                    <ItemAttachment
                      sectionKey={sectionKey}
                      itemId={item.id}
                      isFail={!!row.fail}
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
