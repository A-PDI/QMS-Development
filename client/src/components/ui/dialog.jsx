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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className={cn('relative bg-white rounded-lg border border-pdi-steel shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto', className)}>
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-pdi-steel">
            <h2 className="text-lg font-semibold text-pdi-navy">{title}</h2>
            <button onClick={onClose} className="p-1 rounded hover:bg-pdi-frost text-pdi-steel hover:text-pdi-charcoal">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}
