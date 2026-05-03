import * as React from 'react'
import { cn } from './utils'

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn('shadcn-input', className)} {...props} />
))

Input.displayName = 'Input'

export { Input }
