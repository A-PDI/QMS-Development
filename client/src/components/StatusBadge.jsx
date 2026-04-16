import { STATUS_COLORS, STATUS_LABELS, DISPOSITION_COLORS } from '../lib/constants'

export default function StatusBadge({ status, disposition, className = '' }) {
  if (disposition) {
    const color = DISPOSITION_COLORS[disposition] || 'bg-gray-100 text-gray-700 border-gray-300'
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${color} ${className}`}>
        {disposition}
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
