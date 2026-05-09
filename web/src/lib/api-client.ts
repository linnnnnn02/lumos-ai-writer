import type {
  HealthResponse,
  ListFoldersResponse,
  ListNotesResponse,
  ListSnippetsResponse,
  MeResponse,
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

async function requestJson<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

export function getCurrentUser(token?: string) {
  return requestJson<MeResponse>('/v1/me', token)
}

export function getFolders(token: string) {
  return requestJson<ListFoldersResponse>('/v1/folders', token)
}

export function getNotes(token: string) {
  return requestJson<ListNotesResponse>('/v1/notes', token)
}

export function getSnippets(token: string) {
  return requestJson<ListSnippetsResponse>('/v1/snippets', token)
}
