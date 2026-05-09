import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { CurrentUser, OAuthProvider, PublicConfigResponse } from '@lumos-ai/shared'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import {
  CheckCircle2,
  Github,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  UserCircle,
  X,
} from '@/components/ui/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  getCurrentUser,
  getFolders,
  getNotes,
  getSnippets,
} from '@/lib/api-client'
import { getSupabaseBrowserClient } from '@/lib/supabase-browser'

type AuthMode = 'signin' | 'signup'
type BackendStatus = 'idle' | 'checking' | 'ready' | 'error'

type CloudCounts = {
  folders: number
  notes: number
  snippets: number
}

type AuthStatusProps = {
  className?: string
}

const providerLabels: Record<OAuthProvider, string> = {
  github: 'GitHub',
  google: 'Google',
}

function getProviderIcon(provider: OAuthProvider) {
  if (provider === 'github') return <Github className="h-4 w-4" />
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[11px] font-bold text-[#4285f4]">
      G
    </span>
  )
}

function getAuthDisplayName(user: CurrentUser | null, session: Session | null) {
  return user?.displayName || user?.email || session?.user.email || '已登录用户'
}

export function AuthStatus({ className }: AuthStatusProps) {
  const [client, setClient] = useState<SupabaseClient | null>(null)
  const [config, setConfig] = useState<PublicConfigResponse | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [backendUser, setBackendUser] = useState<CurrentUser | null>(null)
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('idle')
  const [cloudCounts, setCloudCounts] = useState<CloudCounts | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const displayName = useMemo(
    () => getAuthDisplayName(backendUser, session),
    [backendUser, session],
  )

  useEffect(() => {
    let mounted = true
    let unsubscribe: (() => void) | null = null

    async function loadAuth() {
      try {
        const next = await getSupabaseBrowserClient()
        if (!mounted) return

        setClient(next.client)
        setConfig(next.config)

        if (!next.client) return

        const { data, error } = await next.client.auth.getSession()
        if (!mounted) return

        if (error) {
          setErrorMessage(error.message)
        } else {
          setSession(data.session ?? null)
        }

        const authListener = next.client.auth.onAuthStateChange((_event, nextSession) => {
          setSession(nextSession)
          setErrorMessage('')
          if (nextSession) {
            setIsOpen(false)
          } else {
            setBackendUser(null)
            setBackendStatus('idle')
            setCloudCounts(null)
          }
        })
        unsubscribe = () => authListener.data.subscription.unsubscribe()
      } catch (error) {
        if (!mounted) return
        setErrorMessage(error instanceof Error ? error.message : '认证配置读取失败')
      }
    }

    loadAuth()

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!session?.access_token) return

    const accessToken = session.access_token
    let cancelled = false

    async function verifyBackend() {
      setBackendStatus('checking')
      setCloudCounts(null)
      try {
        const [me, folders, notes, snippets] = await Promise.all([
          getCurrentUser(accessToken),
          getFolders(accessToken),
          getNotes(accessToken),
          getSnippets(accessToken),
        ])
        if (cancelled) return
        setBackendUser(me.user)
        setCloudCounts({
          folders: folders.folders.length,
          notes: notes.notes.length,
          snippets: snippets.snippets.length,
        })
        setBackendStatus('ready')
      } catch (error) {
        if (cancelled) return
        setBackendStatus('error')
        setErrorMessage(error instanceof Error ? error.message : '后端联调失败')
      }
    }

    verifyBackend()

    return () => {
      cancelled = true
    }
  }, [session?.access_token])

  const closeDialog = useCallback(() => {
    if (isSubmitting) return
    setIsOpen(false)
    setMessage('')
    setErrorMessage('')
  }, [isSubmitting])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!client) return

      const emailValue = email.trim()
      if (!emailValue || password.length < 6) {
        setErrorMessage('请输入邮箱和至少 6 位密码')
        return
      }

      setIsSubmitting(true)
      setMessage('')
      setErrorMessage('')

      try {
        const result =
          authMode === 'signin'
            ? await client.auth.signInWithPassword({
                email: emailValue,
                password,
              })
            : await client.auth.signUp({
                email: emailValue,
                password,
                options: {
                  emailRedirectTo: window.location.origin,
                },
              })

        if (result.error) {
          setErrorMessage(result.error.message)
          return
        }

        if (result.data.session) {
          setSession(result.data.session)
          setIsOpen(false)
          setPassword('')
          return
        }

        setMessage('已发送确认邮件，请先在邮箱里确认账号')
      } finally {
        setIsSubmitting(false)
      }
    },
    [authMode, client, email, password],
  )

  const handleOAuthSignIn = useCallback(
    async (provider: OAuthProvider) => {
      if (!client) return

      setIsSubmitting(true)
      setMessage('')
      setErrorMessage('')

      try {
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: window.location.origin,
            ...(provider === 'google'
              ? { scopes: 'openid email profile' }
              : {}),
          },
        })

        if (error) setErrorMessage(error.message)
      } finally {
        setIsSubmitting(false)
      }
    },
    [client],
  )

  const handleSignOut = useCallback(async () => {
    if (!client) return

    setIsSigningOut(true)
    setErrorMessage('')

    try {
      const { error } = await client.auth.signOut()
      if (error) {
        setErrorMessage(error.message)
        return
      }
      setSession(null)
      setBackendUser(null)
      setCloudCounts(null)
      setBackendStatus('idle')
    } finally {
      setIsSigningOut(false)
    }
  }, [client])

  const authConfigured = Boolean(config?.authConfigured && client)
  const oauthProviders = config?.oauthProviders ?? []

  return (
    <div className={cn('relative flex items-center justify-end', className)}>
      {session ? (
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/76 bg-white/76 px-2 py-1.5 shadow-[0_12px_28px_rgba(48,34,22,0.05)] backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2 pl-1">
            <UserCircle className="h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
            <div className="hidden min-w-0 leading-tight sm:block">
              <p className="max-w-[13rem] truncate text-xs font-semibold text-[var(--foreground)]">
                {displayName}
              </p>
              <p className="max-w-[13rem] truncate text-[11px] text-[var(--soft-foreground)]">
                {backendStatus === 'ready' && cloudCounts
                  ? `云端 ${cloudCounts.folders} 文件夹 · ${cloudCounts.notes} 文案`
                  : backendStatus === 'checking'
                    ? '正在联调后端'
                    : backendStatus === 'error'
                      ? '后端待检查'
                      : '已登录'}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleSignOut}
            disabled={isSigningOut}
            aria-label="退出登录"
          >
            {isSigningOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setIsOpen(true)}>
          <LogIn className="h-4 w-4" />
          登录
        </Button>
      )}

      {isOpen ? (
        <div
          className="ui-dialog-backdrop fixed inset-0 z-40 flex items-center justify-center bg-[rgba(28,21,16,0.18)] px-4 py-8 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-dialog-title"
          onClick={closeDialog}
        >
          <div
            className="ui-dialog-card w-full max-w-[26rem] rounded-[var(--ui-radius-dialog)] border border-white/78 bg-white/94 p-5 shadow-[var(--shadow-elevated)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h2 id="auth-dialog-title" className="mt-4 text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {authMode === 'signin' ? '登录 Lumos' : '创建账号'}
                </h2>
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={closeDialog}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-1 rounded-full bg-[var(--secondary)] p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-[var(--ui-control-sm)] shadow-none',
                  authMode === 'signin'
                    ? 'bg-white text-[var(--foreground)] shadow-[0_8px_18px_rgba(48,34,22,0.05)] hover:bg-white'
                    : 'text-[var(--muted-foreground)] hover:bg-white/58',
                )}
                onClick={() => setAuthMode('signin')}
              >
                登录
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-[var(--ui-control-sm)] shadow-none',
                  authMode === 'signup'
                    ? 'bg-white text-[var(--foreground)] shadow-[0_8px_18px_rgba(48,34,22,0.05)] hover:bg-white'
                    : 'text-[var(--muted-foreground)] hover:bg-white/58',
                )}
                onClick={() => setAuthMode('signup')}
              >
                注册
              </Button>
            </div>

            <form className="mt-5 grid gap-[var(--ui-form-gap)]" onSubmit={handleSubmit}>
              <label className="grid gap-[var(--ui-field-gap)]">
                <span className="text-sm font-medium text-[var(--muted-foreground)]">邮箱</span>
                <Input
                  autoComplete="email"
                  inputMode="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label className="grid gap-[var(--ui-field-gap)]">
                <span className="text-sm font-medium text-[var(--muted-foreground)]">密码</span>
                <Input
                  autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 6 位"
                />
              </label>

              {errorMessage ? (
                <p className="rounded-[var(--ui-radius-card)] border border-[rgba(214,90,60,0.16)] bg-[rgba(214,90,60,0.06)] px-3 py-2 text-sm text-[var(--destructive)]">
                  {errorMessage}
                </p>
              ) : null}
              {message ? (
                <p className="flex items-center gap-2 rounded-[var(--ui-radius-card)] border border-[rgba(42,157,143,0.16)] bg-[rgba(232,248,245,0.7)] px-3 py-2 text-sm text-[#17675b]">
                  <CheckCircle2 className="h-4 w-4" />
                  {message}
                </p>
              ) : null}

              <Button type="submit" disabled={!authConfigured || isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {authMode === 'signin' ? '邮箱登录' : '邮箱注册'}
              </Button>
            </form>

            {oauthProviders.length > 0 ? (
              <div className="mt-5 grid gap-3">
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  <span className="text-xs font-medium text-[var(--soft-foreground)]">或</span>
                  <span className="h-px flex-1 bg-[var(--border)]" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {oauthProviders.map((provider) => (
                    <Button
                      key={provider}
                      type="button"
                      variant="outline"
                      disabled={!authConfigured || isSubmitting}
                      onClick={() => handleOAuthSignIn(provider)}
                    >
                      {getProviderIcon(provider)}
                      {providerLabels[provider]}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
