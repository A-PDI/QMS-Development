import PFNToggle from './PFNToggle'

export default function SectionVisual({ section, data = [], onChange, readOnly = false }) {
  function update(id, field, value) {
    const next = data.map(row => row.id === id ? { ...row, [field]: value } : row)
    onChange(next)
  }

  return (
    <div className="overflow-x-auto">
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
  )
}
