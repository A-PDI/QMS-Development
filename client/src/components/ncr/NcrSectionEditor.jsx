import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import NcrImageEditor from './NcrImageEditor'
import { NCR_LIMITS } from '../../lib/ncrReport'

export const SECTION_TITLE_LIST_ID = 'ncr-section-title-suggestions'

/** One user-created NCR section: title, free text and captioned photos. */
export default function NcrSectionEditor({
  section, index, count, onChange, onMove, onRemove, onRemoveImage, onError, disabled = false,
}) {
  const titleId = `ncr-section-${section.key}-title`
  const bodyId = `ncr-section-${section.key}-body`
  const iconButton = 'p-2 rounded-md border hover:bg-gray-50 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Section {index + 1}</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={disabled || index === 0}
            title="Move section up" aria-label="Move section up" className={`${iconButton} border-gray-200 text-gray-600`}>
            <ArrowUp size={14} />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={disabled || index === count - 1}
            title="Move section down" aria-label="Move section down" className={`${iconButton} border-gray-200 text-gray-600`}>
            <ArrowDown size={14} />
          </button>
          <button type="button" onClick={onRemove} disabled={disabled}
            title="Remove section" aria-label="Remove section" className={`${iconButton} border-red-200 text-red-500 hover:bg-red-50`}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div>
        <label htmlFor={titleId} className="block text-xs font-medium text-gray-500 mb-1">
          Section Title <span className="text-red-500">*</span>
        </label>
        <input
          id={titleId}
          type="text"
          list={SECTION_TITLE_LIST_ID}
          maxLength={NCR_LIMITS.titleLength}
          value={section.title}
          disabled={disabled}
          onChange={e => onChange({ ...section, title: e.target.value })}
          placeholder="e.g. Root Cause"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
        />
      </div>

      <div>
        <label htmlFor={bodyId} className="block text-xs font-medium text-gray-500 mb-1">Details</label>
        <textarea
          id={bodyId}
          rows={5}
          maxLength={NCR_LIMITS.bodyLength}
          value={section.body}
          disabled={disabled}
          onChange={e => onChange({ ...section, body: e.target.value })}
          placeholder="Enter the details for this section…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[100px]"
        />
      </div>

      <div>
        <div className="text-xs font-medium text-gray-500 mb-1">Photos</div>
        <NcrImageEditor
          images={section.images}
          onChange={images => onChange({ ...section, images })}
          onRemove={onRemoveImage}
          onError={onError}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
