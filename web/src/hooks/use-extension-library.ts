import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
} from '@lumos-ai/shared'

const PAGE_SOURCE = 'lumos-web'
const EXTENSION_SOURCE = 'lumos-extension'
const SNAPSHOT_REQUEST = 'LUMOS_LIBRARY_SNAPSHOT_REQUEST'
const SNAPSHOT_RESPONSE = 'LUMOS_LIBRARY_SNAPSHOT_RESPONSE'
const BRIDGE_READY = 'LUMOS_LIBRARY_BRIDGE_READY'
const LIBRARY_CHANGED = 'LUMOS_LIBRARY_CHANGED'
const OPEN_LIBRARY_REQUEST = 'LUMOS_OPEN_EXTENSION_LIBRARY_REQUEST'
const BRIDGE_TIMEOUT_MS = 800

type ExtensionLibraryStatus = 'disabled' | 'detecting' | 'ready' | 'unavailable'

type ExtensionLibrarySnapshot = {
  folders: SavedFolderRecord[]
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
}

type ExtensionLibraryState = ExtensionLibrarySnapshot & {
  status: ExtensionLibraryStatus
  error: string
  isRefreshing: boolean
  refreshedAt: string
}

const emptySnapshot: ExtensionLibrarySnapshot = {
  folders: [],
  notes: [],
  snippets: [],
}

function isSnapshot(value: unknown): value is ExtensionLibrarySnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<ExtensionLibrarySnapshot>
  return (
    Array.isArray(snapshot.folders) &&
    Array.isArray(snapshot.notes) &&
    Array.isArray(snapshot.snippets)
  )
}

export function useExtensionLibrary(enabled: boolean) {
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [state, setState] = useState<ExtensionLibraryState>({
    status: enabled ? 'detecting' : 'disabled',
    ...emptySnapshot,
    error: '',
    isRefreshing: false,
    refreshedAt: '',
  })
  const requestIdRef = useRef('')

  const refresh = useCallback(() => {
    setRefreshVersion((current) => current + 1)
  }, [])

  const openLibrary = useCallback(() => {
    if (!enabled) return
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: OPEN_LIBRARY_REQUEST,
      },
      window.location.origin,
    )
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current = ''
      return
    }

    let timeoutId = 0

    function requestSnapshot() {
      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId
      window.clearTimeout(timeoutId)
      setState((current) => ({
        ...current,
        status: current.refreshedAt ? 'ready' : 'detecting',
        error: '',
        isRefreshing: Boolean(current.refreshedAt),
      }))

      window.postMessage(
        {
          source: PAGE_SOURCE,
          type: SNAPSHOT_REQUEST,
          requestId,
        },
        window.location.origin,
      )

      timeoutId = window.setTimeout(() => {
        if (requestIdRef.current !== requestId) return
        setState((current) => ({
          ...current,
          status: current.refreshedAt ? 'ready' : 'unavailable',
          isRefreshing: false,
        }))
      }, BRIDGE_TIMEOUT_MS)
    }

    function handleMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return
      if (!event.data || typeof event.data !== 'object') return

      const message = event.data as Record<string, unknown>
      if (message.source !== EXTENSION_SOURCE) return

      if (message.type === BRIDGE_READY || message.type === LIBRARY_CHANGED) {
        requestSnapshot()
        return
      }

      if (message.type !== SNAPSHOT_RESPONSE) return
      if (message.requestId !== requestIdRef.current) return

      window.clearTimeout(timeoutId)
      if (message.ok === true && isSnapshot(message.payload)) {
        setState({
          status: 'ready',
          ...message.payload,
          error: '',
          isRefreshing: false,
          refreshedAt: new Date().toISOString(),
        })
        return
      }

      setState((current) => ({
        ...current,
        status: current.refreshedAt ? 'ready' : 'unavailable',
        error:
          typeof message.error === 'string' ? message.error : '插件文案库读取失败',
        isRefreshing: false,
      }))
    }

    window.addEventListener('message', handleMessage)
    requestSnapshot()

    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('message', handleMessage)
    }
  }, [enabled, refreshVersion])

  return { ...state, openLibrary, refresh }
}
