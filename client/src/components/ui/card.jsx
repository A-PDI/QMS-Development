import { cn } from '@/lib/utils'

export function Card({ className, children, ...props }) {
  return (
    <div className={cn('bg-white rounded-2xl border border-gray-100 shadow-sm', className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }) {
  return <div className={cn('px-6 py-4 border-b border-gray-100', className)} {...props}>{children}</div>
}

export function CardTitle({ className, children, ...props }) {
  return <h3 className={cn('text-sm font-semibold text-pdi-navy uppercase tracking-wide', className)} {...props}>{children}</h3>
}

export function CardContent({ className, children, ...props }) {
  return <div className={cn('px-6 py-4', className)} {...props}>{children}</div>
}
