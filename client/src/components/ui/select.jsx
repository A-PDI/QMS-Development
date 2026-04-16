import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

export const Select = forwardRef(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'w-full rounded-md border border-pdi-steel bg-white px-3 py-2 text-sm text-pdi-charcoal',
      'focus:outline-none focus:ring-2 focus:ring-pdi-navy focus:border-pdi-navy',
      'disabled:bg-pdi-frost disabled:cursor-not-allowed',
      className
    )}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'
