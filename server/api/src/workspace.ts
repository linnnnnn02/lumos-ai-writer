import type { User } from '@supabase/supabase-js'
import type {
  CreateFeedbackMemoryRequest,
  FeedbackMemoryDto,
  GetWorkspaceResponse,
  SyncWorkspaceRequest,
  WorkspaceChatMessageDto,
  WorkspaceConversationDto,
  WorkspaceDraftDto,
  WorkspaceProjectDto,
} from '@lumos-ai/shared'
import type { AppConfig } from './env.js'
import { SupabaseSchemaMissingError } from './library.js'
import { createSupabaseAdminClient } from './supabase.js'

type DatabaseError = {
  code?: string
  message?: string
}

type ProjectRow = {
  id: string
  name: string
  default_folder_id: string | null
  active_conversation_id: string | null
  created_at: string
  updated_at: string
}

type ConversationRow = {
  id: string
  project_id: string | null
  title: string
  step: WorkspaceConversationDto['step']
  pinned: boolean
  selected_reference_ids: unknown
  length: WorkspaceConversationDto['length']
  topic: string | null
  target_audience: string | null
  analysis_ready: boolean
  finalized_at: string | null
  state: unknown
  created_at: string
  updated_at: string
  last_opened_at: string
}

type ChatMessageRow = {
  id: string
  conversation_id: string | null
  channel: string
  role: WorkspaceChatMessageDto['role']
  content: unknown
  created_at: string
}

type DraftRow = {
  id: string
  conversation_id: string | null
  version: number
  title: string
  body: unknown
  source: string
  created_at: string
  updated_at: string
}

type FeedbackMemoryRow = {
  id: string
  project_id: string | null
  conversation_id: string | null
  draft_id: string | null
  type: FeedbackMemoryDto['type']
  content: string
  context: unknown
  source: string
  created_at: string
  updated_at: string
}

const projectColumns =
  'id,name,default_folder_id,active_conversation_id,created_at,updated_at'
const conversationColumns =
  'id,project_id,title,step,pinned,selected_reference_ids,length,topic,target_audience,analysis_ready,finalized_at,state,created_at,updated_at,last_opened_at'
const messageColumns = 'id,conversation_id,channel,role,content,created_at'
const draftColumns = 'id,conversation_id,version,title,body,source,created_at,updated_at'
const feedbackMemoryColumns =
  'id,project_id,conversation_id,draft_id,type,content,context,source,created_at,updated_at'

export class WorkspaceOwnershipError extends Error {
  constructor(message = 'Workspace resource does not belong to the current user.') {
    super(message)
    this.name = 'WorkspaceOwnershipError'
  }
}

function assertNoDatabaseError(error: DatabaseError | null) {
  if (!error) return
  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205') {
    throw new SupabaseSchemaMissingError('Workspace persistence migration is not installed.')
  }
  throw new Error(error.message || 'Supabase workspace request failed.')
}

function getAdminClient(config: AppConfig) {
  const supabase = createSupabaseAdminClient(config)
  if (!supabase) {
    throw new SupabaseSchemaMissingError('Supabase service role key is not configured.')
  }
  return supabase
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function toMessageDto(row: ChatMessageRow): WorkspaceChatMessageDto {
  return {
    id: row.id,
    channel: row.channel,
    role: row.role,
    content: toObject(row.content),
    createdAt: row.created_at,
  }
}

function toDraftDto(row: DraftRow): WorkspaceDraftDto {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    body: toStringArray(row.body),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toFeedbackMemoryDto(row: FeedbackMemoryRow): FeedbackMemoryDto {
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    draftId: row.draft_id,
    type: row.type,
    content: row.content,
    context: toObject(row.context),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function assertOwnedIds(
  supabase: ReturnType<typeof getAdminClient>,
  table: 'projects' | 'conversations' | 'chat_messages' | 'drafts',
  user: User,
  ids: string[],
) {
  if (ids.length === 0) return

  const { data, error } = await supabase.from(table).select('id,user_id').in('id', ids)
  assertNoDatabaseError(error)

  const foreignRow = (data ?? []).find((row) => row.user_id !== user.id)
  if (foreignRow) throw new WorkspaceOwnershipError()
}

async function assertOwnedFolderIds(
  supabase: ReturnType<typeof getAdminClient>,
  user: User,
  folderIds: string[],
) {
  if (folderIds.length === 0) return

  const { data, error } = await supabase
    .from('folders')
    .select('id,user_id')
    .in('id', folderIds)
    .eq('user_id', user.id)
    .is('deleted_at', null)

  assertNoDatabaseError(error)

  if ((data ?? []).length !== folderIds.length) {
    throw new WorkspaceOwnershipError('A selected folder is unavailable.')
  }
}

export async function listWorkspace(config: AppConfig, user: User): Promise<GetWorkspaceResponse> {
  const supabase = getAdminClient(config)
  const [projectResult, conversationResult, messageResult, draftResult, memoryResult] =
    await Promise.all([
      supabase
        .from('projects')
        .select(projectColumns)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false }),
      supabase
        .from('conversations')
        .select(conversationColumns)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('pinned', { ascending: false })
        .order('last_opened_at', { ascending: false }),
      supabase
        .from('chat_messages')
        .select(messageColumns)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('drafts')
        .select(draftColumns)
        .eq('user_id', user.id)
        .order('version', { ascending: false }),
      supabase
        .from('feedback_memories')
        .select(feedbackMemoryColumns)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ])

  assertNoDatabaseError(projectResult.error)
  assertNoDatabaseError(conversationResult.error)
  assertNoDatabaseError(messageResult.error)
  assertNoDatabaseError(draftResult.error)
  assertNoDatabaseError(memoryResult.error)

  const messagesByConversation = new Map<string, WorkspaceChatMessageDto[]>()
  for (const row of (messageResult.data ?? []) as ChatMessageRow[]) {
    if (!row.conversation_id) continue
    const messages = messagesByConversation.get(row.conversation_id) ?? []
    messages.push(toMessageDto(row))
    messagesByConversation.set(row.conversation_id, messages)
  }

  const latestDraftByConversation = new Map<string, WorkspaceDraftDto>()
  for (const row of (draftResult.data ?? []) as DraftRow[]) {
    if (!row.conversation_id || latestDraftByConversation.has(row.conversation_id)) continue
    latestDraftByConversation.set(row.conversation_id, toDraftDto(row))
  }

  const conversationsByProject = new Map<string, WorkspaceConversationDto[]>()
  for (const row of (conversationResult.data ?? []) as ConversationRow[]) {
    if (!row.project_id) continue
    const conversations = conversationsByProject.get(row.project_id) ?? []
    conversations.push({
      id: row.id,
      title: row.title,
      step: row.step,
      pinned: row.pinned,
      selectedReferenceIds: toStringArray(row.selected_reference_ids),
      length: row.length,
      topic: row.topic ?? '',
      targetAudience: row.target_audience ?? '',
      analysisReady: row.analysis_ready,
      finalizedAt: row.finalized_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
      state: toObject(row.state),
      messages: messagesByConversation.get(row.id) ?? [],
      draft: latestDraftByConversation.get(row.id) ?? null,
    })
    conversationsByProject.set(row.project_id, conversations)
  }

  const projects = ((projectResult.data ?? []) as ProjectRow[]).map((row): WorkspaceProjectDto => {
    const conversations = conversationsByProject.get(row.id) ?? []
    const activeConversationId = conversations.some(
      (conversation) => conversation.id === row.active_conversation_id,
    )
      ? row.active_conversation_id
      : conversations[0]?.id ?? null

    return {
      id: row.id,
      name: row.name,
      folderId: row.default_folder_id,
      activeConversationId,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      conversations,
    }
  })

  return {
    ok: true,
    projects,
    feedbackMemories: ((memoryResult.data ?? []) as FeedbackMemoryRow[]).map(
      toFeedbackMemoryDto,
    ),
  }
}

export async function syncWorkspace(
  config: AppConfig,
  user: User,
  input: SyncWorkspaceRequest,
) {
  const supabase = getAdminClient(config)
  const now = new Date().toISOString()
  const projects = input.projects
  const conversations = projects.flatMap((project) =>
    project.conversations.map((conversation) => ({ project, conversation })),
  )
  const messages = conversations.flatMap(({ conversation }) =>
    conversation.messages.map((message) => ({ conversation, message })),
  )
  const projectIds = projects.map((project) => project.id)
  const conversationIds = conversations.map(({ conversation }) => conversation.id)
  const messageIds = messages.map(({ message }) => message.id)
  const folderIds = Array.from(
    new Set(projects.flatMap((project) => (project.folderId ? [project.folderId] : []))),
  )

  for (const project of projects) {
    const projectConversationIds = new Set(
      project.conversations.map((conversation) => conversation.id),
    )
    if (
      project.activeConversationId &&
      !projectConversationIds.has(project.activeConversationId)
    ) {
      throw new WorkspaceOwnershipError('Active conversation is not part of its project.')
    }
  }

  await Promise.all([
    assertOwnedIds(supabase, 'projects', user, projectIds),
    assertOwnedIds(supabase, 'conversations', user, conversationIds),
    assertOwnedIds(supabase, 'chat_messages', user, messageIds),
    assertOwnedFolderIds(supabase, user, folderIds),
  ])

  if (projects.length > 0) {
    const { error } = await supabase.from('projects').upsert(
      projects.map((project) => ({
        id: project.id,
        user_id: user.id,
        name: project.name,
        default_folder_id: project.folderId,
        active_conversation_id: null,
        created_at: project.createdAt ?? now,
        updated_at: project.updatedAt,
        deleted_at: null,
      })),
      { onConflict: 'id' },
    )
    assertNoDatabaseError(error)
  }

  if (conversations.length > 0) {
    const { error } = await supabase.from('conversations').upsert(
      conversations.map(({ project, conversation }) => ({
        id: conversation.id,
        user_id: user.id,
        project_id: project.id,
        title: conversation.title,
        step: conversation.step,
        pinned: conversation.pinned,
        selected_reference_ids: conversation.selectedReferenceIds,
        length: conversation.length,
        topic: conversation.topic,
        target_audience: conversation.targetAudience,
        analysis_ready: conversation.analysisReady,
        finalized_at: conversation.finalizedAt,
        state: conversation.state,
        created_at: conversation.createdAt ?? now,
        updated_at: conversation.updatedAt,
        last_opened_at: conversation.lastOpenedAt,
        deleted_at: null,
      })),
      { onConflict: 'id' },
    )
    assertNoDatabaseError(error)

    const existingMessagesResult = await supabase
      .from('chat_messages')
      .select('id')
      .eq('user_id', user.id)
      .in('conversation_id', conversationIds)
    assertNoDatabaseError(existingMessagesResult.error)

    if (messages.length > 0) {
      const upsertMessagesResult = await supabase.from('chat_messages').upsert(
        messages.map(({ conversation, message }) => ({
          id: message.id,
          user_id: user.id,
          conversation_id: conversation.id,
          channel: message.channel,
          role: message.role,
          content: message.content,
          created_at: message.createdAt ?? now,
        })),
        { onConflict: 'id' },
      )
      assertNoDatabaseError(upsertMessagesResult.error)
    }

    const incomingMessageIds = new Set(messageIds)
    const removedMessageIds = (
      (existingMessagesResult.data ?? []) as Array<{ id: string }>
    )
      .map((row) => row.id)
      .filter((id) => !incomingMessageIds.has(id))
    if (removedMessageIds.length > 0) {
      const deleteMessagesResult = await supabase
        .from('chat_messages')
        .delete()
        .eq('user_id', user.id)
        .in('id', removedMessageIds)
      assertNoDatabaseError(deleteMessagesResult.error)
    }

    for (const { conversation } of conversations) {
      if (conversation.draft) {
        const draftResult = await supabase.from('drafts').upsert(
          {
            user_id: user.id,
            conversation_id: conversation.id,
            version: 1,
            title: conversation.draft.title,
            body: conversation.draft.body,
            source: conversation.draft.source,
          },
          { onConflict: 'conversation_id,version' },
        )
        assertNoDatabaseError(draftResult.error)
      } else {
        const draftResult = await supabase
          .from('drafts')
          .delete()
          .eq('user_id', user.id)
          .eq('conversation_id', conversation.id)
          .eq('version', 1)
        assertNoDatabaseError(draftResult.error)
      }
    }

    const activeConversationResult = await Promise.all(
      projects.map((project) =>
        supabase
          .from('projects')
          .update({ active_conversation_id: project.activeConversationId })
          .eq('user_id', user.id)
          .eq('id', project.id),
      ),
    )
    for (const result of activeConversationResult) assertNoDatabaseError(result.error)
  }

  const existingConversationResult = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', user.id)
    .is('deleted_at', null)
  assertNoDatabaseError(existingConversationResult.error)

  const missingConversationIds = ((existingConversationResult.data ?? []) as Array<{ id: string }>)
    .map((row) => row.id)
    .filter((id) => !conversationIds.includes(id))
  if (missingConversationIds.length > 0) {
    const { error } = await supabase
      .from('conversations')
      .update({ deleted_at: now })
      .eq('user_id', user.id)
      .in('id', missingConversationIds)
    assertNoDatabaseError(error)
  }

  const existingProjectResult = await supabase
    .from('projects')
    .select('id')
    .eq('user_id', user.id)
    .is('deleted_at', null)
  assertNoDatabaseError(existingProjectResult.error)

  const missingProjectIds = ((existingProjectResult.data ?? []) as Array<{ id: string }>)
    .map((row) => row.id)
    .filter((id) => !projectIds.includes(id))
  if (missingProjectIds.length > 0) {
    const { error } = await supabase
      .from('projects')
      .update({ deleted_at: now, active_conversation_id: null })
      .eq('user_id', user.id)
      .in('id', missingProjectIds)
    assertNoDatabaseError(error)
  }

  return { ok: true as const, syncedAt: now }
}

export async function createFeedbackMemory(
  config: AppConfig,
  user: User,
  input: CreateFeedbackMemoryRequest,
): Promise<FeedbackMemoryDto> {
  const supabase = getAdminClient(config)

  await Promise.all([
    assertOwnedIds(supabase, 'projects', user, input.projectId ? [input.projectId] : []),
    assertOwnedIds(
      supabase,
      'conversations',
      user,
      input.conversationId ? [input.conversationId] : [],
    ),
    assertOwnedIds(supabase, 'drafts', user, input.draftId ? [input.draftId] : []),
  ])

  const { data, error } = await supabase
    .from('feedback_memories')
    .insert({
      user_id: user.id,
      project_id: input.projectId ?? null,
      conversation_id: input.conversationId ?? null,
      draft_id: input.draftId ?? null,
      type: input.type,
      content: input.content,
      context: input.context ?? {},
      source: input.source ?? 'explicit_user_action',
    })
    .select(feedbackMemoryColumns)
    .single()

  assertNoDatabaseError(error)
  return toFeedbackMemoryDto(data as FeedbackMemoryRow)
}
