import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Home, MessageCircle } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type WorkflowStepId = 'intake' | 'references' | 'draft' | 'review' | 'confirm'

export type WorkflowStepItem = {
  id: WorkflowStepId
  label: string
  completed?: boolean
  disabled?: boolean
  disabledReason?: string
}

type WorkflowHeaderNavProps = {
  onBackToWorkspace: () => void
  onOpenSidebar: () => void
  showDivider?: boolean
}

export function WorkflowHeaderNav({
  onBackToWorkspace,
  onOpenSidebar,
  showDivider = true,
}: WorkflowHeaderNavProps) {
  return (
    <div className="flex shrink-0 items-center">
      <div className="flex items-center gap-[var(--ui-gap-related)]">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={onBackToWorkspace}
          aria-label="返回首页"
          className="shadow-none"
        >
          <Home className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenSidebar}
          aria-label="打开对话列表"
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
      </div>
      {showDivider ? (
        <span
          className="ml-[var(--ui-gap-control)] mr-[var(--ui-gap-block)] h-5 w-px shrink-0 bg-[var(--border)]"
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
}

type WorkflowStageNavProps = {
  activeStep: WorkflowStepId
  className?: string
  onStepChange: (step: WorkflowStepId) => void
  steps: WorkflowStepItem[]
}

export function WorkflowStageNav({
  activeStep,
  className,
  onStepChange,
  steps,
}: WorkflowStageNavProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [menuPosition, setMenuPosition] = React.useState({ left: 12, top: 12 })
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const menuId = React.useId()
  const activeStepIndex = Math.max(steps.findIndex((step) => step.id === activeStep), 0)

  const updateMenuPosition = React.useEffectEvent(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const menuWidth = Math.min(288, window.innerWidth - 24)
    const menuHeight = menuRef.current?.offsetHeight ?? 320
    const triggerRect = trigger.getBoundingClientRect()
    const left = Math.min(
      Math.max(triggerRect.left, 12),
      Math.max(window.innerWidth - menuWidth - 12, 12),
    )
    const spaceBelow = window.innerHeight - triggerRect.bottom - 12
    const top =
      spaceBelow >= menuHeight
        ? triggerRect.bottom + 8
        : Math.max(triggerRect.top - menuHeight - 8, 12)

    setMenuPosition({ left, top })
  })

  React.useEffect(() => {
    if (!isOpen) return

    updateMenuPosition()
    const focusFrame = window.requestAnimationFrame(() => {
      updateMenuPosition()
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[aria-current="step"]')
        ?.focus()
    })

    function closeOnOutsideClick(event: PointerEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setIsOpen(false)
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.querySelector('button')?.focus()
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [isOpen])

  return (
    <nav ref={triggerRef} aria-label="创作流程" className={cn('shrink-0', className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          'h-8 gap-1.5 rounded-full bg-white/48 px-2.5 text-xs font-medium text-[var(--muted-foreground)] shadow-none motion-safe:active:scale-100',
          'hover:bg-white/82 hover:text-[var(--foreground)]',
          isOpen && 'bg-white/92 text-[var(--foreground)] shadow-[0_8px_24px_rgba(48,34,22,0.07)]',
        )}
      >
        <span>流程</span>
        <span className="font-semibold tabular-nums text-[var(--foreground)]">
          {activeStepIndex + 1}/{steps.length}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform duration-200', isOpen && 'rotate-180')}
        />
      </Button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label="创作流程"
              style={{ left: menuPosition.left, top: menuPosition.top }}
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault()
                  setIsOpen(false)
                  triggerRef.current?.querySelector('button')?.focus()
                  return
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()

                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
                )
                const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
                const nextIndex =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : event.key === 'ArrowDown'
                        ? (currentIndex + 1) % items.length
                        : (currentIndex - 1 + items.length) % items.length

                items[nextIndex]?.focus()
              }}
              className="fixed z-[100] w-[min(18rem,calc(100vw-1.5rem))] rounded-[18px] border border-white/86 bg-[rgba(255,255,255,0.97)] p-2 shadow-[0_20px_56px_rgba(48,34,22,0.14)]"
            >
              <div className="grid gap-1">
                {steps.map((step, index) => {
                  const isActive = step.id === activeStep

                  return (
                    <button
                      key={step.id}
                      type="button"
                      role="menuitem"
                      aria-current={isActive ? 'step' : undefined}
                      aria-disabled={step.disabled || undefined}
                      onClick={() => {
                        if (step.disabled) return
                        setIsOpen(false)
                        if (!isActive) onStepChange(step.id)
                      }}
                      className={cn(
                        'flex min-h-12 w-full items-center gap-3 rounded-[13px] px-2.5 py-2 text-left outline-none transition duration-200',
                        'hover:bg-[rgba(15,23,42,0.04)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]',
                        isActive && 'bg-[#fff3e9] hover:bg-[#fff3e9]',
                        step.disabled && 'cursor-not-allowed opacity-[0.58] hover:bg-transparent',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-full bg-[rgba(15,23,42,0.055)] text-[11px] font-bold tabular-nums text-[var(--muted-foreground)]',
                          isActive && 'bg-[#f07a2f] text-white',
                          !isActive && step.completed && 'bg-[rgba(42,157,143,0.12)] text-[#17675b]',
                        )}
                      >
                        {!isActive && step.completed ? <Check className="h-3.5 w-3.5" /> : index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block text-sm font-semibold text-[var(--foreground)]',
                            step.disabled && 'text-[var(--muted-foreground)]',
                          )}
                        >
                          {step.label}
                          {isActive ? (
                            <span className="ml-2 text-xs font-medium text-[#c95d1d]">当前</span>
                          ) : null}
                        </span>
                        {step.disabled && step.disabledReason ? (
                          <span className="mt-0.5 block text-xs leading-4 text-[var(--soft-foreground)]">
                            {step.disabledReason}
                          </span>
                        ) : !isActive && step.completed ? (
                          <span className="sr-only">已完成</span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </nav>
  )
}
