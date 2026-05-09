import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-1 text-[length:var(--ui-text-caption)] font-semibold leading-[var(--ui-leading-control)] transition duration-200',
  {
    variants: {
      variant: {
        default: 'bg-[var(--secondary)] text-[var(--soft-foreground)]',
        accent:
          'border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--foreground)]',
        outline: 'border border-[var(--border)] bg-white/70 text-[var(--foreground)]',
        gradient: 'premium-gradient text-white shadow-[0_10px_22px_rgba(15,23,42,0.16)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}
