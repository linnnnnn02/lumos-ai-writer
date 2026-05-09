import * as React from 'react'
import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react'
import {
  Delete02Icon,
  FolderIcon as HugeFolderIcon,
  MoreHorizontalIcon,
  WasteIcon,
} from '@hugeicons/core-free-icons'

type IconProps = Omit<HugeiconsIconProps, 'icon' | 'altIcon'>

const DEFAULT_ICON_SIZE = 16
const DEFAULT_ICON_STROKE = 1.75

function createIcon(icon: IconSvgElement, displayName: string) {
  const Component = React.forwardRef<SVGSVGElement, IconProps>(
    ({ size = DEFAULT_ICON_SIZE, strokeWidth = DEFAULT_ICON_STROKE, color = 'currentColor', ...props }, ref) => (
      <HugeiconsIcon
        ref={ref}
        icon={icon}
        size={size}
        strokeWidth={strokeWidth}
        color={color}
        {...props}
      />
    ),
  )
  Component.displayName = displayName
  return Component
}

export const Delete = createIcon(Delete02Icon, 'Delete')
export const Folder = createIcon(HugeFolderIcon, 'Folder')
export const MoreHorizontal = createIcon(MoreHorizontalIcon, 'MoreHorizontal')
export const Waste = createIcon(WasteIcon, 'Waste')
