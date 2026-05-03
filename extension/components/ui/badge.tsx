import * as React from 'react'
import { cn } from './utils'

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'soft' | 'outline' | 'accent'
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return <span className={cn('shadcn-badge', className)} data-variant={variant} {...props} />
}

export { Badge }
