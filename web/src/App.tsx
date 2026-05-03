import { useEffect, useMemo, useState } from 'react'
import type { ProjectLength } from '@xhs-ai/shared'
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  Layers3,
  PenLine,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
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
import { LearnWorkspace } from '@/components/learn-workspace'
import { demoFolders, demoNotes, demoSnippets } from './lib/demo-data'
import { buildDemoAnalysis } from './lib/analysis'
import { buildDemoPlan } from './lib/plan'
import { buildRewriteSuggestions } from './lib/rewrite'

type PageStep = 'workspace' | 'learn' | 'length' | 'plan' | 'rewrite'

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

type ConversationRecord = {
  id: string
  title: string
  pinned?: boolean
  createdAt: string
  lastOpenedAt: string
  selectedItemIds: string[]
  chatMessages: ChatMessage[]
  analysisReady: boolean
  length: ProjectLength
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

const lengthOptions: Array<{ value: ProjectLength; label: string; hint: string; range: string }> =
  [
    { value: 'short', label: '短篇幅', hint: '适合轻表达和快速发笔记', range: '0-200 字' },
    { value: 'medium', label: '中篇幅', hint: '适合大多数日常小红书内容', range: '201-600 字' },
    { value: 'long', label: '长篇幅', hint: '适合完整讲故事或展开观点', range: '601-1000 字' },
  ]

const workflowSteps: Array<{
  id: Exclude<PageStep, 'workspace'>
  title: string
  caption: string
  icon: typeof Sparkles
}> = [
  { id: 'learn', title: '学习拆解', caption: '选文案并生成偏好分析', icon: Sparkles },
  { id: 'length', title: '篇幅设置', caption: '确定内容长度与节奏', icon: FileText },
  { id: 'plan', title: '结构方案', caption: '把文案拆成可编辑模块', icon: Layers3 },
  { id: 'rewrite', title: '逐段改稿', caption: '对话式打磨最终版本', icon: PenLine },
]

const shellSteps: Array<{ id: PageStep; title: string }> = [
  { id: 'workspace', title: '项目' },
  ...workflowSteps.map((item) => ({ id: item.id, title: item.title })),
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
        selectedItemIds: [],
        chatMessages: [],
        analysisReady: false,
        length: 'medium',
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
        selectedItemIds: [],
        chatMessages: [],
        analysisReady: false,
        length: 'short',
        topic: '我想写一篇数码产品选购和开箱结合的种草内容',
        targetAudience: '会刷小红书找真实体验、不喜欢太广告腔的用户',
        createdAt: '2026-04-30T19:10:00.000Z',
        lastOpenedAt: '2026-04-30T19:10:00.000Z',
        updatedAt: '2026-04-30T19:10:00.000Z',
      },
    ],
  },
]

const panelClass =
  'rounded-[1.5rem] border border-white/72 bg-[linear-gradient(180deg,rgba(255,248,241,0.94),rgba(255,255,255,0.82))] backdrop-blur-xl'

const defaultConversationTitle = '新的文案对话'

function getConversationCreatedTime(conversation: ConversationRecord) {
  return Date.parse(conversation.createdAt || conversation.updatedAt) || 0
}

function sortConversationsForSidebar(conversations: ConversationRecord[]) {
  return [...conversations]
    .map((conversation, index) => ({ conversation, index }))
    .sort(
      (a, b) =>
        Number(Boolean(b.conversation.pinned)) - Number(Boolean(a.conversation.pinned)) ||
        getConversationCreatedTime(b.conversation) - getConversationCreatedTime(a.conversation) ||
        a.index - b.index,
    )
    .map(({ conversation }) => conversation)
}

function buildAssistantReply(question: string, context: ReturnType<typeof buildDemoAnalysis>) {
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
    lines: [
      `我会把你刚才这条追问记在当前项目里，后续分析会继续沿着这个方向走。${context.preference[0]} ${context.preference[1]}`,
    ],
  }
}

function buildSetupReply(question: string) {
  if (question.includes('开头') || question.includes('首屏')) {
    return {
      stage: 'setup' as const,
      title: '分析重点已记录',
      lines: ['我会优先盯开头怎么把人拉进来，尤其会看首屏是不是够快、够像真人开口。你选好文案后直接开始分析就行。'],
    }
  }

  if (question.includes('结构') || question.includes('节奏')) {
    return {
      stage: 'setup' as const,
      title: '分析重点已记录',
      lines: ['这一轮我会重点拆结构和推进节奏，看看这些文案是怎么安排信息顺序、怎么让读者继续往下看的。'],
    }
  }

  if (question.includes('语气') || question.includes('文风') || question.includes('口语')) {
    return {
      stage: 'setup' as const,
      title: '分析重点已记录',
      lines: ['收到，我会把语气和口语感放在更前面，尽量帮你拆出“为什么它读起来像真人在说话”。'],
    }
  }

  return {
    stage: 'setup' as const,
    title: '分析重点已记录',
    lines: ['我先记下这条要求。你可以继续勾选要参考的文案，等你点开始分析后，我会带着这个方向一起拆。'],
  }
}

function buildAnalysisChat(context: ReturnType<typeof buildDemoAnalysis>): ChatMessage[] {
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

function WorkflowRail({ step }: { step: PageStep }) {
  const activeIndex = workflowSteps.findIndex((item) => item.id === step)

  return (
    <Card className="rounded-[1.8rem] shadow-[var(--shadow-soft)]">
      <CardHeader className="pb-4">
        <Badge variant="accent" className="w-fit">
          工作流
        </Badge>
        <CardTitle className="text-2xl">从素材到成稿</CardTitle>
        <CardDescription>每一步都复用上一轮项目上下文，避免重复配置。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {workflowSteps.map((item, index) => {
          const Icon = item.icon
          const isActive = item.id === step
          const isDone = activeIndex > index || (step === 'workspace' && index === -1)

          return (
            <div
              key={item.id}
              className={
                isActive
                  ? 'flex items-start gap-3 rounded-[1.25rem] border border-[rgba(240,122,47,0.18)] bg-[var(--accent-soft)] p-3.5 text-[var(--foreground)]'
                  : 'flex items-start gap-3 rounded-[1.25rem] border border-[var(--border)] bg-white/62 p-3.5 text-[var(--muted-foreground)]'
              }
            >
              <div
                className={
                  isActive || isDone
                    ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full premium-gradient text-white shadow-[0_10px_20px_rgba(255,149,80,0.18)]'
                    : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--soft-foreground)]'
                }
              >
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">{item.title}</p>
                <p className="mt-1 text-xs leading-5">{item.caption}</p>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function ShellStepPills({ step }: { step: PageStep }) {
  return (
    <div className="hidden items-center gap-1 rounded-full border border-white/76 bg-white/66 p-1 shadow-[0_10px_24px_rgba(48,34,22,0.04)] lg:flex">
      {shellSteps.map((item) => (
        <span
          key={item.id}
          className={
            item.id === step
              ? 'rounded-full bg-[var(--foreground)] px-3 py-1.5 text-xs font-semibold text-white'
              : 'rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)]'
          }
        >
          {item.title}
        </span>
      ))}
    </div>
  )
}

function App() {
  const [step, setStep] = useState<PageStep>('workspace')
  const [projects, setProjects] = useState<ProjectRecord[]>(initialProjects)
  const [activeProjectId, setActiveProjectId] = useState(initialProjects[0].id)
  const [chatInput, setChatInput] = useState('')
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [newProjectName, setNewProjectName] = useState('深圳周末路线项目')
  const [newProjectFolderId, setNewProjectFolderId] = useState(demoFolders[0].id)
  const [showCreateProjectCard, setShowCreateProjectCard] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [renamingProjectId, setRenamingProjectId] = useState('')
  const [renamingProjectName, setRenamingProjectName] = useState('')

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [step])

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [activeProjectId, projects],
  )

  const activeConversation = useMemo(
    () =>
      activeProject.conversations.find(
        (conversation) => conversation.id === activeProject.activeConversationId,
      ) ?? activeProject.conversations[0],
    [activeProject],
  )

  const sidebarConversations = useMemo(
    () => sortConversationsForSidebar(activeProject.conversations),
    [activeProject.conversations],
  )

  const selectedItemIds = activeConversation.selectedItemIds

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
    () => demoSnippets.filter((snippet) => selectedSnippetIds.has(snippet.id)),
    [selectedSnippetIds],
  )

  const selectedNotes = useMemo(() => {
    const snippetNoteUrls = new Set(selectedSnippets.map((snippet) => snippet.noteUrl))
    return demoNotes.filter(
      (note) => selectedNoteIds.has(note.id) || snippetNoteUrls.has(note.sourceUrl),
    )
  }, [selectedNoteIds, selectedSnippets])

  const selectedFolderName = useMemo(() => {
    const folderNames = Array.from(new Set(selectedNotes.map((note) => note.folderName).filter(Boolean)))

    if (folderNames.length === 0) return '未选择文案'
    if (folderNames.length === 1) return folderNames[0]

    return `${folderNames.length} 个文件夹`
  }, [selectedNotes])

  const analysis = useMemo(
    () =>
      buildDemoAnalysis({
        folderName: selectedFolderName,
        notes: selectedNotes,
        snippets: selectedSnippets,
        topic: activeConversation.topic,
        targetAudience: activeConversation.targetAudience,
        projectName: activeProject.name,
        length: activeConversation.length,
      }),
    [
      activeProject.name,
      activeConversation.length,
      activeConversation.targetAudience,
      activeConversation.topic,
      selectedFolderName,
      selectedNotes,
      selectedSnippets,
    ],
  )

  const draftBlocks = useMemo(
    () =>
      buildDemoPlan({
        topic: activeConversation.topic,
        targetAudience: activeConversation.targetAudience,
        length: activeConversation.length,
        snippets: selectedSnippets,
      }),
    [
      activeConversation.length,
      activeConversation.targetAudience,
      activeConversation.topic,
      selectedSnippets,
    ],
  )

  const rewriteSuggestions = useMemo(
    () =>
      buildRewriteSuggestions({
        blocks: draftBlocks,
        snippets: selectedSnippets,
      }),
    [draftBlocks, selectedSnippets],
  )

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()
    return projects.filter((project) => {
      const folder = demoFolders.find((item) => item.id === project.folderId)
      const content = [project.name, folder?.name || ''].join(' ').toLowerCase()
      return !query || content.includes(query)
    })
  }, [projectSearch, projects])

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

  function buildConversationTitleFromPrompt(prompt: string) {
    const normalized = prompt.replace(/\s+/g, ' ').trim()
    return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized
  }

  function isDefaultConversationTitle(title: string) {
    return !title.trim() || title === defaultConversationTitle || title === '新的小红书文案对话'
  }

  function handleOpenProject(projectId: string) {
    setIsChatStreaming(false)
    setChatInput('')
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              conversations: sortConversationsForSidebar(project.conversations),
            }
          : project,
      ),
    )
    setActiveProjectId(projectId)
    setStep('learn')
  }

  function handleDeleteProject(projectId: string) {
    setProjects((current) => {
      const next = current.filter((project) => project.id !== projectId)
      if (next.length > 0 && activeProjectId === projectId) {
        setActiveProjectId(next[0].id)
      }
      if (next.length === 0) {
        setStep('workspace')
      }
      return next
    })
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
      folderId: newProjectFolderId,
      activeConversationId: conversationId,
      updatedAt: now,
      conversations: [
        {
          id: conversationId,
          title: defaultConversationTitle,
          selectedItemIds: [],
          chatMessages: [],
          analysisReady: false,
          length: 'medium',
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
    setChatInput('')
    setIsChatStreaming(false)
    setShowCreateProjectCard(false)
    setStep('learn')
  }

  function handleCreateConversation() {
    const now = new Date().toISOString()
    const conversationId = crypto.randomUUID()
    const nextConversation: ConversationRecord = {
      id: conversationId,
      title: defaultConversationTitle,
      selectedItemIds: [],
      chatMessages: [],
      analysisReady: false,
      length: 'medium',
      topic: `我想继续围绕「${activeProject.name}」写一篇新的小红书文案`,
      targetAudience: '还没细分，后面会继续补充',
      createdAt: now,
      lastOpenedAt: now,
      updatedAt: now,
    }

    setIsChatStreaming(false)
    setChatInput('')
    setStep('learn')
    updateProject(activeProject.id, (project) => ({
      ...project,
      activeConversationId: conversationId,
      updatedAt: now,
      conversations: sortConversationsForSidebar([nextConversation, ...project.conversations]),
    }))
  }

  function handleSwitchConversation(conversationId: string) {
    if (conversationId === activeProject.activeConversationId) return

    setIsChatStreaming(false)
    setChatInput('')
    updateProject(activeProject.id, (project) => ({
      ...project,
      activeConversationId: conversationId,
    }))
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
    const analysisMessages = buildAnalysisChat(analysis)

    setIsChatStreaming(true)
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

    setIsChatStreaming(false)
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

  function formatProjectUpdatedAt(value: string) {
    const date = new Date(value)
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`
  }

  function renderWorkspace() {
    return (
      <main className="relative flex h-screen min-h-0 flex-col overflow-hidden px-4 pb-4 pt-5 md:px-8 md:pb-8">
        <section className="relative z-10 mx-auto w-full max-w-6xl shrink-0 pb-4">
          <div className="pointer-events-none absolute inset-x-[-12%] top-[-7rem] h-64 bg-[radial-gradient(circle_at_18%_18%,rgba(103,199,255,0.2),transparent_28%),radial-gradient(circle_at_78%_0%,rgba(255,176,106,0.22),transparent_30%)] blur-xl" />
          <div className="relative grid gap-5">
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                工具名（待提供）
              </h1>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">先留位置</p>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--soft-foreground)]" />
                <Input
                  className="h-12 rounded-full border-white/80 bg-white/82 pl-11 shadow-[0_14px_34px_rgba(48,34,22,0.06)]"
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="搜索项目或参考文件夹"
                />
              </div>
              <Button size="lg" onClick={() => setShowCreateProjectCard(true)}>
                <Plus className="h-4 w-4" />
                新建项目
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] shadow-[var(--shadow-soft)]">
            <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] bg-white/76 px-5 py-4 lg:px-6">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                  项目列表
                </h2>
              </div>
            </div>

            <div className="hidden shrink-0 grid-cols-[minmax(0,2.7fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_144px] gap-4 bg-[rgba(255,248,241,0.68)] px-6 py-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--soft-foreground)] lg:grid">
              <div>项目</div>
              <div>参考文件夹</div>
              <div>最近更新</div>
              <div className="text-right">操作</div>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto">
              {filteredProjects.map((project) => {
                const folder = demoFolders.find((item) => item.id === project.folderId)
                const projectConversation =
                  project.conversations.find(
                    (conversation) => conversation.id === project.activeConversationId,
                  ) ?? project.conversations[0]
                const selectedCount =
                  projectConversation.selectedItemIds.length

                return (
                  <article
                    key={project.id}
                    className="grid gap-4 bg-white/72 px-5 py-5 transition hover:bg-white/92 lg:grid-cols-[minmax(0,2.7fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_144px] lg:px-6"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--panel)] text-[var(--accent-strong)] shadow-[0_10px_24px_rgba(48,34,22,0.04)]">
                          <FolderOpen className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          {renamingProjectId === project.id ? (
                            <Input
                              autoFocus
                              className="h-9 max-w-sm rounded-xl bg-white/90 text-base font-semibold"
                              value={renamingProjectName}
                              aria-label={`重命名 ${project.name}`}
                              onBlur={() => handleSaveRenameProject(project.id)}
                              onChange={(event) => setRenamingProjectName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.currentTarget.blur()
                                }
                                if (event.key === 'Escape') {
                                  handleCancelRenameProject()
                                }
                              }}
                            />
                          ) : (
                            <div className="flex min-w-0 items-center gap-1.5">
                              <p className="truncate text-base font-semibold text-[var(--foreground)]">
                                {project.name}
                              </p>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0 text-[var(--soft-foreground)] hover:bg-transparent hover:text-[var(--muted-foreground)]"
                                aria-label={`重命名 ${project.name}`}
                                onClick={() => handleStartRenameProject(project)}
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
                    <div className="flex items-center">
                      <Badge variant="outline">{folder?.name || '未设置'}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                      <Clock3 className="h-4 w-4 text-[var(--soft-foreground)]" />
                      {formatProjectUpdatedAt(project.updatedAt)}
                    </div>
                    <div className="flex items-center gap-2 lg:justify-end">
                      <Button variant="secondary" size="sm" onClick={() => handleOpenProject(project.id)}>
                        <FolderOpen className="h-4 w-4" />
                        进入
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`删除 ${project.name}`}
                        onClick={() => handleDeleteProject(project.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </article>
                )
              })}

              {filteredProjects.length === 0 ? (
                <div className="bg-white/72 px-6 py-14 text-center">
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
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-[rgba(28,21,16,0.16)] px-4 py-10 backdrop-blur-md">
            <Card className="w-full max-w-xl rounded-[2.1rem] bg-white/90 shadow-[var(--shadow-elevated)]">
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
                  <Select value={newProjectFolderId} onValueChange={setNewProjectFolderId}>
                    <SelectTrigger aria-label="参考文件夹">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {demoFolders.map((folder) => (
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
                  <Button onClick={handleCreateProject}>新建并进入项目</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </main>
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
        folders={demoFolders}
        notes={demoNotes}
        snippets={demoSnippets}
        isStreaming={isChatStreaming}
        projectName={activeProject.name}
        conversations={sidebarConversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          pinned: conversation.pinned,
        }))}
        selectedItemIds={selectedItemIds}
        onBackToWorkspace={() => setStep('workspace')}
        onCreateConversation={handleCreateConversation}
        onConversationTitleChange={handleConversationTitleChange}
        onToggleConversationPin={handleToggleConversationPin}
        onSwitchConversation={handleSwitchConversation}
        onStartAnalysis={handleStartAnalysis}
        onBackToSelection={handleBackToSelection}
        onNext={() => setStep('length')}
        onToggleItems={handleToggleItems}
        onSelectItems={handleSelectItems}
        onDeselectItems={handleDeselectItems}
        onChatInputChange={setChatInput}
        onSendChat={handleSendChat}
      />
    )
  }

  function renderLength() {
    return (
      <main className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <Badge variant="accent" className="mb-3">
                Step 2
              </Badge>
              <CardTitle className="text-3xl">选择篇幅</CardTitle>
              <CardDescription>
                用篇幅控制生成的密度和叙事节奏，后续结构方案会根据这里的选择自动收束。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setStep('learn')}>
                <ArrowLeft className="h-4 w-4" />
                返回分析页
              </Button>
              <Button onClick={() => setStep('plan')}>下一步</Button>
            </div>
          </CardHeader>

          <CardContent>
            <div className="grid gap-5 lg:grid-cols-3">
              {lengthOptions.map((option) => {
                const isSelected = activeConversation.length === option.value

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      updateConversation(activeProject.id, activeConversation.id, (conversation) => ({
                        ...conversation,
                        length: option.value,
                      }))
                    }
                    className={
                      isSelected
                        ? 'group rounded-[1.8rem] border border-[rgba(240,122,47,0.34)] bg-[linear-gradient(180deg,rgba(255,240,229,0.92),rgba(255,255,255,0.9))] p-5 text-left shadow-[0_20px_44px_rgba(61,35,18,0.1)]'
                        : 'group rounded-[1.8rem] border border-[var(--border)] bg-white/62 p-5 text-left shadow-[0_10px_24px_rgba(48,34,22,0.03)] hover:bg-white/86'
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant={isSelected ? 'accent' : 'outline'}>{option.range}</Badge>
                      {isSelected ? (
                        <CheckCircle2 className="h-5 w-5 text-[var(--accent-strong)]" />
                      ) : null}
                    </div>
                    <div className="mt-5 rounded-[1.55rem] border border-black/8 bg-white px-4 py-5 shadow-[0_16px_32px_rgba(61,35,18,0.07)]">
                      <div className="mx-auto h-4 w-24 rounded-full bg-[#efe7dc]" />
                      <div className="mt-5 grid gap-2">
                        <div className="h-3 w-24 rounded-full bg-[#d8c5b6]" />
                        {Array.from({
                          length: option.value === 'short' ? 4 : option.value === 'medium' ? 9 : 14,
                        }).map((_, index) => (
                          <div
                            key={index}
                            className="h-2.5 rounded-full bg-[#f0e7de]"
                            style={{ width: `${88 + ((index * 9) % 12)}%` }}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="mt-5 text-lg font-semibold text-[var(--foreground)]">
                      {option.label}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {option.hint}
                    </p>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <WorkflowRail step={step} />
      </main>
    )
  }

  function renderPlan() {
    return (
      <main className="grid flex-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="grid gap-6">
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
              <div className="max-w-xl">
                <Badge variant="accent" className="mb-3">
                  Step 3
                </Badge>
                <CardTitle className="text-3xl">结构化方案</CardTitle>
                <CardDescription>
                  把分析结果转成可调整的内容模块，先定骨架，再进入逐段改稿。
                </CardDescription>
              </div>
              <Button variant="secondary" onClick={() => setStep('length')}>
                <ArrowLeft className="h-4 w-4" />
                返回篇幅页
              </Button>
            </CardHeader>

            <CardContent className="grid gap-5">
              <div className={`${panelClass} p-5`}>
                <Badge variant="outline">当前项目</Badge>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {activeProject.name}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
                  这一版先把结构块做出来：你后面可以按块调整顺序、补内容，再进入逐段改稿。
                </p>
              </div>

              <div className="grid gap-3">
                {draftBlocks.map((block, index) => (
                  <div
                    key={block.key}
                    className="flex items-start gap-4 rounded-[1.35rem] border border-[var(--border)] bg-white/64 p-4 shadow-[0_10px_24px_rgba(48,34,22,0.03)]"
                  >
                    <span
                      className="mt-1 h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.78)]"
                      style={{ backgroundColor: block.blockColor }}
                    />
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        {index + 1}. {block.title}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                        {block.toneHint}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[1.8rem] shadow-[var(--shadow-soft)]">
            <CardHeader className="pb-4">
              <Badge variant="accent" className="w-fit">
                后续动作占位
              </Badge>
              <CardDescription>这些能力目前保留为产品动作入口，不改变现有业务逻辑。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {[
                '拖拽结构块顺序',
                '重新生成某一块内容',
                '修改篇幅后重排整篇方案',
                '进入逐段对话改稿',
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-[1.2rem] border border-[var(--border)] bg-white/66 px-4 py-4 text-sm leading-6 text-[var(--foreground)]"
                >
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <Badge variant="accent" className="w-fit">
              初版方案预览
            </Badge>
            <CardTitle className="text-3xl">可执行草稿</CardTitle>
            <CardDescription>右侧预览模拟用户确认前看到的内容结构，保留每个模块的语气提示。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {draftBlocks.map((block) => (
              <article
                key={block.key}
                className="rounded-[1.5rem] border border-[var(--border)] bg-white/64 p-5 shadow-[0_10px_24px_rgba(48,34,22,0.03)]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.78)]"
                    style={{ backgroundColor: block.blockColor }}
                  />
                  <p className="text-base font-semibold text-[var(--foreground)]">
                    {block.title}
                  </p>
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
                  {block.toneHint}
                </p>
                <div className="mt-4 rounded-[1.2rem] bg-white px-4 py-4 text-sm leading-7 text-[var(--foreground)]">
                  {block.content}
                </div>
              </article>
            ))}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button size="lg" onClick={() => setStep('rewrite')}>
              确认方案并进入改稿
              </Button>
              <Button variant="secondary" size="lg">
              重新生成结构方案
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  function renderRewrite() {
    return (
      <main className="grid flex-1 gap-6 xl:grid-cols-[0.96fr_1.04fr]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <Badge variant="accent" className="mb-3">
                Step 4
              </Badge>
              <CardTitle className="text-3xl">逐段改稿工作台</CardTitle>
              <CardDescription>左侧保留完整结构块，方便对照上下文逐段打磨。</CardDescription>
            </div>
            <Button variant="secondary" onClick={() => setStep('plan')}>
              <ArrowLeft className="h-4 w-4" />
              返回方案页
            </Button>
          </CardHeader>

          <CardContent className="grid gap-4">
            {draftBlocks.map((block) => (
              <article
                key={block.key}
                className="rounded-[1.5rem] border border-[var(--border)] bg-white/64 p-5 shadow-[0_10px_24px_rgba(48,34,22,0.03)]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.78)]"
                    style={{ backgroundColor: block.blockColor }}
                  />
                  <p className="text-base font-semibold text-[var(--foreground)]">
                    {block.title}
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                  {block.toneHint}
                </p>
                <div className="mt-4 rounded-[1.2rem] bg-white px-4 py-4 text-sm leading-7 text-[var(--foreground)]">
                  {block.content}
                </div>
              </article>
            ))}
          </CardContent>
        </Card>

        <section className="grid gap-6">
          <Card>
            <CardHeader>
              <Badge variant="accent" className="w-fit">
                AI 对话与逐段改写
              </Badge>
              <CardTitle className="text-3xl">改写建议流</CardTitle>
              <CardDescription>每个模块保留讨论线索和备选表达，便于后续做版本分支。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {rewriteSuggestions.map((item) => (
                <article
                  key={item.blockKey}
                  className="rounded-[1.45rem] border border-[var(--border)] bg-white/64 p-5 shadow-[0_10px_24px_rgba(48,34,22,0.03)]"
                >
                  <p className="text-base font-semibold text-[var(--foreground)]">
                    {item.blockTitle}
                  </p>
                  <div className="mt-4 grid gap-3">
                    {item.discussion.map((line) => (
                      <div
                        key={line}
                        className="rounded-[1.1rem] bg-white px-4 py-4 text-sm leading-7 text-[var(--foreground)]"
                      >
                        {line}
                      </div>
                    ))}
                    {item.alternatives.map((line, index) => (
                      <div
                        key={line}
                        className="rounded-[1.1rem] border border-dashed border-[rgba(240,122,47,0.22)] bg-[rgba(255,248,241,0.56)] px-4 py-4 text-sm leading-7 text-[var(--muted-foreground)]"
                      >
                        方案 {index + 1}：{line}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-[linear-gradient(180deg,rgba(255,248,241,0.94),rgba(255,255,255,0.86))] shadow-[var(--shadow-soft)]">
            <CardHeader className="pb-4">
              <Badge variant="accent" className="w-fit">
                版本与后续动作
              </Badge>
              <CardDescription>这些按钮保留现有动作占位，不引入新的业务状态。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {[
                '保留当前版本，后面可回退到分析页或方案页。',
                '如果篇幅或结构调整较大，后面可以选择保留当前版本再另开分支。',
                '下一步会进入最终审稿页，模拟读者浏览行为并给出优化建议。',
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-[1.2rem] bg-white/88 px-4 py-4 text-sm leading-7 text-[var(--foreground)]"
                >
                  {item}
                </div>
              ))}
              <div className="flex flex-wrap gap-3 pt-2">
                <Button size="lg">
                保存当前版本
                </Button>
                <Button variant="secondary" size="lg">
                进入最终审稿
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    )
  }

  const navigationTitle =
    step === 'workspace'
      ? '项目工作台'
      : step === 'learn'
        ? '网页文案拆解'
        : step === 'length'
          ? '篇幅设置'
          : step === 'plan'
            ? '结构化方案'
            : '逐段改稿'

  const navigationSubtitle =
    step === 'workspace'
      ? '管理项目并进入对应的文案工作流。'
      : step === 'learn'
        ? '在同一条 AI 对话里完成选文案、开始分析和追问。'
        : '当前项目会沿用前面的分析结果，继续往下生成。'

  const showShellHeader = step !== 'learn' && step !== 'workspace'

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute left-[-12rem] top-[-8rem] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(103,199,255,0.18),transparent_65%)] blur-2xl" />
      <div className="pointer-events-none absolute right-[-8rem] top-[-5rem] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(255,176,106,0.22),transparent_62%)] blur-2xl" />
      {showShellHeader ? (
        <header className="sticky top-0 z-30 w-full border-b border-white/70 bg-[rgba(250,247,241,0.78)] backdrop-blur-2xl">
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
              <div className="rounded-full border border-[rgba(240,122,47,0.16)] bg-[rgba(255,240,229,0.92)] px-4 py-2 text-sm font-medium text-[var(--accent-strong)]">
                {demoFolders.find((folder) => folder.id === activeProject.folderId)?.name ?? '未选择文件夹'}
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
        {step === 'workspace' || step === 'learn' ? null : (
          <header className="mb-6 overflow-hidden rounded-[2.2rem] border border-white/72 bg-[linear-gradient(135deg,rgba(255,250,244,0.96),rgba(255,255,255,0.88))] shadow-[0_28px_80px_rgba(71,37,15,0.08)] backdrop-blur-xl">
            <div className="relative px-6 py-8 md:px-10">
              <div className="absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_top_left,rgba(103,199,255,0.18),transparent_40%),radial-gradient(circle_at_top_right,rgba(255,176,106,0.24),transparent_44%),radial-gradient(circle_at_60%_10%,rgba(239,182,208,0.24),transparent_38%)]" />
              <div className="relative max-w-4xl space-y-4">
                <span className="inline-flex rounded-full border border-black/10 bg-white/80 px-4 py-2 text-xs font-semibold tracking-[0.24em] text-[var(--accent-strong)] uppercase">
                  XHS AI Studio
                </span>
                <h1 className="font-display text-4xl leading-none tracking-[-0.06em] text-[var(--foreground)] md:text-6xl">
                  {step === 'length' ? (
                    <>
                      先选篇幅，
                      <br />
                      再确定生成方向。
                    </>
                  ) : step === 'plan' ? (
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
        )}

        {step === 'workspace'
          ? renderWorkspace()
          : step === 'learn'
            ? renderLearn()
            : step === 'length'
              ? renderLength()
              : step === 'plan'
                ? renderPlan()
                : renderRewrite()}
      </div>
    </div>
  )
}

export default App
