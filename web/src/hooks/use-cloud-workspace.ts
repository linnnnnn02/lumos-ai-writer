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
import { useAuth } from '@/lib/auth-context'

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
  const { status: authStatus, session } = useAuth()
  const accessToken = session?.access_token ?? ''
  const authenticatedUserId = session?.user.id ?? ''
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
    if (authStatus !== 'authenticated' || !accessToken) {
      throw new Error('登录状态已过期，请重新登录后再保存工作区。')
    }

    setIsSaving(true)
    setError('')
    try {
      const response = await syncWorkspace(accessToken, input)
      setSavedAt(response.syncedAt)
    } catch (nextError) {
      setError(getErrorMessage(nextError))
      throw nextError
    } finally {
      setIsSaving(false)
    }
  }, [accessToken, authStatus])

  const remember = useCallback(async (input: CreateFeedbackMemoryRequest) => {
    if (authStatus !== 'authenticated' || !accessToken) {
      throw new Error('登录状态已过期，请重新登录后再记录偏好。')
    }

    setError('')
    try {
      const response = await createFeedbackMemory(accessToken, input)
      setFeedbackMemories((current) => [response.memory, ...current])
      return response.memory
    } catch (nextError) {
      setError(getErrorMessage(nextError))
      throw nextError
    }
  }, [accessToken, authStatus])

  useEffect(() => {
    let isMounted = true

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

    if (authStatus === 'authenticated' && accessToken && authenticatedUserId) {
      void load(accessToken, authenticatedUserId)
    } else if (authStatus !== 'initializing') {
      setGuestState()
    }

    return () => {
      isMounted = false
    }
  }, [accessToken, authStatus, authenticatedUserId, refreshVersion])

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
