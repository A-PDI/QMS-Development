import { cn } from '@/lib/utils'
import { X, CheckCircle, AlertCircle } from 'lucide-react'

export function ToastContainer({ toasts, dismiss }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-3 p-4 rounded-lg shadow-lg border text-sm',
            t.variant === 'destructive'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-white border-pdi-steel text-pdi-charcoal'
          )}
        >
          {t.variant === 'destructive'
            ? <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            : <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          }
          <div className="flex-1">
            {t.title && <p className="font-medium">{t.title}</p>}
            {t.description && <p className="text-xs mt-0.5 opacity-80">{t.description}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
