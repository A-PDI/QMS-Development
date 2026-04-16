import { cn } from '@/lib/utils'

export function Button({ className, variant = 'primary', size = 'md', disabled, children, ...props }) {
  const base = 'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-pdi-navy focus:ring-offset-1 disabled:opacity-40 disabled:pointer-events-none'
  const variants = {
    primary: 'bg-pdi-navy text-white hover:bg-[#162240] active:scale-[0.98] shadow-sm',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-[0.98]',
    danger: 'bg-red-600 text-white hover:bg-red-700 active:scale-[0.98] shadow-sm',
    ghost: 'bg-transparent text-pdi-charcoal hover:bg-gray-100',
    outline: 'border border-gray-200 bg-white text-pdi-charcoal hover:bg-gray-50',
  }
  const sizes = {
    sm: 'px-3 py-2 text-sm min-h-[36px]',
    md: 'px-4 py-2 text-sm min-h-[40px]',
    lg: 'px-6 py-3 text-base min-h-[44px]',
    icon: 'p-2 min-h-[40px] min-w-[40px]',
  }
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} disabled={disabled} {...props}>
      {children}
    </button>
  )
}
