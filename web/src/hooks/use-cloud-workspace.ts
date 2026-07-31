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
  errorVersion: number
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
  const [errorVersion, setErrorVersion] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const requestIdRef = useRef(0)
  const hasActiveErrorRef = useRef(false)

  const clearError = useCallback(() => {
    hasActiveErrorRef.current = false
    setError('')
  }, [])

  const reportError = useCallback((nextError: unknown) => {
    if (!hasActiveErrorRef.current) {
      hasActiveErrorRef.current = true
      setErrorVersion((current) => current + 1)
    }
    setError(getErrorMessage(nextError))
  }, [])

  const refresh = useCallback(() => {
    setRefreshVersion((current) => current + 1)
  }, [])

  const save = useCallback(async (input: SyncWorkspaceRequest) => {
    if (authStatus !== 'authenticated' || !accessToken) {
      throw new Error('登录状态已过期，请重新登录后再保存工作区。')
    }

    setIsSaving(true)
    try {
      const response = await syncWorkspace(accessToken, input)
      clearError()
      setSavedAt(response.syncedAt)
    } catch (nextError) {
      reportError(nextError)
      throw nextError
    } finally {
      setIsSaving(false)
    }
  }, [accessToken, authStatus, clearError, reportError])

  const remember = useCallback(async (input: CreateFeedbackMemoryRequest) => {
    if (authStatus !== 'authenticated' || !accessToken) {
      throw new Error('登录状态已过期，请重新登录后再记录偏好。')
    }

    try {
      const response = await createFeedbackMemory(accessToken, input)
      clearError()
      setFeedbackMemories((current) => [response.memory, ...current])
      return response.memory
    } catch (nextError) {
      reportError(nextError)
      throw nextError
    }
  }, [accessToken, authStatus, clearError, reportError])

  useEffect(() => {
    let isMounted = true

    function setGuestState() {
      requestIdRef.current += 1
      setStatus('guest')
      setUserId('')
      setProjects([])
      setFeedbackMemories([])
      clearError()
      setSavedAt('')
    }

    async function load(accessToken: string, nextUserId: string) {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setStatus('loading')
      setUserId(nextUserId)
      clearError()

      try {
        const response = await getWorkspace(accessToken)
        if (!isMounted || requestIdRef.current !== requestId) return

        setProjects(response.projects)
        setFeedbackMemories(response.feedbackMemories)
        setStatus('ready')
      } catch (nextError) {
        if (!isMounted || requestIdRef.current !== requestId) return
        setStatus('error')
        reportError(nextError)
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
  }, [accessToken, authStatus, authenticatedUserId, clearError, refreshVersion, reportError])

  return {
    status,
    userId,
    projects,
    feedbackMemories,
    error,
    errorVersion,
    isSaving,
    savedAt,
    refresh,
    save,
    remember,
  }
}
