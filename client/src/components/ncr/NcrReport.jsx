import { useEffect, useMemo, useState } from 'react'
import AuthImage from '../AuthImage'
import { ncrImagePath } from '../../hooks/useNCRs'
import { figureNumbers } from '../../lib/ncrReport'
import { formatDate } from '../../lib/utils'
import { NCR_DISPOSITION_LABELS, NCR_SEVERITY_LABELS, NCR_STATUS_LABELS } from '../../lib/constants'

const STATUS_TEXT = { open: 'text-pdi-navy', in_progress: 'text-amber-600', closed: 'text-green-700' }
const SEVERITY_TEXT = { minor: 'text-yellow-700', major: 'text-amber-600', critical: 'text-red-600' }

function SectionTitle({ children }) {
  return (
    <h2 className="bg-[#EEF2F7] border-l-[3px] border-pdi-navy px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-pdi-navy break-after-avoid">
      {children}
    </h2>
  )
}

function Figure({ image, number, large, onSettled }) {
  return (
    <figure className="break-inside-avoid flex flex-col items-center">
      <div className={`w-full flex items-end justify-center ${large ? 'max-h-[26rem] print:max-h-[4.2in]' : 'h-56 sm:h-60 print:h-[2.8in]'}`}>
        <AuthImage
          src={ncrImagePath(image.id)}
          alt={image.caption || `Figure ${number}`}
          onSettled={onSettled}
          className={`max-w-full border border-gray-300 object-contain ${large ? 'max-h-[26rem] print:max-h-[4.2in] min-h-[8rem] min-w-[12rem]' : 'max-h-full min-h-[6rem] min-w-[8rem]'}`}
        />
      </div>
      <figcaption className="mt-1.5 text-center text-xs leading-snug">
        <span className="block font-bold text-pdi-navy">Figure {number}</span>
        {image.caption && <span className="block text-gray-600 whitespace-pre-wrap break-words">{image.caption}</span>}
      </figcaption>
    </figure>
  )
}

function FigureGrid({ images, numbers, onSettled }) {
  if (!images.length) return null
  const single = images.length === 1
  return (
    <div className={`grid gap-x-4 gap-y-5 ${single ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 print:grid-cols-2'}`}>
      {images.map(img => (
        <Figure key={img.id} image={img} number={numbers.get(img.id)} large={single} onSettled={() => onSettled(img.id)} />
      ))}
    </div>
  )
}

function BodyText({ text, empty }) {
  if (!String(text || '').trim()) {
    return empty ? <p className="text-sm italic text-gray-400">{empty}</p> : null
  }
  return <p className="text-sm text-gray-900 whitespace-pre-wrap break-words leading-relaxed">{text}</p>
}

/**
 * The finished NCR as a document — the same order and content as the PDF.
 * `onReadyChange(true)` fires once every photo has loaded (or failed), so the
 * page can print without blank image boxes.
 */
export default function NcrReport({ ncr, onReadyChange }) {
  const numbers = useMemo(() => figureNumbers(ncr), [ncr])
  const imageIds = useMemo(() => [...numbers.keys()], [numbers])
  // Ids of photos that finished loading. Only ever grows: a photo that is
  // already on screen does not report again after a refetch.
  const [settled, setSettled] = useState(() => new Set())

  const ready = imageIds.every(id => settled.has(id))
  useEffect(() => { if (onReadyChange) onReadyChange(ready) }, [ready, onReadyChange])

  function markSettled(id) {
    setSettled(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  const caRequired = !!Number(ncr.corrective_action_required)
  const summary = [
    ['Status', NCR_STATUS_LABELS[ncr.status] || ncr.status || '—', STATUS_TEXT[ncr.status] || 'text-gray-900'],
    ['Severity', NCR_SEVERITY_LABELS[ncr.severity] || ncr.severity || '—', SEVERITY_TEXT[ncr.severity] || 'text-gray-900'],
    ['Disposition', NCR_DISPOSITION_LABELS[ncr.ncr_disposition] || ncr.ncr_disposition || '—', 'text-gray-900'],
    ['Corrective Action',
      caRequired ? (ncr.corrective_action_due_date ? `Due ${formatDate(ncr.corrective_action_due_date)}` : 'Required') : 'Not required',
      caRequired ? 'text-red-600' : 'text-gray-600'],
  ]
  const details = [
    ['NCR Number', ncr.ncr_number],
    ['Date Opened', ncr.created_at ? formatDate(ncr.created_at) : ''],
    ['Part Number', ncr.part_number],
    ['Supplier', ncr.supplier],
    ['PO Number', ncr.po_number],
    ['Qty Affected', ncr.quantity_affected],
    ['Inspection', ncr.form_no],
    ['Opened By', ncr.created_by_name],
  ]
  if (ncr.closed_at) details.push(['Date Closed', formatDate(ncr.closed_at)])

  const photos = ncr.photos || []
  const sections = ncr.sections || []

  return (
    <article className="ncr-report bg-white rounded-xl border border-gray-200 p-3 sm:p-6 space-y-5 print:border-0 print:rounded-none print:p-0 print:space-y-4">
      {/* Banner */}
      <header className="bg-pdi-navy text-white px-4 py-3 flex items-center gap-4 break-inside-avoid">
        <img src="/pdi-logo.png" alt="PDI" className="h-8 w-auto object-contain flex-shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />
        <div className="flex-1 min-w-0 text-center">
          <div className="text-base sm:text-lg font-bold tracking-wide">NON-CONFORMANCE REPORT</div>
          <div className="text-[11px] uppercase tracking-wider text-[#A5B4C8] truncate">
            {[ncr.ncr_number, ncr.part_number ? `Part ${ncr.part_number}` : null].filter(Boolean).join('  ·  ')}
          </div>
        </div>
        <div className="w-8 hidden sm:block print:block" aria-hidden="true" />
      </header>

      {/* Status summary */}
      {/* 1px gaps over a grey background draw the cell borders at every width. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-px bg-gray-200 border border-gray-200 break-inside-avoid">
        {summary.map(([label, value, color]) => (
          <div key={label} className="bg-white px-3 py-2 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
            <div className={`text-sm font-bold truncate ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Details */}
      <section className="space-y-2">
        <SectionTitle>NCR Details</SectionTitle>
        <dl className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-px bg-gray-200 border border-gray-200 text-sm break-inside-avoid">
          {details.map(([label, value]) => (
            <div key={label} className="bg-white flex gap-3 px-3 py-1.5 min-w-0">
              <dt className="w-24 flex-shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-500 pt-0.5">{label}</dt>
              <dd className="min-w-0 break-words text-gray-900">{value === null || value === undefined || value === '' ? '—' : value}</dd>
            </div>
          ))}
          {details.length % 2 === 1 && <div className="bg-white hidden sm:block print:block" aria-hidden="true" />}
        </dl>
      </section>

      <section className="space-y-2">
        <SectionTitle>Description of Defect</SectionTitle>
        <div className="px-1"><BodyText text={ncr.description_of_defect} empty="No description entered." /></div>
      </section>

      {photos.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Photos</SectionTitle>
          <FigureGrid images={photos} numbers={numbers} onSettled={markSettled} />
        </section>
      )}

      {sections.map(section => (
        <section key={section.id} className="space-y-3">
          <SectionTitle>{section.title}</SectionTitle>
          <div className="px-1"><BodyText text={section.body} empty={section.images?.length ? '' : 'No details entered.'} /></div>
          <FigureGrid images={section.images || []} numbers={numbers} onSettled={markSettled} />
        </section>
      ))}
    </article>
  )
}
