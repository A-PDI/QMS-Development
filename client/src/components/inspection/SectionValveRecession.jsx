const EMPTY_CYL = { int1: '', int2: '', exh1: '', exh2: '' }

export default function SectionValveRecession({ section, data = {}, onChange, readOnly = false }) {
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

  const Input = ({ value, onChange: onChg, placeholder = '' }) =>
    readOnly ? (
      <span className="font-mono text-xs">{value || '—'}</span>
    ) : (
      <input
        type="text"
        inputMode="decimal"
        className="w-full sm:w-16 text-sm sm:text-xs border border-gray-200 rounded px-2 py-1.5 sm:py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px] sm:min-h-0"
        value={value}
        onChange={e => onChg(e.target.value)}
        placeholder={placeholder}
      />
    )

  return (
    <div className="space-y-4">
      {/* Limits */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Intake Min:</span>
          <Input value={current.intake_min} onChange={v => setField('intake_min', v)} placeholder="0.00" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Max:</span>
          <Input value={current.intake_max} onChange={v => setField('intake_max', v)} placeholder="0.00" />
        </div>
        <div className="flex items-center gap-2 sm:ml-4">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Exhaust Min:</span>
          <Input value={current.exhaust_min} onChange={v => setField('exhaust_min', v)} placeholder="0.00" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 whitespace-nowrap text-xs sm:text-sm">Max:</span>
          <Input value={current.exhaust_max} onChange={v => setField('exhaust_max', v)} placeholder="0.00" />
        </div>
      </div>

      {/* Cylinder cards — 1 col on mobile, 2 on sm, 3 on md+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {current.cylinders.map((cyl, cylIdx) => (
          <div key={cylIdx} className="border border-gray-200 rounded p-3 bg-white">
            <div className="text-xs font-semibold text-gray-600 mb-2">Cylinder {cylIdx + 1}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              {[['int1','Int 1:'],['int2','Int 2:'],['exh1','Exh 1:'],['exh2','Exh 2:']].map(([field, label]) => (
                <div key={field} className="flex items-center gap-1 min-w-0">
                  <span className="text-gray-500 w-10 flex-shrink-0">{label}</span>
                  <Input value={cyl[field]} onChange={v => setCylField(cylIdx, field, v)} placeholder="0.00" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
