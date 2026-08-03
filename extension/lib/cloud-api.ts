import type {
  ListFoldersResponse,
  ListNotesResponse,
  ListTrashResponse,
  DeleteResourceResponse,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  SyncAnnotationResponse,
  UpdateFolderResponse,
  UpdateNoteResponse,
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
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new CloudApiError(
      data?.error?.message || `云端请求失败：${response.status}`,
      response.status,
      data?.error?.code,
      data?.error?.details,
    )
  }

  return data as T
}

export class CloudApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'CloudApiError'
  }
}

export type CloudLibraryConflictResource =
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

export function getCloudLibraryConflictResource(error: unknown) {
  if (!(error instanceof CloudApiError) || error.status !== 409 || error.code !== 'conflict') {
    return null
  }

  const resource = (error.details as { resource?: unknown } | undefined)?.resource
  if (!resource || typeof resource !== 'object') return null
  const candidate = resource as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return null
  }
  if (candidate.type === 'folder' && typeof candidate.name === 'string') {
    return candidate as CloudLibraryConflictResource
  }
  if (
    candidate.type === 'note' &&
    typeof candidate.filename === 'string' &&
    typeof candidate.title === 'string'
  ) {
    return candidate as CloudLibraryConflictResource
  }
  return null
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

export async function getCloudTrash(token: string) {
  return requestCloudJson<ListTrashResponse>('/v1/trash', token)
}

export async function getCloudLibrary(token: string) {
  const [folderResponse, noteResponse] = await Promise.all([
    requestCloudJson<ListFoldersResponse>('/v1/folders', token),
    requestCloudJson<ListNotesResponse>('/v1/notes', token),
  ])

  return {
    folders: folderResponse.folders,
    notes: noteResponse.notes,
  }
}

export type SyncCloudLibraryOperationInput =
  | {
      action: 'delete' | 'restore'
      resourceType: 'folder' | 'note'
      cloudId: string
    }
  | {
      action: 'rename'
      resourceType: 'folder'
      cloudId: string
      name: string
      expectedUpdatedAt: string
    }
  | {
      action: 'rename'
      resourceType: 'note'
      cloudId: string
      filename: string
      expectedUpdatedAt: string
    }

export async function syncCloudLibraryOperation(
  token: string,
  input: SyncCloudLibraryOperationInput,
) {
  const resourcePath = input.resourceType === 'folder' ? 'folders' : 'notes'
  if (input.action === 'rename') {
    const body =
      input.resourceType === 'folder'
        ? { name: input.name, expectedUpdatedAt: input.expectedUpdatedAt }
        : { filename: input.filename, expectedUpdatedAt: input.expectedUpdatedAt }
    return requestCloudJson<UpdateFolderResponse | UpdateNoteResponse>(
      `/v1/${resourcePath}/${input.cloudId}`,
      token,
      { method: 'PATCH', body },
    )
  }

  const actionPath = input.action === 'restore' ? '/restore' : ''
  return requestCloudJson<DeleteResourceResponse>(
    `/v1/${resourcePath}/${input.cloudId}${actionPath}`,
    token,
    { method: input.action === 'restore' ? 'POST' : 'DELETE' },
  )
}
