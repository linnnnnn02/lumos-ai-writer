import { useMemo, useState } from 'react'
import type { CurrentUser } from '@lumos-ai/shared'
import type { Session } from '@supabase/supabase-js'
import { Loader2, LogIn, LogOut, ShieldCheck, X } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'

export type AuthCloudSummary = {
  status: 'idle' | 'checking' | 'ready' | 'error'
  user: CurrentUser | null
  counts: {
    folders: number
    notes: number
    snippets: number
  } | null
}

type AuthStatusProps = {
  className?: string
  cloudSummary?: AuthCloudSummary
}

function getAuthDisplayName(user: CurrentUser | null, session: Session | null) {
  return user?.displayName || user?.email || session?.user.email || '已登录用户'
}

function getSessionAvatarUrl(session: Session | null) {
  const avatarUrl = session?.user.user_metadata?.avatar_url
  return typeof avatarUrl === 'string' ? avatarUrl : null
}

function getFriendlyAuthError(message: string) {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('unexpected end of json') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror')
  ) {
    return '登录服务暂时未连接，请稍后再试。'
  }
  if (
    normalized.includes('unsupported provider') ||
    normalized.includes('provider is not enabled') ||
    normalized.includes('redirect')
  ) {
    return 'Google 登录正在配置中，请稍后再试。'
  }
  return message || 'Google 登录暂时不可用，请稍后再试。'
}

function isLegacyRecoveryStatus(status: string) {
  return (
    status === 'recovery-confirmation' ||
    status === 'recovery' ||
    status === 'recovery-success' ||
    status === 'recovery-error'
  )
}

export function AuthStatus({ className, cloudSummary }: AuthStatusProps) {
  const {
    status: authStatus,
    client,
    config,
    session,
    error: authError,
    cancelPasswordRecovery,
    signOut,
  } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const backendUser = cloudSummary?.user ?? null
  const backendStatus = cloudSummary?.status ?? (session ? 'ready' : 'idle')
  const cloudCounts = cloudSummary?.counts ?? null
  const displayName = useMemo(() => getAuthDisplayName(backendUser, session), [backendUser, session])
  const avatarUrl = backendUser?.avatarUrl || getSessionAvatarUrl(session) || '/icon.svg'
  const authConfigured = Boolean(config?.authConfigured && client)
  const googleEnabled = Boolean(config?.oauthProviders.includes('google'))
  const recoveryLocked = isLegacyRecoveryStatus(authStatus)
  const dialogOpen = isOpen || recoveryLocked
  const displayedErrorMessage =
    errorMessage || (authStatus === 'error' ? getFriendlyAuthError(authError) : '')

  function closeDialog() {
    if (isSubmitting || recoveryLocked) return
    setIsOpen(false)
    setErrorMessage('')
  }

  async function handleGoogleSignIn() {
    if (!client || !authConfigured || !googleEnabled) {
      setErrorMessage('Google 登录正在配置中，请稍后再试。')
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          scopes: 'openid email profile',
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) setErrorMessage(getFriendlyAuthError(error.message))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleExitLegacyRecovery() {
    if (isSubmitting) return
    setIsSubmitting(true)
    setErrorMessage('')
    try {
      await cancelPasswordRecovery()
      setIsOpen(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true)
    setErrorMessage('')
    try {
      const error = await signOut()
      if (error) setErrorMessage(getFriendlyAuthError(error))
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className={cn('relative flex items-center justify-end', className)}>
      {session ? (
        <div className="flex min-w-0 items-center gap-[var(--ui-gap-control)] rounded-full border border-white/76 bg-white/76 px-[var(--ui-space-2)] py-[var(--ui-space-1)] shadow-[0_12px_28px_rgba(48,34,22,0.05)] backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2 pl-1">
            <img
              src={avatarUrl}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full object-cover shadow-[0_6px_14px_rgba(48,34,22,0.1)]"
              referrerPolicy="no-referrer"
              decoding="async"
            />
            <div className="hidden min-w-0 leading-tight sm:block">
              <p className="max-w-[13rem] truncate text-xs font-semibold text-[var(--foreground)]">
                {displayName}
              </p>
              <p className="max-w-[13rem] truncate text-[length:var(--ui-text-caption)] text-[var(--soft-foreground)]">
                {backendStatus === 'ready' && cloudCounts
                  ? `云端 ${cloudCounts.folders} 文件夹 · ${cloudCounts.notes} 文案`
                  : backendStatus === 'checking'
                    ? '正在同步'
                    : backendStatus === 'error'
                      ? '云端未同步'
                      : '已登录'}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleSignOut}
            disabled={isSigningOut}
            aria-label="退出登录"
          >
            {isSigningOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setErrorMessage('')
            setIsOpen(true)
          }}
        >
          <LogIn className="h-4 w-4" />
          登录
        </Button>
      )}

      {dialogOpen ? (
        <div
          className="ui-dialog-backdrop fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[rgba(28,21,16,0.18)] px-[var(--ui-page-gutter)] py-[var(--ui-space-4)] backdrop-blur-md sm:py-[var(--ui-space-6)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-dialog-title"
          onClick={closeDialog}
        >
          <div
            data-testid="auth-dialog-card"
            className="ui-dialog-card w-full max-w-[25rem] overflow-hidden rounded-[var(--ui-radius-dialog)] border border-white/78 bg-white/94 shadow-[var(--shadow-elevated)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-black/[0.045] px-5 py-5 sm:px-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 id="auth-dialog-title" className="text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {recoveryLocked ? '登录方式已更新' : '登录 Lumos'}
                </h2>
                {recoveryLocked ? (
                  <p className="mt-1 text-sm leading-5 text-[var(--muted-foreground)]">
                    邮箱密码登录已停止使用。
                  </p>
                ) : null}
              </div>
              {!recoveryLocked ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label="关闭登录窗口"
                  onClick={closeDialog}
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            <div className="grid gap-4 px-5 py-5 sm:px-6 sm:py-6">
              {recoveryLocked ? (
                <>
                  <p className="rounded-[var(--ui-radius-card)] bg-[var(--secondary)] px-4 py-4 text-sm leading-6 text-[var(--muted-foreground)]" role="status">
                    这个邮箱重置链接不再需要。返回后请直接使用 Google 账号登录。
                  </p>
                  <Button type="button" disabled={isSubmitting} onClick={handleExitLegacyRecovery}>
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                    返回 Google 登录
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                    登录后会自动同步你的文案库、项目和写作偏好。
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full bg-white text-[var(--foreground)] hover:bg-[var(--secondary)]"
                    disabled={!authConfigured || !googleEnabled || isSubmitting}
                    onClick={handleGoogleSignIn}
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <img src="/google-icon.svg" alt="" className="h-5 w-5" aria-hidden="true" />
                    )}
                    使用 Google 账号继续
                  </Button>
                  {!authConfigured || !googleEnabled ? (
                    <p className="text-center text-xs leading-5 text-[var(--soft-foreground)]" role="status">
                      Google 登录正在配置中
                    </p>
                  ) : null}
                </>
              )}

              {displayedErrorMessage ? (
                <p className="rounded-[var(--ui-radius-card)] border border-[rgba(214,90,60,0.16)] bg-[rgba(214,90,60,0.06)] px-3 py-2 text-sm text-[var(--destructive)]" role="alert">
                  {displayedErrorMessage}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
