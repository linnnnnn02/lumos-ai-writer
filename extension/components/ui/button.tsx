import * as React from 'react'
import { cn } from './utils'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'gradient' | 'outline' | 'ghost' | 'soft' | 'danger'
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn('shadcn-button', className)}
      data-size={size}
      data-variant={variant}
      {...props}
    />
  ),
)

Button.displayName = 'Button'

export { Button }
