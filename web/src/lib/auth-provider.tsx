import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { PublicConfigResponse } from '@lumos-ai/shared'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import {
  getSupabaseBrowserClient,
  setAuthorizedSessionForRuntime,
} from '@/lib/supabase-browser'
import {
  AuthContext,
  type AuthContextValue,
  type AuthSessionStatus,
} from '@/lib/auth-context'

type AuthState = {
  status: AuthSessionStatus
  client: SupabaseClient | null
  config: PublicConfigResponse | null
  rawSession: Session | null
  error: string
}

const RECOVERY_SESSION_GRACE_MS = 4_000
const RECOVERY_SESSION_POLL_MS = 50

function getRecoveryUrlState() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const searchParams = new URLSearchParams(window.location.search)
  const type = hashParams.get('type') || searchParams.get('type')
  const tokenHash = hashParams.get('token_hash') || searchParams.get('token_hash')
  const errorCode = hashParams.get('error_code') || searchParams.get('error_code')
  const errorDescription =
    hashParams.get('error_description') || searchParams.get('error_description') || ''
  const hasRecoveryError =
    errorCode === 'otp_expired' ||
    (type === 'recovery' && Boolean(errorCode || errorDescription))

  return {
    isRecovery: type === 'recovery' || hasRecoveryError,
    tokenHash: type === 'recovery' ? tokenHash : null,
    error: hasRecoveryError
      ? errorCode === 'otp_expired'
        ? '这个重置链接已失效或已过期，请重新发送邮件。'
        : '这个重置链接无法使用，请重新发送邮件。'
      : '',
  }
}

async function getSessionAfterRecoveryRedirect(client: SupabaseClient) {
  const deadline = Date.now() + RECOVERY_SESSION_GRACE_MS

  do {
    const { data, error } = await client.auth.getSession()
    if (error || data.session) return { session: data.session, error }
    await new Promise<void>((resolve) => window.setTimeout(resolve, RECOVERY_SESSION_POLL_MS))
  } while (Date.now() < deadline)

  return { session: null, error: null }
}

function clearRecoveryUrl() {
  window.history.replaceState(null, document.title, window.location.pathname)
}

function isRecoveryStatus(status: AuthSessionStatus) {
  return status === 'recovery' || status === 'recovery-success'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'initializing',
    client: null,
    config: null,
    rawSession: null,
    error: '',
  })
  const statusRef = useRef<AuthSessionStatus>('initializing')
  const recoveryIntentRef = useRef(false)
  const [initialRecoveryUrl] = useState(getRecoveryUrlState)
  const recoveryUrlRef = useRef(initialRecoveryUrl)
  const recoveryTokenHashRef = useRef(initialRecoveryUrl.tokenHash)
  const recoveryExchangeStartedRef = useRef(false)

  const commitState = useCallback((next: AuthState) => {
    statusRef.current = next.status
    setAuthorizedSessionForRuntime(
      next.status === 'authenticated' ? next.rawSession : null,
    )
    setState(next)
  }, [])

  useEffect(() => {
    let mounted = true
    let unsubscribe: (() => void) | null = null
    const recoveryUrl = recoveryUrlRef.current ?? getRecoveryUrlState()
    recoveryUrlRef.current = recoveryUrl
    if (recoveryUrl.isRecovery) recoveryIntentRef.current = true

    async function initialize() {
      try {
        const next = await getSupabaseBrowserClient()
        if (!mounted) return

        if (!next.client) {
          commitState({
            status: 'guest',
            client: null,
            config: next.config,
            rawSession: null,
            error: '',
          })
          return
        }

        const client = next.client
        const config = next.config
        const authListener = client.auth.onAuthStateChange((event, session) => {
          if (!mounted) return

          const awaitingManualRecovery =
            Boolean(recoveryTokenHashRef.current) && !recoveryExchangeStartedRef.current
          if (recoveryUrlRef.current?.error || awaitingManualRecovery) return

          if (event === 'SIGNED_OUT') {
            if (recoveryIntentRef.current) return
            recoveryIntentRef.current = false
            commitState({ status: 'guest', client, config, rawSession: null, error: '' })
            return
          }

          if (!session) return

          if (event === 'PASSWORD_RECOVERY') {
            recoveryIntentRef.current = true
            commitState({ status: 'recovery', client, config, rawSession: session, error: '' })
            return
          }

          if (statusRef.current === 'recovery-error') return

          if (recoveryIntentRef.current || isRecoveryStatus(statusRef.current)) {
            commitState({
              status:
                statusRef.current === 'recovery-success'
                  ? 'recovery-success'
                  : 'recovery',
              client,
              config,
              rawSession: session,
              error: '',
            })
            return
          }

          commitState({
            status: 'authenticated',
            client,
            config,
            rawSession: session,
            error: '',
          })
        })
        unsubscribe = () => authListener.data.subscription.unsubscribe()

        if (recoveryUrl.error) {
          commitState({
            status: 'recovery-error',
            client,
            config,
            rawSession: null,
            error: recoveryUrl.error,
          })
          return
        }

        if (recoveryUrl.tokenHash) {
          commitState({
            status: 'recovery-confirmation',
            client,
            config,
            rawSession: null,
            error: '',
          })
          return
        }

        const sessionResult = recoveryIntentRef.current
          ? await getSessionAfterRecoveryRedirect(client)
          : await client.auth.getSession().then(({ data, error }) => ({
              session: data.session,
              error,
            }))
        if (!mounted) return
        if (sessionResult.error) {
          commitState({
            status: 'error',
            client,
            config,
            rawSession: null,
            error: sessionResult.error.message,
          })
          return
        }

        if (recoveryIntentRef.current) {
          commitState({
            status: sessionResult.session ? 'recovery' : 'recovery-error',
            client,
            config,
            rawSession: sessionResult.session,
            error: sessionResult.session
              ? ''
              : '这个重置链接已失效或已过期，请重新发送邮件。',
          })
          return
        }

        commitState({
          status: sessionResult.session ? 'authenticated' : 'guest',
          client,
          config,
          rawSession: sessionResult.session,
          error: '',
        })
      } catch (error) {
        if (!mounted) return
        commitState({
          status: 'error',
          client: null,
          config: null,
          rawSession: null,
          error: error instanceof Error ? error.message : '登录服务暂时不可用',
        })
      }
    }

    void initialize()

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [commitState])

  const confirmPasswordRecovery = useCallback(async () => {
    const tokenHash = recoveryTokenHashRef.current
    if (!state.client || !tokenHash || statusRef.current !== 'recovery-confirmation') {
      return '这个重置链接无法使用，请重新发送邮件。'
    }

    recoveryExchangeStartedRef.current = true
    recoveryIntentRef.current = true
    const { data, error } = await state.client.auth.verifyOtp({
      type: 'recovery',
      token_hash: tokenHash,
    })

    if (error || !data.session) {
      recoveryExchangeStartedRef.current = false
      commitState({
        ...state,
        status: 'recovery-error',
        rawSession: null,
        error: '这个重置链接已失效或已过期，请重新发送邮件。',
      })
      return error?.message || '这个重置链接无法使用，请重新发送邮件。'
    }

    recoveryTokenHashRef.current = null
    clearRecoveryUrl()
    commitState({
      ...state,
      status: 'recovery',
      rawSession: data.session,
      error: '',
    })
    return null
  }, [commitState, state])

  const completePasswordRecovery = useCallback(
    async (password: string) => {
      if (!state.client || !isRecoveryStatus(statusRef.current)) {
        return '重置会话已经失效，请重新发送邮件。'
      }

      const { error } = await state.client.auth.updateUser({ password })
      if (error) {
        if (/expired|session|jwt|otp/i.test(error.message)) {
          recoveryIntentRef.current = true
          commitState({
            ...state,
            status: 'recovery-error',
            rawSession: null,
            error: '这个重置链接已失效或已过期，请重新发送邮件。',
          })
        }
        return error.message
      }

      const { data, error: sessionError } = await state.client.auth.getSession()
      if (sessionError || !data.session) {
        return sessionError?.message || '新密码已保存，但登录会话不可用，请重新登录。'
      }

      recoveryIntentRef.current = true
      commitState({
        ...state,
        status: 'recovery-success',
        rawSession: data.session,
        error: '',
      })
      return null
    },
    [commitState, state],
  )

  const finishPasswordRecovery = useCallback(async () => {
    if (!state.client || statusRef.current !== 'recovery-success') {
      return '请先设置新的登录密码。'
    }

    const { data, error } = await state.client.auth.getSession()
    if (error || !data.session) {
      return error?.message || '登录会话已经失效，请重新登录。'
    }

    recoveryIntentRef.current = false
    recoveryTokenHashRef.current = null
    recoveryExchangeStartedRef.current = false
    clearRecoveryUrl()
    commitState({
      ...state,
      status: 'authenticated',
      rawSession: data.session,
      error: '',
    })
    return null
  }, [commitState, state])

  const cancelPasswordRecovery = useCallback(async () => {
    recoveryIntentRef.current = false
    recoveryTokenHashRef.current = null
    recoveryExchangeStartedRef.current = false
    clearRecoveryUrl()
    if (state.client) await state.client.auth.signOut()
    commitState({
      ...state,
      status: 'guest',
      rawSession: null,
      error: '',
    })
  }, [commitState, state])

  const signOut = useCallback(async () => {
    if (!state.client) return null
    const { error } = await state.client.auth.signOut()
    return error?.message ?? null
  }, [state.client])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      client: state.client,
      config: state.config,
      session: state.status === 'authenticated' ? state.rawSession : null,
      error: state.error,
      confirmPasswordRecovery,
      completePasswordRecovery,
      finishPasswordRecovery,
      cancelPasswordRecovery,
      signOut,
    }),
    [
      cancelPasswordRecovery,
      confirmPasswordRecovery,
      completePasswordRecovery,
      finishPasswordRecovery,
      signOut,
      state,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
