export default function SectionFireRingProtrusion({ section, data = {}, onChange, readOnly = false }) {
  const current = { spec: '', cylinders: Array(section.cylinder_count).fill(''), ...data }

  function set(field, value) { onChange({ ...current, [field]: value }) }
  function setCyl(i, value) {
    const cylinders = [...current.cylinders]
    cylinders[i] = value
    onChange({ ...current, cylinders })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 w-12">Spec:</label>
        {readOnly ? (
          <span className="font-mono text-sm">{current.spec || '—'}</span>
        ) : (
          <input
            type="text"
            className="border border-gray-200 rounded px-2 py-1 text-sm font-mono w-48 focus:outline-none focus:ring-1 focus:ring-pdi-navy"
            value={current.spec}
            onChange={e => set('spec', e.target.value)}
            placeholder="Specification..."
          />
        )}
      </div>
      <div className="overflow-x-auto">
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
                    <span className="font-mono text-sm">{current.cylinders[i] || '—'}</span>
                  ) : (
                    <input
                      type="text"
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
    </div>
  )
}
