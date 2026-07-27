const LOCAL_WORKSPACE_KEY = 'lumos.local-workspace'
const LOCAL_WORKSPACE_VERSION = 1

type LocalWorkspaceEnvelope = {
  version: number
  savedAt: string
  workspace: unknown
}

export function loadLocalWorkspace(): unknown | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(LOCAL_WORKSPACE_KEY)
    if (!raw) return null

    const envelope = JSON.parse(raw) as Partial<LocalWorkspaceEnvelope>
    if (envelope.version !== LOCAL_WORKSPACE_VERSION || !envelope.workspace) return null
    return envelope.workspace
  } catch {
    return null
  }
}

export function saveLocalWorkspace(workspace: unknown) {
  const savedAt = new Date().toISOString()
  const envelope: LocalWorkspaceEnvelope = {
    version: LOCAL_WORKSPACE_VERSION,
    savedAt,
    workspace,
  }

  window.localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(envelope))
  return savedAt
}
