import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CurrentUser,
  NoteDto,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  TrashFolderGroup,
} from '@lumos-ai/shared'
import {
  getCurrentUser,
  getFolders,
  getNotes,
  getSnippets,
  getTrash,
} from '@/lib/api-client'
import { useAuth } from '@/lib/auth-context'
import {
  cloudLibraryCacheReducer,
  type CloudLibraryCacheAction,
  type CloudLibraryCacheState,
} from '@/features/library/model/cloud-library-cache-state'

type CloudLibraryStatus = 'initializing' | 'guest' | 'loading' | 'ready' | 'error'

export type CloudLibraryState = {
  status: CloudLibraryStatus
  user: CurrentUser | null
  folders: SavedFolderRecord[]
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
  trashGroups: TrashFolderGroup[]
  error: string
  isRefreshing: boolean
  refreshedAt: string
  refresh: () => void
  commitMutation: (action: CloudLibraryCacheAction) => void
}

type CloudLibraryDataState = Omit<CloudLibraryState, 'commitMutation' | 'refresh'>

const emptyLibrary: CloudLibraryCacheState = {
  folders: [] as SavedFolderRecord[],
  notes: [] as SavedNoteRecord[],
  snippets: [] as SavedSnippetRecord[],
  trashGroups: [] as TrashFolderGroup[],
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '云端文案库读取失败'
}

function normalizeCloudNotes(notes: NoteDto[]): SavedNoteRecord[] {
  return notes.map((note) => ({
    ...note,
    coverImageUrl: note.coverImageUrl ?? '',
  }))
}

export function useCloudLibrary(): CloudLibraryState {
  const { status: authStatus, session } = useAuth()
  const accessToken = session?.access_token ?? ''
  const [refreshVersion, setRefreshVersion] = useState(0)
  const accessTokenRef = useRef('')
  const requestIdRef = useRef(0)
  const activeLoadCountRef = useRef(0)
  const refresh = useCallback(() => {
    requestIdRef.current += 1
    setRefreshVersion((current) => current + 1)
  }, [])
  const [state, setState] = useState<CloudLibraryDataState>({
    status: 'initializing',
    user: null,
    ...emptyLibrary,
    error: '',
    isRefreshing: false,
    refreshedAt: '',
  })
  const commitMutation = useCallback((action: CloudLibraryCacheAction) => {
    requestIdRef.current += 1
    setState((current) => {
      const cache = cloudLibraryCacheReducer(
        {
          folders: current.folders,
          notes: current.notes,
          snippets: current.snippets,
          trashGroups: current.trashGroups,
        },
        action,
      )

      return {
        ...current,
        ...cache,
        status: 'ready',
        error: '',
        isRefreshing: true,
        refreshedAt: current.refreshedAt || new Date().toISOString(),
      }
    })
    setRefreshVersion((current) => current + 1)
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadLibrary(accessToken: string) {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      accessTokenRef.current = accessToken
      activeLoadCountRef.current += 1

      setState((current) => {
        const hasCachedLibrary = Boolean(current.refreshedAt)
        return {
          ...current,
          status: hasCachedLibrary ? 'ready' : 'loading',
          ...(hasCachedLibrary ? {} : emptyLibrary),
          error: '',
          isRefreshing: hasCachedLibrary,
        }
      })

      try {
        const [me, folders, notes, snippets, trash] = await Promise.all([
          getCurrentUser(accessToken),
          getFolders(accessToken),
          getNotes(accessToken),
          getSnippets(accessToken),
          getTrash(accessToken),
        ])

        if (!isMounted || requestId !== requestIdRef.current) return
        const cache = cloudLibraryCacheReducer(emptyLibrary, {
          type: 'replace-cache',
          cache: {
            folders: folders.folders,
            notes: normalizeCloudNotes(notes.notes),
            snippets: snippets.snippets,
            trashGroups: trash.groups,
          },
        })

        setState({
          status: 'ready',
          user: me.user,
          ...cache,
          error: '',
          isRefreshing: false,
          refreshedAt: new Date().toISOString(),
        })
      } catch (error) {
        if (!isMounted || requestId !== requestIdRef.current) return

        setState((current) => {
          const hasCachedLibrary = Boolean(current.refreshedAt)
          return {
            ...current,
            status: hasCachedLibrary ? 'ready' : 'error',
            ...(hasCachedLibrary ? {} : emptyLibrary),
            error: getErrorMessage(error),
            isRefreshing: false,
          }
        })
      } finally {
        activeLoadCountRef.current = Math.max(0, activeLoadCountRef.current - 1)
      }
    }

    function setGuestState() {
      accessTokenRef.current = ''
      requestIdRef.current += 1
      setState({
        status: 'guest',
        user: null,
        ...emptyLibrary,
        error: '',
        isRefreshing: false,
        refreshedAt: '',
      })
    }

    let activationRefreshTimer = 0

    function scheduleActivationRefresh() {
      if (!accessTokenRef.current || activeLoadCountRef.current > 0) return
      window.clearTimeout(activationRefreshTimer)
      activationRefreshTimer = window.setTimeout(() => {
        if (activeLoadCountRef.current > 0) return
        void loadLibrary(accessTokenRef.current)
      }, 120)
    }

    function refreshWhenVisible() {
      if (document.visibilityState !== 'visible') return
      scheduleActivationRefresh()
    }

    if (authStatus === 'authenticated' && accessToken) {
      void loadLibrary(accessToken)
    } else if (authStatus !== 'initializing') {
      setGuestState()
    }

    window.addEventListener('focus', scheduleActivationRefresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      isMounted = false
      window.clearTimeout(activationRefreshTimer)
      window.removeEventListener('focus', scheduleActivationRefresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [accessToken, authStatus, refreshVersion])

  return { ...state, refresh, commitMutation }
}
