import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'
import { PFN_COLORS } from '../../lib/constants'

export default function SectionVisual({
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
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-32">CTQ Area</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-40">Failure Mode</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Acceptance Criteria</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-36">Method</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-28">Result</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-36">Remarks</th>
              {showImages && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-20">Image</th>
              )}
            </tr>
          </thead>
          <tbody>
            {section.items.map(item => {
              const row = data.find(r => r.id === item.id) || { id: item.id, result: '', remarks: '' }
              const isFail = row.result === 'F'
              const isAccepted = row.result === 'A'
              const needsRemarks = isAccepted && !row.remarks?.trim()
              return (
                <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isFail ? 'bg-red-50' : isAccepted ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-2 text-gray-500">{item.id}</td>
                  <td className="px-3 py-2 font-medium text-gray-700 text-xs">{item.ctq_area}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{item.failure_mode}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs leading-relaxed">{item.criteria}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{item.method}</td>
                  <td className="px-3 py-2">
                    <PFNToggle
                      value={row.result}
                      onChange={v => update(item.id, 'result', v)}
                      readOnly={readOnly}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="text-gray-700 text-xs">{row.remarks || '\u2014'}</span>
                    ) : (
                      <div>
                        <textarea
                          className={`w-full text-xs border rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy ${
                            needsRemarks ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                          }`}
                          rows={2}
                          value={row.remarks}
                          onChange={e => update(item.id, 'remarks', e.target.value)}
                          placeholder={isAccepted ? 'Description required for Accepted\u2026' : 'Remarks\u2026'}
                        />
                        {needsRemarks && <span className="text-xs text-amber-600">Description required</span>}
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
          const row = data.find(r => r.id === item.id) || { id: item.id, result: '', remarks: '' }
          const isFail = row.result === 'F'
          const isAccepted = row.result === 'A'
          const needsRemarks = isAccepted && !row.remarks?.trim()
          return (
            <div key={item.id} className={`border rounded-lg p-3 ${isFail ? 'bg-red-50 border-red-200' : isAccepted ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
                <div className="text-xs font-semibold text-gray-700 mb-1">{item.ctq_area || item.failure_mode || `Item ${item.id}`}</div>
                {item.criteria && <div className="text-xs text-gray-400 mb-2">{item.criteria}</div>}
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {['P','F','A'].map(v => (
                    <button key={v} type="button" disabled={readOnly}
                      onClick={() => !readOnly && update(item.id, 'result', row.result === v ? '' : v)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded border min-h-[32px] ${row.result === v ? PFN_COLORS[v] : 'bg-white text-gray-400 border-gray-200'} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}>
                      {v === 'P' ? 'Pass' : v === 'F' ? 'Fail' : 'Acc'}
                    </button>
                  ))}
                </div>
                <input type="text" value={row.remarks || ''} onChange={e => update(item.id, 'remarks', e.target.value)}
                  readOnly={readOnly}
                  placeholder={needsRemarks ? 'Remarks required…' : 'Remarks…'}
                  className={`w-full text-xs border rounded px-2 py-1.5 focus:outline-none min-h-[36px] ${needsRemarks ? 'border-amber-400 bg-amber-50' : 'border-gray-200'} ${readOnly ? 'bg-gray-50' : ''}`} />
                {onUploadItem && (
                  <div className="mt-2">
                    <ItemAttachment
                      sectionKey={sectionKey}
                      itemId={item.id}
                      attachments={attachments}
                      onUpload={onUploadItem}
                      onDelete={onDeleteItem}
                      uploading={uploadingKey === `${sectionKey}_${item.id}`}
                      readOnly={readOnly}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </>
  )
}