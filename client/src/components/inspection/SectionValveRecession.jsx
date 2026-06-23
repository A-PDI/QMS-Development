import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'
import MeasurementInput from './MeasurementInput'

const EMPTY_CYL = { int1: '', int2: '', exh1: '', exh2: '', result: '' }

export default function SectionValveRecession({
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
    intake_min: '', intake_max: '', exhaust_min: '', exhaust_max: '',
    cylinders: Array(count).fill(null).map(() => ({ ...EMPTY_CYL })),
    ...data
  }
  if (!current.cylinders || current.cylinders.length !== count) {
    current.cylinders = Array(count).fill(null).map((_, i) => current.cylinders?.[i] || { ...EMPTY_CYL })
  }

  function setField(field, value) { onChange({ ...current, [field]: value }) }
  function setCylField(i, field, value) {
    const cylinders = current.cylinders.map((c, ci) => ci === i ? { ...c, [field]: value } : c)
    onChange({ ...current, cylinders })
  }

  const showImages = !!sectionKey && !!onUploadItem

  const limitClass = 'w-full sm:w-16 text-sm sm:text-xs border border-gray-200 rounded px-2 py-1.5 sm:py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px] sm:min-h-0'

  return (
    <div className="space-y-4">
      {/* Limits */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Intake Min:</span>
          <MeasurementInput value={current.intake_min} onChange={v => setField('intake_min', v)} readOnly={readOnly} placeholder="0.00" className={limitClass} ariaLabel="Intake minimum" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Max:</span>
          <MeasurementInput value={current.intake_max} onChange={v => setField('intake_max', v)} readOnly={readOnly} placeholder="0.00" className={limitClass} ariaLabel="Intake maximum" />
        </div>
        <div className="flex items-center gap-2 sm:ml-4">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Exhaust Min:</span>
          <MeasurementInput value={current.exhaust_min} onChange={v => setField('exhaust_min', v)} readOnly={readOnly} placeholder="0.00" className={limitClass} ariaLabel="Exhaust minimum" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Max:</span>
          <MeasurementInput value={current.exhaust_max} onChange={v => setField('exhaust_max', v)} readOnly={readOnly} placeholder="0.00" className={limitClass} ariaLabel="Exhaust maximum" />
        </div>
      </div>

      {/* Cylinder cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {current.cylinders.map((cyl, cylIdx) => {
          const isAccepted = cyl.result === 'A'
          const isFail = cyl.result === 'F'
          return (
            <div key={cylIdx} className="border rounded p-3 border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-600">Cylinder {cylIdx + 1}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <PFNToggle
                    value={cyl.result}
                    onChange={v => setCylField(cylIdx, 'result', v)}
                    readOnly={readOnly}
                  />
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
              <div className="grid grid-cols-2 gap-1.5">
                {[['int1','Int 1'],['int2','Int 2'],['exh1','Exh 1'],['exh2','Exh 2']].map(([f, label]) => (
                  <div key={f} className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 w-10 shrink-0">{label}</span>
                    <MeasurementInput
                      value={cyl[f] || ''}
                      onChange={v => setCylField(cylIdx, f, v)}
                      readOnly={readOnly}
                      placeholder="0.00"
                      className="w-full sm:w-16 text-sm sm:text-xs border border-gray-200 rounded px-2 py-1.5 sm:py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px] sm:min-h-0"
                      ariaLabel={`Cylinder ${cylIdx + 1} ${label}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
