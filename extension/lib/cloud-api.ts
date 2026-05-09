import type {
  CreateFolderResponse,
  CreateSnippetRequest,
  CreateSnippetResponse,
  ListFoldersResponse,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  UpsertNoteResponse,
} from '@lumos-ai/shared'
import { getCloudApiBaseUrl } from './cloud-auth'

async function requestCloudJson<T>(
  path: string,
  token: string,
  options: {
    method?: string
    body?: unknown
  } = {},
): Promise<T> {
  const response = await fetch(`${getCloudApiBaseUrl()}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message || `云端请求失败：${response.status}`)
  }

  return data as T
}

async function ensureCloudFolder(token: string, localFolder: SavedFolderRecord | null) {
  const folderName = localFolder?.name?.trim() || '默认文件夹'
  const folders = await requestCloudJson<ListFoldersResponse>('/v1/folders', token)
  const existingFolder = folders.folders.find((folder) => folder.name === folderName)
  if (existingFolder) return existingFolder

  const created = await requestCloudJson<CreateFolderResponse>('/v1/folders', token, {
    method: 'POST',
    body: { name: folderName },
  })
  return created.folder
}

export async function syncAnnotationToCloud(
  token: string,
  input: {
    folder: SavedFolderRecord | null
    note: SavedNoteRecord
    snippet: SavedSnippetRecord
  },
) {
  const folder = await ensureCloudFolder(token, input.folder)
  const savedNote = await requestCloudJson<UpsertNoteResponse>('/v1/notes', token, {
    method: 'POST',
    body: {
      folderId: folder.id,
      filename: input.note.filename,
      title: input.note.title,
      authorName: input.note.authorName,
      sourceUrl: input.note.sourceUrl,
      coverImageUrl: input.note.coverImageUrl ?? '',
      contentText: input.note.contentText,
      savedAt: input.note.savedAt,
    },
  })

  const snippetBody: CreateSnippetRequest = {
    noteId: savedNote.note.id,
    selectedText: input.snippet.selectedText,
    reasonText: input.snippet.reasonText,
    colorTagName: input.snippet.colorTagName,
    colorValue: input.snippet.colorValue,
    createdAt: input.snippet.createdAt,
  }
  const savedSnippet = await requestCloudJson<CreateSnippetResponse>('/v1/snippets', token, {
    method: 'POST',
    body: snippetBody,
  })

  return {
    folder,
    note: savedNote.note,
    snippet: savedSnippet.snippet,
  }
}
