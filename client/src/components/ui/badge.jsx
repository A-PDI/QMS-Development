import { cn } from '@/lib/utils'

export function Badge({ className, variant = 'default', children, ...props }) {
  const variants = {
    default: 'bg-pdi-frost text-pdi-charcoal border border-pdi-steel',
    navy: 'bg-pdi-navy text-white',
  }
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant], className)} {...props}>
      {children}
    </span>
  )
}
