import type { User } from '@supabase/supabase-js'
import {
  assessNoteLearningQuality,
  normalizeNoteUrl,
  type AiUsage,
  type CreateFolderRequest,
  type CreateSnippetRequest,
  type FolderDto,
  type NoteDto,
  type NoteLearningStatus,
  type NoteQualityFlag,
  type SnippetDto,
  type SyncAnnotationRequest,
  type TrashFolderGroup,
  type UpdateFolderRequest,
  type UpdateNoteRequest,
  type UpdateNoteLearningStatusRequest,
  type UpdateSnippetRequest,
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

type TrashFolderRow = FolderRow & {
  deleted_at: string | null
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
  learning_status: NoteLearningStatus
  quality_flags: NoteQualityFlag[] | null
  learning_reviewed_at: string | null
  created_at: string
  updated_at: string
}

type NoteLookupRow = {
  id: string
  source_url: string
  title: string
  author_name: string | null
  deleted_at?: string | null
}

type TrashNoteRow = NoteRow & {
  deleted_at: string | null
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

const noteSelectColumns =
  'id,folder_id,title,filename,author_name,source_url,cover_image_url,content_text,learning_status,quality_flags,learning_reviewed_at,created_at,updated_at'
const snippetSelectColumns = 'id,note_id,selected_text,reason_text,color_value,color_tag_name,created_at'

type RecordAiRunInput = {
  taskType: string
  provider: string
  model: string
  status: 'succeeded' | 'failed'
  usage?: AiUsage | null
  promptHash?: string
  costEstimateCny?: number | null
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

export type LibraryVersionConflictResource =
  | {
      type: 'folder'
      id: string
      name: string
      updatedAt: string
    }
  | {
      type: 'note'
      id: string
      filename: string
      title: string
      updatedAt: string
    }

export class LibraryVersionConflictError extends Error {
  constructor(readonly resource: LibraryVersionConflictResource) {
    super('Library resource has changed since it was loaded.')
    this.name = 'LibraryVersionConflictError'
  }
}

function assertNoDatabaseError(error: DatabaseError | null) {
  if (!error) return
  if (
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    error.code === 'PGRST205'
  ) {
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
  const assessedQualityFlags = assessNoteLearningQuality({
    title: note.title,
    contentText: note.content_text ?? '',
    folderName,
  })
  const qualityFlags = note.learning_reviewed_at
    ? (note.quality_flags ?? assessedQualityFlags)
    : assessedQualityFlags
  const learningStatus = note.learning_reviewed_at
    ? note.learning_status
    : qualityFlags.length > 0
      ? 'pending_review'
      : 'ready'

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
    updatedAt: note.updated_at,
    learningStatus,
    qualityFlags,
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

function getLatestIso(left: string, right: string) {
  const leftTime = new Date(left).getTime()
  const rightTime = new Date(right).getTime()
  if (Number.isNaN(leftTime)) return right
  if (Number.isNaN(rightTime)) return left
  return leftTime > rightTime ? left : right
}

function assertSingleMutation(data: unknown, resourceName: string) {
  if (!data) {
    throw new Error(`${resourceName} not found.`)
  }
}

async function getNoteIdsForFolder(
  supabase: ReturnType<typeof getAdminClient>,
  user: User,
  folderId: string,
) {
  const noteResult = await supabase
    .from('notes')
    .select('id')
    .eq('user_id', user.id)
    .eq('folder_id', folderId)

  assertNoDatabaseError(noteResult.error)

  return ((noteResult.data ?? []) as Array<{ id: string }>).map((note) => note.id)
}

async function softDeleteSnippetsForNotes(
  supabase: ReturnType<typeof getAdminClient>,
  user: User,
  noteIds: string[],
  deletedAt: string,
) {
  if (noteIds.length === 0) return

  const snippetResult = await supabase
    .from('snippets')
    .update({ deleted_at: deletedAt })
    .eq('user_id', user.id)
    .in('note_id', noteIds)
    .is('deleted_at', null)

  assertNoDatabaseError(snippetResult.error)
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

export async function updateFolder(
  config: AppConfig,
  user: User,
  folderId: string,
  input: UpdateFolderRequest,
): Promise<FolderDto> {
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('folders')
    .update({ name: input.name })
    .eq('user_id', user.id)
    .eq('id', folderId)
    .is('deleted_at', null)
    .eq('updated_at', input.expectedUpdatedAt)
    .select('id,name,updated_at')
    .maybeSingle()

  assertNoDatabaseError(error)

  if (!data) {
    const currentResult = await supabase
      .from('folders')
      .select('id,name,updated_at')
      .eq('user_id', user.id)
      .eq('id', folderId)
      .is('deleted_at', null)
      .maybeSingle()

    assertNoDatabaseError(currentResult.error)
    const current = currentResult.data as FolderRow | null
    if (!current) throw new Error('Folder not found.')
    throw new LibraryVersionConflictError({
      type: 'folder',
      id: current.id,
      name: current.name,
      updatedAt: current.updated_at,
    })
  }

  const noteResult = await supabase
    .from('notes')
    .select('id')
    .eq('user_id', user.id)
    .eq('folder_id', folderId)
    .is('deleted_at', null)

  assertNoDatabaseError(noteResult.error)

  return toFolderDto(data as FolderRow, noteResult.data?.length ?? 0)
}

export async function deleteFolder(
  config: AppConfig,
  user: User,
  folderId: string,
): Promise<void> {
  const supabase = getAdminClient(config)
  const existingResult = await supabase
    .from('folders')
    .select('id,deleted_at')
    .eq('user_id', user.id)
    .eq('id', folderId)
    .maybeSingle()

  assertNoDatabaseError(existingResult.error)
  const existing = existingResult.data as { id: string; deleted_at: string | null } | null
  if (!existing) throw new Error('Folder not found.')

  const deletedAt = existing.deleted_at ?? new Date().toISOString()
  if (!existing.deleted_at) {
    const { data, error } = await supabase
      .from('folders')
      .update({ deleted_at: deletedAt })
      .eq('user_id', user.id)
      .eq('id', folderId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()

    assertNoDatabaseError(error)
    assertSingleMutation(data, 'Folder')
  }

  const noteIds = await getNoteIdsForFolder(supabase, user, folderId)
  if (noteIds.length > 0) {
    const noteResult = await supabase
      .from('notes')
      .update({ deleted_at: deletedAt })
      .eq('user_id', user.id)
      .eq('folder_id', folderId)
      .is('deleted_at', null)

    assertNoDatabaseError(noteResult.error)
    await softDeleteSnippetsForNotes(supabase, user, noteIds, deletedAt)
  }
}

export async function restoreFolder(
  config: AppConfig,
  user: User,
  folderId: string,
): Promise<void> {
  const supabase = getAdminClient(config)
  const existingResult = await supabase
    .from('folders')
    .select('id,deleted_at')
    .eq('user_id', user.id)
    .eq('id', folderId)
    .maybeSingle()

  assertNoDatabaseError(existingResult.error)
  const existing = existingResult.data as { id: string; deleted_at: string | null } | null
  if (!existing) throw new Error('Folder not found.')

  if (existing.deleted_at) {
    const { data, error } = await supabase
      .from('folders')
      .update({ deleted_at: null })
      .eq('user_id', user.id)
      .eq('id', folderId)
      .not('deleted_at', 'is', null)
      .select('id')
      .maybeSingle()

    assertNoDatabaseError(error)
    assertSingleMutation(data, 'Folder')
  }

  const noteIds = await getNoteIdsForFolder(supabase, user, folderId)
  if (noteIds.length === 0) return

  const [noteResult, snippetResult] = await Promise.all([
    supabase
      .from('notes')
      .update({ deleted_at: null })
      .eq('user_id', user.id)
      .eq('folder_id', folderId)
      .not('deleted_at', 'is', null),
    supabase
      .from('snippets')
      .update({ deleted_at: null })
      .eq('user_id', user.id)
      .in('note_id', noteIds)
      .not('deleted_at', 'is', null),
  ])

  assertNoDatabaseError(noteResult.error)
  assertNoDatabaseError(snippetResult.error)
}

export async function deleteFolderPermanently(
  config: AppConfig,
  user: User,
  folderId: string,
): Promise<void> {
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('folders')
    .select('id')
    .eq('user_id', user.id)
    .eq('id', folderId)
    .not('deleted_at', 'is', null)
    .maybeSingle()

  assertNoDatabaseError(error)
  assertSingleMutation(data, 'Folder')

  const noteIds = await getNoteIdsForFolder(supabase, user, folderId)
  if (noteIds.length > 0) {
    const snippetResult = await supabase
      .from('snippets')
      .delete()
      .eq('user_id', user.id)
      .in('note_id', noteIds)

    assertNoDatabaseError(snippetResult.error)

    const noteResult = await supabase
      .from('notes')
      .delete()
      .eq('user_id', user.id)
      .eq('folder_id', folderId)

    assertNoDatabaseError(noteResult.error)
  }

  const folderResult = await supabase
    .from('folders')
    .delete()
    .eq('user_id', user.id)
    .eq('id', folderId)

  assertNoDatabaseError(folderResult.error)
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

  const existingResult = await supabase
    .from('notes')
    .select(
      'id,folder_id,title,content_text,learning_status,quality_flags,learning_reviewed_at',
    )
    .eq('user_id', user.id)
    .eq('normalized_source_url', normalizedSourceUrl)
    .maybeSingle()

  assertNoDatabaseError(existingResult.error)

  const existingNote = existingResult.data as
    | Pick<
        NoteRow,
        | 'id'
        | 'folder_id'
        | 'title'
        | 'content_text'
        | 'learning_status'
        | 'quality_flags'
        | 'learning_reviewed_at'
      >
    | null
  const contentText = input.contentText ?? ''
  const noteContentChanged =
    !existingNote ||
    existingNote.title !== input.title ||
    (existingNote.content_text ?? '') !== contentText ||
    existingNote.folder_id !== folderId
  const assessedQualityFlags = assessNoteLearningQuality({
    title: input.title,
    contentText,
    folderName,
  })
  const learningStatus: NoteLearningStatus = noteContentChanged
    ? assessedQualityFlags.length > 0
      ? 'pending_review'
      : 'ready'
    : existingNote.learning_status
  const qualityFlags = noteContentChanged
    ? assessedQualityFlags
    : (existingNote.quality_flags ?? assessedQualityFlags)
  const learningReviewedAt = noteContentChanged ? null : existingNote.learning_reviewed_at

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
        learning_status: learningStatus,
        quality_flags: qualityFlags,
        learning_reviewed_at: learningReviewedAt,
        captured_at: input.savedAt ?? new Date().toISOString(),
      },
      {
        onConflict: 'user_id,normalized_source_url',
      },
    )
    .select(noteSelectColumns)
    .single()

  assertNoDatabaseError(error)

  return toNoteDto(data as NoteRow, folderName)
}

export async function listNotes(config: AppConfig, user: User): Promise<NoteDto[]> {
  const supabase = getAdminClient(config)
  const [noteResult, folderResult] = await Promise.all([
    supabase
      .from('notes')
      .select(noteSelectColumns)
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

export async function updateNote(
  config: AppConfig,
  user: User,
  noteId: string,
  input: UpdateNoteRequest,
): Promise<NoteDto> {
  const supabase = getAdminClient(config)
  const { expectedUpdatedAt, ...updates } = input
  const { data, error } = await supabase
    .from('notes')
    .update(updates)
    .eq('user_id', user.id)
    .eq('id', noteId)
    .is('deleted_at', null)
    .eq('updated_at', expectedUpdatedAt)
    .select(noteSelectColumns)
    .maybeSingle()

  assertNoDatabaseError(error)
  if (!data) {
    const currentResult = await supabase
      .from('notes')
      .select('id,filename,title,updated_at')
      .eq('user_id', user.id)
      .eq('id', noteId)
      .is('deleted_at', null)
      .maybeSingle()

    assertNoDatabaseError(currentResult.error)
    const current = currentResult.data as
      | { id: string; filename: string; title: string; updated_at: string }
      | null
    if (!current) throw new Error('Note not found.')
    throw new LibraryVersionConflictError({
      type: 'note',
      id: current.id,
      filename: current.filename,
      title: current.title,
      updatedAt: current.updated_at,
    })
  }

  const note = data as NoteRow
  let folderName = ''
  if (note.folder_id) {
    const folderResult = await supabase
      .from('folders')
      .select('id,name')
      .eq('user_id', user.id)
      .eq('id', note.folder_id)
      .maybeSingle()
    assertNoDatabaseError(folderResult.error)
    folderName = ((folderResult.data as FolderNameRow | null) ?? null)?.name ?? ''
  }

  return toNoteDto(note, folderName)
}

export async function updateNoteLearningStatus(
  config: AppConfig,
  user: User,
  noteId: string,
  input: UpdateNoteLearningStatusRequest,
): Promise<void> {
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('notes')
    .update({
      learning_status: input.status,
      learning_reviewed_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .eq('id', noteId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  assertNoDatabaseError(error)
  assertSingleMutation(data, 'Note')
}

export async function deleteNote(
  config: AppConfig,
  user: User,
  noteId: string,
): Promise<void> {
  const supabase = getAdminClient(config)
  const existingResult = await supabase
    .from('notes')
    .select('id,deleted_at')
    .eq('user_id', user.id)
    .eq('id', noteId)
    .maybeSingle()

  assertNoDatabaseError(existingResult.error)
  const existing = existingResult.data as { id: string; deleted_at: string | null } | null
  if (!existing) throw new Error('Note not found.')

  const deletedAt = existing.deleted_at ?? new Date().toISOString()
  if (!existing.deleted_at) {
    const noteResult = await supabase
      .from('notes')
      .update({ deleted_at: deletedAt })
      .eq('user_id', user.id)
      .eq('id', noteId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()

    assertNoDatabaseError(noteResult.error)
    assertSingleMutation(noteResult.data, 'Note')
  }

  const snippetResult = await supabase
    .from('snippets')
    .update({ deleted_at: deletedAt })
    .eq('user_id', user.id)
    .eq('note_id', noteId)
    .is('deleted_at', null)

  assertNoDatabaseError(snippetResult.error)
}

export async function restoreNote(
  config: AppConfig,
  user: User,
  noteId: string,
): Promise<void> {
  const supabase = getAdminClient(config)
  const noteResult = await supabase
    .from('notes')
    .select('id,folder_id,deleted_at')
    .eq('user_id', user.id)
    .eq('id', noteId)
    .maybeSingle()

  assertNoDatabaseError(noteResult.error)
  const note = noteResult.data as {
    id: string
    folder_id: string | null
    deleted_at: string | null
  } | null
  assertSingleMutation(note, 'Note')

  if (note?.folder_id) {
    const folderResult = await supabase
      .from('folders')
      .update({ deleted_at: null })
      .eq('user_id', user.id)
      .eq('id', note.folder_id)
      .not('deleted_at', 'is', null)

    assertNoDatabaseError(folderResult.error)
  }

  const [restoredNoteResult, snippetResult] = await Promise.all([
    supabase
      .from('notes')
      .update({ deleted_at: null })
      .eq('user_id', user.id)
      .eq('id', noteId),
    supabase
      .from('snippets')
      .update({ deleted_at: null })
      .eq('user_id', user.id)
      .eq('note_id', noteId)
      .not('deleted_at', 'is', null),
  ])

  assertNoDatabaseError(restoredNoteResult.error)
  assertNoDatabaseError(snippetResult.error)
}

export async function deleteNotePermanently(
  config: AppConfig,
  user: User,
  noteId: string,
): Promise<void> {
  const supabase = getAdminClient(config)
  const noteResult = await supabase
    .from('notes')
    .select('id')
    .eq('user_id', user.id)
    .eq('id', noteId)
    .not('deleted_at', 'is', null)
    .maybeSingle()

  assertNoDatabaseError(noteResult.error)
  assertSingleMutation(noteResult.data, 'Note')

  const [snippetResult, deleteResult] = await Promise.all([
    supabase.from('snippets').delete().eq('user_id', user.id).eq('note_id', noteId),
    supabase.from('notes').delete().eq('user_id', user.id).eq('id', noteId),
  ])

  assertNoDatabaseError(snippetResult.error)
  assertNoDatabaseError(deleteResult.error)
}

export async function emptyTrash(config: AppConfig, user: User): Promise<void> {
  const supabase = getAdminClient(config)
  const [deletedNotesResult, deletedFoldersResult] = await Promise.all([
    supabase.from('notes').select('id').eq('user_id', user.id).not('deleted_at', 'is', null),
    supabase.from('folders').select('id').eq('user_id', user.id).not('deleted_at', 'is', null),
  ])

  assertNoDatabaseError(deletedNotesResult.error)
  assertNoDatabaseError(deletedFoldersResult.error)

  const deletedNoteIds = ((deletedNotesResult.data ?? []) as Array<{ id: string }>).map(
    (note) => note.id,
  )
  const deletedFolderIds = ((deletedFoldersResult.data ?? []) as Array<{ id: string }>).map(
    (folder) => folder.id,
  )

  if (deletedNoteIds.length > 0) {
    const snippetResult = await supabase
      .from('snippets')
      .delete()
      .eq('user_id', user.id)
      .in('note_id', deletedNoteIds)
    assertNoDatabaseError(snippetResult.error)
  }

  const deletedSnippetResult = await supabase
    .from('snippets')
    .delete()
    .eq('user_id', user.id)
    .not('deleted_at', 'is', null)
  assertNoDatabaseError(deletedSnippetResult.error)

  if (deletedNoteIds.length > 0) {
    const noteResult = await supabase.from('notes').delete().eq('user_id', user.id).in('id', deletedNoteIds)
    assertNoDatabaseError(noteResult.error)
  }

  if (deletedFolderIds.length > 0) {
    const folderResult = await supabase.from('folders').delete().eq('user_id', user.id).in('id', deletedFolderIds)
    assertNoDatabaseError(folderResult.error)
  }
}

export async function listTrash(config: AppConfig, user: User): Promise<TrashFolderGroup[]> {
  const supabase = getAdminClient(config)
  const [folderResult, noteResult, snippetResult] = await Promise.all([
    supabase.from('folders').select('id,name,updated_at,deleted_at').eq('user_id', user.id),
    supabase
      .from('notes')
      .select(`${noteSelectColumns},deleted_at`)
      .eq('user_id', user.id)
      .not('deleted_at', 'is', null),
    supabase
      .from('snippets')
      .select(snippetSelectColumns)
      .eq('user_id', user.id)
      .not('deleted_at', 'is', null),
  ])

  assertNoDatabaseError(folderResult.error)
  assertNoDatabaseError(noteResult.error)
  assertNoDatabaseError(snippetResult.error)

  const folders = new Map<string, TrashFolderRow>()
  for (const folder of (folderResult.data ?? []) as TrashFolderRow[]) {
    folders.set(folder.id, folder)
  }

  const snippetsByNoteId = new Map<string, SnippetRow[]>()
  for (const snippet of (snippetResult.data ?? []) as SnippetRow[]) {
    if (!snippet.note_id) continue
    snippetsByNoteId.set(snippet.note_id, [...(snippetsByNoteId.get(snippet.note_id) ?? []), snippet])
  }

  const groups = new Map<string, TrashFolderGroup>()
  for (const folder of folders.values()) {
    if (!folder.deleted_at) continue
    groups.set(`deleted-folder-${folder.id}`, {
      id: `deleted-folder-${folder.id}`,
      folderId: folder.id,
      folderName: folder.name,
      deletedAt: folder.deleted_at,
      folderDeleted: true,
      notes: [],
    })
  }

  for (const note of (noteResult.data ?? []) as TrashNoteRow[]) {
    const folder = note.folder_id ? folders.get(note.folder_id) : null
    const folderDeleted = Boolean(folder?.deleted_at)
    const groupId = folderDeleted
      ? `deleted-folder-${folder?.id ?? note.folder_id}`
      : `note-folder-${folder?.id ?? note.folder_id ?? 'unknown'}`
    const deletedAt = note.deleted_at ?? note.updated_at
    const existingGroup = groups.get(groupId)
    const folderName = folder?.name ?? '原文件夹未知'
    const group =
      existingGroup ??
      ({
        id: groupId,
        folderId: folder?.id ?? note.folder_id ?? '',
        folderName,
        deletedAt,
        folderDeleted,
        notes: [],
      } satisfies TrashFolderGroup)

    group.deletedAt = getLatestIso(group.deletedAt, deletedAt)
    group.notes.push({
      id: folderDeleted ? `${folder?.id ?? 'folder'}-${note.id}` : note.id,
      trashItemId: folderDeleted ? (folder?.id ?? note.folder_id ?? note.id) : note.id,
      source: folderDeleted ? 'folder' : 'note',
      deletedAt,
      note: toNoteDto(note, folderName),
      snippets: (snippetsByNoteId.get(note.id) ?? []).map((snippet) => toSnippetDto(snippet, note)),
    })
    groups.set(groupId, group)
  }

  return Array.from(groups.values()).sort(
    (left, right) => new Date(right.deletedAt).getTime() - new Date(left.deletedAt).getTime(),
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
      .select('id,source_url,title,author_name,deleted_at')
      .eq('user_id', user.id)
      .eq('id', input.noteId)
      .maybeSingle()

    assertNoDatabaseError(noteResult.error)
    note = noteResult.data as NoteLookupRow | null
  } else if (input.noteUrl) {
    const noteResult = await supabase
      .from('notes')
      .select('id,source_url,title,author_name,deleted_at')
      .eq('user_id', user.id)
      .eq('normalized_source_url', normalizeNoteUrl(input.noteUrl))
      .maybeSingle()

    assertNoDatabaseError(noteResult.error)
    note = noteResult.data as NoteLookupRow | null
  }

  const { data, error } = await supabase
    .from('snippets')
    .insert({
      ...(input.id ? { id: input.id } : {}),
      user_id: user.id,
      note_id: note?.id ?? null,
      selected_text: input.selectedText,
      reason_text: input.reasonText ?? null,
      color_value: input.colorValue ?? null,
      color_tag_name: input.colorTagName ?? null,
      created_at: input.createdAt ?? new Date().toISOString(),
      deleted_at: note?.deleted_at ?? null,
    })
    .select(snippetSelectColumns)
    .single()

  if (error?.code === '23505' && input.id) {
    const existingResult = await supabase
      .from('snippets')
      .select(snippetSelectColumns)
      .eq('user_id', user.id)
      .eq('id', input.id)
      .maybeSingle()

    assertNoDatabaseError(existingResult.error)
    const existingSnippet = existingResult.data as SnippetRow | null
    if (existingSnippet) {
      let existingNote: NoteLookupRow | null = null
      if (existingSnippet.note_id) {
        const noteResult = await supabase
          .from('notes')
          .select('id,source_url,title,author_name,deleted_at')
          .eq('user_id', user.id)
          .eq('id', existingSnippet.note_id)
          .maybeSingle()

        assertNoDatabaseError(noteResult.error)
        existingNote = noteResult.data as NoteLookupRow | null
      }
      return toSnippetDto(existingSnippet, existingNote)
    }
  }

  assertNoDatabaseError(error)

  return toSnippetDto(data as SnippetRow, note)
}

export async function syncAnnotation(
  config: AppConfig,
  user: User,
  input: SyncAnnotationRequest,
) {
  const supabase = getAdminClient(config)
  const folderResult = await supabase
    .from('folders')
    .select('id,name,updated_at')
    .eq('user_id', user.id)
    .eq('name', input.folderName)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  assertNoDatabaseError(folderResult.error)
  const existingFolder = folderResult.data as FolderRow | null
  const folder = existingFolder
    ? { id: existingFolder.id, name: existingFolder.name }
    : await createFolder(config, user, { name: input.folderName })
  const note = await upsertNote(config, user, {
    ...input.note,
    folderId: folder.id,
  })
  const snippet = await createSnippet(config, user, {
    ...input.snippet,
    noteId: note.id,
  })

  return {
    folder: { id: folder.id, name: folder.name },
    note,
    snippet,
  }
}

export async function updateSnippet(
  config: AppConfig,
  user: User,
  snippetId: string,
  input: UpdateSnippetRequest,
): Promise<SnippetDto> {
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('snippets')
    .update({
      selected_text: input.selectedText,
      reason_text: input.reasonText ?? null,
      color_value: input.colorValue ?? null,
      color_tag_name: input.colorTagName ?? null,
    })
    .eq('user_id', user.id)
    .eq('id', snippetId)
    .select(snippetSelectColumns)
    .maybeSingle()

  assertNoDatabaseError(error)

  if (!data) {
    throw new Error('Snippet not found.')
  }

  let note: NoteLookupRow | null = null
  const noteId = (data as SnippetRow).note_id
  if (noteId) {
    const noteResult = await supabase
      .from('notes')
      .select('id,source_url,title,author_name,deleted_at')
      .eq('user_id', user.id)
      .eq('id', noteId)
      .maybeSingle()

    assertNoDatabaseError(noteResult.error)
    note = noteResult.data as NoteLookupRow | null
  }

  return toSnippetDto(data as SnippetRow, note)
}

export async function deleteSnippet(
  config: AppConfig,
  user: User,
  snippetId: string,
): Promise<void> {
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('snippets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('id', snippetId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  assertNoDatabaseError(error)

  if (data) return

  const permanentResult = await supabase
    .from('snippets')
    .delete()
    .eq('user_id', user.id)
    .eq('id', snippetId)
    .not('deleted_at', 'is', null)
    .select('id')
    .maybeSingle()

  assertNoDatabaseError(permanentResult.error)
  assertSingleMutation(permanentResult.data, 'Snippet')
}

export async function listSnippets(config: AppConfig, user: User): Promise<SnippetDto[]> {
  const supabase = getAdminClient(config)
  const [snippetResult, noteResult] = await Promise.all([
    supabase
      .from('snippets')
      .select(snippetSelectColumns)
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
    cost_estimate_cny: input.costEstimateCny ?? null,
    latency_ms: input.latencyMs ?? null,
    prompt_hash: input.promptHash ?? null,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    finished_at: new Date().toISOString(),
  })

  assertNoDatabaseError(error)
}

export async function getAiDailySpendCny(
  config: AppConfig,
  user: User,
  now = new Date(),
): Promise<number> {
  const supabase = getAdminClient(config)
  const chinaOffsetMs = 8 * 60 * 60 * 1000
  const chinaTime = new Date(now.getTime() + chinaOffsetMs)
  chinaTime.setUTCHours(0, 0, 0, 0)
  const startOfChinaDay = new Date(chinaTime.getTime() - chinaOffsetMs)

  const { data, error } = await supabase
    .from('ai_runs')
    .select('cost_estimate_cny')
    .eq('user_id', user.id)
    .not('cost_estimate_cny', 'is', null)
    .gte('created_at', startOfChinaDay.toISOString())

  assertNoDatabaseError(error)

  const total = (data ?? []).reduce((sum, row) => {
    const cost = Number(row.cost_estimate_cny ?? 0)
    return Number.isFinite(cost) ? sum + cost : sum
  }, 0)

  return Number(total.toFixed(6))
}
