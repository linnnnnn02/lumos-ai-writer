import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const textareaVariants = cva(
  'flex w-full rounded-[var(--ui-field-radius)] border border-[var(--border)] bg-[var(--input)] text-[length:var(--ui-text-control)] leading-[var(--ui-leading-body)] text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.03)] outline-none transition placeholder:text-[var(--soft-foreground)] focus:border-[rgba(15,23,42,0.18)] focus:ring-4 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      controlSize: {
        sm: 'min-h-[var(--ui-textarea-sm)] px-[var(--ui-control-inset-x-sm)] py-[var(--ui-space-2)]',
        default: 'min-h-[var(--ui-textarea-md)] px-[var(--ui-field-px)] py-[var(--ui-field-py)]',
        lg: 'min-h-[var(--ui-textarea-lg)] px-[var(--ui-control-inset-x-lg)] py-[var(--ui-space-4)] text-[length:var(--ui-text-body-lg)]',
      },
    },
    defaultVariants: {
      controlSize: 'default',
    },
  },
)

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> &
  VariantProps<typeof textareaVariants>

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, controlSize, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(textareaVariants({ controlSize }), className)}
        {...props}
      />
    )
  },
)

Textarea.displayName = 'Textarea'
