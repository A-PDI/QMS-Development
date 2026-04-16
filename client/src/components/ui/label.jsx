import { cn } from '@/lib/utils'

export function Label({ className, children, ...props }) {
  return (
    <label className={cn('block text-sm font-medium text-pdi-charcoal mb-1', className)} {...props}>
      {children}
    </label>
  )
}
