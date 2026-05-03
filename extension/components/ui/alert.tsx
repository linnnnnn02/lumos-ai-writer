import * as React from 'react'
import { cn } from './utils'

type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: 'default' | 'success'
}

function Alert({ className, variant = 'default', ...props }: AlertProps) {
  return (
    <div
      className={cn('shadcn-alert', className)}
      data-variant={variant}
      role={props.role ?? 'status'}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('shadcn-alert-title', className)} {...props} />
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('shadcn-alert-description', className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription }
