import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold outline-none transition duration-200 focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'premium-gradient text-[var(--primary-foreground)] shadow-[0_16px_34px_rgba(255,149,80,0.24)] hover:shadow-[0_22px_44px_rgba(255,149,80,0.32)]',
        secondary:
          'border border-white/80 bg-white/78 text-[var(--foreground)] shadow-[0_12px_28px_rgba(48,34,22,0.05)] hover:bg-white/92',
        outline:
          'border border-[var(--border)] bg-white/72 text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.04)] hover:bg-[var(--secondary)]',
        ghost: 'bg-transparent text-[var(--muted-foreground)] hover:bg-white/68 hover:text-[var(--foreground)]',
        subtle:
          'border border-[rgba(240,122,47,0.14)] bg-[var(--accent-soft)] text-[var(--accent-strong)] hover:bg-[#ffe6d4]',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3.5 py-2 text-xs',
        lg: 'h-12 px-5 py-3',
        icon: 'h-10 w-10 p-0',
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
