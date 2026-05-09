import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-[var(--ui-field-radius)] font-semibold leading-[var(--ui-leading-control)] outline-none transition duration-200 motion-safe:active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:transform-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          '[background:var(--button-primary-bg)] text-[var(--primary-foreground)] [box-shadow:var(--button-primary-shadow)] [text-shadow:0_1px_1px_rgba(3,7,18,0.18)] hover:[background:var(--button-primary-bg-hover)] hover:[box-shadow:var(--button-primary-shadow-hover)] focus-visible:ring-[var(--primary-ring)]',
        secondary:
          'border border-white/80 bg-white/78 text-[var(--foreground)] shadow-[0_12px_28px_rgba(48,34,22,0.05)] hover:bg-white/92',
        outline:
          'border border-[var(--border)] bg-white/72 text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.04)] hover:bg-[var(--secondary)]',
        ghost: 'bg-transparent text-[var(--muted-foreground)] hover:bg-white/68 hover:text-[var(--foreground)]',
        subtle:
          'border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--foreground)] hover:bg-[#e2e8f0]',
      },
      size: {
        default:
          'h-[var(--ui-control-height-md)] gap-[var(--ui-control-gap-md)] px-[var(--ui-control-inset-x-lg)] py-0 text-[length:var(--ui-control-font-md)]',
        sm:
          'h-[var(--ui-control-height-sm)] gap-[var(--ui-control-gap-sm)] px-[var(--ui-control-inset-x-md)] py-0 text-[length:var(--ui-control-font-sm)]',
        lg:
          'h-[var(--ui-control-height-xl)] gap-[var(--ui-control-gap-xl)] px-[var(--ui-control-inset-x-xl)] py-0 text-[length:var(--ui-control-font-xl)]',
        icon: 'size-[var(--ui-control-height-md)] p-0 text-[length:var(--ui-control-font-md)]',
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
