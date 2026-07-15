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
  AiUsage,
  CreateFeedbackMemoryRequest,
  ProjectLength,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  SyncWorkspaceRequest,
  WorkspaceProjectDto,
} from '@lumos-ai/shared'
import { normalizeNoteUrl } from '@lumos-ai/shared'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  FolderOpen,
  GripVertical,
  Highlighter,
  Image,
  Layers3,
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
import { LibraryManager } from '@/components/library-manager'
import { AuthStatus } from '@/components/auth-status'
import {
  WorkflowTitleMenu,
  type WorkflowStepId,
  type WorkflowTitleMenuStep,
} from '@/components/workflow-title-menu'
import { useCloudLibrary } from '@/hooks/use-cloud-library'
import { useCloudWorkspace } from '@/hooks/use-cloud-workspace'
import {
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
  restoreFolder,
  restoreNote,
  updateFolder,
  updateSnippet,
  upsertNote,
} from '@/lib/api-client'
import { getCurrentAccessToken } from '@/lib/supabase-browser'
import { demoFolders, demoNotes, demoSnippets } from './lib/demo-data'
import { buildDemoAnalysis } from './lib/analysis'

type ConversationStep = 'learn' | 'length' | 'plan' | 'rewrite' | 'reader'
type PageStep = 'workspace' | 'library' | ConversationStep

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

type RewriteChatMessage = {
  id: string
  role: 'assistant' | 'user'
  selectedText?: string
  lines: string[]
}

type PlanAttachment = {
  id: string
  name: string
  kind: 'image' | 'document'
}

type ConversationRecord = {
  id: string
  title: string
  pinned?: boolean
  finalizedAt?: string
  finalDraft?: InitialDraftCopy
  step: ConversationStep
  createdAt: string
  lastOpenedAt: string
  selectedItemIds: string[]
  chatMessages: ChatMessage[]
  analysisReady: boolean
  length: ProjectLength | null
  topic: string
  targetAudience: string
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

const lengthPreviewCards: Array<{
  value: ProjectLength
  title: string
  lines: string[]
}> = [
  {
    value: 'short',
    title: '短篇幅｜快速判断，约0-200字',
    lines: [
      '📒适配快速种草场景',
      '上班族轻松吃上健康晚餐！\n十分钟上桌，百吃不厌！',
      '🍅番茄炒鸡蛋做法：\n1️⃣鸡蛋大火滑熟先盛出\n2️⃣番茄炒出红汁+少许糖盐\n3️⃣倒回鸡蛋翻匀就好',
      '🥚我拥护番茄炒蛋为快手菜的神！\n鸡蛋香嫩，番茄汁浓，拌米饭真的很香～\n快来复刻家里的味道！',
    ],
  },
  {
    value: 'medium',
    title: '中篇幅｜完整说明，约201-600字',
    lines: [
      '📒适配完整说明场景',
      '想吃一道稳定下饭、不会出错的家常菜，\n番茄炒鸡蛋真的可以闭眼做🍅\n酸甜开胃，鸡蛋嫩滑，十几分钟就能端上桌',
      '🥣食材准备：\n番茄2个｜鸡蛋3个｜葱花\n盐｜少许糖｜一点清水',
      '🍅番茄炒鸡蛋做法：\n1️⃣鸡蛋加一点清水打散，热锅多油，大火滑熟后先盛出\n2️⃣番茄切块下锅，中火炒到变软出红汁\n3️⃣加盐和少许糖调味，喜欢汤汁多可以加一小勺热水\n4️⃣倒回鸡蛋轻轻翻匀，让蛋块裹满番茄汁\n5️⃣出锅前撒葱花，香味会更明显',
      '✅关键小技巧：\n鸡蛋刚定型就盛出，口感会更嫩\n番茄一定要炒出汁，拌饭才够香\n糖不用多，只是用来平衡番茄的酸味',
      '这盘就是家里最安心的味道\n不知道吃什么的时候，照着做一盘准没错🍚',
    ],
  },
  {
    value: 'long',
    title: '长篇幅｜深度展开，约601-1000字',
    lines: [
      '📒适配深度展开场景',
      '番茄炒鸡蛋看起来简单，\n但想做出“鸡蛋嫩、番茄汁浓、拌饭香”的效果，\n火候、番茄状态和调味顺序都很关键🍅🥚',
      '这篇适合收藏起来反复做，尤其是刚开始学做家常菜的人。照着步骤来，基本不容易翻车',
      '🥣食材准备：\n番茄2个｜鸡蛋3个｜葱花\n盐｜少许糖｜一点清水｜食用油',
      '🍅食材处理：\n番茄可以一半切小块，一半切大块。小块更容易炒出红汁，大块吃起来还有番茄口感\n鸡蛋里加一点盐和一小勺清水，搅打到蛋液均匀，炒出来会更嫩',
      '🍳详细做法：\n1️⃣热锅多放一点油，倒入鸡蛋液后用大火快速滑熟，看到蛋液刚刚凝固就盛出\n2️⃣锅里留一点底油，放葱花炒香，再倒入切好的番茄。先用中火慢慢炒，边炒边用锅铲压一压，让番茄出汁\n3️⃣番茄炒到变软、有红汁以后，加入盐和少许糖。糖不是为了做成甜口，而是用来平衡番茄的酸味\n4️⃣如果喜欢汤汁多一点，可以加一小勺热水；想要更浓郁的拌饭口感，就继续把汤汁稍微收一收\n5️⃣最后把鸡蛋倒回锅里，轻轻翻匀，让每一块鸡蛋都裹上番茄汁。鸡蛋回锅以后别翻太久，裹上汁就可以关火',
      '✅不翻车小技巧：\n鸡蛋要大火快炒，刚凝固就盛出\n番茄要炒出汁再调味，不然味道会浮在表面\n鸡蛋回锅以后别翻太久，裹上汁就可以关火',
      '🍚这样做出来的番茄炒鸡蛋，是酸甜浓汁包着嫩鸡蛋，配米饭真的很舒服。家常、简单、不挑人，想不到吃什么的时候，做它永远不会错～',
    ],
  },
]

const workflowSteps: WorkflowTitleMenuStep[] = [
  { id: 'selection', title: '选择文案', caption: '挑选本轮参考内容', icon: MousePointer2 },
  { id: 'learn', title: '学习拆解', caption: '选文案并生成偏好分析', icon: Sparkles },
  { id: 'length', title: '篇幅设置', caption: '确定内容长度与节奏', icon: FileText },
  { id: 'plan', title: '文案创作', caption: '核验信息并生成初版', icon: Layers3 },
  { id: 'rewrite', title: '编辑细调', caption: '逐句打磨与局部改写', icon: PenLine },
  { id: 'reader', title: '读者预演', caption: '模拟阅读反馈与划走风险', icon: Eye },
]

const shellSteps: Array<{ id: PageStep; title: string }> = [
  { id: 'workspace', title: '项目' },
  { id: 'learn', title: '学习拆解' },
  { id: 'length', title: '篇幅设置' },
  { id: 'plan', title: '文案创作' },
  { id: 'rewrite', title: '编辑细调' },
  { id: 'reader', title: '读者预演' },
]

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
        selectedItemIds: [],
        chatMessages: [],
        analysisReady: false,
        length: null,
        topic: '我想写一篇关于深圳市区骑行路线的种草笔记',
        targetAudience: '想找周末路线、又怕路线太难的新手骑行用户',
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
        selectedItemIds: [],
        chatMessages: [],
        analysisReady: false,
        length: null,
        topic: '我想写一篇数码产品选购和开箱结合的种草内容',
        targetAudience: '会刷小红书找真实体验、不喜欢太广告腔的用户',
        createdAt: '2026-04-30T19:10:00.000Z',
        lastOpenedAt: '2026-04-30T19:10:00.000Z',
        updatedAt: '2026-04-30T19:10:00.000Z',
      },
    ],
  },
]

const defaultConversationTitle = '新的文案对话'

type InitialDraftCopy = {
  title: string
  body: string[]
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

type HydratedCloudWorkspace = {
  projects: ProjectRecord[]
  analysisByConversation: Record<string, AiAnalysisResult>
  draftCopyByConversation: Record<string, InitialDraftCopy>
  draftReadyByConversation: Record<string, boolean>
  rewriteMessagesByConversation: Record<string, RewriteChatMessage[]>
  planAttachmentsByConversation: Record<string, PlanAttachment[]>
  readerAudienceByConversation: Record<string, string>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isInitialDraftCopy(value: unknown): value is InitialDraftCopy {
  return (
    isObject(value) &&
    typeof value.title === 'string' &&
    Array.isArray(value.body) &&
    value.body.every((item) => typeof item === 'string')
  )
}

function hydrateCloudWorkspace(cloudProjects: WorkspaceProjectDto[]): HydratedCloudWorkspace {
  const analysisByConversation: Record<string, AiAnalysisResult> = {}
  const draftCopyByConversation: Record<string, InitialDraftCopy> = {}
  const draftReadyByConversation: Record<string, boolean> = {}
  const rewriteMessagesByConversation: Record<string, RewriteChatMessage[]> = {}
  const planAttachmentsByConversation: Record<string, PlanAttachment[]> = {}
  const readerAudienceByConversation: Record<string, string> = {}

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

      const draft = conversation.draft
        ? { title: conversation.draft.title, body: conversation.draft.body }
        : null
      if (draft) {
        draftCopyByConversation[conversation.id] = draft
        draftReadyByConversation[conversation.id] = true
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

      const finalDraft = isInitialDraftCopy(state.finalDraft) ? state.finalDraft : undefined

      return {
        id: conversation.id,
        title: conversation.title,
        pinned: conversation.pinned,
        finalizedAt: conversation.finalizedAt ?? undefined,
        finalDraft,
        step: conversation.step,
        createdAt: conversation.createdAt,
        lastOpenedAt: conversation.lastOpenedAt,
        selectedItemIds: conversation.selectedReferenceIds,
        chatMessages,
        analysisReady: conversation.analysisReady,
        length: conversation.length,
        topic: conversation.topic,
        targetAudience: conversation.targetAudience,
        updatedAt: conversation.updatedAt,
      }
    })

    return {
      id: project.id,
      name: project.name,
      folderId: project.folderId ?? '',
      conversations,
      activeConversationId: project.activeConversationId ?? conversations[0]?.id ?? '',
      updatedAt: project.updatedAt,
    }
  })

  return {
    projects,
    analysisByConversation,
    draftCopyByConversation,
    draftReadyByConversation,
    rewriteMessagesByConversation,
    planAttachmentsByConversation,
    readerAudienceByConversation,
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
  rewriteMessagesByConversation: Record<string, RewriteChatMessage[]>
  planAttachmentsByConversation: Record<string, PlanAttachment[]>
  readerAudienceByConversation: Record<string, string>
}): SyncWorkspaceRequest {
  return {
    projects: input.projects.map((project) => ({
      id: project.id,
      name: project.name,
      folderId: project.folderId || null,
      activeConversationId: project.activeConversationId || null,
      updatedAt: project.updatedAt,
      conversations: project.conversations.map((conversation) => ({
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
          ...(input.analysisByConversation[conversation.id]
            ? { analysis: input.analysisByConversation[conversation.id] }
            : {}),
          rewriteMessages: input.rewriteMessagesByConversation[conversation.id] ?? [],
          planAttachments: input.planAttachmentsByConversation[conversation.id] ?? [],
          readerAudience: input.readerAudienceByConversation[conversation.id] ?? '',
          ...(conversation.finalDraft ? { finalDraft: conversation.finalDraft } : {}),
        },
        messages: conversation.chatMessages.map((message, index) => {
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
          input.draftReadyByConversation[conversation.id] &&
          input.draftCopyByConversation[conversation.id]
            ? {
                ...input.draftCopyByConversation[conversation.id],
                source: 'working_draft',
              }
            : null,
      })),
    })),
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

  return {
    stage: 'followup' as const,
    title: '继续分析',
    lines: [`已记录这个方向。${context.preference[0]} ${context.preference[1]}`],
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

function buildInitialDraftCopy(input: {
  topic: string
  targetAudience: string
  length: ProjectLength
}): InitialDraftCopy {
  const isLong = input.length === 'long'

  if (input.topic.includes('骑行')) {
    return {
      title: '深圳新手骑行路线，第一次出发也不慌',
      body: [
        '周末想骑车放松一下，又怕路线太难、补给不方便，可以先从市区友好路线开始🚴‍♀️',
        '我更推荐新手先选路面平、休息点多、能随时折返的路线。不要一上来就追求长距离，先把节奏骑舒服，比打卡更重要',
        '📍路线可以安排成：公园绿道出发，沿着河边或海边慢慢骑，中途找便利店/咖啡店补水，最后在视野开阔的位置停下来休息',
        '新手最容易忽略的是返程体力。出发前看好距离和坡度，骑到一半还有余力的时候就可以回头，不要硬撑到累崩',
        isLong
          ? '如果是第一次骑，建议把总时长控制在 1-2 小时内，带好水、手套和充好电的手机。路线不用排太满，留一点时间看风景、拍照、休息，体验会轻松很多'
          : '这类路线最适合想轻松出门的人，风景够看，强度不吓人，也更容易坚持下去',
        '你们周末会更想骑城市绿道，还是海边路线？',
      ],
    }
  }

  if (input.topic.includes('数码')) {
    return {
      title: '这类数码产品，开箱前我会先看这几点',
      body: [
        '想买数码产品但又怕踩坑，真的不要只看参数表。真实体验里的细节，往往比一句“性能很强”更有参考价值📱',
        '我会先看三个地方：上手质感、日常使用频率、以及它到底有没有解决真实问题。如果只是包装好看、功能听起来很满，但拿到手以后不常用，就很容易闲置',
        '开箱时可以重点记录外观、重量、操作顺不顺、和旧设备相比有没有明显提升。这些细节写出来，会比单纯夸“好用”更让人相信',
        isLong
          ? '如果预算有限，也可以把缺点写清楚。比如适合谁、不适合谁、哪些场景体验最好。真实的边界感反而会让推荐更有可信度'
          : '最后再给一句明确判断：适合谁买，谁可以再等等。这样读者看完会更容易做决定',
      ],
    }
  }

  return {
    title: input.topic.replace(/^我想写一篇/, '').replace(/的?小红书文案$/, '') || '先生成一版可继续细调的初版方案',
    body: [
      `这篇先面向${input.targetAudience}，把最核心的使用场景、真实感受和推荐理由讲清楚`,
      '开头不要急着下结论，先把读者带进一个具体场景，让 TA 觉得“这就是我会遇到的问题”',
      '正文里保留真实细节，少用空泛形容。可以写选择理由、使用过程、对比感受，或者一个让人记住的小瞬间',
      '最后用一句自然的个人判断收住，再留一个轻互动，让读者愿意评论或收藏',
    ],
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
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(true)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectRecord[]>(initialProjects)
  const [activeProjectId, setActiveProjectId] = useState(initialProjects[0].id)
  const [chatInput, setChatInput] = useState('')
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
  const [newProjectName, setNewProjectName] = useState('深圳周末路线项目')
  const [newProjectFolderId, setNewProjectFolderId] = useState(demoFolders[0].id)
  const [showCreateProjectCard, setShowCreateProjectCard] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [renamingProjectId, setRenamingProjectId] = useState('')
  const [renamingProjectName, setRenamingProjectName] = useState('')
  const [projectPendingDeleteId, setProjectPendingDeleteId] = useState('')
  const [selectedRewriteText, setSelectedRewriteText] = useState('')
  const [selectedRewriteFieldId, setSelectedRewriteFieldId] = useState('')
  const [rewriteSelectionCandidate, setRewriteSelectionCandidate] =
    useState<RewriteSelectionCandidate | null>(null)
  const [rewriteChatInput, setRewriteChatInput] = useState('')
  const [rewriteMessagesByConversation, setRewriteMessagesByConversation] = useState<
    Record<string, RewriteChatMessage[]>
  >({})
  const [planAttachmentsByConversation, setPlanAttachmentsByConversation] = useState<
    Record<string, PlanAttachment[]>
  >({})
  const [readerAudienceByConversation, setReaderAudienceByConversation] = useState<
    Record<string, string>
  >({})
  const [isReaderAudienceOpen, setIsReaderAudienceOpen] = useState(false)
  const [activeReaderAnnotationId, setActiveReaderAnnotationId] = useState('')
  const [finalCopyToast, setFinalCopyToast] = useState('')
  const [draftReadyByConversation, setDraftReadyByConversation] = useState<Record<string, boolean>>({})
  const [draftCopyByConversation, setDraftCopyByConversation] = useState<Record<string, InitialDraftCopy>>({})
  const [, setDraftUsageByConversation] = useState<
    Record<string, AiUsage | null>
  >({})
  const [draftGeneratingConversationId, setDraftGeneratingConversationId] = useState('')
  const [draftGenerationErrorByConversation, setDraftGenerationErrorByConversation] = useState<
    Record<string, string>
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
    save: saveCloudWorkspace,
    remember: rememberCloudFeedback,
  } = useCloudWorkspace()
  const [analysisByConversation, setAnalysisByConversation] = useState<
    Record<string, AiAnalysisResult>
  >({})
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
  const rewriteInputRef = useRef<HTMLTextAreaElement | null>(null)
  const draftMovePromptToolbarRef = useRef<HTMLDivElement | null>(null)
  const draftSelectionCaptureTimerRef = useRef<number | null>(null)
  const draftSelectionContainerRef = useRef<HTMLElement | null>(null)
  const draftSelectionPointerStartRef = useRef<DraftSelectionPointerStart | null>(null)
  const draftDropLandingTimerRef = useRef<number | null>(null)
  const draftBridgeGenerationTimerRef = useRef<number | null>(null)
  const workspaceSyncTimerRef = useRef<number | null>(null)
  const workspaceSyncBaselineRef = useRef('')
  const cloudWorkspaceHydratedUserIdRef = useRef('')
  const skipNextWorkspaceAutosaveRef = useRef(false)
  const workspaceSaveQueueRef = useRef(Promise.resolve())

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? initialProjects[0],
    [activeProjectId, projects],
  )
  const isUsingCloudLibrary = cloudLibrary.status !== 'guest'
  const libraryFolders = isUsingCloudLibrary ? cloudLibrary.folders : demoFolders
  const libraryNotes = isUsingCloudLibrary ? cloudLibrary.notes : demoNotes
  const librarySnippets = isUsingCloudLibrary ? cloudLibrary.snippets : demoSnippets
  const libraryTrashGroups = isUsingCloudLibrary ? cloudLibrary.trashGroups : []
  const libraryStatus = cloudLibrary.status === 'guest' ? 'demo' : cloudLibrary.status
  const libraryError = isUsingCloudLibrary ? cloudLibrary.error : ''
  const effectiveNewProjectFolderId = libraryFolders.some(
    (folder) => folder.id === newProjectFolderId,
  )
    ? newProjectFolderId
    : libraryFolders[0]?.id ?? ''

  const activeConversation = useMemo(
    () =>
      activeProject.conversations.find(
        (conversation) => conversation.id === activeProject.activeConversationId,
      ) ?? activeProject.conversations[0],
    [activeProject],
  )

  const workspaceSyncPayload = useMemo(
    () =>
      buildWorkspaceSyncPayload({
        projects,
        analysisByConversation,
        draftCopyByConversation,
        draftReadyByConversation,
        rewriteMessagesByConversation,
        planAttachmentsByConversation,
        readerAudienceByConversation,
      }),
    [
      analysisByConversation,
      draftCopyByConversation,
      draftReadyByConversation,
      planAttachmentsByConversation,
      projects,
      readerAudienceByConversation,
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
      : getConversationStep(activeConversation)
  const activeWorkflowStep: WorkflowStepId =
    step === 'workspace' || step === 'library'
      ? 'selection'
      : step === 'learn' && !activeConversation.analysisReady
        ? 'selection'
        : step
  const isDraftPointerDragging = Boolean(draftPointerDrag)

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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [step])

  useEffect(() => {
    if (cloudWorkspaceStatus === 'guest') {
      if (!cloudWorkspaceHydratedUserIdRef.current) return

      cloudWorkspaceHydratedUserIdRef.current = ''
      workspaceSyncBaselineRef.current = ''
      setProjects(initialProjects)
      setActiveProjectId(initialProjects[0].id)
      setAnalysisByConversation({})
      setDraftCopyByConversation({})
      setDraftReadyByConversation({})
      setRewriteMessagesByConversation({})
      setPlanAttachmentsByConversation({})
      setReaderAudienceByConversation({})
      setIsWorkspaceOpen(true)
      setIsLibraryOpen(false)
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

    cloudWorkspaceHydratedUserIdRef.current = cloudWorkspaceUserId
    skipNextWorkspaceAutosaveRef.current = true
    workspaceSyncBaselineRef.current = JSON.stringify(baselinePayload)
    setProjects(hydrated.projects)
    setActiveProjectId(hydrated.projects[0]?.id ?? '')
    setAnalysisByConversation(hydrated.analysisByConversation)
    setDraftCopyByConversation(hydrated.draftCopyByConversation)
    setDraftReadyByConversation(hydrated.draftReadyByConversation)
    setRewriteMessagesByConversation(hydrated.rewriteMessagesByConversation)
    setPlanAttachmentsByConversation(hydrated.planAttachmentsByConversation)
    setReaderAudienceByConversation(hydrated.readerAudienceByConversation)
    setIsWorkspaceOpen(true)
    setIsLibraryOpen(false)
  }, [cloudWorkspaceProjects, cloudWorkspaceStatus, cloudWorkspaceUserId])

  useEffect(() => {
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
    workspaceSyncTimerRef.current = window.setTimeout(() => {
      workspaceSaveQueueRef.current = workspaceSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await saveCloudWorkspace(payload)
          workspaceSyncBaselineRef.current = serializedPayload
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

  const selectedItemIds = activeConversation.selectedItemIds
  const hasSelectedReferences = selectedItemIds.length > 0
  const hasLearningResult = hasSelectedReferences && activeConversation.analysisReady
  const hasLengthSelected = Boolean(activeConversation.length)
  const hasPlanReady = hasLearningResult && hasLengthSelected
  const hasDraftReady = hasPlanReady && Boolean(draftReadyByConversation[activeConversation.id])
  const isAnalyzing = analysisPendingConversationId === activeConversation.id
  const isDraftGenerating = draftGeneratingConversationId === activeConversation.id
  const analysisWaitSeconds =
    isAnalyzing && analysisWaitStartedAt
      ? Math.max(0, Math.floor((aiWaitTick - analysisWaitStartedAt) / 1000))
      : 0
  const analysisError = analysisErrorByConversation[activeConversation.id] ?? ''
  const draftGenerationError = draftGenerationErrorByConversation[activeConversation.id] ?? ''
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
    () => librarySnippets.filter((snippet) => selectedSnippetIds.has(snippet.id)),
    [librarySnippets, selectedSnippetIds],
  )

  const selectedNotes = useMemo(() => {
    const snippetNoteUrls = new Set(selectedSnippets.map((snippet) => snippet.noteUrl))
    return libraryNotes.filter(
      (note) => selectedNoteIds.has(note.id) || snippetNoteUrls.has(note.sourceUrl),
    )
  }, [libraryNotes, selectedNoteIds, selectedSnippets])

  const selectedFolderName = useMemo(() => {
    const folderNames = Array.from(new Set(selectedNotes.map((note) => note.folderName).filter(Boolean)))

    if (folderNames.length === 0) return '未选择文案'
    if (folderNames.length === 1) return folderNames[0]

    return `${folderNames.length} 个文件夹`
  }, [selectedNotes])

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
      }),
    [
      effectiveLength,
      activeConversation.targetAudience,
      activeConversation.topic,
    ],
  )
  const initialDraftCopy =
    draftCopyByConversation[activeConversation.id] ?? generatedInitialDraftCopy

  const creationBrief = useMemo(() => {
    if (activeConversation.topic.includes('骑行')) {
      return {
        mustInclude: '路线距离、难度、沿途补给、最适合停留的一段',
        avoidTone: '避免攻略站口吻，体验表达不夸满',
      }
    }

    if (activeConversation.topic.includes('数码')) {
      return {
        mustInclude: '真实使用场景、开箱体验、上手质感、购买判断',
        avoidTone: '避免参数堆砌、过度承诺和广告腔',
      }
    }

    return {
      mustInclude: '核心卖点、使用场景、真实细节、推荐理由',
      avoidTone: '避免空泛夸张、硬广表达和过度承诺',
    }
  }, [activeConversation.topic])

  const rewriteMessages = rewriteMessagesByConversation[activeConversation.id] ?? []
  const planAttachments = planAttachmentsByConversation[activeConversation.id] ?? []
  const readerAudienceDraft = readerAudienceByConversation[activeConversation.id] ?? ''
  const readerPreviewFeedback = useMemo(
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
  const draftBridgeMessages = draftBridgeMessagesByConversation[activeConversation.id] ?? []
  const draftMoveHistory = draftMoveHistoryByConversation[activeConversation.id] ?? {
    redo: [],
    undo: [],
  }
  const canUndoDraftMove = draftMoveHistory.undo.length > 0
  const canRedoDraftMove = draftMoveHistory.redo.length > 0

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()
    return projects.filter((project) => {
      const folder = libraryFolders.find((item) => item.id === project.folderId)
      const content = [project.name, folder?.name || ''].join(' ').toLowerCase()
      return !query || content.includes(query)
    })
  }, [libraryFolders, projectSearch, projects])

  const projectPendingDelete = useMemo(
    () => projects.find((project) => project.id === projectPendingDeleteId),
    [projectPendingDeleteId, projects],
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

  function updateConversationStep(projectId: string, conversationId: string, nextStep: ConversationStep) {
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              conversations: project.conversations.map((conversation) =>
                conversation.id === conversationId && getConversationStep(conversation) !== nextStep
                  ? {
                      ...conversation,
                      step: nextStep,
                    }
                  : conversation,
              ),
            }
          : project,
      ),
    )
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

    setChatInput('')
    setSelectedRewriteText('')
    setSelectedRewriteFieldId('')
    setRewriteSelectionCandidate(null)
    setRewriteChatInput('')
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
  }

  function goToStep(nextStep: PageStep) {
    if (nextStep !== 'reader') {
      setIsReaderAudienceOpen(false)
      setActiveReaderAnnotationId('')
    }

    if (nextStep === 'workspace') {
      setIsWorkspaceOpen(true)
      setIsLibraryOpen(false)
      return
    }

    if (nextStep === 'library') {
      setIsWorkspaceOpen(false)
      setIsLibraryOpen(true)
      return
    }

    setIsWorkspaceOpen(false)
    setIsLibraryOpen(false)
    updateConversationStep(activeProject.id, activeConversation.id, nextStep)
  }

  function handleWorkflowStepChange(nextStep: WorkflowStepId) {
    if (nextStep === 'selection') {
      setIsWorkspaceOpen(false)
      setIsLibraryOpen(false)
      handleBackToSelection()
      updateConversationStep(activeProject.id, activeConversation.id, 'learn')
      return
    }

    goToStep(nextStep)
  }

  function buildConversationTitleFromPrompt(prompt: string) {
    const normalized = prompt.replace(/\s+/g, ' ').trim()
    return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized
  }

  function isDefaultConversationTitle(title: string) {
    return !title.trim() || title === defaultConversationTitle || title === '新的小红书文案对话'
  }

  function handleOpenProject(projectId: string) {
    const now = new Date().toISOString()
    setIsChatStreaming(false)
    resetConversationTransientState()
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              updatedAt: now,
              conversations: sortConversationsForSidebar(
                project.conversations.map((conversation) =>
                  conversation.id === project.activeConversationId
                    ? { ...conversation, lastOpenedAt: now, updatedAt: now }
                    : conversation,
                ),
              ),
            }
          : project,
      ),
    )
    setActiveProjectId(projectId)
    setIsWorkspaceOpen(false)
    setIsLibraryOpen(false)
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
    if (!name) return

    const now = new Date().toISOString()
    const conversationId = crypto.randomUUID()
    const nextProject: ProjectRecord = {
      id: crypto.randomUUID(),
      name,
      folderId: effectiveNewProjectFolderId,
      activeConversationId: conversationId,
      updatedAt: now,
      conversations: [
        {
          id: conversationId,
          title: defaultConversationTitle,
          step: 'learn',
          selectedItemIds: [],
          chatMessages: [],
          analysisReady: false,
          length: null,
          topic: `我想围绕「${name}」写一篇新的小红书文案`,
          targetAudience: '还没细分，后面会继续补充',
          createdAt: now,
          lastOpenedAt: now,
          updatedAt: now,
        },
      ],
    }

    setProjects((current) => [nextProject, ...current])
    setActiveProjectId(nextProject.id)
    setIsChatStreaming(false)
    resetConversationTransientState()
    setShowCreateProjectCard(false)
    setIsWorkspaceOpen(false)
    setIsLibraryOpen(false)
  }

  function handleCreateConversation() {
    const now = new Date().toISOString()
    const conversationId = crypto.randomUUID()
    const nextConversation: ConversationRecord = {
      id: conversationId,
      title: defaultConversationTitle,
      step: 'learn',
      selectedItemIds: [],
      chatMessages: [],
      analysisReady: false,
      length: null,
      topic: `我想继续围绕「${activeProject.name}」写一篇新的小红书文案`,
      targetAudience: '还没细分，后面会继续补充',
      createdAt: now,
      lastOpenedAt: now,
      updatedAt: now,
    }

    setIsChatStreaming(false)
    resetConversationTransientState()
    setIsWorkspaceOpen(false)
    setIsLibraryOpen(false)
    updateProject(activeProject.id, (project) => ({
      ...project,
      activeConversationId: conversationId,
      updatedAt: now,
      conversations: sortConversationsForSidebar([nextConversation, ...project.conversations]),
    }))
  }

  function handleSwitchConversation(conversationId: string) {
    if (conversationId === activeProject.activeConversationId) return

    const now = new Date().toISOString()
    setIsChatStreaming(false)
    resetConversationTransientState()
    setIsWorkspaceOpen(false)
    setIsLibraryOpen(false)
    updateProject(activeProject.id, (project) => ({
      ...project,
      activeConversationId: conversationId,
      updatedAt: now,
      conversations: sortConversationsForSidebar(
        project.conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, lastOpenedAt: now, updatedAt: now }
            : conversation,
        ),
      ),
    }))
  }

  function rememberExplicitFeedback(input: CreateFeedbackMemoryRequest) {
    if (cloudWorkspaceStatus !== 'ready') return

    const payload = workspaceSyncPayload
    const serializedPayload = workspaceSyncSerialized
    workspaceSaveQueueRef.current = workspaceSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveCloudWorkspace(payload)
        workspaceSyncBaselineRef.current = serializedPayload
        await rememberCloudFeedback(input)
      })
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
    await updateFolder(accessToken, folder.id, { name })
    cloudLibrary.refresh()
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

    await upsertNote(accessToken, {
      authorName: draft.authorName,
      contentText: draft.contentText,
      coverImageUrl: note.coverImageUrl ?? '',
      filename: draft.filename || draft.title || note.filename,
      folderId,
      savedAt: note.savedAt,
      sourceUrl: note.sourceUrl,
      title: draft.title || draft.filename || note.title,
    })
    cloudLibrary.refresh()
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
      }
    })
  }

  function handleSelectItems(itemIds: string[]) {
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
      }
    })
  }

  function handleDeselectItems(itemIds: string[]) {
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
      }
    })
  }

  async function handleStartAnalysis() {
    if (isChatStreaming || selectedItemIds.length === 0) return

    const projectId = activeProject.id
    const conversationId = activeConversation.id

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
    setDraftCopyByConversation((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
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
      let nextAnalysis = fallbackAnalysis

      if (isUsingCloudLibrary && cloudLibrary.status === 'ready') {
        const accessToken = await getCurrentAccessToken()
        if (!accessToken) {
          throw new Error('登录状态已过期，请重新登录后再开始分析。')
        }

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

        void buildWritingProfile(accessToken, {
          scope: 'account',
          libraryEvidence: {
            notes: libraryNotes.slice(0, 60).map((note) => ({
              id: note.id,
              title: note.title,
              contentText: note.contentText,
            })),
            snippets: librarySnippets.slice(0, 240).map((snippet) => ({
              id: snippet.id,
              selectedText: snippet.selectedText,
              reasonText: snippet.reasonText,
              colorTagName: snippet.colorTagName,
            })),
          },
          feedbackEvidence: cloudFeedbackMemories.slice(0, 400).map((memory) => ({
            id: memory.id,
            projectId: memory.projectId,
            type: memory.type,
            content: memory.content,
            context: memory.context,
            source: memory.source,
            createdAt: memory.createdAt,
          })),
        }).catch((profileError) => {
          console.warn('Writing profile update was skipped.', profileError)
        })
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

      for (const message of analysisMessages) {
        await sleep(320)
        updateConversation(projectId, conversationId, (conversation) => ({
          ...conversation,
          chatMessages: [...conversation.chatMessages, message],
        }))
      }
    } catch (error) {
      const message = getErrorMessage(error)
      const friendlyMessage = message.includes('DeepSeek API key')
        ? 'AI 服务暂时不可用，请稍后重试。'
        : message
      setAnalysisErrorByConversation((current) => ({
        ...current,
        [conversationId]: friendlyMessage,
      }))
      updateConversation(projectId, conversationId, (conversation) => ({
        ...conversation,
        analysisReady: false,
        chatMessages: [
          ...conversation.chatMessages,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            stage: 'setup',
            title: 'AI 暂时不可用',
            lines: [friendlyMessage],
          },
        ],
      }))
    } finally {
      setIsChatStreaming(false)
      setAnalysisPendingConversationId((current) => (current === conversationId ? '' : current))
      setAnalysisWaitStartedAt(null)
    }
  }

  async function handleGenerateDraft() {
    if (!hasPlanReady || draftGeneratingConversationId) return

    const projectId = activeProject.id
    const conversationId = activeConversation.id

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
      if (selectedNotes.length === 0) {
        throw new Error('至少需要选择一篇参考文案，才能生成初版。')
      }

      let nextDraft = generatedInitialDraftCopy

      if (isUsingCloudLibrary) {
        if (cloudLibrary.status !== 'ready') {
          throw new Error('云端资料库还在连接中，稍等一下再生成。')
        }

        const accessToken = await getCurrentAccessToken()
        if (!accessToken) {
          throw new Error('登录状态已过期，请重新登录后再生成初版。')
        }

        const response = await generateDraft(accessToken, {
          projectId,
          projectName: activeProject.name,
          topic: activeConversation.topic,
          targetAudience: activeConversation.targetAudience,
          length: effectiveLength,
          analysis,
          notes: selectedNotes,
          snippets: selectedSnippets,
          brief: creationBrief,
        })
        nextDraft = response.draft
        setDraftUsageByConversation((current) => ({
          ...current,
          [conversationId]: response.usage,
        }))
      }

      setDraftCopyByConversation((current) => ({
        ...current,
        [conversationId]: nextDraft,
      }))
      setDraftReadyByConversation((current) => ({
        ...current,
        [conversationId]: true,
      }))
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
        step: 'plan',
      }))
    } catch (error) {
      const message = getErrorMessage(error)
      setDraftGenerationErrorByConversation((current) => ({
        ...current,
        [conversationId]: message.includes('DeepSeek API key')
          ? 'AI 服务暂时不可用，请稍后重试。'
          : message,
      }))
    } finally {
      setDraftGeneratingConversationId((current) => (current === conversationId ? '' : current))
      setDraftWaitStartedAt(null)
    }
  }

  function handleBackToSelection() {
    setIsChatStreaming(false)
    setChatInput('')
    updateConversation(activeProject.id, activeConversation.id, (conversation) => ({
      ...conversation,
      analysisReady: false,
      chatMessages: conversation.chatMessages.filter((message) => message.stage === 'setup'),
    }))
  }

  async function handleSendChat() {
    if (isChatStreaming) return

    const question = chatInput.trim()
    if (!question) return

    const projectId = activeProject.id
    const conversationId = activeConversation.id
    const shouldGenerateTitle =
      activeConversation.chatMessages.length === 0 &&
      isDefaultConversationTitle(activeConversation.title)
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      stage: activeConversation.analysisReady ? 'followup' : 'setup',
      lines: [question],
    }

    updateConversation(projectId, conversationId, (conversation) => ({
      ...conversation,
      title: shouldGenerateTitle ? buildConversationTitleFromPrompt(question) : conversation.title,
      chatMessages: [...conversation.chatMessages, userMessage],
    }))
    setChatInput('')

    const reply = activeConversation.analysisReady
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

    setDraftCopyByConversation((current) => {
      const currentDraft = current[activeConversation.id] ?? generatedInitialDraftCopy
      return {
        ...current,
        [activeConversation.id]: setDraftFieldValue(currentDraft, fieldId, normalizedValue),
      }
    })

    rememberExplicitFeedback({
      projectId: activeProject.id,
      conversationId: activeConversation.id,
      type: 'manual_edit',
      content: normalizedValue,
      context: {
        fieldId,
        beforeText: previousValue,
        afterText: normalizedValue,
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

    let nextDraft = draftWithoutSelection
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

    setDraftCopyByConversation((current) => ({
      ...current,
      [activeConversation.id]: nextDraft,
    }))
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
    setDraftCopyByConversation((current) => ({
      ...current,
      [conversationId]: previousDraft,
    }))
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
    setDraftCopyByConversation((current) => ({
      ...current,
      [conversationId]: nextDraft,
    }))
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

  function handleSendRewriteChat() {
    const question = rewriteChatInput.trim()
    const selection = selectedRewriteText.trim()
    if (!question || !selection) return

    const appended = appendRewriteChatMessage({
      question,
      selection,
    })
    if (appended) {
      rememberExplicitFeedback({
        projectId: activeProject.id,
        conversationId: activeConversation.id,
        type: 'rewrite_preference',
        content: question,
        context: {
          selectedText: selection,
          draftTitle: initialDraftCopy.title,
          selectedFieldId: selectedRewriteFieldId,
          step: 'rewrite',
        },
      })
    }
  }

  function handleSendReaderSuggestionsToRewrite() {
    const suggestionBlock = readerPreviewFeedback.blocks.find((block) => block.tone === 'suggestion')
    const suggestionLines = suggestionBlock?.lines ?? []

    if (suggestionLines.length > 0) {
      appendRewriteChatMessage({
        question: [
          '带着读者预演建议回到编辑细调：',
          ...suggestionLines.map((line, index) => `${index + 1}. ${line}`),
        ].join('\n'),
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

  async function handleFinalizeReaderPreview() {
    const wasAlreadyFinalized = Boolean(activeConversation.finalizedAt)
    const copied = await copyTextToClipboard(formatDraftCopyForClipboard(initialDraftCopy))

    updateConversation(activeProject.id, activeConversation.id, (conversation) => ({
      ...conversation,
      finalizedAt: new Date().toISOString(),
      finalDraft: initialDraftCopy,
      step: 'reader',
    }))
    if (!wasAlreadyFinalized) {
      rememberExplicitFeedback({
        projectId: activeProject.id,
        conversationId: activeConversation.id,
        type: 'final_choice',
        content: formatDraftCopyForClipboard(initialDraftCopy),
        context: {
          targetAudience: readerAudienceDraft,
          step: 'reader',
        },
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
            <p className="font-semibold">正在生成初版</p>
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

  function renderWorkspace() {
    return (
      <main className="relative flex h-screen min-h-0 flex-col overflow-hidden px-4 pb-4 pt-5 md:px-8 md:pb-8">
        <section className="relative z-10 mx-auto w-full max-w-6xl shrink-0 pb-4">
          <div className="pointer-events-none absolute inset-x-[-12%] top-[-7rem] h-64 bg-[radial-gradient(circle_at_18%_18%,rgba(103,199,255,0.2),transparent_28%),radial-gradient(circle_at_78%_0%,rgba(148,163,184,0.16),transparent_30%)] blur-xl" />
          <div className="relative grid gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  Lumos AI Writer
                </h1>
              </div>
              <AuthStatus />
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--soft-foreground)]" />
                <Input
                  className="h-[var(--ui-control-height-xl)] rounded-[var(--ui-field-radius)] border-[var(--border)] bg-[var(--surface-raised)] pl-11 pr-[var(--ui-control-inset-x-xl)] text-[length:var(--ui-control-font-xl)] shadow-none"
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="搜索项目或参考文件夹"
                />
              </div>
              <Button size="lg" variant="secondary" onClick={() => goToStep('library')}>
                <Highlighter className="h-4 w-4" />
                文案库
              </Button>
              <Button size="lg" onClick={() => setShowCreateProjectCard(true)}>
                <Plus className="h-4 w-4" />
                新建项目
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--ui-radius-panel)] bg-[var(--surface-muted)] shadow-none">
            <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] bg-transparent px-5 py-4 lg:px-6">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                  项目列表
                </h2>
              </div>
            </div>

            <div className="hidden shrink-0 grid-cols-[minmax(0,1.65fr)_minmax(9rem,0.42fr)_minmax(10.5rem,0.48fr)_6.75rem] items-center gap-6 bg-[rgba(241,243,246,0.72)] px-6 py-4 text-sm font-semibold text-[var(--soft-foreground)] lg:grid">
              <div>项目</div>
              <div>参考文件夹</div>
              <div>最近更新</div>
              <div className="w-[6.75rem] justify-self-end text-center">操作</div>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto">
              {filteredProjects.map((project, index) => {
                const folder = libraryFolders.find((item) => item.id === project.folderId)
                const projectConversation =
                  project.conversations.find(
                    (conversation) => conversation.id === project.activeConversationId,
                  ) ?? project.conversations[0]
                const selectedCount =
                  projectConversation.selectedItemIds.length

                return (
                  <article
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    style={{ animationDelay: `${index * 35}ms` }}
                    aria-label={`进入项目 ${project.name}`}
                    onClick={() => handleOpenProject(project.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      handleOpenProject(project.id)
                    }}
                    className="ui-list-item-motion ui-hover-surface grid cursor-pointer gap-4 bg-transparent px-5 py-4 outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] lg:grid-cols-[minmax(0,1.65fr)_minmax(9rem,0.42fr)_minmax(10.5rem,0.48fr)_6.75rem] lg:items-center lg:gap-6 lg:px-6"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--ui-radius-card)] bg-[var(--panel)] text-[var(--accent-strong)] shadow-none">
                          <FolderOpen className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          {renamingProjectId === project.id ? (
                            <Input
                              autoFocus
                              className="h-[var(--ui-control-height-md)] max-w-sm rounded-[var(--ui-radius-control)] bg-white/90 px-[var(--ui-control-inset-x-md)] text-[length:var(--ui-control-font-md)] font-semibold"
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
                                size="icon"
                                className="size-7 shrink-0 text-[var(--soft-foreground)] hover:bg-transparent hover:text-[var(--muted-foreground)]"
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
                            已选 {selectedCount} 项参考内容
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center">
                      <Badge variant="outline">{folder?.name || '未设置'}</Badge>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-sm text-[var(--muted-foreground)]">
                      <Clock3 className="h-4 w-4 text-[var(--soft-foreground)]" />
                      <span className="whitespace-nowrap">{formatProjectUpdatedAt(project.updatedAt)}</span>
                    </div>
                    <div className="flex items-center gap-2 lg:justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-[6.75rem] justify-center bg-transparent font-medium text-[rgba(214,90,60,0.62)] shadow-none hover:bg-[rgba(214,90,60,0.055)] hover:text-[rgba(214,90,60,0.82)]"
                        aria-label={`删除 ${project.name}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleRequestDeleteProject(project.id)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        删除
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
          <div className="ui-dialog-backdrop fixed inset-0 z-20 flex items-center justify-center bg-[rgba(28,21,16,0.16)] px-4 py-10 backdrop-blur-md">
            <Card className="ui-dialog-card w-full max-w-xl rounded-[var(--ui-radius-dialog)] bg-white/90 shadow-[var(--shadow-elevated)]">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-3xl">新建项目</CardTitle>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setShowCreateProjectCard(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>

              <CardContent className="grid gap-5">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">项目名称</span>
                  <Input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">参考文件夹</span>
                  <Select value={effectiveNewProjectFolderId} onValueChange={setNewProjectFolderId}>
                    <SelectTrigger aria-label="参考文件夹">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {libraryFolders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <div className="flex justify-end gap-3">
                  <Button variant="secondary" onClick={() => setShowCreateProjectCard(false)}>
                    取消
                  </Button>
                  <Button
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim() || !effectiveNewProjectFolderId}
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
            className="ui-dialog-backdrop fixed inset-0 z-30 flex items-center justify-center bg-[rgba(28,21,16,0.2)] px-4 py-10 backdrop-blur-md"
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
                  <CardTitle id="delete-project-title" className="text-2xl">
                    确定删除「{projectPendingDelete.name}」？
                  </CardTitle>
                  <CardDescription id="delete-project-description" className="mt-2">
                    删除后，该项目将从列表中移除，相关对话和已选参考内容也会一并移除。
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent>
                <div className="flex flex-wrap justify-end gap-3">
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
        error={libraryError}
        folders={libraryFolders}
        notes={libraryNotes}
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
      />
    )
  }

  function renderLearn() {
    return (
      <LearnWorkspace
        key={activeConversation.id}
        activeConversationId={activeConversation.id}
        analysisReady={activeConversation.analysisReady}
        chatInput={chatInput}
        chatMessages={activeConversation.chatMessages}
        activeWorkflowStep={activeWorkflowStep}
        folders={libraryFolders}
        notes={libraryNotes}
        snippets={librarySnippets}
        libraryStatus={libraryStatus}
        libraryError={libraryError}
        workflowSteps={workflowSteps}
        analysisError={analysisError}
        analysisWaitSeconds={analysisWaitSeconds}
        isAnalyzing={isAnalyzing}
        isStreaming={isChatStreaming}
        projectName={activeProject.name}
        conversations={sidebarConversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          pinned: conversation.pinned,
          finalizedAt: conversation.finalizedAt,
        }))}
        selectedItemIds={selectedItemIds}
        onBackToWorkspace={() => goToStep('workspace')}
        onCreateConversation={handleCreateConversation}
        onConversationTitleChange={handleConversationTitleChange}
        onToggleConversationPin={handleToggleConversationPin}
        onSwitchConversation={handleSwitchConversation}
        onStartAnalysis={handleStartAnalysis}
        onBackToSelection={handleBackToSelection}
        onNext={() => goToStep('length')}
        onToggleItems={handleToggleItems}
        onSelectItems={handleSelectItems}
        onDeselectItems={handleDeselectItems}
        onChatInputChange={setChatInput}
        onSendChat={handleSendChat}
        onWorkflowStepChange={handleWorkflowStepChange}
      />
    )
  }

  function renderSidebarConversationRow(conversation: ConversationRecord) {
    const isActive = conversation.id === activeProject.activeConversationId
    const isRenaming = renamingSidebarConversationId === conversation.id
    const switchToConversation = () => {
      setOpenSidebarConversationMenuId('')
      handleSwitchConversation(conversation.id)
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
        className={
          isActive
            ? 'group relative flex min-h-[3.25rem] w-full cursor-pointer items-center gap-3 rounded-[var(--ui-radius-card)] border border-transparent bg-white/58 px-3 py-2 text-sm font-semibold leading-6 text-[var(--foreground)] outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--ring)]'
            : conversation.pinned
              ? 'group relative flex min-h-[3.25rem] w-full cursor-pointer items-center gap-3 rounded-[var(--ui-radius-card)] border border-transparent bg-[rgba(241,243,246,0.72)] px-3 py-2 text-sm leading-6 text-[var(--accent-strong)] outline-none transition hover:bg-[rgba(226,232,240,0.86)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]'
              : 'group relative flex min-h-[3.25rem] w-full cursor-pointer items-center gap-3 rounded-[var(--ui-radius-card)] border border-transparent bg-transparent px-3 py-2 text-sm leading-6 text-[var(--foreground)] outline-none transition hover:bg-white/42 focus-visible:ring-4 focus-visible:ring-[var(--ring)]'
        }
      >
        <MessageCircle
          className={
            conversation.pinned
              ? 'h-4 w-4 shrink-0 text-[var(--accent-strong)]'
              : 'h-4 w-4 shrink-0 text-[var(--soft-foreground)]'
          }
        />

        {isRenaming ? (
          <Input
            autoFocus
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
            className="h-[var(--ui-control-height-sm)] min-w-0 flex-1 rounded-[var(--ui-radius-control)] bg-white/86 px-[var(--ui-control-inset-x-sm)] text-[length:var(--ui-control-font-sm)] font-semibold"
            aria-label="重命名对话"
          />
        ) : (
          <div className="min-w-0 flex-1 py-1 text-left">
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
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
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
                className="ui-popover-motion fixed z-[100] w-36 overflow-hidden rounded-[var(--ui-radius-panel)] border border-white/84 bg-white/95 p-1.5 text-sm font-medium text-[var(--foreground)] shadow-[0_18px_48px_rgba(48,34,22,0.12)] backdrop-blur-xl"
                role="menu"
                style={{
                  left: sidebarConversationMenuPosition.left,
                  top: sidebarConversationMenuPosition.top,
                }}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
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
              </div>,
              document.body,
            )
          : null}
      </div>
    )
  }

  function renderWorkflowSidebar() {
    return (
      <aside className="flex min-h-0 max-h-[34vh] flex-col border-b border-[rgba(15,23,42,0.06)] bg-[radial-gradient(circle_at_0%_0%,rgba(103,199,255,0.055),transparent_36%),linear-gradient(180deg,#f4f6f8_0%,#f7f9fb_58%,#fbfcfd_100%)] lg:max-h-none lg:border-b-0 lg:border-r lg:border-r-[rgba(15,23,42,0.06)]">
        <div className="shrink-0 px-6 pb-3 pt-6">
          <div className="flex items-center gap-3 px-1">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => goToStep('workspace')}
              aria-label="返回项目页"
              className="shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
	            <div className="min-w-0">
	              <p className="truncate text-base font-semibold text-[var(--foreground)]">
	                {activeProject.name}
	              </p>
	            </div>
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
    )
  }

  function getWorkflowEmptyCopy(targetStep: Exclude<ConversationStep, 'learn'>) {
    if (!hasSelectedReferences) {
      return {
        title:
          targetStep === 'length'
            ? '还没有可设置篇幅的内容'
            : targetStep === 'plan'
              ? '还不能开始文案创作'
              : targetStep === 'rewrite'
                ? '还没有可调整的初版文案'
                : '还没有可预演的文案',
        description: '先选择参考文案，再继续后续流程。',
        actionLabel: '去选择文案',
      }
    }

    if (!hasLearningResult) {
      return {
        title:
          targetStep === 'length'
            ? '先完成学习拆解'
            : targetStep === 'plan'
              ? '先生成学习总结'
              : targetStep === 'rewrite'
                ? '还没有可调整的初版文案'
                : '还没有可预演的文案',
        description: '先完成学习拆解，再继续生成文案。',
        actionLabel: '去学习拆解',
      }
    }

    if (!hasLengthSelected) {
      return {
        title:
          targetStep === 'plan'
            ? '先选择篇幅'
            : targetStep === 'rewrite'
              ? '还没有可调整的初版文案'
              : targetStep === 'reader'
                ? '还没有可预演的文案'
                : '请选择这篇内容的篇幅',
        description: '先选择篇幅，再开始文案创作。',
        actionLabel: '去篇幅设置',
      }
    }

    return {
      title:
        targetStep === 'rewrite'
          ? '先完成文案创作'
          : targetStep === 'reader'
            ? '先确认可预演的文案'
            : '当前环节还没有内容',
      description:
        targetStep === 'rewrite'
          ? '先生成初版文案，再进入编辑细调。'
          : targetStep === 'reader'
            ? '先确认文案版本，再进入读者预演。'
          : '当前环节暂无内容。',
      actionLabel:
        targetStep === 'rewrite' || targetStep === 'reader' ? '去文案创作' : '去学习拆解',
    }
  }

  function renderWorkflowEmptyState(targetStep: Exclude<ConversationStep, 'learn'>) {
    const copy = getWorkflowEmptyCopy(targetStep)
    const nextStep: ConversationStep =
      hasLearningResult && !hasLengthSelected
        ? 'length'
        : (targetStep === 'rewrite' || targetStep === 'reader') && hasPlanReady
          ? 'plan'
          : 'learn'

    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4 py-8">
        <section className="ui-surface-enter w-full max-w-[42rem] rounded-[var(--ui-radius-panel)] border border-white/72 bg-white/64 px-7 py-8 shadow-[0_18px_48px_rgba(48,34,22,0.055)]">
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
            {(targetStep === 'rewrite' || targetStep === 'reader') && hasLengthSelected ? (
              <Button variant="secondary" onClick={() => goToStep('length')}>
                回到篇幅设置
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    )
  }

  function renderLength() {
    return (
      <div className="grid h-[100vh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[linear-gradient(120deg,#eef2f6_0%,#f6f8fb_46%,#ffffff_100%)] lg:grid-cols-[328px_minmax(0,1fr)] lg:grid-rows-1">
        {renderWorkflowSidebar()}

        <section className="relative flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(148,163,184,0.08),transparent_34%),linear-gradient(180deg,#f6f8fb_0%,#fbfcfd_52%,#ffffff_100%)]">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-transparent px-5 py-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                篇幅设置
              </h1>
              <WorkflowTitleMenu
                activeStep={activeWorkflowStep}
                steps={workflowSteps}
                onStepChange={handleWorkflowStepChange}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:justify-self-end">
              <Button variant="secondary" size="sm" onClick={() => goToStep('learn')}>
                上一步
              </Button>
              <Button size="sm" onClick={() => goToStep('plan')} disabled={!hasPlanReady}>
                下一步
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden px-4 pb-5 pt-1 lg:px-8">
            {hasLearningResult ? (
              <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4">
                <section
                  aria-label="篇幅设置"
                  className="grid min-h-0 flex-1 snap-x snap-mandatory auto-cols-[minmax(19rem,calc(100vw-2rem))] grid-flow-col grid-rows-1 gap-4 overflow-x-auto overflow-y-hidden pb-2 xl:auto-cols-auto xl:grid-flow-row xl:grid-cols-3 xl:overflow-hidden xl:pb-0"
                  role="radiogroup"
                >
                  {lengthPreviewCards.map((card) => {
                    const isSelected = activeConversation.length === card.value
                    const [scenarioLine, ...contentLines] = card.lines
                    const selectLength = () => {
                      setDraftReadyByConversation((current) => ({
                        ...current,
                        [activeConversation.id]: false,
                      }))
                      setDraftCopyByConversation((current) => {
                        const next = { ...current }
                        delete next[activeConversation.id]
                        return next
                      })
                      setDraftGenerationErrorByConversation((current) => {
                        const next = { ...current }
                        delete next[activeConversation.id]
                        return next
                      })
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
                        length: card.value,
                      }))
                    }

                    return (
                      <article
                        key={card.value}
                        aria-checked={isSelected}
                        aria-label={card.title}
                        className={
                          isSelected
                            ? 'ui-choice-card relative isolate flex h-full min-h-0 snap-start cursor-pointer flex-col overflow-hidden rounded-[var(--ui-radius-card)] border border-[rgba(15,23,42,0.18)] bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.92))] shadow-[0_20px_44px_rgba(15,23,42,0.1)] outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--ring)]'
                            : 'ui-choice-card relative isolate flex h-full min-h-0 snap-start cursor-pointer flex-col overflow-hidden rounded-[var(--ui-radius-card)] border border-[rgba(15,23,42,0.075)] bg-white/68 shadow-[0_10px_24px_rgba(15,23,42,0.03)] outline-none transition hover:bg-white/86 focus-visible:ring-4 focus-visible:ring-[var(--ring)]'
                        }
                        onClick={selectLength}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            selectLength()
                          }
                        }}
                        role="radio"
                        tabIndex={0}
                      >
                        {isSelected ? (
                          <CheckCircle2 className="absolute right-6 top-6 z-20 h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
                        ) : null}

                        <div
                          className={
                            isSelected
                              ? 'relative z-10 shrink-0 bg-[linear-gradient(180deg,rgba(248,250,252,1),rgba(255,255,255,1))] px-6 pb-4 pt-6 text-left'
                              : 'relative z-10 shrink-0 bg-[rgba(255,254,252,1)] px-6 pb-4 pt-6 text-left'
                          }
                        >
                          <p className="whitespace-nowrap pr-8 font-['PingFang_SC','Microsoft_YaHei',Arial,sans-serif] text-[length:var(--ui-text-body)] font-semibold leading-[1.45] tracking-normal text-[#333333] sm:text-[length:var(--ui-text-section)]">
                            {card.title}
                          </p>
                          {scenarioLine ? (
                            <p className="mt-3 whitespace-pre-line font-['PingFang_SC','Microsoft_YaHei',Arial,sans-serif] text-[length:var(--ui-text-body-lg)] font-normal leading-[1.68] tracking-normal text-[#333333]">
                              {scenarioLine}
                            </p>
                          ) : null}
                        </div>

                        <div className="relative min-h-0 flex-1 overflow-hidden px-4">
                          <div
                            className={
                            isSelected
                                ? 'pointer-events-none absolute inset-x-4 top-0 z-10 h-7 bg-[rgba(255,255,255,1)]'
                                : 'pointer-events-none absolute inset-x-4 top-0 z-10 h-7 bg-[rgba(255,254,252,1)]'
                            }
                          />
                          <div
                            className={
                            isSelected
                                ? 'pointer-events-none absolute inset-x-4 bottom-0 z-10 h-7 bg-[rgba(255,255,255,1)]'
                                : 'pointer-events-none absolute inset-x-4 bottom-0 z-10 h-7 bg-[rgba(255,254,252,1)]'
                            }
                          />
                          <div className="h-full overflow-y-auto px-2 pb-7 pr-4 pt-7 text-left overscroll-contain [scrollbar-gutter:stable]">
                            <div className="space-y-3 font-['PingFang_SC','Microsoft_YaHei',Arial,sans-serif] text-[length:var(--ui-text-body-lg)] font-normal leading-[1.68] tracking-normal text-[#333333]">
                              {contentLines.map((line, index) => (
                                <p className="whitespace-pre-line" key={`${card.value}-${index}`}>{line}</p>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div
                          className={
                            isSelected
                              ? 'relative z-10 shrink-0 bg-[rgba(255,255,255,1)] px-4 pb-4 pt-3'
                              : 'relative z-10 shrink-0 bg-[rgba(255,254,252,1)] px-4 pb-4 pt-3'
                          }
                        >
                          <Button
                            type="button"
                            variant={isSelected ? 'default' : 'secondary'}
                            className="w-full"
                            onClick={(event) => {
                              event.stopPropagation()
                              selectLength()
                            }}
                          >
                            {isSelected ? '已选择' : '选择'}
                          </Button>
                        </div>
                      </article>
                    )
                  })}
                </section>
              </div>
            ) : (
              renderWorkflowEmptyState('length')
            )}
          </div>
        </section>
      </div>
    )
  }

  function renderPlan() {
    return (
      <div className="grid h-[100vh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[linear-gradient(120deg,#eef2f6_0%,#f6f8fb_46%,#ffffff_100%)] lg:grid-cols-[328px_minmax(0,1fr)] lg:grid-rows-1">
        {renderWorkflowSidebar()}

        <section className="relative flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(148,163,184,0.08),transparent_34%),linear-gradient(180deg,#f6f8fb_0%,#fbfcfd_52%,#ffffff_100%)]">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-transparent px-5 py-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                文案创作
              </h1>
              <WorkflowTitleMenu
                activeStep={activeWorkflowStep}
                steps={workflowSteps}
                onStepChange={handleWorkflowStepChange}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:justify-self-end">
              <Button variant="secondary" size="sm" onClick={() => goToStep('length')}>
                上一步
              </Button>
              <Button size="sm" onClick={() => goToStep('rewrite')} disabled={!hasDraftReady}>
                下一步
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden px-4 pb-5 pt-1 lg:px-6">
            {hasPlanReady ? (
              <section className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-6 pt-5 md:px-4 [scrollbar-gutter:stable]">
                  <div className="grid gap-5">
                    <div className="rounded-[var(--ui-radius-panel)] border border-[var(--border)] bg-[var(--surface-muted)] px-5 py-4 shadow-none">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="accent">创作信息</Badge>
                        <span className="text-sm font-medium text-[var(--muted-foreground)]">
                          已提交
                        </span>
                      </div>
                      <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--foreground)]">
                        <p>
                          <span className="font-semibold">内容主题：</span>
                          {activeConversation.topic}
                        </p>
                        <p>
                          <span className="font-semibold">目标读者：</span>
                          {activeConversation.targetAudience}
                        </p>
                        <p>
                          <span className="font-semibold">必含要点：</span>
                          {creationBrief.mustInclude}
                        </p>
                        <p>
                          <span className="font-semibold">表达边界：</span>
                          {creationBrief.avoidTone}
                        </p>
                        {planAttachments.length > 0 ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {planAttachments.map((attachment) => (
                              <span
                                key={attachment.id}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/78 px-3 py-1 text-xs font-semibold text-[var(--muted-foreground)]"
                              >
                                {attachment.kind === 'image' ? (
                                  <Image className="h-3.5 w-3.5 shrink-0 text-[var(--accent-strong)]" />
                                ) : (
                                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--accent-strong)]" />
                                )}
                                <span className="truncate">{attachment.name}</span>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                        <Layers3 className="h-5 w-5" />
                      </div>
                      <div
                        data-plan-draft-card
                        className="max-w-[50rem] rounded-[var(--ui-radius-panel)] rounded-tl-[0.45rem] bg-white px-5 py-5 shadow-[0_14px_34px_rgba(48,34,22,0.05)]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="accent">初版方案</Badge>
                          <Badge variant="outline">标题 + 正文</Badge>
                        </div>
                        {hasDraftReady ? (
                          <>
                            <div className="mt-4">
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
                                <p className="font-semibold">已准备好生成</p>
                                <p className="mt-1 text-[var(--muted-foreground)]">
                                  {effectiveLength === 'short'
                                    ? '短篇幅'
                                    : effectiveLength === 'medium'
                                      ? '中篇幅'
                                      : '长篇幅'}
                                  ｜{selectedNotes.length} 篇参考，{selectedSnippets.length} 条标注
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                onClick={handleGenerateDraft}
                                disabled={isDraftGenerating}
                              >
                                <WandSparkles className="h-4 w-4" />
                                {draftGenerationError ? '重新生成初版' : '生成初版文案'}
                              </Button>
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

                    <div className="flex justify-start md:ml-[3.25rem]">
                      <Button size="sm" onClick={() => goToStep('rewrite')} disabled={!hasDraftReady}>
                        <PenLine className="h-4 w-4" />
                        进入编辑细调
                      </Button>
                    </div>

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
      <div className="grid h-[100vh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[linear-gradient(120deg,#eef2f6_0%,#f6f8fb_46%,#ffffff_100%)] lg:grid-cols-[328px_minmax(0,1fr)] lg:grid-rows-1">
        {renderWorkflowSidebar()}

        <section className="relative flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(148,163,184,0.08),transparent_34%),linear-gradient(180deg,#f6f8fb_0%,#fbfcfd_52%,#ffffff_100%)]">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-transparent px-5 py-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                编辑细调
              </h1>
              <WorkflowTitleMenu
                activeStep={activeWorkflowStep}
                steps={workflowSteps}
                onStepChange={handleWorkflowStepChange}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:justify-self-end">
              <Button variant="secondary" size="sm" onClick={() => goToStep('plan')}>
                上一步
              </Button>
              <Button size="sm" onClick={() => goToStep('reader')} disabled={!hasDraftReady}>
                下一步
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden px-4 pb-5 pt-1 lg:px-6">
            {hasDraftReady ? (
              <div className="h-full min-h-0 rounded-[var(--ui-radius-panel)] bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(241,245,249,0.32))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                <div className="grid h-full min-h-0 gap-0 xl:grid-cols-[minmax(0,1.08fr)_1px_minmax(22rem,0.78fr)]">
                  <section className="relative flex min-h-0 flex-col overflow-hidden">
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

                  <div className="hidden h-full w-px bg-[linear-gradient(180deg,transparent,rgba(15,23,42,0.10)_18%,rgba(103,199,255,0.12)_50%,rgba(15,23,42,0.08)_82%,transparent)] xl:block" />

                  <aside className="relative flex min-h-0 flex-col overflow-hidden bg-[rgba(248,250,252,0.5)]">
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
                              ? 'justify-self-end rounded-[var(--ui-radius-panel)] rounded-tr-[0.45rem] bg-[var(--foreground)] px-4 py-3 text-sm leading-7 text-white shadow-[0_16px_34px_rgba(15,23,42,0.16)]'
                              : 'rounded-[var(--ui-radius-panel)] rounded-tl-[0.45rem] bg-white px-4 py-4 text-sm leading-7 text-[var(--foreground)] shadow-[0_10px_24px_rgba(48,34,22,0.04)]'
                          }
                        >
                          {message.selectedText ? (
                            <p className={message.role === 'user' ? 'mb-2 text-xs text-white/78' : 'mb-2 text-xs text-[var(--soft-foreground)]'}>
                              针对：{message.selectedText}
                            </p>
                          ) : null}
                          {message.lines.map((line, lineIndex) => (
                            <p key={`${message.id}-${lineIndex}`}>{line}</p>
                          ))}
                        </div>
                      ))}
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
                          disabled={!selectedRewriteText || !rewriteChatInput.trim()}
                        >
                          <Send className="h-4 w-4" />
                          发送
                        </Button>
                      </div>
                    </div>
                  </div>
                </aside>
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
      <div className="grid h-[100vh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[linear-gradient(120deg,#eef2f6_0%,#f6f8fb_46%,#ffffff_100%)] lg:grid-cols-[328px_minmax(0,1fr)] lg:grid-rows-1">
        {renderWorkflowSidebar()}

        <section className="relative flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(148,163,184,0.08),transparent_34%),linear-gradient(180deg,#f6f8fb_0%,#fbfcfd_52%,#ffffff_100%)]">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-transparent px-5 py-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                读者预演
              </h1>
              <WorkflowTitleMenu
                activeStep={activeWorkflowStep}
                steps={workflowSteps}
                onStepChange={handleWorkflowStepChange}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:justify-self-end">
              <div ref={readerAudiencePopoverRef} className="relative">
                <button
                  type="button"
                  data-reader-audience-trigger
                  onClick={() => setIsReaderAudienceOpen((current) => !current)}
                  aria-expanded={isReaderAudienceOpen}
                  aria-label="目标用户群体"
                  title={readerAudienceDraft || '设置目标用户'}
                  className="flex h-[var(--ui-control-height-lg)] w-[min(31rem,46vw)] min-w-[22rem] items-center gap-[var(--ui-control-gap-lg)] rounded-[var(--ui-radius-control)] border border-[rgba(31,22,17,0.12)] bg-white/92 px-[var(--ui-control-inset-x-lg)] text-left text-[length:var(--ui-control-font-lg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_12px_28px_rgba(48,34,22,0.055)] outline-none transition hover:border-[rgba(15,23,42,0.18)] focus-visible:border-[rgba(15,23,42,0.24)] focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
                >
                  <span className="flex shrink-0 items-center gap-1.5 font-semibold text-[var(--foreground)]">
                    <Users className="h-4 w-4 text-[var(--accent-strong)]" />
                    目标用户
                  </span>
                  <span
                    className={
                      readerAudienceDraft
                        ? 'min-w-0 flex-1 truncate font-medium text-[var(--foreground)]'
                        : 'min-w-0 flex-1 truncate font-medium text-[var(--soft-foreground)]'
                    }
                  >
                    {readerAudienceDraft || '设置目标用户'}
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
                        value={readerAudienceDraft}
                        onChange={(event) =>
                          setReaderAudienceByConversation((current) => ({
                            ...current,
                            [activeConversation.id]: event.target.value,
                          }))
                        }
                        className="min-h-[104px] resize-none rounded-[var(--ui-field-radius)] bg-white/84 text-sm leading-6 shadow-none"
                        placeholder="例如：刚开始骑行、怕路线太难、想找周末轻松路线的新手"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
              <Button variant="secondary" size="sm" onClick={() => goToStep('rewrite')}>
                上一步
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden px-4 pb-5 pt-1 lg:px-6">
            {hasDraftReady ? (
              <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,0.88fr)_minmax(24rem,1fr)]">
                <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--ui-radius-panel)] border border-[var(--border)] bg-[var(--surface-muted)] shadow-none">
                  <div className="shrink-0 border-b border-[var(--border)] px-6 py-4 lg:px-7">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="accent">最终文案</Badge>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-8 lg:py-7">
                    <div className="mx-auto max-w-4xl">
                      {renderInitialDraftCopy('reader')}
                    </div>
                  </div>
                </section>

                <aside className="flex min-h-0 flex-col overflow-hidden rounded-[var(--ui-radius-panel)] border border-[var(--border)] bg-[var(--surface-muted)] shadow-none">
                  <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-6">
                    <div className="grid gap-4">
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
                      <Button variant="secondary" onClick={handleSendReaderSuggestionsToRewrite}>
                        <PenLine className="h-4 w-4" />
                        带着建议回到编辑细调
                      </Button>
                      <Button onClick={handleFinalizeReaderPreview}>
                        <CheckCircle2 className="h-4 w-4" />
                        {activeConversation.finalizedAt ? '再次复制文案' : '确认完成并复制文案'}
                      </Button>
                    </div>
                  </div>
                </aside>
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
            ? '篇幅设置'
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

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute left-[-12rem] top-[-8rem] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(103,199,255,0.18),transparent_65%)] blur-2xl" />
      <div className="pointer-events-none absolute right-[-8rem] top-[-5rem] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(148,163,184,0.16),transparent_62%)] blur-2xl" />
      {cloudWorkspaceError && cloudWorkspaceStatus !== 'guest' ? (
        <div
          role="alert"
          className="fixed right-5 top-5 z-[170] flex max-w-sm items-start gap-3 rounded-[var(--ui-radius-panel)] border border-[rgba(214,90,60,0.18)] bg-white/95 px-4 py-3 text-sm text-[var(--foreground)] shadow-[0_18px_48px_rgba(48,34,22,0.14)] backdrop-blur-xl"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#b94f38]" />
          <div>
            <p className="font-semibold">云端项目暂时无法同步</p>
            <p className="mt-1 leading-5 text-[var(--muted-foreground)]">
              当前内容仍保留在页面中，连接恢复后会继续保存。
            </p>
          </div>
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
      {showShellHeader ? (
        <header className="sticky top-0 z-30 w-full border-b border-white/70 bg-[rgba(248,250,252,0.82)] backdrop-blur-2xl">
          <div className="flex w-full items-center justify-between gap-4 px-5 py-4 md:px-8">
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
            ? 'mx-auto flex min-h-[calc(100vh-81px)] w-full max-w-7xl flex-col px-6 py-6 md:px-10'
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
            ? renderLearn()
            : step === 'length'
              ? renderLength()
              : step === 'plan'
                ? renderPlan()
                : step === 'rewrite'
                  ? renderRewrite()
                  : renderReaderPreview()}
      </div>
    </div>
  )
}

export default App
