import { cn } from '@/lib/utils'

export function Separator({ className, orientation = 'horizontal', ...props }) {
  return (
    <div
      className={cn(
        'bg-pdi-steel',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
        className
      )}
      {...props}
    />
  )
}
