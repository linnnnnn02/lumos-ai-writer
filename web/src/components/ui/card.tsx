import * as React from 'react'
import { cn } from '@/lib/utils'

type CardProps = React.HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-white/72 bg-[var(--card)] text-[var(--card-foreground)] shadow-[var(--shadow-card)] backdrop-blur-xl transition-[background-color,border-color,box-shadow,transform] duration-300 motion-safe:will-change-transform',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: CardProps) {
  return <div className={cn('flex flex-col gap-2 p-6', className)} {...props} />
}

export function CardTitle({ className, ...props }: CardProps) {
  return (
    <div
      className={cn('text-2xl font-semibold tracking-[-0.045em] text-[var(--foreground)]', className)}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }: CardProps) {
  return <div className={cn('text-sm leading-6 text-[var(--muted-foreground)]', className)} {...props} />
}

export function CardContent({ className, ...props }: CardProps) {
  return <div className={cn('p-6 pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: CardProps) {
  return <div className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />
}
