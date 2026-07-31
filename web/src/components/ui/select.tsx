import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, ChevronUp } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const selectTriggerVariants = cva(
  'flex w-full items-center justify-between rounded-[var(--ui-field-radius)] border border-[var(--border)] bg-[var(--input)] py-0 leading-[var(--ui-leading-control)] text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.03)] outline-none transition placeholder:text-[var(--soft-foreground)] focus:border-[rgba(15,23,42,0.18)] focus:ring-4 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-[rgba(15,23,42,0.18)] data-[state=open]:bg-white/92 data-[state=open]:shadow-[0_16px_36px_rgba(48,34,22,0.075)] [&>span]:line-clamp-1',
  {
    variants: {
      controlSize: {
        sm: 'h-[var(--ui-control-height-sm)] gap-[var(--ui-control-gap-sm)] px-[var(--ui-control-inset-x-sm)] text-[length:var(--ui-control-font-sm)]',
        default: 'h-[var(--ui-control-height-md)] gap-[var(--ui-control-gap-md)] px-[var(--ui-control-inset-x-md)] text-[length:var(--ui-control-font-md)]',
        lg: 'h-[var(--ui-control-height-lg)] gap-[var(--ui-control-gap-lg)] px-[var(--ui-control-inset-x-lg)] text-[length:var(--ui-control-font-lg)]',
        xl: 'h-[var(--ui-control-height-xl)] gap-[var(--ui-control-gap-xl)] px-[var(--ui-control-inset-x-xl)] text-[length:var(--ui-control-font-xl)]',
      },
    },
    defaultVariants: {
      controlSize: 'default',
    },
  },
)

type SelectTriggerProps = React.ComponentProps<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants>

function SelectTrigger({
  className,
  children,
  controlSize,
  ...props
}: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      className={cn(selectTriggerVariants({ controlSize }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--soft-foreground)]" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronUp className="h-4 w-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronDown className="h-4 w-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          'shadcn-popover-content relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-[var(--ui-radius-panel)] border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-[var(--shadow-soft)] backdrop-blur-xl',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-[var(--ui-space-1)]',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('px-[var(--ui-space-2)] py-[var(--ui-space-1)] text-[length:var(--ui-text-caption)] font-semibold text-[var(--soft-foreground)]', className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex min-h-[var(--ui-control-height-sm)] w-full cursor-default select-none items-center rounded-[var(--ui-radius-item)] py-[var(--ui-space-1)] pl-8 pr-[var(--ui-space-2)] text-[length:var(--ui-control-font-md)] text-[var(--foreground)] outline-none transition focus:bg-[var(--accent-soft)] focus:text-[var(--foreground)] data-[highlighted]:bg-[var(--accent-soft)] data-[highlighted]:text-[var(--foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-[var(--border)]', className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
