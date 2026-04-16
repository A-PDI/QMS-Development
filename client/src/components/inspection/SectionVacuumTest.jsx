const EMPTY_CYL = { overall: '', int1: '', int2: '', exh1: '', exh2: '' }

export default function SectionVacuumTest({ section, data = {}, onChange, readOnly = false }) {
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
      {/* Cylinder cards — 1 col on mobile, 2 on sm, 3 on md+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {current.cylinders.map((cyl, cylIdx) => {
          const isFail = cyl.overall === 'fail'
          return (
            <div key={cylIdx} className={`border rounded p-3 ${isFail ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-600">Cylinder {cylIdx + 1}</span>
                <div className="flex gap-1.5">
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
                </div>
              </div>
              {isFail && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-1">Complete if Fail:</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {[['int1','Int 1:'],['int2','Int 2:'],['exh1','Exh 1:'],['exh2','Exh 2:']].map(([field, label]) => (
                      <div key={field} className="flex items-center gap-1">
                        <span className="text-xs text-gray-500 w-10 flex-shrink-0">{label}</span>
                        <div className="flex gap-1">
                          <PFBtn value={cyl[field]} target="P" onChange={v => setCylField(cylIdx, field, v)} />
                          <PFBtn value={cyl[field]} target="F" onChange={v => setCylField(cylIdx, field, v)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
