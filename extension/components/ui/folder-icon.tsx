import * as React from 'react'
import { Folder } from './icon'
import { cn } from './utils'

type FolderIconProps = React.HTMLAttributes<HTMLSpanElement> & {
  size?: 'sm' | 'md'
}

const FolderIcon = React.forwardRef<HTMLSpanElement, FolderIconProps>(
  ({ className, size = 'md', ...props }, ref) => (
    <span
      ref={ref}
      className={cn('shadcn-folder-icon', className)}
      data-size={size}
      {...props}
    >
      <span className="shadcn-folder-icon-surface">
        <Folder aria-hidden="true" />
      </span>
    </span>
  ),
)

FolderIcon.displayName = 'FolderIcon'

export { FolderIcon }
