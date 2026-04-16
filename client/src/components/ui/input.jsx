import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

export const Input = forwardRef(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full rounded-md border border-pdi-steel bg-white px-3 py-2 text-sm text-pdi-charcoal placeholder:text-pdi-steel',
      'focus:outline-none focus:ring-2 focus:ring-pdi-navy focus:border-pdi-navy',
      'disabled:bg-pdi-frost disabled:cursor-not-allowed',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'
