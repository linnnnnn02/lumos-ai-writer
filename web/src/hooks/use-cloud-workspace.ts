import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CreateFeedbackMemoryRequest,
  FeedbackMemoryDto,
  SyncWorkspaceRequest,
  WorkspaceProjectDto,
} from '@lumos-ai/shared'
import {
  createFeedbackMemory,
  getWorkspace,
  syncWorkspace,
} from '@/lib/api-client'
import {
  getCurrentAccessToken,
  getSupabaseBrowserClient,
} from '@/lib/supabase-browser'

type CloudWorkspaceStatus = 'initializing' | 'guest' | 'loading' | 'ready' | 'error'

export type CloudWorkspaceState = {
  status: CloudWorkspaceStatus
  userId: string
  projects: WorkspaceProjectDto[]
  feedbackMemories: FeedbackMemoryDto[]
  error: string
  isSaving: boolean
  savedAt: string
  refresh: () => void
  save: (input: SyncWorkspaceRequest) => Promise<void>
  remember: (input: CreateFeedbackMemoryRequest) => Promise<FeedbackMemoryDto>
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '云端工作区读取失败'
}

export function useCloudWorkspace(): CloudWorkspaceState {
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [status, setStatus] = useState<CloudWorkspaceStatus>('initializing')
  const [userId, setUserId] = useState('')
  const [projects, setProjects] = useState<WorkspaceProjectDto[]>([])
  const [feedbackMemories, setFeedbackMemories] = useState<FeedbackMemoryDto[]>([])
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const requestIdRef = useRef(0)

  const refresh = useCallback(() => {
    setRefreshVersion((current) => current + 1)
  }, [])

  const save = useCallback(async (input: SyncWorkspaceRequest) => {
    const token = await getCurrentAccessToken()
    if (!token) throw new Error('登录状态已过期，请重新登录后再保存工作区。')

    setIsSaving(true)
    setError('')
    try {
      const response = await syncWorkspace(token, input)
      setSavedAt(response.syncedAt)
    } catch (nextError) {
      setError(getErrorMessage(nextError))
      throw nextError
    } finally {
      setIsSaving(false)
    }
  }, [])

  const remember = useCallback(async (input: CreateFeedbackMemoryRequest) => {
    const token = await getCurrentAccessToken()
    if (!token) throw new Error('登录状态已过期，请重新登录后再记录偏好。')

    setError('')
    try {
      const response = await createFeedbackMemory(token, input)
      setFeedbackMemories((current) => [response.memory, ...current])
      return response.memory
    } catch (nextError) {
      setError(getErrorMessage(nextError))
      throw nextError
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    let unsubscribe: (() => void) | null = null

    function setGuestState() {
      requestIdRef.current += 1
      setStatus('guest')
      setUserId('')
      setProjects([])
      setFeedbackMemories([])
      setError('')
      setSavedAt('')
    }

    async function load(accessToken: string, nextUserId: string) {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setStatus('loading')
      setUserId(nextUserId)
      setError('')

      try {
        const response = await getWorkspace(accessToken)
        if (!isMounted || requestIdRef.current !== requestId) return

        setProjects(response.projects)
        setFeedbackMemories(response.feedbackMemories)
        setStatus('ready')
      } catch (nextError) {
        if (!isMounted || requestIdRef.current !== requestId) return
        setStatus('error')
        setError(getErrorMessage(nextError))
      }
    }

    async function initialize() {
      try {
        const next = await getSupabaseBrowserClient()
        if (!isMounted) return
        if (!next.client) {
          setGuestState()
          return
        }

        const { data, error: sessionError } = await next.client.auth.getSession()
        if (!isMounted) return
        if (sessionError) {
          setStatus('error')
          setError(sessionError.message)
          return
        }

        if (data.session?.access_token) {
          void load(data.session.access_token, data.session.user.id)
        } else {
          setGuestState()
        }

        const listener = next.client.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token) {
            void load(session.access_token, session.user.id)
          } else {
            setGuestState()
          }
        })
        unsubscribe = () => listener.data.subscription.unsubscribe()
      } catch (nextError) {
        if (!isMounted) return
        setStatus('error')
        setError(getErrorMessage(nextError))
      }
    }

    void initialize()
    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [refreshVersion])

  return {
    status,
    userId,
    projects,
    feedbackMemories,
    error,
    isSaving,
    savedAt,
    refresh,
    save,
    remember,
  }
}
