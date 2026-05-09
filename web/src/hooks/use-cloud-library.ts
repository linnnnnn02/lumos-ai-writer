import { useEffect, useRef, useState } from 'react'
import type {
  CurrentUser,
  NoteDto,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
} from '@lumos-ai/shared'
import {
  getCurrentUser,
  getFolders,
  getNotes,
  getSnippets,
} from '@/lib/api-client'
import { getSupabaseBrowserClient } from '@/lib/supabase-browser'

type CloudLibraryStatus = 'initializing' | 'guest' | 'loading' | 'ready' | 'error'

export type CloudLibraryState = {
  status: CloudLibraryStatus
  user: CurrentUser | null
  folders: SavedFolderRecord[]
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
  error: string
}

const emptyLibrary = {
  folders: [] as SavedFolderRecord[],
  notes: [] as SavedNoteRecord[],
  snippets: [] as SavedSnippetRecord[],
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
  const [state, setState] = useState<CloudLibraryState>({
    status: 'initializing',
    user: null,
    ...emptyLibrary,
    error: '',
  })
  const accessTokenRef = useRef('')
  const requestIdRef = useRef(0)

  useEffect(() => {
    let isMounted = true
    let unsubscribe: (() => void) | null = null

    async function loadLibrary(accessToken: string) {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      accessTokenRef.current = accessToken

      setState((current) => ({
        ...current,
        status: 'loading',
        ...emptyLibrary,
        error: '',
      }))

      try {
        const [me, folders, notes, snippets] = await Promise.all([
          getCurrentUser(accessToken),
          getFolders(accessToken),
          getNotes(accessToken),
          getSnippets(accessToken),
        ])

        if (!isMounted || requestId !== requestIdRef.current) return

        setState({
          status: 'ready',
          user: me.user,
          folders: folders.folders,
          notes: normalizeCloudNotes(notes.notes),
          snippets: snippets.snippets,
          error: '',
        })
      } catch (error) {
        if (!isMounted || requestId !== requestIdRef.current) return

        setState((current) => ({
          ...current,
          status: 'error',
          ...emptyLibrary,
          error: getErrorMessage(error),
        }))
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
      })
    }

    async function initialize() {
      try {
        const next = await getSupabaseBrowserClient()
        if (!isMounted) return

        if (!next.client) {
          setGuestState()
          return
        }

        const { data, error } = await next.client.auth.getSession()
        if (!isMounted) return

        if (error) {
          setState({
            status: 'error',
            user: null,
            ...emptyLibrary,
            error: error.message,
          })
          return
        }

        if (data.session?.access_token) {
          void loadLibrary(data.session.access_token)
        } else {
          setGuestState()
        }

        const listener = next.client.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token) {
            void loadLibrary(session.access_token)
          } else {
            setGuestState()
          }
        })
        unsubscribe = () => listener.data.subscription.unsubscribe()
      } catch (error) {
        if (!isMounted) return
        setState({
          status: 'error',
          user: null,
          ...emptyLibrary,
          error: getErrorMessage(error),
        })
      }
    }

    function refreshOnFocus() {
      if (!accessTokenRef.current) return
      void loadLibrary(accessTokenRef.current)
    }

    void initialize()
    window.addEventListener('focus', refreshOnFocus)

    return () => {
      isMounted = false
      unsubscribe?.()
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [])

  return state
}
