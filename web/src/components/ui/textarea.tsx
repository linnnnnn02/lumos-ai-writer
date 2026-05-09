import * as React from 'react'
import { cn } from '@/lib/utils'

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'flex min-h-24 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--input)] px-3.5 py-2.5 text-sm leading-6 text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.03)] outline-none transition placeholder:text-[var(--soft-foreground)] motion-safe:focus:-translate-y-px focus:border-[rgba(240,122,47,0.24)] focus:ring-4 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
