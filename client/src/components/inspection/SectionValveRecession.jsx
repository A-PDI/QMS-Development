import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'
import MeasurementInput from './MeasurementInput'
import { SpecInfo, EvaluationBadge, InvalidEntryMessage, readingTone } from './DimensionalSpec'
import { pointKey, evaluateValveCylinder, allowedStatusOptions } from '../../lib/dimensional'

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
  specIndex,      // configured specs by point key (automatic Pass/Fail)
  specSectionKey, // this section's key in the form (for spec lookup)
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

  // Configured intake / exhaust limits make each cylinder's result automatic.
  const configured = side => {
    if (readOnly || !specIndex || !specSectionKey) return null
    const spec = specIndex[pointKey(specSectionKey, side)]
    return spec && spec.evaluable ? spec : null
  }
  const intakeSpec = configured('intake')
  const exhaustSpec = configured('exhaust')
  const specForField = f => (f.startsWith('int') ? intakeSpec : exhaustSpec)

  const limitClass = 'w-full sm:w-16 text-sm sm:text-xs border border-gray-200 rounded px-2 py-1.5 sm:py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px] sm:min-h-0'

  return (
    <div className="space-y-4">
      {/* Configured limits (locked) */}
      {(intakeSpec || exhaustSpec) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[['Intake', intakeSpec], ['Exhaust', exhaustSpec]].map(([label, spec]) => spec && (
            <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="text-xs font-semibold text-gray-600 mb-0.5">{label}</div>
              <SpecInfo spec={spec} />
            </div>
          ))}
        </div>
      )}

      {/* Limits */}
      <div className={`grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-4 text-sm ${intakeSpec && exhaustSpec ? 'hidden' : ''}`}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Intake Min:</span>
          <MeasurementInput value={current.intake_min} onChange={v => setField('intake_min', v)} readOnly={readOnly || !!intakeSpec} placeholder="0.00" className={limitClass} ariaLabel="Intake minimum" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Max:</span>
          <MeasurementInput value={current.intake_max} onChange={v => setField('intake_max', v)} readOnly={readOnly || !!intakeSpec} placeholder="0.00" className={limitClass} ariaLabel="Intake maximum" />
        </div>
        <div className="flex items-center gap-2 sm:ml-4">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Exhaust Min:</span>
          <MeasurementInput value={current.exhaust_min} onChange={v => setField('exhaust_min', v)} readOnly={readOnly || !!exhaustSpec} placeholder="0.00" className={limitClass} ariaLabel="Exhaust minimum" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Max:</span>
          <MeasurementInput value={current.exhaust_max} onChange={v => setField('exhaust_max', v)} readOnly={readOnly || !!exhaustSpec} placeholder="0.00" className={limitClass} ariaLabel="Exhaust maximum" />
        </div>
      </div>

      {/* Cylinder cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {current.cylinders.map((cyl, cylIdx) => {
          const isAccepted = cyl.result === 'A'
          const isFail = cyl.result === 'F'
          const evaluation = intakeSpec || exhaustSpec ? evaluateValveCylinder(cyl, intakeSpec, exhaustSpec) : null
          return (
            <div key={cylIdx} className="border rounded p-3 border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-600">Cylinder {cylIdx + 1}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <EvaluationBadge evaluation={evaluation} accepted={isAccepted} />
                  <PFNToggle
                    value={cyl.result}
                    onChange={v => setCylField(cylIdx, 'result', v)}
                    readOnly={readOnly}
                    allowed={evaluation ? allowedStatusOptions(evaluation) : undefined}
                    lockedTitle="set automatically from the measurements"
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
                      className={`w-full sm:w-16 text-sm sm:text-xs border border-gray-200 rounded px-2 py-1.5 sm:py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px] sm:min-h-0 ${readingTone(specForField(f), cyl[f])}`}
                      ariaLabel={`Cylinder ${cylIdx + 1} ${label}`}
                    />
                  </div>
                ))}
              </div>
              <InvalidEntryMessage evaluation={evaluation} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
