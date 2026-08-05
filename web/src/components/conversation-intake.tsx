import * as React from 'react'
import { FolderOpen, Send, Sparkles } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  WorkflowHeaderNav,
  WorkflowStageNav,
  type WorkflowStepId,
  type WorkflowStepItem,
} from '@/components/workflow-header-nav'

type ConversationIntakeProps = {
  folderName: string
  projectName: string
  value: string
  onBackToWorkspace: () => void
  onChange: (value: string) => void
  onOpenSidebar: () => void
  onSubmit: () => void
  onWorkflowStepChange: (step: WorkflowStepId) => void
  workflowSteps: WorkflowStepItem[]
}

const requestExamples = [
  '写一篇第一次体验某个产品后的真实感受',
  '把一次旅行经历整理成适合发布的小红书文案',
  '根据这周的素材，写一篇更容易引发讨论的内容',
]

export function ConversationIntake({
  folderName,
  projectName,
  value,
  onBackToWorkspace,
  onChange,
  onOpenSidebar,
  onSubmit,
  onWorkflowStepChange,
  workflowSteps,
}: ConversationIntakeProps) {
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const canSubmit = value.trim().length >= 4

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(148,163,184,0.08),transparent_34%),linear-gradient(180deg,#f6f8fb_0%,#fbfcfd_52%,#ffffff_100%)]">
      <header className="flex shrink-0 items-center justify-between gap-3 px-[var(--ui-page-gutter)] py-[var(--ui-space-4)]">
        <div className="flex min-w-0 items-center gap-2">
          <WorkflowHeaderNav
            onBackToWorkspace={onBackToWorkspace}
            onOpenSidebar={onOpenSidebar}
            showDivider={false}
          />
          <WorkflowStageNav
            activeStep="intake"
            onStepChange={onWorkflowStepChange}
            steps={workflowSteps}
          />
        </div>
        <div className="flex min-w-0 items-center justify-end">
          <span className="hidden max-w-[16rem] truncate text-xs font-medium text-[var(--soft-foreground)] sm:block">
            {projectName}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--ui-page-gutter)] pb-[var(--ui-space-8)] pt-[clamp(2rem,8vh,6.5rem)]">
        <div className="mx-auto w-full max-w-[52rem]">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--accent-strong)]">
            <Sparkles className="h-4 w-4" />
            <span>先从你的想法开始</span>
          </div>
          <h1 className="mt-4 text-[clamp(2rem,4vw,3.6rem)] font-semibold leading-[1.08] tracking-[-0.065em] text-[var(--foreground)]">
            这次想写什么？
          </h1>
          <p id="writing-request-help" className="mt-4 max-w-[42rem] text-base leading-7 text-[var(--muted-foreground)]">
            不用先整理成完整简报。告诉我主题、经历、目的或必须出现的信息，我会先理解需求，再按需推荐参考素材。
          </p>

          <div className="mt-[var(--ui-gap-region)] rounded-[var(--ui-radius-panel)] border border-[rgba(15,23,42,0.1)] bg-white/84 p-[var(--ui-space-2)] shadow-[0_20px_54px_rgba(48,34,22,0.075)] transition focus-within:border-[rgba(15,23,42,0.2)] focus-within:bg-white/94 focus-within:shadow-[0_24px_64px_rgba(48,34,22,0.1)]">
            <Textarea
              ref={inputRef}
              controlSize="lg"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
                  event.preventDefault()
                  onSubmit()
                }
              }}
              aria-describedby="writing-request-help writing-request-shortcut"
              aria-label="描述本次写作需求"
              className="min-h-[11.5rem] max-h-[40vh] resize-none border-0 bg-transparent px-4 py-4 text-lg leading-8 shadow-none placeholder:text-[var(--soft-foreground)] focus:border-transparent focus:ring-0 sm:min-h-[13.5rem] sm:px-5 sm:py-5"
              placeholder="例如：我上周第一次去深圳湾骑行，想写给和我一样怕路线太难的新手。希望保留海边日落和中途补给的真实细节，语气不要像攻略。"
            />
            <div className="flex flex-wrap items-center justify-between gap-[var(--ui-gap-group)] px-[var(--ui-space-3)] pb-[var(--ui-space-2)] pt-[var(--ui-space-2)] sm:px-[var(--ui-space-4)]">
              <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--soft-foreground)]">
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate">{projectName} · {folderName}</span>
              </div>
              <Button
                type="button"
                size="xl"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="w-full sm:w-auto sm:min-w-[9.5rem]"
              >
                匹配参考
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p id="writing-request-shortcut" className="mt-2 text-right text-xs text-[var(--soft-foreground)]">
            至少输入 4 个字 · ⌘/Ctrl + Enter 继续
          </p>

          <div className="mt-[var(--ui-gap-section)] border-t border-[rgba(15,23,42,0.07)] pt-[var(--ui-space-5)]">
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--soft-foreground)]">
              不知道怎么说，可以从这里开始
            </p>
            <div className="mt-[var(--ui-gap-group)] flex flex-wrap gap-[var(--ui-gap-control)]">
              {requestExamples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    onChange(example)
                    inputRef.current?.focus()
                  }}
                  className="rounded-full border border-[var(--border)] bg-white/52 px-[var(--ui-space-3)] py-[var(--ui-space-2)] text-left text-sm leading-5 text-[var(--muted-foreground)] outline-none transition hover:border-[rgba(15,23,42,0.14)] hover:bg-white/84 hover:text-[var(--foreground)] focus-visible:ring-4 focus-visible:ring-[var(--ring)] motion-safe:active:scale-[0.98]"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
