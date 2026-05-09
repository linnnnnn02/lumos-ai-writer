import type {
  AnalyzeReferencesRequest,
  AnalyzeReferencesResponse,
  CreateFolderRequest,
  CreateFolderResponse,
  CreateSnippetRequest,
  CreateSnippetResponse,
  GenerateDraftRequest,
  GenerateDraftResponse,
  HealthResponse,
  ListFoldersResponse,
  ListNotesResponse,
  ListSnippetsResponse,
  MeResponse,
  PublicConfigResponse,
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

export function getNotes(token: string) {
  return requestJson<ListNotesResponse>('/v1/notes', token)
}

export function upsertNote(token: string, input: UpsertNoteRequest) {
  return requestJson<UpsertNoteResponse>('/v1/notes', token, {
    method: 'POST',
    body: input,
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

export function analyzeReferences(token: string, input: AnalyzeReferencesRequest) {
  return requestJson<AnalyzeReferencesResponse>('/v1/ai/analyze', token, {
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
