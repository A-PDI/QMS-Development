import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'
import { Trash2 } from 'lucide-react'
import { PFN_COLORS } from '../../lib/constants'
import { SpecInfo, EvaluationBadge, InvalidEntryMessage, readingTone, readingTitle } from './DimensionalSpec'
import { pointKey, evaluateMeasurements, allowedStatusOptions } from '../../lib/dimensional'

export default function SectionGeneralMeasurements({
  section,
  data = [],
  onChange,
  readOnly = false,
  sectionKey,
  attachments = [],
  onUploadItem,
  onDeleteItem,
  uploadingKey,
  onRemoveItem, // (itemId) — remove one measurement row from this inspection
  specIndex,      // configured specs by point key (automatic Pass/Fail)
  specSectionKey, // this section's key in the form (for spec lookup)
}) {
  function update(id, field, value) {
    const next = data.map(row => row.id === id ? { ...row, [field]: value } : row)
    onChange(next)
  }

  const showImages = !!sectionKey && !!onUploadItem
  // A measurement that doesn't apply to the part in front of the inspector can
  // be taken off the form.
  const showRemove = !readOnly && !!onRemoveItem

  // A configured numeric spec makes the row's Pass/Fail automatic.
  const autoSpecFor = (item) => {
    if (readOnly || !specIndex || !specSectionKey) return null
    const spec = specIndex[pointKey(specSectionKey, item.id)]
    return spec && spec.evaluable ? spec : null
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
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-28">Result</th>
              {showImages && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-20">Image</th>
              )}
              {showRemove && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-16">Tools</th>
              )}
            </tr>
          </thead>
          <tbody>
            {section.items.map(item => {
              const row = data.find(r => r.id === item.id) || { id: item.id, specification: '', actual_value: '', notes: '', result: '' }
              const autoSpec = autoSpecFor(item)
              const evaluation = autoSpec ? evaluateMeasurements(autoSpec, [row.actual_value]) : null
              const isAccepted = row.result === 'A'
              const isFail = row.result === 'F'
              const needsNotes = isAccepted && !row.notes?.trim()
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">{item.id}</td>
                  <td className="px-3 py-2 font-medium text-gray-700">{item.measurement}</td>
                  {['specification', 'actual_value'].map(field => (
                    <td key={field} className="px-3 py-2">
                      {readOnly ? (
                        <span className="text-xs font-mono">{row[field] || '\u2014'}</span>
                      ) : field === 'specification' && autoSpec ? (
                        <SpecInfo spec={autoSpec} />
                      ) : (
                        <input
                          type="text"
                          inputMode={field === 'actual_value' ? 'decimal' : undefined}
                          className={`w-full text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy ${field === 'actual_value' ? readingTone(autoSpec, row[field]) : ''}`}
                          value={row[field] || ''}
                          onChange={e => update(item.id, field, e.target.value)}
                          title={field === 'actual_value' ? readingTitle(autoSpec, row[field]) : undefined}
                          aria-label={`${item.measurement || `Item ${item.id}`} ${field === 'actual_value' ? 'actual value' : 'specification'}`}
                        />
                      )}
                      {field === 'actual_value' && <InvalidEntryMessage evaluation={evaluation} />}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="text-xs">{row.notes || '\u2014'}</span>
                    ) : (
                      <div>
                        <input
                          type="text"
                          className={`w-full text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pdi-navy ${
                            needsNotes ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                          }`}
                          value={row.notes || ''}
                          onChange={e => update(item.id, 'notes', e.target.value)}
                          placeholder={isAccepted ? 'Description required\u2026' : 'Notes\u2026'}
                        />
                        {needsNotes && <span className="text-xs text-amber-600 mt-0.5 block">Description required</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <PFNToggle
                      value={row.result}
                      onChange={v => update(item.id, 'result', v)}
                      readOnly={readOnly}
                      options={['P', 'F', 'A']}
                      allowed={evaluation ? allowedStatusOptions(evaluation) : undefined}
                      lockedTitle="set automatically from the measurement"
                    />
                    {evaluation && <div className="mt-1"><EvaluationBadge evaluation={evaluation} accepted={isAccepted} /></div>}
                  </td>
                  {showImages && (
                    <td className="px-3 py-2">
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
                    </td>
                  )}
                  {showRemove && (
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.id)}
                        title="Remove this measurement from the inspection"
                        aria-label={`Remove ${item.measurement || `item ${item.id}`}`}
                        className="p-1 text-red-400 hover:bg-red-50 rounded"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {section.items.map(item => {
          const row = data.find(r => r.id === item.id) || { id: item.id, specification: '', actual_value: '', result: '', notes: '' }
          const autoSpec = autoSpecFor(item)
          const evaluation = autoSpec ? evaluateMeasurements(autoSpec, [row.actual_value]) : null
          const allowed = evaluation ? allowedStatusOptions(evaluation) : null
          const isAccepted = row.result === 'A'
          const needsNotes = isAccepted && !row.notes?.trim()
          const isFail = row.result === 'F'
          return (
            <div key={item.id} className="border rounded-lg p-3 bg-white border-gray-200">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs font-medium text-gray-700">{item.measurement || `Item ${item.id}`}</div>
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
                {showRemove && (
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    title="Remove this measurement from the inspection"
                    aria-label={`Remove ${item.measurement || `item ${item.id}`}`}
                    className="p-1 text-red-400 hover:bg-red-50 rounded flex-shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Specification</label>
                  {readOnly ? (
                    <span className="text-xs font-mono">{row.specification || '—'}</span>
                  ) : autoSpec ? (
                    <SpecInfo spec={autoSpec} />
                  ) : (
                    <input type="text" value={row.specification || ''} onChange={e => update(item.id, 'specification', e.target.value)}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px]" />
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Actual Value</label>
                  {readOnly ? (
                    <span className="text-xs font-mono">{row.actual_value || '—'}</span>
                  ) : (
                    <input type="text" inputMode="decimal" value={row.actual_value || ''} onChange={e => update(item.id, 'actual_value', e.target.value)}
                      title={readingTitle(autoSpec, row.actual_value)}
                      aria-label={`${item.measurement || `Item ${item.id}`} actual value`}
                      className={`w-full text-xs border border-gray-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[36px] ${readingTone(autoSpec, row.actual_value)}`} />
                  )}
                  <InvalidEntryMessage evaluation={evaluation} />
                </div>
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  {['P','F','A'].map(v => {
                    const locked = !!allowed && !allowed.includes(v)
                    return (
                      <button key={v} type="button" disabled={locked}
                        onClick={() => !locked && update(item.id, 'result', row.result === v ? '' : v)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded border min-h-[32px] ${row.result === v ? PFN_COLORS[v] : locked ? 'bg-gray-50 text-gray-200 border-gray-100' : 'bg-white text-gray-400 border-gray-200'}`}>
                        {v === 'P' ? 'Pass' : v === 'F' ? 'Fail' : 'Acc'}
                      </button>
                    )
                  })}
                  <EvaluationBadge evaluation={evaluation} accepted={isAccepted} />
                </div>
              )}
              {(isAccepted || isFail) && (
                <input type="text" value={row.notes || ''} onChange={e => update(item.id, 'notes', e.target.value)}
                  placeholder={needsNotes ? 'Description required…' : 'Notes…'}
                  className={`w-full text-xs border rounded px-2 py-1.5 focus:outline-none min-h-[36px] ${needsNotes ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`} />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}