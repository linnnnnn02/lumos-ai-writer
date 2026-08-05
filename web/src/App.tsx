import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type {
  AiAnalysisResult,
  AiRewriteResult,
  AiRewriteSuggestion,
  AiReaderPreviewResult,
  AiUsage,
  AppliedWritingProfileContext,
  CreateFeedbackMemoryRequest,
  DraftQualitySnapshot,
  FeedbackMemoryDto,
  NoteLearningStatus,
  ProjectLength,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  SyncWorkspaceRequest,
  DraftFactSufficiencyResult,
  WritingEditEvidence,
  WritingPreference,
  WritingProfileRevisionDto,
  WritingProfileScope,
  WorkspaceProjectDto,
} from '@lumos-ai/shared'
import {
  appliedWritingProfileContextSchema,
  aiReaderPreviewResultSchema,
  draftQualitySnapshotSchema,
  isNoteReadyForLearning,
  normalizeNoteUrl,
} from '@lumos-ai/shared'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  FolderOpen,
  GripVertical,
  Highlighter,
  History,
  Home,
  Image,
  Layers3,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  MousePointer2,
  Paperclip,
  PenLine,
  Pin,
  Plus,
  Redo2,
  Search,
  Send,
  Sparkles,
  ThumbsUp,
  Trash2,
  Undo2,
  Users,
  WandSparkles,
  X,
} from '@/components/ui/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { LearnWorkspace } from '@/components/learn-workspace'
import { ConversationIntake } from '@/components/conversation-intake'
import { LibraryManager } from '@/components/library-manager'
import { DraftVersionHistory } from '@/components/draft-version-history'
import { DraftQualitySummary } from '@/components/draft-quality-summary'
import { WritingProfileDialog } from '@/components/writing-profile-dialog'
import { AuthStatus, type AuthCloudSummary } from '@/components/auth-status'
import {
  WorkflowHeaderNav,
  WorkflowStageNav,
  type WorkflowStepId,
  type WorkflowStepItem,
} from '@/components/workflow-header-nav'
import { LearningResult } from '@/features/workspace/analysis/learning-result'
import { useCloudLibrary } from '@/hooks/use-cloud-library'
import { useCloudWorkspace } from '@/hooks/use-cloud-workspace'
import {
  ApiClientError,
  analyzeReferences,
  buildWritingProfile,
  createFolder,
  createSnippet,
  deleteFolder,
  deleteFolderPermanently,
  deleteNote,
  deleteNotePermanently,
  deleteSnippet,
  emptyTrash,
  generateDraft,
  getWritingProfile,
  manageWritingPreference,
  rewriteDraft,
  previewDraftForReader,
  restoreFolder,
  restoreNote,
  updateFolder,
  updateNote,
  updateNoteLearningStatus,
  updateSnippet,
  upsertNote,
} from '@/lib/api-client'
import { getCurrentAccessToken } from '@/lib/supabase-browser'
import { loadLocalWorkspace, saveLocalWorkspace } from '@/lib/local-workspace'
import { recoverProjectConversationState } from '@/lib/conversation-recovery'
import { cn } from '@/lib/utils'
import { demoFolders, demoNotes, demoSnippets } from './lib/demo-data'
import { buildDemoAnalysis } from './lib/analysis'
import {
  ensureBaseDraftVersion,
  evolveDraftVersions,
  getAppliedWritingPreferenceIds,
  isDraftCompletionSnapshot,
  isSameDraftCopy,
  markDraftVersionFinalized,
  normalizeDraftVersions,
  type DraftCopy as InitialDraftCopy,
  type DraftVersionRecord,
} from './lib/draft-versions'
import { buildFallbackSelectionRewrite } from './lib/rewrite'

type ConversationStep = 'learn' | 'length' | 'plan' | 'rewrite' | 'reader'
type ConversationStage =
  | 'intake'
  | 'references'
  | 'draft'
  | 'review'
  | 'confirm'
  | 'finalized'
type WorkflowContextView = Extract<ConversationStage, 'intake' | 'references'>
type PageStep = 'workspace' | 'library' | ConversationStep
type AppNavigationHistoryState = {
  lumosNavigation: true
  view: 'workspace' | 'library' | 'conversation'
  projectId?: string
  conversationId?: string
  stage?: ConversationStage
  canReturnToWorkspace?: boolean
}

function isAppNavigationHistoryState(value: unknown): value is AppNavigationHistoryState {
  if (
    !isObject(value) ||
    value.lumosNavigation !== true ||
    (value.view !== 'workspace' && value.view !== 'library' && value.view !== 'conversation')
  ) {
    return false
  }

  if (value.view === 'conversation' && (typeof value.projectId !== 'string' || !value.projectId)) {
    return false
  }
  if (value.conversationId !== undefined && typeof value.conversationId !== 'string') return false
  if (value.stage !== undefined && !isConversationStage(value.stage)) return false
  return value.canReturnToWorkspace === undefined || typeof value.canReturnToWorkspace === 'boolean'
}

function parseAppNavigationHash(hash: string): AppNavigationHistoryState | null {
  const value = hash.replace(/^#/, '')
  if (value === 'projects') return { lumosNavigation: true, view: 'workspace' }
  if (value === 'library') return { lumosNavigation: true, view: 'library' }

  const parameters = new URLSearchParams(value)
  const projectId = parameters.get('project')?.trim() ?? ''
  if (!projectId) return null

  const conversationId = parameters.get('conversation')?.trim() || undefined
  const requestedStage = parameters.get('stage')
  const stage = requestedStage && isConversationStage(requestedStage) ? requestedStage : undefined

  return {
    lumosNavigation: true,
    view: 'conversation',
    projectId,
    conversationId,
    stage,
  }
}

function readAppNavigationHistory(state: unknown = window.history.state) {
  const hashNavigation = parseAppNavigationHash(window.location.hash)
  if (hashNavigation) {
    return {
      ...hashNavigation,
      canReturnToWorkspace:
        isAppNavigationHistoryState(state) &&
        getAppNavigationHash(state) === window.location.hash &&
        state.canReturnToWorkspace !== undefined
          ? state.canReturnToWorkspace
          : hashNavigation.canReturnToWorkspace,
    }
  }

  if (window.location.hash) {
    return { lumosNavigation: true, view: 'workspace' } satisfies AppNavigationHistoryState
  }

  return isAppNavigationHistoryState(state)
    ? state
    : ({ lumosNavigation: true, view: 'workspace' } satisfies AppNavigationHistoryState)
}

function getAppNavigationHash(state: AppNavigationHistoryState) {
  if (state.view === 'workspace') return '#projects'
  if (state.view === 'library') return '#library'

  const parameters = new URLSearchParams({ project: state.projectId ?? '' })
  if (state.conversationId) parameters.set('conversation', state.conversationId)
  if (state.stage) parameters.set('stage', state.stage)
  return `#${parameters.toString()}`
}

function writeAppNavigationHistory(
  mode: 'push' | 'replace',
  state: AppNavigationHistoryState,
) {
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](
    state,
    '',
    getAppNavigationHash(state),
  )
}

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

function isLegacyAnalysisErrorMessage(message: ChatMessage) {
  return (
    message.role === 'assistant' &&
    message.stage === 'setup' &&
    (message.title === '写作画像学习未完成' || message.title === 'AI 暂时不可用')
  )
}

type RewriteChatMessage = {
  id: string
  role: 'assistant' | 'user'
  selectedText?: string
  lines: string[]
  fieldId?: string
  instruction?: string
  suggestions?: Array<
    AiRewriteSuggestion & {
      id: string
      status: 'available' | 'accepted' | 'rejected' | 'superseded'
    }
  >
  recommendedIndex?: number
  appliedWritingProfile?: AppliedWritingProfileContext
}

function dedupeReaderSuggestionMessages(messages: RewriteChatMessage[]) {
  const seen = new Set<string>()

  return messages.filter((message) => {
    const isReaderSuggestionMessage =
      message.lines[0] === '带着读者预演建议回到编辑细调：' ||
      message.lines[0] === '已带回读者预演建议。'
    if (!isReaderSuggestionMessage) return true

    const signature = `${message.role}:${message.lines.join('\n')}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

type PlanAttachment = {
  id: string
  name: string
  kind: 'image' | 'document'
}

type WritingBrief = {
  objective: string
  requiredFacts: string
  boundaries: string
  instructions: string
}

type ReferenceRecommendation = {
  noteId: string
  reason: string
}

type ConversationRecord = {
  id: string
  title: string
  pinned?: boolean
  finalizedAt?: string
  finalDraft?: InitialDraftCopy
  step: ConversationStep
  workflowStage: ConversationStage
  writingRequest: string
  createdAt: string
  lastOpenedAt: string
  selectedItemIds: string[]
  chatMessages: ChatMessage[]
  analysisReady: boolean
  length: ProjectLength | null
  topic: string
  targetAudience: string
  writingBrief: WritingBrief
  updatedAt: string
}

type ProjectRecord = {
  id: string
  name: string
  folderId: string
  conversations: ConversationRecord[]
  activeConversationId: string
  updatedAt: string
}

const lengthOptions: Array<{
  value: ProjectLength
  title: string
  lines: string[]
}> = [
  {
    value: 'short',
    title: '短篇幅',
    lines: ['约 0-200 字', '适合快速表达一个判断或重点。'],
  },
  {
    value: 'medium',
    title: '中篇幅',
    lines: ['约 201-600 字', '适合把背景、事实和个人判断说完整。'],
  },
  {
    value: 'long',
    title: '长篇幅',
    lines: ['约 601-1000 字', '适合需要展开过程、对比或复杂信息的内容。'],
  },
]

const shellSteps: Array<{ id: PageStep; title: string }> = [
  { id: 'workspace', title: '项目' },
  { id: 'learn', title: '选择参考' },
  { id: 'plan', title: '准备初稿' },
  { id: 'rewrite', title: '编辑文案' },
  { id: 'reader', title: '读者预演' },
]

const conversationStageLabels: Record<ConversationStage, string> = {
  intake: '描述需求',
  references: '选择参考',
  draft: '准备初稿',
  review: '编辑文案',
  confirm: '读者预演',
  finalized: '已完成',
}

const initialProjects: ProjectRecord[] = [
  {
    id: 'project-ride',
    name: '深圳骑行路线长期项目',
    folderId: 'default-folder-beauty',
    activeConversationId: 'conversation-ride-main',
    updatedAt: '2026-04-30T21:30:00.000Z',
    conversations: [
      {
        id: 'conversation-ride-main',
        title: '深圳新手骑行路线种草文案',
        step: 'learn',
        workflowStage: 'references',
        writingRequest: '我想写一篇关于深圳市区骑行路线的种草笔记',
        selectedItemIds: [],
        chatMessages: [],
        analysisReady: false,
        length: null,
        topic: '我想写一篇关于深圳市区骑行路线的种草笔记',
        targetAudience: '想找周末路线、又怕路线太难的新手骑行用户',
        writingBrief: {
          objective: '让第一次骑行的人判断这条路线是否适合自己，并愿意收藏路线',
          requiredFacts: '路线距离、难度、沿途补给、最适合停留的一段',
          boundaries: '避免攻略站口吻，体验表达不夸满',
          instructions: '',
        },
        createdAt: '2026-04-30T21:30:00.000Z',
        lastOpenedAt: '2026-04-30T21:30:00.000Z',
        updatedAt: '2026-04-30T21:30:00.000Z',
      },
    ],
  },
  {
    id: 'project-tech',
    name: '数码产品种草项目',
    folderId: 'folder-tech',
    activeConversationId: 'conversation-tech-main',
    updatedAt: '2026-04-30T19:10:00.000Z',
    conversations: [
      {
        id: 'conversation-tech-main',
        title: '数码产品开箱真实体验文案',
        step: 'learn',
        workflowStage: 'references',
        writingRequest: '我想写一篇数码产品选购和开箱结合的种草内容',
        selectedItemIds: [],
        chatMessages: [],
        analysisReady: false,
        length: null,
        topic: '我想写一篇数码产品选购和开箱结合的种草内容',
        targetAudience: '会刷小红书找真实体验、不喜欢太广告腔的用户',
        writingBrief: {
          objective: '帮助读者判断产品是否适合自己的真实使用场景',
          requiredFacts: '真实使用场景、开箱体验、上手质感、购买判断',
          boundaries: '避免参数堆砌、过度承诺和广告腔',
          instructions: '',
        },
        createdAt: '2026-04-30T19:10:00.000Z',
        lastOpenedAt: '2026-04-30T19:10:00.000Z',
        updatedAt: '2026-04-30T19:10:00.000Z',
      },
    ],
  },
]

const defaultConversationTitle = '新的文案对话'
const noProjectFolderId = '__no_project_folder__'

function createEmptyConversation(options: { id?: string; now?: string } = {}): ConversationRecord {
  const now = options.now ?? new Date().toISOString()

  return {
    id: options.id ?? crypto.randomUUID(),
    title: defaultConversationTitle,
    step: 'learn',
    workflowStage: 'intake',
    writingRequest: '',
    selectedItemIds: [],
    chatMessages: [],
    analysisReady: false,
    length: null,
    topic: '',
    targetAudience: '',
    writingBrief: getDefaultWritingBrief(''),
    createdAt: now,
    lastOpenedAt: now,
    updatedAt: now,
  }
}

function buildConversationTitleFromPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized.length > 18 ? normalized.slice(0, 18) + '...' : normalized
}

function isDefaultConversationTitle(title: string) {
  return !title.trim() || title === defaultConversationTitle || title === '新的小红书文案对话'
}

const recommendationStopTerms = new Set([
  '一篇',
  '一个',
  '关于',
  '内容',
  '希望',
  '文案',
  '真实',
  '可以',
  '自己',
  '用户',
  '这个',
  '想写',
])

function buildReferenceRecommendations(
  writingRequest: string,
  notes: SavedNoteRecord[],
): ReferenceRecommendation[] {
  const normalizedRequest = writingRequest.replace(/\s+/g, '').trim()
  if (normalizedRequest.length < 4) return []

  const terms = Array.from(
    new Set(
      Array.from({ length: Math.max(0, normalizedRequest.length - 1) }, (_, index) =>
        normalizedRequest.slice(index, index + 2),
      ).filter((term) => !recommendationStopTerms.has(term) && !/[，。！？、：；,.!?;:]/.test(term)),
    ),
  )

  return notes
    .map((note) => {
      const source = `${note.title}${note.contentText}`.replace(/\s+/g, '')
      const matches = terms.filter((term) => source.includes(term))
      const titleMatches = matches.filter((term) => note.title.includes(term))
      const score = matches.length + titleMatches.length * 2

      return {
        noteId: note.id,
        score,
        matches: Array.from(new Set([...titleMatches, ...matches])).slice(0, 2),
      }
    })
    .filter((item) => item.score >= 2 && item.matches.length > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, 5)
    .map((item) => ({
      noteId: item.noteId,
      reason: `包含与本次需求相关的“${item.matches.join('、')}”，可作为表达和信息组织参考。`,
    }))
}

type DraftDragSelectionSegment = {
  fieldId: string
  startIndex: number
  endIndex: number
  text: string
}

type DraftDragSelection = {
  text: string
  rawText: string
  fieldId: string
  startIndex: number
  endIndex: number
  segments: DraftDragSelectionSegment[]
}

type DraftDropLanding = {
  id: string
  fieldId: string
  startIndex: number
  endIndex: number
}

type DraftMoveHistory = {
  redo: InitialDraftCopy[]
  undo: InitialDraftCopy[]
}

type DraftMovePrompt = {
  landing: DraftDropLanding
  text: string
  targetLabel: string
  position: {
    left: number
    top: number
  }
  beforeText: string
  afterText: string
}

type DraftPointerDrag = {
  x: number
  y: number
}

type DraftSelectionPointerStart = {
  fieldId: string
  x: number
  y: number
}

type DraftInsertionIndicator = {
  height: number
  left: number
  orientation: 'horizontal' | 'vertical'
  top: number
  width: number
}

type DraftDropTarget =
  | {
      indicator: DraftInsertionIndicator
      insertIndex: number
      kind: 'inline'
      targetFieldId: string
      targetLabel: string
    }
  | {
      indicator: DraftInsertionIndicator
      insertBodyIndex: number
      kind: 'paragraph'
      targetLabel: string
    }

type DraftBridgeMessage = {
  id: string
  movedText: string
  targetLabel: string
  beforeText: string
  afterText: string
  bridgeText: string
  status: 'generating' | 'done'
}

type RewriteSelectionCandidate = {
  text: string
  fieldId: string
  position: {
    left: number
    top: number
  }
}

type ReaderFeedbackTone = 'interest' | 'risk' | 'question' | 'suggestion'

type ReaderFeedbackBlock = {
  title: string
  label: string
  tone: ReaderFeedbackTone
  lines: string[]
}

type ReaderDraftAnnotation = {
  fieldId: string
  id: string
  label: string
  lines: string[]
  noteNumber: number
  startIndex: number
  text: string
  title: string
  tone: Extract<ReaderFeedbackTone, 'interest' | 'risk' | 'question'>
}

type ReaderPreviewFeedback = {
  annotations: ReaderDraftAnnotation[]
  blocks: ReaderFeedbackBlock[]
}

type ReaderPreviewRecord = {
  audience: string
  draft: InitialDraftCopy
  preview: AiReaderPreviewResult
}

type HydratedCloudWorkspace = {
  projects: ProjectRecord[]
  analysisByConversation: Record<string, AiAnalysisResult>
  draftCopyByConversation: Record<string, InitialDraftCopy>
  draftReadyByConversation: Record<string, boolean>
  draftVersionsByConversation: Record<string, DraftVersionRecord[]>
  currentDraftVersionIdByConversation: Record<string, string>
  rewriteMessagesByConversation: Record<string, RewriteChatMessage[]>
  planAttachmentsByConversation: Record<string, PlanAttachment[]>
  readerAudienceByConversation: Record<string, string>
  readerPreviewByConversation: Record<string, ReaderPreviewRecord>
  chatInputByConversation: Record<string, string>
  rewriteInputByConversation: Record<string, string>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasChangedFactMarker(beforeText: string, afterText: string) {
  const markerPattern =
    /(?:https?:\/\/\S+|@[\p{L}\p{N}_-]+|\d+(?:\.\d+)?(?:%|元|人|天|次|点|时|分|年|月|日|号|cm|mm|kg|g|ml)?)/gu
  const getMarkers = (text: string) => (text.match(markerPattern) ?? []).sort().join('|')
  return getMarkers(beforeText) !== getMarkers(afterText)
}

function buildWritingEditEvidence(
  input: CreateFeedbackMemoryRequest,
  contentMode: WritingEditEvidence['contentMode'],
): WritingEditEvidence | null {
  const context = input.context ?? {}
  const beforeText =
    typeof context.beforeText === 'string'
      ? context.beforeText
      : typeof context.selectedText === 'string'
        ? context.selectedText
        : ''
  const afterText = typeof context.afterText === 'string' ? context.afterText : input.content
  const preferenceAction = isObject(context.preferenceAction)
    ? context.preferenceAction.action
    : ''

  if (input.type === 'profile_correction') {
    const scope = context.scope === 'project' ? 'project' : 'account'
    const actionStatus =
      preferenceAction === 'disable'
        ? 'disabled'
        : preferenceAction === 'delete'
          ? 'rejected'
          : 'active'
    return {
      category: scope === 'account' ? 'long_term_habit' : 'pattern_preference',
      scope,
      contentMode,
      beforeText,
      afterText,
      confidence: 0.95,
      evidenceCount: 1,
      status: actionStatus,
    }
  }

  if (input.type === 'rewrite_preference') {
    return {
      category: 'draft_requirement',
      scope: 'draft',
      contentMode,
      beforeText,
      afterText,
      confidence: 0.95,
      evidenceCount: 1,
      status: 'active',
    }
  }

  if (
    ![
      'manual_edit',
      'accepted_rewrite',
      'rejected_rewrite',
      'final_choice',
      'ai_smell_feedback',
      'like',
      'dislike',
    ].includes(input.type)
  ) {
    return null
  }

  return {
    category:
      input.type === 'manual_edit' && hasChangedFactMarker(beforeText, afterText)
        ? 'fact_correction'
        : 'pattern_preference',
    scope: 'draft',
    contentMode,
    beforeText,
    afterText,
    confidence: input.type === 'accepted_rewrite' ? 0.5 : 0.35,
    evidenceCount: 1,
    status: 'candidate',
  }
}

function isConversationStage(value: unknown): value is ConversationStage {
  return (
    typeof value === 'string' &&
    ['intake', 'references', 'draft', 'review', 'confirm', 'finalized'].includes(value)
  )
}

function deriveLegacyConversationStage(input: {
  analysisReady: boolean
  finalizedAt?: string
  step: ConversationStep
  topic: string
}): ConversationStage {
  if (input.finalizedAt) return 'finalized'
  if (input.step === 'reader') return 'confirm'
  if (input.step === 'rewrite') return 'review'
  if (input.step === 'plan' || input.step === 'length') return 'draft'
  if (!input.topic.trim()) return 'intake'
  return input.analysisReady ? 'draft' : 'references'
}

function getConversationStage(conversation: ConversationRecord): ConversationStage {
  return isConversationStage(conversation.workflowStage)
    ? conversation.workflowStage
    : deriveLegacyConversationStage(conversation)
}

function isInitialDraftCopy(value: unknown): value is InitialDraftCopy {
  return (
    isObject(value) &&
    typeof value.title === 'string' &&
    Array.isArray(value.body) &&
    value.body.every((item) => typeof item === 'string')
  )
}

function getDefaultWritingBrief(topic: string): WritingBrief {
  if (topic.includes('骑行')) {
    return {
      objective: '帮助目标读者判断这条路线是否适合自己',
      requiredFacts: '路线距离、难度、沿途补给、最适合停留的一段',
      boundaries: '避免攻略站口吻，体验表达不夸满',
      instructions: '',
    }
  }

  if (topic.includes('数码')) {
    return {
      objective: '帮助目标读者判断产品是否适合自己的使用场景',
      requiredFacts: '真实使用场景、开箱体验、上手质感、购买判断',
      boundaries: '避免参数堆砌、过度承诺和广告腔',
      instructions: '',
    }
  }

  return {
    objective: '',
    requiredFacts: '',
    boundaries: '',
    instructions: '',
  }
}

function isWritingBrief(value: unknown): value is WritingBrief {
  return (
    isObject(value) &&
    typeof value.objective === 'string' &&
    typeof value.requiredFacts === 'string' &&
    typeof value.boundaries === 'string' &&
    typeof value.instructions === 'string'
  )
}

function isReaderPreviewRecord(value: unknown): value is ReaderPreviewRecord {
  return (
    isObject(value) &&
    typeof value.audience === 'string' &&
    isInitialDraftCopy(value.draft) &&
    aiReaderPreviewResultSchema.safeParse(value.preview).success
  )
}

function hydrateCloudWorkspace(cloudProjects: WorkspaceProjectDto[]): HydratedCloudWorkspace {
  const analysisByConversation: Record<string, AiAnalysisResult> = {}
  const draftCopyByConversation: Record<string, InitialDraftCopy> = {}
  const draftReadyByConversation: Record<string, boolean> = {}
  const draftVersionsByConversation: Record<string, DraftVersionRecord[]> = {}
  const currentDraftVersionIdByConversation: Record<string, string> = {}
  const rewriteMessagesByConversation: Record<string, RewriteChatMessage[]> = {}
  const planAttachmentsByConversation: Record<string, PlanAttachment[]> = {}
  const readerAudienceByConversation: Record<string, string> = {}
  const readerPreviewByConversation: Record<string, ReaderPreviewRecord> = {}
  const chatInputByConversation: Record<string, string> = {}
  const rewriteInputByConversation: Record<string, string> = {}

  const projects = cloudProjects.map((project): ProjectRecord => {
    const conversations = project.conversations.map((conversation): ConversationRecord => {
      const state = conversation.state
      if (isObject(state.analysis)) {
        analysisByConversation[conversation.id] = state.analysis as AiAnalysisResult
      }
      if (Array.isArray(state.rewriteMessages)) {
        rewriteMessagesByConversation[conversation.id] =
          state.rewriteMessages as RewriteChatMessage[]
      }
      if (Array.isArray(state.planAttachments)) {
        planAttachmentsByConversation[conversation.id] =
          state.planAttachments as PlanAttachment[]
      }
      if (typeof state.readerAudience === 'string') {
        readerAudienceByConversation[conversation.id] = state.readerAudience
      }
      if (isReaderPreviewRecord(state.readerPreview)) {
        readerPreviewByConversation[conversation.id] = state.readerPreview
      }
      if (typeof state.chatInput === 'string') {
        chatInputByConversation[conversation.id] = state.chatInput
      }
      if (typeof state.rewriteInput === 'string') {
        rewriteInputByConversation[conversation.id] = state.rewriteInput
      }

      const draft = conversation.draft
        ? { title: conversation.draft.title, body: conversation.draft.body }
        : null
      const draftVersionPreferenceSnapshots = isObject(state.draftVersionPreferenceSnapshots)
        ? state.draftVersionPreferenceSnapshots
        : {}
      const draftVersionQualitySnapshots = isObject(state.draftVersionQualitySnapshots)
        ? state.draftVersionQualitySnapshots
        : {}
      const draftVersionCompletionSnapshots = isObject(
        state.draftVersionCompletionSnapshots,
      )
        ? state.draftVersionCompletionSnapshots
        : {}
      let draftVersions = normalizeDraftVersions(
        (conversation.drafts ?? []).length > 0
          ? conversation.drafts
          : conversation.draft
            ? [conversation.draft]
            : [],
      ).map((version) => {
        const preferenceSnapshot = appliedWritingProfileContextSchema.safeParse(
          draftVersionPreferenceSnapshots[version.id],
        )
        const qualitySnapshot = draftQualitySnapshotSchema.safeParse(
          draftVersionQualitySnapshots[version.id],
        )
        const completionSnapshot = draftVersionCompletionSnapshots[version.id]
        return {
          ...version,
          ...(preferenceSnapshot.success
            ? { appliedWritingProfile: preferenceSnapshot.data }
            : {}),
          ...(isDraftCompletionSnapshot(completionSnapshot)
            ? { completionSnapshot }
            : {}),
          ...(qualitySnapshot.success ? { qualitySnapshot: qualitySnapshot.data } : {}),
        }
      })
      if (conversation.finalizedAt && conversation.draft?.id) {
        draftVersions = markDraftVersionFinalized(
          draftVersions,
          conversation.draft.id,
          conversation.finalizedAt,
        )
      }
      if (draftVersions.length > 0) {
        draftVersionsByConversation[conversation.id] = draftVersions
      }
      if (draft) {
        draftCopyByConversation[conversation.id] = draft
        draftReadyByConversation[conversation.id] = true
        currentDraftVersionIdByConversation[conversation.id] = conversation.draft?.id ?? ''
      }

      const chatMessages = conversation.messages
        .filter(
          (message) =>
            message.channel === 'analysis' &&
            (message.role === 'assistant' || message.role === 'user'),
        )
        .map((message) => ({
          ...(message.content as Omit<ChatMessage, 'id' | 'role'>),
          id: message.id,
          role: message.role as ChatMessage['role'],
        }))
        .filter(
          (message): message is ChatMessage =>
            Array.isArray(message.lines) &&
            ['setup', 'analysis', 'followup'].includes(message.stage),
        )
        .filter((message) => !isLegacyAnalysisErrorMessage(message))

      const finalDraft = isInitialDraftCopy(state.finalDraft) ? state.finalDraft : undefined
      const writingBrief = isWritingBrief(state.writingBrief)
        ? state.writingBrief
        : getDefaultWritingBrief(conversation.topic)
      const writingRequest =
        typeof state.writingRequest === 'string' ? state.writingRequest : conversation.topic

      return {
        id: conversation.id,
        title:
          isDefaultConversationTitle(conversation.title) && writingRequest.trim()
            ? buildConversationTitleFromPrompt(writingRequest)
            : conversation.title,
        pinned: conversation.pinned,
        finalizedAt: conversation.finalizedAt ?? undefined,
        finalDraft,
        step: conversation.step,
        workflowStage: isConversationStage(state.workflowStage)
          ? state.workflowStage
          : deriveLegacyConversationStage({
              analysisReady: conversation.analysisReady,
              finalizedAt: conversation.finalizedAt ?? undefined,
              step: conversation.step,
              topic: conversation.topic,
            }),
        writingRequest,
        createdAt: conversation.createdAt,
        lastOpenedAt: conversation.lastOpenedAt,
        selectedItemIds: conversation.selectedReferenceIds,
        chatMessages,
        analysisReady: conversation.analysisReady,
        length: conversation.length,
        topic: conversation.topic,
        targetAudience: conversation.targetAudience,
        writingBrief,
        updatedAt: conversation.updatedAt,
      }
    })

    return recoverProjectConversationState(
      {
        id: project.id,
        name: project.name,
        folderId: project.folderId ?? '',
        conversations,
        activeConversationId: project.activeConversationId ?? '',
        updatedAt: project.updatedAt,
      },
      createEmptyConversation,
    )
  })

  return {
    projects,
    analysisByConversation,
    draftCopyByConversation,
    draftReadyByConversation,
    draftVersionsByConversation,
    currentDraftVersionIdByConversation,
    rewriteMessagesByConversation,
    planAttachmentsByConversation,
    readerAudienceByConversation,
    readerPreviewByConversation,
    chatInputByConversation,
    rewriteInputByConversation,
  }
}

function getMessageCreatedAt(conversation: ConversationRecord, index: number) {
  const baseTime = Date.parse(conversation.createdAt || conversation.updatedAt)
  return new Date((Number.isNaN(baseTime) ? Date.now() : baseTime) + index).toISOString()
}

function buildWorkspaceSyncPayload(input: {
  projects: ProjectRecord[]
  analysisByConversation: Record<string, AiAnalysisResult>
  draftCopyByConversation: Record<string, InitialDraftCopy>
  draftReadyByConversation: Record<string, boolean>
  draftVersionsByConversation: Record<string, DraftVersionRecord[]>
  currentDraftVersionIdByConversation: Record<string, string>
  rewriteMessagesByConversation: Record<string, RewriteChatMessage[]>
  planAttachmentsByConversation: Record<string, PlanAttachment[]>
  readerAudienceByConversation: Record<string, string>
  readerPreviewByConversation: Record<string, ReaderPreviewRecord>
  chatInputByConversation: Record<string, string>
  rewriteInputByConversation: Record<string, string>
}): SyncWorkspaceRequest {
  return {
    projects: input.projects.map((project) => ({
      id: project.id,
      name: project.name,
      folderId: project.folderId || null,
      activeConversationId: project.activeConversationId || null,
      updatedAt: project.updatedAt,
      conversations: project.conversations.map((conversation) => {
        const versions = input.draftVersionsByConversation[conversation.id] ?? []
        const currentDraft = input.draftCopyByConversation[conversation.id]
        const draftVersionPreferenceSnapshots = Object.fromEntries(
          versions.flatMap((version) =>
            version.appliedWritingProfile
              ? [[version.id, version.appliedWritingProfile] as const]
              : [],
          ),
        )
        const draftVersionQualitySnapshots = Object.fromEntries(
          versions.flatMap((version) =>
            version.qualitySnapshot
              ? [[version.id, version.qualitySnapshot] as const]
              : [],
          ),
        )
        const draftVersionCompletionSnapshots = Object.fromEntries(
          versions.flatMap((version) =>
            version.completionSnapshot
              ? [[version.id, version.completionSnapshot] as const]
              : [],
          ),
        )
        const currentVersion =
          versions.find(
            (version) =>
              version.id === input.currentDraftVersionIdByConversation[conversation.id],
          ) ??
          [...versions].reverse().find(
            (version) => currentDraft && isSameDraftCopy(version, currentDraft),
          ) ??
          versions[versions.length - 1]

        return {
          id: conversation.id,
          title: conversation.title,
          step: conversation.step,
          pinned: Boolean(conversation.pinned),
          selectedReferenceIds: conversation.selectedItemIds,
          length: conversation.length,
          topic: conversation.topic,
          targetAudience: conversation.targetAudience,
          analysisReady: conversation.analysisReady,
          finalizedAt: conversation.finalizedAt ?? null,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          lastOpenedAt: conversation.lastOpenedAt,
          state: {
            ...(versions.length > 0
              ? {
                  currentDraftVersionId: input.draftReadyByConversation[conversation.id]
                    ? currentVersion?.id ?? null
                    : null,
                  ...(Object.keys(draftVersionPreferenceSnapshots).length > 0
                    ? { draftVersionPreferenceSnapshots }
                    : {}),
                  ...(Object.keys(draftVersionQualitySnapshots).length > 0
                    ? { draftVersionQualitySnapshots }
                    : {}),
                  ...(Object.keys(draftVersionCompletionSnapshots).length > 0
                    ? { draftVersionCompletionSnapshots }
                    : {}),
                }
              : {}),
            ...(input.analysisByConversation[conversation.id]
              ? { analysis: input.analysisByConversation[conversation.id] }
              : {}),
            rewriteMessages: input.rewriteMessagesByConversation[conversation.id] ?? [],
            planAttachments: input.planAttachmentsByConversation[conversation.id] ?? [],
            readerAudience: input.readerAudienceByConversation[conversation.id] ?? '',
            ...(input.readerPreviewByConversation[conversation.id]
              ? { readerPreview: input.readerPreviewByConversation[conversation.id] }
              : {}),
            ...(conversation.finalDraft ? { finalDraft: conversation.finalDraft } : {}),
            workflowStage: getConversationStage(conversation),
            writingRequest: conversation.writingRequest,
            writingBrief: conversation.writingBrief,
            chatInput: input.chatInputByConversation[conversation.id] ?? '',
            rewriteInput: input.rewriteInputByConversation[conversation.id] ?? '',
          },
          messages: conversation.chatMessages
            .filter((message) => !isLegacyAnalysisErrorMessage(message))
            .map((message, index) => {
              const { id, role, ...content } = message
              return {
                id,
                channel: 'analysis',
                role,
                content,
                createdAt: getMessageCreatedAt(conversation, index),
              }
            }),
          draft:
            input.draftReadyByConversation[conversation.id] && currentDraft
              ? {
                  ...currentDraft,
                  source: currentVersion?.source ?? 'working_draft',
                }
              : null,
          ...(versions.length > 0 ? { drafts: versions } : {}),
        }
      }),
    })),
  }
}

type LocalWorkspaceSnapshot = HydratedCloudWorkspace & {
  activeProjectId: string
}

type WorkspaceSaveStatus =
  | 'saved-local'
  | 'saving-local'
  | 'syncing-cloud'
  | 'synced-cloud'
  | 'save-error'

function normalizeLocalConversation(value: unknown): ConversationRecord | null {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.step !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.lastOpenedAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    typeof value.topic !== 'string' ||
    typeof value.targetAudience !== 'string' ||
    !Array.isArray(value.selectedItemIds) ||
    !Array.isArray(value.chatMessages)
  ) {
    return null
  }

  const writingRequest = typeof value.writingRequest === 'string' ? value.writingRequest : value.topic

  return {
    ...(value as unknown as ConversationRecord),
    title:
      isDefaultConversationTitle(value.title) && writingRequest.trim()
        ? buildConversationTitleFromPrompt(writingRequest)
        : value.title,
    workflowStage: isConversationStage(value.workflowStage)
      ? value.workflowStage
      : deriveLegacyConversationStage({
          analysisReady: value.analysisReady === true,
          finalizedAt: typeof value.finalizedAt === 'string' ? value.finalizedAt : undefined,
          step: ['learn', 'length', 'plan', 'rewrite', 'reader'].includes(value.step)
            ? (value.step as ConversationStep)
            : 'learn',
          topic: value.topic,
        }),
    writingRequest,
    selectedItemIds: value.selectedItemIds.filter((item): item is string => typeof item === 'string'),
    writingBrief: isWritingBrief(value.writingBrief)
      ? value.writingBrief
      : getDefaultWritingBrief(value.topic),
  }
}

function loadGuestWorkspaceSnapshot(): LocalWorkspaceSnapshot | null {
  const value = loadLocalWorkspace()
  if (!isObject(value) || !Array.isArray(value.projects)) return null

  const projects = value.projects
    .map((project): ProjectRecord | null => {
      if (
        !isObject(project) ||
        typeof project.id !== 'string' ||
        typeof project.name !== 'string' ||
        typeof project.folderId !== 'string' ||
        typeof project.activeConversationId !== 'string' ||
        typeof project.updatedAt !== 'string' ||
        !Array.isArray(project.conversations)
      ) {
        return null
      }

      const conversations = project.conversations
        .map(normalizeLocalConversation)
        .filter((conversation): conversation is ConversationRecord => Boolean(conversation))

      return recoverProjectConversationState(
        {
          id: project.id,
          name: project.name,
          folderId: project.folderId,
          activeConversationId: project.activeConversationId,
          updatedAt: project.updatedAt,
          conversations,
        },
        createEmptyConversation,
      )
    })
    .filter((project): project is ProjectRecord => Boolean(project))

  if (projects.length === 0 && value.projects.length > 0) return null

  const record = <T,>(candidate: unknown) =>
    (isObject(candidate) ? candidate : {}) as Record<string, T>

  const draftCopyByConversation = record<InitialDraftCopy>(value.draftCopyByConversation)
  const draftReadyByConversation = record<boolean>(value.draftReadyByConversation)
  const storedDraftVersions = record<unknown>(value.draftVersionsByConversation)
  const storedCurrentVersionIds = record<string>(value.currentDraftVersionIdByConversation)
  const draftVersionsByConversation: Record<string, DraftVersionRecord[]> = {}
  const currentDraftVersionIdByConversation: Record<string, string> = {}
  const conversationsById = new Map(
    projects.flatMap((project) =>
      project.conversations.map((conversation) => [conversation.id, conversation] as const),
    ),
  )

  for (const conversationId of new Set([
    ...Object.keys(storedDraftVersions),
    ...Object.keys(draftCopyByConversation),
  ])) {
    let versions = ensureBaseDraftVersion(
      normalizeDraftVersions(storedDraftVersions[conversationId]),
      draftCopyByConversation[conversationId],
    )
    if (versions.length === 0) continue

    if (draftReadyByConversation[conversationId]) {
      const currentVersionId =
        versions.find((version) => version.id === storedCurrentVersionIds[conversationId])?.id ??
        versions[versions.length - 1].id
      const finalizedAt = conversationsById.get(conversationId)?.finalizedAt
      if (finalizedAt) {
        versions = markDraftVersionFinalized(versions, currentVersionId, finalizedAt)
      }
      currentDraftVersionIdByConversation[conversationId] = currentVersionId
    }
    draftVersionsByConversation[conversationId] = versions
  }

  return {
    projects,
    activeProjectId:
      typeof value.activeProjectId === 'string' &&
      projects.some((project) => project.id === value.activeProjectId)
        ? value.activeProjectId
        : projects[0]?.id ?? '',
    analysisByConversation: record<AiAnalysisResult>(value.analysisByConversation),
    draftCopyByConversation,
    draftReadyByConversation,
    draftVersionsByConversation,
    currentDraftVersionIdByConversation,
    rewriteMessagesByConversation: record<RewriteChatMessage[]>(value.rewriteMessagesByConversation),
    planAttachmentsByConversation: record<PlanAttachment[]>(value.planAttachmentsByConversation),
    readerAudienceByConversation: record<string>(value.readerAudienceByConversation),
    readerPreviewByConversation: record<ReaderPreviewRecord>(value.readerPreviewByConversation),
    chatInputByConversation: record<string>(value.chatInputByConversation),
    rewriteInputByConversation: record<string>(value.rewriteInputByConversation),
  }
}

function getConversationSortTime(conversation: ConversationRecord) {
  return Date.parse(
    conversation.lastOpenedAt || conversation.updatedAt || conversation.createdAt,
  ) || 0
}

function sortConversationsForSidebar(conversations: ConversationRecord[]) {
  return [...conversations]
    .map((conversation, index) => ({ conversation, index }))
    .sort(
      (a, b) =>
        Number(Boolean(b.conversation.pinned)) - Number(Boolean(a.conversation.pinned)) ||
        getConversationSortTime(b.conversation) - getConversationSortTime(a.conversation) ||
        a.index - b.index,
    )
    .map(({ conversation }) => conversation)
}

function getConversationStep(conversation: ConversationRecord) {
  return conversation.step ?? 'learn'
}

function getStepForStage(stage: ConversationStage): ConversationStep {
  if (stage === 'intake' || stage === 'references') return 'learn'
  if (stage === 'draft') return 'plan'
  if (stage === 'review') return 'rewrite'
  return 'reader'
}

function getResumableStageFromAvailability(input: {
  conversation: ConversationRecord
  hasAnalysis: boolean
  hasDraft: boolean
}): ConversationStage {
  const { conversation, hasAnalysis, hasDraft } = input
  const hasWritingRequest = Boolean(
    conversation.writingRequest.trim() || conversation.topic.trim(),
  )
  if (!hasWritingRequest) return 'intake'
  if (!hasDraft) return hasAnalysis ? 'draft' : 'references'
  if (conversation.finalizedAt) return 'finalized'

  return getConversationStage(conversation) === 'confirm' ? 'confirm' : 'review'
}

function getSafeNavigationStage(input: {
  conversation: ConversationRecord
  hasAnalysis: boolean
  hasDraft: boolean
  requestedStage?: ConversationStage
}): ConversationStage {
  const { conversation, hasAnalysis, hasDraft, requestedStage } = input
  const resumableStage = getResumableStageFromAvailability({
    conversation,
    hasAnalysis,
    hasDraft,
  })

  if (!requestedStage) return resumableStage
  if (requestedStage === 'intake') return requestedStage
  if (requestedStage === 'references') {
    return conversation.writingRequest.trim() || conversation.topic.trim()
      ? requestedStage
      : 'intake'
  }
  if (requestedStage === 'draft') return hasAnalysis ? requestedStage : resumableStage
  if (!hasDraft) return resumableStage
  if (requestedStage === 'finalized' && !conversation.finalizedAt) return resumableStage
  return requestedStage
}

function buildAssistantReply(question: string, context: AiAnalysisResult) {
  if (question.includes('结构')) {
    return {
      stage: 'followup' as const,
      title: '结构补充',
      lines: [context.structure.join(' ')],
    }
  }

  if (question.includes('读者') || question.includes('停留')) {
    return {
      stage: 'followup' as const,
      title: '读者视角补充',
      lines: [context.readerView.join(' ')],
    }
  }

  if (question.includes('风格') || question.includes('语气') || question.includes('文风')) {
    return {
      stage: 'followup' as const,
      title: '文风补充',
      lines: [context.wording.join(' ')],
    }
  }

  const normalizedQuestion = question.replace(/[。！？!?]+$/, '')

  return {
    stage: 'followup' as const,
    title: '方向已记录',
    lines: [
      `明白，这次会以你刚才补充的方向为准：“${normalizedQuestion}”。后续分析会据此校准信息重点、语气和结构。`,
    ],
  }
}

function buildSetupReply(question: string) {
  if (question.includes('开头') || question.includes('首屏')) {
    return {
      stage: 'setup' as const,
      title: '分析重点已记录',
      lines: ['优先看开头、首屏停留和真人感。'],
    }
  }

  if (question.includes('结构') || question.includes('节奏')) {
    return {
      stage: 'setup' as const,
      title: '分析重点已记录',
      lines: ['优先拆结构、信息顺序和推进节奏。'],
    }
  }

  if (question.includes('语气') || question.includes('文风') || question.includes('口语')) {
    return {
      stage: 'setup' as const,
      title: '分析重点已记录',
      lines: ['优先看语气、口语感和真实表达。'],
    }
  }

  return {
    stage: 'setup' as const,
    title: '分析重点已记录',
    lines: ['已记录。选择参考文案后开始分析。'],
  }
}

function buildAnalysisChat(context: AiAnalysisResult): ChatMessage[] {
  return [
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      stage: 'analysis',
      lines: [context.coreJudgement],
      highlights: [
        {
          title: '开头',
          body: context.effectivePatterns[0],
        },
        {
          title: '中段',
          body: context.effectivePatterns[1],
        },
        {
          title: '收尾',
          body: context.effectivePatterns[2],
        },
      ],
      featuredSnippets: context.featuredSnippets,
      preferenceQuestion: context.preferenceQuestion,
    },
  ]
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '请求失败'
}

function normalizeDraftSentence(value: string) {
  const trimmed = value.trim().replace(/[。！？.!?]+$/, '')
  return trimmed ? `${trimmed}。` : ''
}

function getRequiredFactSummary(value: string) {
  return getRequiredFactStatements(value).join('；')
}

function getRequiredFactStatements(value: string) {
  return value
    .split(/[\n；;]+/)
    .map((item) => item.trim().replace(/[。！？.!?]+$/, ''))
    .filter(Boolean)
}

function buildInitialDraftCopy(input: {
  topic: string
  targetAudience: string
  length: ProjectLength
  writingBrief: WritingBrief
}): InitialDraftCopy {
  const topic =
    input.topic.replace(/^我想写一篇/, '').replace(/的?小红书文案$/, '').trim() ||
    '这次的真实体验'
  const audience = input.targetAudience.trim()
  const factSummary = getRequiredFactSummary(input.writingBrief.requiredFacts)
  const objective = input.writingBrief.objective
    .trim()
    .replace(/^让(?:目标)?读者/, '希望你')
    .replace(/^希望读者/, '希望你')
  const body = [
    normalizeDraftSentence(`如果你是${audience}，这篇先聊聊${topic}`),
    normalizeDraftSentence(`目前可以确认的是：${factSummary}`),
    normalizeDraftSentence(objective),
  ]

  if (input.length !== 'short') {
    body.splice(
      2,
      0,
      '真正需要判断的，不是一个笼统的“值不值得”，而是这些已确认的条件是否和你的需求对得上。',
    )
  }

  if (input.length === 'long') {
    body.splice(
      -1,
      0,
      '如果你的情况和上面不同，先不要照搬结论。把差异问清楚，再做选择会更稳妥。',
    )
  }

  return {
    title: topic,
    body: body.filter(Boolean),
  }
}

function getReaderExcerpt(value: string, maxLength = 34) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function formatDraftCopyForClipboard(draft: InitialDraftCopy) {
  return [draft.title, ...draft.body]
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n')
}

async function copyTextToClipboard(text: string) {
  if (!text.trim()) return false

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)

    try {
      if (document.execCommand('copy')) return true
    } finally {
      document.body.removeChild(textarea)
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      return await Promise.race([
        navigator.clipboard.writeText(text).then(() => true),
        new Promise<boolean>((resolve) => {
          window.setTimeout(() => resolve(false), 600)
        }),
      ])
    }
  } catch {
    return false
  }

  return false
}

function getReaderAnnotationRange(value: string, options?: { maxLength?: number; startRatio?: number }) {
  const characters = Array.from(value)
  const maxLength = options?.maxLength ?? 30
  const targetStartIndex = Math.floor(characters.length * (options?.startRatio ?? 0))
  const boundedStartIndex = Math.min(Math.max(targetStartIndex, 0), Math.max(characters.length - 1, 0))
  const leadingText = characters.slice(0, boundedStartIndex).join('')
  const remainingText = characters.slice(boundedStartIndex).join('')
  const match = remainingText.match(/[，。！？、：；\s]*/)
  const punctuationOffset = match?.[0].length ?? 0
  const startIndex = Math.min(leadingText.length + punctuationOffset, value.length)
  const text = Array.from(value.slice(startIndex)).slice(0, maxLength).join('').trim()

  return {
    startIndex,
    text,
  }
}

function getReaderDetailParagraphIndex(draft: InitialDraftCopy) {
  const matchedIndex = draft.body.findIndex(
    (paragraph, index) => index > 0 && /路线|做法|步骤|准备|开箱|使用|建议/.test(paragraph),
  )
  return matchedIndex >= 0 ? matchedIndex : Math.min(1, Math.max(draft.body.length - 1, 0))
}

function getReaderLongestParagraphIndex(draft: InitialDraftCopy) {
  if (draft.body.length === 0) return -1

  return draft.body.reduce(
    (longestIndex, paragraph, index) =>
      paragraph.length > draft.body[longestIndex].length ? index : longestIndex,
    0,
  )
}

function getReaderAnnotationFieldOrder(fieldId: string) {
  if (fieldId === 'title') return -1
  const match = fieldId.match(/^body-(\d+)$/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function buildReaderDraftAnnotations(input: {
  draft: InitialDraftCopy
  audience: string
  fallbackAudience: string
}): ReaderDraftAnnotation[] {
  const targetAudience = input.audience.trim() || input.fallbackAudience
  const annotations: Array<Omit<ReaderDraftAnnotation, 'noteNumber'>> = []
  const opening = input.draft.body[0] ?? ''
  const riskIndex = getReaderLongestParagraphIndex(input.draft)
  const questionIndex = getReaderDetailParagraphIndex(input.draft)
  const titleExcerpt = getReaderExcerpt(input.draft.title, 24)

  if (input.draft.title) {
    annotations.push({
      fieldId: 'title',
      id: 'reader-title-interest',
      label: '停留点',
      lines: [
        `标题「${titleExcerpt}」先把主题和适用人群说清楚，读者能快速判断这是不是和自己有关。`,
      ],
      startIndex: 0,
      text: input.draft.title,
      title: '标题判断点',
      tone: 'interest',
    })
  }

  if (opening) {
    const openingRange = getReaderAnnotationRange(opening, { maxLength: 30 })
    annotations.push({
      fieldId: 'body-0',
      id: 'reader-opening-interest',
      label: '停留点',
      lines: [
        `这句把「${getReaderExcerpt(openingRange.text, 26)}」放在前面，能让读者先进入具体场景，比直接讲结论更容易停住。`,
        `对「${targetAudience}」来说，越早看到自己熟悉的问题，越容易继续读。`,
      ],
      startIndex: openingRange.startIndex,
      text: openingRange.text,
      title: '开头停留点',
      tone: 'interest',
    })
  }

  if (riskIndex >= 0 && input.draft.body[riskIndex]) {
    const riskParagraph = input.draft.body[riskIndex]
    const riskRange = getReaderAnnotationRange(riskParagraph, { maxLength: 30 })
    annotations.push({
      fieldId: `body-${riskIndex}`,
      id: 'reader-risk',
      label: '划走风险',
      lines: [
        `读到「${getReaderExcerpt(riskRange.text, 26)}」附近，如果信息连续铺得太满，但没有小结或明确利益点，用户可能会直接划走退出。`,
        '这里适合补一个更明确的收益、距离、耗时或难度判断，让读者知道为什么要继续看。',
      ],
      startIndex: riskRange.startIndex,
      text: riskRange.text,
      title: '可能读不下去的位置',
      tone: 'risk',
    })
  }

  if (questionIndex >= 0 && input.draft.body[questionIndex]) {
    const questionRange = getReaderAnnotationRange(input.draft.body[questionIndex], {
      maxLength: 30,
      startRatio: questionIndex === riskIndex ? 0.5 : 0,
    })
    annotations.push({
      fieldId: `body-${questionIndex}`,
      id: 'reader-question',
      label: '未知信息',
      lines: [
        `看到「${getReaderExcerpt(questionRange.text, 26)}」时，我会想知道有没有更具体的条件、成本、耗时或适用边界。`,
        `如果我是「${targetAudience}」，我还会想确认这件事是不是低门槛、可复制、不会踩坑。`,
      ],
      startIndex: questionRange.startIndex,
      text: questionRange.text,
      title: '读者会冒出的疑问',
      tone: 'question',
    })
  }

  return annotations
    .filter((annotation) => annotation.text)
    .sort(
      (first, second) =>
        getReaderAnnotationFieldOrder(first.fieldId) - getReaderAnnotationFieldOrder(second.fieldId) ||
        first.startIndex - second.startIndex,
    )
    .map((annotation, index) => ({
      ...annotation,
      noteNumber: index + 1,
    }))
}

function buildReaderPreviewFeedback(input: {
  draft: InitialDraftCopy
  audience: string
  fallbackAudience: string
}): ReaderPreviewFeedback {
  const annotations = buildReaderDraftAnnotations(input)

  return {
    annotations,
    blocks: [
      {
        title: '优先修改建议',
        label: '建议',
        tone: 'suggestion',
        lines: [
          '把最能让读者停下来的具体细节前置到前两段，先给场景和结果，再展开过程。',
          '把偏概括的句子改成可感知信息，例如时间、地点、步骤、对比、真实感受。',
          '结尾可以补一个更自然的互动问题，让读者知道自己可以评论什么，而不是只看到泛泛的号召。',
        ],
      },
    ],
  }
}

function buildAiReaderPreviewFeedback(
  preview: AiReaderPreviewResult,
  draft: InitialDraftCopy,
): ReaderPreviewFeedback {
  const priorityLabels = {
    high: '高优先级',
    medium: '中优先级',
    low: '低优先级',
  } as const
  const annotations = preview.annotations
    .map((annotation) => {
      const fieldValue = annotation.fieldId === 'title'
        ? draft.title
        : draft.body[Number(annotation.fieldId.replace('body-', ''))] ?? ''
      return {
        fieldId: annotation.fieldId,
        id: annotation.id,
        label: annotation.label,
        lines: [
          annotation.reaction,
          `${annotation.reason}（预演置信度 ${Math.round(annotation.confidence * 100)}%）`,
        ],
        noteNumber: 0,
        startIndex: fieldValue.indexOf(annotation.quote),
        text: annotation.quote,
        title: annotation.title,
        tone: annotation.tone,
      } satisfies ReaderDraftAnnotation
    })
    .filter((annotation) => annotation.startIndex >= 0)
    .sort(
      (first, second) =>
        getReaderAnnotationFieldOrder(first.fieldId) - getReaderAnnotationFieldOrder(second.fieldId) ||
        first.startIndex - second.startIndex,
    )
    .map((annotation, index) => ({
      ...annotation,
      noteNumber: index + 1,
    }))

  return {
    annotations,
    blocks: [
      {
        title: preview.suggestions.length > 0 ? '优先修改建议' : '暂无安全修改建议',
        label: '建议',
        tone: 'suggestion',
        lines:
          preview.suggestions.length > 0
            ? preview.suggestions.map(
                (suggestion) =>
                  `${priorityLabels[suggestion.priority]}：${suggestion.instruction} ${suggestion.rationale}`,
              )
            : ['本次没有足够的原文依据生成修改建议，请先参考上方批注。'],
      },
    ],
  }
}

function getReaderDraftFieldValue(draft: InitialDraftCopy, fieldId: string) {
  if (fieldId === 'title') return draft.title
  const match = fieldId.match(/^body-(\d+)$/)
  return match ? draft.body[Number(match[1])] ?? '' : ''
}

function getRenderableReaderAnnotations(
  annotations: ReaderDraftAnnotation[],
  draft: InitialDraftCopy,
) {
  const ranges = annotations
    .map((annotation) => {
      const fieldValue = getReaderDraftFieldValue(draft, annotation.fieldId)
      const startIndex =
        fieldValue.slice(annotation.startIndex, annotation.startIndex + annotation.text.length) ===
        annotation.text
          ? annotation.startIndex
          : fieldValue.indexOf(annotation.text)

      return startIndex >= 0
        ? {
            ...annotation,
            endIndex: startIndex + annotation.text.length,
            startIndex,
          }
        : null
    })
    .filter((annotation): annotation is ReaderDraftAnnotation & { endIndex: number } =>
      Boolean(annotation && annotation.endIndex > annotation.startIndex),
    )
    .sort(
      (first, second) =>
        getReaderAnnotationFieldOrder(first.fieldId) -
          getReaderAnnotationFieldOrder(second.fieldId) ||
        first.startIndex - second.startIndex,
    )
    .reduce<Array<ReaderDraftAnnotation & { endIndex: number }>>((visible, annotation) => {
      const previous = visible[visible.length - 1]
      if (
        previous &&
        previous.fieldId === annotation.fieldId &&
        annotation.startIndex < previous.endIndex
      ) {
        return visible
      }
      return [...visible, annotation]
    }, [])

  return ranges.map(
    (annotation, index): ReaderDraftAnnotation => ({
      ...annotation,
      noteNumber: index + 1,
    }),
  )
}

function ShellStepPills({ step }: { step: PageStep }) {
  return (
    <div className="hidden items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] p-1 shadow-none lg:flex">
      {shellSteps.map((item) => (
        <span
          key={item.id}
          className={
            item.id === step
              ? 'ui-step-pill ui-step-pill-active rounded-full bg-[var(--foreground)] px-3 py-1.5 text-xs font-semibold text-white'
              : 'ui-step-pill rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)]'
          }
        >
          {item.title}
        </span>
      ))}
    </div>
  )
}

function App() {
  const [initialNavigationTarget] = useState(readAppNavigationHistory)
  const [restoredGuestWorkspace] = useState(loadGuestWorkspaceSnapshot)
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(
    initialNavigationTarget.view === 'workspace',
  )
  const [isLibraryOpen, setIsLibraryOpen] = useState(initialNavigationTarget.view === 'library')
  const [isConversationSidebarOpen, setIsConversationSidebarOpen] = useState(false)
  const [workflowContextView, setWorkflowContextView] = useState<WorkflowContextView | null>(null)
  const [navigationStageOverride, setNavigationStageOverride] = useState<ConversationStage | null>(
    null,
  )
  const [pendingNavigationTarget, setPendingNavigationTarget] =
    useState<AppNavigationHistoryState | null>(initialNavigationTarget)
  const [referenceSelectionDraftByConversation, setReferenceSelectionDraftByConversation] = useState<
    Record<string, string[]>
  >({})
  const [projects, setProjects] = useState<ProjectRecord[]>(
    restoredGuestWorkspace?.projects ?? initialProjects,
  )
  const [activeProjectId, setActiveProjectId] = useState(
    restoredGuestWorkspace?.activeProjectId ?? initialProjects[0].id,
  )
  const [chatInputByConversation, setChatInputByConversation] = useState<Record<string, string>>(
    restoredGuestWorkspace?.chatInputByConversation ?? {},
  )
  const [writingRequestDraftByConversation, setWritingRequestDraftByConversation] = useState<
    Record<string, string>
  >({})
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [analysisPendingConversationId, setAnalysisPendingConversationId] = useState('')
  const [analysisWaitStartedAt, setAnalysisWaitStartedAt] = useState<number | null>(null)
  const [draftWaitStartedAt, setDraftWaitStartedAt] = useState<number | null>(null)
  const [aiWaitTick, setAiWaitTick] = useState(Date.now())
  const [analysisErrorByConversation, setAnalysisErrorByConversation] = useState<
    Record<string, string>
  >({})
  const [, setAnalysisUsageByConversation] = useState<
    Record<string, AiUsage | null>
  >({})
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectFolderId, setNewProjectFolderId] = useState(noProjectFolderId)
  const [showCreateProjectCard, setShowCreateProjectCard] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [renamingProjectId, setRenamingProjectId] = useState('')
  const [renamingProjectName, setRenamingProjectName] = useState('')
  const [projectPendingDeleteId, setProjectPendingDeleteId] = useState('')
  const [selectedRewriteText, setSelectedRewriteText] = useState('')
  const [selectedRewriteFieldId, setSelectedRewriteFieldId] = useState('')
  const [rewriteSelectionCandidate, setRewriteSelectionCandidate] =
    useState<RewriteSelectionCandidate | null>(null)
  const [rewriteInputByConversation, setRewriteInputByConversation] = useState<
    Record<string, string>
  >(restoredGuestWorkspace?.rewriteInputByConversation ?? {})
  const [rewriteMessagesByConversation, setRewriteMessagesByConversation] = useState<
    Record<string, RewriteChatMessage[]>
  >(restoredGuestWorkspace?.rewriteMessagesByConversation ?? {})
  const [rewritePendingConversationId, setRewritePendingConversationId] = useState('')
  const [, setRewriteUsageByConversation] = useState<Record<string, AiUsage | null>>({})
  const [planAttachmentsByConversation, setPlanAttachmentsByConversation] = useState<
    Record<string, PlanAttachment[]>
  >(restoredGuestWorkspace?.planAttachmentsByConversation ?? {})
  const [readerAudienceByConversation, setReaderAudienceByConversation] = useState<
    Record<string, string>
  >(restoredGuestWorkspace?.readerAudienceByConversation ?? {})
  const [readerPreviewByConversation, setReaderPreviewByConversation] = useState<
    Record<string, ReaderPreviewRecord>
  >(restoredGuestWorkspace?.readerPreviewByConversation ?? {})
  const [readerPreviewPendingConversationId, setReaderPreviewPendingConversationId] = useState('')
  const [readerPreviewErrorByConversation, setReaderPreviewErrorByConversation] = useState<
    Record<string, string>
  >({})
  const [, setReaderPreviewUsageByConversation] = useState<
    Record<string, AiUsage | null>
  >({})
  const [isReaderAudienceOpen, setIsReaderAudienceOpen] = useState(false)
  const [isReaderPreviewVisible, setIsReaderPreviewVisible] = useState(false)
  const [activeReaderAnnotationId, setActiveReaderAnnotationId] = useState('')
  const [finalCopyToast, setFinalCopyToast] = useState('')
  const [dismissedCloudWorkspaceErrorVersion, setDismissedCloudWorkspaceErrorVersion] =
    useState(0)
  const [workspaceSyncRetryVersion, setWorkspaceSyncRetryVersion] = useState(0)
  const [draftReadyByConversation, setDraftReadyByConversation] = useState<Record<string, boolean>>(
    restoredGuestWorkspace?.draftReadyByConversation ?? {},
  )
  const [draftCopyByConversation, setDraftCopyByConversation] = useState<
    Record<string, InitialDraftCopy>
  >(restoredGuestWorkspace?.draftCopyByConversation ?? {})
  const [draftVersionsByConversation, setDraftVersionsByConversation] = useState<
    Record<string, DraftVersionRecord[]>
  >(restoredGuestWorkspace?.draftVersionsByConversation ?? {})
  const [currentDraftVersionIdByConversation, setCurrentDraftVersionIdByConversation] = useState<
    Record<string, string>
  >(restoredGuestWorkspace?.currentDraftVersionIdByConversation ?? {})
  const [isDraftVersionHistoryOpen, setIsDraftVersionHistoryOpen] = useState(false)
  const [isWritingProfileOpen, setIsWritingProfileOpen] = useState(false)
  const [writingProfileContext, setWritingProfileContext] = useState<{
    accountProfile: WritingProfileRevisionDto | null
    projectProfile: WritingProfileRevisionDto | null
  }>({ accountProfile: null, projectProfile: null })
  const [isWritingProfileLoading, setIsWritingProfileLoading] = useState(false)
  const [isWritingProfileSaving, setIsWritingProfileSaving] = useState(false)
  const [writingProfileError, setWritingProfileError] = useState('')
  const [isWritingBriefOpen, setIsWritingBriefOpen] = useState(false)
  const [, setDraftUsageByConversation] = useState<
    Record<string, AiUsage | null>
  >({})
  const [draftGeneratingConversationId, setDraftGeneratingConversationId] = useState('')
  const [draftGenerationErrorByConversation, setDraftGenerationErrorByConversation] = useState<
    Record<string, string>
  >({})
  const [draftFactGapByConversation, setDraftFactGapByConversation] = useState<
    Record<string, DraftFactSufficiencyResult>
  >({})
  const [draftDragSelection, setDraftDragSelection] = useState<DraftDragSelection | null>(null)
  const [draftPointerDrag, setDraftPointerDrag] = useState<DraftPointerDrag | null>(null)
  const [draftDropTarget, setDraftDropTarget] = useState<DraftDropTarget | null>(null)
  const [draftDropLanding, setDraftDropLanding] = useState<DraftDropLanding | null>(null)
  const [draftMovePrompt, setDraftMovePrompt] = useState<DraftMovePrompt | null>(null)
  const cloudLibrary = useCloudLibrary()
  const {
    status: cloudWorkspaceStatus,
    userId: cloudWorkspaceUserId,
    projects: cloudWorkspaceProjects,
    feedbackMemories: cloudFeedbackMemories,
    error: cloudWorkspaceError,
    errorVersion: cloudWorkspaceErrorVersion,
    save: saveCloudWorkspace,
    remember: rememberCloudFeedback,
    refresh: refreshCloudWorkspace,
  } = useCloudWorkspace()
  const [analysisByConversation, setAnalysisByConversation] = useState<
    Record<string, AiAnalysisResult>
  >(restoredGuestWorkspace?.analysisByConversation ?? {})
  const [workspaceSaveStatus, setWorkspaceSaveStatus] = useState<WorkspaceSaveStatus>(
    cloudWorkspaceStatus === 'guest' ? 'saved-local' : 'synced-cloud',
  )
  const [workspaceSavedAt, setWorkspaceSavedAt] = useState('')
  const [draftMoveHistoryByConversation, setDraftMoveHistoryByConversation] = useState<
    Record<string, DraftMoveHistory>
  >({})
  const [draftBridgeMessagesByConversation, setDraftBridgeMessagesByConversation] = useState<
    Record<string, DraftBridgeMessage[]>
  >({})
  const [openSidebarConversationMenuId, setOpenSidebarConversationMenuId] = useState('')
  const [sidebarConversationMenuPosition, setSidebarConversationMenuPosition] = useState({
    left: 0,
    top: 0,
  })
  const [renamingSidebarConversationId, setRenamingSidebarConversationId] = useState('')
  const [draftSidebarConversationTitle, setDraftSidebarConversationTitle] = useState('')
  const sidebarConversationMenuButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const readerCommentRefs = useRef(new Map<string, HTMLElement>())
  const readerAudiencePopoverRef = useRef<HTMLDivElement | null>(null)
  const finalCopyToastTimerRef = useRef<number | null>(null)
  const projectDialogReturnFocusRef = useRef<HTMLElement | null>(null)
  const rewriteInputRef = useRef<HTMLTextAreaElement | null>(null)
  const draftMovePromptToolbarRef = useRef<HTMLDivElement | null>(null)
  const draftSelectionCaptureTimerRef = useRef<number | null>(null)
  const draftSelectionContainerRef = useRef<HTMLElement | null>(null)
  const draftSelectionPointerStartRef = useRef<DraftSelectionPointerStart | null>(null)
  const draftDropLandingTimerRef = useRef<number | null>(null)
  const draftBridgeGenerationTimerRef = useRef<number | null>(null)
  const workspaceSyncTimerRef = useRef<number | null>(null)
  const workspaceSyncRetryTimerRef = useRef<number | null>(null)
  const workspaceSyncRetryAttemptRef = useRef(0)
  const localWorkspaceSaveTimerRef = useRef<number | null>(null)
  const localWorkspaceCommitTimerRef = useRef<number | null>(null)
  const workspaceSyncBaselineRef = useRef('')
  const cloudWorkspaceHydratedUserIdRef = useRef('')
  const pendingNavigationTargetRef = useRef<AppNavigationHistoryState | null>(
    initialNavigationTarget,
  )
  const skipNextWorkspaceAutosaveRef = useRef(false)
  const workspaceSaveQueueRef = useRef(Promise.resolve())
  const recentFeedbackMemoriesRef = useRef<FeedbackMemoryDto[]>([])
  const draftVersionsRef = useRef(draftVersionsByConversation)

  const storedActiveProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? initialProjects[0],
    [activeProjectId, projects],
  )
  const activeProject = useMemo(
    () => recoverProjectConversationState(storedActiveProject, createEmptyConversation),
    [storedActiveProject],
  )
  const isUsingCloudLibrary = cloudLibrary.status !== 'guest'
  const libraryFolders = isUsingCloudLibrary ? cloudLibrary.folders : demoFolders
  const libraryNotes = isUsingCloudLibrary ? cloudLibrary.notes : demoNotes
  const librarySnippets = isUsingCloudLibrary ? cloudLibrary.snippets : demoSnippets
  const libraryTrashGroups = isUsingCloudLibrary ? cloudLibrary.trashGroups : []
  const libraryStatus = cloudLibrary.status === 'guest' ? 'demo' : cloudLibrary.status
  const libraryError = isUsingCloudLibrary ? cloudLibrary.error : ''
  const hasCloudLibraryData = cloudLibrary.status === 'ready' || Boolean(cloudLibrary.refreshedAt)
  const authCloudSummary: AuthCloudSummary | undefined = isUsingCloudLibrary
    ? {
        status:
          cloudLibrary.status === 'ready'
            ? 'ready'
            : cloudLibrary.status === 'error'
              ? 'error'
              : 'checking',
        user: cloudLibrary.user,
        counts: hasCloudLibraryData
          ? {
              folders: cloudLibrary.folders.length,
              notes: cloudLibrary.notes.length,
              snippets: cloudLibrary.snippets.length,
            }
          : null,
      }
    : undefined
  const learningReadyNotes = useMemo(
    () => libraryNotes.filter(isNoteReadyForLearning),
    [libraryNotes],
  )
  const learningReadyNoteUrls = useMemo(
    () => new Set(learningReadyNotes.map((note) => normalizeNoteUrl(note.sourceUrl))),
    [learningReadyNotes],
  )
  const learningReadySnippets = useMemo(
    () =>
      librarySnippets.filter((snippet) =>
        learningReadyNoteUrls.has(normalizeNoteUrl(snippet.noteUrl)),
      ),
    [learningReadyNoteUrls, librarySnippets],
  )
  const nonLearningNoteCount = libraryNotes.length - learningReadyNotes.length
  const effectiveNewProjectFolderId = libraryFolders.some(
    (folder) => folder.id === newProjectFolderId,
  )
    ? newProjectFolderId
    : noProjectFolderId

  function getResumableConversationStage(conversation: ConversationRecord): ConversationStage {
    return getResumableStageFromAvailability({
      conversation,
      hasAnalysis:
        conversation.analysisReady && Boolean(analysisByConversation[conversation.id]),
      hasDraft:
        Boolean(draftReadyByConversation[conversation.id]) &&
        Boolean(draftCopyByConversation[conversation.id]),
    })
  }

  const activeConversation = useMemo(
    () =>
      activeProject.conversations.find(
        (conversation) => conversation.id === activeProject.activeConversationId,
      ) ?? activeProject.conversations[0],
    [activeProject],
  )
  const activeConversationRouteRef = useRef({
    projectId: activeProject.id,
    conversationId: activeConversation.id,
  })
  const activeConversationStage = getResumableConversationStage(activeConversation)
  const visibleConversationStage =
    navigationStageOverride ?? workflowContextView ?? activeConversationStage
  const chatInput = chatInputByConversation[activeConversation.id] ?? ''
  const writingRequestDraft =
    writingRequestDraftByConversation[activeConversation.id] ?? activeConversation.writingRequest
  const rewriteChatInput = rewriteInputByConversation[activeConversation.id] ?? ''

  function setChatInput(value: string) {
    setChatInputByConversation((current) => ({
      ...current,
      [activeConversation.id]: value,
    }))
  }

  function setRewriteChatInput(value: string) {
    setRewriteInputByConversation((current) => ({
      ...current,
      [activeConversation.id]: value,
    }))
  }

  useEffect(() => {
    activeConversationRouteRef.current = {
      projectId: activeProject.id,
      conversationId: activeConversation.id,
    }
  }, [activeConversation.id, activeProject.id])

  const workspaceSyncPayload = useMemo(
    () =>
      buildWorkspaceSyncPayload({
        projects,
        analysisByConversation,
        draftCopyByConversation,
        draftReadyByConversation,
        draftVersionsByConversation,
        currentDraftVersionIdByConversation,
        rewriteMessagesByConversation,
        planAttachmentsByConversation,
        readerAudienceByConversation,
        readerPreviewByConversation,
        chatInputByConversation,
        rewriteInputByConversation,
      }),
    [
      analysisByConversation,
      draftCopyByConversation,
      draftReadyByConversation,
      draftVersionsByConversation,
      currentDraftVersionIdByConversation,
      planAttachmentsByConversation,
      projects,
      readerAudienceByConversation,
      readerPreviewByConversation,
      chatInputByConversation,
      rewriteInputByConversation,
      rewriteMessagesByConversation,
    ],
  )
  const workspaceSyncSerialized = useMemo(
    () => JSON.stringify(workspaceSyncPayload),
    [workspaceSyncPayload],
  )

  const step: PageStep = isLibraryOpen
    ? 'library'
    : isWorkspaceOpen
      ? 'workspace'
      : getStepForStage(visibleConversationStage)
  const isCloudWorkspaceConnecting =
    cloudWorkspaceStatus === 'initializing' || cloudWorkspaceStatus === 'loading'
  const isCloudWorkspaceLoadError = cloudWorkspaceStatus === 'error'
  const workspaceSaveLabel = isCloudWorkspaceLoadError
    ? '云端连接失败'
    : isCloudWorkspaceConnecting
      ? '正在连接云端'
    : workspaceSaveStatus === 'saving-local'
      ? '正在保存到本机'
      : workspaceSaveStatus === 'saved-local'
        ? '已保存在本机'
        : workspaceSaveStatus === 'syncing-cloud'
          ? '正在同步'
          : workspaceSaveStatus === 'save-error'
            ? '保存失败，将自动重试'
            : '已同步'
  const WorkspaceSaveIcon =
    isCloudWorkspaceLoadError || workspaceSaveStatus === 'save-error'
      ? AlertTriangle
      : isCloudWorkspaceConnecting ||
    workspaceSaveStatus === 'saving-local' ||
    workspaceSaveStatus === 'syncing-cloud'
      ? Loader2
      : CheckCircle2
  const isDraftPointerDragging = Boolean(draftPointerDrag)

  function queueNavigationTarget(navigationState: AppNavigationHistoryState) {
    pendingNavigationTargetRef.current = navigationState
    setPendingNavigationTarget(navigationState)
  }

  function showConversationRoute(
    stage: ConversationStage,
    options: {
      mode?: 'push' | 'replace'
      projectId?: string
      conversationId?: string
    } = {},
  ) {
    const projectId = options.projectId ?? activeProject.id
    const conversationId = options.conversationId ?? activeConversation.id

    activeConversationRouteRef.current = { projectId, conversationId }
    pendingNavigationTargetRef.current = null
    setPendingNavigationTarget(null)
    setNavigationStageOverride(stage)
    setWorkflowContextView(stage === 'intake' || stage === 'references' ? stage : null)
    setIsReaderPreviewVisible(stage === 'confirm')
    setIsReaderAudienceOpen(false)
    setActiveReaderAnnotationId('')
    setIsWorkspaceOpen(false)
    setIsLibraryOpen(false)
    writeAppNavigationHistory(options.mode ?? 'push', {
      lumosNavigation: true,
      view: 'conversation',
      projectId,
      conversationId,
      stage,
      canReturnToWorkspace: true,
    })
  }

  const updateSidebarConversationMenuPosition = useCallback((conversationId: string) => {
    const button = sidebarConversationMenuButtonRefs.current.get(conversationId)
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

    setSidebarConversationMenuPosition({ left, top })
  }, [])

  useEffect(() => {
    const currentNavigation = readAppNavigationHistory()
    writeAppNavigationHistory('replace', currentNavigation)

    const handleLocationNavigation = (event?: PopStateEvent) => {
      const navigationState = readAppNavigationHistory(event?.state)
      setWorkflowContextView(null)
      setNavigationStageOverride(null)
      setIsConversationSidebarOpen(false)
      setIsReaderPreviewVisible(false)
      setIsReaderAudienceOpen(false)
      setActiveReaderAnnotationId('')
      pendingNavigationTargetRef.current = navigationState
      setPendingNavigationTarget(navigationState)
    }

    const handleHashChange = () => handleLocationNavigation()
    window.addEventListener('popstate', handleLocationNavigation)
    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('popstate', handleLocationNavigation)
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  useEffect(() => {
    if (!pendingNavigationTarget) return

    const navigationState = pendingNavigationTarget
    if (navigationState.view === 'conversation') {
      if (cloudWorkspaceStatus === 'initializing' || cloudWorkspaceStatus === 'loading') return
      if (
        cloudWorkspaceStatus === 'ready' &&
        cloudWorkspaceHydratedUserIdRef.current !== cloudWorkspaceUserId
      ) {
        return
      }
      if (cloudWorkspaceStatus === 'guest' && cloudWorkspaceHydratedUserIdRef.current) return
    }

    const resolutionTimer = window.setTimeout(() => {
      if (navigationState.view === 'workspace') {
        setNavigationStageOverride(null)
        setWorkflowContextView(null)
        setIsWorkspaceOpen(true)
        setIsLibraryOpen(false)
        pendingNavigationTargetRef.current = null
        setPendingNavigationTarget(null)
        return
      }

      if (navigationState.view === 'library') {
        setNavigationStageOverride(null)
        setWorkflowContextView(null)
        setIsWorkspaceOpen(false)
        setIsLibraryOpen(true)
        pendingNavigationTargetRef.current = null
        setPendingNavigationTarget(null)
        return
      }

      const project = projects.find((item) => item.id === navigationState.projectId)
      if (!project) {
        const fallbackState: AppNavigationHistoryState = {
          lumosNavigation: true,
          view: 'workspace',
        }
        setNavigationStageOverride(null)
        setWorkflowContextView(null)
        setIsWorkspaceOpen(true)
        setIsLibraryOpen(false)
        pendingNavigationTargetRef.current = null
        setPendingNavigationTarget(null)
        writeAppNavigationHistory('replace', fallbackState)
        return
      }

      const conversation =
        project.conversations.find((item) => item.id === navigationState.conversationId) ??
        project.conversations.find((item) => item.id === project.activeConversationId) ??
        project.conversations[0]
      if (!conversation) {
        setNavigationStageOverride(null)
        setWorkflowContextView(null)
        setIsWorkspaceOpen(true)
        setIsLibraryOpen(false)
        pendingNavigationTargetRef.current = null
        setPendingNavigationTarget(null)
        writeAppNavigationHistory('replace', {
          lumosNavigation: true,
          view: 'workspace',
        })
        return
      }

      const stage = getSafeNavigationStage({
        conversation,
        hasAnalysis:
          conversation.analysisReady && Boolean(analysisByConversation[conversation.id]),
        hasDraft:
          Boolean(draftReadyByConversation[conversation.id]) &&
          Boolean(draftCopyByConversation[conversation.id]),
        requestedStage: navigationState.stage,
      })
      const canonicalState: AppNavigationHistoryState = {
        lumosNavigation: true,
        view: 'conversation',
        projectId: project.id,
        conversationId: conversation.id,
        stage,
        canReturnToWorkspace: navigationState.canReturnToWorkspace ?? false,
      }

      if (project.activeConversationId !== conversation.id) {
        setProjects((current) =>
          current.map((item) =>
            item.id === project.id ? { ...item, activeConversationId: conversation.id } : item,
          ),
        )
      }
      activeConversationRouteRef.current = {
        projectId: project.id,
        conversationId: conversation.id,
      }
      setActiveProjectId(project.id)
      setNavigationStageOverride(stage)
      setWorkflowContextView(stage === 'intake' || stage === 'references' ? stage : null)
      setIsReaderPreviewVisible(stage === 'confirm')
      setIsWorkspaceOpen(false)
      setIsLibraryOpen(false)
      pendingNavigationTargetRef.current = null
      setPendingNavigationTarget(null)

      if (
        getAppNavigationHash(canonicalState) !== window.location.hash ||
        !isAppNavigationHistoryState(window.history.state) ||
        getAppNavigationHash(window.history.state) !== getAppNavigationHash(canonicalState)
      ) {
        writeAppNavigationHistory('replace', canonicalState)
      }
    }, 0)

    return () => window.clearTimeout(resolutionTimer)
  }, [
    analysisByConversation,
    cloudWorkspaceStatus,
    cloudWorkspaceUserId,
    draftCopyByConversation,
    draftReadyByConversation,
    pendingNavigationTarget,
    projects,
  ])

  useEffect(() => {
    if (
      pendingNavigationTargetRef.current ||
      isWorkspaceOpen ||
      isLibraryOpen ||
      cloudWorkspaceStatus === 'initializing' ||
      cloudWorkspaceStatus === 'loading'
    ) {
      return
    }

    const canonicalState: AppNavigationHistoryState = {
      lumosNavigation: true,
      view: 'conversation',
      projectId: activeProject.id,
      conversationId: activeConversation.id,
      stage: visibleConversationStage,
      canReturnToWorkspace: true,
    }
    const currentState: unknown = window.history.state
    if (
      window.location.hash !== getAppNavigationHash(canonicalState) ||
      !isAppNavigationHistoryState(currentState) ||
      getAppNavigationHash(currentState) !== getAppNavigationHash(canonicalState)
    ) {
      writeAppNavigationHistory('replace', canonicalState)
    }
  }, [
    activeConversation.id,
    activeProject.id,
    cloudWorkspaceStatus,
    isLibraryOpen,
    isWorkspaceOpen,
    visibleConversationStage,
  ])

  useEffect(() => {
    if (!showCreateProjectCard && !projectPendingDeleteId) return

    const previousOverflow = document.body.style.overflow
    const previouslyFocused =
      projectDialogReturnFocusRef.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    document.body.style.overflow = 'hidden'

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (projectPendingDeleteId) setProjectPendingDeleteId('')
        else {
          setShowCreateProjectCard(false)
          setNewProjectName('')
        }
        return
      }
      if (event.key !== 'Tab') return

      const dialog = document.querySelector<HTMLElement>('[data-project-dialog]')
      const focusableElements = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
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

    window.addEventListener('keydown', handleDialogKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleDialogKeyDown)
      previouslyFocused?.focus()
      projectDialogReturnFocusRef.current = null
    }
  }, [projectPendingDeleteId, showCreateProjectCard])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [step])

  useEffect(() => {
    if (cloudWorkspaceStatus === 'guest') {
      if (!cloudWorkspaceHydratedUserIdRef.current) return

      const restored = loadGuestWorkspaceSnapshot()
      const restoredProjects = restored?.projects ?? initialProjects
      const navigationTarget = readAppNavigationHistory()
      cloudWorkspaceHydratedUserIdRef.current = ''
      workspaceSyncBaselineRef.current = ''
      workspaceSyncRetryAttemptRef.current = 0
      if (workspaceSyncRetryTimerRef.current) {
        window.clearTimeout(workspaceSyncRetryTimerRef.current)
        workspaceSyncRetryTimerRef.current = null
      }
      setProjects(restoredProjects)
      setActiveProjectId(
        navigationTarget.view === 'conversation' &&
          restoredProjects.some((project) => project.id === navigationTarget.projectId)
          ? navigationTarget.projectId ?? ''
          : restored?.activeProjectId ?? initialProjects[0].id,
      )
      setAnalysisByConversation(restored?.analysisByConversation ?? {})
      setDraftCopyByConversation(restored?.draftCopyByConversation ?? {})
      setDraftReadyByConversation(restored?.draftReadyByConversation ?? {})
      const restoredDraftVersions = restored?.draftVersionsByConversation ?? {}
      draftVersionsRef.current = restoredDraftVersions
      setDraftVersionsByConversation(restoredDraftVersions)
      setCurrentDraftVersionIdByConversation(
        restored?.currentDraftVersionIdByConversation ?? {},
      )
      setRewriteMessagesByConversation(restored?.rewriteMessagesByConversation ?? {})
      setPlanAttachmentsByConversation(restored?.planAttachmentsByConversation ?? {})
      setReaderAudienceByConversation(restored?.readerAudienceByConversation ?? {})
      setReaderPreviewByConversation(restored?.readerPreviewByConversation ?? {})
      setChatInputByConversation(restored?.chatInputByConversation ?? {})
      setRewriteInputByConversation(restored?.rewriteInputByConversation ?? {})
      setReaderPreviewErrorByConversation({})
      setWorkspaceSaveStatus('saved-local')
      queueNavigationTarget(navigationTarget)
      return
    }

    if (
      cloudWorkspaceStatus !== 'ready' ||
      !cloudWorkspaceUserId ||
      cloudWorkspaceHydratedUserIdRef.current === cloudWorkspaceUserId
    ) {
      return
    }

    const hydrated = hydrateCloudWorkspace(cloudWorkspaceProjects)
    const baselinePayload = buildWorkspaceSyncPayload(hydrated)
    const navigationTarget = readAppNavigationHistory()

    cloudWorkspaceHydratedUserIdRef.current = cloudWorkspaceUserId
    skipNextWorkspaceAutosaveRef.current = true
    workspaceSyncBaselineRef.current = JSON.stringify(baselinePayload)
    workspaceSyncRetryAttemptRef.current = 0
    if (workspaceSyncRetryTimerRef.current) {
      window.clearTimeout(workspaceSyncRetryTimerRef.current)
      workspaceSyncRetryTimerRef.current = null
    }
    setProjects(hydrated.projects)
    setActiveProjectId(
      navigationTarget.view === 'conversation' &&
        hydrated.projects.some((project) => project.id === navigationTarget.projectId)
        ? navigationTarget.projectId ?? ''
        : hydrated.projects[0]?.id ?? '',
    )
    setAnalysisByConversation(hydrated.analysisByConversation)
    setDraftCopyByConversation(hydrated.draftCopyByConversation)
    setDraftReadyByConversation(hydrated.draftReadyByConversation)
    draftVersionsRef.current = hydrated.draftVersionsByConversation
    setDraftVersionsByConversation(hydrated.draftVersionsByConversation)
    setCurrentDraftVersionIdByConversation(hydrated.currentDraftVersionIdByConversation)
    setRewriteMessagesByConversation(hydrated.rewriteMessagesByConversation)
    setPlanAttachmentsByConversation(hydrated.planAttachmentsByConversation)
    setReaderAudienceByConversation(hydrated.readerAudienceByConversation)
    setReaderPreviewByConversation(hydrated.readerPreviewByConversation)
    setChatInputByConversation(hydrated.chatInputByConversation)
    setRewriteInputByConversation(hydrated.rewriteInputByConversation)
    setReaderPreviewErrorByConversation({})
    setWorkspaceSaveStatus('synced-cloud')
    queueNavigationTarget(navigationTarget)
  }, [cloudWorkspaceProjects, cloudWorkspaceStatus, cloudWorkspaceUserId])

  useEffect(() => {
    if (cloudWorkspaceStatus !== 'guest') return

    if (localWorkspaceSaveTimerRef.current) {
      window.clearTimeout(localWorkspaceSaveTimerRef.current)
    }
    if (localWorkspaceCommitTimerRef.current) {
      window.clearTimeout(localWorkspaceCommitTimerRef.current)
    }

    const snapshot: LocalWorkspaceSnapshot = {
      projects,
      activeProjectId,
      analysisByConversation,
      draftCopyByConversation,
      draftReadyByConversation,
      draftVersionsByConversation,
      currentDraftVersionIdByConversation,
      rewriteMessagesByConversation,
      planAttachmentsByConversation,
      readerAudienceByConversation,
      readerPreviewByConversation,
      chatInputByConversation,
      rewriteInputByConversation,
    }

    localWorkspaceSaveTimerRef.current = window.setTimeout(() => {
      setWorkspaceSaveStatus('saving-local')
      localWorkspaceSaveTimerRef.current = null
      localWorkspaceCommitTimerRef.current = window.setTimeout(() => {
        try {
          const savedAt = saveLocalWorkspace(snapshot)
          setWorkspaceSavedAt(savedAt)
          setWorkspaceSaveStatus('saved-local')
        } catch {
          setWorkspaceSaveStatus('save-error')
        }
        localWorkspaceCommitTimerRef.current = null
      }, 350)
    }, 0)

    return () => {
      if (localWorkspaceSaveTimerRef.current) {
        window.clearTimeout(localWorkspaceSaveTimerRef.current)
        localWorkspaceSaveTimerRef.current = null
      }
      if (localWorkspaceCommitTimerRef.current) {
        window.clearTimeout(localWorkspaceCommitTimerRef.current)
        localWorkspaceCommitTimerRef.current = null
      }
    }
  }, [
    activeProjectId,
    analysisByConversation,
    chatInputByConversation,
    cloudWorkspaceStatus,
    draftCopyByConversation,
    draftReadyByConversation,
    draftVersionsByConversation,
    currentDraftVersionIdByConversation,
    planAttachmentsByConversation,
    projects,
    readerAudienceByConversation,
    readerPreviewByConversation,
    rewriteInputByConversation,
    rewriteMessagesByConversation,
  ])

  useEffect(() => {
    if (workspaceSyncRetryTimerRef.current) {
      window.clearTimeout(workspaceSyncRetryTimerRef.current)
      workspaceSyncRetryTimerRef.current = null
    }

    if (skipNextWorkspaceAutosaveRef.current) {
      skipNextWorkspaceAutosaveRef.current = false
      return
    }

    if (
      cloudWorkspaceStatus !== 'ready' ||
      cloudWorkspaceHydratedUserIdRef.current !== cloudWorkspaceUserId ||
      workspaceSyncSerialized === workspaceSyncBaselineRef.current
    ) {
      return
    }

    if (workspaceSyncTimerRef.current) {
      window.clearTimeout(workspaceSyncTimerRef.current)
    }

    const payload = workspaceSyncPayload
    const serializedPayload = workspaceSyncSerialized
    setWorkspaceSaveStatus('syncing-cloud')
    workspaceSyncTimerRef.current = window.setTimeout(() => {
      workspaceSaveQueueRef.current = workspaceSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await saveCloudWorkspace(payload)
          workspaceSyncBaselineRef.current = serializedPayload
          workspaceSyncRetryAttemptRef.current = 0
          setWorkspaceSavedAt(new Date().toISOString())
          setWorkspaceSaveStatus('synced-cloud')
        })
        .catch(() => {
          setWorkspaceSaveStatus('save-error')
          const retryAttempt = workspaceSyncRetryAttemptRef.current + 1
          workspaceSyncRetryAttemptRef.current = retryAttempt
          const retryDelay = Math.min(30_000, 5_000 * 2 ** (retryAttempt - 1))
          workspaceSyncRetryTimerRef.current = window.setTimeout(() => {
            workspaceSyncRetryTimerRef.current = null
            setWorkspaceSyncRetryVersion((current) => current + 1)
          }, retryDelay)
        })
      workspaceSyncTimerRef.current = null
    }, 900)

    return () => {
      if (workspaceSyncTimerRef.current) {
        window.clearTimeout(workspaceSyncTimerRef.current)
        workspaceSyncTimerRef.current = null
      }
    }
  }, [
    cloudWorkspaceStatus,
    cloudWorkspaceUserId,
    saveCloudWorkspace,
    workspaceSyncPayload,
    workspaceSyncRetryVersion,
    workspaceSyncSerialized,
  ])

  useEffect(
    () => () => {
      if (draftSelectionCaptureTimerRef.current) {
        window.clearTimeout(draftSelectionCaptureTimerRef.current)
      }
      if (draftDropLandingTimerRef.current) {
        window.clearTimeout(draftDropLandingTimerRef.current)
      }
      if (draftBridgeGenerationTimerRef.current) {
        window.clearTimeout(draftBridgeGenerationTimerRef.current)
      }
      if (finalCopyToastTimerRef.current) {
        window.clearTimeout(finalCopyToastTimerRef.current)
      }
      if (workspaceSyncTimerRef.current) {
        window.clearTimeout(workspaceSyncTimerRef.current)
      }
      if (workspaceSyncRetryTimerRef.current) {
        window.clearTimeout(workspaceSyncRetryTimerRef.current)
      }
      if (localWorkspaceSaveTimerRef.current) {
        window.clearTimeout(localWorkspaceSaveTimerRef.current)
      }
      if (localWorkspaceCommitTimerRef.current) {
        window.clearTimeout(localWorkspaceCommitTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    function handleDraftSelectionEnd(event: PointerEvent | MouseEvent) {
      const container = draftSelectionContainerRef.current
      if (!container || !draftSelectionPointerStartRef.current) return

      scheduleDraftCopySelection(container, {
        x: event.clientX,
        y: event.clientY,
      })
    }

    window.addEventListener('pointerup', handleDraftSelectionEnd, true)
    window.addEventListener('mouseup', handleDraftSelectionEnd, true)

    return () => {
      window.removeEventListener('pointerup', handleDraftSelectionEnd, true)
      window.removeEventListener('mouseup', handleDraftSelectionEnd, true)
    }
  })

  useEffect(() => {
    if (!openSidebarConversationMenuId) return
    updateSidebarConversationMenuPosition(openSidebarConversationMenuId)

    function updateOpenMenuPosition() {
      updateSidebarConversationMenuPosition(openSidebarConversationMenuId)
    }

    function closeMenuOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Element && target.closest('[data-sidebar-conversation-menu]')) return
      setOpenSidebarConversationMenuId('')
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenSidebarConversationMenuId('')
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
  }, [openSidebarConversationMenuId, updateSidebarConversationMenuPosition])

  useEffect(() => {
    if (!isReaderAudienceOpen) return

    function closeReaderAudienceOnPointerDown(event: PointerEvent) {
      const target = event.target
      if (
        target instanceof Element &&
        (target.closest('[data-reader-audience-trigger]') ||
          target.closest('[data-reader-audience-popover]'))
      ) {
        return
      }
      setIsReaderAudienceOpen(false)
    }

    function closeReaderAudienceOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsReaderAudienceOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeReaderAudienceOnPointerDown)
    document.addEventListener('keydown', closeReaderAudienceOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeReaderAudienceOnPointerDown)
      document.removeEventListener('keydown', closeReaderAudienceOnEscape)
    }
  }, [isReaderAudienceOpen])

  useEffect(() => {
    if (!rewriteSelectionCandidate) return

    function closeCandidateOnPointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Element && target.closest('[data-rewrite-selection-popover]')) return
      setRewriteSelectionCandidate(null)
    }

    function closeCandidateOnViewportChange() {
      setRewriteSelectionCandidate(null)
    }

    document.addEventListener('pointerdown', closeCandidateOnPointerDown)
    window.addEventListener('resize', closeCandidateOnViewportChange)
    window.addEventListener('scroll', closeCandidateOnViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', closeCandidateOnPointerDown)
      window.removeEventListener('resize', closeCandidateOnViewportChange)
      window.removeEventListener('scroll', closeCandidateOnViewportChange, true)
    }
  }, [rewriteSelectionCandidate])

  useEffect(() => {
    if (!selectedRewriteText && !rewriteSelectionCandidate) return

    function clearRewriteSelectionOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        clearRewriteSelection()
      }
    }

    document.addEventListener('keydown', clearRewriteSelectionOnEscape)
    return () => document.removeEventListener('keydown', clearRewriteSelectionOnEscape)
  }, [rewriteSelectionCandidate, selectedRewriteText])

  useEffect(() => {
    if (!isDraftPointerDragging || !draftDragSelection) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'

    function handlePointerMove(event: PointerEvent) {
      event.preventDefault()
      if (!draftDragSelection) return

      setDraftPointerDrag({ x: event.clientX, y: event.clientY })
      setDraftDropTarget(
        getDraftDropTargetFromPoint(event.clientX, event.clientY, draftDragSelection),
      )
    }

    function handlePointerUp(event: PointerEvent) {
      event.preventDefault()
      if (!draftDragSelection) return

      const target = getDraftDropTargetFromPoint(
        event.clientX,
        event.clientY,
        draftDragSelection,
      )
      if (target) {
        applyDraftDropTarget(draftDragSelection, target, event.clientX, event.clientY)
        return
      }

      setDraftPointerDrag(null)
      setDraftDropTarget(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
    // Keep this listener stable while pointer coordinates update every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftDragSelection, isDraftPointerDragging])

  useEffect(() => {
    const anchorId = draftMovePrompt?.landing.id
    if (!anchorId) return
    const stableAnchorId: string = anchorId

    let frameId = 0
    function updatePromptPosition() {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        const anchor = document.querySelector<HTMLElement>(
          `[data-draft-move-anchor="${stableAnchorId}"]`,
        )
        if (!anchor) return

        const anchorRect = anchor.getBoundingClientRect()
        const toolbarRect = draftMovePromptToolbarRef.current?.getBoundingClientRect()
        const margin = 14
        const toolbarWidth = Math.min(toolbarRect?.width ?? 304, window.innerWidth - margin * 2)
        const toolbarHeight = toolbarRect?.height ?? 48
        const rightSideLeft = anchorRect.right + 12
        const hasRightSideSpace = rightSideLeft + toolbarWidth <= window.innerWidth - margin
        const preferredLeft = hasRightSideSpace
          ? rightSideLeft
          : anchorRect.left + anchorRect.width / 2 - toolbarWidth / 2
        const preferredTop = hasRightSideSpace
          ? anchorRect.top + anchorRect.height / 2 - toolbarHeight / 2
          : anchorRect.bottom + 10
        const isAnchorInView =
          anchorRect.bottom >= margin && anchorRect.top <= window.innerHeight - margin
        const nextPosition = {
          left: clampViewportPosition(
            preferredLeft,
            margin,
            window.innerWidth - toolbarWidth - margin,
          ),
          top: isAnchorInView
            ? clampViewportPosition(
                preferredTop,
                margin,
                window.innerHeight - toolbarHeight - margin,
              )
            : preferredTop,
        }

        setDraftMovePrompt((current) => {
          if (!current || current.landing.id !== stableAnchorId) return current
          return {
            ...current,
            position: nextPosition,
          }
        })
      })
    }

    updatePromptPosition()
    window.addEventListener('resize', updatePromptPosition)
    window.addEventListener('scroll', updatePromptPosition, true)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updatePromptPosition)
      window.removeEventListener('scroll', updatePromptPosition, true)
    }
  }, [draftMovePrompt?.landing.id])

  const sidebarConversations = useMemo(
    () => sortConversationsForSidebar(activeProject.conversations),
    [activeProject.conversations],
  )

  const selectedItemIds =
    referenceSelectionDraftByConversation[activeConversation.id] ?? activeConversation.selectedItemIds
  const hasLearningResult = activeConversation.analysisReady
  const hasPlanReady = hasLearningResult
  const missingBriefFields = [
    activeConversation.topic.trim().length < 4 ? '内容主题' : '',
    activeConversation.targetAudience.trim().length < 1 ? '目标读者' : '',
  ].filter(Boolean)
  const isWritingBriefValid = missingBriefFields.length === 0
  const canGenerateDraft = hasPlanReady && isWritingBriefValid
  const hasDraftReady =
    canGenerateDraft && Boolean(draftReadyByConversation[activeConversation.id])
  const hasStoredDraft = Boolean(draftCopyByConversation[activeConversation.id])
  const isAnalyzing = analysisPendingConversationId === activeConversation.id
  const isDraftGenerating = draftGeneratingConversationId === activeConversation.id
  const analysisWaitSeconds =
    isAnalyzing && analysisWaitStartedAt
      ? Math.max(0, Math.floor((aiWaitTick - analysisWaitStartedAt) / 1000))
      : 0
  const analysisError = analysisErrorByConversation[activeConversation.id] ?? ''
  const draftGenerationError = draftGenerationErrorByConversation[activeConversation.id] ?? ''
  const draftFactGap = draftFactGapByConversation[activeConversation.id] ?? null
  const effectiveLength = activeConversation.length ?? 'medium'

  useEffect(() => {
    if (!analysisWaitStartedAt && !draftWaitStartedAt) return

    const intervalId = window.setInterval(() => {
      setAiWaitTick(Date.now())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [analysisWaitStartedAt, draftWaitStartedAt])

  const selectedSnippetIds = useMemo(
    () =>
      new Set(
        selectedItemIds
          .filter((id) => id.startsWith('snippet:'))
          .map((id) => id.replace('snippet:', '')),
      ),
    [selectedItemIds],
  )

  const selectedNoteIds = useMemo(
    () =>
      new Set(
        selectedItemIds.filter((id) => id.startsWith('note:')).map((id) => id.replace('note:', '')),
      ),
    [selectedItemIds],
  )

  const selectedSnippets = useMemo(
    () => learningReadySnippets.filter((snippet) => selectedSnippetIds.has(snippet.id)),
    [learningReadySnippets, selectedSnippetIds],
  )

  const selectedNotes = useMemo(() => {
    const snippetNoteUrls = new Set(
      selectedSnippets.map((snippet) => normalizeNoteUrl(snippet.noteUrl)),
    )
    return learningReadyNotes.filter(
      (note) =>
        selectedNoteIds.has(note.id) || snippetNoteUrls.has(normalizeNoteUrl(note.sourceUrl)),
    )
  }, [learningReadyNotes, selectedNoteIds, selectedSnippets])

  const selectedFolderName = useMemo(() => {
    const folderNames = Array.from(new Set(selectedNotes.map((note) => note.folderName).filter(Boolean)))

    if (folderNames.length === 0) return '未选择文案'
    if (folderNames.length === 1) return folderNames[0]

    return `${folderNames.length} 个文件夹`
  }, [selectedNotes])

  const referenceRecommendations = useMemo(
    () => buildReferenceRecommendations(activeConversation.writingRequest, learningReadyNotes),
    [activeConversation.writingRequest, learningReadyNotes],
  )

  const fallbackAnalysis = useMemo(
    () =>
      buildDemoAnalysis({
        folderName: selectedFolderName,
        notes: selectedNotes,
        snippets: selectedSnippets,
        topic: activeConversation.topic,
        targetAudience: activeConversation.targetAudience,
        projectName: activeProject.name,
        length: effectiveLength,
      }),
    [
      activeProject.name,
      effectiveLength,
      activeConversation.targetAudience,
      activeConversation.topic,
      selectedFolderName,
      selectedNotes,
      selectedSnippets,
    ],
  )
  const analysis = analysisByConversation[activeConversation.id] ?? fallbackAnalysis

  const generatedInitialDraftCopy = useMemo(
    () =>
      buildInitialDraftCopy({
        topic: activeConversation.topic,
        targetAudience: activeConversation.targetAudience,
        length: effectiveLength,
        writingBrief: activeConversation.writingBrief,
      }),
    [
      effectiveLength,
      activeConversation.targetAudience,
      activeConversation.topic,
      activeConversation.writingBrief,
    ],
  )
  const initialDraftCopy =
    draftCopyByConversation[activeConversation.id] ?? generatedInitialDraftCopy
  const activeDraftVersions = draftVersionsByConversation[activeConversation.id] ?? []
  const activeCurrentDraftVersionId =
    currentDraftVersionIdByConversation[activeConversation.id] ?? ''
  const activeDraftVersion =
    activeDraftVersions.find((version) => version.id === activeCurrentDraftVersionId) ??
    [...activeDraftVersions]
      .reverse()
      .find((version) => isSameDraftCopy(version, initialDraftCopy)) ??
    activeDraftVersions[activeDraftVersions.length - 1]
  const activeAppliedPreferenceIds = getAppliedWritingPreferenceIds(
    activeDraftVersion?.appliedWritingProfile,
  )
  const activeDraftQuality = activeDraftVersion?.qualitySnapshot
  const canFinalizeDraft =
    hasDraftReady && activeDraftQuality?.overallStatus !== 'failed'

  const creationBrief = useMemo(
    () => {
      const requiredFacts = getRequiredFactStatements(
        activeConversation.writingBrief.requiredFacts,
      )
      return {
        objective: activeConversation.writingBrief.objective.trim(),
        sourceFacts: activeConversation.writingBrief.requiredFacts.trim(),
        instructions: activeConversation.writingBrief.instructions.trim(),
        contentMode: 'auto' as const,
        facts: requiredFacts.map((statement, index) => ({
          id: `brief-${index + 1}`,
          statement,
          required: true,
        })),
        mustInclude: [
          activeConversation.writingBrief.requiredFacts.trim(),
          activeConversation.writingBrief.objective.trim()
            ? `写作目标：${activeConversation.writingBrief.objective.trim()}`
            : '',
          activeConversation.writingBrief.instructions.trim()
            ? `补充要求：${activeConversation.writingBrief.instructions.trim()}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        avoidTone: activeConversation.writingBrief.boundaries.trim(),
      }
    },
    [activeConversation.writingBrief],
  )

  const rewriteMessages = useMemo(
    () =>
      dedupeReaderSuggestionMessages(
        rewriteMessagesByConversation[activeConversation.id] ?? [],
      ),
    [activeConversation.id, rewriteMessagesByConversation],
  )
  const isRewriteAssistantVisible =
    Boolean(selectedRewriteText) ||
    rewriteMessages.length > 0 ||
    rewritePendingConversationId === activeConversation.id
  const planAttachments = planAttachmentsByConversation[activeConversation.id] ?? []
  const readerAudienceDraft = readerAudienceByConversation[activeConversation.id] ?? ''
  const effectiveReaderAudience = readerAudienceDraft.trim() || activeConversation.targetAudience
  const readerPreviewRecord = readerPreviewByConversation[activeConversation.id]
  const activeReaderPreview =
    readerPreviewRecord &&
    readerPreviewRecord.audience === effectiveReaderAudience &&
    isSameDraftCopy(readerPreviewRecord.draft, initialDraftCopy)
      ? readerPreviewRecord.preview
      : null
  const fallbackReaderPreviewFeedback = useMemo(
    () =>
      buildReaderPreviewFeedback({
        draft: initialDraftCopy,
        audience: readerAudienceDraft,
        fallbackAudience: activeConversation.targetAudience,
      }),
    [
      activeConversation.targetAudience,
      initialDraftCopy,
      readerAudienceDraft,
    ],
  )
  const rawReaderPreviewFeedback = useMemo(
    () =>
      activeReaderPreview
        ? buildAiReaderPreviewFeedback(activeReaderPreview, initialDraftCopy)
        : fallbackReaderPreviewFeedback,
    [activeReaderPreview, fallbackReaderPreviewFeedback, initialDraftCopy],
  )
  const readerPreviewFeedback = useMemo(
    () => ({
      ...rawReaderPreviewFeedback,
      annotations: getRenderableReaderAnnotations(
        rawReaderPreviewFeedback.annotations,
        initialDraftCopy,
      ),
    }),
    [initialDraftCopy, rawReaderPreviewFeedback],
  )
  const readerPreviewError = readerPreviewErrorByConversation[activeConversation.id] ?? ''
  const draftBridgeMessages = draftBridgeMessagesByConversation[activeConversation.id] ?? []
  const draftMoveHistory = draftMoveHistoryByConversation[activeConversation.id] ?? {
    redo: [],
    undo: [],
  }
  const canUndoDraftMove = draftMoveHistory.undo.length > 0
  const canRedoDraftMove = draftMoveHistory.redo.length > 0
  const hasWritingRequest = Boolean(
    activeConversation.writingRequest.trim() || activeConversation.topic.trim(),
  )
  const workflowSteps: WorkflowStepItem[] = [
    {
      id: 'intake',
      label: '需求',
      completed: hasWritingRequest,
    },
    {
      id: 'references',
      label: '参考',
      completed: hasLearningResult,
      disabled: !hasWritingRequest,
      disabledReason: !hasWritingRequest ? '先填写并确认写作需求' : undefined,
    },
    {
      id: 'draft',
      label: '初稿',
      completed: hasDraftReady,
      disabled: !hasLearningResult,
      disabledReason: !hasLearningResult ? '先完成参考分析' : undefined,
    },
    {
      id: 'review',
      label: '编辑',
      completed:
        Boolean(activeReaderPreview) ||
        visibleConversationStage === 'confirm' ||
        Boolean(activeConversation.finalizedAt),
      disabled: !hasDraftReady,
      disabledReason: !hasDraftReady ? '先生成初稿' : undefined,
    },
    {
      id: 'confirm',
      label: '预演',
      completed: Boolean(activeConversation.finalizedAt),
      disabled: !hasDraftReady,
      disabledReason: !hasDraftReady ? '先生成初稿' : undefined,
    },
  ]

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()
    return projects
      .filter((project) => {
        const folder = libraryFolders.find((item) => item.id === project.folderId)
        const content = [project.name, folder?.name || ''].join(' ').toLowerCase()
        return !query || content.includes(query)
      })
      .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))
  }, [libraryFolders, projectSearch, projects])

  const projectPendingDelete = useMemo(
    () => projects.find((project) => project.id === projectPendingDeleteId),
    [projectPendingDeleteId, projects],
  )
  const isNewProjectNameDuplicate = projects.some(
    (project) =>
      Boolean(newProjectName.trim()) && project.name.trim() === newProjectName.trim(),
  )

  function updateProject(projectId: string, updater: (project: ProjectRecord) => ProjectRecord) {
    setProjects((current) =>
      current.map((project) => (project.id === projectId ? updater(project) : project)),
    )
  }

  function updateConversation(
    projectId: string,
    conversationId: string,
    updater: (conversation: ConversationRecord) => ConversationRecord,
  ) {
    const now = new Date().toISOString()

    updateProject(projectId, (project) => ({
      ...project,
      updatedAt: now,
      conversations: project.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...updater(conversation),
              updatedAt: now,
            }
          : conversation,
      ),
    }))
  }

  function invalidateDraftOutputs(conversationId: string) {
    setDraftReadyByConversation((current) => ({
      ...current,
      [conversationId]: false,
    }))
    setDraftGenerationErrorByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setReaderPreviewByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setReaderPreviewErrorByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
  }

  function invalidateAnalysisAndDraft(conversationId: string) {
    setAnalysisByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setDraftFactGapByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    invalidateDraftOutputs(conversationId)
  }

  function markDraftEdited() {
    const conversationId = activeConversation.id
    setReaderPreviewByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setReaderPreviewErrorByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    updateConversation(activeProject.id, conversationId, (conversation) => ({
      ...conversation,
      finalizedAt: undefined,
    }))
  }

  function recordDraftSnapshot(
    conversationId: string,
    nextDraft: InitialDraftCopy,
    source: string,
    options: {
      coalesce?: boolean
      force?: boolean
      appliedWritingProfile?: AppliedWritingProfileContext | null
      qualitySnapshot?: DraftQualitySnapshot | null
    } = {},
  ) {
    const nextVersions = evolveDraftVersions({
      versions: draftVersionsRef.current[conversationId] ?? [],
      nextDraft,
      source,
      baseDraft: draftCopyByConversation[conversationId],
      coalesce: options.coalesce,
      force: options.force,
      appliedWritingProfile: options.appliedWritingProfile,
      qualitySnapshot: options.qualitySnapshot,
    })
    const currentVersion = nextVersions[nextVersions.length - 1]
    const nextVersionsByConversation = {
      ...draftVersionsRef.current,
      [conversationId]: nextVersions,
    }

    draftVersionsRef.current = nextVersionsByConversation
    setDraftVersionsByConversation(nextVersionsByConversation)
    setCurrentDraftVersionIdByConversation((current) => ({
      ...current,
      [conversationId]: currentVersion.id,
    }))
    setDraftCopyByConversation((current) => ({
      ...current,
      [conversationId]: nextDraft,
    }))
    setDraftReadyByConversation((current) => ({
      ...current,
      [conversationId]: true,
    }))
  }

  function handleRestoreDraftVersion(version: DraftVersionRecord) {
    const restoredDraft = {
      title: version.title,
      body: [...version.body],
    }

    recordDraftSnapshot(activeConversation.id, restoredDraft, 'restored', {
      force: true,
      appliedWritingProfile: version.appliedWritingProfile ?? null,
      qualitySnapshot: version.qualitySnapshot ?? null,
    })
    markDraftEdited()
    clearRewriteSelection()
    setDraftDragSelection(null)
    setDraftPointerDrag(null)
    setDraftDropTarget(null)
    setDraftDropLanding(null)
    setDraftMovePrompt(null)
    setIsDraftVersionHistoryOpen(false)
    showFinalCopyToast(`已将版本 ${version.version} 恢复为新版本`)
  }

  function handleWritingBriefChange(
    field: 'topic' | 'targetAudience' | keyof WritingBrief,
    value: string,
  ) {
    invalidateDraftOutputs(activeConversation.id)
    updateConversation(activeProject.id, activeConversation.id, (conversation) => ({
      ...conversation,
      finalizedAt: undefined,
      ...(field === 'topic' || field === 'targetAudience'
        ? { [field]: value }
        : {
            writingBrief: {
              ...conversation.writingBrief,
              [field]: value,
            },
          }),
    }))
  }

  function handleLengthChange(length: ProjectLength) {
    if (activeConversation.length === length) return

    invalidateDraftOutputs(activeConversation.id)
    setDraftUsageByConversation((current) => {
      const next = { ...current }
      delete next[activeConversation.id]
      return next
    })
    setDraftBridgeMessagesByConversation((current) => {
      const next = { ...current }
      delete next[activeConversation.id]
      return next
    })
    setDraftMoveHistoryByConversation((current) => {
      const next = { ...current }
      delete next[activeConversation.id]
      return next
    })
    setDraftDragSelection(null)
    setDraftPointerDrag(null)
    setDraftDropTarget(null)
    setDraftDropLanding(null)
    setDraftMovePrompt(null)

    updateConversation(activeProject.id, activeConversation.id, (conversation) => ({
      ...conversation,
      finalizedAt: undefined,
      length,
    }))
  }

  function handleReaderAudienceChange(value: string) {
    const conversationId = activeConversation.id
    setReaderAudienceByConversation((current) => ({
      ...current,
      [conversationId]: value,
    }))
    setReaderPreviewByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setReaderPreviewErrorByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    updateConversation(activeProject.id, conversationId, (conversation) => ({
      ...conversation,
      finalizedAt: undefined,
    }))
  }

  function updateConversationStage(
    projectId: string,
    conversationId: string,
    nextStage: ConversationStage,
  ) {
    const nextStep = getStepForStage(nextStage)

    updateConversation(projectId, conversationId, (conversation) => ({
      ...conversation,
      step: nextStep,
      workflowStage: nextStage,
    }))
  }

  function resetConversationTransientState() {
    if (draftSelectionCaptureTimerRef.current) {
      window.clearTimeout(draftSelectionCaptureTimerRef.current)
      draftSelectionCaptureTimerRef.current = null
    }
    if (draftBridgeGenerationTimerRef.current) {
      window.clearTimeout(draftBridgeGenerationTimerRef.current)
      draftBridgeGenerationTimerRef.current = null
    }
    if (draftDropLandingTimerRef.current) {
      window.clearTimeout(draftDropLandingTimerRef.current)
      draftDropLandingTimerRef.current = null
    }

    setSelectedRewriteText('')
    setSelectedRewriteFieldId('')
    setRewriteSelectionCandidate(null)
    setOpenSidebarConversationMenuId('')
    setRenamingSidebarConversationId('')
    setDraftSidebarConversationTitle('')
    draftSelectionContainerRef.current = null
    draftSelectionPointerStartRef.current = null
    setDraftDragSelection(null)
    setDraftPointerDrag(null)
    setDraftDropTarget(null)
    setDraftDropLanding(null)
    setDraftMovePrompt(null)
    setIsWritingBriefOpen(false)
    setIsReaderPreviewVisible(false)
    setIsConversationSidebarOpen(false)
    setWorkflowContextView(null)
    setNavigationStageOverride(null)
    setWritingRequestDraftByConversation({})
    setReferenceSelectionDraftByConversation({})
  }

  function goToStep(nextStep: PageStep) {
    if (nextStep !== 'reader') {
      setIsReaderAudienceOpen(false)
      setActiveReaderAnnotationId('')
    }

    if (nextStep === 'workspace') {
      setWorkflowContextView(null)
      setNavigationStageOverride(null)
      pendingNavigationTargetRef.current = null
      setPendingNavigationTarget(null)
      setIsWorkspaceOpen(true)
      setIsLibraryOpen(false)
      const currentNavigationState: unknown = window.history.state
      if (
        !isAppNavigationHistoryState(currentNavigationState) ||
        currentNavigationState.view !== 'workspace'
      ) {
        writeAppNavigationHistory('push', {
          lumosNavigation: true,
          view: 'workspace',
        })
      }
      return
    }

    if (nextStep === 'library') {
      setWritingRequestDraftByConversation((current) => {
        const next = { ...current }
        delete next[activeConversation.id]
        return next
      })
      setReferenceSelectionDraftByConversation((current) => {
        const next = { ...current }
        delete next[activeConversation.id]
        return next
      })
      setWorkflowContextView(null)
      setNavigationStageOverride(null)
      pendingNavigationTargetRef.current = null
      setPendingNavigationTarget(null)
      setIsWorkspaceOpen(false)
      setIsLibraryOpen(true)
      const currentNavigationState: unknown = window.history.state
      if (
        !isAppNavigationHistoryState(currentNavigationState) ||
        currentNavigationState.view !== 'library'
      ) {
        writeAppNavigationHistory('push', {
          lumosNavigation: true,
          view: 'library',
          canReturnToWorkspace: true,
        })
      }
      return
    }

    setIsWorkspaceOpen(false)
    setIsLibraryOpen(false)
    if (nextStep === 'learn') {
      if (
        hasStoredDraft &&
        ['review', 'confirm', 'finalized'].includes(activeConversationStage)
      ) {
        setReferenceSelectionDraftByConversation((current) => ({
          ...current,
          [activeConversation.id]: [...activeConversation.selectedItemIds],
        }))
      }
      showConversationRoute('references')
      return
    }

    const nextStage: ConversationStage =
      nextStep === 'plan' || nextStep === 'length'
        ? 'draft'
        : nextStep === 'rewrite'
          ? activeConversation.finalizedAt
            ? 'finalized'
            : 'review'
          : activeConversation.finalizedAt
            ? 'finalized'
            : 'confirm'
    const visibleStage: ConversationStage =
      nextStep === 'rewrite'
        ? 'review'
        : nextStep === 'reader'
          ? 'confirm'
          : 'draft'

    updateConversationStage(activeProject.id, activeConversation.id, nextStage)
    showConversationRoute(visibleStage)
  }

  function handleWorkflowStepChange(nextStep: WorkflowStepId) {
    if (nextStep === 'intake') {
      setIsChatStreaming(false)
      showConversationRoute('intake')
      return
    }

    if (nextStep === 'references') {
      if (hasStoredDraft) {
        setReferenceSelectionDraftByConversation((current) => ({
          ...current,
          [activeConversation.id]: [...activeConversation.selectedItemIds],
        }))
      }
      showConversationRoute('references')
      return
    }

    if (nextStep === 'draft') {
      showConversationRoute('draft')
      return
    }

    if (nextStep === 'review') {
      showConversationRoute('review')
      return
    }

    setIsReaderPreviewVisible(true)
    showConversationRoute('confirm')
    void handleGenerateReaderPreview()
  }

  function handleWritingRequestChange(value: string) {
    setWritingRequestDraftByConversation((current) => ({
      ...current,
      [activeConversation.id]: value,
    }))
  }

  function handleSubmitWritingRequest() {
    const writingRequest = writingRequestDraft.replace(/\s+/g, ' ').trim()
    if (writingRequest.length < 4) return

    const requestChanged = writingRequest !== activeConversation.topic.trim()
    const shouldResetProgress = requestChanged || activeConversationStage === 'intake'
    if (requestChanged) {
      invalidateAnalysisAndDraft(activeConversation.id)
      setReferenceSelectionDraftByConversation((current) => {
        const next = { ...current }
        delete next[activeConversation.id]
        return next
      })
      setAnalysisErrorByConversation((current) => {
        const next = { ...current }
        delete next[activeConversation.id]
        return next
      })
    }

    updateConversation(activeProject.id, activeConversation.id, (conversation) => ({
      ...conversation,
      title: isDefaultConversationTitle(conversation.title)
        ? buildConversationTitleFromPrompt(writingRequest)
        : conversation.title,
      step: shouldResetProgress ? 'learn' : conversation.step,
      workflowStage: shouldResetProgress ? 'references' : conversation.workflowStage,
      writingRequest,
      topic: writingRequest,
      targetAudience:
        conversation.targetAudience.trim() || '会搜索本次主题、重视真实经验和具体信息的读者',
      length: conversation.length ?? 'medium',
      selectedItemIds: requestChanged ? [] : conversation.selectedItemIds,
      analysisReady: requestChanged ? false : conversation.analysisReady,
      finalizedAt: requestChanged ? undefined : conversation.finalizedAt,
      writingBrief:
        requestChanged && !conversation.topic.trim()
          ? getDefaultWritingBrief(writingRequest)
          : conversation.writingBrief,
    }))
    setWritingRequestDraftByConversation((current) => {
      const next = { ...current }
      delete next[activeConversation.id]
      return next
    })
    showConversationRoute('references')
  }

  function handleOpenProject(projectId: string) {
    const now = new Date().toISOString()
    const projectToOpen = projects.find((project) => project.id === projectId)
    const conversationToOpen = projectToOpen?.conversations.find(
      (conversation) => conversation.id === projectToOpen.activeConversationId,
    )
    const resumableStage = conversationToOpen
      ? getResumableConversationStage(conversationToOpen)
      : 'intake'
    setIsChatStreaming(false)
    resetConversationTransientState()
    setIsReaderPreviewVisible(resumableStage === 'confirm')
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              conversations: sortConversationsForSidebar(
                project.conversations.map((conversation) =>
                  conversation.id === project.activeConversationId
                    ? {
                        ...conversation,
                        lastOpenedAt: now,
                        step: getStepForStage(getResumableConversationStage(conversation)),
                        workflowStage: getResumableConversationStage(conversation),
                      }
                    : conversation,
                ),
              ),
            }
          : project,
      ),
    )
    setActiveProjectId(projectId)
    showConversationRoute(resumableStage, {
      mode: 'push',
      projectId,
      conversationId: conversationToOpen?.id,
    })
  }

  function handleDeleteProject(projectId: string) {
    setProjects((current) => {
      const next = current.filter((project) => project.id !== projectId)
      if (next.length > 0 && activeProjectId === projectId) {
        setActiveProjectId(next[0].id)
      }
      if (next.length === 0) {
        setActiveProjectId('')
        setIsWorkspaceOpen(true)
        setIsLibraryOpen(false)
      }
      return next
    })
  }

  function handleRequestDeleteProject(projectId: string) {
    projectDialogReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setProjectPendingDeleteId(projectId)
  }

  function handleCancelDeleteProject() {
    setProjectPendingDeleteId('')
  }

  function handleConfirmDeleteProject() {
    if (!projectPendingDeleteId) return
    handleDeleteProject(projectPendingDeleteId)
    setProjectPendingDeleteId('')
  }

  function handleStartRenameProject(project: ProjectRecord) {
    setRenamingProjectId(project.id)
    setRenamingProjectName(project.name)
  }

  function handleCancelRenameProject() {
    setRenamingProjectId('')
    setRenamingProjectName('')
  }

  function handleCancelCreateProject() {
    setShowCreateProjectCard(false)
    setNewProjectName('')
    setNewProjectFolderId(noProjectFolderId)
  }

  function handleOpenCreateProject() {
    projectDialogReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setShowCreateProjectCard(true)
  }

  function handleSaveRenameProject(projectId: string) {
    const nextName = renamingProjectName.trim()
    if (!nextName) {
      handleCancelRenameProject()
      return
    }

    updateProject(projectId, (project) => ({
      ...project,
      name: nextName,
      updatedAt: new Date().toISOString(),
    }))
    handleCancelRenameProject()
  }

  function handleCreateProject() {
    const name = newProjectName.trim()
    if (!name || projects.some((project) => project.name.trim() === name)) return

    const now = new Date().toISOString()
    const nextConversation = createEmptyConversation({ now })
    const nextProject: ProjectRecord = {
      id: crypto.randomUUID(),
      name,
      folderId:
        effectiveNewProjectFolderId === noProjectFolderId ? '' : effectiveNewProjectFolderId,
      activeConversationId: nextConversation.id,
      updatedAt: now,
      conversations: [nextConversation],
    }

    setProjects((current) => [nextProject, ...current])
    setActiveProjectId(nextProject.id)
    setIsChatStreaming(false)
    resetConversationTransientState()
    setNewProjectName('')
    setNewProjectFolderId(noProjectFolderId)
    setShowCreateProjectCard(false)
    showConversationRoute('intake', {
      mode: 'push',
      projectId: nextProject.id,
      conversationId: nextConversation.id,
    })
  }

  function handleCreateConversation() {
    const now = new Date().toISOString()
    const nextConversation = createEmptyConversation({ now })

    setIsChatStreaming(false)
    resetConversationTransientState()
    updateProject(activeProject.id, (project) => ({
      ...project,
      activeConversationId: nextConversation.id,
      updatedAt: now,
      conversations: sortConversationsForSidebar([nextConversation, ...project.conversations]),
    }))
    showConversationRoute('intake', {
      mode: 'push',
      projectId: activeProject.id,
      conversationId: nextConversation.id,
    })
  }

  function handleSwitchConversation(conversationId: string) {
    if (conversationId === activeProject.activeConversationId) return

    const now = new Date().toISOString()
    const conversationToOpen = activeProject.conversations.find(
      (conversation) => conversation.id === conversationId,
    )
    const resumableStage = conversationToOpen
      ? getResumableConversationStage(conversationToOpen)
      : 'intake'
    setIsChatStreaming(false)
    resetConversationTransientState()
    setIsReaderPreviewVisible(resumableStage === 'confirm')
    updateProject(activeProject.id, (project) => ({
      ...project,
      activeConversationId: conversationId,
      conversations: sortConversationsForSidebar(
        project.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                lastOpenedAt: now,
                step: getStepForStage(getResumableConversationStage(conversation)),
                workflowStage: getResumableConversationStage(conversation),
              }
            : conversation,
        ),
      ),
    }))
    showConversationRoute(resumableStage, {
      mode: 'push',
      projectId: activeProject.id,
      conversationId,
    })
  }

  function rememberExplicitFeedback(input: CreateFeedbackMemoryRequest) {
    if (cloudWorkspaceStatus !== 'ready') return Promise.resolve<FeedbackMemoryDto | null>(null)

    const learningEvidence = buildWritingEditEvidence(
      input,
      analysisByConversation[activeConversation.id]?.contentMode.targetMode ?? 'unclassified',
    )
    const feedbackInput =
      learningEvidence && !input.context?.learningEvidence
        ? {
            ...input,
            context: {
              ...input.context,
              learningEvidence,
            },
          }
        : input
    const payload = workspaceSyncPayload
    const serializedPayload = workspaceSyncSerialized
    const rememberTask = workspaceSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveCloudWorkspace(payload)
        workspaceSyncBaselineRef.current = serializedPayload
        const memory = await rememberCloudFeedback(feedbackInput)
        recentFeedbackMemoriesRef.current = [
          memory,
          ...recentFeedbackMemoriesRef.current.filter((item) => item.id !== memory.id),
        ].slice(0, 400)
        return memory
      })
      .catch((error) => {
        console.warn('Writing feedback could not be saved.', error)
        return null
      })
    workspaceSaveQueueRef.current = rememberTask.then(() => undefined)
    return rememberTask
  }

  function mergeWritingFeedback(extraFeedback: FeedbackMemoryDto[] = []) {
    const merged = new Map<string, FeedbackMemoryDto>()
    for (const memory of [
      ...extraFeedback,
      ...recentFeedbackMemoriesRef.current,
      ...cloudFeedbackMemories,
    ]) {
      if (!merged.has(memory.id)) merged.set(memory.id, memory)
    }
    return Array.from(merged.values()).slice(0, 400)
  }

  function buildWritingLibraryEvidence(
    notes: SavedNoteRecord[],
    snippets: SavedSnippetRecord[],
  ) {
    const noteIdByUrl = new Map(
      learningReadyNotes.map((note) => [normalizeNoteUrl(note.sourceUrl), note.id]),
    )

    return {
      notes: notes.slice(0, 60).map((note) => ({
        id: note.id,
        title: note.title,
        contentText: note.contentText,
      })),
      snippets: snippets.slice(0, 240).map((snippet) => ({
        id: snippet.id,
        noteId: noteIdByUrl.get(normalizeNoteUrl(snippet.noteUrl)),
        selectedText: snippet.selectedText,
        reasonText: snippet.reasonText,
        colorTagName: snippet.colorTagName,
      })),
    }
  }

  function toWritingFeedbackEvidence(memories: FeedbackMemoryDto[]) {
    return memories.map((memory) => ({
      id: memory.id,
      projectId: memory.projectId,
      type: memory.type,
      content: memory.content,
      context: memory.context,
      source: memory.source,
      createdAt: memory.createdAt,
    }))
  }

  async function refreshWritingProfiles(options: {
    accessToken?: string
    extraFeedback?: FeedbackMemoryDto[]
    silent?: boolean
  } = {}) {
    if (cloudWorkspaceStatus !== 'ready') {
      if (!options.silent) setWritingProfileError('登录后才能持续学习表达习惯。')
      return false
    }

    if (!options.silent) setIsWritingProfileLoading(true)
    setWritingProfileError('')

    try {
      await workspaceSaveQueueRef.current.catch(() => undefined)
      const accessToken = options.accessToken || await getCurrentAccessToken()
      if (!accessToken) throw new Error('登录状态已过期，请重新登录后再更新表达档案。')

      const allFeedback = mergeWritingFeedback(options.extraFeedback)
      const projectFeedback = allFeedback.filter(
        (memory) => memory.projectId === activeProject.id,
      )
      const accountLibraryEvidence = buildWritingLibraryEvidence(
        learningReadyNotes,
        learningReadySnippets,
      )
      const projectLibraryEvidence = buildWritingLibraryEvidence(
        selectedNotes,
        selectedSnippets,
      )
      const accountEvidenceCount =
        accountLibraryEvidence.notes.length +
        accountLibraryEvidence.snippets.length +
        allFeedback.length
      const projectEvidenceCount =
        projectLibraryEvidence.notes.length +
        projectLibraryEvidence.snippets.length +
        projectFeedback.length

      const learningTasks: Promise<unknown>[] = []
      if (accountEvidenceCount > 0) {
        learningTasks.push(
          buildWritingProfile(accessToken, {
            scope: 'account',
            libraryEvidence: accountLibraryEvidence,
            feedbackEvidence: toWritingFeedbackEvidence(allFeedback),
          }),
        )
      }
      if (projectEvidenceCount > 0) {
        learningTasks.push(
          buildWritingProfile(accessToken, {
            scope: 'project',
            projectId: activeProject.id,
            projectContext: {
              projectName: activeProject.name,
              topic: activeConversation.topic,
              targetAudience: activeConversation.targetAudience,
            },
            libraryEvidence: projectLibraryEvidence,
            feedbackEvidence: toWritingFeedbackEvidence(projectFeedback),
          }),
        )
      }

      await Promise.all(learningTasks)
      const profiles = await getWritingProfile(accessToken, activeProject.id)
      setWritingProfileContext({
        accountProfile: profiles.accountProfile,
        projectProfile: profiles.projectProfile,
      })
      return true
    } catch (error) {
      setWritingProfileError(getErrorMessage(error))
      return false
    } finally {
      if (!options.silent) setIsWritingProfileLoading(false)
    }
  }

  async function handleOpenWritingProfile() {
    setIsWritingProfileOpen(true)
    setWritingProfileError('')
    if (cloudWorkspaceStatus !== 'ready') {
      setWritingProfileContext({ accountProfile: null, projectProfile: null })
      setWritingProfileError('登录后，系统才会跨设备保存并学习你的表达习惯。')
      return
    }

    setIsWritingProfileLoading(true)
    try {
      const accessToken = await getCurrentAccessToken()
      if (!accessToken) throw new Error('登录状态已过期，请重新登录后再查看表达档案。')
      const profiles = await getWritingProfile(accessToken, activeProject.id)
      setWritingProfileContext({
        accountProfile: profiles.accountProfile,
        projectProfile: profiles.projectProfile,
      })
    } catch (error) {
      setWritingProfileError(getErrorMessage(error))
    } finally {
      setIsWritingProfileLoading(false)
    }
  }

  async function handleAddWritingProfileCorrection(input: {
    scope: WritingProfileScope
    content: string
  }) {
    setIsWritingProfileSaving(true)
    setWritingProfileError('')
    try {
      const memory = await rememberExplicitFeedback({
        projectId: input.scope === 'project' ? activeProject.id : undefined,
        conversationId: activeConversation.id,
        type: 'profile_correction',
        content: input.content,
        context: {
          scope: input.scope,
          projectName: activeProject.name,
          step: activeConversation.step,
        },
        source: 'explicit_profile_correction',
      })
      if (!memory) throw new Error('这条表达习惯暂时没有保存成功，请稍后重试。')

      const refreshed = await refreshWritingProfiles({ extraFeedback: [memory], silent: true })
      if (!refreshed) throw new Error('规则已经保存，但表达档案暂时没有刷新成功。')
      return true
    } catch (error) {
      setWritingProfileError(getErrorMessage(error))
      return false
    } finally {
      setIsWritingProfileSaving(false)
    }
  }

  async function handleManageWritingPreference(input: {
    scope: WritingProfileScope
    preference: WritingPreference
    action: 'enable' | 'disable' | 'delete' | 'correct'
    content?: string
  }) {
    setIsWritingProfileSaving(true)
    setWritingProfileError('')
    try {
      const revision =
        input.scope === 'account'
          ? writingProfileContext.accountProfile
          : writingProfileContext.projectProfile
      if (!revision) throw new Error('表达档案已经变化，请重新打开后再操作。')

      const content =
        input.action === 'correct' ? input.content?.trim() ?? '' : input.preference.statement
      if (!content) throw new Error('请输入修改后的表达规则。')

      const memory = await rememberExplicitFeedback({
        projectId: input.scope === 'project' ? activeProject.id : undefined,
        conversationId: activeConversation.id,
        type: 'profile_correction',
        content,
        context: {
          scope: input.scope,
          projectName: activeProject.name,
          step: activeConversation.step,
          preferenceAction: {
            action: input.action,
            preferenceId: input.preference.id,
            snapshot: input.preference,
          },
        },
        source: 'profile_preference_management',
      })
      if (!memory) throw new Error('这条规则暂时没有更新成功，请稍后重试。')

      const accessToken = await getCurrentAccessToken()
      if (!accessToken) throw new Error('登录状态已过期，请重新登录后再管理表达规则。')
      const response = await manageWritingPreference(accessToken, {
        scope: input.scope,
        projectId: input.scope === 'project' ? activeProject.id : undefined,
        preferenceId: input.preference.id,
        action: input.action,
        feedbackMemoryId: memory.id,
        expectedRevisionId: revision.id,
        expectedVersion: revision.version,
      })
      setWritingProfileContext((current) =>
        input.scope === 'account'
          ? { ...current, accountProfile: response.revision }
          : { ...current, projectProfile: response.revision },
      )
      return true
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        (error.code === 'conflict' || error.code === 'not_found')
      ) {
        let message = error.message
        try {
          const accessToken = await getCurrentAccessToken()
          if (accessToken) {
            const profiles = await getWritingProfile(accessToken, activeProject.id)
            setWritingProfileContext({
              accountProfile: profiles.accountProfile,
              projectProfile: profiles.projectProfile,
            })
            message = '表达档案已在其他设备更新，已载入最新版，请确认当前状态后重试。'
          }
        } catch {
          // Keep the original conflict message when the latest profile cannot be loaded.
        }
        setWritingProfileError(message)
        return false
      }
      setWritingProfileError(getErrorMessage(error))
      return false
    } finally {
      setIsWritingProfileSaving(false)
    }
  }

  async function getLibraryAccessToken() {
    const accessToken = await getCurrentAccessToken()
    if (!accessToken) {
      throw new Error('登录状态已过期，请重新登录后再管理文案库。')
    }
    return accessToken
  }

  async function handleCreateLibraryFolder(name: string) {
    const accessToken = await getLibraryAccessToken()
    await createFolder(accessToken, { name })
    cloudLibrary.refresh()
  }

  async function handleUpdateLibraryFolder(folder: SavedFolderRecord, name: string) {
    const accessToken = await getLibraryAccessToken()
    try {
      const response = await updateFolder(accessToken, folder.id, {
        name,
        expectedUpdatedAt: folder.updatedAt,
      })
      return response.folder
    } finally {
      cloudLibrary.refresh()
    }
  }

  async function handleDeleteLibraryFolder(folder: SavedFolderRecord) {
    const accessToken = await getLibraryAccessToken()
    await deleteFolder(accessToken, folder.id)
    cloudLibrary.refresh()
  }

  async function handleSaveLibraryNote(
    note: SavedNoteRecord,
    draft: {
      authorName: string
      contentText: string
      filename: string
      folderId: string
      title: string
    },
  ) {
    const accessToken = await getLibraryAccessToken()
    const folderId = libraryFolders.some((folder) => folder.id === draft.folderId)
      ? draft.folderId
      : null

    const filename = draft.filename || draft.title || note.filename
    const title = draft.title || draft.filename || note.title
    const isNameOnlyUpdate =
      Boolean(note.updatedAt) &&
      draft.authorName === note.authorName &&
      draft.contentText === note.contentText &&
      folderId === (note.folderId || null)

    try {
      if (isNameOnlyUpdate && note.updatedAt) {
        const response = await updateNote(accessToken, note.id, {
          filename,
          title,
          expectedUpdatedAt: note.updatedAt,
        })
        return { ...response.note, coverImageUrl: response.note.coverImageUrl ?? '' }
      }

      const response = await upsertNote(accessToken, {
        authorName: draft.authorName,
        contentText: draft.contentText,
        coverImageUrl: note.coverImageUrl ?? '',
        filename,
        folderId,
        savedAt: note.savedAt,
        sourceUrl: note.sourceUrl,
        title,
      })
      return { ...response.note, coverImageUrl: response.note.coverImageUrl ?? '' }
    } finally {
      cloudLibrary.refresh()
    }
  }

  async function handleDeleteLibraryNote(note: SavedNoteRecord) {
    const accessToken = await getLibraryAccessToken()
    await deleteNote(accessToken, note.id)
    const normalizedNoteUrl = normalizeNoteUrl(note.sourceUrl)
    const removedSnippetIds = new Set(
      librarySnippets
        .filter((snippet) => normalizeNoteUrl(snippet.noteUrl) === normalizedNoteUrl)
        .map((snippet) => `snippet:${snippet.id}`),
    )
    const removedNoteId = `note:${note.id}`

    setProjects((current) =>
      current.map((project) => ({
        ...project,
        conversations: project.conversations.map((conversation) => ({
          ...conversation,
          selectedItemIds: conversation.selectedItemIds.filter(
            (itemId) => itemId !== removedNoteId && !removedSnippetIds.has(itemId),
          ),
        })),
      })),
    )
    cloudLibrary.refresh()
  }

  async function handleUpdateLibraryNoteLearningStatus(
    note: SavedNoteRecord,
    status: Extract<NoteLearningStatus, 'ready' | 'excluded'>,
  ) {
    const accessToken = await getLibraryAccessToken()
    await updateNoteLearningStatus(accessToken, note.id, { status })
    cloudLibrary.refresh()
  }

  async function handleRestoreLibraryFolder(folderId: string) {
    const accessToken = await getLibraryAccessToken()
    await restoreFolder(accessToken, folderId)
    cloudLibrary.refresh()
  }

  async function handleRestoreLibraryNote(noteId: string) {
    const accessToken = await getLibraryAccessToken()
    await restoreNote(accessToken, noteId)
    cloudLibrary.refresh()
  }

  async function handleDeleteLibraryFolderPermanently(folderId: string) {
    const accessToken = await getLibraryAccessToken()
    await deleteFolderPermanently(accessToken, folderId)
    cloudLibrary.refresh()
  }

  async function handleDeleteLibraryNotePermanently(noteId: string) {
    const accessToken = await getLibraryAccessToken()
    await deleteNotePermanently(accessToken, noteId)
    cloudLibrary.refresh()
  }

  async function handleEmptyLibraryTrash() {
    const accessToken = await getLibraryAccessToken()
    await emptyTrash(accessToken)
    cloudLibrary.refresh()
  }

  async function handleSaveLibraryNoteSnippets(
    note: SavedNoteRecord,
    drafts: Array<{
      id: string
      colorTagName: string
      colorValue: string
      reasonText: string
      selectedText: string
    }>,
    existingSnippets: SavedSnippetRecord[],
  ) {
    const accessToken = await getLibraryAccessToken()
    const existingIds = new Set(existingSnippets.map((snippet) => snippet.id))
    const savedDraftIds = new Set<string>()

    for (const draft of drafts) {
      const selectedText = draft.selectedText.trim()
      if (!selectedText) continue

      if (existingIds.has(draft.id)) {
        await updateSnippet(accessToken, draft.id, {
          colorTagName: draft.colorTagName,
          colorValue: draft.colorValue,
          reasonText: draft.reasonText,
          selectedText,
        })
        savedDraftIds.add(draft.id)
        continue
      }

      await createSnippet(accessToken, {
        noteId: note.id,
        colorTagName: draft.colorTagName,
        colorValue: draft.colorValue,
        reasonText: draft.reasonText,
        selectedText,
      })
    }

    for (const snippet of existingSnippets) {
      if (savedDraftIds.has(snippet.id)) continue
      await deleteSnippet(accessToken, snippet.id)
    }

    cloudLibrary.refresh()
  }

  function handleConversationTitleChange(conversationId: string, title: string) {
    const now = new Date().toISOString()

    updateProject(activeProject.id, (project) => ({
      ...project,
      updatedAt: now,
      conversations: sortConversationsForSidebar(
        project.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                title,
                updatedAt: now,
              }
            : conversation,
        ),
      ),
    }))
  }

  function handleToggleConversationPin(conversationId: string) {
    const now = new Date().toISOString()

    updateProject(activeProject.id, (project) => ({
      ...project,
      updatedAt: now,
      conversations: sortConversationsForSidebar(
        project.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                pinned: !conversation.pinned,
                updatedAt: now,
              }
            : conversation,
        ),
      ),
    }))
  }

  function startSidebarConversationRename(conversation: ConversationRecord) {
    setDraftSidebarConversationTitle(conversation.title)
    setRenamingSidebarConversationId(conversation.id)
    setOpenSidebarConversationMenuId('')
  }

  function commitSidebarConversationRename(conversation: ConversationRecord) {
    const nextTitle = draftSidebarConversationTitle.replace(/\s+/g, ' ').trim()
    if (nextTitle && nextTitle !== conversation.title) {
      handleConversationTitleChange(conversation.id, nextTitle)
    }
    setRenamingSidebarConversationId('')
  }

  function cancelSidebarConversationRename() {
    setRenamingSidebarConversationId('')
    setDraftSidebarConversationTitle('')
  }

  function handleToggleItems(itemIds: string[]) {
    if (referenceSelectionDraftByConversation[activeConversation.id] !== undefined) {
      setReferenceSelectionDraftByConversation((current) => {
        const nextIds = new Set(current[activeConversation.id] ?? [])
        const allSelected = itemIds.every((itemId) => nextIds.has(itemId))
        itemIds.forEach((itemId) => {
          if (allSelected) nextIds.delete(itemId)
          else nextIds.add(itemId)
        })
        return { ...current, [activeConversation.id]: Array.from(nextIds) }
      })
      return
    }

    invalidateAnalysisAndDraft(activeConversation.id)
    updateConversation(activeProject.id, activeConversation.id, (conversation) => {
      const currentIds = new Set(conversation.selectedItemIds)
      const allSelected = itemIds.every((itemId) => currentIds.has(itemId))

      if (allSelected) {
        itemIds.forEach((itemId) => currentIds.delete(itemId))
      } else {
        itemIds.forEach((itemId) => currentIds.add(itemId))
      }

      return {
        ...conversation,
        selectedItemIds: Array.from(currentIds),
        analysisReady: false,
        finalizedAt: undefined,
      }
    })
  }

  function handleSelectItems(itemIds: string[]) {
    if (referenceSelectionDraftByConversation[activeConversation.id] !== undefined) {
      setReferenceSelectionDraftByConversation((current) => ({
        ...current,
        [activeConversation.id]: Array.from(
          new Set([...(current[activeConversation.id] ?? []), ...itemIds]),
        ),
      }))
      return
    }

    invalidateAnalysisAndDraft(activeConversation.id)
    setAnalysisErrorByConversation((current) => {
      const next = { ...current }
      delete next[activeConversation.id]
      return next
    })
    setAnalysisUsageByConversation((current) => {
      const next = { ...current }
      delete next[activeConversation.id]
      return next
    })
    updateConversation(activeProject.id, activeConversation.id, (conversation) => {
      const currentIds = new Set(conversation.selectedItemIds)
      itemIds.forEach((itemId) => currentIds.add(itemId))

      return {
        ...conversation,
        selectedItemIds: Array.from(currentIds),
        analysisReady: false,
        finalizedAt: undefined,
      }
    })
  }

  function handleDeselectItems(itemIds: string[]) {
    if (referenceSelectionDraftByConversation[activeConversation.id] !== undefined) {
      const removedIds = new Set(itemIds)
      setReferenceSelectionDraftByConversation((current) => ({
        ...current,
        [activeConversation.id]: (current[activeConversation.id] ?? []).filter(
          (itemId) => !removedIds.has(itemId),
        ),
      }))
      return
    }

    invalidateAnalysisAndDraft(activeConversation.id)
    setAnalysisErrorByConversation((current) => {
      const next = { ...current }
      delete next[activeConversation.id]
      return next
    })
    setAnalysisUsageByConversation((current) => {
      const next = { ...current }
      delete next[activeConversation.id]
      return next
    })
    updateConversation(activeProject.id, activeConversation.id, (conversation) => {
      const currentIds = new Set(conversation.selectedItemIds)
      itemIds.forEach((itemId) => currentIds.delete(itemId))

      return {
        ...conversation,
        selectedItemIds: Array.from(currentIds),
        analysisReady: false,
        finalizedAt: undefined,
      }
    })
  }

  async function handleStartAnalysis() {
    if (isChatStreaming) return

    const projectId = activeProject.id
    const conversationId = activeConversation.id
    const referenceSelectionDraft = referenceSelectionDraftByConversation[conversationId]
    const previousDraftWasReady = Boolean(draftReadyByConversation[conversationId])
    const previousAnalysis = analysisByConversation[conversationId]
    const previousConversationState = {
      analysisReady: activeConversation.analysisReady,
      finalizedAt: activeConversation.finalizedAt,
      selectedItemIds: [...activeConversation.selectedItemIds],
      step: activeConversation.step,
      workflowStage: activeConversation.workflowStage,
    }

    const restorePreviousDraft = () => {
      if (!previousDraftWasReady) return
      setDraftReadyByConversation((current) => ({ ...current, [conversationId]: true }))
      if (previousAnalysis) {
        setAnalysisByConversation((current) => ({ ...current, [conversationId]: previousAnalysis }))
      }
      updateConversation(projectId, conversationId, (conversation) => ({
        ...conversation,
        ...previousConversationState,
      }))
      if (referenceSelectionDraft !== undefined) {
        setReferenceSelectionDraftByConversation((current) => ({
          ...current,
          [conversationId]: referenceSelectionDraft,
        }))
      }
    }

    if (referenceSelectionDraft !== undefined) {
      updateConversation(projectId, conversationId, (conversation) => ({
        ...conversation,
        selectedItemIds: referenceSelectionDraft,
      }))
      setReferenceSelectionDraftByConversation((current) => {
        const next = { ...current }
        delete next[conversationId]
        return next
      })
    }

    setIsChatStreaming(true)
    setAnalysisPendingConversationId(conversationId)
    setAnalysisWaitStartedAt(Date.now())
    setAiWaitTick(Date.now())
    setAnalysisErrorByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setAnalysisUsageByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setDraftReadyByConversation((current) => ({
      ...current,
      [conversationId]: false,
    }))
    setDraftGenerationErrorByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setDraftUsageByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    updateConversation(projectId, conversationId, (conversation) => ({
      ...conversation,
      finalizedAt: undefined,
      length: conversation.length ?? 'medium',
    }))
    try {
      let nextAnalysis = fallbackAnalysis

      if (isUsingCloudLibrary && cloudLibrary.status === 'ready') {
        const accessToken = await getCurrentAccessToken()
        if (!accessToken) {
          throw new Error('登录状态已过期，请重新登录后再开始分析。')
        }

        if (selectedNotes.length > 0) {
          const response = await analyzeReferences(accessToken, {
            projectName: activeProject.name,
            folderName: selectedFolderName,
            topic: activeConversation.topic,
            targetAudience: activeConversation.targetAudience,
            length: effectiveLength,
            notes: selectedNotes,
            snippets: selectedSnippets,
          })
          nextAnalysis = response.analysis
          setAnalysisUsageByConversation((current) => ({
            ...current,
            [conversationId]: response.usage,
          }))
        }

        // Learning finishes before drafting so this generation can use the newest profile.
        await refreshWritingProfiles({ accessToken, silent: true })
      }

      const analysisMessages = buildAnalysisChat(nextAnalysis)
      setAnalysisByConversation((current) => ({
        ...current,
        [conversationId]: nextAnalysis,
      }))
      updateConversation(projectId, conversationId, (conversation) => ({
        ...conversation,
        analysisReady: true,
      }))

      updateConversation(projectId, conversationId, (conversation) => ({
        ...conversation,
        chatMessages: [...conversation.chatMessages, ...analysisMessages],
      }))

      const draftGenerated = await generateDraftForAnalysis(nextAnalysis, false)
      if (!draftGenerated) {
        if (previousDraftWasReady) restorePreviousDraft()
        else {
          updateConversationStage(projectId, conversationId, 'draft')
          if (
            activeConversationRouteRef.current.projectId === projectId &&
            activeConversationRouteRef.current.conversationId === conversationId
          ) {
            showConversationRoute('draft', { projectId, conversationId })
          }
        }
      }
    } catch (error) {
      const message = getErrorMessage(error)
      const friendlyMessage = message.includes('DeepSeek API key')
        ? 'AI 服务暂时不可用，稍后可直接重试本次分析。'
        : message
      setAnalysisErrorByConversation((current) => ({
        ...current,
        [conversationId]: friendlyMessage,
      }))
      updateConversation(projectId, conversationId, (conversation) => ({
        ...conversation,
        analysisReady: false,
      }))
      restorePreviousDraft()
    } finally {
      setIsChatStreaming(false)
      setAnalysisPendingConversationId((current) => (current === conversationId ? '' : current))
      setAnalysisWaitStartedAt(null)
    }
  }

  async function generateDraftForAnalysis(
    nextAnalysis: AiAnalysisResult,
    requireReadyState = true,
    allowConservativeDraft = false,
  ) {
    if (
      (requireReadyState && !canGenerateDraft) ||
      !isWritingBriefValid ||
      draftGeneratingConversationId
    ) {
      return false
    }

    const projectId = activeProject.id
    const conversationId = activeConversation.id
    const previousDraftWasReady = Boolean(draftReadyByConversation[conversationId])

    setDraftGeneratingConversationId(conversationId)
    setDraftWaitStartedAt(Date.now())
    setAiWaitTick(Date.now())
    setDraftReadyByConversation((current) => ({
      ...current,
      [conversationId]: false,
    }))
    setDraftGenerationErrorByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setDraftUsageByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })

    try {
      let nextDraft = generatedInitialDraftCopy
      let appliedWritingProfile: AppliedWritingProfileContext = {
        account: null,
        project: null,
      }
      let qualitySnapshot: DraftQualitySnapshot | null = null

      if (isUsingCloudLibrary) {
        if (selectedNotes.length > 0 && cloudLibrary.status !== 'ready') {
          throw new Error('云端资料库还在连接中，稍等一下再生成。')
        }

        const accessToken = await getCurrentAccessToken()
        if (!accessToken) {
          throw new Error('登录状态已过期，请重新登录后再生成初稿。')
        }

        const response = await generateDraft(accessToken, {
          projectId,
          projectName: activeProject.name,
          topic: activeConversation.topic,
          targetAudience: activeConversation.targetAudience,
          length: effectiveLength,
          analysis: nextAnalysis,
          notes: selectedNotes,
          snippets: selectedSnippets,
          brief: {
            ...creationBrief,
            allowConservativeDraft,
          },
        })
        if (response.status === 'insufficient_facts') {
          setDraftFactGapByConversation((current) => ({
            ...current,
            [conversationId]: response.assessment,
          }))
          setIsWritingBriefOpen(true)
          return false
        }
        nextDraft = response.draft
        appliedWritingProfile = response.appliedWritingProfile
        qualitySnapshot = response.quality
        setDraftFactGapByConversation((current) => {
          const next = { ...current }
          delete next[conversationId]
          return next
        })
        setDraftUsageByConversation((current) => ({
          ...current,
          [conversationId]: response.usage,
        }))
      }

      recordDraftSnapshot(
        conversationId,
        nextDraft,
        isUsingCloudLibrary ? 'ai_generation' : 'demo_generation',
        { force: true, appliedWritingProfile, qualitySnapshot },
      )
      setDraftBridgeMessagesByConversation((current) => {
        const next = { ...current }
        delete next[conversationId]
        return next
      })
      setDraftMoveHistoryByConversation((current) => {
        const next = { ...current }
        delete next[conversationId]
        return next
      })
      setDraftDragSelection(null)
      setDraftPointerDrag(null)
      setDraftDropTarget(null)
      setDraftDropLanding(null)
      setDraftMovePrompt(null)

      updateConversation(projectId, conversationId, (conversation) => ({
        ...conversation,
        finalizedAt: undefined,
        step: 'rewrite',
        workflowStage: 'review',
      }))
      if (
        activeConversationRouteRef.current.projectId === projectId &&
        activeConversationRouteRef.current.conversationId === conversationId
      ) {
        showConversationRoute('review', { projectId, conversationId })
      }
      return true
    } catch (error) {
      const message = getErrorMessage(error)
      setDraftGenerationErrorByConversation((current) => ({
        ...current,
        [conversationId]: message.includes('DeepSeek API key')
          ? 'AI 服务暂时不可用，请稍后重试。'
          : message,
      }))
      if (previousDraftWasReady) {
        setDraftReadyByConversation((current) => ({
          ...current,
          [conversationId]: true,
        }))
      }
      return false
    } finally {
      setDraftGeneratingConversationId((current) => (current === conversationId ? '' : current))
      setDraftWaitStartedAt(null)
    }
  }

  async function handleGenerateDraft() {
    await generateDraftForAnalysis(analysis)
  }

  async function handleGenerateConservativeDraft() {
    await generateDraftForAnalysis(analysis, true, true)
  }

  async function handleSendChat() {
    if (isChatStreaming) return

    const question = chatInput.trim()
    if (!question) return

    const projectId = activeProject.id
    const conversationId = activeConversation.id
    const isPlanInstruction = getConversationStep(activeConversation) === 'plan'
    const shouldGenerateTitle =
      activeConversation.chatMessages.length === 0 &&
      isDefaultConversationTitle(activeConversation.title)
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      stage: activeConversation.analysisReady ? 'followup' : 'setup',
      lines: [question],
    }

    if (isPlanInstruction) invalidateDraftOutputs(conversationId)
    updateConversation(projectId, conversationId, (conversation) => ({
      ...conversation,
      title: shouldGenerateTitle ? buildConversationTitleFromPrompt(question) : conversation.title,
      finalizedAt: isPlanInstruction ? undefined : conversation.finalizedAt,
      writingBrief: isPlanInstruction
        ? {
            ...conversation.writingBrief,
            instructions: [conversation.writingBrief.instructions.trim(), question]
              .filter(Boolean)
              .join('\n'),
          }
        : conversation.writingBrief,
      chatMessages: [...conversation.chatMessages, userMessage],
    }))
    setChatInput('')

    const reply = isPlanInstruction
      ? {
          stage: 'followup' as const,
          title: '已加入创作简报',
          lines: ['这条要求会参与下一次生成。简报已变化，当前初稿需要重新生成。'],
        }
      : activeConversation.analysisReady
        ? buildAssistantReply(question, analysis)
        : buildSetupReply(question)

    setIsChatStreaming(true)
    await sleep(220)

    updateConversation(projectId, conversationId, (conversation) => ({
      ...conversation,
      chatMessages: [
        ...conversation.chatMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          stage: reply.stage,
          title: reply.title,
          lines: reply.lines,
        },
      ],
    }))

    setIsChatStreaming(false)
  }

  function normalizeDraftSelection(value: string) {
    return value.replace(/\s+/g, ' ').trim()
  }

  function clampViewportPosition(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max)
  }

  function getElementFromEventTarget(target: EventTarget | null) {
    if (target instanceof Element) return target
    if (target instanceof Node) return target.parentElement
    return null
  }

  function getRewriteFieldElement(node: Node | null) {
    if (!node) return null

    const element = node instanceof Element ? node : node.parentElement
    return element?.closest<HTMLElement>('[data-rewrite-field]') ?? null
  }

  function clearRewriteSelection() {
    setSelectedRewriteText('')
    setSelectedRewriteFieldId('')
    setRewriteSelectionCandidate(null)
    window.getSelection()?.removeAllRanges()
  }

  function handleCaptureRewriteSelection(
    event:
      | ReactKeyboardEvent<HTMLElement>
      | ReactMouseEvent<HTMLElement>
      | ReactPointerEvent<HTMLElement>,
  ) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      setRewriteSelectionCandidate(null)
      return
    }

    const anchorField = getRewriteFieldElement(selection.anchorNode)
    const focusField = getRewriteFieldElement(selection.focusNode)
    if (
      !anchorField ||
      !focusField ||
      anchorField !== focusField ||
      !event.currentTarget.contains(anchorField)
    ) {
      setRewriteSelectionCandidate(null)
      return
    }

    const text = normalizeDraftSelection(selection.toString())
    if (text.length < 2) {
      setRewriteSelectionCandidate(null)
      return
    }

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect()
    const clientRects = range ? Array.from(range.getClientRects()) : []
    const fieldRect = anchorField.getBoundingClientRect()
    const selectionRect =
      rect && (rect.width > 0 || rect.height > 0)
        ? rect
        : clientRects[clientRects.length - 1] ?? fieldRect
    if (!selectionRect) {
      setRewriteSelectionCandidate(null)
      return
    }

    const margin = 12
    const buttonWidth = 116
    const buttonHeight = 36
    const left = Math.min(
      Math.max(selectionRect.right + 8, margin),
      window.innerWidth - buttonWidth - margin,
    )
    const top = Math.min(
      Math.max(selectionRect.top + selectionRect.height / 2 - buttonHeight / 2, margin),
      window.innerHeight - buttonHeight - margin,
    )

    setRewriteSelectionCandidate({
      text,
      fieldId: anchorField.dataset.rewriteField ?? '',
      position: { left, top },
    })
  }

  function handleConfirmRewriteSelection() {
    if (!rewriteSelectionCandidate) return

    setSelectedRewriteText(rewriteSelectionCandidate.text)
    setSelectedRewriteFieldId(rewriteSelectionCandidate.fieldId)
    setRewriteSelectionCandidate(null)
    window.getSelection()?.removeAllRanges()
    window.setTimeout(() => rewriteInputRef.current?.focus(), 0)
  }

  function normalizeEditableDraftText(value: string) {
    return value
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n$/, '')
  }

  function commitRewriteDraftFieldEdit(fieldId: string, nextValue: string) {
    const normalizedValue = normalizeEditableDraftText(nextValue)
    const previousValue = getDraftFieldValue(initialDraftCopy, fieldId)
    if (previousValue === normalizedValue) return

    const nextDraft = setDraftFieldValue(initialDraftCopy, fieldId, normalizedValue)
    recordDraftSnapshot(activeConversation.id, nextDraft, 'manual_edit', { coalesce: true })
    markDraftEdited()

    rememberExplicitFeedback({
      projectId: activeProject.id,
      conversationId: activeConversation.id,
      type: 'manual_edit',
      content: normalizedValue,
      context: {
        fieldId,
        beforeText: previousValue,
        afterText: normalizedValue,
        draftAppliedPreferenceIds: activeAppliedPreferenceIds,
        step: 'rewrite',
      },
      source: 'manual_editor',
    })

    if (
      selectedRewriteFieldId === fieldId &&
      selectedRewriteText &&
      !normalizedValue.includes(selectedRewriteText)
    ) {
      clearRewriteSelection()
    }
  }

  function handleRewriteDraftFieldInput(
    fieldId: string,
    event: ReactFormEvent<HTMLElement>,
  ) {
    const normalizedValue = normalizeEditableDraftText(event.currentTarget.innerText)

    if (activeConversation.finalizedAt) {
      markDraftEdited()
    }

    if (
      selectedRewriteFieldId === fieldId &&
      selectedRewriteText &&
      !normalizedValue.includes(selectedRewriteText)
    ) {
      clearRewriteSelection()
    }
  }

  function handleRewriteDraftFieldBlur(
    fieldId: string,
    event: ReactFocusEvent<HTMLElement>,
  ) {
    commitRewriteDraftFieldEdit(fieldId, event.currentTarget.innerText)
  }

  function handleRewriteDraftFieldPaste(event: ReactClipboardEvent<HTMLElement>) {
    event.preventDefault()
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
  }

  function handleRewriteTitleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      document.querySelector<HTMLElement>('[data-rewrite-field="body-0"]')?.focus()
    }
  }

  function getDraftFieldValue(draft: InitialDraftCopy, fieldId: string) {
    if (fieldId === 'title') return draft.title

    const bodyIndex = Number(fieldId.replace('body-', ''))
    return Number.isFinite(bodyIndex) ? draft.body[bodyIndex] ?? '' : ''
  }

  function getDraftBodyIndex(fieldId: string) {
    const bodyIndex = Number(fieldId.replace('body-', ''))
    return Number.isFinite(bodyIndex) ? bodyIndex : -1
  }

  function getDraftFieldSortValue(fieldId: string) {
    if (fieldId === 'title') return -1
    const bodyIndex = getDraftBodyIndex(fieldId)
    return bodyIndex >= 0 ? bodyIndex : Number.MAX_SAFE_INTEGER
  }

  function setDraftFieldValue(
    draft: InitialDraftCopy,
    fieldId: string,
    nextValue: string,
  ): InitialDraftCopy {
    if (fieldId === 'title') {
      return {
        ...draft,
        title: nextValue,
      }
    }

    const bodyIndex = Number(fieldId.replace('body-', ''))
    if (!Number.isFinite(bodyIndex)) return draft

    return {
      ...draft,
      body: draft.body.map((paragraph, index) =>
        index === bodyIndex ? nextValue : paragraph,
      ),
    }
  }

  function getTextOffsetInDraftField(field: HTMLElement, targetNode: Node, targetOffset: number) {
    const fieldTextLength = field.textContent?.length ?? 0

    if (targetNode === field || field.contains(targetNode)) {
      const range = field.ownerDocument.createRange()

      try {
        range.selectNodeContents(field)
        range.setEnd(targetNode, targetOffset)
        return Math.min(Math.max(range.toString().length, 0), fieldTextLength)
      } catch {
        // Fall through to the text-node walker for older/odd browser range endpoints.
      } finally {
        range.detach()
      }
    }

    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT)
    let cursor = 0
    let currentNode = walker.nextNode()

    while (currentNode) {
      const textLength = currentNode.textContent?.length ?? 0
      if (currentNode === targetNode) {
        return cursor + Math.min(targetOffset, textLength)
      }
      cursor += textLength
      currentNode = walker.nextNode()
    }

    return fieldTextLength
  }

  function getDraftDropIndexFromPoint(field: HTMLElement, clientX: number, clientY: number) {
    const documentWithCaret = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const caretPosition = documentWithCaret.caretPositionFromPoint?.(clientX, clientY)
    if (caretPosition && field.contains(caretPosition.offsetNode)) {
      return getTextOffsetInDraftField(field, caretPosition.offsetNode, caretPosition.offset)
    }

    const range = documentWithCaret.caretRangeFromPoint?.(clientX, clientY)
    if (range && field.contains(range.startContainer)) {
      return getTextOffsetInDraftField(field, range.startContainer, range.startOffset)
    }

    const fieldRect = field.getBoundingClientRect()
    const textLength = field.textContent?.length ?? 0
    if (clientY < fieldRect.top || clientX < fieldRect.left) return 0
    if (clientY > fieldRect.bottom || clientX > fieldRect.right) return textLength

    return Math.round(textLength / 2)
  }

  function getDraftCaretMetricsFromPoint(field: HTMLElement, clientX: number, clientY: number) {
    const documentWithCaret = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const fieldRect = field.getBoundingClientRect()
    const fallbackHeight = Number.parseFloat(window.getComputedStyle(field).lineHeight) || 24

    const caretPosition = documentWithCaret.caretPositionFromPoint?.(clientX, clientY)
    if (caretPosition && field.contains(caretPosition.offsetNode)) {
      const range = document.createRange()
      range.setStart(caretPosition.offsetNode, caretPosition.offset)
      range.collapse(true)
      const rect = range.getBoundingClientRect()
      return {
        height: rect.height || fallbackHeight,
        insertIndex: getTextOffsetInDraftField(field, caretPosition.offsetNode, caretPosition.offset),
        left: rect.left || clientX,
        top: rect.top || Math.min(Math.max(clientY - fallbackHeight / 2, fieldRect.top), fieldRect.bottom - fallbackHeight),
      }
    }

    const range = documentWithCaret.caretRangeFromPoint?.(clientX, clientY)
    if (range && field.contains(range.startContainer)) {
      const rect = range.getBoundingClientRect()
      return {
        height: rect.height || fallbackHeight,
        insertIndex: getTextOffsetInDraftField(field, range.startContainer, range.startOffset),
        left: rect.left || clientX,
        top: rect.top || Math.min(Math.max(clientY - fallbackHeight / 2, fieldRect.top), fieldRect.bottom - fallbackHeight),
      }
    }

    return {
      height: fallbackHeight,
      insertIndex: getDraftDropIndexFromPoint(field, clientX, clientY),
      left: clampViewportPosition(clientX, fieldRect.left, fieldRect.right),
      top: Math.min(Math.max(clientY - fallbackHeight / 2, fieldRect.top), fieldRect.bottom - fallbackHeight),
    }
  }

  function getDraftTargetLabel(fieldId: string) {
    if (fieldId === 'title') return '标题'

    const bodyIndex = getDraftBodyIndex(fieldId)
    return bodyIndex >= 0 ? `第 ${bodyIndex + 1} 段` : '正文'
  }

  function getDraftDropTargetFromPoint(
    clientX: number,
    clientY: number,
    selection: DraftDragSelection,
  ): DraftDropTarget | null {
    const fields = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="initial-draft-plan"] [data-draft-field]'),
    )
      .map((field) => ({
        field,
        fieldId: field.dataset.draftField ?? '',
        rect: field.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.rect.top - b.rect.top)

    if (fields.length === 0) return null

    for (let index = 0; index < fields.length - 1; index += 1) {
      const current = fields[index]
      const next = fields[index + 1]
      const gap = next.rect.top - current.rect.bottom
      if (gap >= 10 && clientY > current.rect.bottom && clientY < next.rect.top) {
        const currentBodyIndex = getDraftBodyIndex(current.fieldId)
        const insertBodyIndex = current.fieldId === 'title' ? 0 : currentBodyIndex + 1
        const label =
          current.fieldId === 'title'
            ? '正文开头'
            : currentBodyIndex >= 0
              ? `第 ${currentBodyIndex + 1} 段之后`
              : '正文'

        return {
          indicator: {
            height: 2,
            left: Math.min(current.rect.left, next.rect.left),
            orientation: 'horizontal',
            top: current.rect.bottom + gap / 2,
            width: Math.max(current.rect.width, next.rect.width),
          },
          insertBodyIndex: Math.max(insertBodyIndex, 0),
          kind: 'paragraph',
          targetLabel: label,
        }
      }
    }

    const last = fields[fields.length - 1]
    if (clientY > last.rect.bottom && clientY < last.rect.bottom + 52) {
      const lastBodyIndex = getDraftBodyIndex(last.fieldId)
      return {
        indicator: {
          height: 2,
          left: last.rect.left,
          orientation: 'horizontal',
          top: last.rect.bottom + 16,
          width: last.rect.width,
        },
        insertBodyIndex: Math.max(lastBodyIndex + 1, 0),
        kind: 'paragraph',
        targetLabel: '正文末尾',
      }
    }

    const fieldUnderPointer =
      fields.find(({ rect }) => clientY >= rect.top - 4 && clientY <= rect.bottom + 4) ??
      fields.reduce((closest, candidate) => {
        const closestDistance = Math.min(
          Math.abs(clientY - closest.rect.top),
          Math.abs(clientY - closest.rect.bottom),
        )
        const candidateDistance = Math.min(
          Math.abs(clientY - candidate.rect.top),
          Math.abs(clientY - candidate.rect.bottom),
        )
        return candidateDistance < closestDistance ? candidate : closest
      }, fields[0])

    const caret = getDraftCaretMetricsFromPoint(fieldUnderPointer.field, clientX, clientY)
    if (selection.segments.some(
      (segment) =>
        segment.fieldId === fieldUnderPointer.fieldId &&
        caret.insertIndex >= segment.startIndex &&
        caret.insertIndex <= segment.endIndex,
    )) {
      return null
    }

    return {
      indicator: {
        height: Math.max(caret.height, 20),
        left: caret.left,
        orientation: 'vertical',
        top: caret.top,
        width: 2,
      },
      insertIndex: caret.insertIndex,
      kind: 'inline',
      targetFieldId: fieldUnderPointer.fieldId,
      targetLabel: getDraftTargetLabel(fieldUnderPointer.fieldId),
    }
  }

  function getDraftMovePromptPosition(field: HTMLElement, clientX: number, clientY: number) {
    const cardRect = field.closest('[data-plan-draft-card]')?.getBoundingClientRect()
    const margin = 14
    const bubbleWidth = 304
    const bubbleHeight = 156
    const preferredLeft = (cardRect?.right ?? clientX) + 14

    return {
      left: clampViewportPosition(
        preferredLeft,
        margin,
        window.innerWidth - bubbleWidth - margin,
      ),
      top: clampViewportPosition(
        clientY - 48,
        margin,
        window.innerHeight - bubbleHeight - margin,
      ),
    }
  }

  function applyDraftSelectionSegments(segments: DraftDragSelectionSegment[]) {
    const validSegments = segments
      .filter((segment) => segment.text.trim().length > 0 && segment.endIndex > segment.startIndex)
      .sort(
        (first, second) =>
          getDraftFieldSortValue(first.fieldId) - getDraftFieldSortValue(second.fieldId),
      )

    if (validSegments.length === 0) return false

    const rawText = validSegments.map((segment) => segment.text).join('\n')
    const text = normalizeDraftSelection(rawText)
    if (text.length < 2) return false

    const firstSegment = validSegments[0]
    setDraftDragSelection({
      text,
      rawText,
      fieldId: firstSegment.fieldId,
      startIndex: firstSegment.startIndex,
      endIndex: firstSegment.endIndex,
      segments: validSegments,
    })
    window.getSelection()?.removeAllRanges()
    return true
  }

  function captureDraftCopySelection(container: HTMLElement) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return false

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    if (!range) return false

    const fields = Array.from(container.querySelectorAll<HTMLElement>('[data-draft-field]'))
    const currentDraft = draftCopyByConversation[activeConversation.id] ?? generatedInitialDraftCopy
    const segments = fields
      .map((field) => {
        if (!range.intersectsNode(field)) return null

        const value = getDraftFieldValue(currentDraft, field.dataset.draftField ?? '')
        const startsInField = range.startContainer === field || field.contains(range.startContainer)
        const endsInField = range.endContainer === field || field.contains(range.endContainer)
        const startIndex = startsInField
          ? getTextOffsetInDraftField(field, range.startContainer, range.startOffset)
          : 0
        const endIndex = endsInField
          ? getTextOffsetInDraftField(field, range.endContainer, range.endOffset)
          : value.length
        const safeStartIndex = Math.min(Math.max(startIndex, 0), value.length)
        const safeEndIndex = Math.min(Math.max(endIndex, safeStartIndex), value.length)

        return {
          fieldId: field.dataset.draftField ?? '',
          startIndex: safeStartIndex,
          endIndex: safeEndIndex,
          text: value.slice(safeStartIndex, safeEndIndex),
        }
      })
      .filter((segment): segment is DraftDragSelectionSegment => Boolean(segment))

    return applyDraftSelectionSegments(segments)
  }

  function getDraftFieldFromPoint(container: HTMLElement, clientX: number, clientY: number) {
    const pointedElement = document.elementFromPoint(clientX, clientY)
    const pointedField =
      pointedElement instanceof Element
        ? pointedElement.closest<HTMLElement>('[data-draft-field]')
        : null

    if (pointedField && container.contains(pointedField)) return pointedField

    const fields = Array.from(container.querySelectorAll<HTMLElement>('[data-draft-field]'))
      .map((field) => ({
        field,
        rect: field.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)

    const fieldUnderPoint = fields.find(
      ({ rect }) =>
        clientX >= rect.left - 8 &&
        clientX <= rect.right + 8 &&
        clientY >= rect.top - 8 &&
        clientY <= rect.bottom + 8,
    )
    if (fieldUnderPoint) return fieldUnderPoint.field

    return fields.reduce<HTMLElement | null>((closest, candidate) => {
      if (!closest) return candidate.field
      const closestRect = closest.getBoundingClientRect()
      const closestDistance = Math.min(
        Math.abs(clientY - closestRect.top),
        Math.abs(clientY - closestRect.bottom),
      )
      const candidateDistance = Math.min(
        Math.abs(clientY - candidate.rect.top),
        Math.abs(clientY - candidate.rect.bottom),
      )
      return candidateDistance < closestDistance ? candidate.field : closest
    }, null)
  }

  function getDraftPointTextPosition(
    container: HTMLElement,
    point: DraftSelectionPointerStart | { x: number; y: number },
  ) {
    const preferredField =
      'fieldId' in point
        ? container.querySelector<HTMLElement>(`[data-draft-field="${point.fieldId}"]`)
        : null
    const field = preferredField ?? getDraftFieldFromPoint(container, point.x, point.y)
    if (!field) return null

    return {
      field,
      fieldId: field.dataset.draftField ?? '',
      index: getDraftCaretMetricsFromPoint(field, point.x, point.y).insertIndex,
    }
  }

  function compareDraftTextPositions(
    first: { fieldId: string; index: number },
    second: { fieldId: string; index: number },
  ) {
    const fieldDifference = getDraftFieldSortValue(first.fieldId) - getDraftFieldSortValue(second.fieldId)
    if (fieldDifference !== 0) return fieldDifference
    return first.index - second.index
  }

  function captureDraftPointerSelection(
    container: HTMLElement,
    endPoint: { x: number; y: number },
  ) {
    const startPoint = draftSelectionPointerStartRef.current
    if (!startPoint) return false

    const dragDistance = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y)
    if (dragDistance < 4) return false

    const startPosition = getDraftPointTextPosition(container, startPoint)
    const endPosition = getDraftPointTextPosition(container, endPoint)
    if (!startPosition || !endPosition) return false

    const [selectionStart, selectionEnd] =
      compareDraftTextPositions(startPosition, endPosition) <= 0
        ? [startPosition, endPosition]
        : [endPosition, startPosition]

    const currentDraft = draftCopyByConversation[activeConversation.id] ?? generatedInitialDraftCopy
    const fields = Array.from(container.querySelectorAll<HTMLElement>('[data-draft-field]'))
    const startOrder = getDraftFieldSortValue(selectionStart.fieldId)
    const endOrder = getDraftFieldSortValue(selectionEnd.fieldId)
    const segments = fields
      .filter((field) => {
        const fieldOrder = getDraftFieldSortValue(field.dataset.draftField ?? '')
        return fieldOrder >= startOrder && fieldOrder <= endOrder
      })
      .map((field) => {
        const fieldId = field.dataset.draftField ?? ''
        const value = getDraftFieldValue(currentDraft, fieldId)
        const startIndex = fieldId === selectionStart.fieldId ? selectionStart.index : 0
        const endIndex = fieldId === selectionEnd.fieldId ? selectionEnd.index : value.length
        const safeStartIndex = Math.min(Math.max(startIndex, 0), value.length)
        const safeEndIndex = Math.min(Math.max(endIndex, safeStartIndex), value.length)

        return {
          fieldId,
          startIndex: safeStartIndex,
          endIndex: safeEndIndex,
          text: value.slice(safeStartIndex, safeEndIndex),
        }
      })

    return applyDraftSelectionSegments(segments)
  }

  function clearDraftDragSelection() {
    draftSelectionContainerRef.current = null
    draftSelectionPointerStartRef.current = null
    setDraftDragSelection(null)
    setDraftPointerDrag(null)
    setDraftDropTarget(null)
    window.getSelection()?.removeAllRanges()
  }

  function handleDraftCopyPointerDown(
    event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
  ) {
    draftSelectionContainerRef.current = null
    draftSelectionPointerStartRef.current = null
    if (draftPointerDrag || event.button !== 0) return

    const targetElement = getElementFromEventTarget(event.target)
    if (targetElement?.closest('.draft-selection-group')) return

    const field = targetElement?.closest<HTMLElement>('[data-draft-field]') ?? null
    if (draftDragSelection) {
      clearDraftDragSelection()
    }

    if (field && event.currentTarget.contains(field)) {
      draftSelectionContainerRef.current = event.currentTarget
      draftSelectionPointerStartRef.current = {
        fieldId: field.dataset.draftField ?? '',
        x: event.clientX,
        y: event.clientY,
      }
    }
  }

  function scheduleDraftCopySelection(
    container: HTMLElement,
    endPoint: { x: number; y: number } | null,
  ) {
    if (draftSelectionCaptureTimerRef.current) {
      window.clearTimeout(draftSelectionCaptureTimerRef.current)
    }

    draftSelectionCaptureTimerRef.current = window.setTimeout(() => {
      const capturedNativeSelection = captureDraftCopySelection(container)
      if (!capturedNativeSelection && endPoint) {
        captureDraftPointerSelection(container, endPoint)
      }
      draftSelectionContainerRef.current = null
      draftSelectionPointerStartRef.current = null
      draftSelectionCaptureTimerRef.current = null
    }, 0)
  }

  function handleDraftCopySelection(
    event:
      | ReactMouseEvent<HTMLElement>
      | ReactKeyboardEvent<HTMLElement>
      | ReactPointerEvent<HTMLElement>,
  ) {
    const container = event.currentTarget
    const endPoint = 'clientX' in event ? { x: event.clientX, y: event.clientY } : null
    scheduleDraftCopySelection(container, endPoint)
  }

  function scheduleDraftDropLanding(landing: Omit<DraftDropLanding, 'id'>) {
    if (draftDropLandingTimerRef.current) {
      window.clearTimeout(draftDropLandingTimerRef.current)
    }

    const nextLanding = {
      ...landing,
      id: crypto.randomUUID(),
    }

    setDraftDropLanding(nextLanding)
    draftDropLandingTimerRef.current = window.setTimeout(() => {
      setDraftDropLanding((current) => (current?.id === nextLanding.id ? null : current))
      draftDropLandingTimerRef.current = null
    }, 900)
    return nextLanding
  }

  function pushDraftMoveHistory(conversationId: string, previousDraft: InitialDraftCopy) {
    setDraftMoveHistoryByConversation((current) => {
      const history = current[conversationId] ?? { redo: [], undo: [] }

      return {
        ...current,
        [conversationId]: {
          redo: [],
          undo: [...history.undo, previousDraft].slice(-24),
        },
      }
    })
  }

  function getDraftSelectionParagraphs(selection: DraftDragSelection) {
    const paragraphs = selection.segments
      .map((segment) => segment.text.trim())
      .filter(Boolean)

    if (paragraphs.length > 0) return paragraphs

    const rawParagraphs = selection.rawText
      .split(/\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)

    return rawParagraphs.length > 0 ? rawParagraphs : [selection.text]
  }

  function isFullDraftBodySegment(draft: InitialDraftCopy, segment: DraftDragSelectionSegment) {
    const bodyIndex = getDraftBodyIndex(segment.fieldId)
    if (bodyIndex < 0) return false

    const value = getDraftFieldValue(draft, segment.fieldId)
    return segment.startIndex <= 0 && segment.endIndex >= value.length
  }

  function getRemovedDraftBodyIndexes(
    draft: InitialDraftCopy,
    selection: DraftDragSelection,
  ) {
    return selection.segments
      .filter((segment) => isFullDraftBodySegment(draft, segment))
      .map((segment) => getDraftBodyIndex(segment.fieldId))
      .filter((index) => index >= 0)
      .sort((first, second) => first - second)
  }

  function adjustDraftBodyIndexAfterRemoval(index: number, removedBodyIndexes: number[]) {
    return index - removedBodyIndexes.filter((removedIndex) => removedIndex < index).length
  }

  function adjustDraftFieldIdAfterBodyRemoval(fieldId: string, removedBodyIndexes: number[]) {
    if (fieldId === 'title') return fieldId

    const bodyIndex = getDraftBodyIndex(fieldId)
    if (bodyIndex < 0) return fieldId

    return `body-${adjustDraftBodyIndexAfterRemoval(bodyIndex, removedBodyIndexes)}`
  }

  function removeDraftDragSelectionFromDraft(
    draft: InitialDraftCopy,
    selection: DraftDragSelection,
  ) {
    const removedBodyIndexes = new Set(getRemovedDraftBodyIndexes(draft, selection))
    const draftWithoutPartialSelection = [...selection.segments]
      .filter((segment) => !removedBodyIndexes.has(getDraftBodyIndex(segment.fieldId)))
      .sort(
        (first, second) =>
          getDraftFieldSortValue(second.fieldId) - getDraftFieldSortValue(first.fieldId),
      )
      .reduce((nextDraft, segment) => {
        const value = getDraftFieldValue(nextDraft, segment.fieldId)
        const safeStartIndex = Math.min(Math.max(segment.startIndex, 0), value.length)
        const safeEndIndex = Math.min(Math.max(segment.endIndex, safeStartIndex), value.length)
        return setDraftFieldValue(
          nextDraft,
          segment.fieldId,
          value.slice(0, safeStartIndex) + value.slice(safeEndIndex),
        )
      }, draft)

    if (removedBodyIndexes.size === 0) return draftWithoutPartialSelection

    return {
      ...draftWithoutPartialSelection,
      body: draftWithoutPartialSelection.body.filter(
        (_, index) => !removedBodyIndexes.has(index),
      ),
    }
  }

  function applyDraftDropTarget(
    selection: DraftDragSelection,
    target: DraftDropTarget,
    clientX: number,
    clientY: number,
  ) {
    if (
      target.kind === 'inline' &&
      selection.segments.some(
        (segment) =>
          segment.fieldId === target.targetFieldId &&
          target.insertIndex >= segment.startIndex &&
          target.insertIndex <= segment.endIndex,
      )
    ) {
      setDraftDragSelection(null)
      setDraftPointerDrag(null)
      setDraftDropTarget(null)
      setDraftDropLanding(null)
      return
    }

    const currentDraft = draftCopyByConversation[activeConversation.id] ?? generatedInitialDraftCopy
    const selectedParagraphs = getDraftSelectionParagraphs(selection)
    const removedBodyIndexes = getRemovedDraftBodyIndexes(currentDraft, selection)
    const draftWithoutSelection = removeDraftDragSelectionFromDraft(currentDraft, selection)

    let nextDraft: InitialDraftCopy
    let beforeText: string
    let afterText: string
    let targetFieldForPrompt: HTMLElement | null
    let landing: Omit<DraftDropLanding, 'id'>

    if (target.kind === 'inline') {
      const adjustedTargetFieldId = adjustDraftFieldIdAfterBodyRemoval(
        target.targetFieldId,
        removedBodyIndexes,
      )
      const selectedLengthBeforeTarget = selection.segments
        .filter(
          (segment) =>
            segment.fieldId === target.targetFieldId && target.insertIndex > segment.endIndex,
        )
        .reduce((length, segment) => length + segment.endIndex - segment.startIndex, 0)
      const adjustedTargetIndex = target.insertIndex - selectedLengthBeforeTarget
      const targetValue = getDraftFieldValue(draftWithoutSelection, adjustedTargetFieldId)
      const safeInsertIndex = Math.min(Math.max(adjustedTargetIndex, 0), targetValue.length)
      const inlineText =
        selection.segments.length <= 1
          ? selection.segments[0]?.text ?? selection.text
          : selectedParagraphs.join('\n')

      if (selectedParagraphs.length > 1 && getDraftBodyIndex(adjustedTargetFieldId) >= 0) {
        const targetBodyIndex = getDraftBodyIndex(adjustedTargetFieldId)
        const beforeTargetText = targetValue.slice(0, safeInsertIndex)
        const afterTargetText = targetValue.slice(safeInsertIndex)
        const insertedBodyParagraphs = [...selectedParagraphs]
        insertedBodyParagraphs[0] = `${beforeTargetText}${insertedBodyParagraphs[0]}`
        insertedBodyParagraphs[insertedBodyParagraphs.length - 1] =
          `${insertedBodyParagraphs[insertedBodyParagraphs.length - 1]}${afterTargetText}`

        const nextBody = [...draftWithoutSelection.body]
        nextBody.splice(targetBodyIndex, 1, ...insertedBodyParagraphs)
        nextDraft = {
          ...draftWithoutSelection,
          body: nextBody,
        }
        landing = {
          fieldId: `body-${targetBodyIndex}`,
          startIndex: beforeTargetText.length,
          endIndex: beforeTargetText.length + selectedParagraphs[0].length,
        }
        beforeText =
          beforeTargetText ||
          nextBody[targetBodyIndex - 1] ||
          draftWithoutSelection.title
        afterText =
          afterTargetText ||
          nextBody[targetBodyIndex + insertedBodyParagraphs.length] ||
          ''
        targetFieldForPrompt = document.querySelector<HTMLElement>(
          `[data-testid="initial-draft-plan"] [data-draft-field="body-${targetBodyIndex}"]`,
        )
      } else {
        const nextTargetValue =
          targetValue.slice(0, safeInsertIndex) + inlineText + targetValue.slice(safeInsertIndex)
        nextDraft = setDraftFieldValue(draftWithoutSelection, adjustedTargetFieldId, nextTargetValue)
        landing = {
          fieldId: adjustedTargetFieldId,
          startIndex: safeInsertIndex,
          endIndex: safeInsertIndex + inlineText.length,
        }
        beforeText = nextTargetValue.slice(Math.max(0, safeInsertIndex - 30), safeInsertIndex)
        afterText = nextTargetValue.slice(
          safeInsertIndex + inlineText.length,
          safeInsertIndex + inlineText.length + 30,
        )
        targetFieldForPrompt = document.querySelector<HTMLElement>(
          `[data-testid="initial-draft-plan"] [data-draft-field="${adjustedTargetFieldId}"]`,
        )
      }
    } else {
      const nextBody = [...draftWithoutSelection.body]
      const adjustedInsertBodyIndex = adjustDraftBodyIndexAfterRemoval(
        target.insertBodyIndex,
        removedBodyIndexes,
      )
      const safeInsertBodyIndex = Math.min(Math.max(adjustedInsertBodyIndex, 0), nextBody.length)
      nextBody.splice(safeInsertBodyIndex, 0, ...selectedParagraphs)
      nextDraft = {
        ...draftWithoutSelection,
        body: nextBody,
      }
      landing = {
        fieldId: `body-${safeInsertBodyIndex}`,
        startIndex: 0,
        endIndex: selectedParagraphs[0]?.length ?? 0,
      }
      beforeText = nextBody[safeInsertBodyIndex - 1] ?? draftWithoutSelection.title
      afterText = nextBody[safeInsertBodyIndex + selectedParagraphs.length] ?? ''
      targetFieldForPrompt =
        document.querySelector<HTMLElement>(
          `[data-testid="initial-draft-plan"] [data-draft-field="body-${Math.max(safeInsertBodyIndex - 1, 0)}"]`,
        ) ??
        document.querySelector<HTMLElement>(
          '[data-testid="initial-draft-plan"] [data-draft-field="title"]',
        )
    }

    const promptPosition = getDraftMovePromptPosition(
      targetFieldForPrompt ?? document.body,
      clientX,
      clientY,
    )

    recordDraftSnapshot(activeConversation.id, nextDraft, 'manual_edit', { coalesce: true })
    markDraftEdited()
    setDraftDragSelection(null)
    setDraftPointerDrag(null)
    setDraftDropTarget(null)
    pushDraftMoveHistory(activeConversation.id, currentDraft)
    const landingWithId = scheduleDraftDropLanding(landing)
    setDraftMovePrompt({
      landing: landingWithId,
      text: selectedParagraphs.join('\n'),
      targetLabel: target.targetLabel,
      position: promptPosition,
      beforeText,
      afterText,
    })
    window.getSelection()?.removeAllRanges()
  }

  function handleDraftDragHandlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!draftDragSelection) return

    event.preventDefault()
    event.stopPropagation()
    window.getSelection()?.removeAllRanges()
    setDraftMovePrompt(null)
    setDraftDropLanding(null)
    setDraftPointerDrag({ x: event.clientX, y: event.clientY })
    setDraftDropTarget(getDraftDropTargetFromPoint(event.clientX, event.clientY, draftDragSelection))
  }

  function handleDismissDraftMovePrompt() {
    setDraftMovePrompt(null)
    setDraftDropLanding(null)
  }

  function handleUndoDraftMove() {
    if (!canUndoDraftMove) return

    const conversationId = activeConversation.id
    const previousDraft = draftMoveHistory.undo[draftMoveHistory.undo.length - 1]
    const currentDraft = draftCopyByConversation[conversationId] ?? generatedInitialDraftCopy

    setDraftMoveHistoryByConversation((current) => {
      const history = current[conversationId] ?? { redo: [], undo: [] }
      return {
        ...current,
        [conversationId]: {
          redo: [currentDraft, ...history.redo].slice(0, 24),
          undo: history.undo.slice(0, -1),
        },
      }
    })
    recordDraftSnapshot(conversationId, previousDraft, 'manual_edit', { coalesce: true })
    markDraftEdited()
    setDraftDragSelection(null)
    setDraftPointerDrag(null)
    setDraftDropTarget(null)
    setDraftDropLanding(null)
    setDraftMovePrompt(null)
    window.getSelection()?.removeAllRanges()
  }

  function handleRedoDraftMove() {
    if (!canRedoDraftMove) return

    const conversationId = activeConversation.id
    const nextDraft = draftMoveHistory.redo[0]
    const currentDraft = draftCopyByConversation[conversationId] ?? generatedInitialDraftCopy

    setDraftMoveHistoryByConversation((current) => {
      const history = current[conversationId] ?? { redo: [], undo: [] }
      return {
        ...current,
        [conversationId]: {
          redo: history.redo.slice(1),
          undo: [...history.undo, currentDraft].slice(-24),
        },
      }
    })
    recordDraftSnapshot(conversationId, nextDraft, 'manual_edit', { coalesce: true })
    markDraftEdited()
    setDraftDragSelection(null)
    setDraftPointerDrag(null)
    setDraftDropTarget(null)
    setDraftDropLanding(null)
    setDraftMovePrompt(null)
    window.getSelection()?.removeAllRanges()
  }

  function buildBridgeText(prompt: DraftMovePrompt) {
    if (!prompt.beforeText) {
      return '放在开头时，可以先补一句承接读者场景的过渡'
    }
    if (!prompt.afterText) {
      return '放在结尾时，可以补一句更自然的收束和推荐理由'
    }
    return '这里补一句承上启下的轻转折，让前后信息更顺地接住'
  }

  function handleRequestBridgePolish() {
    if (!draftMovePrompt) return

    const prompt = draftMovePrompt
    const messageId = crypto.randomUUID()
    const nextMessage: DraftBridgeMessage = {
      id: messageId,
      movedText: prompt.text,
      targetLabel: prompt.targetLabel,
      beforeText: prompt.beforeText,
      afterText: prompt.afterText,
      bridgeText: buildBridgeText(prompt),
      status: 'generating',
    }

    setDraftBridgeMessagesByConversation((current) => ({
      ...current,
      [activeConversation.id]: [...(current[activeConversation.id] ?? []), nextMessage],
    }))
    setDraftMovePrompt(null)
    setDraftDropLanding(null)

    if (draftBridgeGenerationTimerRef.current) {
      window.clearTimeout(draftBridgeGenerationTimerRef.current)
    }

    const conversationId = activeConversation.id
    draftBridgeGenerationTimerRef.current = window.setTimeout(() => {
      setDraftBridgeMessagesByConversation((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? []).map((message) =>
          message.id === messageId ? { ...message, status: 'done' } : message,
        ),
      }))
      draftBridgeGenerationTimerRef.current = null
    }, 920)
  }

  function appendRewriteChatMessage({
    question,
    selection = '',
    conversationId = activeConversation.id,
    assistantLines,
  }: {
    question: string
    selection?: string
    conversationId?: string
    assistantLines?: string[]
  }) {
    const normalizedQuestion = question.trim()
    const normalizedSelection = selection.trim()
    if (!normalizedQuestion) return false

    const userMessage: RewriteChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      selectedText: normalizedSelection || undefined,
      lines: normalizedQuestion
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
    }
    const assistantMessage: RewriteChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      selectedText: normalizedSelection || undefined,
      lines: assistantLines ?? (normalizedSelection
        ? [
            `只修改「${normalizedSelection}」这一处。`,
            '先调整语气和具体度，再看前后承接。',
          ]
        : ['先在左侧选中要改的内容。']),
    }

    setRewriteMessagesByConversation((current) => {
      const currentMessages = current[conversationId] ?? []
      return {
        ...current,
        [conversationId]: [...currentMessages, userMessage, assistantMessage],
      }
    })
    setRewriteChatInput('')
    return true
  }

  function createRewriteAssistantMessage(
    rewrite: AiRewriteResult,
    input: {
      selection: string
      fieldId: string
      instruction: string
    },
    appliedWritingProfile: AppliedWritingProfileContext,
  ): RewriteChatMessage {
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      selectedText: input.selection,
      fieldId: input.fieldId,
      instruction: input.instruction,
      lines: [rewrite.summary],
      suggestions: rewrite.suggestions.map((suggestion) => ({
        ...suggestion,
        id: crypto.randomUUID(),
        status: 'available',
      })),
      recommendedIndex: rewrite.recommendedIndex,
      appliedWritingProfile,
    }
  }

  async function handleSendRewriteChat() {
    const question = rewriteChatInput.trim()
    const selection = selectedRewriteText.trim()
    const fieldId = selectedRewriteFieldId
    if (!question || !selection || !fieldId || rewritePendingConversationId) return

    const projectId = activeProject.id
    const conversationId = activeConversation.id
    const fieldValue = getDraftFieldValue(initialDraftCopy, fieldId)
    const selectedIndex = fieldValue.indexOf(selection)
    if (selectedIndex < 0) {
      clearRewriteSelection()
      showFinalCopyToast('圈选内容已变化，请重新选择')
      return
    }

    const userMessage: RewriteChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      selectedText: selection,
      fieldId,
      instruction: question,
      lines: question
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
    }
    setRewriteMessagesByConversation((current) => ({
      ...current,
      [conversationId]: [...(current[conversationId] ?? []), userMessage],
    }))
    setRewriteChatInput('')
    setRewritePendingConversationId(conversationId)

    rememberExplicitFeedback({
      projectId,
      conversationId,
      type: 'rewrite_preference',
      content: question,
      context: {
        selectedText: selection,
        draftTitle: initialDraftCopy.title,
        selectedFieldId: fieldId,
        draftAppliedPreferenceIds: activeAppliedPreferenceIds,
        step: 'rewrite',
      },
    })

    try {
      let result: AiRewriteResult
      let usage: AiUsage | null = null
      let appliedWritingProfile: AppliedWritingProfileContext = {
        account: null,
        project: null,
      }

      if (cloudWorkspaceStatus === 'guest') {
        result = buildFallbackSelectionRewrite({
          selectedText: selection,
          instruction: question,
        })
      } else {
        if (cloudWorkspaceStatus !== 'ready') {
          throw new Error('云端工作区还在连接中，稍等一下再试。')
        }
        const accessToken = await getCurrentAccessToken()
        if (!accessToken) {
          throw new Error('登录状态已过期，请重新登录后再使用 AI 改写。')
        }

        const response = await rewriteDraft(accessToken, {
          projectId,
          projectName: activeProject.name,
          topic: activeConversation.topic,
          targetAudience: activeConversation.targetAudience,
          draft: initialDraftCopy,
          fieldId,
          selectedText: selection,
          contextBefore: fieldValue.slice(Math.max(0, selectedIndex - 600), selectedIndex),
          contextAfter: fieldValue.slice(selectedIndex + selection.length, selectedIndex + selection.length + 600),
          instruction: question,
          analysis: activeConversation.analysisReady ? analysis : undefined,
        })
        result = response.rewrite
        usage = response.usage
        appliedWritingProfile = response.appliedWritingProfile
      }

      setRewriteUsageByConversation((current) => ({
        ...current,
        [conversationId]: usage,
      }))
      const assistantMessage = createRewriteAssistantMessage(result, {
        selection,
        fieldId,
        instruction: question,
      }, appliedWritingProfile)
      setRewriteMessagesByConversation((current) => ({
        ...current,
        [conversationId]: [...(current[conversationId] ?? []), assistantMessage],
      }))
    } catch (error) {
      const message = getErrorMessage(error)
      const friendlyMessage = message.includes('paused until rewrite-v1 passes evaluation')
        ? 'AI 改写仍在评测阶段，暂未开放真实调用。'
        : message
      setRewriteMessagesByConversation((current) => ({
        ...current,
        [conversationId]: [
          ...(current[conversationId] ?? []),
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            selectedText: selection,
            lines: [friendlyMessage],
          },
        ],
      }))
    } finally {
      setRewritePendingConversationId((current) =>
        current === conversationId ? '' : current,
      )
    }
  }

  function handleAcceptRewriteSuggestion(
    message: RewriteChatMessage,
    suggestion: NonNullable<RewriteChatMessage['suggestions']>[number],
  ) {
    if (suggestion.status !== 'available' || !message.fieldId || !message.selectedText) return

    const previousValue = getDraftFieldValue(initialDraftCopy, message.fieldId)
    const selectedIndex = previousValue.indexOf(message.selectedText)
    if (selectedIndex < 0) {
      showFinalCopyToast('原文已变化，请重新圈选后生成建议')
      return
    }

    const nextValue = [
      previousValue.slice(0, selectedIndex),
      suggestion.text,
      previousValue.slice(selectedIndex + message.selectedText.length),
    ].join('')
    const nextDraft = setDraftFieldValue(initialDraftCopy, message.fieldId, nextValue)
    recordDraftSnapshot(activeConversation.id, nextDraft, 'ai_rewrite', {
      coalesce: true,
      appliedWritingProfile: message.appliedWritingProfile ?? null,
    })
    markDraftEdited()
    setRewriteMessagesByConversation((current) => ({
      ...current,
      [activeConversation.id]: (current[activeConversation.id] ?? []).map((item) =>
        item.id === message.id
          ? {
              ...item,
              suggestions: item.suggestions?.map((candidate) => ({
                ...candidate,
                status: candidate.id === suggestion.id
                  ? 'accepted'
                  : candidate.status === 'available'
                    ? 'superseded'
                    : candidate.status,
              })),
            }
          : item,
      ),
    }))
    rememberExplicitFeedback({
      projectId: activeProject.id,
      conversationId: activeConversation.id,
      type: 'accepted_rewrite',
      content: suggestion.text,
      context: {
        fieldId: message.fieldId,
        beforeText: message.selectedText,
        afterText: suggestion.text,
        instruction: message.instruction ?? '',
        label: suggestion.label,
        draftAppliedPreferenceIds: activeAppliedPreferenceIds,
        appliedPreferenceIds: getAppliedWritingPreferenceIds(
          message.appliedWritingProfile,
        ),
        step: 'rewrite',
      },
      source: 'rewrite_suggestion',
    })
    if (
      selectedRewriteFieldId === message.fieldId &&
      selectedRewriteText === message.selectedText
    ) {
      setSelectedRewriteText(suggestion.text)
      setSelectedRewriteFieldId(message.fieldId)
      setRewriteSelectionCandidate(null)
      window.getSelection()?.removeAllRanges()
    }
    showFinalCopyToast('已采用改写，并记住这次选择')
  }

  function handleRejectRewriteSuggestion(
    message: RewriteChatMessage,
    suggestion: NonNullable<RewriteChatMessage['suggestions']>[number],
  ) {
    if (suggestion.status !== 'available') return

    setRewriteMessagesByConversation((current) => ({
      ...current,
      [activeConversation.id]: (current[activeConversation.id] ?? []).map((item) =>
        item.id === message.id
          ? {
              ...item,
              suggestions: item.suggestions?.map((candidate) =>
                candidate.id === suggestion.id
                  ? { ...candidate, status: 'rejected' }
                  : candidate,
              ),
            }
          : item,
      ),
    }))
    rememberExplicitFeedback({
      projectId: activeProject.id,
      conversationId: activeConversation.id,
      type: 'rejected_rewrite',
      content: suggestion.text,
      context: {
        fieldId: message.fieldId ?? '',
        selectedText: message.selectedText ?? '',
        instruction: message.instruction ?? '',
        label: suggestion.label,
        step: 'rewrite',
      },
      source: 'rewrite_suggestion',
    })
  }

  function handleSendReaderSuggestionsToRewrite() {
    if (activeReaderPreview?.suggestions.length === 0) return

    const suggestionBlock = readerPreviewFeedback.blocks.find((block) => block.tone === 'suggestion')
    const suggestionLines = suggestionBlock?.lines ?? []
    const suggestionQuestionLines = [
      '带着读者预演建议回到编辑细调：',
      ...suggestionLines.map((line, index) => `${index + 1}. ${line}`),
    ]
    const hasSentCurrentSuggestions = (
      rewriteMessagesByConversation[activeConversation.id] ?? []
    ).some(
      (message) =>
        message.role === 'user' &&
        message.lines.join('\n') === suggestionQuestionLines.join('\n'),
    )

    if (suggestionLines.length > 0 && !hasSentCurrentSuggestions) {
      appendRewriteChatMessage({
        question: suggestionQuestionLines.join('\n'),
        assistantLines: [
          '已带回读者预演建议。',
          '优先改开头、概括句和结尾互动。',
        ],
      })
    }

    clearRewriteSelection()
    goToStep('rewrite')
    window.setTimeout(() => rewriteInputRef.current?.focus(), 0)
  }

  async function handleGenerateReaderPreview(force = false) {
    const conversationId = activeConversation.id
    if (
      !hasDraftReady ||
      readerPreviewPendingConversationId ||
      (!force && activeReaderPreview)
    ) {
      return
    }

    setReaderPreviewErrorByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })

    if (cloudWorkspaceStatus === 'guest') {
      if (force) showFinalCopyToast('已按当前目标用户更新演示预演')
      return
    }
    if (cloudWorkspaceStatus !== 'ready') {
      setReaderPreviewErrorByConversation((current) => ({
        ...current,
        [conversationId]: '云端工作区还在连接中，当前先展示演示预演。',
      }))
      return
    }

    setReaderPreviewPendingConversationId(conversationId)
    try {
      const accessToken = await getCurrentAccessToken()
      if (!accessToken) {
        throw new Error('登录状态已过期，请重新登录后再生成读者预演。')
      }

      const response = await previewDraftForReader(accessToken, {
        projectId: activeProject.id,
        projectName: activeProject.name,
        topic: activeConversation.topic,
        targetAudience: activeConversation.targetAudience,
        readerAudience: readerAudienceDraft.trim(),
        draft: initialDraftCopy,
        analysis: activeConversation.analysisReady ? analysis : undefined,
      })
      setReaderPreviewByConversation((current) => ({
        ...current,
        [conversationId]: {
          audience: effectiveReaderAudience,
          draft: initialDraftCopy,
          preview: response.preview,
        },
      }))
      setReaderPreviewUsageByConversation((current) => ({
        ...current,
        [conversationId]: response.usage,
      }))
    } catch (error) {
      const message = getErrorMessage(error)
      const friendlyMessage = message.includes('paused until reader-preview-v1 passes evaluation')
        ? 'AI 读者预演仍在评测阶段，当前展示演示预演。'
        : message
      setReaderPreviewErrorByConversation((current) => ({
        ...current,
        [conversationId]: friendlyMessage,
      }))
    } finally {
      setReaderPreviewPendingConversationId((current) =>
        current === conversationId ? '' : current,
      )
    }
  }

  function handleRetryCloudWorkspace() {
    setDismissedCloudWorkspaceErrorVersion(cloudWorkspaceErrorVersion)
    if (workspaceSyncRetryTimerRef.current) {
      window.clearTimeout(workspaceSyncRetryTimerRef.current)
      workspaceSyncRetryTimerRef.current = null
    }

    const hasPendingWorkspaceChanges =
      workspaceSyncSerialized !== workspaceSyncBaselineRef.current
    if (cloudWorkspaceStatus === 'ready' && hasPendingWorkspaceChanges) {
      setWorkspaceSyncRetryVersion((current) => current + 1)
      return
    }

    refreshCloudWorkspace()
  }

  function showFinalCopyToast(message: string) {
    setFinalCopyToast(message)
    if (finalCopyToastTimerRef.current) {
      window.clearTimeout(finalCopyToastTimerRef.current)
    }
    finalCopyToastTimerRef.current = window.setTimeout(() => {
      setFinalCopyToast('')
      finalCopyToastTimerRef.current = null
    }, 2400)
  }

  async function handleFinalizeReaderPreview(nextStep: 'rewrite' | 'reader' = 'reader') {
    if (!canFinalizeDraft) {
      showFinalCopyToast('先修正未通过的篇幅检查，再确认成稿')
      return
    }

    const wasAlreadyFinalized = Boolean(activeConversation.finalizedAt)
    const finalizedAt = activeConversation.finalizedAt ?? new Date().toISOString()
    const copied = await copyTextToClipboard(formatDraftCopyForClipboard(initialDraftCopy))
    const currentVersionId = activeDraftVersion?.id ?? activeCurrentDraftVersionId
    const currentVersions = draftVersionsRef.current[activeConversation.id] ?? []
    const nextVersions = markDraftVersionFinalized(
      currentVersions,
      currentVersionId,
      finalizedAt,
    )
    if (nextVersions !== currentVersions) {
      const nextVersionsByConversation = {
        ...draftVersionsRef.current,
        [activeConversation.id]: nextVersions,
      }
      draftVersionsRef.current = nextVersionsByConversation
      setDraftVersionsByConversation(nextVersionsByConversation)
    }

    updateConversation(activeProject.id, activeConversation.id, (conversation) => ({
      ...conversation,
      finalizedAt,
      finalDraft: initialDraftCopy,
      step: nextStep,
      workflowStage: 'finalized',
    }))
    showConversationRoute(nextStep === 'rewrite' ? 'review' : 'confirm')
    if (!wasAlreadyFinalized) {
      const learningTask = rememberExplicitFeedback({
        projectId: activeProject.id,
        conversationId: activeConversation.id,
        type: 'final_choice',
        content: formatDraftCopyForClipboard(initialDraftCopy),
        context: {
          targetAudience: effectiveReaderAudience,
          draftAppliedPreferenceIds: activeAppliedPreferenceIds,
          step: 'reader',
        },
      })
      void learningTask.then((memory) => {
        if (!memory) return
        void refreshWritingProfiles({ extraFeedback: [memory], silent: true })
      })
    }
    setIsReaderAudienceOpen(false)
    showFinalCopyToast(copied ? '已复制当前文案' : '已确认完成，可再次点击复制')
  }

  function handleActivateReaderAnnotation(annotationId: string) {
    setActiveReaderAnnotationId(annotationId)
    window.requestAnimationFrame(() => {
      readerCommentRefs.current.get(annotationId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      })
    })
  }

  function handleAddPlanAttachments(files: FileList | null) {
    if (!files?.length) return

    const nextAttachments: PlanAttachment[] = Array.from(files).map((file) => {
      const kind: PlanAttachment['kind'] = file.type.startsWith('image/') ? 'image' : 'document'

      return {
        id: crypto.randomUUID(),
        name: file.name,
        kind,
      }
    })

    setPlanAttachmentsByConversation((current) => ({
      ...current,
      [activeConversation.id]: [...(current[activeConversation.id] ?? []), ...nextAttachments],
    }))
  }

  function handleRemovePlanAttachment(attachmentId: string) {
    setPlanAttachmentsByConversation((current) => ({
      ...current,
      [activeConversation.id]: (current[activeConversation.id] ?? []).filter(
        (attachment) => attachment.id !== attachmentId,
      ),
    }))
  }

  function formatProjectUpdatedAt(value: string) {
    const date = new Date(value)
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`
  }

  function renderDraftGenerationSkeleton() {
    const lengthLabel =
      effectiveLength === 'short' ? '短篇幅' : effectiveLength === 'medium' ? '中篇幅' : '长篇幅'

    return (
      <div
        aria-live="polite"
        className="mt-5 border-t border-[rgba(31,22,17,0.06)] pt-4"
        role="status"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm leading-6 text-[var(--foreground)]">
            <p className="font-semibold">正在生成初稿</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              正在整理{lengthLabel}文案
            </p>
          </div>
          <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[rgba(15,23,42,0.08)] bg-[rgba(241,243,246,0.8)] px-3 text-xs font-semibold text-[var(--muted-foreground)]">
            {Array.from({ length: 3 }).map((_, index) => (
              <span
                key={index}
                className="draft-thinking-dot h-1.5 w-1.5 rounded-full bg-[var(--accent-strong)]"
                style={{ animationDelay: `${index * 0.14}s` }}
              />
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4" aria-hidden="true">
          <div className="space-y-2">
            <div className="h-5 w-[68%] max-w-[24rem] overflow-hidden rounded-full bg-[rgba(226,232,240,0.78)]">
              <div className="draft-thinking-bar h-full rounded-full bg-[linear-gradient(90deg,rgba(103,199,255,0.56),rgba(239,182,208,0.52),rgba(240,122,47,0.48))]" />
            </div>
            <div className="h-3 w-[42%] max-w-[16rem] overflow-hidden rounded-full bg-[rgba(226,232,240,0.7)]">
              <div
                className="draft-thinking-bar h-full rounded-full bg-[linear-gradient(90deg,rgba(103,199,255,0.36),rgba(148,163,184,0.38))]"
                style={{ animationDelay: '120ms' }}
              />
            </div>
          </div>

          <div className="grid gap-3">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="space-y-2">
                <div className="h-3 w-full overflow-hidden rounded-full bg-[rgba(226,232,240,0.68)]">
                  <div
                    className="draft-thinking-bar h-full rounded-full bg-[linear-gradient(90deg,rgba(148,163,184,0.38),rgba(103,199,255,0.34))]"
                    style={{ animationDelay: `${index * 110}ms` }}
                  />
                </div>
                <div
                  className="h-3 overflow-hidden rounded-full bg-[rgba(226,232,240,0.55)]"
                  style={{ width: `${index === 3 ? 54 : 76 - index * 8}%` }}
                >
                  <div
                    className="draft-thinking-bar h-full rounded-full bg-[linear-gradient(90deg,rgba(148,163,184,0.3),rgba(239,182,208,0.28))]"
                    style={{ animationDelay: `${index * 140}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderInitialDraftCopy(variant: 'plan' | 'rewrite' | 'reader') {
    const isPlan = variant === 'plan'
    const isRewrite = variant === 'rewrite'
    const isReader = variant === 'reader'

    function getReaderDraftAnnotationClass(tone: ReaderDraftAnnotation['tone']) {
      if (tone === 'interest') {
        return 'rounded-[0.45rem] border border-[rgba(42,157,143,0.42)] bg-[rgba(232,248,245,0.78)] px-1.5 py-0.5 shadow-[0_0_0_2px_rgba(42,157,143,0.08),inset_0_-2px_0_rgba(42,157,143,0.14)]'
      }

      if (tone === 'risk') {
        return 'rounded-[0.45rem] border border-[rgba(214,90,60,0.4)] bg-[rgba(255,241,237,0.84)] px-1.5 py-0.5 shadow-[0_0_0_2px_rgba(214,90,60,0.08),inset_0_-2px_0_rgba(214,90,60,0.13)]'
      }

      return 'rounded-[0.45rem] border border-[rgba(103,199,255,0.5)] bg-[rgba(235,248,255,0.82)] px-1.5 py-0.5 shadow-[0_0_0_2px_rgba(103,199,255,0.12),inset_0_-2px_0_rgba(103,199,255,0.16)]'
    }

    function renderDraftText(value: string, fieldId: string) {
      type DraftRenderedMoveRange = {
        anchor: DraftDropLanding
        endIndex: number
        kind: 'move'
        startIndex: number
      }
      type DraftRenderedSelectionRange = {
        endIndex: number
        isLastSegment: boolean
        kind: 'selection'
        startIndex: number
      }

      const draftMoveAnchor =
        isPlan && draftDropLanding?.fieldId === fieldId
          ? draftDropLanding
          : isPlan && draftMovePrompt?.landing.fieldId === fieldId
            ? draftMovePrompt.landing
            : null
      const draftMoveRange: DraftRenderedMoveRange | null =
        draftMoveAnchor
          ? {
              anchor: draftMoveAnchor,
              endIndex: Math.min(Math.max(draftMoveAnchor.endIndex, draftMoveAnchor.startIndex), value.length),
              kind: 'move' as const,
              startIndex: Math.min(Math.max(draftMoveAnchor.startIndex, 0), value.length),
            }
          : null
      const draftSelectionRange: DraftRenderedSelectionRange[] =
        isPlan && draftDragSelection
          ? draftDragSelection.segments
              .map((segment, index) =>
                segment.fieldId === fieldId
                  ? {
                      endIndex: Math.min(Math.max(segment.endIndex, segment.startIndex), value.length),
                      isLastSegment: index === draftDragSelection.segments.length - 1,
                      kind: 'selection' as const,
                      startIndex: Math.min(Math.max(segment.startIndex, 0), value.length),
                    }
                      : null,
              )
              .filter((range): range is DraftRenderedSelectionRange =>
                Boolean(range && range.endIndex > range.startIndex),
              )
          : []
      const hasOverlappingDraftRanges =
        Boolean(draftMoveRange) &&
        draftSelectionRange.some(
          (range) =>
            draftMoveRange!.startIndex < range.endIndex &&
            range.startIndex < draftMoveRange!.endIndex,
        )
      const draftRanges: Array<DraftRenderedMoveRange | DraftRenderedSelectionRange> = [
        hasOverlappingDraftRanges ? null : draftMoveRange,
        ...draftSelectionRange,
      ]
        .filter((range): range is DraftRenderedMoveRange | DraftRenderedSelectionRange =>
          Boolean(range && range.endIndex > range.startIndex),
        )
        .sort((first, second) => first.startIndex - second.startIndex)

      if (draftRanges.length > 0) {
        const nodes: ReactNode[] = []
        let cursor = 0

        draftRanges.forEach((range) => {
          if (range.startIndex > cursor) {
            nodes.push(value.slice(cursor, range.startIndex))
          }

          if (range.kind === 'selection') {
            nodes.push(
              <span
                key={`selection-${fieldId}-${range.startIndex}-${range.endIndex}`}
                className="draft-selection-group relative inline-flex items-center align-baseline"
              >
                <mark
                  className={
                    draftPointerDrag
                      ? 'inline rounded-[0.45rem] bg-[rgba(255,179,112,0.34)] px-1 py-0.5 text-inherit opacity-40 shadow-[0_0_0_1px_rgba(240,122,47,0.16)] transition'
                      : 'inline rounded-[0.45rem] bg-[rgba(255,179,112,0.46)] px-1 py-0.5 text-inherit shadow-[0_0_0_1px_rgba(240,122,47,0.24)] transition'
                  }
                >
                  {value.slice(range.startIndex, range.endIndex)}
                </mark>
                {!draftPointerDrag && range.isLastSegment ? (
                  <button
                    type="button"
                    aria-label="拖动圈选文字"
                    onPointerDown={handleDraftDragHandlePointerDown}
                    className="draft-selection-handle ml-1 inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-full bg-white/95 text-[var(--accent-strong)] opacity-100 shadow-[0_8px_20px_rgba(48,34,22,0.16)] ring-1 ring-[rgba(15,23,42,0.14)] transition hover:scale-105 hover:bg-[var(--accent-soft)] active:cursor-grabbing"
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>,
            )
          } else {
            const isLandingAnimating = draftDropLanding?.id === range.anchor.id
            const isToolbarAnchor = draftMovePrompt?.landing.id === range.anchor.id
            nodes.push(
              <mark
                key={range.anchor.id}
                data-draft-move-anchor={range.anchor.id}
                className={[
                  'draft-move-anchor inline rounded-[0.45rem] px-1 py-0.5 text-inherit',
                  isLandingAnimating ? 'draft-drop-land' : '',
                  isToolbarAnchor ? 'draft-move-anchor-active' : '',
                ].filter(Boolean).join(' ')}
              >
                {value.slice(range.startIndex, range.endIndex)}
              </mark>,
            )
          }

          cursor = range.endIndex
        })

        if (cursor < value.length) {
          nodes.push(value.slice(cursor))
        }

        return <>{nodes}</>
      }

      if (isReader) {
        const readerRanges = readerPreviewFeedback.annotations
          .filter((annotation) => annotation.fieldId === fieldId && annotation.text)
          .map((annotation) => {
            const startIndex =
              value.slice(annotation.startIndex, annotation.startIndex + annotation.text.length) ===
              annotation.text
                ? annotation.startIndex
                : value.indexOf(annotation.text)
            return startIndex >= 0
              ? {
                  ...annotation,
                  endIndex: startIndex + annotation.text.length,
                  startIndex,
                }
              : null
          })
          .filter((range): range is ReaderDraftAnnotation & {
            endIndex: number
            startIndex: number
          } => Boolean(range && range.endIndex > range.startIndex))
          .sort((first, second) => first.startIndex - second.startIndex)
          .reduce<Array<ReaderDraftAnnotation & { endIndex: number; startIndex: number }>>(
            (ranges, range) => {
              const previous = ranges[ranges.length - 1]
              if (previous && range.startIndex < previous.endIndex) return ranges
              return [...ranges, range]
            },
            [],
          )

        if (readerRanges.length > 0) {
          const nodes: ReactNode[] = []
          let cursor = 0

          readerRanges.forEach((range) => {
            if (range.startIndex > cursor) {
              nodes.push(value.slice(cursor, range.startIndex))
            }

            const isActiveReaderAnnotation = activeReaderAnnotationId === range.id
            nodes.push(
              <mark
                key={`reader-${fieldId}-${range.tone}-${range.startIndex}-${range.endIndex}`}
                aria-controls={`reader-comment-${range.id}`}
                aria-label={`查看第 ${range.noteNumber} 条批注`}
                data-reader-annotation={range.id}
                onClick={() => handleActivateReaderAnnotation(range.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleActivateReaderAnnotation(range.id)
                  }
                }}
                role="button"
                tabIndex={0}
                className={[
                  'inline cursor-pointer text-inherit outline-none transition [box-decoration-break:clone] [-webkit-box-decoration-break:clone]',
                  getReaderDraftAnnotationClass(range.tone),
                  isActiveReaderAnnotation
                    ? 'ring-2 ring-[rgba(240,122,47,0.34)]'
                    : 'hover:shadow-[0_0_0_3px_rgba(240,122,47,0.12),inset_0_-2px_0_rgba(240,122,47,0.12)] focus-visible:ring-2 focus-visible:ring-[rgba(240,122,47,0.34)]',
                ].join(' ')}
              >
                {value.slice(range.startIndex, range.endIndex)}
                <span className="ml-1 inline-flex h-5 min-w-5 translate-y-[-0.08em] items-center justify-center rounded-full bg-white/90 px-1 text-[length:var(--ui-text-caption)] font-bold leading-none text-[var(--foreground)] shadow-[0_0_0_1px_rgba(31,22,17,0.08)]">
                  {range.noteNumber}
                </span>
              </mark>,
            )
            cursor = range.endIndex
          })

          if (cursor < value.length) {
            nodes.push(value.slice(cursor))
          }

          return <>{nodes}</>
        }
      }

      if (!isRewrite || !selectedRewriteText || selectedRewriteFieldId !== fieldId) return value

      const selectedIndex = value.indexOf(selectedRewriteText)
      if (selectedIndex < 0) return value

      return (
        <>
          {value.slice(0, selectedIndex)}
          <mark className="rounded-[0.35rem] bg-[rgba(255,179,112,0.38)] px-1 py-0.5 text-inherit shadow-[0_0_0_1px_rgba(240,122,47,0.16)]">
            {value.slice(selectedIndex, selectedIndex + selectedRewriteText.length)}
          </mark>
          {value.slice(selectedIndex + selectedRewriteText.length)}
        </>
      )
    }

    return (
      <article
        data-testid={
          isPlan
            ? 'initial-draft-plan'
            : isRewrite
              ? 'initial-draft-rewrite'
              : 'initial-draft-reader'
        }
        className={
          isPlan
            ? 'select-text rounded-[var(--ui-radius-card)] border border-[rgba(15,23,42,0.08)] bg-white px-5 py-5 shadow-[0_12px_28px_rgba(15,23,42,0.04)]'
            : 'select-text py-1'
        }
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
        }}
      >
        {isPlan ? (
          <div
            data-testid="draft-drag-instruction"
            className="mb-5 rounded-[var(--ui-radius-card)] border border-[rgba(15,23,42,0.08)] bg-[rgba(248,250,252,0.86)] px-4 py-3 text-sm leading-6 text-[var(--muted-foreground)]"
          >
            <div className="flex items-start gap-2">
              <MousePointer2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-strong)]" />
              <p>
                圈选文字可拖动调整。
              </p>
            </div>
          </div>
        ) : null}

        <div
          data-testid={isPlan ? 'draft-copy-content' : undefined}
          onPointerDown={isPlan ? handleDraftCopyPointerDown : undefined}
          onMouseDown={isPlan ? handleDraftCopyPointerDown : undefined}
          onPointerUp={isPlan ? handleDraftCopySelection : undefined}
          onMouseUp={isPlan ? handleDraftCopySelection : undefined}
          onKeyUp={isPlan ? handleDraftCopySelection : undefined}
        >
          <h3
            data-draft-field="title"
            data-rewrite-field="title"
            contentEditable={isRewrite}
            suppressContentEditableWarning={isRewrite}
            spellCheck={false}
            aria-label={isRewrite ? '编辑标题' : undefined}
            onInput={isRewrite ? (event) => handleRewriteDraftFieldInput('title', event) : undefined}
            onBlur={isRewrite ? (event) => handleRewriteDraftFieldBlur('title', event) : undefined}
            onKeyDown={isRewrite ? handleRewriteTitleKeyDown : undefined}
            onKeyUp={isRewrite ? handleCaptureRewriteSelection : undefined}
            onMouseUp={isRewrite ? handleCaptureRewriteSelection : undefined}
            onPaste={isRewrite ? handleRewriteDraftFieldPaste : undefined}
            onPointerUp={isRewrite ? handleCaptureRewriteSelection : undefined}
            className={[
              'text-[length:var(--ui-text-section)] font-semibold leading-[1.48] tracking-normal text-[#25211e]',
              isRewrite
                ? '-mx-1 min-h-[1.45em] cursor-text whitespace-pre-wrap px-1 py-1 caret-[var(--accent-strong)] outline-none'
                : '',
            ].filter(Boolean).join(' ')}
          >
            {renderDraftText(initialDraftCopy.title, 'title')}
          </h3>
          <div className="mt-7 space-y-5 text-[length:var(--ui-text-body-lg)] font-normal leading-[1.88] tracking-normal text-[#332f2b]">
            {initialDraftCopy.body.map((paragraph, index) => (
              <div key={`body-${index}`}>
                <p
                  data-draft-field={`body-${index}`}
                  data-rewrite-field={`body-${index}`}
                  contentEditable={isRewrite}
                  suppressContentEditableWarning={isRewrite}
                  spellCheck={false}
                  aria-label={isRewrite ? `编辑第 ${index + 1} 段正文` : undefined}
                  onInput={
                    isRewrite
                      ? (event) => handleRewriteDraftFieldInput(`body-${index}`, event)
                      : undefined
                  }
                  onBlur={
                    isRewrite
                      ? (event) => handleRewriteDraftFieldBlur(`body-${index}`, event)
                      : undefined
                  }
                  onKeyUp={isRewrite ? handleCaptureRewriteSelection : undefined}
                  onMouseUp={isRewrite ? handleCaptureRewriteSelection : undefined}
                  onPaste={isRewrite ? handleRewriteDraftFieldPaste : undefined}
                  onPointerUp={isRewrite ? handleCaptureRewriteSelection : undefined}
                  className={
                    isRewrite
                      ? '-mx-1 min-h-[1.72em] cursor-text whitespace-pre-wrap px-1 py-0.5 caret-[var(--accent-strong)] outline-none'
                      : undefined
                  }
                >
                  {renderDraftText(paragraph, `body-${index}`)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {draftPointerDrag && draftDragSelection && isPlan && typeof document !== 'undefined' ? createPortal(
          <div
            className="pointer-events-none fixed z-[130] max-w-[18rem] rounded-[0.75rem] bg-white/96 px-3 py-2 text-sm font-medium leading-6 text-[var(--foreground)] shadow-[0_18px_48px_rgba(48,34,22,0.18)] ring-1 ring-[rgba(15,23,42,0.12)] backdrop-blur-xl"
            style={{
              left: draftPointerDrag.x + 12,
              top: draftPointerDrag.y + 12,
            }}
          >
            {draftDragSelection.text}
          </div>,
          document.body,
        ) : null}

        {draftPointerDrag && draftDropTarget && isPlan && typeof document !== 'undefined' ? createPortal(
          <span
            className={
              draftDropTarget.indicator.orientation === 'vertical'
                ? 'pointer-events-none fixed z-[125] rounded-full bg-[var(--accent-strong)] shadow-[0_0_0_3px_rgba(15,23,42,0.14)]'
                : 'pointer-events-none fixed z-[125] rounded-full bg-[var(--accent-strong)] shadow-[0_0_0_3px_rgba(15,23,42,0.12)]'
            }
            style={{
              height: draftDropTarget.indicator.height,
              left: draftDropTarget.indicator.left,
              top: draftDropTarget.indicator.top,
              width: draftDropTarget.indicator.width,
            }}
          />,
          document.body,
        ) : null}

        {draftMovePrompt && isPlan && typeof document !== 'undefined' ? createPortal(
          <div
            ref={draftMovePromptToolbarRef}
            data-testid="draft-bridge-polish-prompt"
            className="ui-popover-motion fixed z-[120] max-w-[calc(100vw-1.75rem)] rounded-full border border-[rgba(42,157,143,0.16)] bg-white/96 px-2 py-2 shadow-[0_18px_48px_rgba(48,34,22,0.14)] backdrop-blur-xl"
            style={{
              left: draftMovePrompt.position.left,
              top: draftMovePrompt.position.top,
            }}
          >
            <div className="flex items-center gap-1" role="toolbar" aria-label={`已移动到${draftMovePrompt.targetLabel}`}>
              <span className="mr-1 hidden max-w-[6rem] truncate pl-2 text-xs font-semibold text-[var(--muted-foreground)] sm:inline">
                {draftMovePrompt.targetLabel}
              </span>
              <button
                type="button"
                onClick={handleRequestBridgePolish}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[rgba(42,157,143,0.1)] px-3 text-xs font-semibold text-[#277f75] transition hover:bg-[rgba(42,157,143,0.16)] focus-visible:ring-4 focus-visible:ring-[rgba(42,157,143,0.16)]"
              >
                <WandSparkles className="h-3.5 w-3.5" />
                AI衔接
              </button>
              <button
                type="button"
                onClick={handleUndoDraftMove}
                disabled={!canUndoDraftMove}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[rgba(31,22,17,0.06)] focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-35"
              >
                <Undo2 className="h-3.5 w-3.5" />
                撤回
              </button>
              <button
                type="button"
                onClick={handleDismissDraftMovePrompt}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--muted-foreground)] transition hover:bg-[rgba(31,22,17,0.06)] hover:text-[var(--foreground)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                确认
              </button>
            </div>
          </div>,
          document.body,
        ) : null}
      </article>
    )
  }

  function renderDraftBridgeMessage(message: DraftBridgeMessage) {
    return (
      <div key={message.id} className="ui-chat-row flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <WandSparkles className="h-5 w-5" />
        </div>
        <div
          data-testid="draft-bridge-message"
          className="max-w-[46rem] rounded-[var(--ui-radius-panel)] rounded-tl-[0.45rem] bg-white px-4 py-4 text-sm leading-7 text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.04)]"
        >
          {message.status === 'generating' ? (
            <div className="grid gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <span>正在润色前后衔接</span>
                <span className="flex items-center gap-1" aria-hidden="true">
                  {[0, 1, 2].map((index) => (
                    <span
                      key={index}
                      className="draft-thinking-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
                      style={{ animationDelay: `${index * 0.14}s` }}
                    />
                  ))}
                </span>
              </div>
              <div className="grid gap-2">
                <span className="draft-thinking-bar h-3 w-[88%] rounded-full bg-[rgba(100,116,139,0.14)]" />
                <span className="draft-thinking-bar h-3 w-[72%] rounded-full bg-[rgba(42,157,143,0.12)]" />
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <div>
                <Badge variant="accent">衔接润色建议</Badge>
              </div>
              <p className="text-sm leading-7 text-[var(--muted-foreground)]">
                已补前后衔接，保留原口吻。
              </p>
              <div className="rounded-[var(--ui-radius-card)] border border-[rgba(42,157,143,0.16)] bg-[rgba(232,248,245,0.62)] px-4 py-3 text-[length:var(--ui-text-body)] leading-7 text-[#2e3430]">
                {message.beforeText ? <span>{message.beforeText}</span> : null}
                <span>{message.movedText}</span>
                <mark className="mx-1 rounded-[0.45rem] bg-[rgba(42,157,143,0.2)] px-1.5 py-0.5 text-[#17675b] shadow-[0_0_0_1px_rgba(42,157,143,0.14)]">
                  {message.bridgeText}
                </mark>
                {message.afterText ? <span>{message.afterText}</span> : null}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderWorkspaceSaveIndicator() {
    const isSaving =
      isCloudWorkspaceConnecting ||
      workspaceSaveStatus === 'saving-local' ||
      workspaceSaveStatus === 'syncing-cloud'

    return (
      <span
        className={
          isCloudWorkspaceLoadError || workspaceSaveStatus === 'save-error'
            ? 'inline-flex items-center gap-1.5 text-xs font-medium text-[var(--destructive)]'
            : 'inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]'
        }
        title={workspaceSavedAt ? `最近保存：${workspaceSavedAt}` : workspaceSaveLabel}
        role="status"
      >
        <WorkspaceSaveIcon className={isSaving ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
        {workspaceSaveLabel}
      </span>
    )
  }

  function renderWorkspace() {
    return (
      <main className="relative flex h-screen min-h-0 flex-col overflow-hidden px-[var(--ui-page-gutter)] pb-[var(--ui-page-gutter)] pt-[var(--ui-space-5)]">
        <section className="relative z-10 mx-auto w-full max-w-6xl shrink-0 pb-[var(--ui-gap-block)]">
          <div className="pointer-events-none absolute inset-x-[-12%] top-[-7rem] h-64 bg-[radial-gradient(circle_at_18%_18%,rgba(103,199,255,0.2),transparent_28%),radial-gradient(circle_at_78%_0%,rgba(148,163,184,0.16),transparent_30%)] blur-xl" />
          <div className="relative grid gap-[var(--ui-gap-section)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  Lumos AI Writer
                </h1>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                {renderWorkspaceSaveIndicator()}
                <AuthStatus cloudSummary={authCloudSummary} />
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--soft-foreground)]" />
                <Input
                  controlSize="xl"
                  className="rounded-[var(--ui-field-radius)] border-[var(--border)] bg-[var(--surface-raised)] pl-11 shadow-none"
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="搜索项目或参考文件夹"
                />
              </div>
              <Button size="xl" variant="secondary" onClick={() => goToStep('library')}>
                <Highlighter className="h-4 w-4" />
                文案库
              </Button>
              <Button size="xl" onClick={handleOpenCreateProject}>
                <Plus className="h-4 w-4" />
                新建项目
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--ui-radius-panel)] bg-[var(--surface-muted)] shadow-none">
            <div className="flex shrink-0 flex-wrap items-end justify-between gap-[var(--ui-gap-group)] border-b border-[var(--border)] bg-transparent px-[var(--ui-inset-panel)] py-[var(--ui-inset-card)] lg:px-[var(--ui-space-6)]">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                  项目列表
                </h2>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--soft-foreground)]">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                按最近更新排序
              </span>
            </div>

            <div className="hidden shrink-0 grid-cols-[minmax(0,1.65fr)_minmax(9rem,0.42fr)_minmax(10.5rem,0.48fr)] items-center gap-6 bg-[rgba(241,243,246,0.72)] py-4 pl-6 pr-16 text-sm font-semibold text-[var(--soft-foreground)] lg:grid">
              <div>项目</div>
              <div>参考文件夹</div>
              <div>最近更新</div>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto">
              {filteredProjects.map((project, index) => {
                const folder = libraryFolders.find((item) => item.id === project.folderId)
                const projectConversation =
                  project.conversations.find(
                    (conversation) => conversation.id === project.activeConversationId,
                  ) ?? project.conversations[0]
                const recentStep = conversationStageLabels[getResumableConversationStage(projectConversation)]

                return (
                  <article
                    key={project.id}
                    style={{ animationDelay: `${index * 35}ms` }}
                    className="group ui-list-item-motion relative grid cursor-pointer gap-4 bg-transparent px-5 py-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(9rem,0.42fr)_minmax(10.5rem,0.48fr)] lg:items-center lg:gap-6 lg:pl-6 lg:pr-16"
                  >
                    <button
                      type="button"
                      aria-label={`进入项目 ${project.name}`}
                      onClick={() => handleOpenProject(project.id)}
                      className="absolute inset-0 z-0 rounded-[var(--ui-radius-item)] bg-transparent outline-none transition hover:bg-white/34 focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                    />
                    <div className="pointer-events-none relative z-10 min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--ui-radius-card)] bg-[var(--panel)] text-[var(--accent-strong)] shadow-none">
                          <FolderOpen className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          {renamingProjectId === project.id ? (
                            <Input
                              autoFocus
                              className="pointer-events-auto max-w-sm rounded-[var(--ui-radius-control)] bg-white/90 font-semibold"
                              value={renamingProjectName}
                              aria-label={`重命名 ${project.name}`}
                              onBlur={() => handleSaveRenameProject(project.id)}
                              onChange={(event) => setRenamingProjectName(event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                event.stopPropagation()
                                if (event.key === 'Enter') {
                                  event.currentTarget.blur()
                                }
                                if (event.key === 'Escape') {
                                  handleCancelRenameProject()
                                }
                              }}
                            />
                          ) : (
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-base font-semibold text-[var(--foreground)]">
                                {project.name}
                              </p>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="pointer-events-auto shrink-0 text-[var(--soft-foreground)] hover:bg-transparent hover:text-[var(--muted-foreground)]"
                                aria-label={`重命名 ${project.name}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleStartRenameProject(project)
                                }}
                              >
                                <PenLine className="size-3.5" />
                              </Button>
                            </div>
                          )}
                          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                            {project.conversations.length} 个对话
                            {recentStep ? ` · 最近：${recentStep}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="pointer-events-none relative z-10 flex min-w-0 items-center">
                      <Badge variant="outline">{folder?.name || '未设置'}</Badge>
                    </div>
                    <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-2 text-sm text-[var(--muted-foreground)]">
                      <Clock3 className="h-4 w-4 text-[var(--soft-foreground)]" />
                      <span className="whitespace-nowrap">{formatProjectUpdatedAt(project.updatedAt)}</span>
                    </div>
                    <div className="relative z-10 flex items-center gap-2 lg:absolute lg:right-5 lg:top-1/2 lg:-translate-y-1/2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="bg-transparent text-[rgba(214,90,60,0.58)] shadow-none transition-opacity hover:bg-[rgba(214,90,60,0.055)] hover:text-[rgba(214,90,60,0.82)] lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
                        aria-label={`删除 ${project.name}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleRequestDeleteProject(project.id)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </article>
                )
              })}

              {filteredProjects.length === 0 ? (
                <div className="ui-surface-enter bg-transparent px-6 py-14 text-center">
                  <p className="text-base font-semibold text-[var(--foreground)]">当前没有匹配到项目</p>
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                    换一个关键词，或者新建项目继续。
                  </p>
                </div>
              ) : null}
            </div>
          </Card>
        </section>

        {showCreateProjectCard ? (
          <div
            data-project-dialog
            className="ui-dialog-backdrop fixed inset-0 z-20 flex items-center justify-center bg-[rgba(28,21,16,0.16)] px-[var(--ui-page-gutter)] py-[var(--ui-space-10)] backdrop-blur-md"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
            onClick={handleCancelCreateProject}
          >
            <Card
              className="ui-dialog-card w-full max-w-xl rounded-[var(--ui-radius-dialog)] bg-white/90 shadow-[var(--shadow-elevated)]"
              onClick={(event) => event.stopPropagation()}
            >
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle id="create-project-title">新建项目</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="关闭新建项目窗口"
                  onClick={handleCancelCreateProject}
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>

              <CardContent className="grid gap-[var(--ui-form-gap)]">
                <label className="grid gap-[var(--ui-field-gap)]">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">项目名称</span>
                  <Input
                    autoFocus
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    placeholder="例如：深圳周末骑行内容"
                    aria-invalid={isNewProjectNameDuplicate}
                  />
                  {isNewProjectNameDuplicate ? (
                    <span className="text-xs font-medium text-[var(--destructive)]">
                      已有同名项目，换一个更容易区分的名称。
                    </span>
                  ) : null}
                </label>

                <label className="grid gap-[var(--ui-field-gap)]">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">
                    优先参考文件夹{' '}
                    <span className="font-normal text-[var(--soft-foreground)]">（可选）</span>
                  </span>
                  <Select value={effectiveNewProjectFolderId} onValueChange={setNewProjectFolderId}>
                    <SelectTrigger aria-label="优先参考文件夹">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={noProjectFolderId}>暂不关联</SelectItem>
                      {libraryFolders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs leading-5 text-[var(--soft-foreground)]">
                    关联后，AI 会优先从这个文件夹推荐素材；之后仍可浏览全部素材。
                  </span>
                </label>

                <div className="flex justify-end gap-[var(--ui-gap-control)] pt-[var(--ui-gap-control)]">
                  <Button variant="secondary" onClick={handleCancelCreateProject}>
                    取消
                  </Button>
                  <Button
                    onClick={handleCreateProject}
                    disabled={
                      !newProjectName.trim() ||
                      Boolean(isNewProjectNameDuplicate)
                    }
                  >
                    新建并进入项目
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {projectPendingDelete ? (
          <div
            data-project-dialog
            className="ui-dialog-backdrop fixed inset-0 z-30 flex items-center justify-center bg-[rgba(28,21,16,0.2)] px-[var(--ui-page-gutter)] py-[var(--ui-space-10)] backdrop-blur-md"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            aria-describedby="delete-project-description"
            onClick={handleCancelDeleteProject}
          >
            <Card
              className="ui-dialog-card w-full max-w-md rounded-[var(--ui-radius-dialog)] bg-white/94 shadow-[var(--shadow-elevated)]"
              onClick={(event) => event.stopPropagation()}
            >
              <CardHeader className="gap-3">
                <div>
                  <CardTitle id="delete-project-title">
                    确定删除「{projectPendingDelete.name}」？
                  </CardTitle>
                  <CardDescription id="delete-project-description" className="mt-2">
                    删除后，该项目将从列表中移除，相关对话和已选参考内容也会一并移除。
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent>
                <div className="flex flex-wrap justify-end gap-[var(--ui-gap-control)]">
                  <Button variant="secondary" onClick={handleCancelDeleteProject}>
                    取消
                  </Button>
                  <Button
                    className="bg-[var(--destructive)] text-[var(--destructive-foreground)] shadow-[0_16px_34px_rgba(214,90,60,0.22)] hover:bg-[#c94e34] hover:shadow-[0_22px_44px_rgba(214,90,60,0.28)]"
                    onClick={handleConfirmDeleteProject}
                  >
                    <Trash2 className="h-4 w-4" />
                    确认删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </main>
    )
  }

  function renderLibrary() {
    return (
      <LibraryManager
        authCloudSummary={authCloudSummary}
        error={libraryError}
        folders={libraryFolders}
        isRefreshing={cloudLibrary.isRefreshing}
        notes={libraryNotes}
        refreshedAt={cloudLibrary.refreshedAt}
        snippets={librarySnippets}
        status={libraryStatus}
        trashGroups={libraryTrashGroups}
        onBack={() => goToStep('workspace')}
        onCreateFolder={handleCreateLibraryFolder}
        onDeleteFolder={handleDeleteLibraryFolder}
        onDeleteFolderPermanently={handleDeleteLibraryFolderPermanently}
        onDeleteNote={handleDeleteLibraryNote}
        onDeleteNotePermanently={handleDeleteLibraryNotePermanently}
        onEmptyTrash={handleEmptyLibraryTrash}
        onRefresh={cloudLibrary.refresh}
        onRestoreFolder={handleRestoreLibraryFolder}
        onRestoreNote={handleRestoreLibraryNote}
        onSaveNote={handleSaveLibraryNote}
        onSaveNoteSnippets={handleSaveLibraryNoteSnippets}
        onUpdateFolder={handleUpdateLibraryFolder}
        onUpdateNoteLearningStatus={handleUpdateLibraryNoteLearningStatus}
      />
    )
  }

  function renderIntake() {
    const folderName =
      libraryFolders.find((folder) => folder.id === activeProject.folderId)?.name ?? '未选择文件夹'

    return (
      <div className="relative h-[100dvh] overflow-hidden bg-[linear-gradient(120deg,#eef2f6_0%,#f6f8fb_46%,#ffffff_100%)]">
        {renderWorkflowSidebar()}
        <ConversationIntake
          folderName={folderName}
          projectName={activeProject.name}
          value={writingRequestDraft}
          onBackToWorkspace={() => goToStep('workspace')}
          onChange={handleWritingRequestChange}
          onOpenSidebar={() => setIsConversationSidebarOpen(true)}
          onSubmit={handleSubmitWritingRequest}
          onWorkflowStepChange={handleWorkflowStepChange}
          workflowSteps={workflowSteps}
        />
      </div>
    )
  }

  function renderLearn() {
    return (
      <LearnWorkspace
        key={activeConversation.id}
        activeConversationId={activeConversation.id}
        analysisReady={false}
        chatInput={chatInput}
        chatMessages={activeConversation.chatMessages}
        folders={libraryFolders}
        notes={learningReadyNotes}
        snippets={learningReadySnippets}
        nonLearningNoteCount={nonLearningNoteCount}
        libraryStatus={libraryStatus}
        libraryError={libraryError}
        analysisError={analysisError}
        analysisWaitSeconds={analysisWaitSeconds}
        isAnalyzing={isAnalyzing}
        isSidebarOpen={isConversationSidebarOpen}
        isStreaming={isChatStreaming}
        projectName={activeProject.name}
        conversations={sidebarConversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          pinned: conversation.pinned,
          finalizedAt: conversation.finalizedAt,
        }))}
        selectedItemIds={selectedItemIds}
        writingRequest={activeConversation.writingRequest}
        referenceRecommendations={referenceRecommendations}
        onBackToWorkspace={() => goToStep('workspace')}
        onOpenLibrary={() => goToStep('library')}
        onCloseSidebar={() => setIsConversationSidebarOpen(false)}
        onCreateConversation={handleCreateConversation}
        onConversationTitleChange={handleConversationTitleChange}
        onToggleConversationPin={handleToggleConversationPin}
        onSwitchConversation={handleSwitchConversation}
        onStartAnalysis={handleStartAnalysis}
        onOpenSidebar={() => setIsConversationSidebarOpen(true)}
        onToggleItems={handleToggleItems}
        onSelectItems={handleSelectItems}
        onDeselectItems={handleDeselectItems}
        onChatInputChange={setChatInput}
        onSendChat={handleSendChat}
        onWorkflowStepChange={handleWorkflowStepChange}
        workflowSteps={workflowSteps}
      />
    )
  }

  function renderSidebarConversationRow(conversation: ConversationRecord) {
    const isActive = conversation.id === activeProject.activeConversationId
    const isRenaming = renamingSidebarConversationId === conversation.id
    const sameTitleConversations = sidebarConversations.filter(
      (item) => item.title === conversation.title,
    )
    const accessibleTitleSuffix =
      sameTitleConversations.length > 1
        ? `，第 ${sameTitleConversations.findIndex((item) => item.id === conversation.id) + 1} 个`
        : ''
    const switchToConversation = () => {
      setOpenSidebarConversationMenuId('')
      handleSwitchConversation(conversation.id)
    }

    return (
      <div
        key={conversation.id}
        className={
          isActive
            ? 'group relative flex min-h-[3.25rem] w-full cursor-pointer items-center gap-3 rounded-[var(--ui-radius-card)] border border-transparent bg-white/58 px-3 py-2 text-sm font-semibold leading-6 text-[var(--foreground)] transition'
            : conversation.pinned
              ? 'group relative flex min-h-[3.25rem] w-full cursor-pointer items-center gap-3 rounded-[var(--ui-radius-card)] border border-transparent bg-[rgba(241,243,246,0.72)] px-3 py-2 text-sm leading-6 text-[var(--accent-strong)] transition hover:bg-[rgba(226,232,240,0.86)]'
              : 'group relative flex min-h-[3.25rem] w-full cursor-pointer items-center gap-3 rounded-[var(--ui-radius-card)] border border-transparent bg-transparent px-3 py-2 text-sm leading-6 text-[var(--foreground)] transition hover:bg-white/42'
        }
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
          className={
            conversation.pinned
              ? 'pointer-events-none relative z-10 h-4 w-4 shrink-0 text-[var(--accent-strong)]'
              : 'pointer-events-none relative z-10 h-4 w-4 shrink-0 text-[var(--soft-foreground)]'
          }
        />

        {isRenaming ? (
          <Input
            autoFocus
            controlSize="sm"
            value={draftSidebarConversationTitle}
            onChange={(event) => setDraftSidebarConversationTitle(event.target.value)}
            onBlur={() => commitSidebarConversationRename(conversation)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitSidebarConversationRename(conversation)
              }

              if (event.key === 'Escape') {
                event.preventDefault()
                cancelSidebarConversationRename()
              }
            }}
            className="relative z-20 min-w-0 flex-1 rounded-[var(--ui-radius-control)] bg-white/86 font-semibold"
            aria-label="重命名对话"
          />
        ) : (
          <div className="pointer-events-none relative z-10 min-w-0 flex-1 py-1 text-left">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">{conversation.title}</span>
              {conversation.finalizedAt ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-[rgba(42,157,143,0.16)] bg-[rgba(232,248,245,0.7)] px-1.5 py-0.5 text-[length:var(--ui-text-caption)] font-semibold leading-none text-[#17675b]">
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
                  sidebarConversationMenuButtonRefs.current.set(conversation.id, node)
                } else {
                  sidebarConversationMenuButtonRefs.current.delete(conversation.id)
                }
              }}
              type="button"
              data-sidebar-conversation-menu
              onClick={(event) => {
                event.stopPropagation()
                if (openSidebarConversationMenuId !== conversation.id) {
                  updateSidebarConversationMenuPosition(conversation.id)
                }
                setOpenSidebarConversationMenuId((current) =>
                  current === conversation.id ? '' : conversation.id,
                )
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className={
                openSidebarConversationMenuId === conversation.id
                  ? 'absolute inset-0 flex h-8 w-8 items-center justify-center rounded-full text-[var(--accent-strong)] opacity-100 transition hover:bg-[var(--accent-soft)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]'
                  : 'absolute inset-0 flex h-8 w-8 items-center justify-center rounded-full text-[var(--soft-foreground)] opacity-0 transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] focus-visible:ring-4 focus-visible:ring-[var(--ring)] group-hover:opacity-100 group-focus-within:opacity-100'
              }
              aria-label="对话更多操作"
              aria-haspopup="menu"
              aria-expanded={openSidebarConversationMenuId === conversation.id}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {openSidebarConversationMenuId === conversation.id && typeof document !== 'undefined'
          ? createPortal(
              <div
                data-sidebar-conversation-menu
                className="ui-popover-motion fixed z-[100] w-36 overflow-hidden rounded-[var(--ui-radius-panel)] border border-white/84 bg-white/95 p-[var(--ui-space-1)] text-sm font-medium text-[var(--foreground)] shadow-[0_18px_48px_rgba(48,34,22,0.12)] backdrop-blur-xl"
                role="menu"
                style={{
                  left: sidebarConversationMenuPosition.left,
                  top: sidebarConversationMenuPosition.top,
                }}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Escape') {
                    setOpenSidebarConversationMenuId('')
                    sidebarConversationMenuButtonRefs.current.get(conversation.id)?.focus()
                  }
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation()
                    startSidebarConversationRename(conversation)
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
                    handleToggleConversationPin(conversation.id)
                    setOpenSidebarConversationMenuId('')
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
  }

  function renderWorkflowSidebar() {
    if (!isConversationSidebarOpen) return null

    return (
      <>
        <button
          type="button"
          aria-label="关闭对话列表"
          onClick={() => setIsConversationSidebarOpen(false)}
          className="fixed inset-0 z-[70] bg-[rgba(15,23,42,0.16)] backdrop-blur-[2px]"
        />
        <aside className="fixed inset-y-0 left-0 z-[80] flex w-[min(20rem,calc(100vw-2rem))] min-h-0 flex-col border-r border-[rgba(15,23,42,0.06)] bg-[linear-gradient(180deg,#f4f6f8_0%,#f7f9fb_58%,#fbfcfd_100%)] shadow-[18px_0_60px_rgba(15,23,42,0.12)]">
        <div className="shrink-0 px-6 pb-3 pt-6">
          <div className="flex items-center gap-3 px-1">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => {
                setIsConversationSidebarOpen(false)
                goToStep('workspace')
              }}
              aria-label="返回首页"
              className="shrink-0"
            >
              <Home className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-[var(--foreground)]">
                {activeProject.name}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsConversationSidebarOpen(false)}
              aria-label="关闭对话列表"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <Button
            type="button"
            onClick={handleCreateConversation}
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
            {sidebarConversations.map((conversation) => renderSidebarConversationRow(conversation))}
          </div>
        </div>
        </aside>
      </>
    )
  }

  function getWorkflowEmptyCopy(targetStep: Exclude<ConversationStep, 'learn' | 'length'>) {
    if (!hasLearningResult) {
      return {
        title:
          targetStep === 'plan'
              ? '先描述这次想写什么'
              : targetStep === 'rewrite'
              ? '还没有可编辑的文案'
                : '还没有可预演的文案',
        description: '先确认本次需求，参考素材可以不选。',
        actionLabel: '返回创作开始',
      }
    }

    return {
      title:
        targetStep === 'rewrite'
          ? '还没有可编辑的文案'
          : targetStep === 'reader'
            ? '还没有可预演的文案'
            : '当前环节还没有内容',
      description:
        targetStep === 'rewrite'
          ? '生成后，你可以在这里逐句调整内容。'
          : targetStep === 'reader'
            ? '生成并确认初稿后，可以从读者视角检查表达。'
            : '当前环节暂无内容。',
      actionLabel: targetStep === 'rewrite' || targetStep === 'reader' ? '生成初稿' : '返回创作开始',
    }
  }

  function renderWorkflowEmptyState(targetStep: Exclude<ConversationStep, 'learn' | 'length'>) {
    const copy = getWorkflowEmptyCopy(targetStep)
    const nextStep: ConversationStep =
      (targetStep === 'rewrite' || targetStep === 'reader') && hasPlanReady
        ? 'plan'
        : 'learn'

    return (
      <div className="flex h-full min-h-0 items-start justify-center px-4 pb-8 pt-[clamp(2rem,10vh,5rem)]">
        <section className="ui-surface-enter w-full max-w-[42rem] rounded-[var(--ui-radius-panel)] border border-white/72 bg-white/64 px-5 py-6 shadow-[0_18px_48px_rgba(48,34,22,0.055)] sm:px-7 sm:py-8">
          <div className="flex size-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="mt-5 text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            {copy.title}
          </h2>
          <p className="mt-3 max-w-[36rem] text-sm leading-7 text-[var(--muted-foreground)]">
            {copy.description}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => goToStep(nextStep)}>
              {copy.actionLabel}
            </Button>
          </div>
        </section>
      </div>
    )
  }

  function renderPlan() {
    return (
      <div className="relative h-[100dvh] overflow-hidden bg-[linear-gradient(120deg,#eef2f6_0%,#f6f8fb_46%,#ffffff_100%)]">
        {renderWorkflowSidebar()}

        <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(148,163,184,0.08),transparent_34%),linear-gradient(180deg,#f6f8fb_0%,#fbfcfd_52%,#ffffff_100%)]">
          <header className="grid shrink-0 grid-cols-1 items-center gap-3 bg-transparent px-5 py-4 lg:px-6 xl:grid-cols-[minmax(12rem,1fr)_auto_minmax(12rem,1fr)]">
            <div className="flex min-w-0 items-center">
              <WorkflowHeaderNav
                onBackToWorkspace={() => goToStep('workspace')}
                onOpenSidebar={() => setIsConversationSidebarOpen(true)}
              />
              <h1 className="truncate text-2xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                准备初稿
              </h1>
            </div>

            <WorkflowStageNav
              activeStep="draft"
              onStepChange={handleWorkflowStepChange}
              steps={workflowSteps}
            />

            <div className="flex flex-wrap items-center gap-3 xl:justify-self-end">
              <Button variant="secondary" size="sm" onClick={() => void handleOpenWritingProfile()}>
                <Sparkles className="h-4 w-4" />
                表达档案
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden px-4 pb-5 pt-1 lg:px-6">
            {hasPlanReady ? (
              <section className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-6 pt-5 md:px-4 [scrollbar-gutter:stable]">
                  <div className="grid gap-5">
                    <section className="border-b border-[var(--border)] px-1 pb-6 md:px-3">
                      <LearningResult
                        analysis={analysis}
                        isCloudEnabled={isUsingCloudLibrary}
                        referenceCount={selectedNotes.length}
                        snippetCount={selectedSnippets.length}
                      />

                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{activeConversation.targetAudience}</Badge>
                          <Badge variant="outline">
                            {effectiveLength === 'short'
                              ? '短篇幅'
                              : effectiveLength === 'medium'
                                ? '中篇幅'
                                : '长篇幅'}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={
                              isWritingBriefValid
                                ? 'inline-flex items-center gap-1.5 text-xs font-semibold text-[#17675b]'
                                : 'inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--destructive)]'
                            }
                            role="status"
                          >
                            {isWritingBriefValid ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5" />
                            )}
                            {isWritingBriefValid
                              ? '可以生成'
                              : `还缺：${missingBriefFields.join('、')}`}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-expanded={isWritingBriefOpen}
                            onClick={() => setIsWritingBriefOpen((current) => !current)}
                          >
                            {isWritingBriefOpen ? '收起生成设置' : '检查生成设置'}
                          </Button>
                        </div>
                      </div>

                      {isWritingBriefOpen ? (
                        <div className="mt-5 grid gap-4 border-t border-[var(--border)] pt-5 lg:grid-cols-2">
                        {draftFactGap ? (
                          <div
                            className="grid gap-3 border border-[rgba(169,118,38,0.22)] bg-[rgba(246,239,223,0.62)] px-4 py-3 lg:col-span-2"
                            role="status"
                          >
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(146,99,31)]" />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-[var(--foreground)]">
                                  还差一点关键信息
                                </p>
                                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                                  {draftFactGap.summary}
                                </p>
                              </div>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {draftFactGap.missingFacts.map((missingFact) => (
                                <div
                                  key={missingFact.id}
                                  className="border-l-2 border-[rgba(169,118,38,0.34)] pl-3"
                                >
                                  <p className="text-xs font-semibold text-[var(--foreground)]">
                                    {missingFact.label}
                                  </p>
                                  <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
                                    {missingFact.question}
                                  </p>
                                </div>
                              ))}
                            </div>
                            <p className="text-xs leading-5 text-[var(--soft-foreground)]">
                              将答案补到下方“希望保留的信息”，不确定的内容可以明确写“暂不展开”
                            </p>
                          </div>
                        ) : null}
                        <label className="grid gap-2">
                          <span className="text-sm font-semibold text-[var(--foreground)]">
                            内容主题 <span className="text-[var(--destructive)]">必填</span>
                          </span>
                          <Input
                            value={activeConversation.topic}
                            onChange={(event) => handleWritingBriefChange('topic', event.target.value)}
                            placeholder="例如：第一次骑深圳湾 15 公里的真实体验"
                          />
                        </label>
                        <label className="grid gap-2">
                          <span className="text-sm font-semibold text-[var(--foreground)]">
                            目标读者 <span className="text-[var(--destructive)]">必填</span>
                          </span>
                          <Input
                            value={activeConversation.targetAudience}
                            onChange={(event) =>
                              handleWritingBriefChange('targetAudience', event.target.value)
                            }
                            placeholder="例如：怕晒、担心路线太难的骑行新手"
                          />
                        </label>
                        <fieldset className="grid gap-2 lg:col-span-2">
                          <legend className="text-sm font-semibold text-[var(--foreground)]">
                            篇幅 <span className="text-[var(--destructive)]">必选</span>
                          </legend>
                          <div
                            className="grid gap-1 rounded-[var(--ui-radius-control)] bg-[var(--surface-muted)] p-1 sm:grid-cols-3"
                            role="radiogroup"
                            aria-label="篇幅"
                          >
                            {lengthOptions.map((option) => {
                              const isSelected = activeConversation.length === option.value
                              return (
                                <Button
                                  key={option.value}
                                  type="button"
                                  variant="ghost"
                                  role="radio"
                                  aria-checked={isSelected}
                                  onClick={() => handleLengthChange(option.value)}
                                  className={
                                    isSelected
                                      ? 'h-auto justify-start gap-2 rounded-[calc(var(--ui-radius-control)-0.25rem)] bg-white px-3 py-2.5 text-left text-[var(--foreground)] shadow-[0_4px_14px_rgba(48,34,22,0.06)] hover:bg-white sm:justify-center'
                                      : 'h-auto justify-start rounded-[calc(var(--ui-radius-control)-0.25rem)] px-3 py-2.5 text-left text-[var(--muted-foreground)] hover:bg-white/60 hover:text-[var(--foreground)] sm:justify-center'
                                  }
                                >
                                  {isSelected ? <CheckCircle2 className="h-4 w-4 text-[var(--accent-strong)]" /> : null}
                                  <span>
                                    <span className="block text-sm font-semibold">{option.title}</span>
                                    <span className="block text-xs font-normal text-[var(--soft-foreground)]">
                                      {option.lines[0]}
                                    </span>
                                  </span>
                                </Button>
                              )
                            })}
                          </div>
                        </fieldset>
                        <label className="grid gap-2 lg:col-span-2">
                          <span className="text-sm font-semibold text-[var(--foreground)]">写作目标</span>
                          <Input
                            value={activeConversation.writingBrief.objective}
                            onChange={(event) => handleWritingBriefChange('objective', event.target.value)}
                            placeholder="希望读者看完理解、相信或采取什么行动"
                          />
                        </label>
                        <label className="grid gap-2">
                          <span className="text-sm font-semibold text-[var(--foreground)]">
                            希望保留的信息
                          </span>
                          <Textarea
                            value={activeConversation.writingBrief.requiredFacts}
                            onChange={(event) =>
                              handleWritingBriefChange('requiredFacts', event.target.value)
                            }
                            className="resize-y"
                            placeholder="只填写可以确认的事实，例如：全程约 15 公里、傍晚出发更避晒"
                          />
                        </label>
                        <label className="grid gap-2">
                          <span className="text-sm font-semibold text-[var(--foreground)]">表达边界</span>
                          <Textarea
                            value={activeConversation.writingBrief.boundaries}
                            onChange={(event) =>
                              handleWritingBriefChange('boundaries', event.target.value)
                            }
                            className="resize-y"
                            placeholder="例如：不要夸大难度，不用攻略站口吻"
                          />
                        </label>
                        {activeConversation.writingBrief.instructions ? (
                          <label className="grid gap-2 lg:col-span-2">
                            <span className="text-sm font-semibold text-[var(--foreground)]">补充要求</span>
                            <Textarea
                              value={activeConversation.writingBrief.instructions}
                              onChange={(event) =>
                                handleWritingBriefChange('instructions', event.target.value)
                              }
                              className="resize-y"
                            />
                          </label>
                        ) : null}
                        </div>
                      ) : null}

                      {planAttachments.length > 0 ? (
                        <div className="mt-4">
                          <div className="flex flex-wrap gap-2">
                            {planAttachments.map((attachment) => (
                              <span
                                key={attachment.id}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-muted)] py-1 pl-3 pr-1.5 text-xs font-semibold text-[var(--muted-foreground)]"
                              >
                                {attachment.kind === 'image' ? (
                                  <Image className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span className="max-w-[16rem] truncate">{attachment.name}</span>
                                <button
                                  type="button"
                                  onClick={() => handleRemovePlanAttachment(attachment.id)}
                                  className="flex size-[var(--ui-control-height-sm)] items-center justify-center rounded-full text-[var(--soft-foreground)] hover:bg-white/70 hover:text-[var(--foreground)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
                                  aria-label={`移除附件 ${attachment.name}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 text-xs leading-5 text-[var(--soft-foreground)]">
                            当前版本会保存附件名称，但尚未解析文件内容，不会把附件作为生成依据。
                          </p>
                        </div>
                      ) : null}
                    </section>

                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                        <Layers3 className="h-5 w-5" />
                      </div>
                      <div
                        data-plan-draft-card
                        className="max-w-[50rem] rounded-[var(--ui-radius-panel)] rounded-tl-[0.45rem] bg-white px-5 py-5 shadow-[0_14px_34px_rgba(48,34,22,0.05)]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={isUsingCloudLibrary ? 'accent' : 'outline'}>
                            {isUsingCloudLibrary ? 'AI 初稿' : '本地演示稿'}
                          </Badge>
                          <Badge variant="outline">标题 + 正文</Badge>
                        </div>
                        {!isUsingCloudLibrary ? (
                          <p
                            className="mt-3 rounded-[var(--ui-radius-card)] bg-[var(--surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]"
                            role="status"
                          >
                            当前未登录，这版只用于体验流程，不会调用 AI，也不代表真实生成质量或篇幅交付。
                          </p>
                        ) : null}
                        {hasDraftReady ? (
                          <>
                            <div className="mt-4">
                              {activeDraftQuality ? (
                                <DraftQualitySummary
                                  snapshot={activeDraftQuality}
                                  className="mb-4"
                                />
                              ) : null}
                              {renderInitialDraftCopy('plan')}
                            </div>
                            <div className="mt-3 flex justify-end border-t border-[rgba(31,22,17,0.06)] pt-3">
                              <div className="inline-flex items-center rounded-full bg-[rgba(241,243,246,0.78)] p-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleUndoDraftMove}
                                  disabled={!canUndoDraftMove}
                                  className="text-[var(--muted-foreground)] disabled:opacity-35"
                                >
                                  <Undo2 className="h-3.5 w-3.5" />
                                  撤回
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleRedoDraftMove}
                                  disabled={!canRedoDraftMove}
                                  className="text-[var(--muted-foreground)] disabled:opacity-35"
                                >
                                  <Redo2 className="h-3.5 w-3.5" />
                                  恢复
                                </Button>
                              </div>
                            </div>
                          </>
                        ) : isDraftGenerating ? (
                          renderDraftGenerationSkeleton()
                        ) : (
                          <div className="mt-5 border-t border-[rgba(31,22,17,0.06)] pt-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-sm leading-6 text-[var(--foreground)]">
                                <p className="font-semibold">
                                  {draftFactGap
                                    ? '还差一点关键信息'
                                    : isWritingBriefValid
                                    ? isUsingCloudLibrary
                                      ? '准备完成'
                                      : '可以生成流程演示稿'
                                    : '先补全创作简报'}
                                </p>
                                <p className="mt-1 text-[var(--muted-foreground)]">
                                  {draftFactGap
                                    ? `待补充：${draftFactGap.missingFacts
                                        .map((item) => item.label)
                                        .join('、')}`
                                    : isWritingBriefValid
                                    ? `${
                                        effectiveLength === 'short'
                                          ? '短篇幅'
                                          : effectiveLength === 'medium'
                                            ? '中篇幅'
                                            : '长篇幅'
                                      }｜${selectedNotes.length} 篇参考，${selectedSnippets.length} 条标注`
                                    : `还缺：${missingBriefFields.join('、')}`}
                                </p>
                                {hasStoredDraft && !hasDraftReady ? (
                                  <p className="mt-1 text-xs text-[var(--soft-foreground)]">
                                    上一版仍已保留，重新生成成功后才会替换当前工作稿。
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {draftFactGap?.canGenerateConservative ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleGenerateConservativeDraft}
                                    disabled={isDraftGenerating}
                                    className="text-[var(--muted-foreground)]"
                                  >
                                    按现有信息生成
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={handleGenerateDraft}
                                  disabled={isDraftGenerating || !canGenerateDraft}
                                >
                                  <WandSparkles className="h-4 w-4" />
                                  {draftFactGap
                                    ? '补充后重新检查'
                                    : draftGenerationError
                                      ? isUsingCloudLibrary
                                        ? '重新生成初稿'
                                        : '重新生成演示稿'
                                      : isUsingCloudLibrary
                                        ? '生成初稿'
                                        : '生成演示稿'}
                                </Button>
                              </div>
                            </div>
                            {draftGenerationError ? (
                              <p className="mt-3 text-sm leading-6 text-[rgb(185,28,28)]">
                                {draftGenerationError}
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                    {draftBridgeMessages.map((message) => renderDraftBridgeMessage(message))}

                    <div className="ml-0 grid gap-3 md:ml-[3.25rem]">
                      {[
                        { label: '补充信息', text: '还有必须保留的真实细节吗？' },
                        { label: '校准目标', text: '这版更偏收藏、评论，还是行动？' },
                        { label: '调整语气', text: '先把表达润得更像朋友分享。' },
                      ].map((question) => (
                        <button
                          key={question.label}
                          type="button"
                          onClick={() => setChatInput(question.text)}
                          className="w-fit rounded-full border border-[var(--border)] bg-white/76 px-4 py-2 text-left text-sm leading-6 text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.03)] transition hover:bg-white/94 focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
                        >
                          <span className="mr-2 text-[var(--accent-strong)]">{question.label}</span>
                          {question.text}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              <div className="shrink-0 bg-transparent px-1 pt-3 md:px-4">
                <div className="relative min-h-[var(--ui-chat-input-min)] rounded-[var(--ui-radius-panel)] border border-[rgba(15,23,42,0.08)] bg-[rgba(248,250,252,0.84)] shadow-[0_10px_24px_rgba(15,23,42,0.035)] transition focus-within:shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
                  <Textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        handleSendChat()
                      }
                    }}
                    className="min-h-[var(--ui-chat-input-min)] w-full resize-none border-0 bg-transparent px-[var(--ui-chat-input-px)] py-[var(--ui-chat-input-py)] pb-[4.25rem] pr-[var(--ui-chat-action-pr)] text-base leading-7 text-[var(--foreground)] shadow-none outline-none placeholder:text-[var(--soft-foreground)] focus:border-transparent focus:ring-0 focus-visible:ring-0"
                    placeholder="补充文案信息，或说明要调整的方向..."
                  />
                  <label className="absolute bottom-4 left-6 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--soft-foreground)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] focus-within:ring-4 focus-within:ring-[var(--ring)]">
                    <Paperclip className="h-4 w-4" />
                    <span className="sr-only">添加附件</span>
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.xlsx"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        handleAddPlanAttachments(event.target.files)
                        event.target.value = ''
                      }}
                    />
                  </label>
                  <Button
                    className="absolute bottom-4 right-8"
                    onClick={handleSendChat}
                    disabled={isChatStreaming || !chatInput.trim()}
                    aria-label="发送文案信息"
                  >
                    <Send className="h-4 w-4" />
                    发送
                  </Button>
                </div>
              </div>
            </section>
            ) : (
              renderWorkflowEmptyState('plan')
            )}
          </div>
        </section>
      </div>
    )
  }

  function renderRewrite() {
    return (
      <div
        key="rewrite-workspace"
        className="relative h-[100dvh] overflow-hidden bg-[linear-gradient(120deg,#eef2f6_0%,#f6f8fb_46%,#ffffff_100%)]"
      >
        {renderWorkflowSidebar()}

        <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(148,163,184,0.08),transparent_34%),linear-gradient(180deg,#f6f8fb_0%,#fbfcfd_52%,#ffffff_100%)]">
          <header className="grid shrink-0 grid-cols-1 items-center gap-3 bg-transparent px-5 py-4 lg:px-6 xl:grid-cols-[minmax(12rem,1fr)_auto_minmax(12rem,1fr)]">
            <div className="flex min-w-0 items-center">
              <WorkflowHeaderNav
                onBackToWorkspace={() => goToStep('workspace')}
                onOpenSidebar={() => setIsConversationSidebarOpen(true)}
              />
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                  编辑文案
                </h1>
                <div className="mt-0.5">{renderWorkspaceSaveIndicator()}</div>
              </div>
            </div>

            <WorkflowStageNav
              activeStep="review"
              onStepChange={handleWorkflowStepChange}
              steps={workflowSteps}
            />

            <div className="flex w-full flex-nowrap items-center justify-end gap-2 sm:w-auto sm:flex-wrap sm:gap-3 xl:justify-self-end">
              <Button
                variant="secondary"
                size="sm"
                aria-label="打开表达档案"
                tooltip="表达档案"
                onClick={() => void handleOpenWritingProfile()}
              >
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">表达档案</span>
              </Button>
              {activeDraftVersions.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="打开文案历史版本"
                  tooltip="文案历史版本"
                  onClick={() => setIsDraftVersionHistoryOpen(true)}
                >
                  <History className="h-4 w-4" />
                  <span className="hidden sm:inline">历史版本 {activeDraftVersions.length}</span>
                  <span className="sm:hidden">{activeDraftVersions.length}</span>
                </Button>
              ) : null}
              {hasDraftReady ? (
                <Button
                  onClick={() => void handleFinalizeReaderPreview('rewrite')}
                  disabled={!canFinalizeDraft}
                  tooltip={!canFinalizeDraft ? '先修正未通过的篇幅检查' : undefined}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {activeConversation.finalizedAt ? '再次复制' : '完成并复制'}
                </Button>
              ) : null}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-1 lg:px-6 xl:overflow-hidden">
            {hasDraftReady ? (
              <div className="min-h-full rounded-[var(--ui-radius-panel)] bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(241,245,249,0.32))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] xl:h-full xl:min-h-0">
                <div
                  className={cn(
                    'grid min-h-0 gap-0',
                    isRewriteAssistantVisible
                      ? 'gap-4 xl:h-full xl:grid-cols-[minmax(0,1.08fr)_1px_minmax(22rem,0.78fr)] xl:gap-0'
                      : 'h-full',
                  )}
                >
                  <section
                    className={cn(
                      'relative flex min-h-0 flex-col overflow-hidden',
                      isRewriteAssistantVisible && 'min-h-[32rem] xl:min-h-0',
                    )}
                  >
                    <div
                      className="min-h-0 flex-1 overflow-y-auto px-6 py-5 lg:px-8 lg:py-6"
                      onMouseUp={handleCaptureRewriteSelection}
                      onKeyUp={handleCaptureRewriteSelection}
                    >
                      <div className="mx-auto max-w-[52rem] px-1 py-1 lg:px-2 lg:py-2">
                        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[rgba(74,50,28,0.08)] pb-3 text-[length:var(--ui-text-caption)] font-medium text-[var(--soft-foreground)]">
                          <span className="inline-flex h-6 items-center gap-1.5">
                            <PenLine className="h-3.5 w-3.5 text-[var(--accent-strong)]" aria-hidden="true" />
                            点击文字直接编辑
                          </span>
                          <span className="inline-flex h-6 items-center gap-1.5">
                            <MousePointer2 className="h-3.5 w-3.5 text-[var(--accent-strong)]" aria-hidden="true" />
                            圈选后用 AI 修改
                          </span>
                        </div>
                        {activeDraftQuality ? (
                          <DraftQualitySummary
                            snapshot={activeDraftQuality}
                            className="mb-5"
                          />
                        ) : null}
                        {renderInitialDraftCopy('rewrite')}
                      </div>
                      {rewriteSelectionCandidate && typeof document !== 'undefined'
                        ? createPortal(
                            <button
                              type="button"
                              data-rewrite-selection-popover
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={handleConfirmRewriteSelection}
                              className="fixed z-[110] inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/95 px-2.5 text-xs font-semibold text-[var(--foreground)] shadow-[0_14px_36px_rgba(48,34,22,0.14)] backdrop-blur-xl transition hover:bg-[var(--accent-soft)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
                              style={{
                                left: rewriteSelectionCandidate.position.left,
                                top: rewriteSelectionCandidate.position.top,
                              }}
                            >
                              <Highlighter className="h-3.5 w-3.5" />
                              确认修改
                            </button>,
                            document.body,
                          )
                        : null}
                    </div>
                  </section>

                  {isRewriteAssistantVisible ? (
                    <>
                      <div className="hidden h-full w-px bg-[linear-gradient(180deg,transparent,rgba(15,23,42,0.10)_18%,rgba(103,199,255,0.12)_50%,rgba(15,23,42,0.08)_82%,transparent)] xl:block" />

                      <aside className="relative flex min-h-[32rem] flex-col overflow-hidden bg-[rgba(248,250,252,0.5)] xl:min-h-0">
                    <div className="relative min-h-0 flex-1 overflow-y-auto p-5 lg:p-6">
                      <div className="grid gap-3">
                        {selectedRewriteText ? (
                          <div className="rounded-[var(--ui-radius-card)] border border-[var(--border)] bg-white/82 px-4 py-3 text-sm leading-6 text-[var(--foreground)] shadow-[0_12px_30px_rgba(74,50,28,0.055)]">
                            <p className="mb-1 text-xs font-medium text-[var(--soft-foreground)]">
                              正在修改
                            </p>
                            <p className="max-h-[4.5rem] overflow-hidden text-[length:var(--ui-text-meta)] leading-6 text-[var(--muted-foreground)]">
                              {selectedRewriteText}
                            </p>
                          </div>
                        ) : null}

                      {rewriteMessages.map((message) => (
                        <div
                          key={message.id}
                          className={
                            message.role === 'user'
                              ? 'max-w-[92%] justify-self-end rounded-[var(--ui-radius-panel)] rounded-tr-[0.45rem] bg-[var(--foreground)] px-4 py-3 text-sm leading-7 text-white shadow-[0_16px_34px_rgba(15,23,42,0.16)]'
                              : 'w-full rounded-[var(--ui-radius-panel)] rounded-tl-[0.45rem] bg-white px-4 py-4 text-sm leading-7 text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.04)]'
                          }
                        >
                          {message.selectedText ? (
                            <p className={message.role === 'user' ? 'mb-2 text-xs text-white/78' : 'mb-2 line-clamp-2 text-xs text-[var(--soft-foreground)]'}>
                              针对：{message.selectedText}
                            </p>
                          ) : null}
                          {message.lines.map((line, lineIndex) => (
                            <p key={`${message.id}-${lineIndex}`}>{line}</p>
                          ))}
                          {message.suggestions ? (
                            <div className="mt-3 divide-y divide-[rgba(15,23,42,0.08)] border-t border-[rgba(15,23,42,0.08)]">
                              {message.suggestions.map((suggestion, suggestionIndex) => {
                                const isAvailable = suggestion.status === 'available'
                                const isRecommended = message.recommendedIndex === suggestionIndex
                                return (
                                  <div
                                    key={suggestion.id}
                                    className={[
                                      'py-4 first:pt-3 last:pb-0',
                                      suggestion.status === 'rejected' || suggestion.status === 'superseded'
                                        ? 'opacity-55'
                                        : '',
                                    ].join(' ')}
                                  >
                                    <div className="mb-2 flex flex-wrap items-center gap-2">
                                      <span className="font-semibold text-[var(--foreground)]">
                                        {suggestion.label}
                                      </span>
                                      {isRecommended ? <Badge variant="accent">推荐</Badge> : null}
                                      {suggestion.status === 'accepted' ? (
                                        <Badge variant="accent" className="gap-1">
                                          <CheckCircle2 className="h-3 w-3" />
                                          已采用
                                        </Badge>
                                      ) : null}
                                      {suggestion.status === 'rejected' ? (
                                        <Badge>不喜欢</Badge>
                                      ) : null}
                                      {suggestion.status === 'superseded' ? (
                                        <Badge>未采用</Badge>
                                      ) : null}
                                    </div>
                                    <p className="whitespace-pre-wrap text-[length:var(--ui-text-meta)] font-medium leading-7 text-[var(--foreground)]">
                                      {suggestion.text}
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-[var(--soft-foreground)]">
                                      {suggestion.rationale}
                                    </p>
                                    {isAvailable ? (
                                      <div className="mt-3 flex justify-end gap-2">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleRejectRewriteSuggestion(message, suggestion)}
                                        >
                                          不喜欢
                                        </Button>
                                        <Button
                                          variant={isRecommended ? 'default' : 'secondary'}
                                          size="sm"
                                          onClick={() => handleAcceptRewriteSuggestion(message, suggestion)}
                                        >
                                          采用此版
                                        </Button>
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {rewritePendingConversationId === activeConversation.id ? (
                        <div className="flex items-center gap-2 px-1 py-2 text-sm text-[var(--soft-foreground)]">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          正在结合你的写作偏好生成局部版本…
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="relative shrink-0 border-t border-white/72 bg-white/58 p-4 backdrop-blur-xl">
                    <div className="relative min-h-[172px] rounded-[var(--ui-radius-panel)] border border-white/80 bg-white/90 shadow-[0_14px_36px_rgba(48,34,22,0.055)] transition focus-within:border-[rgba(15,23,42,0.18)] focus-within:shadow-[0_20px_52px_rgba(48,34,22,0.09)]">
                      <Textarea
                        ref={rewriteInputRef}
                        data-rewrite-chat-input
                        value={rewriteChatInput}
                        onChange={(event) => setRewriteChatInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                            handleSendRewriteChat()
                          }
                        }}
                        className="min-h-[172px] w-full resize-none border-0 bg-transparent px-[var(--ui-chat-input-px)] py-[var(--ui-chat-input-py)] pb-[var(--ui-chat-input-pb)] text-sm leading-6 text-[var(--foreground)] shadow-none outline-none placeholder:text-[var(--soft-foreground)] focus:border-transparent focus:ring-0 focus-visible:ring-0"
                        placeholder={selectedRewriteText ? '说说已高亮内容想怎么改，⌘/Ctrl + Enter 发送' : '先圈选左侧内容并确认修改'}
                      />
                      <div className="absolute bottom-4 right-4 flex items-center gap-2">
                        {selectedRewriteText ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={clearRewriteSelection}
                            title="取消圈选，也可按 Esc"
                          >
                            <X className="h-4 w-4" />
                            取消圈选
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          onClick={handleSendRewriteChat}
                          disabled={
                            !selectedRewriteText ||
                            !rewriteChatInput.trim() ||
                            rewritePendingConversationId === activeConversation.id
                          }
                        >
                          {rewritePendingConversationId === activeConversation.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          {rewritePendingConversationId === activeConversation.id ? '生成中' : '发送'}
                        </Button>
                      </div>
                    </div>
                  </div>
                      </aside>
                    </>
                  ) : null}
              </div>
              </div>
            ) : (
              renderWorkflowEmptyState('rewrite')
            )}
          </div>
        </section>
      </div>
    )
  }

  function getReaderFeedbackToneClass(tone: ReaderFeedbackTone) {
    if (tone === 'interest') {
      return 'border-[rgba(42,157,143,0.18)] bg-[rgba(232,248,245,0.72)] text-[#17675b]'
    }
    if (tone === 'risk') {
      return 'border-[rgba(214,90,60,0.18)] bg-[rgba(255,241,237,0.78)] text-[#b94f38]'
    }
    if (tone === 'question') {
      return 'border-[rgba(103,199,255,0.2)] bg-[rgba(235,248,255,0.72)] text-[#28769a]'
    }
    return 'border-[rgba(15,23,42,0.12)] bg-[rgba(241,243,246,0.82)] text-[var(--foreground)]'
  }

  function getReaderFeedbackIcon(tone: ReaderFeedbackTone) {
    if (tone === 'interest') return ThumbsUp
    if (tone === 'risk') return AlertTriangle
    if (tone === 'question') return MessageCircle
    return WandSparkles
  }

  function renderReaderAnnotationComment(annotation: ReaderDraftAnnotation) {
    const Icon = getReaderFeedbackIcon(annotation.tone)
    const isActive = activeReaderAnnotationId === annotation.id

    return (
      <article key={annotation.id} className="ui-list-item-motion grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
        <div className="flex justify-center pt-4">
          <span
            className={[
              `inline-flex h-8 min-w-8 items-center justify-center rounded-full border text-xs font-bold ${getReaderFeedbackToneClass(annotation.tone)}`,
              isActive ? 'ring-4 ring-[rgba(15,23,42,0.1)]' : '',
            ].filter(Boolean).join(' ')}
          >
            {annotation.noteNumber}
          </span>
        </div>
        <section
          id={`reader-comment-${annotation.id}`}
          ref={(node) => {
            if (node) {
              readerCommentRefs.current.set(annotation.id, node)
            } else {
              readerCommentRefs.current.delete(annotation.id)
            }
          }}
          aria-current={isActive ? 'true' : undefined}
          data-reader-comment={annotation.id}
          className={[
            'scroll-mt-5 rounded-[var(--ui-radius-card)] border px-4 py-4 transition duration-300',
            isActive
              ? 'border-[rgba(15,23,42,0.18)] bg-white shadow-[0_20px_52px_rgba(15,23,42,0.1),0_0_0_4px_rgba(15,23,42,0.06)]'
              : 'border-white/76 bg-white/82 shadow-[0_12px_28px_rgba(48,34,22,0.045)]',
          ].join(' ')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${getReaderFeedbackToneClass(annotation.tone)}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {annotation.label}
            </span>
            <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">
              {annotation.title}
            </h3>
          </div>
          <p className="mt-3 rounded-[var(--ui-radius-card)] bg-[rgba(241,243,246,0.72)] px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]">
            对应文案：{annotation.text}
          </p>
          <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--foreground)]">
            {annotation.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>
      </article>
    )
  }

  function renderReaderFeedbackBlock(block: ReaderFeedbackBlock) {
    const Icon = getReaderFeedbackIcon(block.tone)

    return (
      <section
        key={block.title}
        className="ui-surface-enter rounded-[var(--ui-radius-card)] border border-white/76 bg-[rgba(248,250,252,0.78)] px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${getReaderFeedbackToneClass(block.tone)}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {block.label}
          </span>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {block.title}
          </h3>
        </div>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--foreground)]">
          {block.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>
    )
  }

  function renderReaderPreview() {
    return (
      <div
        key="reader-preview"
        className="relative h-[100dvh] overflow-hidden bg-[linear-gradient(120deg,#eef2f6_0%,#f6f8fb_46%,#ffffff_100%)]"
      >
        {renderWorkflowSidebar()}

        <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(148,163,184,0.08),transparent_34%),linear-gradient(180deg,#f6f8fb_0%,#fbfcfd_52%,#ffffff_100%)]">
          <header className="grid shrink-0 grid-cols-1 items-center gap-3 bg-transparent px-5 py-4 lg:px-6 xl:grid-cols-[minmax(12rem,1fr)_auto_minmax(12rem,1fr)]">
            <div className="flex min-w-0 items-center">
              <WorkflowHeaderNav
                onBackToWorkspace={() => goToStep('workspace')}
                onOpenSidebar={() => setIsConversationSidebarOpen(true)}
              />
              <h1 className="truncate text-2xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                读者预演
              </h1>
            </div>

            <WorkflowStageNav
              activeStep="confirm"
              onStepChange={handleWorkflowStepChange}
              steps={workflowSteps}
            />

            <div className="flex w-full flex-wrap items-center gap-3 xl:w-auto xl:justify-self-end">
              <Button
                variant="secondary"
                size="sm"
                aria-label="打开表达档案"
                tooltip="表达档案"
                onClick={() => void handleOpenWritingProfile()}
              >
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">表达档案</span>
              </Button>
              {isReaderPreviewVisible ? (
                <div ref={readerAudiencePopoverRef} className="relative w-full sm:w-auto">
                <button
                  type="button"
                  data-reader-audience-trigger
                  onClick={() => setIsReaderAudienceOpen((current) => !current)}
                  aria-expanded={isReaderAudienceOpen}
                  aria-label="目标用户群体"
                  title={effectiveReaderAudience || '设置目标用户'}
                  className="flex h-[var(--ui-control-height-sm)] w-full min-w-0 items-center gap-[var(--ui-gap-control)] rounded-[var(--ui-radius-control)] border border-[rgba(31,22,17,0.12)] bg-white/92 px-[var(--ui-space-3)] text-left text-sm shadow-none outline-none transition hover:border-[rgba(15,23,42,0.18)] focus-visible:border-[rgba(15,23,42,0.24)] focus-visible:ring-4 focus-visible:ring-[var(--ring)] sm:w-[min(22rem,34vw)] sm:min-w-[16rem]"
                >
                  <span className="flex shrink-0 items-center gap-1.5 font-semibold text-[var(--foreground)]">
                    <Users className="h-4 w-4 text-[var(--accent-strong)]" />
                    目标用户
                  </span>
                  <span
                    className={
                      effectiveReaderAudience
                        ? 'min-w-0 flex-1 truncate font-medium text-[var(--foreground)]'
                        : 'min-w-0 flex-1 truncate font-medium text-[var(--soft-foreground)]'
                    }
                  >
                    {effectiveReaderAudience || '设置目标用户'}
                  </span>
                </button>
                {isReaderAudienceOpen ? (
                  <div
                    data-reader-audience-popover
                    className="absolute right-0 top-full z-30 mt-2 w-[min(23rem,calc(100vw-2rem))] rounded-[var(--ui-radius-panel)] border border-white/80 bg-white/94 p-4 shadow-[0_22px_60px_rgba(48,34,22,0.14)] backdrop-blur-xl"
                  >
                    <label className="grid gap-2">
                      <span className="text-sm font-semibold text-[var(--foreground)]">
                        目标用户群体
                      </span>
                      <span className="text-xs leading-5 text-[var(--muted-foreground)]">
                        用于模拟阅读反馈。
                      </span>
                      <Textarea
                        value={effectiveReaderAudience}
                        onChange={(event) => handleReaderAudienceChange(event.target.value)}
                        className="resize-none rounded-[var(--ui-field-radius)] bg-white/84 text-sm leading-6 shadow-none"
                        placeholder="例如：刚开始骑行、怕路线太难、想找周末轻松路线的新手"
                      />
                    </label>
                  </div>
                ) : null}
                </div>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setIsReaderPreviewVisible(true)
                  void handleGenerateReaderPreview(true)
                }}
                disabled={readerPreviewPendingConversationId === activeConversation.id}
              >
                {readerPreviewPendingConversationId === activeConversation.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                {readerPreviewPendingConversationId === activeConversation.id
                  ? '预演中'
                  : isReaderPreviewVisible
                    ? '重新预演'
                    : '开始预演'}
              </Button>
              {!isReaderPreviewVisible ? (
                <Button
                  size="sm"
                  onClick={() => void handleFinalizeReaderPreview('reader')}
                  disabled={!canFinalizeDraft}
                  tooltip={!canFinalizeDraft ? '先修正未通过的篇幅检查' : undefined}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {activeConversation.finalizedAt ? '再次复制文案' : '确认成稿并复制'}
                </Button>
              ) : null}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-1 xl:overflow-hidden lg:px-6">
            {hasDraftReady ? (
              <div
                className={
                  isReaderPreviewVisible
                    ? 'grid min-h-0 gap-4 xl:h-full xl:grid-cols-[minmax(0,0.88fr)_minmax(24rem,1fr)]'
                    : 'mx-auto h-full min-h-0 w-full max-w-[58rem]'
                }
              >
                <section className="flex min-h-[22rem] flex-col overflow-hidden rounded-[var(--ui-radius-panel)] border border-[var(--border)] bg-[var(--surface-muted)] shadow-none xl:min-h-0">
                  <div className="shrink-0 border-b border-[var(--border)] px-6 py-4 lg:px-7">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={activeDraftQuality?.overallStatus === 'passed' ? 'accent' : 'outline'}
                        className={
                          activeDraftQuality?.overallStatus === 'failed'
                            ? 'text-[#a3412f]'
                            : activeDraftQuality?.overallStatus === 'needs_review'
                              ? 'text-[#8a5a16]'
                              : undefined
                        }
                      >
                        {activeConversation.finalizedAt
                          ? '已确认成稿'
                          : activeDraftQuality?.overallStatus === 'passed'
                            ? '生成检查通过'
                            : activeDraftQuality?.overallStatus === 'needs_review'
                              ? '修改后待确认'
                              : activeDraftQuality?.overallStatus === 'failed'
                                ? '检查未通过'
                                : '待确认文案'}
                      </Badge>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-8 lg:py-7">
                    <div className="mx-auto max-w-4xl">
                      {renderInitialDraftCopy('reader')}
                    </div>
                  </div>
                </section>

                {isReaderPreviewVisible ? (
                  <aside className="flex min-h-[26rem] flex-col overflow-hidden rounded-[var(--ui-radius-panel)] border border-[var(--border)] bg-[var(--surface-muted)] shadow-none xl:min-h-0">
                  <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-6">
                    <div className="grid gap-4">
                      <section className="rounded-[var(--ui-radius-card)] border border-white/76 bg-white/68 px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.035)]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={activeReaderPreview ? 'accent' : 'outline'}>
                            {activeReaderPreview ? 'AI 预演' : '演示预演'}
                          </Badge>
                          <span className="text-xs text-[var(--soft-foreground)]">
                            这是推演，不代表真实用户调研或效果预测
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                          {activeReaderPreview?.audienceSummary ??
                            `当前以“${effectiveReaderAudience}”为视角，根据文案结构生成演示反馈。`}
                        </p>
                        {readerPreviewError ? (
                          <p className="mt-2 text-xs leading-5 text-[#b94f38]">
                            {readerPreviewError}
                          </p>
                        ) : null}
                      </section>

                      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="accent">批注</Badge>
                          <span className="text-sm font-medium text-[var(--muted-foreground)]">
                            对应左侧编号
                          </span>
                        </div>
                        <span className="rounded-full bg-[rgba(236,239,243,0.86)] px-3 py-1 text-xs font-medium text-[var(--soft-foreground)]">
                          {readerPreviewFeedback.annotations.length} 条
                        </span>
                      </div>

                      <div className="grid gap-3">
                        {readerPreviewFeedback.annotations.map((annotation) =>
                          renderReaderAnnotationComment(annotation),
                        )}
                      </div>

                      {readerPreviewFeedback.blocks.map((block) =>
                        renderReaderFeedbackBlock(block),
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 border-t border-[var(--border)] bg-[rgba(236,239,243,0.62)] px-5 py-4 lg:px-6">
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                      <Button
                        variant="secondary"
                        disabled={activeReaderPreview?.suggestions.length === 0}
                        onClick={handleSendReaderSuggestionsToRewrite}
                      >
                        <PenLine className="h-4 w-4" />
                        {activeReaderPreview?.suggestions.length === 0
                          ? '暂无可带回建议'
                          : '将建议带回编辑'}
                      </Button>
                      <Button
                        onClick={() => void handleFinalizeReaderPreview('reader')}
                        disabled={!canFinalizeDraft}
                        tooltip={!canFinalizeDraft ? '先修正未通过的篇幅检查' : undefined}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {activeConversation.finalizedAt ? '再次复制文案' : '确认完成并复制文案'}
                      </Button>
                    </div>
                  </div>
                  </aside>
                ) : null}
              </div>
            ) : (
              renderWorkflowEmptyState('reader')
            )}
          </div>
        </section>
      </div>
    )
  }

  const navigationTitle =
    step === 'workspace'
      ? '项目工作台'
      : step === 'library'
        ? '文案库'
      : step === 'learn'
        ? '网页文案拆解'
          : step === 'length'
            ? '文案创作'
            : step === 'plan'
              ? '文案创作'
              : step === 'rewrite'
                ? '编辑细调'
                : '读者预演'

  const navigationSubtitle =
    step === 'workspace'
      ? '管理项目并进入对应的文案工作流。'
      : step === 'library'
        ? '查看和整理插件同步到云端的笔记与标注。'
      : step === 'learn'
        ? '在同一条 AI 对话里完成选文案、开始分析和追问。'
        : '当前项目会沿用前面的分析结果，继续往下生成。'

  const showShellHeader = !['workspace', 'library', 'learn', 'length', 'plan', 'rewrite', 'reader'].includes(step)

  const isInitialCloudWorkspaceHydration =
    (!cloudWorkspaceHydratedUserIdRef.current &&
      (cloudWorkspaceStatus === 'initializing' ||
        cloudWorkspaceStatus === 'loading' ||
        (cloudWorkspaceStatus === 'ready' && Boolean(cloudWorkspaceUserId)))) ||
    (cloudWorkspaceStatus !== 'guest' &&
      (cloudLibrary.status === 'initializing' || cloudLibrary.status === 'loading'))

  if (isInitialCloudWorkspaceHydration) {
    return (
      <main
        className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[var(--background)] px-[var(--ui-page-gutter)] text-[var(--foreground)]"
        aria-busy="true"
        aria-label="正在恢复工作区"
      >
        <div className="pointer-events-none absolute left-[-12rem] top-[-8rem] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(103,199,255,0.18),transparent_65%)] blur-2xl" />
        <div className="pointer-events-none absolute right-[-8rem] top-[-5rem] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(148,163,184,0.16),transparent_62%)] blur-2xl" />
        <div className="relative flex max-w-sm flex-col items-center text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-[-0.04em]">正在恢复工作区</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
            正在读取你的项目、对话和最新文案…
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute left-[-12rem] top-[-8rem] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(103,199,255,0.18),transparent_65%)] blur-2xl" />
      <div className="pointer-events-none absolute right-[-8rem] top-[-5rem] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(148,163,184,0.16),transparent_62%)] blur-2xl" />
      {cloudWorkspaceError &&
      cloudWorkspaceStatus !== 'guest' &&
      cloudWorkspaceErrorVersion !== dismissedCloudWorkspaceErrorVersion ? (
        <div
          role="alert"
          className="fixed right-5 top-5 z-[170] flex w-[min(calc(100vw-2.5rem),24rem)] items-start gap-3 rounded-[var(--ui-radius-panel)] border border-[rgba(214,90,60,0.18)] bg-white/95 py-3 pl-4 pr-2 text-sm text-[var(--foreground)] shadow-[0_18px_48px_rgba(48,34,22,0.14)] backdrop-blur-xl"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#b94f38]" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">云端项目暂时无法同步</p>
            <p className="mt-1 leading-5 text-[var(--muted-foreground)]">
              当前内容仍保留在页面中，连接恢复后会继续保存。
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 -ml-3 text-[#a3412f] hover:bg-[rgba(214,90,60,0.08)] hover:text-[#8f3728]"
              onClick={handleRetryCloudWorkspace}
            >
              立即重试
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭同步失败提示"
            className="-mt-1 shrink-0"
            onClick={() => setDismissedCloudWorkspaceErrorVersion(cloudWorkspaceErrorVersion)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      {finalCopyToast ? (
        <div
          role="status"
          aria-live="polite"
          className="copy-toast pointer-events-none fixed bottom-8 left-1/2 z-[160] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/80 bg-white/94 px-4 py-3 text-sm font-semibold text-[var(--foreground)] shadow-[0_22px_60px_rgba(48,34,22,0.16)] backdrop-blur-xl"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(42,157,143,0.12)] text-[#17675b]">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          {finalCopyToast}
        </div>
      ) : null}
      <DraftVersionHistory
        key={`${activeConversation.id}:${
          isDraftVersionHistoryOpen ? activeCurrentDraftVersionId || 'invalid' : 'closed'
        }`}
        currentVersionId={hasDraftReady ? activeCurrentDraftVersionId : ''}
        isOpen={isDraftVersionHistoryOpen}
        versions={activeDraftVersions}
        onClose={() => setIsDraftVersionHistoryOpen(false)}
        onRestore={handleRestoreDraftVersion}
      />
      <WritingProfileDialog
        open={isWritingProfileOpen}
        onOpenChange={setIsWritingProfileOpen}
        accountProfile={writingProfileContext.accountProfile}
        projectProfile={writingProfileContext.projectProfile}
        projectName={activeProject.name}
        canLearn={cloudWorkspaceStatus === 'ready'}
        isLoading={isWritingProfileLoading}
        isSaving={isWritingProfileSaving}
        error={writingProfileError}
        onClearError={() => setWritingProfileError('')}
        onRefresh={() => {
          void refreshWritingProfiles()
        }}
        onAddCorrection={handleAddWritingProfileCorrection}
        onManagePreference={handleManageWritingPreference}
      />
      {showShellHeader ? (
        <header className="sticky top-0 z-30 w-full border-b border-white/70 bg-[rgba(248,250,252,0.82)] backdrop-blur-2xl">
          <div className="flex w-full items-center justify-between gap-[var(--ui-gap-block)] px-[var(--ui-page-gutter)] py-[var(--ui-space-4)]">
            <div className="flex min-w-0 items-center gap-4">
              <Badge variant="outline" className="hidden shrink-0 tracking-[0.2em] sm:inline-flex">
                XHS AI
              </Badge>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                  {navigationTitle}
                </p>
                <p className="truncate text-sm text-[var(--muted-foreground)]">
                  {navigationSubtitle}
                </p>
              </div>
            </div>

            <ShellStepPills step={step} />

            <div className="hidden items-center gap-3 md:flex">
              <div className="rounded-full border border-white/80 bg-white/72 px-4 py-2 text-sm text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.04)]">
                {activeProject.name}
              </div>
              <div className="rounded-full border border-[var(--border)] bg-[rgba(241,243,246,0.92)] px-4 py-2 text-sm font-medium text-[var(--foreground)]">
                {libraryFolders.find((folder) => folder.id === activeProject.folderId)?.name ?? '未选择文件夹'}
              </div>
            </div>
          </div>
        </header>
      ) : null}

      <div
        className={
          showShellHeader
            ? 'mx-auto flex min-h-[calc(100vh-81px)] w-full max-w-7xl flex-col px-[var(--ui-page-gutter)] py-[var(--ui-space-6)]'
            : 'flex min-h-screen w-full flex-col px-0 py-0'
        }
      >
        {showShellHeader && step !== 'workspace' && step !== 'learn' && step !== 'length' ? (
          <header className="mb-6 overflow-hidden rounded-[var(--ui-radius-panel)] border border-white/72 bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(255,255,255,0.9))] shadow-[0_28px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="relative px-6 py-8 md:px-10">
              <div className="absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_top_left,rgba(103,199,255,0.18),transparent_40%),radial-gradient(circle_at_top_right,rgba(148,163,184,0.16),transparent_44%),radial-gradient(circle_at_60%_10%,rgba(239,182,208,0.22),transparent_38%)]" />
              <div className="relative max-w-4xl space-y-4">
                <span className="inline-flex rounded-full border border-black/10 bg-white/80 px-4 py-2 text-xs font-semibold tracking-[0.24em] text-[var(--foreground)] uppercase">
                  Lumos AI Writer
                </span>
                <h1 className="font-display text-4xl leading-none tracking-[-0.06em] text-[var(--foreground)] md:text-6xl">
                  {step === 'plan' ? (
                    <>
                      先确认结构化方案，
                      <br />
                      再进入细改。
                    </>
                  ) : (
                    <>
                      一边看方案，
                      <br />
                      一边逐段改稿。
                    </>
                  )}
                </h1>
                <p className="max-w-3xl text-base leading-7 text-[var(--muted-foreground)] md:text-lg">
                  项目里的聊天记录、学习偏好和分析过程都只保留在当前项目里。这样用户反复处理同一类文案时，AI 才更容易理解这类内容的写作习惯。
                </p>
              </div>
            </div>
          </header>
        ) : null}

        {step === 'workspace'
          ? renderWorkspace()
          : step === 'library'
            ? renderLibrary()
          : step === 'learn'
            ? visibleConversationStage === 'intake'
              ? renderIntake()
              : renderLearn()
            : step === 'length'
              ? renderPlan()
              : step === 'plan'
                ? renderPlan()
                : step === 'rewrite'
                  ? renderRewrite()
                  : isReaderPreviewVisible
                    ? renderReaderPreview()
                    : renderRewrite()}
      </div>
    </div>
  )
}

export default App
