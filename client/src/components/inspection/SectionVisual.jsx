import PFNToggle from './PFNToggle'

export default function SectionVisual({ section, data = [], onChange, readOnly = false }) {
  function update(id, field, value) {
    const next = data.map(row => row.id === id ? { ...row, [field]: value } : row)
    onChange(next)
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-8">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-32">CTQ Area</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-40">Failure Mode</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Acceptance Criteria</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-36">Method</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-20">Result</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-36">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map(item => {
              const row = data.find(r => r.id === item.id) || { id: item.id, result: 'N', remarks: '' }
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">{item.id}</td>
                  <td className="px-3 py-2 font-medium text-gray-700 text-xs">{item.ctq_area}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{item.failure_mode}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs leading-relaxed">{item.criteria}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{item.method}</td>
                  <td className="px-3 py-2">
                    <PFNToggle
                      value={row.result}
                      onChange={v => update(item.id, 'result', v)}
                      readOnly={readOnly}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="text-gray-700 text-xs">{row.remarks || '—'}</span>
                    ) : (
                      <textarea
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                        rows={2}
                        value={row.remarks}
                        onChange={e => update(item.id, 'remarks', e.target.value)}
                        placeholder="Remarks..."
                      />
                    )}
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
          const row = data.find(r => r.id === item.id) || { id: item.id, result: 'N', remarks: '' }
          return (
            <div key={item.id} className={`border rounded-lg p-3 ${row.result === 'F' ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-xs text-gray-400 font-mono">#{item.id}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-pdi-navy">{item.ctq_area}</div>
                  <div className="text-sm font-medium text-gray-800">{item.failure_mode}</div>
                </div>
              </div>
              <div className="text-xs text-gray-600 leading-relaxed mb-2">
                <div><span className="text-gray-400">Criteria: </span>{item.criteria}</div>
                <div className="mt-0.5"><span className="text-gray-400">Method: </span>{item.method}</div>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-xs text-gray-500">Result:</span>
                <PFNToggle
                  value={row.result}
                  onChange={v => update(item.id, 'result', v)}
                  readOnly={readOnly}
                />
              </div>
              <div className="mt-2">
                {readOnly ? (
                  <div className="text-sm text-gray-700">{row.remarks || '—'}</div>
                ) : (
                  <textarea
                    className="w-full text-sm border border-gray-200 rounded px-2 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[60px]"
                    rows={2}
                    value={row.remarks}
                    onChange={e => update(item.id, 'remarks', e.target.value)}
                    placeholder="Remarks..."
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
