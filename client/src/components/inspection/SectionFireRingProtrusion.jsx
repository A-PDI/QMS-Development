import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'

export default function SectionFireRingProtrusion({
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
  const current = { spec: '', cylinders: Array(section.cylinder_count).fill(''), result: '', notes: '', ...data }

  function set(field, value) { onChange({ ...current, [field]: value }) }
  function setCyl(i, value) {
    const cylinders = [...current.cylinders]
    cylinders[i] = value
    onChange({ ...current, cylinders })
  }

  const showImages = !!sectionKey && !!onUploadItem
  const isAccepted = current.result === 'A'
  const isFail = current.result === 'F'
  const needsNotes = isAccepted && !current.notes?.trim()
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
              {Array.from({ length: section.cylinder_count }, (_, i) => (
                <th key={i} className="px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-200">
                  Cylinder {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {Array.from({ length: section.cylinder_count }, (_, i) => (
                <td key={i} className="px-2 py-2 border border-gray-200">
                  {readOnly ? (
                    <span className="font-mono text-sm">{current.cylinders[i] || '\u2014'}</span>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-20 text-sm border-0 font-mono text-center focus:outline-none focus:ring-1 focus:ring-pdi-navy rounded"
                      value={current.cylinders[i] || ''}
                      onChange={e => setCyl(i, e.target.value)}
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
        {Array.from({ length: section.cylinder_count }, (_, i) => (
          <div key={i} className="border border-gray-200 rounded bg-white p-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Cyl {i + 1}</label>
            {readOnly ? (
              <span className="font-mono text-sm">{current.cylinders[i] || '\u2014'}</span>
            ) : (
              <input
                type="text"
                inputMode="decimal"
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px]"
                value={current.cylinders[i] || ''}
                onChange={e => setCyl(i, e.target.value)}
                placeholder="0.000"
              />
            )}
          </div>
        ))}
      </div>

      {/* Result + Notes */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Result:</span>
          <PFNToggle
            value={current.result}
            onChange={v => set('result', v)}
            readOnly={readOnly}
          />
        </div>
        <div className="flex-1">
          {readOnly ? (
            <span className="text-sm text-gray-600">{current.notes || '—'}</span>
          ) : (
            <div>
              <input
                type="text"
                className={`w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px] ${
                  needsNotes ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                }`}
                value={current.notes || ''}
                onChange={e => set('notes', e.target.value)}
                placeholder={isAccepted ? 'Description required…' : 'Notes…'}
              />
              {needsNotes && <span className="text-xs text-amber-600 mt-0.5 block">Description required</span>}
            </div>
          )}
        </div>
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
    </div>
  )
}