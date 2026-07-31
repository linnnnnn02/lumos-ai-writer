import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const inputVariants = cva(
  'flex w-full rounded-[var(--ui-field-radius)] border border-[var(--border)] bg-[var(--input)] py-0 leading-[var(--ui-leading-control)] text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.03)] outline-none transition placeholder:text-[var(--soft-foreground)] focus:border-[rgba(15,23,42,0.18)] focus:ring-4 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      controlSize: {
        sm: 'h-[var(--ui-control-height-sm)] px-[var(--ui-control-inset-x-sm)] text-[length:var(--ui-control-font-sm)]',
        default: 'h-[var(--ui-control-height-md)] px-[var(--ui-control-inset-x-md)] text-[length:var(--ui-control-font-md)]',
        lg: 'h-[var(--ui-control-height-lg)] px-[var(--ui-control-inset-x-lg)] text-[length:var(--ui-control-font-lg)]',
        xl: 'h-[var(--ui-control-height-xl)] px-[var(--ui-control-inset-x-xl)] text-[length:var(--ui-control-font-xl)]',
      },
    },
    defaultVariants: {
      controlSize: 'default',
    },
  },
)

type InputProps = React.InputHTMLAttributes<HTMLInputElement> &
  VariantProps<typeof inputVariants>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, controlSize, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(inputVariants({ controlSize }), className)}
      {...props}
    />
  ),
)

Input.displayName = 'Input'
