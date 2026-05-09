import type { User } from '@supabase/supabase-js'
import type { FolderDto, NoteDto, SnippetDto } from '@lumos-ai/shared'
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

type SnippetRow = {
  id: string
  note_id: string | null
  selected_text: string
  reason_text: string | null
  color_value: string | null
  color_tag_name: string | null
  created_at: string
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

  return ((folderResult.data ?? []) as FolderRow[]).map((folder) => ({
    id: folder.id,
    name: folder.name,
    noteCount: noteCounts.get(folder.id) ?? 0,
    updatedAt: folder.updated_at,
  }))
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

  return ((noteResult.data ?? []) as NoteRow[]).map((note) => ({
    id: note.id,
    folderId: note.folder_id ?? '',
    folderName: note.folder_id ? (folderNames.get(note.folder_id) ?? '') : '',
    filename: note.filename,
    title: note.title,
    authorName: note.author_name ?? '',
    sourceUrl: note.source_url,
    coverImageUrl: note.cover_image_url ?? '',
    contentText: note.content_text ?? '',
    savedAt: note.created_at || note.updated_at,
  }))
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

  return ((snippetResult.data ?? []) as SnippetRow[]).map((snippet) => {
    const note = snippet.note_id ? notes.get(snippet.note_id) : null

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
  })
}
