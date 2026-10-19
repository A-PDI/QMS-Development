import { ENVELOPE_STATUS } from '../../lib/esign'

export default function EnvelopeStatusBadge({ status, className = '' }) {
  const s = ENVELOPE_STATUS[status] || { label: status, cls: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${s.cls} ${className}`}>
      {s.label}
    </span>
  )
}
