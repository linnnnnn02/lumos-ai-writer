import * as React from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from '@/components/ui/icon'

export type WorkflowStepId = 'selection' | 'learn' | 'length' | 'plan' | 'rewrite' | 'reader'

export type WorkflowTitleMenuStep = {
  id: WorkflowStepId
  title: string
  caption: string
  icon: React.ComponentType<{ className?: string }>
}

type WorkflowTitleMenuProps = {
  activeStep: WorkflowStepId
  steps: WorkflowTitleMenuStep[]
  onStepChange: (step: WorkflowStepId) => void
}

export function WorkflowTitleMenu({
  activeStep,
  steps,
  onStepChange,
}: WorkflowTitleMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [menuPosition, setMenuPosition] = React.useState({ left: 0, top: 0 })
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const menuId = React.useId()

  const updateMenuPosition = React.useCallback(() => {
    const button = buttonRef.current
    if (!button) return

    const rect = button.getBoundingClientRect()
    const viewportGap = 12
    const menuWidth = Math.min(296, window.innerWidth - viewportGap * 2)
    const menuHeight = Math.min(360, window.innerHeight - viewportGap * 2)
    const left = Math.min(
      Math.max(rect.left, viewportGap),
      window.innerWidth - menuWidth - viewportGap,
    )
    const preferredTop = rect.bottom + 8
    const top = Math.min(
      Math.max(preferredTop, viewportGap),
      window.innerHeight - menuHeight - viewportGap,
    )

    setMenuPosition({ left, top })
  }, [])

  React.useEffect(() => {
    if (!isOpen) return

    updateMenuPosition()

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setIsOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [isOpen, updateMenuPosition])

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="打开流程菜单"
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-haspopup="menu"
        onClick={() => {
          updateMenuPosition()
          setIsOpen((current) => !current)
        }}
        className="inline-flex h-7 w-7 items-center justify-center bg-transparent text-[var(--soft-foreground)] outline-none transition hover:text-[var(--foreground)] focus-visible:rounded-[0.45rem] focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>

      {isOpen && typeof document !== 'undefined' ? createPortal(
        <div
          id={menuId}
          role="menu"
          ref={menuRef}
          style={{ left: menuPosition.left, top: menuPosition.top }}
          className="ui-popover-motion fixed z-[90] grid max-h-[calc(100vh-1.5rem)] w-[min(18.5rem,calc(100vw-1.5rem))] gap-1.5 overflow-y-auto rounded-[var(--ui-radius-panel)] border border-white/76 bg-white/90 p-1.5 shadow-[0_20px_56px_rgba(48,34,22,0.1)] backdrop-blur-xl"
        >
          {steps.map((item) => {
            const Icon = item.icon
            const isActive = item.id === activeStep

            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                aria-current={isActive ? 'step' : undefined}
                onClick={() => {
                  setIsOpen(false)
                  onStepChange(item.id)
                }}
                className={
                  isActive
                    ? 'flex items-center gap-3 rounded-[var(--ui-radius-item)] bg-[rgba(241,243,246,0.92)] px-3 py-2.5 text-left shadow-[0_10px_24px_rgba(15,23,42,0.04)] outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--ring)]'
                    : 'flex items-center gap-3 rounded-[var(--ui-radius-item)] px-3 py-2.5 text-left text-[var(--muted-foreground)] outline-none transition hover:bg-[rgba(241,243,246,0.84)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]'
                }
              >
                <span
                  className={
                    isActive
                      ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[var(--foreground)]'
                      : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--soft-foreground)]'
                  }
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 truncate text-sm font-semibold text-[var(--foreground)]">
                  {item.title}
                </span>
              </button>
            )
          })}
        </div>
        , document.body) : null}
    </div>
  )
}
