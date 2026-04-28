import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'

const EMPTY_CYL = { overall: '', int1: '', int2: '', exh1: '', exh2: '', notes: '' }

export default function SectionVacuumTest({
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
  const count = section.cylinder_count || 6
  const current = {
    cylinders: Array(count).fill(null).map(() => ({ ...EMPTY_CYL })),
    ...data
  }
  if (!current.cylinders || current.cylinders.length !== count) {
    current.cylinders = Array(count).fill(null).map((_, i) => current.cylinders?.[i] || { ...EMPTY_CYL })
  }

  function setCylField(i, field, value) {
    const cylinders = current.cylinders.map((c, ci) => ci === i ? { ...c, [field]: value } : c)
    onChange({ ...current, cylinders })
  }

  const showImages = !!sectionKey && !!onUploadItem

  const PFBtn = ({ value, target, onChange: onChg }) => (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => !readOnly && onChg(value === target ? '' : target)}
      className={`w-8 h-8 sm:w-7 sm:h-7 text-sm sm:text-xs font-bold rounded border transition-colors ${
        value === target
          ? target === 'P' ? 'bg-green-100 text-green-700 border-green-300' : 'bg-red-100 text-red-700 border-red-300'
          : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
      } ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
    >
      {target}
    </button>
  )

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {current.cylinders.map((cyl, cylIdx) => {
          const isFail = cyl.overall === 'fail' || cyl.overall === 'F'
          const isAccepted = cyl.overall === 'A'
          const needsNotes = isAccepted && !cyl.notes?.trim()
          return (
            <div key={cylIdx} className={`border rounded p-3 ${isFail ? 'border-red-200 bg-red-50' : isAccepted ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-600">Cylinder {cylIdx + 1}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => !readOnly && setCylField(cylIdx, 'overall', cyl.overall === 'pass' ? '' : 'pass')}
                      className={`px-3 py-1.5 sm:px-2 sm:py-0.5 text-xs font-semibold rounded border min-h-[32px] sm:min-h-0 ${cyl.overall === 'pass' ? 'bg-green-100 text-green-700 border-green-300' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      Pass
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => !readOnly && setCylField(cylIdx, 'overall', cyl.overall === 'fail' ? '' : 'fail')}
                      className={`px-3 py-1.5 sm:px-2 sm:py-0.5 text-xs font-semibold rounded border min-h-[32px] sm:min-h-0 ${cyl.overall === 'fail' ? 'bg-red-100 text-red-700 border-red-300' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      Fail
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => !readOnly && setCylField(cylIdx, 'overall', cyl.overall === 'A' ? '' : 'A')}
                      className={`px-3 py-1.5 sm:px-2 sm:py-0.5 text-xs font-semibold rounded border min-h-[32px] sm:min-h-0 ${cyl.overall === 'A' ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      Acc
                    </button>
                  </div>
                  {showImages && (
                    <ItemAttachment
                      sectionKey={sectionKey}
                      itemId={cylIdx}
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
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {[['int1','Int 1'],['int2','Int 2'],['exh1','Exh 1'],['exh2','Exh 2']].map(([f, label]) => (
                  <div key={f}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-gray-500">{label}</span>
                      <div className="flex gap-0.5">
                        <PFBtn value={cyl[f]} target="P" onChange={v => setCylField(cylIdx, f, v)} />
                        <PFBtn value={cyl[f]} target="F" onChange={v => setCylField(cylIdx, f, v)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {(isAccepted || needsNotes) && (
                <input
                  type="text"
                  value={cyl.notes || ''}
                  onChange={e => setCylField(cylIdx, 'notes', e.target.value)}
                  readOnly={readOnly}
                  placeholder={needsNotes ? 'Description required…' : 'Notes…'}
                  className={`mt-2 w-full text-xs border rounded px-2 py-1.5 focus:outline-none min-h-[36px] ${needsNotes ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}