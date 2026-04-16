import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Dialog({ open, onClose, title, children, className }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose?.() }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className={cn('relative bg-white rounded-t-2xl sm:rounded-lg border border-pdi-steel shadow-xl w-full max-w-lg sm:mx-4 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto', className)}>
        {title && (
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-pdi-steel sticky top-0 bg-white z-10">
            <h2 className="text-base sm:text-lg font-semibold text-pdi-navy">{title}</h2>
            <button onClick={onClose} className="p-2 rounded hover:bg-pdi-frost text-pdi-steel hover:text-pdi-charcoal min-h-[40px] min-w-[40px] flex items-center justify-center">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="px-4 sm:px-6 py-3 sm:py-4">{children}</div>
      </div>
    </div>
  )
}
