import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, History, X } from '@/components/ui/icon'
import type { DraftVersionRecord } from '@/lib/draft-versions'

type DraftVersionHistoryProps = {
  currentVersionId: string
  isOpen: boolean
  versions: DraftVersionRecord[]
  onClose: () => void
  onRestore: (version: DraftVersionRecord) => void
}

const sourceLabels: Record<string, string> = {
  ai_generation: 'AI 生成',
  ai_rewrite: 'AI 改写',
  demo_generation: '演示生成',
  legacy_import: '基础版本',
  manual_edit: '手动编辑',
  restored: '恢复版本',
  smoke_test: '测试版本',
  working_draft: '工作草稿',
}

function formatVersionTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function DraftVersionHistory({
  currentVersionId,
  isOpen,
  versions,
  onClose,
  onRestore,
}: DraftVersionHistoryProps) {
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const orderedVersions = [...versions].sort((first, second) => second.version - first.version)
  const selectedVersion =
    orderedVersions.find((version) => version.id === selectedVersionId) ??
    orderedVersions.find((version) => version.id === currentVersionId) ??
    orderedVersions[0]

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    document.querySelector<HTMLButtonElement>('[data-close-draft-history]')?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const dialog = document.querySelector<HTMLElement>('[data-draft-version-dialog]')
      const focusableElements = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0)
      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      if (!firstElement || !lastElement) return

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="ui-dialog-backdrop fixed inset-0 z-[180] flex items-end justify-center bg-[rgba(28,21,16,0.2)] p-0 backdrop-blur-md sm:items-center sm:px-[var(--ui-page-gutter)] sm:py-[var(--ui-space-8)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="draft-version-history-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        data-draft-version-dialog
        className="ui-dialog-card flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-[var(--ui-radius-dialog)] bg-[rgba(250,251,252,0.98)] shadow-[var(--shadow-elevated)] sm:max-h-[min(800px,88dvh)] sm:rounded-[var(--ui-radius-dialog)]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[rgba(15,23,42,0.07)] px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[var(--accent-strong)]" aria-hidden="true" />
              <h2
                id="draft-version-history-title"
                className="text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]"
              >
                文案历史版本
              </h2>
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              每次生成和关键修改都会保留。恢复旧稿会新建一版，不会覆盖现有记录。
            </p>
          </div>
          <Button
            data-close-draft-history
            type="button"
            variant="ghost"
            size="icon"
            aria-label="关闭历史版本"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        {selectedVersion ? (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1">
            <nav
              className="max-h-[13rem] overflow-y-auto border-b border-[rgba(15,23,42,0.07)] bg-[rgba(241,245,249,0.58)] p-3 md:max-h-none md:border-b-0 md:border-r"
              aria-label="文案版本列表"
            >
              <div className="grid gap-[var(--ui-gap-related)]">
                {orderedVersions.map((version) => {
                  const isSelected = version.id === selectedVersion.id
                  const isCurrent = version.id === currentVersionId
                  return (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => setSelectedVersionId(version.id)}
                      className={
                        isSelected
                          ? 'rounded-[var(--ui-radius-control)] bg-white px-[var(--ui-space-3)] py-[var(--ui-space-2)] text-left shadow-[0_8px_24px_rgba(15,23,42,0.06)] ring-1 ring-[rgba(15,23,42,0.08)]'
                          : 'rounded-[var(--ui-radius-control)] px-[var(--ui-space-3)] py-[var(--ui-space-2)] text-left text-[var(--muted-foreground)] hover:bg-white/68 hover:text-[var(--foreground)]'
                      }
                      aria-current={isSelected ? 'true' : undefined}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[var(--foreground)]">
                          版本 {version.version}
                        </span>
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-[#17675b]">
                            <CheckCircle2 className="h-3 w-3" />
                            当前
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--soft-foreground)]">
                        <span>{sourceLabels[version.source] ?? '历史快照'}</span>
                        <time dateTime={version.updatedAt}>{formatVersionTime(version.updatedAt)}</time>
                      </span>
                    </button>
                  )
                })}
              </div>
            </nav>

            <div className="flex min-h-0 flex-col bg-white/72">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[rgba(15,23,42,0.06)] px-5 py-3 sm:px-7">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">版本 {selectedVersion.version}</Badge>
                  <span className="text-xs text-[var(--soft-foreground)]">
                    {sourceLabels[selectedVersion.source] ?? '历史快照'} · {formatVersionTime(selectedVersion.updatedAt)}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={selectedVersion.id === currentVersionId ? 'secondary' : 'default'}
                  disabled={selectedVersion.id === currentVersionId}
                  onClick={() => onRestore(selectedVersion)}
                >
                  {selectedVersion.id === currentVersionId ? '正在使用' : '恢复为新版本'}
                </Button>
              </div>

              <article className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-8">
                <div className="mx-auto max-w-[48rem]">
                  <h3 className="text-2xl font-semibold leading-tight tracking-[-0.04em] text-[var(--foreground)] sm:text-3xl">
                    {selectedVersion.title || '无标题'}
                  </h3>
                  <div className="mt-6 grid gap-4 text-[0.96rem] leading-8 text-[var(--muted-foreground)] sm:text-base">
                    {selectedVersion.body.map((paragraph, index) => (
                      <p key={`${selectedVersion.id}-${index}`}>{paragraph || '（空段落）'}</p>
                    ))}
                  </div>
                </div>
              </article>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[20rem] items-center justify-center px-6 text-center">
            <div>
              <History className="mx-auto h-6 w-6 text-[var(--soft-foreground)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">还没有历史版本</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">生成第一版文案后会自动保存在这里。</p>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
