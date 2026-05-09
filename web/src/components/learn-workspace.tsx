import * as React from 'react'
import type { SavedFolderRecord, SavedNoteRecord, SavedSnippetRecord } from '@lumos-ai/shared'
import { createPortal } from 'react-dom'
import { ArrowLeft, CheckCircle2, Funnel, MessageCircle, MoreHorizontal, Pin, SendHorizontal, X } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import {
  WorkflowTitleMenu,
  type WorkflowStepId,
  type WorkflowTitleMenuStep,
} from '@/components/workflow-title-menu'

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
  activeWorkflowStep: WorkflowStepId
  folders: SavedFolderRecord[]
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
  workflowSteps: WorkflowTitleMenuStep[]
  isStreaming: boolean
  projectName: string
  conversations: Array<{ id: string; title: string; pinned?: boolean; finalizedAt?: string }>
  selectedItemIds: string[]
  onBackToWorkspace: () => void
  onCreateConversation: () => void
  onConversationTitleChange: (conversationId: string, title: string) => void
  onToggleConversationPin: (conversationId: string) => void
  onSwitchConversation: (conversationId: string) => void
  onStartAnalysis: () => void
  onBackToSelection: () => void
  onNext: () => void
  onToggleItems: (itemIds: string[]) => void
  onSelectItems: (itemIds: string[]) => void
  onDeselectItems: (itemIds: string[]) => void
  onSendChat: () => void
  onChatInputChange: (value: string) => void
  onWorkflowStepChange: (step: WorkflowStepId) => void
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
        {makeHighlightNode(snippet.selectedText, snippet.colorValue || '#ffeddc', snippet.dimmed)}
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
          <p className="rounded-full bg-white/56 px-4 py-2 text-sm font-semibold text-[#6a7680]">
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
        className="ui-dialog-card grid max-h-[90vh] w-[calc(100vw-2.5rem)] overflow-hidden rounded-[1.65rem] border border-[rgba(31,22,17,0.08)] bg-[#fffdf9] shadow-[0_28px_90px_rgba(31,22,17,0.18)] md:w-[calc(100vw-4rem)] lg:w-[clamp(54rem,63vw,80rem)] lg:grid-cols-[49%_51%]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <NoteCover note={note} />
        <section className="relative min-h-0 overflow-y-auto px-6 py-7 md:px-10 md:py-10 xl:px-12">
          <button
            type="button"
            aria-label="关闭笔记详情"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--soft-foreground)] transition hover:bg-white hover:text-[var(--foreground)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
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

          <article className="mt-6 whitespace-pre-wrap text-[17px] leading-9 text-[var(--foreground)]">
            {highlightDetailSnippets(content, highlightedSnippets, activeSnippet.quote)}
          </article>
        </section>
      </div>
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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(103,199,255,0.2),rgba(255,149,80,0.22))] text-xs font-semibold text-[var(--accent-strong)]">
          AI
        </div>
        <div className="min-w-0 flex-1 rounded-[1.2rem] border border-white/82 bg-white/88 px-5 py-4 shadow-[0_14px_34px_rgba(48,34,22,0.04)]">
          <p className="max-w-5xl text-[15px] leading-7 text-[var(--foreground)]">
            {commonConclusion}
          </p>

        <div className="mt-3 grid gap-1.5 rounded-[0.95rem] bg-[rgba(255,240,229,0.52)] px-3.5 py-2.5">
          {commonMoves.map((move) => (
            <p key={`${move.title}-${move.body}`} className="text-sm leading-6 text-[var(--foreground)]">
              <span className="font-semibold text-[var(--accent-strong)]">{move.title}：</span>
              {move.body}
            </p>
          ))}
        </div>

        {featuredSnippets.length > 0 ? (
          <section className="mt-7">
            <p className="text-sm font-semibold text-[var(--foreground)]">可以重点参考的句子</p>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {featuredSnippets.map((snippet) => (
                <button
                  key={`${snippet.noteTitle}-${snippet.quote}`}
                  type="button"
                  aria-label={`查看《${snippet.noteTitle}》的笔记详情`}
                  onClick={() => setActiveSnippetDetail(snippet)}
                  className={cn(
                    'group flex h-full flex-col rounded-[1rem] border px-4 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/88 focus-visible:ring-4 focus-visible:ring-[var(--ring)]',
                    activeSnippetDetail?.quote === snippet.quote
                      ? 'border-[rgba(240,122,47,0.22)] bg-white/92 shadow-[0_12px_24px_rgba(48,34,22,0.055)]'
                      : 'border-[rgba(31,22,17,0.07)] bg-white/72',
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="inline-flex rounded-full bg-[rgba(255,240,229,0.9)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                      {snippet.label}
                    </span>
                    <span className="text-xs font-semibold text-[var(--soft-foreground)] transition group-hover:text-[var(--accent-strong)]">
                      查看详情
                    </span>
                  </span>
                  <blockquote className="mt-2 text-[14.5px] font-semibold leading-6 text-[var(--foreground)]">
                    “{snippet.quote}”
                  </blockquote>
                  <p className="mt-2 text-[13.5px] leading-6 text-[var(--foreground)]">
                    <span className="font-semibold">处理方式：</span>
                    {snippet.description}
                  </p>
                  {snippet.reason ? (
                    <p className="mt-1 text-[13.5px] leading-6 text-[var(--muted-foreground)]">
                      <span className="font-semibold text-[var(--foreground)]">标注理由：</span>
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

  if (isAnalysis && hasHighlights) {
    return <AnalysisBlock message={message} notes={notes} snippets={snippets} />
  }

  return (
    <article className="ui-chat-row mx-auto flex max-w-5xl gap-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(103,199,255,0.24),rgba(255,149,80,0.24))] text-sm font-semibold text-[var(--accent-strong)]">
        AI
      </div>
      <div
        className={cn(
          'min-w-0 flex-1',
          isAnalysis
            ? 'rounded-[2rem] border border-white/82 bg-[linear-gradient(180deg,rgba(255,252,248,0.96),rgba(255,255,255,0.88))] px-6 py-5 shadow-[0_18px_44px_rgba(48,34,22,0.06)]'
            : 'space-y-4',
        )}
      >
        {message.title ? (
          <div
            className={cn(
              'inline-flex rounded-full px-4 py-2 text-sm font-semibold text-[var(--foreground)]',
              isAnalysis
                ? 'border border-[rgba(240,122,47,0.12)] bg-[rgba(255,240,229,0.9)] text-[var(--accent-strong)] shadow-none'
                : 'border border-[var(--border)] bg-white/86 shadow-[0_8px_18px_rgba(48,34,22,0.04)]',
            )}
          >
            {message.title}
          </div>
        ) : null}
        {leadLine ? (
          <div className="mt-4">
            <p className="text-[15px] leading-8 text-[var(--foreground)]">{leadLine}</p>
          </div>
        ) : (
          <div className={cn(isAnalysis ? 'mt-4 space-y-5' : 'space-y-4')}>
            {trailingLines.map((line) => (
              <p
                key={line}
                className={cn(
                  'text-[15px] text-[var(--foreground)]',
                  isAnalysis ? 'leading-8' : 'leading-8',
                )}
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
                className="rounded-[1.4rem] border border-[rgba(240,122,47,0.12)] bg-[linear-gradient(180deg,rgba(255,244,235,0.88),rgba(255,255,255,0.92))] p-4 shadow-[0_12px_28px_rgba(48,34,22,0.04)]"
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
          <div className="mt-4 rounded-[1.4rem] border border-white/72 bg-white/72 px-4 py-3">
            {trailingLines.map((line) => (
              <p key={line} className="text-sm leading-7 text-[var(--muted-foreground)]">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function UserBlock({ message }: { message: ChatMessage }) {
  return (
    <article className="ui-chat-row mx-auto flex max-w-5xl justify-end">
      <div className="max-w-2xl rounded-[1.7rem] rounded-br-[0.6rem] bg-[linear-gradient(135deg,#67c7ff_0%,#efb6d0_54%,#ff9550_100%)] px-5 py-4 text-white shadow-[0_18px_36px_rgba(255,149,80,0.2)]">
        {message.lines.map((line) => (
          <p key={line} className="text-[15px] leading-7">
            {line}
          </p>
        ))}
      </div>
    </article>
  )
}

function TypingBlock({ title, text }: { title?: string; text?: string }) {
  return (
    <article className="ui-chat-row mx-auto flex max-w-5xl gap-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(103,199,255,0.24),rgba(255,149,80,0.24))] text-sm font-semibold text-[var(--accent-strong)]">
        AI
      </div>
      <div className="rounded-[1.6rem] border border-[var(--border)] bg-white/88 px-4 py-3 shadow-[0_8px_18px_rgba(48,34,22,0.04)]">
        {title ? (
          <div className="mb-2 inline-flex rounded-full border border-[rgba(240,122,47,0.12)] bg-[rgba(255,240,229,0.9)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
            {title}
          </div>
        ) : null}
        {text ? (
          <p className="mb-3 text-[15px] leading-7 text-[var(--foreground)]">{text}</p>
        ) : null}
        <div className="flex items-center gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <span
              key={index}
              className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] opacity-60 animate-pulse"
              style={{ animationDelay: `${index * 0.15}s` }}
            />
          ))}
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
  activeWorkflowStep,
  folders,
  notes,
  snippets,
  workflowSteps,
  isStreaming,
  projectName,
  conversations,
  selectedItemIds,
  onBackToWorkspace,
  onCreateConversation,
  onConversationTitleChange,
  onToggleConversationPin,
  onSwitchConversation,
  onStartAnalysis,
  onBackToSelection,
  onNext,
  onToggleItems,
  onSelectItems,
  onDeselectItems,
  onSendChat,
  onChatInputChange,
  onWorkflowStepChange,
}: LearnWorkspaceProps) {
  const [activeTab, setActiveTab] = React.useState('all')
  const [folderFilterId, setFolderFilterId] = React.useState('all')
  const [isFilterOpen, setIsFilterOpen] = React.useState(false)
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

  const activeFolder = React.useMemo(
    () => folders.find((folder) => folder.id === folderFilterId),
    [folderFilterId, folders],
  )

  const activeTag = React.useMemo(
    () => tabs.find((tab) => tab.id === activeTab),
    [activeTab, tabs],
  )

  const isFiltered = folderFilterId !== 'all' || activeTab !== 'all'
  const activeFilterCount = Number(folderFilterId !== 'all') + Number(activeTab !== 'all')

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

  const activeResultItemIds = React.useMemo(
    () => getUniqueValues(activeTabItems.flatMap((item) => item.itemIds)),
    [activeTabItems],
  )

  const activeResultSelectedCount = React.useMemo(
    () => activeResultItemIds.filter((itemId) => selectedItemIdSet.has(itemId)).length,
    [activeResultItemIds, selectedItemIdSet],
  )
  const isActiveResultFullySelected =
    activeResultItemIds.length > 0 && activeResultSelectedCount === activeResultItemIds.length

  const filterSummary = React.useMemo(() => {
    if (!isFiltered) return '未筛选'

    return [activeFolder?.name, activeTag && activeTag.id !== 'all' ? activeTag.fullLabel : '']
      .filter(Boolean)
      .join(' · ')
  }, [activeFolder?.name, activeTag, isFiltered])

  const setupMessages = React.useMemo(
    () => chatMessages.filter((message) => message.stage === 'setup'),
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

    if (!analysisReady) {
      return {
        title: '已记下你的要求',
        text: '你可以继续勾选这一轮要参考的文案，我会带着这个方向一起看。',
      }
    }

    if (latestMessage?.role === 'user') {
      return {
        title: '正在整理回答',
        text: '我在结合刚才这轮分析和你的追问补充更准确的判断。',
      }
    }

    if (analysisMessages.length === 0) {
      return {
        title: '正在拆解这批文案',
        text: '我在归纳它们的共性、读者停留原因和你最稳定的偏好，马上给你第一版结论。',
      }
    }

    return {
      title: '继续整理读者视角',
      text: '我在把剩下的结论收束成更好落地的判断和下一步建议。',
    }
  }, [analysisMessages.length, analysisReady, chatMessages, isStreaming])

  const filterControl = (
    <div className="relative">
      <button
        type="button"
        className={cn(
          'inline-flex h-8 min-w-[6.75rem] items-center justify-center gap-2 rounded-full border px-3 text-sm font-semibold shadow-[0_8px_18px_rgba(48,34,22,0.04)] outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--ring)]',
          isFiltered
            ? 'border-[rgba(77,120,242,0.22)] bg-[rgba(103,199,255,0.18)] text-[#566174] hover:bg-[rgba(103,199,255,0.24)]'
            : 'border-[rgba(240,122,47,0.16)] bg-white/82 text-[var(--foreground)] hover:bg-white/92',
        )}
        aria-haspopup="dialog"
        aria-expanded={isFilterOpen}
        aria-label={
          isFiltered
            ? `筛选，已启用 ${activeFilterCount} 个筛选条件：${filterSummary}`
            : '筛选'
        }
        onClick={() => setIsFilterOpen((current) => !current)}
      >
        <Funnel
          className={cn(
            'h-4 w-4 shrink-0',
            isFiltered ? 'text-[#566174]' : 'text-[var(--accent-strong)]',
          )}
        />
        <span>{isFiltered ? `${activeFilterCount} 筛选` : '筛选'}</span>
      </button>

      {isFilterOpen ? (
        <div
          className="ui-popover-motion absolute right-0 top-[calc(100%+0.65rem)] z-40 w-[min(38rem,calc(100vw-4rem))] rounded-[1.45rem] border border-white/84 bg-white/96 p-4 shadow-[0_22px_54px_rgba(48,34,22,0.12)] backdrop-blur-xl"
          role="dialog"
          aria-label="筛选文案"
        >
          <div className="grid gap-4">
            <div>
              <div className="mb-2 text-xs font-semibold text-[var(--soft-foreground)]">
                按文件夹
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFolderFilterId('all')}
                  className={cn(
                    'rounded-full px-3.5 py-2 text-sm font-semibold transition focus-visible:ring-4 focus-visible:ring-[var(--ring)]',
                    folderFilterId === 'all'
                      ? 'bg-[var(--foreground)] text-white'
                      : 'bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-white',
                  )}
                >
                  全部文件夹
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setFolderFilterId(folder.id)}
                    className={cn(
                      'rounded-full px-3.5 py-2 text-sm font-semibold transition focus-visible:ring-4 focus-visible:ring-[var(--ring)]',
                      folderFilterId === folder.id
                        ? 'bg-[var(--foreground)] text-white'
                        : 'bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-white',
                    )}
                  >
                    {folder.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold text-[var(--soft-foreground)]">
                按标注标签
              </div>
              <div className="flex flex-wrap gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    title={tab.fullLabel}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition focus-visible:ring-4 focus-visible:ring-[var(--ring)]',
                      activeTab === tab.id
                        ? 'bg-[var(--foreground)] text-white'
                        : 'bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-white',
                    )}
                  >
                    {tab.colorValue ? (
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: tab.colorValue }}
                      />
                    ) : null}
                    {tab.fullLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-between gap-3 border-t border-[var(--border)] pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFolderFilterId('all')
                  setActiveTab('all')
                }}
              >
                清空筛选
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
    <div className="grid h-[100vh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[linear-gradient(120deg,#f3f1ea_0%,#f8f4ed_44%,#fffaf3_100%)] lg:grid-cols-[328px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="flex min-h-0 max-h-[34vh] flex-col border-b border-[rgba(31,22,17,0.06)] bg-[radial-gradient(circle_at_0%_0%,rgba(103,199,255,0.055),transparent_36%),linear-gradient(180deg,#f4f2eb_0%,#f7f4ee_58%,#faf6ef_100%)] lg:max-h-none lg:border-b-0 lg:border-r lg:border-r-[rgba(31,22,17,0.06)]">
        <div className="shrink-0 px-6 pb-3 pt-6">
          <div className="flex items-center gap-3 px-1">
            <Button
              variant="secondary"
              size="icon"
              onClick={onBackToWorkspace}
              aria-label="返回项目页"
              className="shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-[var(--foreground)]">
                {projectName}
              </p>
              <p className="truncate text-sm text-[var(--muted-foreground)]">
                返回项目页
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCreateConversation}
            className="mt-7 flex w-full items-center justify-between gap-3 rounded-full border border-[rgba(240,122,47,0.18)] bg-[rgba(255,240,229,0.64)] px-4 py-3 text-left transition hover:bg-[rgba(255,240,229,0.86)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
          >
            <span className="text-sm font-semibold text-[var(--accent-strong)]">新对话</span>
          </button>
          <p className="mt-6 px-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--soft-foreground)]">
            历史对话
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="space-y-1">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId
              const isRenaming = renamingConversationId === conversation.id
              const switchToConversation = () => {
                setOpenConversationMenuId(null)
                onSwitchConversation(conversation.id)
              }

              return (
                <div
                  key={conversation.id}
                  role={isRenaming ? undefined : 'button'}
                  tabIndex={isRenaming ? undefined : 0}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={isRenaming ? undefined : switchToConversation}
                  onKeyDown={(event) => {
                    if (isRenaming) return

                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      switchToConversation()
                    }
                  }}
                  className={cn(
                    'group relative flex min-h-[3.25rem] w-full cursor-pointer items-center gap-3 rounded-[0.9rem] border border-transparent px-3 py-2 text-sm leading-6 outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--ring)]',
                    conversation.pinned
                      ? 'bg-[rgba(255,240,229,0.58)] text-[var(--accent-strong)]'
                      : 'bg-transparent',
                    isActive
                      ? cn(
                          'font-semibold text-[var(--foreground)]',
                          conversation.pinned
                            ? 'bg-[linear-gradient(90deg,rgba(255,240,229,0.78),rgba(255,255,255,0.62))]'
                            : 'bg-white/58',
                        )
                      : 'text-[var(--foreground)] hover:bg-white/42',
                  )}
                >
                  <MessageCircle
                    className={cn(
                      'h-4 w-4 shrink-0',
                      conversation.pinned ? 'text-[var(--accent-strong)]' : 'text-[var(--soft-foreground)]',
                    )}
                  />

                  {isRenaming ? (
                    <Input
                      autoFocus
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
                      className="h-9 min-w-0 flex-1 rounded-[0.85rem] bg-white/86 px-3 text-sm font-semibold"
                      aria-label="重命名对话"
                    />
                  ) : (
                    <div className="min-w-0 flex-1 py-1 text-left">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="block min-w-0 truncate">{conversation.title}</span>
                        {conversation.finalizedAt ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[rgba(42,157,143,0.16)] bg-[rgba(232,248,245,0.7)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#17675b]">
                            <CheckCircle2 className="h-3 w-3" />
                            完成
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )}

                  {!isRenaming ? (
                    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
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
                          className="ui-popover-motion fixed z-[100] w-36 overflow-hidden rounded-[1rem] border border-white/84 bg-white/95 p-1.5 text-sm font-medium text-[var(--foreground)] shadow-[0_18px_48px_rgba(48,34,22,0.12)] backdrop-blur-xl"
                          role="menu"
                          style={{
                            left: conversationMenuPosition.left,
                            top: conversationMenuPosition.top,
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                              event.stopPropagation()
                              onToggleConversationPin(conversation.id)
                              setOpenConversationMenuId(null)
                            }}
                            className="flex w-full items-center rounded-[0.78rem] px-3 py-2 text-left transition hover:bg-[var(--secondary)]"
                          >
                            {conversation.pinned ? '取消置顶' : '置顶'}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                              event.stopPropagation()
                              startConversationRename(conversation)
                            }}
                            className="flex w-full items-center rounded-[0.78rem] px-3 py-2 text-left transition hover:bg-[var(--secondary)]"
                          >
                            重命名
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

      <section className="relative flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(255,176,106,0.08),transparent_34%),linear-gradient(180deg,#fbf7f0_0%,#fffaf4_50%,#fffdf9_100%)]">
        {analysisReady ? (
          <header className="grid grid-cols-1 items-center gap-4 bg-transparent px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-6">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  文案分析
                </h1>
                <WorkflowTitleMenu
                  activeStep={activeWorkflowStep}
                  steps={workflowSteps}
                  onStepChange={onWorkflowStepChange}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:justify-self-end">
              <Button variant="secondary" size="sm" onClick={onBackToSelection}>
                上一步
              </Button>
              <Button size="sm" onClick={onNext}>
                下一步
              </Button>
            </div>
          </header>
        ) : null}

        <div
          ref={scrollViewportRef}
          className={cn(
            'min-h-0 flex-1 bg-transparent px-4 lg:px-8',
            analysisReady ? 'overflow-y-auto py-5' : 'overflow-hidden py-2',
          )}
        >
          {!analysisReady ? (
            <div className="mx-auto flex h-full max-w-7xl flex-col gap-4">
              {setupMessages.length > 0 || typingState ? (
                <div className="max-h-[32%] shrink-0 space-y-4 overflow-y-auto pr-1">
                  {setupMessages.map((message) =>
                    message.role === 'user' ? (
                      <UserBlock key={message.id} message={message} />
                    ) : (
                      <AssistantBlock key={message.id} message={message} notes={notes} snippets={snippets} />
                    ),
                  )}
                  {typingState ? <TypingBlock title={typingState.title} text={typingState.text} /> : null}
                </div>
              ) : null}

              <section className="flex min-h-0 flex-1 flex-col px-3 py-3">
                <div className="shrink-0">
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-4">
                      <h2 className="text-[1.35rem] font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                        选择文案
                      </h2>
                      <WorkflowTitleMenu
                        activeStep={activeWorkflowStep}
                        steps={workflowSteps}
                        onStepChange={onWorkflowStepChange}
                      />
                    </div>
                    <p className="text-xs leading-6 text-[var(--muted-foreground)]">
                      当前选择会累计进本轮分析，切换筛选不会清空已选内容。
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {visibleTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          title={tab.fullLabel}
                          onClick={() => setActiveTab(tab.id)}
                          className={cn(
                            'rounded-full px-3.5 py-1.5 text-sm transition',
                            activeTab === tab.id
                              ? 'font-semibold text-[var(--foreground)] shadow-[0_8px_18px_rgba(48,34,22,0.04)]'
                              : 'font-medium text-[var(--muted-foreground)]',
                          )}
                          style={{
                            background:
                              activeTab === tab.id
                                ? tab.id === 'all'
                                  ? 'rgba(255,255,255,0.92)'
                                  : tab.colorValue || '#ffeddc'
                                : 'rgba(255,255,255,0.54)',
                          }}
                        >
                          {tab.label}
                        </button>
                      ))}

                      {overflowTabs.length > 0 ? (
                        <Select
                          value={activeOverflowTab?.id}
                          onValueChange={(value) => setActiveTab(value)}
                        >
                          <SelectTrigger
                            aria-label="更多标签"
                            className={cn(
                              'h-8 w-auto min-w-[5.75rem] rounded-full border-white/80 bg-white/62 px-3.5 py-1.5 shadow-none',
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

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {filterControl}
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          'h-8 border-[rgba(31,22,17,0.1)] bg-transparent px-3.5 text-sm font-semibold shadow-none hover:bg-white/58',
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
                      <Button
                        size="sm"
                        className="h-8 px-4 text-sm font-semibold"
                        disabled={isStreaming || selectedItemIds.length === 0}
                        onClick={onStartAnalysis}
                      >
                        开始分析
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-1 pb-3 pt-1.5">
                  <div className="grid gap-4 xl:grid-cols-2">
                    {activeTabItems.map((item) => {
                      const checkboxId = `learning-item-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'group rounded-[1.35rem] p-4 transition-[background-color,border-color,box-shadow]',
                            item.selectedCount > 0
                              ? 'border border-[rgba(240,122,47,0.24)] bg-[linear-gradient(180deg,rgba(255,250,246,0.94),rgba(255,255,255,0.88))] shadow-[0_12px_26px_rgba(48,34,22,0.045)]'
                              : 'border border-[rgba(31,22,17,0.07)] bg-white/66 hover:bg-white/88',
                          )}
                        >
                          <div className="flex items-start gap-3.5">
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
                              </div>
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
                                        style={{ backgroundColor: tag.colorValue || '#f07a2f' }}
                                      />
                                      {tag.label}
                                    </span>
                                  ))
                                ) : (
                                  <Badge variant="outline">未标注</Badge>
                                )}
                              </div>
                              <p className="mt-3 rounded-[1rem] border border-black/[0.035] bg-white/64 px-4 py-3 text-[15px] leading-8 text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                                {item.preview}
                              </p>
                            </label>
                          </div>
                        </div>
                      )
                    })}
                    {activeTabItems.length === 0 ? (
                      <div className="rounded-[1.35rem] border border-dashed border-[rgba(31,22,17,0.12)] bg-white/54 px-5 py-8 text-sm leading-7 text-[var(--muted-foreground)] xl:col-span-2">
                        当前筛选下没有文案。可以清空筛选，或换一个文件夹、标签组合。
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-5 pb-8">
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
              {typingState ? <TypingBlock title={typingState.title} text={typingState.text} /> : null}
              <div ref={scrollAnchorRef} />
            </div>
          )}
        </div>

        {analysisReady ? (
          <div className="bg-transparent px-4 py-4 lg:px-6">
            <div className="mx-auto max-w-7xl">
              <div className="relative">
                <Textarea
                  className="min-h-[132px] w-full resize-none rounded-[1.35rem] border border-[rgba(31,22,17,0.08)] bg-[rgba(255,250,245,0.78)] px-5 py-4 pb-20 pr-36 text-base leading-7 text-[var(--foreground)] outline-none shadow-[0_10px_24px_rgba(48,34,22,0.035)] focus:!border-[rgba(31,22,17,0.08)] focus:!ring-0 focus:!ring-offset-0 focus:!shadow-[0_18px_42px_rgba(48,34,22,0.08)] focus-visible:!outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0"
                  value={chatInput}
                  onChange={(event) => onChatInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      onSendChat()
                    }
                  }}
                  placeholder="发消息..."
                />
                <Button
                  className="absolute bottom-8 right-8"
                  onClick={onSendChat}
                  disabled={isStreaming || !chatInput.trim()}
                >
                  <SendHorizontal className="h-4 w-4" />
                  发送
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
