import PFNToggle from './PFNToggle'

export default function SectionDimensional({ section, data = [], onChange, readOnly = false }) {
  function update(id, field, value) {
    const next = data.map(row => row.id === id ? { ...row, [field]: value } : row)
    onChange(next)
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-8">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-44">Measurement</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Location(s)</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-36">Spec / Limit</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-24">Actual 1</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-24">Actual 2</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-24">Actual 3</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-20">Status</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map(item => {
              const row = data.find(r => r.id === item.id) || { id: item.id, spec: item.spec || '', actual1: '', actual2: '', actual3: '', status: '' }
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">{item.id}</td>
                  <td className="px-3 py-2 font-medium text-gray-700 text-xs">{item.measurement}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{item.location}</td>
                  {/* Spec / Limit — editable */}
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="font-mono text-xs">{row.spec || '—'}</span>
                    ) : (
                      <input
                        type="text"
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                        value={row.spec || ''}
                        onChange={e => update(item.id, 'spec', e.target.value)}
                        placeholder="e.g. 85.00±0.02"
                      />
                    )}
                  </td>
                  {['actual1', 'actual2', 'actual3'].map(field => (
                    <td key={field} className="px-3 py-2">
                      {readOnly ? (
                        <span className="font-mono text-xs">{row[field] || '—'}</span>
                      ) : (
                        <input
                          type="text"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                          value={row[field]}
                          onChange={e => update(item.id, field, e.target.value)}
                          placeholder="0.000"
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <PFNToggle
                      value={row.status}
                      onChange={v => update(item.id, 'status', v)}
                      readOnly={readOnly}
                      options={['P', 'F']}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-2 px-3">
        All measurements at 20°C (68°F) · Dimensions in mm unless noted
      </p>
    </div>
  )
}
