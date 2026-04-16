import PFNToggle from './PFNToggle'

export default function SectionDimensional({ section, data = [], onChange, readOnly = false }) {
  function update(id, field, value) {
    const next = data.map(row => row.id === id ? { ...row, [field]: value } : row)
    onChange(next)
  }

  return (
    <div>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
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
                          inputMode="decimal"
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

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {section.items.map(item => {
          const row = data.find(r => r.id === item.id) || { id: item.id, spec: item.spec || '', actual1: '', actual2: '', actual3: '', status: '' }
          return (
            <div key={item.id} className={`border rounded-lg p-3 ${row.status === 'F' ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-xs text-gray-400 font-mono">#{item.id}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-gray-800">{item.measurement}</div>
                  <div className="text-xs text-gray-500 leading-relaxed">{item.location}</div>
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-xs text-gray-500 mb-1">Spec / Limit</label>
                {readOnly ? (
                  <span className="font-mono text-sm">{row.spec || '—'}</span>
                ) : (
                  <input
                    type="text"
                    className="w-full text-sm border border-gray-200 rounded px-2 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                    value={row.spec || ''}
                    onChange={e => update(item.id, 'spec', e.target.value)}
                    placeholder="e.g. 85.00±0.02"
                  />
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {['actual1', 'actual2', 'actual3'].map((field, i) => (
                  <div key={field}>
                    <label className="block text-xs text-gray-500 mb-1">Actual {i + 1}</label>
                    {readOnly ? (
                      <span className="font-mono text-sm">{row[field] || '—'}</span>
                    ) : (
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-full text-sm border border-gray-200 rounded px-2 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
                        value={row[field]}
                        onChange={e => update(item.id, field, e.target.value)}
                        placeholder="0.000"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Status:</span>
                <PFNToggle
                  value={row.status}
                  onChange={v => update(item.id, 'status', v)}
                  readOnly={readOnly}
                  options={['P', 'F']}
                />
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-gray-400 mt-2 px-1 sm:px-3">
        All measurements at 20°C (68°F) · Dimensions in mm unless noted
      </p>
    </div>
  )
}
