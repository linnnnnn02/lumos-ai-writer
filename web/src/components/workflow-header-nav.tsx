import { Check, Home, MessageCircle } from '@/components/ui/icon'
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
  return (
    <nav aria-label="创作流程" className={cn('min-w-0', className)}>
      <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ol className="mx-auto flex min-w-max items-center gap-1 rounded-full bg-white/48 p-1 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.045)]">
          {steps.map((step, index) => {
            const isActive = step.id === activeStep

            return (
              <li key={step.id} className="flex items-center gap-1">
                {index > 0 ? (
                  <span
                    className="size-1 shrink-0 rounded-full bg-[rgba(15,23,42,0.14)]"
                    aria-hidden="true"
                  />
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-current={isActive ? 'step' : undefined}
                  aria-disabled={step.disabled || undefined}
                  tooltip={step.disabled ? step.disabledReason : undefined}
                  onClick={() => {
                    if (!step.disabled && !isActive) onStepChange(step.id)
                  }}
                  className={cn(
                    'h-8 gap-1.5 rounded-full px-2.5 text-xs shadow-none motion-safe:active:scale-100',
                    isActive &&
                      'bg-[var(--foreground)] text-white hover:bg-[var(--foreground)] hover:text-white',
                    !isActive && step.completed &&
                      'text-[var(--foreground)] hover:bg-white/82 hover:text-[var(--foreground)]',
                    !isActive && !step.completed && !step.disabled &&
                      'text-[var(--muted-foreground)] hover:bg-white/72 hover:text-[var(--foreground)]',
                    step.disabled &&
                      'cursor-not-allowed text-[var(--soft-foreground)] opacity-60 hover:bg-transparent hover:text-[var(--soft-foreground)]',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full bg-[rgba(15,23,42,0.06)] text-[10px] font-bold',
                      isActive && 'bg-white/16 text-white',
                      !isActive && step.completed && 'bg-[rgba(42,157,143,0.12)] text-[#17675b]',
                    )}
                  >
                    {!isActive && step.completed ? <Check className="h-3 w-3" /> : index + 1}
                  </span>
                  {step.label}
                  {step.disabled && step.disabledReason ? (
                    <span className="sr-only">，暂不可用：{step.disabledReason}</span>
                  ) : !isActive && step.completed ? (
                    <span className="sr-only">，已完成</span>
                  ) : null}
                </Button>
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}
