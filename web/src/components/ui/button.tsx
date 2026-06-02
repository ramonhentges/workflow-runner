import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        variant === 'default' && 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        variant === 'destructive' && 'bg-destructive text-white shadow-sm hover:bg-destructive/90',
        variant === 'outline' &&
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        variant === 'ghost' && 'hover:bg-accent hover:text-accent-foreground',
        size === 'default' && 'h-9 px-4 py-2',
        size === 'sm' && 'h-8 rounded-md px-3 text-xs',
        size === 'lg' && 'h-10 rounded-md px-8',
        size === 'icon' && 'h-9 w-9',
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
