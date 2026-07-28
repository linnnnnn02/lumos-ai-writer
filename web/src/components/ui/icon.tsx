import * as React from 'react'
import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft02Icon,
  ArrowUp01Icon,
  Attachment02Icon,
  BubbleChatIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock03Icon,
  CursorPointerIcon,
  Delete02Icon,
  DragDropVerticalIcon,
  EyeIcon,
  File02Icon,
  FilterHorizontalIcon,
  FolderOpenIcon,
  GithubIcon,
  HighlighterIcon,
  Image02Icon,
  Layers02Icon,
  Loading03Icon,
  Login03Icon,
  Logout03Icon,
  MagicWand02Icon,
  Mail01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PinIcon,
  PlusSignIcon,
  Redo03Icon,
  Search01Icon,
  SentIcon,
  ShieldUserIcon,
  SparklesIcon,
  ThumbsUpIcon,
  Tick02Icon,
  Undo03Icon,
  UserCircleIcon,
  UserGroupIcon,
  WorkHistoryIcon,
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

export const AlertTriangle = createIcon(Alert02Icon, 'AlertTriangle')
export const ArrowLeft = createIcon(ArrowLeft02Icon, 'ArrowLeft')
export const Check = createIcon(Tick02Icon, 'Check')
export const CheckCircle2 = createIcon(CheckmarkCircle02Icon, 'CheckCircle2')
export const ChevronDown = createIcon(ArrowDown01Icon, 'ChevronDown')
export const ChevronUp = createIcon(ArrowUp01Icon, 'ChevronUp')
export const Clock3 = createIcon(Clock03Icon, 'Clock3')
export const Eye = createIcon(EyeIcon, 'Eye')
export const FileText = createIcon(File02Icon, 'FileText')
export const FolderOpen = createIcon(FolderOpenIcon, 'FolderOpen')
export const Funnel = createIcon(FilterHorizontalIcon, 'Funnel')
export const Github = createIcon(GithubIcon, 'Github')
export const GripVertical = createIcon(DragDropVerticalIcon, 'GripVertical')
export const Highlighter = createIcon(HighlighterIcon, 'Highlighter')
export const History = createIcon(WorkHistoryIcon, 'History')
export const Image = createIcon(Image02Icon, 'Image')
export const Layers3 = createIcon(Layers02Icon, 'Layers3')
export const Loader2 = createIcon(Loading03Icon, 'Loader2')
export const LogIn = createIcon(Login03Icon, 'LogIn')
export const LogOut = createIcon(Logout03Icon, 'LogOut')
export const Mail = createIcon(Mail01Icon, 'Mail')
export const MessageCircle = createIcon(BubbleChatIcon, 'MessageCircle')
export const MoreHorizontal = createIcon(MoreHorizontalIcon, 'MoreHorizontal')
export const MousePointer2 = createIcon(CursorPointerIcon, 'MousePointer2')
export const Paperclip = createIcon(Attachment02Icon, 'Paperclip')
export const PenLine = createIcon(PencilEdit02Icon, 'PenLine')
export const Pin = createIcon(PinIcon, 'Pin')
export const Plus = createIcon(PlusSignIcon, 'Plus')
export const Redo2 = createIcon(Redo03Icon, 'Redo2')
export const Search = createIcon(Search01Icon, 'Search')
export const Send = createIcon(SentIcon, 'Send')
export const SendHorizontal = createIcon(SentIcon, 'SendHorizontal')
export const ShieldCheck = createIcon(ShieldUserIcon, 'ShieldCheck')
export const Sparkles = createIcon(SparklesIcon, 'Sparkles')
export const ThumbsUp = createIcon(ThumbsUpIcon, 'ThumbsUp')
export const Trash2 = createIcon(Delete02Icon, 'Trash2')
export const Undo2 = createIcon(Undo03Icon, 'Undo2')
export const Users = createIcon(UserGroupIcon, 'Users')
export const UserCircle = createIcon(UserCircleIcon, 'UserCircle')
export const WandSparkles = createIcon(MagicWand02Icon, 'WandSparkles')
export const X = createIcon(Cancel01Icon, 'X')
