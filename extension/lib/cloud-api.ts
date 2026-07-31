import type {
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  SyncAnnotationResponse,
} from '@lumos-ai/shared'
import { getCloudApiBaseUrl } from './cloud-config'

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

export async function syncAnnotationToCloud(
  token: string,
  input: {
    folder: SavedFolderRecord | null
    note: SavedNoteRecord
    snippet: SavedSnippetRecord
  },
) {
  return requestCloudJson<SyncAnnotationResponse>('/v1/annotation-sync', token, {
    method: 'POST',
    body: {
      folderName: input.folder?.name?.trim() || '默认文件夹',
      note: {
        filename: input.note.filename,
        title: input.note.title,
        authorName: input.note.authorName,
        sourceUrl: input.note.sourceUrl,
        coverImageUrl: input.note.coverImageUrl ?? '',
        contentText: input.note.contentText,
        savedAt: input.note.savedAt,
      },
      snippet: {
        id: input.snippet.id,
        selectedText: input.snippet.selectedText,
        reasonText: input.snippet.reasonText,
        colorTagName: input.snippet.colorTagName,
        colorValue: input.snippet.colorValue,
        createdAt: input.snippet.createdAt,
      },
    },
  })
}
