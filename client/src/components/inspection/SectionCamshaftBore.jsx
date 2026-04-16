export default function SectionCamshaftBore({ section, data = {}, onChange, readOnly = false }) {
  const current = { spec: '', bores: Array(section.bore_count).fill(''), ...data }

  function set(field, value) {
    onChange({ ...current, [field]: value })
  }

  function setBore(i, value) {
    const bores = [...current.bores]
    bores[i] = value
    onChange({ ...current, bores })
  }

  return (
    <div className="space-y-3">
      {/* Spec row — stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
        <label className="text-sm font-medium text-gray-700 sm:w-12">Spec:</label>
        {readOnly ? (
          <span className="font-mono text-sm">{current.spec || '—'}</span>
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
                    <span className="font-mono text-sm">{current.bores[i] || '—'}</span>
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

      {/* Mobile grid — 2 columns on narrow phones, 3 on larger */}
      <div className="md:hidden grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Array.from({ length: section.bore_count }, (_, i) => (
          <div key={i} className="border border-gray-200 rounded bg-white p-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Bore {i + 1}</label>
            {readOnly ? (
              <span className="font-mono text-sm">{current.bores[i] || '—'}</span>
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
    </div>
  )
}
