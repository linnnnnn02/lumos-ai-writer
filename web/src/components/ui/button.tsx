import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-[var(--ui-control-gap)] whitespace-nowrap rounded-[var(--ui-field-radius)] text-sm font-semibold outline-none transition duration-200 motion-safe:active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:transform-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_16px_34px_rgba(15,23,42,0.14)] hover:bg-[#27211d] hover:shadow-[0_22px_44px_rgba(15,23,42,0.18)]',
        secondary:
          'border border-white/80 bg-white/78 text-[var(--foreground)] shadow-[0_12px_28px_rgba(48,34,22,0.05)] hover:bg-white/92',
        outline:
          'border border-[var(--border)] bg-white/72 text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.04)] hover:bg-[var(--secondary)]',
        ghost: 'bg-transparent text-[var(--muted-foreground)] hover:bg-white/68 hover:text-[var(--foreground)]',
        subtle:
          'border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--foreground)] hover:bg-[#e2e8f0]',
      },
      size: {
        default: 'h-[var(--ui-control-md)] px-[var(--ui-control-px-lg)] py-0',
        sm: 'h-[var(--ui-control-sm)] px-[var(--ui-control-px-md)] py-0 text-xs',
        lg: 'h-[var(--ui-control-xl)] px-[var(--ui-control-px-xl)] py-0',
        icon: 'size-[var(--ui-control-md)] p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
