import * as React from 'react'
import { cn } from '@/lib/utils'

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'flex h-[var(--ui-control-md)] w-full rounded-[var(--ui-field-radius)] border border-[var(--border)] bg-[var(--input)] px-[var(--ui-field-px)] py-0 text-sm text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.03)] outline-none transition placeholder:text-[var(--soft-foreground)] focus:border-[rgba(15,23,42,0.18)] focus:ring-4 focus:ring-[var(--ring)]',
        className,
      )}
      {...props}
    />
  )
}
