import * as React from 'react'
import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react'
import {
  AiEditingIcon,
  ArrowUpRight01Icon,
  Delete02Icon,
  FolderIcon as HugeFolderIcon,
  LibraryIcon,
  MoreHorizontalIcon,
  WasteIcon,
} from '@hugeicons/core-free-icons'

type IconProps = Omit<HugeiconsIconProps, 'icon' | 'altIcon' | 'strokeWidth'>

const DEFAULT_ICON_SIZE = 16
const DEFAULT_ICON_STROKE = 1.75

function createIcon(icon: IconSvgElement, displayName: string) {
  const Component = React.forwardRef<SVGSVGElement, IconProps>(
    ({ size = DEFAULT_ICON_SIZE, color = 'currentColor', ...props }, ref) => (
      <HugeiconsIcon
        {...props}
        ref={ref}
        icon={icon}
        size={size}
        strokeWidth={DEFAULT_ICON_STROKE}
        color={color}
      />
    ),
  )
  Component.displayName = displayName
  return Component
}

export const AiEditing = createIcon(AiEditingIcon, 'AiEditing')
export const ArrowUpRight = createIcon(ArrowUpRight01Icon, 'ArrowUpRight')
export const Delete = createIcon(Delete02Icon, 'Delete')
export const Folder = createIcon(HugeFolderIcon, 'Folder')
export const Library = createIcon(LibraryIcon, 'Library')
export const MoreHorizontal = createIcon(MoreHorizontalIcon, 'MoreHorizontal')
export const Waste = createIcon(WasteIcon, 'Waste')
