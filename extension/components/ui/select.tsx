import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { cn } from './utils'

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger className={cn('shadcn-select-trigger', className)} {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <span className="shadcn-select-icon" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  footer,
  position = 'popper',
  viewportClassName,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  footer?: React.ReactNode
  viewportClassName?: string
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn('shadcn-select-content', className)}
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport className={cn('shadcn-select-viewport', viewportClassName)}>
          {children}
        </SelectPrimitive.Viewport>
        {footer ? <div className="shadcn-select-footer">{footer}</div> : null}
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item className={cn('shadcn-select-item', className)} {...props}>
      <span className="shadcn-select-item-indicator">
        <SelectPrimitive.ItemIndicator>
          <span className="shadcn-select-check" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue }
