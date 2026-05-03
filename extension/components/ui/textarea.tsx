import * as React from 'react'
import { cn } from './utils'

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea className={cn('shadcn-textarea', className)} {...props} />
}
