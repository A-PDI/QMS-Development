import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'
import MeasurementInput from './MeasurementInput'

/**
 * Groove Specs (Cylinder Head, section C — Dimensional Inspection).
 *
 * Layout requirements:
 *  - The spec / limit for each measurement (Groove Diameter, Groove Depth,
 *    Wire Protrusion) lives in the section header rather than a table column.
 *  - Each measurement is entered as a small chart: row 1 = Cylinder 1..N
 *    headers, row 2 = a data input per cylinder.
 *
 * Data shape (per section):
 *   { measurements: [ { id, cylinders: string[], status: '', notes: '' } ] }
 */

const DEFAULT_CYL_COUNT = 6

function rowFor(data, item, count) {
  const existing = Array.isArray(data?.measurements)
    ? data.measurements.find(m => m.id === item.id)
    : null
  const cylinders = Array(count).fill('').map((_, i) => existing?.cylinders?.[i] ?? '')
  return {
    id: item.id,
    cylinders,
    status: existing?.status ?? '',
    notes: existing?.notes ?? '',
  }
}

export default function SectionGrooveSpecs({
  section,
  data = {},
  onChange,
  readOnly = false,
  sectionKey,
  attachments = [],
  onUploadItem,
  onDeleteItem,
  uploadingKey,
}) {
  const count = section.cylinder_count || DEFAULT_CYL_COUNT
  const items = section.items || []

  function setRow(itemId, patch) {
    const base = items.map(item => rowFor(data, item, count))
    const measurements = base.map(r => (r.id === itemId ? { ...r, ...patch } : r))
    onChange({ ...data, measurements })
  }

  function setCyl(itemId, cylIdx, value) {
    const row = rowFor(data, items.find(i => i.id === itemId), count)
    const cylinders = row.cylinders.map((c, i) => (i === cylIdx ? value : c))
    setRow(itemId, { cylinders })
  }

  const showImages = !!sectionKey && (!!onUploadItem || readOnly)

  return (
    <div className="space-y-4">
      {/* Spec reference header */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="text-xs font-semibold text-gray-500 mb-1.5">Specifications</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {items.map(item => (
            <div key={item.id} className="text-xs">
              <span className="font-semibold text-gray-700">{item.measurement}</span>
              {item.spec && (
                <span className="block text-gray-500 font-mono mt-0.5">{item.spec}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* One chart per measurement */}
      <div className="space-y-3">
        {items.map(item => {
          const row = rowFor(data, item, count)
          const isFail = row.status === 'F'
          const isAccepted = row.status === 'A'
          const needsNotes = isAccepted && !row.notes?.trim()
          return (
            <div key={item.id} className="border border-gray-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-700">{item.measurement}</div>
                  {item.spec && <div className="text-xs text-gray-400 font-mono">{item.spec}</div>}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <PFNToggle
                    value={row.status}
                    onChange={v => setRow(item.id, { status: v })}
                    readOnly={readOnly}
                    options={['P', 'F', 'A']}
                  />
                  {showImages && (
                    <ItemAttachment
                      sectionKey={sectionKey}
                      itemId={item.id}
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

              {/* Chart: row 1 = Cylinder headers, row 2 = inputs */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-center">
                  <thead>
                    <tr>
                      {row.cylinders.map((_, ci) => (
                        <th
                          key={ci}
                          className="border border-gray-200 bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600 whitespace-nowrap"
                        >
                          Cyl {ci + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {row.cylinders.map((val, ci) => (
                        <td key={ci} className="border border-gray-200 px-1.5 py-1">
                          <MeasurementInput
                            value={val}
                            onChange={v => setCyl(item.id, ci, v)}
                            readOnly={readOnly}
                            placeholder="0.000"
                            className="w-full text-center text-xs border border-gray-200 rounded px-1.5 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[34px]"
                            ariaLabel={`${item.measurement} Cylinder ${ci + 1}`}
                          />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              {(isAccepted || needsNotes) && (
                <input
                  type="text"
                  value={row.notes || ''}
                  onChange={e => setRow(item.id, { notes: e.target.value })}
                  readOnly={readOnly}
                  placeholder={needsNotes ? 'Description required…' : 'Notes…'}
                  className={`mt-2 w-full text-xs border rounded px-2 py-1.5 focus:outline-none min-h-[36px] ${needsNotes ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
