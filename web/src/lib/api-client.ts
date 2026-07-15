import type {
  AnalyzeReferencesRequest,
  AnalyzeReferencesResponse,
  BuildWritingProfileRequest,
  BuildWritingProfileResponse,
  CreateFolderRequest,
  CreateFolderResponse,
  CreateFeedbackMemoryRequest,
  CreateFeedbackMemoryResponse,
  CreateSnippetRequest,
  CreateSnippetResponse,
  DeleteResourceResponse,
  GenerateDraftRequest,
  GenerateDraftResponse,
  GetWorkspaceResponse,
  HealthResponse,
  ListFoldersResponse,
  ListNotesResponse,
  ListSnippetsResponse,
  ListTrashResponse,
  MeResponse,
  PublicConfigResponse,
  RewriteDraftRequest,
  RewriteDraftResponse,
  SyncWorkspaceRequest,
  SyncWorkspaceResponse,
  UpdateFolderRequest,
  UpdateFolderResponse,
  UpdateSnippetRequest,
  UpdateSnippetResponse,
  UpsertNoteRequest,
  UpsertNoteResponse,
} from '@lumos-ai/shared'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api'

class ApiClientError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
  }
}

async function requestJson<T>(
  path: string,
  token?: string,
  options: {
    method?: string
    body?: unknown
  } = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await response.json()

  if (!response.ok) {
    const message =
      typeof data?.error?.message === 'string'
        ? data.error.message
        : `API request failed with status ${response.status}`
    throw new ApiClientError(message, response.status)
  }

  return data as T
}

export function getApiHealth() {
  return requestJson<HealthResponse>('/health')
}

export function getPublicConfig() {
  return requestJson<PublicConfigResponse>('/v1/config/public')
}

export function getCurrentUser(token?: string) {
  return requestJson<MeResponse>('/v1/me', token)
}

export function getFolders(token: string) {
  return requestJson<ListFoldersResponse>('/v1/folders', token)
}

export function createFolder(token: string, input: CreateFolderRequest) {
  return requestJson<CreateFolderResponse>('/v1/folders', token, {
    method: 'POST',
    body: input,
  })
}

export function updateFolder(token: string, folderId: string, input: UpdateFolderRequest) {
  return requestJson<UpdateFolderResponse>(`/v1/folders/${folderId}`, token, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteFolder(token: string, folderId: string) {
  return requestJson<DeleteResourceResponse>(`/v1/folders/${folderId}`, token, {
    method: 'DELETE',
  })
}

export function restoreFolder(token: string, folderId: string) {
  return requestJson<DeleteResourceResponse>(`/v1/folders/${folderId}/restore`, token, {
    method: 'POST',
  })
}

export function deleteFolderPermanently(token: string, folderId: string) {
  return requestJson<DeleteResourceResponse>(`/v1/folders/${folderId}/permanent`, token, {
    method: 'DELETE',
  })
}

export function getNotes(token: string) {
  return requestJson<ListNotesResponse>('/v1/notes', token)
}

export function upsertNote(token: string, input: UpsertNoteRequest) {
  return requestJson<UpsertNoteResponse>('/v1/notes', token, {
    method: 'POST',
    body: input,
  })
}

export function deleteNote(token: string, noteId: string) {
  return requestJson<DeleteResourceResponse>(`/v1/notes/${noteId}`, token, {
    method: 'DELETE',
  })
}

export function restoreNote(token: string, noteId: string) {
  return requestJson<DeleteResourceResponse>(`/v1/notes/${noteId}/restore`, token, {
    method: 'POST',
  })
}

export function deleteNotePermanently(token: string, noteId: string) {
  return requestJson<DeleteResourceResponse>(`/v1/notes/${noteId}/permanent`, token, {
    method: 'DELETE',
  })
}

export function getTrash(token: string) {
  return requestJson<ListTrashResponse>('/v1/trash', token)
}

export function emptyTrash(token: string) {
  return requestJson<DeleteResourceResponse>('/v1/trash', token, {
    method: 'DELETE',
  })
}

export function getSnippets(token: string) {
  return requestJson<ListSnippetsResponse>('/v1/snippets', token)
}

export function createSnippet(token: string, input: CreateSnippetRequest) {
  return requestJson<CreateSnippetResponse>('/v1/snippets', token, {
    method: 'POST',
    body: input,
  })
}

export function updateSnippet(token: string, snippetId: string, input: UpdateSnippetRequest) {
  return requestJson<UpdateSnippetResponse>(`/v1/snippets/${snippetId}`, token, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteSnippet(token: string, snippetId: string) {
  return requestJson<DeleteResourceResponse>(`/v1/snippets/${snippetId}`, token, {
    method: 'DELETE',
  })
}

export function getWorkspace(token: string) {
  return requestJson<GetWorkspaceResponse>('/v1/workspace', token)
}

export function syncWorkspace(token: string, input: SyncWorkspaceRequest) {
  return requestJson<SyncWorkspaceResponse>('/v1/workspace', token, {
    method: 'PUT',
    body: input,
  })
}

export function createFeedbackMemory(token: string, input: CreateFeedbackMemoryRequest) {
  return requestJson<CreateFeedbackMemoryResponse>('/v1/feedback-memories', token, {
    method: 'POST',
    body: input,
  })
}

export function analyzeReferences(token: string, input: AnalyzeReferencesRequest) {
  return requestJson<AnalyzeReferencesResponse>('/v1/ai/analyze', token, {
    method: 'POST',
    body: input,
  })
}

export function buildWritingProfile(token: string, input: BuildWritingProfileRequest) {
  return requestJson<BuildWritingProfileResponse>('/v1/ai/writing-profile', token, {
    method: 'POST',
    body: input,
  })
}

export function generateDraft(token: string, input: GenerateDraftRequest) {
  return requestJson<GenerateDraftResponse>('/v1/ai/draft', token, {
    method: 'POST',
    body: input,
  })
}

export function rewriteDraft(token: string, input: RewriteDraftRequest) {
  return requestJson<RewriteDraftResponse>('/v1/ai/rewrite', token, {
    method: 'POST',
    body: input,
  })
}
