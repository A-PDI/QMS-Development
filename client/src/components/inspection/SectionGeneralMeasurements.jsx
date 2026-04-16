export default function SectionGeneralMeasurements({ section, data = [], onChange, readOnly = false }) {
  function update(id, field, value) {
    const next = data.map(row => row.id === id ? { ...row, [field]: value } : row)
    onChange(next)
  }

  const FIELD_LABELS = {
    specification: 'Specification',
    actual_value: 'Actual Value',
    notes: 'Notes',
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-8">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-44">Measurement</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-40">Specification</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-40">Actual Value</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Notes</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map(item => {
              const row = data.find(r => r.id === item.id) || { id: item.id, specification: '', actual_value: '', notes: '' }
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">{item.id}</td>
                  <td className="px-3 py-2 font-medium text-gray-700">{item.measurement}</td>
                  {['specification', 'actual_value', 'notes'].map(field => (
                    <td key={field} className="px-3 py-2">
                      {readOnly ? (
                        <span className="text-xs font-mono">{row[field] || '—'}</span>
                      ) : (
                        <input
                          type="text"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                          value={row[field]}
                          onChange={e => update(item.id, field, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {section.items.map(item => {
          const row = data.find(r => r.id === item.id) || { id: item.id, specification: '', actual_value: '', notes: '' }
          return (
            <div key={item.id} className="border border-gray-200 rounded-lg p-3 bg-white">
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-xs text-gray-400 font-mono">#{item.id}</span>
                <div className="font-medium text-sm text-gray-800 min-w-0 flex-1">{item.measurement}</div>
              </div>
              <div className="space-y-2">
                {['specification', 'actual_value', 'notes'].map(field => (
                  <div key={field}>
                    <label className="block text-xs text-gray-500 mb-1">{FIELD_LABELS[field]}</label>
                    {readOnly ? (
                      <span className="text-sm font-mono">{row[field] || '—'}</span>
                    ) : (
                      <input
                        type="text"
                        className="w-full text-sm border border-gray-200 rounded px-2 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                        value={row[field]}
                        onChange={e => update(item.id, field, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
