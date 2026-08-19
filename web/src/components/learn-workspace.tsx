import * as React from 'react'
import type { SavedFolderRecord, SavedNoteRecord, SavedSnippetRecord } from '@lumos-ai/shared'
import { createPortal } from 'react-dom'
import {
  CheckCircle2,
  Funnel,
  Home,
  MessageCircle,
  MoreHorizontal,
  Pin,
  SendHorizontal,
  Sparkles,
  X,
} from '@/components/ui/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  WorkflowHeaderNav,
  WorkflowStageNav,
  type WorkflowStepId,
  type WorkflowStepItem,
} from '@/components/workflow-header-nav'
import { cn } from '@/lib/utils'

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  stage: 'setup' | 'analysis' | 'followup'
  title?: string
  lines: string[]
  highlights?: Array<{
    title: string
    body: string
  }>
  featuredSnippets?: Array<{
    quote: string
    noteTitle: string
    noteUrl: string
    label: string
    description: string
    reason: string
  }>
  preferenceQuestion?: string
}

type FeaturedSnippet = NonNullable<ChatMessage['featuredSnippets']>[number]

type LearnWorkspaceProps = {
  activeConversationId: string
  analysisReady: boolean
  chatInput: string
  chatMessages: ChatMessage[]
  folders: SavedFolderRecord[]
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
  libraryStatus?: 'demo' | 'initializing' | 'loading' | 'ready' | 'error'
  libraryError?: string
  nonLearningNoteCount?: number
  analysisError?: string
  analysisWaitSeconds?: number
  isAnalyzing?: boolean
  isSidebarOpen: boolean
  isStreaming: boolean
  projectName: string
  conversations: Array<{ id: string; title: string; pinned?: boolean; finalizedAt?: string }>
  selectedItemIds: string[]
  writingRequest: string
  referenceRecommendations: Array<{ noteId: string; reason: string }>
  onBackToWorkspace: () => void
  onOpenLibrary: () => void
  onCloseSidebar: () => void
  onCreateConversation: () => void
  onConversationTitleChange: (conversationId: string, title: string) => void
  onToggleConversationPin: (conversationId: string) => void
  onSwitchConversation: (conversationId: string) => void
  onStartAnalysis: () => void
  onOpenSidebar: () => void
  onToggleItems: (itemIds: string[]) => void
  onSelectItems: (itemIds: string[]) => void
  onDeselectItems: (itemIds: string[]) => void
  onSendChat: () => void
  onChatInputChange: (value: string) => void
  onWorkflowStepChange: (step: WorkflowStepId) => void
  workflowSteps: WorkflowStepItem[]
}

type TagTab = {
  id: string
  label: string
  fullLabel: string
  colorValue?: string
}

type RenderTag = {
  id: string
  label: string
  colorValue?: string
}

type RenderItem = {
  id: string
  noteId: string
  title: string
  folderName: string
  itemIds: string[]
  selectedCount: number
  isFullySelected: boolean
  isPartiallySelected: boolean
  preview: React.ReactNode
  tags: RenderTag[]
}

const colorNameMap: Record<string, string> = {
  '#64748B': '灰色',
  '#DD6C32': '红色',
  '#E56B6F': '红色',
  '#E9C46A': '黄色',
  '#2A9D8F': '绿色',
  '#4D78F2': '蓝色',
  '#8B5CF6': '紫色',
}

function getCompactLabel(label: string) {
  const normalized = label.trim()
  return normalized.length > 2 ? normalized.slice(0, 2) : normalized
}

function getTagLabel(snippet: SavedSnippetRecord) {
  return snippet.colorTagName?.trim() || colorNameMap[snippet.colorValue || ''] || '未命名'
}

function getTagId(snippet: SavedSnippetRecord) {
  return snippet.colorValue || snippet.colorTagName?.trim() || 'untagged'
}

function getUniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function makeHighlightNode(text: string, color: string, dimmed: boolean) {
  const backgroundColor = withHexAlpha(color, dimmed ? '14' : '24')
  const borderColor = withHexAlpha(color, dimmed ? '3A' : '72')
  const underlineColor = withHexAlpha(color, 'B8')

  return (
    <mark
      className={cn(
        'rounded-[0.48rem] border px-1 py-0.5 text-[inherit] box-decoration-clone transition-opacity',
        dimmed ? 'opacity-75' : 'opacity-100',
      )}
      style={{
        backgroundColor,
        borderColor,
        boxShadow: dimmed ? undefined : `inset 0 -2px 0 ${underlineColor}`,
        WebkitBoxDecorationBreak: 'clone',
      }}
    >
      {text}
    </mark>
  )
}

function withHexAlpha(color: string, alpha: string) {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color
}

function makeDetailHighlightNode(text: string, color: string, isActive: boolean) {
  const backgroundColor = withHexAlpha(color, isActive ? '24' : '12')
  const borderColor = withHexAlpha(color, isActive ? '72' : '30')
  const underlineColor = withHexAlpha(color, 'B8')

  return (
    <mark
      className="rounded-[0.48rem] border px-1 py-0.5 text-[inherit] box-decoration-clone"
      style={{
        backgroundColor,
        borderColor,
        boxShadow: isActive ? `inset 0 -2px 0 ${underlineColor}` : undefined,
        WebkitBoxDecorationBreak: 'clone',
      }}
    >
      {text}
    </mark>
  )
}

function highlightMultipleSnippets(
  content: string,
  snippets: Array<SavedSnippetRecord & { dimmed: boolean }>,
) {
  if (snippets.length === 0) return content

  const sorted = [...snippets].sort(
    (a, b) => content.indexOf(a.selectedText) - content.indexOf(b.selectedText),
  )
  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const snippet of sorted) {
    const index = content.indexOf(snippet.selectedText, cursor)
    if (index === -1) continue
    if (index > cursor) parts.push(content.slice(cursor, index))
    parts.push(
      <React.Fragment key={`${snippet.id}-${index}`}>
        {makeHighlightNode(snippet.selectedText, snippet.colorValue || '#e8eef5', snippet.dimmed)}
      </React.Fragment>,
    )
    cursor = index + snippet.selectedText.length
  }

  if (cursor < content.length) parts.push(content.slice(cursor))
  return parts.length > 0 ? parts : content
}

function highlightDetailSnippets(
  content: string,
  snippets: SavedSnippetRecord[],
  activeText: string,
) {
  if (snippets.length === 0) return content

  const sorted = [...snippets].sort(
    (a, b) => content.indexOf(a.selectedText) - content.indexOf(b.selectedText),
  )
  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const snippet of sorted) {
    const index = content.indexOf(snippet.selectedText, cursor)
    if (index === -1) continue
    if (index > cursor) parts.push(content.slice(cursor, index))

    parts.push(
      <React.Fragment key={`detail-${snippet.id}-${index}`}>
        {makeDetailHighlightNode(
          snippet.selectedText,
          snippet.colorValue || '#ffdfc4',
          snippet.selectedText === activeText,
        )}
      </React.Fragment>,
    )
    cursor = index + snippet.selectedText.length
  }

  if (cursor < content.length) parts.push(content.slice(cursor))
  return parts.length > 0 ? parts : content
}

function NoteCover({ note }: { note?: SavedNoteRecord }) {
  const [imageFailed, setImageFailed] = React.useState(false)
  const imageUrl = note?.coverImageUrl

  React.useEffect(() => {
    const resetImageStateTimer = window.setTimeout(() => {
      setImageFailed(false)
    }, 0)

    return () => window.clearTimeout(resetImageStateTimer)
  }, [imageUrl])

  return (
    <div className="relative aspect-[3/4] overflow-hidden bg-[linear-gradient(135deg,#cdefff_0%,#e5f7ff_52%,#fff4e6_100%)]">
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt={note?.title || '笔记封面'}
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-8">
          <p className="rounded-full bg-[var(--surface-muted)] px-4 py-2 text-sm font-semibold text-[#6a7680]">
            未抓到封面
          </p>
        </div>
      )}
    </div>
  )
}

function NoteDetailDialog({
  activeSnippet,
  note,
  noteSnippets,
  onClose,
}: {
  activeSnippet: FeaturedSnippet
  note?: SavedNoteRecord
  noteSnippets: SavedSnippetRecord[]
  onClose: () => void
}) {
  const content = note?.contentText || activeSnippet.quote
  const title = note?.title || activeSnippet.noteTitle
  const highlightedSnippets =
    noteSnippets.length > 0
      ? noteSnippets.map((snippet) => ({
          ...snippet,
          dimmed: false,
        }))
      : [
          {
            id: `${activeSnippet.noteUrl}-${activeSnippet.quote}`,
            noteUrl: activeSnippet.noteUrl,
            noteTitle: activeSnippet.noteTitle,
            noteAuthorName: '',
            selectedText: activeSnippet.quote,
            reasonText: activeSnippet.reason,
            colorTagName: activeSnippet.label,
            colorValue: '#ffdfc4',
            dimmed: false,
          },
        ]

  React.useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="ui-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,22,17,0.24)] p-5 backdrop-blur-sm md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="笔记详情"
      onMouseDown={onClose}
    >
      <div
        className="ui-dialog-card grid max-h-[90vh] w-[calc(100vw-2.5rem)] overflow-hidden rounded-[var(--ui-radius-dialog)] border border-[rgba(15,23,42,0.08)] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.18)] md:w-[calc(100vw-4rem)] lg:w-[clamp(54rem,63vw,80rem)] lg:grid-cols-[49%_51%]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <NoteCover note={note} />
        <section className="relative min-h-0 overflow-y-auto px-6 py-7 md:px-10 md:py-10 xl:px-12">
          <button
            type="button"
            aria-label="关闭笔记详情"
            onClick={onClose}
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--soft-foreground)] transition hover:bg-white hover:text-[var(--foreground)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="pr-10">
            <p className="text-xs font-semibold tracking-[0.08em] text-[var(--accent-strong)]">
              笔记详情
            </p>
            <h2 className="mt-3 text-2xl font-semibold leading-snug tracking-[-0.04em] text-[var(--foreground)]">
              {title}
            </h2>
          </div>

          <article className="mt-6 whitespace-pre-wrap text-[length:var(--ui-text-body-lg)] leading-[var(--ui-leading-body)] text-[var(--foreground)]">
            {highlightDetailSnippets(content, highlightedSnippets, activeSnippet.quote)}
          </article>
        </section>
      </div>
    </div>
  )
}

function AssistantAvatar() {
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-[0.8rem] border border-white/80 bg-[linear-gradient(145deg,rgba(228,244,252,0.96),rgba(238,241,245,0.94))] text-[#586777] shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
      aria-hidden="true"
    >
      <Sparkles className="h-4 w-4" />
    </div>
  )
}

function AnalysisBlock({
  message,
  notes,
  snippets,
}: {
  message: ChatMessage
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
}) {
  const [commonConclusion] = message.lines
  const commonMoves = message.highlights ?? []
  const featuredSnippets = message.featuredSnippets ?? []
  const [activeSnippetDetail, setActiveSnippetDetail] = React.useState<
    (typeof featuredSnippets)[number] | null
  >(null)
  const activeNote = activeSnippetDetail
    ? notes.find((note) => note.sourceUrl === activeSnippetDetail.noteUrl)
    : undefined
  const activeNoteSnippets = activeSnippetDetail
    ? snippets.filter((snippet) => snippet.noteUrl === activeSnippetDetail.noteUrl)
    : []

  return (
    <>
      <article className="ui-chat-row mx-auto flex max-w-7xl gap-3">
        <AssistantAvatar />
        <div className="min-w-0 flex-1 rounded-[var(--ui-radius-panel)] border border-[var(--border)] bg-[var(--surface-muted)] px-5 py-4 shadow-none">
          <p className="max-w-5xl text-[length:var(--ui-text-body)] leading-7 text-[var(--foreground)]">
            {commonConclusion}
          </p>

        <div className="mt-3 grid gap-[var(--ui-gap-control)] rounded-[var(--ui-radius-card)] bg-[rgba(241,243,246,0.72)] px-[var(--ui-space-3)] py-[var(--ui-space-2)]">
          {commonMoves.map((move) => (
            <p key={`${move.title}-${move.body}`} className="text-sm leading-6 text-[var(--foreground)]">
              <span className="font-semibold text-[var(--accent-strong)]">{move.title}：</span>
              {move.body}
            </p>
          ))}
        </div>

        {featuredSnippets.length > 0 ? (
          <section className="mt-7">
            <p className="text-sm font-semibold text-[var(--foreground)]">重点句子</p>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {featuredSnippets.map((snippet) => (
                <button
                  key={`${snippet.noteTitle}-${snippet.quote}`}
                  type="button"
                  aria-label={`查看《${snippet.noteTitle}》的笔记详情`}
                  onClick={() => setActiveSnippetDetail(snippet)}
                  className={cn(
                    'group ui-hover-surface flex h-full flex-col rounded-[var(--ui-radius-card)] border px-4 py-3 text-left focus-visible:ring-4 focus-visible:ring-[var(--ring)]',
                    activeSnippetDetail?.quote === snippet.quote
                      ? 'border-[rgba(15,23,42,0.14)] bg-[var(--surface-raised)] shadow-[var(--shadow-muted)]'
                      : 'border-[rgba(31,22,17,0.07)] bg-[var(--surface-muted)]',
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="inline-flex rounded-full bg-[rgba(238,241,245,0.94)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                      {snippet.label}
                    </span>
                    <span className="text-xs font-semibold text-[var(--soft-foreground)] transition group-hover:text-[var(--accent-strong)]">
                      查看详情
                    </span>
                  </span>
                  <blockquote className="mt-2 text-[length:var(--ui-text-body)] font-semibold leading-6 text-[var(--foreground)]">
                    “{snippet.quote}”
                  </blockquote>
                  <p className="mt-2 text-[length:var(--ui-text-control)] leading-6 text-[var(--foreground)]">
                    <span className="font-semibold">写法：</span>
                    {snippet.description}
                  </p>
                  {snippet.reason ? (
                    <p className="mt-1 text-[length:var(--ui-text-control)] leading-6 text-[var(--muted-foreground)]">
                      <span className="font-semibold text-[var(--foreground)]">理由：</span>
                      {snippet.reason}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>

          </section>
        ) : null}

          {message.preferenceQuestion ? (
            <p className="mt-7 text-sm leading-7 text-[var(--foreground)]">
              {message.preferenceQuestion}
            </p>
          ) : null}
        </div>
      </article>

      {activeSnippetDetail ? (
        <NoteDetailDialog
          activeSnippet={activeSnippetDetail}
          note={activeNote}
          noteSnippets={activeNoteSnippets}
          onClose={() => setActiveSnippetDetail(null)}
        />
      ) : null}
    </>
  )
}

function AssistantBlock({
  message,
  notes,
  snippets,
}: {
  message: ChatMessage
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
}) {
  const isAnalysis = message.stage === 'analysis'
  const hasHighlights = Boolean(message.highlights?.length)
  const leadLine = hasHighlights ? message.lines[0] : null
  const trailingLines = hasHighlights ? message.lines.slice(1) : message.lines
  const displayTitle = message.title === '继续分析' ? '方向已记录' : message.title

  if (isAnalysis && hasHighlights) {
    return <AnalysisBlock message={message} notes={notes} snippets={snippets} />
  }

  return (
    <article className="ui-chat-row mx-auto flex max-w-5xl items-start gap-3">
      <AssistantAvatar />
      <div
        className={cn(
          'min-w-0',
          isAnalysis
            ? 'flex-1'
            : 'w-full max-w-[46rem]',
        )}
      >
        <div className="mb-2 flex min-h-5 items-center gap-2 px-1 text-xs">
          <span className="font-semibold text-[var(--foreground)]">Lumos</span>
          {displayTitle ? (
            <span className="text-[var(--soft-foreground)]">{displayTitle}</span>
          ) : null}
        </div>
        <div
          className={cn(
            'rounded-[var(--ui-radius-panel)] rounded-tl-[0.4rem] border px-5 py-4',
            isAnalysis
              ? 'border-[var(--border)] bg-[var(--surface-muted)] shadow-none'
              : 'border-white/90 bg-white/76 shadow-[0_12px_30px_rgba(15,23,42,0.045)]',
          )}
        >
        {leadLine ? (
          <p className="text-[length:var(--ui-text-body)] leading-8 text-[var(--foreground)]">
            {leadLine}
          </p>
        ) : (
          <div className="flex flex-col gap-[var(--ui-gap-control)]">
            {trailingLines.map((line, index) => (
              <p
                key={`${message.id}-${index}`}
                className="text-[length:var(--ui-text-body)] leading-8 text-[var(--foreground)]"
              >
                {line}
              </p>
            ))}
          </div>
        )}
        {hasHighlights ? (
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {message.highlights?.map((highlight) => (
              <section
                key={`${highlight.title}-${highlight.body}`}
                className="rounded-[var(--ui-radius-card)] border border-[rgba(15,23,42,0.08)] bg-[var(--surface-subtle)] p-4 shadow-none"
              >
                <div className="inline-flex rounded-full bg-white/86 px-3 py-1 text-xs font-semibold tracking-[0.04em] text-[var(--accent-strong)]">
                  {highlight.title}
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">{highlight.body}</p>
              </section>
            ))}
          </div>
        ) : null}
          {hasHighlights && trailingLines.length > 0 ? (
          <div className="mt-4 rounded-[var(--ui-radius-card)] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
            {trailingLines.map((line, index) => (
              <p key={`${message.id}-trailing-${index}`} className="text-sm leading-7 text-[var(--muted-foreground)]">
                {line}
              </p>
            ))}
          </div>
        ) : null}
        </div>
      </div>
    </article>
  )
}

function UserBlock({ message }: { message: ChatMessage }) {
  return (
    <article className="ui-chat-row mx-auto flex max-w-5xl justify-end pl-12">
      <div className="flex w-fit max-w-[86%] flex-col items-end md:max-w-[44rem]">
        <span className="mb-2 px-1 text-xs font-semibold text-[var(--soft-foreground)]">你</span>
        <div className="rounded-[var(--ui-radius-panel)] rounded-br-[0.4rem] bg-[#202428] px-5 py-3 text-white shadow-[0_12px_28px_rgba(15,23,42,0.12)]">
          {message.lines.map((line, index) => (
            <p key={`${message.id}-${index}`} className="text-[length:var(--ui-text-body)] leading-7">
              {line}
            </p>
          ))}
        </div>
      </div>
    </article>
  )
}

function TypingBlock({
  title,
  text,
  variant = 'dots',
}: {
  title?: string
  text?: string
  variant?: 'analysis' | 'dots'
}) {
  const progressLabels = ['读取参考文案', '提炼写作结构', '整理偏好判断']

  return (
    <article
      aria-live="polite"
      className="ui-chat-row mx-auto flex max-w-5xl items-start gap-3"
      role="status"
    >
      <AssistantAvatar />
      <div className="w-full max-w-[46rem]">
        <div className="mb-2 flex min-h-5 items-center gap-2 px-1 text-xs">
          <span className="font-semibold text-[var(--foreground)]">Lumos</span>
          <span className="text-[var(--soft-foreground)]">正在回复</span>
        </div>
        <div className="rounded-[var(--ui-radius-panel)] rounded-tl-[0.4rem] border border-white/90 bg-white/76 px-5 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.045)]">
        {title ? (
          <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">{title}</p>
        ) : null}
        {text ? (
          <p className="mb-3 text-[length:var(--ui-text-body)] leading-7 text-[var(--foreground)]">{text}</p>
        ) : null}
        {variant !== 'dots' ? (
          <div className="grid gap-3" aria-hidden="true">
            {progressLabels.map((label, index) => (
              <div key={label} className="grid gap-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--soft-foreground)]">
                  <span
                    className="draft-thinking-dot h-2 w-2 rounded-full bg-[var(--accent)]"
                    style={{ animationDelay: `${index * 0.12}s` }}
                  />
                  {label}
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-[rgba(226,232,240,0.78)]">
                  <div
                    className="draft-thinking-bar h-full rounded-full bg-[linear-gradient(90deg,rgba(103,199,255,0.62),rgba(239,182,208,0.6),rgba(240,122,47,0.52))]"
                    style={{ animationDelay: `${index * 0.16}s` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-1" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, index) => (
              <span
                key={index}
                className="draft-thinking-dot h-2.5 w-2.5 rounded-full bg-[var(--accent)] opacity-60"
                style={{ animationDelay: `${index * 0.15}s` }}
              />
            ))}
          </div>
        )}
        </div>
      </div>
    </article>
  )
}

export function LearnWorkspace({
  activeConversationId,
  analysisReady,
  chatInput,
  chatMessages,
  folders,
  notes,
  snippets,
  libraryStatus = 'demo',
  libraryError = '',
  nonLearningNoteCount = 0,
  analysisError = '',
  analysisWaitSeconds = 0,
  isAnalyzing = false,
  isSidebarOpen,
  isStreaming,
  projectName,
  conversations,
  selectedItemIds,
  writingRequest,
  referenceRecommendations,
  onBackToWorkspace,
  onOpenLibrary,
  onCloseSidebar,
  onCreateConversation,
  onConversationTitleChange,
  onToggleConversationPin,
  onSwitchConversation,
  onStartAnalysis,
  onOpenSidebar,
  onToggleItems,
  onSelectItems,
  onDeselectItems,
  onSendChat,
  onChatInputChange,
  onWorkflowStepChange,
  workflowSteps,
}: LearnWorkspaceProps) {
  const [activeTab, setActiveTab] = React.useState('all')
  const [folderFilterId, setFolderFilterId] = React.useState('all')
  const [isFilterOpen, setIsFilterOpen] = React.useState(false)
  const [showAllReferences, setShowAllReferences] = React.useState(false)
  const [openConversationMenuId, setOpenConversationMenuId] = React.useState<string | null>(null)
  const [conversationMenuPosition, setConversationMenuPosition] = React.useState({
    left: 0,
    top: 0,
  })
  const [renamingConversationId, setRenamingConversationId] = React.useState<string | null>(null)
  const [draftConversationTitle, setDraftConversationTitle] = React.useState('')
  const conversationMenuButtonRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const scrollViewportRef = React.useRef<HTMLDivElement | null>(null)
  const scrollAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const chatInputRef = React.useRef<HTMLTextAreaElement | null>(null)

  const updateConversationMenuPosition = React.useCallback((conversationId: string) => {
    const button = conversationMenuButtonRefs.current.get(conversationId)
    if (!button) return

    const rect = button.getBoundingClientRect()
    const viewportGap = 12
    const menuWidth = 144
    const menuHeight = 112
    const left = Math.min(
      Math.max(rect.right - 32, viewportGap),
      window.innerWidth - menuWidth - viewportGap,
    )
    const top = Math.min(
      Math.max(rect.top - 8, viewportGap),
      window.innerHeight - menuHeight - viewportGap,
    )

    setConversationMenuPosition({ left, top })
  }, [])

  React.useEffect(() => {
    const latestMessage = chatMessages[chatMessages.length - 1]
    if (analysisReady && latestMessage?.stage === 'analysis') {
      scrollViewportRef.current?.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
      return
    }

    scrollViewportRef.current?.scrollTo({
      top: scrollViewportRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [analysisReady, chatMessages, isStreaming])

  React.useEffect(() => {
    if (analysisReady || chatMessages.length > 0) return

    scrollViewportRef.current?.scrollTo({
      top: 0,
      behavior: 'auto',
    })
  }, [activeConversationId, analysisReady, chatMessages.length])

  React.useEffect(() => {
    const input = chatInputRef.current
    if (!input) return

    input.style.height = 'auto'
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 52), 144)}px`
  }, [chatInput])

  React.useEffect(() => {
    if (!openConversationMenuId) return
    const activeMenuId = openConversationMenuId
    updateConversationMenuPosition(activeMenuId)

    function updateOpenMenuPosition() {
      updateConversationMenuPosition(activeMenuId)
    }

    function closeMenuOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Element && target.closest('[data-conversation-menu]')) return
      setOpenConversationMenuId(null)
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenConversationMenuId(null)
      }
    }

    document.addEventListener('pointerdown', closeMenuOnOutsidePointerDown)
    document.addEventListener('keydown', closeMenuOnEscape)
    window.addEventListener('resize', updateOpenMenuPosition)
    window.addEventListener('scroll', updateOpenMenuPosition, true)

    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsidePointerDown)
      document.removeEventListener('keydown', closeMenuOnEscape)
      window.removeEventListener('resize', updateOpenMenuPosition)
      window.removeEventListener('scroll', updateOpenMenuPosition, true)
    }
  }, [openConversationMenuId, updateConversationMenuPosition])

  function startConversationRename(conversation: { id: string; title: string }) {
    setDraftConversationTitle(conversation.title)
    setRenamingConversationId(conversation.id)
    setOpenConversationMenuId(null)
  }

  function commitConversationRename(conversation: { id: string; title: string }) {
    const nextTitle = draftConversationTitle.replace(/\s+/g, ' ').trim()
    if (nextTitle && nextTitle !== conversation.title) {
      onConversationTitleChange(conversation.id, nextTitle)
    }
    setRenamingConversationId(null)
    setDraftConversationTitle('')
  }

  function cancelConversationRename() {
    setRenamingConversationId(null)
    setDraftConversationTitle('')
  }

  const tabs = React.useMemo<TagTab[]>(() => {
    const tagMap = new Map<string, TagTab>()

    snippets.forEach((snippet) => {
      const id = getTagId(snippet)
      if (tagMap.has(id)) return

      const fullLabel = getTagLabel(snippet)
      tagMap.set(id, {
        id,
        label: getCompactLabel(fullLabel),
        fullLabel,
        colorValue: snippet.colorValue,
      })
    })

    const list: TagTab[] = [{ id: 'all', label: '全部', fullLabel: '全部' }]
    list.push(...Array.from(tagMap.values()))
    return list
  }, [snippets])
  const visibleTabs = tabs.slice(0, 4)
  const overflowTabs = tabs.slice(4)
  const activeOverflowTab = overflowTabs.find((tab) => tab.id === activeTab)

  const selectedSnippetIdSet = React.useMemo(
    () =>
      new Set(
        selectedItemIds
          .filter((id) => id.startsWith('snippet:'))
          .map((id) => id.replace('snippet:', '')),
      ),
    [selectedItemIds],
  )

  const selectedItemIdSet = React.useMemo(() => new Set(selectedItemIds), [selectedItemIds])

  const recommendationByNoteId = React.useMemo(
    () => new Map(referenceRecommendations.map((item) => [item.noteId, item.reason])),
    [referenceRecommendations],
  )

  const notesByUrl = React.useMemo(
    () => new Map(notes.map((note) => [note.sourceUrl, note])),
    [notes],
  )

  const snippetsByNoteUrl = React.useMemo(() => {
    const map = new Map<string, SavedSnippetRecord[]>()

    snippets.forEach((snippet) => {
      const relatedNote = notesByUrl.get(snippet.noteUrl)
      if (!relatedNote) return

      const list = map.get(snippet.noteUrl) ?? []
      list.push(snippet)
      map.set(snippet.noteUrl, list)
    })

    return map
  }, [notesByUrl, snippets])

  const selectableItemIdsByNoteId = React.useMemo(
    () =>
      new Map(
        notes.map((note) => {
          const noteSnippets = snippetsByNoteUrl.get(note.sourceUrl) ?? []
          return [
            note.id,
            noteSnippets.length > 0
              ? noteSnippets.map((snippet) => `snippet:${snippet.id}`)
              : [`note:${note.id}`],
          ] as const
        }),
      ),
    [notes, snippetsByNoteUrl],
  )

  const selectedReferenceNotes = React.useMemo(
    () =>
      notes.flatMap((note) => {
        const itemIds = selectableItemIdsByNoteId.get(note.id) ?? []
        return itemIds.some((itemId) => selectedItemIdSet.has(itemId))
          ? [{ itemIds, note }]
          : []
      }),
    [notes, selectableItemIdsByNoteId, selectedItemIdSet],
  )
  const selectedReferenceNoteIdSet = React.useMemo(
    () => new Set(selectedReferenceNotes.map(({ note }) => note.id)),
    [selectedReferenceNotes],
  )

  const activeFolder = React.useMemo(
    () => folders.find((folder) => folder.id === folderFilterId),
    [folderFilterId, folders],
  )

  const isFolderFiltered = folderFilterId !== 'all'

  const activeTabItems = React.useMemo<RenderItem[]>(() => {
    return notes
      .filter((note) => folderFilterId === 'all' || note.folderId === folderFilterId)
      .map((note) => {
        const noteSnippets = snippetsByNoteUrl.get(note.sourceUrl) ?? []
        const visibleSnippets =
          activeTab === 'all'
            ? noteSnippets
            : noteSnippets.filter((snippet) => getTagId(snippet) === activeTab)

        if (activeTab !== 'all' && visibleSnippets.length === 0) return null

        const itemIds =
          visibleSnippets.length > 0
            ? visibleSnippets.map((snippet) => `snippet:${snippet.id}`)
            : [`note:${note.id}`]
        const selectedCount = itemIds.filter((itemId) => selectedItemIdSet.has(itemId)).length
        const isFullySelected = itemIds.length > 0 && selectedCount === itemIds.length
        const isPartiallySelected = selectedCount > 0 && selectedCount < itemIds.length
        const tags = visibleSnippets.map((snippet) => ({
          id: getTagId(snippet),
          label: getTagLabel(snippet),
          colorValue: snippet.colorValue,
        }))
        const uniqueTags = getUniqueValues(tags.map((tag) => tag.id))
          .map((tagId) => tags.find((tag) => tag.id === tagId))
          .filter(Boolean) as RenderTag[]

        return {
          id: `${activeTab}:${note.id}`,
          noteId: note.id,
          title: note.title,
          folderName: note.folderName,
          itemIds,
          selectedCount,
          isFullySelected,
          isPartiallySelected,
          tags: uniqueTags,
          preview: highlightMultipleSnippets(
            note.contentText,
            visibleSnippets.map((snippet) => ({
              ...snippet,
              dimmed: !selectedSnippetIdSet.has(snippet.id),
            })),
          ),
        }
      })
      .filter(Boolean) as RenderItem[]
  }, [activeTab, folderFilterId, notes, selectedItemIdSet, selectedSnippetIdSet, snippetsByNoteUrl])

  const sortedActiveTabItems = React.useMemo(
    () =>
      [...activeTabItems].sort(
        (first, second) =>
          Number(recommendationByNoteId.has(second.noteId)) -
          Number(recommendationByNoteId.has(first.noteId)),
      ),
    [activeTabItems, recommendationByNoteId],
  )
  const visibleReferenceItems = React.useMemo(
    () =>
      showAllReferences
        ? sortedActiveTabItems
        : sortedActiveTabItems.filter(
            (item) =>
              recommendationByNoteId.has(item.noteId) ||
              selectedReferenceNoteIdSet.has(item.noteId),
          ),
    [recommendationByNoteId, selectedReferenceNoteIdSet, showAllReferences, sortedActiveTabItems],
  )

  const activeResultItemIds = React.useMemo(
    () => getUniqueValues(visibleReferenceItems.flatMap((item) => item.itemIds)),
    [visibleReferenceItems],
  )

  const activeResultSelectedCount = React.useMemo(
    () => activeResultItemIds.filter((itemId) => selectedItemIdSet.has(itemId)).length,
    [activeResultItemIds, selectedItemIdSet],
  )
  const isActiveResultFullySelected =
    activeResultItemIds.length > 0 && activeResultSelectedCount === activeResultItemIds.length

  const emptyLibraryMessage = React.useMemo(() => {
    if (libraryStatus === 'initializing' || libraryStatus === 'loading') {
      return '正在读取文案库。'
    }

    if (libraryStatus === 'error') {
      return libraryError ? `文案库读取失败：${libraryError}` : '文案库读取失败。'
    }

    if (libraryStatus === 'ready' && notes.length === 0) {
      return '文案库暂无文案。'
    }

    return '当前筛选下没有文案。'
  }, [libraryError, libraryStatus, notes.length])

  const setupMessages = React.useMemo(
    () =>
      chatMessages.filter(
        (message) =>
          message.stage === 'setup' &&
          message.title !== '写作画像学习未完成' &&
          message.title !== 'AI 暂时不可用',
      ),
    [chatMessages],
  )
  const analysisMessages = React.useMemo(
    () => chatMessages.filter((message) => message.stage === 'analysis'),
    [chatMessages],
  )
  const followupMessages = React.useMemo(
    () => chatMessages.filter((message) => message.stage === 'followup'),
    [chatMessages],
  )

  const typingState = React.useMemo(() => {
    if (!isStreaming) return null

    const latestMessage = chatMessages[chatMessages.length - 1]

    if (isAnalyzing) {
      const isLongWait = analysisWaitSeconds >= 30
      return {
        title: isLongWait
          ? '仍在生成初稿'
          : selectedItemIds.length > 0
            ? '正在学习参考并生成'
            : '正在生成初稿',
        text:
          selectedItemIds.length > 0
            ? '正在提炼所选素材的写法，并应用到这次需求。'
            : '正在整理这次需求和已有写作偏好。',
        variant: 'analysis' as const,
      }
    }

    if (!analysisReady) {
      return {
        title: '已记录要求',
        variant: 'dots' as const,
      }
    }

    if (latestMessage?.role === 'user') {
      return {
        title: '正在整理回答',
        variant: 'dots' as const,
      }
    }

    if (analysisMessages.length === 0) {
      return {
        title: '正在拆解文案',
        text: '正在整理结构和偏好。',
        variant: 'analysis' as const,
      }
    }

    return {
      title: '正在整理回答',
      variant: 'dots' as const,
    }
  }, [
    analysisMessages.length,
    analysisReady,
    analysisWaitSeconds,
    chatMessages,
    isAnalyzing,
    isStreaming,
    selectedItemIds.length,
  ])

  const filterControl = (
    <div className="relative">
      <Button
        type="button"
        variant={isFolderFiltered ? 'subtle' : 'outline'}
        size="sm"
        className={cn(
          'min-w-[6.75rem] shadow-[0_8px_18px_rgba(48,34,22,0.04)]',
          isFolderFiltered
            ? 'border-[rgba(77,120,242,0.22)] bg-[rgba(103,199,255,0.18)] text-[#566174] hover:bg-[rgba(103,199,255,0.24)]'
            : 'border-[var(--border)] bg-white/82 text-[var(--foreground)] hover:bg-white/92',
        )}
        aria-haspopup="dialog"
        aria-expanded={isFilterOpen}
        aria-label={
          isFolderFiltered ? `按文件夹筛选，当前为 ${activeFolder?.name ?? '未知文件夹'}` : '按文件夹筛选'
        }
        onClick={() => setIsFilterOpen((current) => !current)}
      >
        <Funnel
          className={cn(
            'h-4 w-4 shrink-0',
            isFolderFiltered ? 'text-[#566174]' : 'text-[var(--soft-foreground)]',
          )}
        />
        <span className="max-w-32 truncate">{activeFolder?.name ?? '文件夹'}</span>
      </Button>

      {isFilterOpen ? (
        <div
          className="ui-popover-motion absolute right-0 top-[calc(100%+var(--ui-gap-control))] z-40 w-[min(28rem,calc(100vw-4rem))] rounded-[var(--ui-radius-panel)] border border-white/84 bg-white/96 p-[var(--ui-panel-inset)] shadow-[0_22px_54px_rgba(48,34,22,0.12)] backdrop-blur-xl"
          role="dialog"
          aria-label="按文件夹筛选文案"
        >
          <div className="grid gap-[var(--ui-panel-gap)]">
            <div>
              <div className="mb-2 text-xs font-semibold text-[var(--soft-foreground)]">
                按文件夹
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => setFolderFilterId('all')}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'shadow-none',
                    folderFilterId === 'all'
                      ? 'bg-[var(--foreground)] text-white hover:bg-[var(--foreground)]'
                      : 'bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-white',
                  )}
                >
                  全部文件夹
                </Button>
                {folders.map((folder) => (
                  <Button
                    key={folder.id}
                    type="button"
                    onClick={() => setFolderFilterId(folder.id)}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'shadow-none',
                      folderFilterId === folder.id
                        ? 'bg-[var(--foreground)] text-white hover:bg-[var(--foreground)]'
                        : 'bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-white',
                    )}
                  >
                    {folder.name}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex justify-between gap-3 border-t border-[var(--border)] pt-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={!isFolderFiltered}
                onClick={() => setFolderFilterId('all')}
              >
                显示全部文件夹
              </Button>
              <Button size="sm" onClick={() => setIsFilterOpen(false)}>
                完成
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-[linear-gradient(120deg,#eef2f6_0%,#f6f8fb_46%,#ffffff_100%)]">
      {isSidebarOpen ? (
        <>
          <button
            type="button"
            aria-label="关闭对话列表"
            onClick={onCloseSidebar}
            className="fixed inset-0 z-[70] bg-[rgba(15,23,42,0.16)] backdrop-blur-[2px]"
          />
          <aside className="fixed inset-y-0 left-0 z-[80] flex w-[min(20rem,calc(100vw-2rem))] min-h-0 flex-col border-r border-[rgba(15,23,42,0.06)] bg-[linear-gradient(180deg,#f4f6f8_0%,#f7f9fb_58%,#fbfcfd_100%)] shadow-[18px_0_60px_rgba(15,23,42,0.12)]">
        <div className="shrink-0 px-6 pb-3 pt-6">
          <div className="flex items-center gap-3 px-1">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => {
                onCloseSidebar()
                onBackToWorkspace()
              }}
              aria-label="返回首页"
              className="shrink-0"
            >
              <Home className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-[var(--foreground)]">
                {projectName}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCloseSidebar}
              aria-label="关闭对话列表"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <Button
            type="button"
            onClick={() => {
              onCreateConversation()
              onCloseSidebar()
            }}
            variant="subtle"
            className="mt-7 w-full justify-between border-[var(--border)] bg-[rgba(241,243,246,0.78)] px-[var(--ui-control-px-lg)] text-left shadow-none hover:bg-[rgba(226,232,240,0.9)]"
          >
            <span className="text-sm font-semibold text-[var(--accent-strong)]">新对话</span>
          </Button>
          <p className="mt-6 px-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--soft-foreground)]">
            历史对话
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="flex flex-col gap-1">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId
              const isRenaming = renamingConversationId === conversation.id
              const sameTitleConversations = conversations.filter(
                (item) => item.title === conversation.title,
              )
              const accessibleTitleSuffix =
                sameTitleConversations.length > 1
                  ? `，第 ${sameTitleConversations.findIndex((item) => item.id === conversation.id) + 1} 个`
                  : ''
              const switchToConversation = () => {
                setOpenConversationMenuId(null)
                onSwitchConversation(conversation.id)
                onCloseSidebar()
              }

              return (
                <div
                  key={conversation.id}
                  className={cn(
                    'group relative flex min-h-[3.25rem] w-full cursor-pointer items-center gap-3 rounded-[var(--ui-radius-card)] border border-transparent px-3 py-2 text-sm leading-6 transition',
                    conversation.pinned
                      ? 'bg-[rgba(241,243,246,0.72)] text-[var(--accent-strong)]'
                      : 'bg-transparent',
                    isActive
                      ? cn(
                          'font-semibold text-[var(--foreground)]',
                          conversation.pinned
                            ? 'bg-[linear-gradient(90deg,rgba(238,241,245,0.86),rgba(255,255,255,0.66))]'
                            : 'bg-white/58',
                        )
                      : 'text-[var(--foreground)] hover:bg-white/42',
                  )}
                >
                  {!isRenaming ? (
                    <button
                      type="button"
                      aria-current={isActive ? 'true' : undefined}
                      aria-label={`打开对话 ${conversation.title}${accessibleTitleSuffix}`}
                      onClick={switchToConversation}
                      className="absolute inset-0 z-0 rounded-[var(--ui-radius-card)] bg-transparent outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                    />
                  ) : null}
                  <MessageCircle
                    className={cn(
                      'pointer-events-none relative z-10 h-4 w-4 shrink-0',
                      conversation.pinned ? 'text-[var(--accent-strong)]' : 'text-[var(--soft-foreground)]',
                    )}
                  />

                  {isRenaming ? (
                    <Input
                      autoFocus
                      controlSize="sm"
                      value={draftConversationTitle}
                      onChange={(event) => setDraftConversationTitle(event.target.value)}
                      onBlur={() => commitConversationRename(conversation)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitConversationRename(conversation)
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelConversationRename()
                        }
                      }}
                      className="relative z-20 min-w-0 flex-1 rounded-[var(--ui-radius-control)] bg-white/86 font-semibold"
                      aria-label="重命名对话"
                    />
                  ) : (
                    <div className="pointer-events-none relative z-10 min-w-0 flex-1 py-1 text-left">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="block min-w-0 truncate">{conversation.title}</span>
                        {conversation.finalizedAt ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[rgba(42,157,143,0.16)] bg-[rgba(232,248,245,0.7)] px-1.5 py-0.5 text-[length:var(--ui-text-caption)] font-semibold leading-none text-[#17675b]">
                            <CheckCircle2 className="h-3 w-3" />
                            完成
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )}

                  {!isRenaming ? (
                    <div className="relative z-20 flex h-8 w-8 shrink-0 items-center justify-center">
                      {conversation.pinned ? (
                        <Pin className="h-3.5 w-3.5 text-[var(--accent-strong)] transition group-hover:opacity-0 group-focus-within:opacity-0" />
                      ) : null}
                      <button
                        ref={(node) => {
                          if (node) {
                            conversationMenuButtonRefs.current.set(conversation.id, node)
                          } else {
                            conversationMenuButtonRefs.current.delete(conversation.id)
                          }
                        }}
                        type="button"
                        data-conversation-menu
                        onClick={(event) => {
                          event.stopPropagation()
                          if (openConversationMenuId !== conversation.id) {
                            updateConversationMenuPosition(conversation.id)
                          }
                          setOpenConversationMenuId((current) =>
                            current === conversation.id ? null : conversation.id,
                          )
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        className={cn(
                          'absolute inset-0 flex h-8 w-8 items-center justify-center rounded-full text-[var(--soft-foreground)] opacity-0 transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] focus-visible:ring-4 focus-visible:ring-[var(--ring)] group-hover:opacity-100 group-focus-within:opacity-100',
                          openConversationMenuId === conversation.id && 'opacity-100',
                        )}
                        aria-label="对话更多操作"
                        aria-haspopup="menu"
                        aria-expanded={openConversationMenuId === conversation.id}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}

                  {openConversationMenuId === conversation.id && typeof document !== 'undefined'
                    ? createPortal(
                        <div
                          data-conversation-menu
                          className="ui-popover-motion fixed z-[100] w-36 overflow-hidden rounded-[var(--ui-radius-panel)] border border-white/84 bg-white/95 p-[var(--ui-space-1)] text-sm font-medium text-[var(--foreground)] shadow-[0_18px_48px_rgba(48,34,22,0.12)] backdrop-blur-xl"
                          role="menu"
                          style={{
                            left: conversationMenuPosition.left,
                            top: conversationMenuPosition.top,
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            event.stopPropagation()
                            if (event.key === 'Escape') {
                              setOpenConversationMenuId(null)
                              conversationMenuButtonRefs.current.get(conversation.id)?.focus()
                            }
                          }}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                              event.stopPropagation()
                              startConversationRename(conversation)
                            }}
                            className="flex w-full items-center rounded-[var(--ui-radius-item)] px-3 py-2 text-left transition hover:bg-[var(--secondary)]"
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                              event.stopPropagation()
                              onToggleConversationPin(conversation.id)
                              setOpenConversationMenuId(null)
                            }}
                            className="flex w-full items-center rounded-[var(--ui-radius-item)] px-3 py-2 text-left transition hover:bg-[var(--secondary)]"
                          >
                            {conversation.pinned ? '取消置顶' : '置顶'}
                          </button>
                        </div>,
                        document.body,
                      )
                    : null}
                </div>
              )
            })}
          </div>
        </div>
          </aside>
        </>
      ) : null}

      <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(148,163,184,0.08),transparent_34%),linear-gradient(180deg,#f6f8fb_0%,#fbfcfd_52%,#ffffff_100%)]">
        {analysisReady || isAnalyzing ? (
          <header className="flex flex-wrap items-center justify-between gap-3 bg-transparent px-5 py-4 lg:px-6">
            <div className="flex min-w-0 items-start">
              <WorkflowHeaderNav
                onBackToWorkspace={onBackToWorkspace}
                onOpenSidebar={onOpenSidebar}
              />
              <div className="min-w-0 pt-1">
                <h1 className="truncate text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  正在准备初稿
                </h1>
                {analysisReady && !isAnalyzing ? (
                  <p className="mt-[var(--ui-gap-related)] text-xs text-[var(--soft-foreground)]">
                    继续补充偏好，或进入下一步
                  </p>
                ) : null}
              </div>
              <WorkflowStageNav
                activeStep="references"
                className="ml-2 mt-1"
                onStepChange={onWorkflowStepChange}
                steps={workflowSteps}
              />
            </div>
          </header>
        ) : null}

        <div
          ref={scrollViewportRef}
          className={cn(
            'min-h-0 flex-1 bg-transparent px-4 lg:px-8',
            analysisReady || isAnalyzing ? 'overflow-y-auto py-5' : 'overflow-hidden py-2',
          )}
        >
          {isAnalyzing ? (
            <div className="mx-auto flex h-full max-w-5xl items-center justify-center pb-[12vh]">
              {typingState ? (
                <TypingBlock
                  title={typingState.title}
                  text={typingState.text}
                  variant={typingState.variant}
                />
              ) : null}
            </div>
          ) : !analysisReady ? (
            <div className="mx-auto flex h-full max-w-7xl flex-col gap-4">
              {setupMessages.length > 0 || typingState ? (
                <div className="flex max-h-[32%] shrink-0 flex-col gap-4 overflow-y-auto pr-1">
                  {setupMessages.map((message) =>
                    message.role === 'user' ? (
                      <UserBlock key={message.id} message={message} />
                    ) : (
                      <AssistantBlock key={message.id} message={message} notes={notes} snippets={snippets} />
                    ),
                  )}
                  {typingState ? (
                    <TypingBlock
                      title={typingState.title}
                      text={typingState.text}
                      variant={typingState.variant}
                    />
                  ) : null}
                </div>
              ) : null}

              <section className="flex min-h-0 flex-1 flex-col px-3 py-3">
                <div className="shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-[var(--ui-gap-block)]">
                      <WorkflowHeaderNav
                        onBackToWorkspace={onBackToWorkspace}
                        onOpenSidebar={onOpenSidebar}
                      />
                      <h1 className="text-[length:var(--ui-text-section)] font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                        选择参考
                      </h1>
                      <Badge variant="outline">可选</Badge>
                      <WorkflowStageNav
                        activeStep="references"
                        onStepChange={onWorkflowStepChange}
                        steps={workflowSteps}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid gap-1 border-y border-[rgba(15,23,42,0.07)] py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                    <span className="text-xs font-semibold text-[var(--soft-foreground)]">本次需求</span>
                    <p className="line-clamp-2 text-sm leading-6 text-[var(--foreground)]">
                      {writingRequest}
                    </p>
                    <span className="text-xs font-medium text-[var(--soft-foreground)]">
                      {referenceRecommendations.length > 0
                        ? `已找到 ${referenceRecommendations.length} 篇较相关素材`
                        : '暂无高匹配建议，可直接生成'}
                    </span>
                  </div>

                  {nonLearningNoteCount > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-[var(--muted-foreground)]">
                      <span>
                        {nonLearningNoteCount} 篇素材当前不参与 AI 学习，也不会用于推荐和生成。
                      </span>
                      <Button type="button" variant="ghost" size="sm" onClick={onOpenLibrary}>
                        去文案库处理
                      </Button>
                    </div>
                  ) : null}

                  {selectedReferenceNotes.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--ui-radius-card)] bg-white/56 px-3 py-2 text-xs text-[var(--muted-foreground)]">
                      <span className="shrink-0 font-semibold text-[var(--foreground)]">
                        已选 {selectedReferenceNotes.length} 篇
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                        {selectedReferenceNotes.map(({ itemIds, note }) => (
                          <span
                            key={note.id}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--border)] bg-white/82 py-1 pl-2.5 pr-1"
                          >
                            <span className="max-w-52 truncate">{note.title}</span>
                            <button
                              type="button"
                              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--soft-foreground)] transition hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
                              aria-label={`移除已选素材 ${note.title}`}
                              onClick={() => onDeselectItems(itemIds)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => onDeselectItems(selectedItemIds)}
                      >
                        清空
                      </Button>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    {showAllReferences || referenceRecommendations.length > 0 ? (
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {visibleTabs.map((tab) => (
                        <Button
                          key={tab.id}
                          type="button"
                          title={tab.fullLabel}
                          onClick={() => setActiveTab(tab.id)}
                          variant="ghost"
                          size="sm"
                          className={cn(
                            'shadow-none',
                            activeTab === tab.id
                              ? 'font-semibold text-[var(--foreground)] shadow-[0_8px_18px_rgba(48,34,22,0.04)]'
                              : 'font-medium text-[var(--muted-foreground)]',
                          )}
                          style={{
                            background:
                              activeTab === tab.id
                                ? tab.id === 'all'
                                  ? 'rgba(255,255,255,0.92)'
                                  : tab.colorValue || '#e8eef5'
                                : 'rgba(255,255,255,0.54)',
                          }}
                        >
                          {tab.label}
                        </Button>
                      ))}

                      {overflowTabs.length > 0 ? (
                        <Select
                          value={activeOverflowTab?.id}
                          onValueChange={(value) => setActiveTab(value)}
                        >
                          <SelectTrigger
                            controlSize="sm"
                            aria-label="更多标签"
                            className={cn(
                              'w-auto min-w-[5.75rem] rounded-full border-white/80 bg-white/62 px-[var(--ui-control-inset-x-md)] shadow-none',
                              activeOverflowTab
                                ? 'font-semibold text-[var(--foreground)] shadow-[0_8px_18px_rgba(48,34,22,0.04)]'
                                : 'font-medium text-[var(--muted-foreground)]',
                            )}
                          >
                            <SelectValue placeholder={activeOverflowTab?.label || '更多'} />
                          </SelectTrigger>
                          <SelectContent align="start">
                            {overflowTabs.map((tab) => (
                              <SelectItem key={tab.id} value={tab.id}>
                                {tab.fullLabel}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      </div>
                    ) : <span />}

                    <div className="flex w-full min-w-0 flex-wrap justify-end gap-[var(--ui-gap-control)] sm:w-auto sm:shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllReferences((current) => !current)}
                      >
                        {showAllReferences ? '仅看推荐' : '浏览全部素材'}
                      </Button>
                      {showAllReferences || referenceRecommendations.length > 0 ? (
                        <>
                          {filterControl}
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                              'border-[rgba(31,22,17,0.1)] bg-transparent font-semibold shadow-none hover:bg-white/58',
                              activeResultItemIds.length === 0
                                ? 'text-[var(--soft-foreground)]'
                                : 'text-[var(--foreground)]',
                            )}
                            disabled={activeResultItemIds.length === 0}
                            onClick={() => {
                              if (isActiveResultFullySelected) {
                                onDeselectItems(activeResultItemIds)
                                return
                              }

                              onSelectItems(activeResultItemIds)
                            }}
                          >
                            {isActiveResultFullySelected ? '取消全选' : '全选'}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        className="min-w-[8.5rem] font-semibold"
                        disabled={isStreaming}
                        onClick={onStartAnalysis}
                      >
                        {isAnalyzing ? (
                          <>
                            <span className="draft-thinking-dot h-2 w-2 rounded-full bg-current" />
                            正在分析...
                          </>
                        ) : (
                          analysisError
                            ? '重试分析'
                            : selectedReferenceNotes.length > 0
                              ? `用 ${selectedReferenceNotes.length} 篇参考继续`
                              : '不使用参考，继续'
                        )}
                      </Button>
                    </div>
                  </div>
                  {analysisError ? (
                    <p
                      className="mt-2 text-right text-xs leading-5 text-[rgb(185,28,28)]"
                      role="alert"
                    >
                      {analysisError}
                    </p>
                  ) : null}
                </div>

                <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-1 pb-3 pt-1.5">
                  <div className="grid gap-4 xl:grid-cols-2">
                    {visibleReferenceItems.map((item) => {
                      const checkboxId = `learning-item-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
                      const recommendationReason = recommendationByNoteId.get(item.noteId)

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'group ui-hover-surface rounded-[var(--ui-radius-card)] p-4',
                            item.selectedCount > 0
                              ? 'border border-[rgba(15,23,42,0.14)] bg-[var(--surface-raised)] shadow-[var(--shadow-muted)]'
                              : 'border border-[rgba(15,23,42,0.07)] bg-[var(--surface-muted)]',
                          )}
                        >
                          <div className="flex items-start gap-[var(--ui-gap-group)]">
                            <Checkbox
                              id={checkboxId}
                              className="mt-1.5"
                              checked={item.isPartiallySelected ? 'indeterminate' : item.isFullySelected}
                              onCheckedChange={() => onToggleItems(item.itemIds)}
                            />
                            <label className="min-w-0 flex-1 cursor-pointer" htmlFor={checkboxId}>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="min-w-0 flex-1 text-base font-semibold leading-7 text-[var(--foreground)]">
                                  {item.title}
                                </p>
                                <Badge variant={item.selectedCount > 0 ? 'accent' : 'outline'}>
                                  {item.selectedCount > 0 ? '已选' : '未选'}
                                </Badge>
                                {recommendationReason ? (
                                  <Badge variant="accent">基于需求匹配</Badge>
                                ) : null}
                              </div>
                              {recommendationReason ? (
                                <p className="mt-1.5 text-xs leading-5 text-[var(--muted-foreground)]">
                                  {recommendationReason}
                                </p>
                              ) : null}
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Badge variant="outline">{item.folderName}</Badge>
                                {item.tags.length > 0 ? (
                                  item.tags.map((tag) => (
                                    <span
                                      key={tag.id}
                                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/70 px-2.5 py-1 text-xs font-semibold text-[var(--muted-foreground)]"
                                    >
                                      <span
                                        className="h-2 w-2 rounded-full"
                                        style={{ backgroundColor: tag.colorValue || '#64748B' }}
                                      />
                                      {tag.label}
                                    </span>
                                  ))
                                ) : (
                                  <Badge variant="outline">未标注</Badge>
                                )}
                              </div>
                              <p className="mt-3 rounded-[var(--ui-radius-card)] border border-black/[0.035] bg-[var(--surface-subtle)] px-4 py-3 text-[length:var(--ui-text-body)] leading-8 text-[var(--foreground)] shadow-none">
                                {item.preview}
                              </p>
                            </label>
                          </div>
                        </div>
                      )
                    })}
                    {visibleReferenceItems.length === 0 ? (
                      <div className="rounded-[var(--ui-radius-card)] border border-dashed border-[rgba(31,22,17,0.12)] bg-[var(--surface-muted)] px-5 py-8 text-sm leading-7 text-[var(--muted-foreground)] xl:col-span-2">
                        {showAllReferences
                          ? emptyLibraryMessage
                          : '没有找到足够相关的参考素材。直接生成更稳妥，也可以点击“浏览全部素材”手动选择。'}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-end gap-6 pb-4">
              {setupMessages.map((message) =>
                message.role === 'user' ? (
                  <UserBlock key={message.id} message={message} />
                ) : (
                  <AssistantBlock key={message.id} message={message} notes={notes} snippets={snippets} />
                ),
              )}

              {analysisMessages.map((message) => (
                <AssistantBlock key={message.id} message={message} notes={notes} snippets={snippets} />
              ))}
              {followupMessages.map((message) =>
                message.role === 'user' ? (
                  <UserBlock key={message.id} message={message} />
                ) : (
                  <AssistantBlock key={message.id} message={message} notes={notes} snippets={snippets} />
                ),
              )}
              {typingState ? (
                <TypingBlock
                  title={typingState.title}
                  text={typingState.text}
                  variant={typingState.variant}
                />
              ) : null}
              <div ref={scrollAnchorRef} />
            </div>
          )}
        </div>

        {analysisReady && !isAnalyzing ? (
          <div className="shrink-0 bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.72)_28%)] px-4 pb-4 pt-2 lg:px-8 lg:pb-5">
            <div className="mx-auto max-w-5xl">
              <div className="rounded-[var(--ui-radius-panel)] border border-[rgba(15,23,42,0.09)] bg-white/76 p-2 shadow-[0_14px_34px_rgba(15,23,42,0.055)] transition focus-within:border-[rgba(15,23,42,0.16)] focus-within:bg-white/92 focus-within:shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
                <Textarea
                  ref={chatInputRef}
                  rows={1}
                  className="min-h-[3.25rem] max-h-36 w-full resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-base leading-7 text-[var(--foreground)] shadow-none outline-none placeholder:text-[var(--soft-foreground)] focus:!border-0 focus:!ring-0 focus:!ring-offset-0 focus:!shadow-none focus-visible:!outline-none focus-visible:!ring-0"
                  value={chatInput}
                  onChange={(event) => onChatInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      onSendChat()
                    }
                  }}
                  placeholder="继续提问，或补充你的偏好..."
                  aria-label="继续提问或补充偏好"
                />
                <div className="flex items-center justify-between gap-[var(--ui-gap-group)] px-[var(--ui-space-2)] pb-[var(--ui-space-1)] pt-[var(--ui-space-1)]">
                  <span className="hidden text-xs text-[var(--soft-foreground)] sm:inline">
                    Enter 发送 · Shift + Enter 换行
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto min-w-[5.5rem]"
                    onClick={onSendChat}
                    disabled={isStreaming || !chatInput.trim()}
                  >
                    <SendHorizontal className="h-4 w-4" />
                    发送
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
