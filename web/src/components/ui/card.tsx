import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

type CardProps = React.HTMLAttributes<HTMLDivElement>

const cardInsetVariants = cva('', {
  variants: {
    density: {
      compact: 'p-[var(--ui-space-4)]',
      default: 'p-[var(--ui-space-6)]',
      spacious: 'p-[var(--ui-space-8)]',
    },
  },
  defaultVariants: {
    density: 'default',
  },
})

type CardSectionProps = CardProps & VariantProps<typeof cardInsetVariants>

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-[var(--shadow-muted)] transition-[background-color,border-color,box-shadow,transform] duration-300',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, density, ...props }: CardSectionProps) {
  return <div className={cn('flex flex-col gap-[var(--ui-gap-control)]', cardInsetVariants({ density }), className)} {...props} />
}

export function CardTitle({ className, ...props }: CardProps) {
  return (
    <div
      className={cn('text-[length:var(--ui-text-title)] font-semibold leading-[var(--ui-leading-tight)] tracking-[-0.03em] text-[var(--foreground)]', className)}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }: CardProps) {
  return <div className={cn('text-[length:var(--ui-text-control)] leading-6 text-[var(--muted-foreground)]', className)} {...props} />
}

export function CardContent({ className, density, ...props }: CardSectionProps) {
  return <div className={cn(cardInsetVariants({ density }), 'pt-0', className)} {...props} />
}

export function CardFooter({ className, density, ...props }: CardSectionProps) {
  return <div className={cn('flex items-center gap-[var(--ui-gap-group)]', cardInsetVariants({ density }), 'pt-0', className)} {...props} />
}
