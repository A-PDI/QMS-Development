import { STATUS_COLORS, STATUS_LABELS, dispositionColor, dispositionLabel } from '../lib/constants'

export default function StatusBadge({ status, disposition, className = '' }) {
  if (disposition) {
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${dispositionColor(disposition)} ${className}`}>
        {dispositionLabel(disposition)}
      </span>
    )
  }
  const color = STATUS_COLORS[status] || 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${color} ${className}`}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}
