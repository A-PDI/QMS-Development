import { CheckCircle2 } from 'lucide-react'
import PFNToggle from './PFNToggle'
import ItemAttachment from './ItemAttachment'

const EMPTY_CYL = { overall: '', int1: '', int2: '', exh1: '', exh2: '', notes: '' }

const SUB_FIELDS = [
  ['int1', 'Int 1'],
  ['int2', 'Int 2'],
  ['exh1', 'Exh 1'],
  ['exh2', 'Exh 2'],
]

export default function SectionVacuumTest({
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
  const count = section.cylinder_count || 6
  const current = {
    cylinders: Array(count).fill(null).map(() => ({ ...EMPTY_CYL })),
    ...data,
  }
  if (!current.cylinders || current.cylinders.length !== count) {
    current.cylinders = Array(count).fill(null).map((_, i) => current.cylinders?.[i] || { ...EMPTY_CYL })
  }

  function setCylField(i, field, value) {
    const cylinders = current.cylinders.map((c, ci) => (ci === i ? { ...c, [field]: value } : c))
    onChange({ ...current, cylinders })
  }

  function setAllPass() {
    if (readOnly) return
    // Setting every cylinder to Pass clears any previously-entered Int/Exh
    // sub-results, since those only apply to a failing cylinder.
    const cylinders = current.cylinders.map(c => ({ ...c, overall: 'pass', int1: '', int2: '', exh1: '', exh2: '' }))
    onChange({ ...current, cylinders })
  }

  function setOverall(i, target) {
    if (readOnly) return
    const cyl = current.cylinders[i]
    const next = cyl.overall === target ? '' : target
    // When a cylinder is no longer failing, drop its sub-results so they don't
    // linger (and don't surface on the PDF report).
    if (next !== 'fail' && next !== 'F') {
      const cylinders = current.cylinders.map((c, ci) =>
        ci === i ? { ...c, overall: next, int1: '', int2: '', exh1: '', exh2: '' } : c
      )
      onChange({ ...current, cylinders })
    } else {
      setCylField(i, 'overall', next)
    }
  }

  const showImages = !!sectionKey && !!onUploadItem

  const overallBtn = (active, tone) => {
    const base = 'px-3 py-1.5 sm:px-2.5 sm:py-1 text-xs font-semibold rounded border min-h-[32px] sm:min-h-0 transition-colors'
    if (!active) return `${base} bg-white text-gray-400 border-gray-200 hover:border-gray-400`
    if (tone === 'pass') return `${base} bg-green-600 text-white border-green-600`
    if (tone === 'fail') return `${base} bg-red-600 text-white border-red-600`
    return `${base} bg-amber-500 text-white border-amber-500`
  }

  return (
    <div className="space-y-3">
      {/* All Pass shortcut */}
      {!readOnly && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={setAllPass}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-green-600 text-green-700 bg-green-50 hover:bg-green-100 transition-colors"
          >
            <CheckCircle2 size={15} strokeWidth={2.5} />
            All Pass
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {current.cylinders.map((cyl, cylIdx) => {
          const isFail = cyl.overall === 'fail' || cyl.overall === 'F'
          const isAccepted = cyl.overall === 'A'
          const needsNotes = isAccepted && !cyl.notes?.trim()
          return (
            <div key={cylIdx} className="border rounded p-3 border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-600">Cylinder {cylIdx + 1}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => setOverall(cylIdx, 'pass')}
                      className={`${overallBtn(cyl.overall === 'pass', 'pass')} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      Pass
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => setOverall(cylIdx, 'fail')}
                      className={`${overallBtn(isFail, 'fail')} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      Fail
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => setOverall(cylIdx, 'A')}
                      className={`${overallBtn(isAccepted, 'acc')} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      Acc
                    </button>
                  </div>
                  {showImages && (
                    <ItemAttachment
                      sectionKey={sectionKey}
                      itemId={cylIdx}
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

              {/* Int/Exh detail only appears when the cylinder fails */}
              {isFail && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs border-t border-gray-100 pt-2 mt-1">
                  {SUB_FIELDS.map(([f, label]) => (
                    <div key={f} className="flex items-center justify-between gap-1.5">
                      <span className="text-gray-500">{label}</span>
                      <PFNToggle
                        value={cyl[f]}
                        onChange={v => setCylField(cylIdx, f, v)}
                        readOnly={readOnly}
                        options={['P', 'F']}
                      />
                    </div>
                  ))}
                </div>
              )}

              {(isAccepted || needsNotes) && (
                <input
                  type="text"
                  value={cyl.notes || ''}
                  onChange={e => setCylField(cylIdx, 'notes', e.target.value)}
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
