import type { User } from '@supabase/supabase-js'
import {
  normalizeNoteUrl,
  type AiUsage,
  type CreateFolderRequest,
  type CreateSnippetRequest,
  type FolderDto,
  type NoteDto,
  type SnippetDto,
  type UpsertNoteRequest,
} from '@lumos-ai/shared'
import type { AppConfig } from './env.js'
import { createSupabaseAdminClient } from './supabase.js'

type DatabaseError = {
  code?: string
  message?: string
}

type FolderRow = {
  id: string
  name: string
  updated_at: string
}

type FolderNameRow = {
  id: string
  name: string
}

type NoteRow = {
  id: string
  folder_id: string | null
  title: string
  filename: string
  author_name: string | null
  source_url: string
  cover_image_url: string | null
  content_text: string | null
  created_at: string
  updated_at: string
}

type NoteLookupRow = {
  id: string
  source_url: string
  title: string
  author_name: string | null
}

type SnippetRow = {
  id: string
  note_id: string | null
  selected_text: string
  reason_text: string | null
  color_value: string | null
  color_tag_name: string | null
  created_at: string
}

type RecordAiRunInput = {
  taskType: string
  provider: string
  model: string
  status: 'succeeded' | 'failed'
  usage?: AiUsage | null
  latencyMs?: number
  errorCode?: string
  errorMessage?: string
}

export class SupabaseSchemaMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseSchemaMissingError'
  }
}

function assertNoDatabaseError(error: DatabaseError | null) {
  if (!error) return
  if (error.code === '42P01' || error.code === 'PGRST205') {
    throw new SupabaseSchemaMissingError('Supabase schema has not been installed yet.')
  }
  throw new Error(error.message || 'Supabase request failed.')
}

function getAdminClient(config: AppConfig) {
  const supabase = createSupabaseAdminClient(config)
  if (!supabase) {
    throw new SupabaseSchemaMissingError('Supabase service role key is not configured.')
  }
  return supabase
}

function toFolderDto(folder: FolderRow, noteCount = 0): FolderDto {
  return {
    id: folder.id,
    name: folder.name,
    noteCount,
    updatedAt: folder.updated_at,
  }
}

function toNoteDto(note: NoteRow, folderName = ''): NoteDto {
  return {
    id: note.id,
    folderId: note.folder_id ?? '',
    folderName,
    filename: note.filename,
    title: note.title,
    authorName: note.author_name ?? '',
    sourceUrl: note.source_url,
    coverImageUrl: note.cover_image_url ?? '',
    contentText: note.content_text ?? '',
    savedAt: note.created_at || note.updated_at,
  }
}

function toSnippetDto(
  snippet: SnippetRow,
  note?: { source_url: string; title: string; author_name: string | null } | null,
): SnippetDto {
  return {
    id: snippet.id,
    noteUrl: note?.source_url ?? '',
    noteTitle: note?.title ?? '',
    noteAuthorName: note?.author_name ?? '',
    selectedText: snippet.selected_text,
    reasonText: snippet.reason_text ?? '',
    colorTagName: snippet.color_tag_name ?? '',
    colorValue: snippet.color_value ?? '',
    createdAt: snippet.created_at,
  }
}

export async function upsertUserProfile(config: AppConfig, user: User): Promise<void> {
  const supabase = getAdminClient(config)
  const metadata = user.user_metadata ?? {}
  const displayName =
    typeof metadata.name === 'string'
      ? metadata.name
      : typeof metadata.full_name === 'string'
        ? metadata.full_name
        : null
  const avatarUrl = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null

  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      email: user.email ?? null,
      display_name: displayName,
      avatar_url: avatarUrl,
    },
    { onConflict: 'id' },
  )

  assertNoDatabaseError(error)
}

export async function createFolder(
  config: AppConfig,
  user: User,
  input: CreateFolderRequest,
): Promise<FolderDto> {
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('folders')
    .insert({
      user_id: user.id,
      name: input.name,
    })
    .select('id,name,updated_at')
    .single()

  assertNoDatabaseError(error)

  return toFolderDto(data as FolderRow, 0)
}

export async function listFolders(config: AppConfig, user: User): Promise<FolderDto[]> {
  const supabase = getAdminClient(config)
  const [folderResult, noteResult] = await Promise.all([
    supabase
      .from('folders')
      .select('id,name,updated_at')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),
    supabase
      .from('notes')
      .select('folder_id')
      .eq('user_id', user.id)
      .is('deleted_at', null),
  ])

  assertNoDatabaseError(folderResult.error)
  assertNoDatabaseError(noteResult.error)

  const noteCounts = new Map<string, number>()
  for (const note of (noteResult.data ?? []) as Array<{ folder_id: string | null }>) {
    if (!note.folder_id) continue
    noteCounts.set(note.folder_id, (noteCounts.get(note.folder_id) ?? 0) + 1)
  }

  return ((folderResult.data ?? []) as FolderRow[]).map((folder) =>
    toFolderDto(folder, noteCounts.get(folder.id) ?? 0),
  )
}

export async function upsertNote(
  config: AppConfig,
  user: User,
  input: UpsertNoteRequest,
): Promise<NoteDto> {
  const supabase = getAdminClient(config)
  const normalizedSourceUrl = normalizeNoteUrl(input.sourceUrl)
  const folderId = input.folderId || null
  let folderName = ''

  if (folderId) {
    const folderResult = await supabase
      .from('folders')
      .select('id,name')
      .eq('user_id', user.id)
      .eq('id', folderId)
      .is('deleted_at', null)
      .maybeSingle()

    assertNoDatabaseError(folderResult.error)
    folderName = ((folderResult.data as FolderNameRow | null) ?? null)?.name ?? ''
  }

  const { data, error } = await supabase
    .from('notes')
    .upsert(
      {
        user_id: user.id,
        folder_id: folderId,
        filename: input.filename,
        title: input.title,
        author_name: input.authorName ?? null,
        source_url: input.sourceUrl,
        normalized_source_url: normalizedSourceUrl,
        cover_image_url: input.coverImageUrl ?? null,
        content_text: input.contentText ?? null,
        captured_at: input.savedAt ?? new Date().toISOString(),
      },
      {
        onConflict: 'user_id,normalized_source_url',
      },
    )
    .select(
      'id,folder_id,title,filename,author_name,source_url,cover_image_url,content_text,created_at,updated_at',
    )
    .single()

  assertNoDatabaseError(error)

  return toNoteDto(data as NoteRow, folderName)
}

export async function listNotes(config: AppConfig, user: User): Promise<NoteDto[]> {
  const supabase = getAdminClient(config)
  const [noteResult, folderResult] = await Promise.all([
    supabase
      .from('notes')
      .select(
        'id,folder_id,title,filename,author_name,source_url,cover_image_url,content_text,created_at,updated_at',
      )
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),
    supabase.from('folders').select('id,name').eq('user_id', user.id),
  ])

  assertNoDatabaseError(noteResult.error)
  assertNoDatabaseError(folderResult.error)

  const folderNames = new Map<string, string>()
  for (const folder of (folderResult.data ?? []) as Array<{ id: string; name: string }>) {
    folderNames.set(folder.id, folder.name)
  }

  return ((noteResult.data ?? []) as NoteRow[]).map((note) =>
    toNoteDto(note, note.folder_id ? (folderNames.get(note.folder_id) ?? '') : ''),
  )
}

export async function createSnippet(
  config: AppConfig,
  user: User,
  input: CreateSnippetRequest,
): Promise<SnippetDto> {
  const supabase = getAdminClient(config)
  let note: NoteLookupRow | null = null

  if (input.noteId) {
    const noteResult = await supabase
      .from('notes')
      .select('id,source_url,title,author_name')
      .eq('user_id', user.id)
      .eq('id', input.noteId)
      .is('deleted_at', null)
      .maybeSingle()

    assertNoDatabaseError(noteResult.error)
    note = noteResult.data as NoteLookupRow | null
  } else if (input.noteUrl) {
    const noteResult = await supabase
      .from('notes')
      .select('id,source_url,title,author_name')
      .eq('user_id', user.id)
      .eq('normalized_source_url', normalizeNoteUrl(input.noteUrl))
      .is('deleted_at', null)
      .maybeSingle()

    assertNoDatabaseError(noteResult.error)
    note = noteResult.data as NoteLookupRow | null
  }

  const { data, error } = await supabase
    .from('snippets')
    .insert({
      user_id: user.id,
      note_id: note?.id ?? null,
      selected_text: input.selectedText,
      reason_text: input.reasonText ?? null,
      color_value: input.colorValue ?? null,
      color_tag_name: input.colorTagName ?? null,
      created_at: input.createdAt ?? new Date().toISOString(),
    })
    .select('id,note_id,selected_text,reason_text,color_value,color_tag_name,created_at')
    .single()

  assertNoDatabaseError(error)

  return toSnippetDto(data as SnippetRow, note)
}

export async function listSnippets(config: AppConfig, user: User): Promise<SnippetDto[]> {
  const supabase = getAdminClient(config)
  const [snippetResult, noteResult] = await Promise.all([
    supabase
      .from('snippets')
      .select('id,note_id,selected_text,reason_text,color_value,color_tag_name,created_at')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('notes')
      .select('id,source_url,title,author_name')
      .eq('user_id', user.id)
      .is('deleted_at', null),
  ])

  assertNoDatabaseError(snippetResult.error)
  assertNoDatabaseError(noteResult.error)

  const notes = new Map<string, { source_url: string; title: string; author_name: string | null }>()
  for (const note of (noteResult.data ?? []) as Array<{
    id: string
    source_url: string
    title: string
    author_name: string | null
  }>) {
    notes.set(note.id, note)
  }

  return ((snippetResult.data ?? []) as SnippetRow[]).map((snippet) =>
    toSnippetDto(snippet, snippet.note_id ? notes.get(snippet.note_id) : null),
  )
}

export async function recordAiRun(
  config: AppConfig,
  user: User,
  input: RecordAiRunInput,
): Promise<void> {
  const supabase = getAdminClient(config)
  const { error } = await supabase.from('ai_runs').insert({
    user_id: user.id,
    conversation_id: null,
    task_type: input.taskType,
    provider: input.provider,
    model: input.model,
    status: input.status,
    input_token_count: input.usage?.promptTokens ?? null,
    output_token_count: input.usage?.completionTokens ?? null,
    cost_estimate_cny: null,
    latency_ms: input.latencyMs ?? null,
    prompt_hash: null,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    finished_at: new Date().toISOString(),
  })

  assertNoDatabaseError(error)
}
