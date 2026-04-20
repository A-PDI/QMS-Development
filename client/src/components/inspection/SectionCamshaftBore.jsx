import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'

export default function SectionCamshaftBore({
  section,
  data = {},
  onChange,
  readOnly = false,
  sectionKey,
  attachments = [],
  onUploadItem,
  onDeleteItem,
  uploadingKey,
}) {
  const current = { spec: '', bores: Array(section.bore_count).fill(''), result: '', notes: '', ...data }

  function set(field, value) {
    onChange({ ...current, [field]: value })
  }

  function setBore(i, value) {
    const bores = [...current.bores]
    bores[i] = value
    onChange({ ...current, bores })
  }

  const showImages = !!sectionKey && !!onUploadItem
  const isAccepted = current.result === 'A'
  const isFail = current.result === 'F'
  const needsNotes = isAccepted && !current.notes?.trim()
  // Use a synthetic item id = 0 for the section-level image
  const SECTION_ITEM_ID = 0

  return (
    <div className="space-y-3">
      {/* Spec row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
        <label className="text-sm font-medium text-gray-700 sm:w-12">Spec:</label>
        {readOnly ? (
          <span className="font-mono text-sm">{current.spec || '\u2014'}</span>
        ) : (
          <input
            type="text"
            className="w-full sm:w-48 border border-gray-200 rounded px-2 py-2 sm:py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px] sm:min-h-0"
            value={current.spec}
            onChange={e => set('spec', e.target.value)}
            placeholder="Specification..."
          />
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100">
              {Array.from({ length: section.bore_count }, (_, i) => (
                <th key={i} className="px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-200">
                  Bore {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {Array.from({ length: section.bore_count }, (_, i) => (
                <td key={i} className="px-2 py-2 border border-gray-200">
                  {readOnly ? (
                    <span className="font-mono text-sm">{current.bores[i] || '\u2014'}</span>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-20 text-sm border-0 font-mono text-center focus:outline-none focus:ring-1 focus:ring-pdi-navy rounded"
                      value={current.bores[i] || ''}
                      onChange={e => setBore(i, e.target.value)}
                      placeholder="0.000"
                    />
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile grid */}
      <div className="md:hidden grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Array.from({ length: section.bore_count }, (_, i) => (
          <div key={i} className="border border-gray-200 rounded bg-white p-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Bore {i + 1}</label>
            {readOnly ? (
              <span className="font-mono text-sm">{current.bores[i] || '\u2014'}</span>
            ) : (
              <input
                type="text"
                inputMode="decimal"
                className="w-full text-sm border border-gray-200 rounded px-2 py-2 font-mono text-center focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                value={current.bores[i] || ''}
                onChange={e => setBore(i, e.target.value)}
                placeholder="0.000"
              />
            )}
          </div>
        ))}
      </div>

      {/* Overall result row */}
      <div className={`flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100 ${isAccepted ? 'bg-amber-50 -mx-3 px-3 py-2 rounded' : isFail ? 'bg-red-50 -mx-3 px-3 py-2 rounded' : ''}`}>
        <span className="text-sm font-medium text-gray-700">Overall Result:</span>
        <PFNToggle
          value={current.result}
          onChange={v => set('result', v)}
          readOnly={readOnly}
        />
        {showImages && (
          <ItemAttachment
            sectionKey={sectionKey}
            itemId={SECTION_ITEM_ID}
            isFail={isFail || isAccepted}
            attachments={attachments}
            onUpload={onUploadItem}
            onDelete={onDeleteItem}
            uploadingKey={uploadingKey}
            readOnly={readOnly}
          />
        )}
      </div>
      {isAccepted && !readOnly && (
        <div>
          <input
            type="text"
            className={`w-full text-sm border rounded px-2 py-2 focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px] ${
              needsNotes ? 'border-amber-400 bg-amber-50' : 'border-amber-200'
            }`}
            value={current.notes || ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="Description required for Accepted\u2026"
          />
          {needsNotes && <span className="text-xs text-amber-600">Description required for Accepted items</span>}
        </div>
      )}
      {readOnly && isAccepted && current.notes && (
        <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded p-2">{current.notes}</div>
      )}
    </div>
  )
}
