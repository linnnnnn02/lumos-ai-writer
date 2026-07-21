import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { CurrentUser, OAuthProvider } from '@lumos-ai/shared'
import type { Session } from '@supabase/supabase-js'
import {
  CheckCircle2,
  Eye,
  Github,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  X,
} from '@/components/ui/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getCurrentUser, getFolders, getNotes, getSnippets } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-context'

type AuthView =
  | 'signin'
  | 'signup'
  | 'signup-sent'
  | 'recovery-request'
  | 'recovery-sent'
  | 'password-update'
  | 'password-updated'
  | 'recovery-error'

type BackendStatus = 'idle' | 'checking' | 'ready' | 'error'

type CloudCounts = {
  folders: number
  notes: number
  snippets: number
}

type AuthStatusProps = {
  className?: string
}

type PasswordFieldProps = {
  id: string
  label: string
  value: string
  visible: boolean
  autoComplete: 'current-password' | 'new-password'
  onChange: (value: string) => void
  onToggleVisibility: () => void
}

const RECOVERY_COOLDOWN_SECONDS = 60

const providerLabels: Record<OAuthProvider, string> = {
  github: 'GitHub',
  google: 'Google',
}

function getProviderIcon(provider: OAuthProvider) {
  if (provider === 'github') return <Github className="h-4 w-4" />
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[length:var(--ui-text-caption)] font-bold text-[#4285f4]">
      G
    </span>
  )
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
  if (normalized.includes('invalid login credentials')) return '邮箱或密码不正确，请重新输入。'
  if (normalized.includes('email not confirmed')) return '请先打开确认邮件，完成账号确认。'
  if (normalized.includes('rate limit')) return '发送次数过多，请稍后再试。'
  if (normalized.includes('same password')) return '新密码不能与当前密码相同。'
  if (normalized.includes('expired') || normalized.includes('otp')) {
    return '这个重置链接已失效或已过期，请重新发送邮件。'
  }
  return message || '登录服务暂时不可用，请稍后再试。'
}

function getAuthTitle(view: AuthView) {
  if (view === 'signin') return '登录 Lumos'
  if (view === 'signup') return '创建账号'
  if (view === 'signup-sent') return '确认邮件已发送'
  if (view === 'recovery-request') return '找回密码'
  if (view === 'recovery-sent') return '重置邮件已发送'
  if (view === 'password-update') return '设置新密码'
  if (view === 'password-updated') return '密码修改成功'
  return '重置链接已失效'
}

function getAuthDescription(view: AuthView) {
  if (view === 'signup-sent') return '账号尚未确认。请打开邮件中的链接，再返回 Lumos 登录。'
  if (view === 'recovery-request') return '我们会向注册邮箱发送重置链接，不会立即修改密码。'
  if (view === 'recovery-sent') return '密码尚未修改。请打开邮件中的链接，然后设置新密码。'
  if (view === 'password-update') return '保存成功前，你仍处于账号恢复状态，不会进入项目。'
  if (view === 'password-updated') return '新密码已经生效。确认进入后才会加载你的项目和文案库。'
  if (view === 'recovery-error') return '重新发送一封邮件，使用最新链接继续。'
  return ''
}

function PasswordField({
  id,
  label,
  value,
  visible,
  autoComplete,
  onChange,
  onToggleVisibility,
}: PasswordFieldProps) {
  return (
    <div className="grid gap-[var(--ui-field-gap)]">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-[var(--muted-foreground)]">
          {label}
        </label>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold text-[var(--accent-strong)] transition hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
          onClick={onToggleVisibility}
          aria-label={`${visible ? '隐藏' : '显示'}${label}`}
        >
          <Eye className="h-3.5 w-3.5" />
          {visible ? '隐藏' : '显示'}
        </button>
      </div>
      <Input
        id={id}
        autoComplete={autoComplete}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="至少 6 位"
      />
    </div>
  )
}

export function AuthStatus({ className }: AuthStatusProps) {
  const {
    status: authStatus,
    client,
    config,
    session,
    error: authError,
    completePasswordRecovery,
    finishPasswordRecovery,
    cancelPasswordRecovery,
    signOut,
  } = useAuth()
  const [backendUser, setBackendUser] = useState<CurrentUser | null>(null)
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('idle')
  const [cloudCounts, setCloudCounts] = useState<CloudCounts | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [localView, setView] = useState<AuthView>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [confirmationVisible, setConfirmationVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)

  const displayName = useMemo(
    () => getAuthDisplayName(backendUser, session),
    [backendUser, session],
  )
  const avatarUrl = backendUser?.avatarUrl || getSessionAvatarUrl(session) || '/icon.svg'
  const authConfigured = Boolean(config?.authConfigured && client)
  const oauthProviders = config?.oauthProviders ?? []
  const view: AuthView =
    authStatus === 'recovery'
      ? 'password-update'
      : authStatus === 'recovery-success'
        ? 'password-updated'
        : authStatus === 'recovery-error'
          ? 'recovery-error'
          : localView
  const description = getAuthDescription(view)
  const recoveryLocked =
    view === 'password-update' ||
    view === 'password-updated' ||
    view === 'recovery-error'
  const dialogOpen = isOpen || recoveryLocked
  const displayedErrorMessage =
    errorMessage ||
    (view === 'recovery-error' || authStatus === 'error'
      ? getFriendlyAuthError(authError)
      : '')

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = window.setInterval(() => {
      setCooldownSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [cooldownSeconds])

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
        setErrorMessage(
          getFriendlyAuthError(error instanceof Error ? error.message : '云端连接失败'),
        )
      }
    }

    void verifyBackend()
    return () => {
      cancelled = true
    }
  }, [session?.access_token])

  function resetFields() {
    setPassword('')
    setPasswordConfirmation('')
    setPasswordVisible(false)
    setConfirmationVisible(false)
  }

  function switchView(nextView: AuthView) {
    setView(nextView)
    resetFields()
    setMessage('')
    setErrorMessage('')
  }

  function closeDialog() {
    if (isSubmitting || recoveryLocked) return
    setIsOpen(false)
    setMessage('')
    setErrorMessage('')
  }

  async function sendRecoveryEmail() {
    if (!client) return false
    const emailValue = email.trim()
    if (!emailValue) {
      setErrorMessage('请输入注册邮箱。')
      return false
    }

    const { error } = await client.auth.resetPasswordForEmail(emailValue, {
      redirectTo: window.location.origin,
    })
    if (error) {
      setErrorMessage(getFriendlyAuthError(error.message))
      return false
    }

    if (authStatus === 'recovery-error') {
      await cancelPasswordRecovery()
      setIsOpen(true)
    }
    setEmail(emailValue)
    setCooldownSeconds(RECOVERY_COOLDOWN_SECONDS)
    setView('recovery-sent')
    setMessage('重置邮件已发送。')
    setErrorMessage('')
    return true
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client) return

    const emailValue = email.trim()
    if ((view === 'signin' || view === 'signup') && !emailValue) {
      setErrorMessage('请输入邮箱。')
      return
    }
    if ((view === 'signin' || view === 'signup' || view === 'password-update') && password.length < 6) {
      setErrorMessage(view === 'password-update' ? '请输入至少 6 位新密码。' : '请输入至少 6 位密码。')
      return
    }
    if ((view === 'signup' || view === 'password-update') && password !== passwordConfirmation) {
      setErrorMessage('两次输入的密码不一致。')
      return
    }

    setIsSubmitting(true)
    setMessage('')
    setErrorMessage('')

    try {
      if (view === 'recovery-request' || view === 'recovery-error') {
        await sendRecoveryEmail()
        return
      }

      if (view === 'password-update') {
        const error = await completePasswordRecovery(password)
        if (error) setErrorMessage(getFriendlyAuthError(error))
        return
      }

      if (view === 'signin') {
        const result = await client.auth.signInWithPassword({
          email: emailValue,
          password,
        })
        if (result.error) {
          setErrorMessage(getFriendlyAuthError(result.error.message))
          return
        }
        resetFields()
        setIsOpen(false)
        return
      }

      if (view === 'signup') {
        const result = await client.auth.signUp({
          email: emailValue,
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (result.error) {
          setErrorMessage(getFriendlyAuthError(result.error.message))
          return
        }
        if (result.data.session) {
          resetFields()
          setIsOpen(false)
          return
        }
        if (result.data.user?.identities?.length === 0) {
          switchView('signin')
          setMessage('这个邮箱可能已经注册，请直接登录或重置密码。')
          return
        }

        setEmail(emailValue)
        resetFields()
        setCooldownSeconds(RECOVERY_COOLDOWN_SECONDS)
        setView('signup-sent')
        setMessage('确认邮件已发送。')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResendRecovery() {
    if (cooldownSeconds > 0 || isSubmitting) return
    setIsSubmitting(true)
    try {
      await sendRecoveryEmail()
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResendSignup() {
    if (!client || cooldownSeconds > 0 || isSubmitting) return
    const emailValue = email.trim()
    if (!emailValue) {
      switchView('signup')
      setErrorMessage('请重新输入注册邮箱。')
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')
    try {
      const { error } = await client.auth.resend({
        type: 'signup',
        email: emailValue,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) {
        setErrorMessage(getFriendlyAuthError(error.message))
        return
      }
      setCooldownSeconds(RECOVERY_COOLDOWN_SECONDS)
      setMessage('确认邮件已重新发送。')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleFinishRecovery() {
    if (isSubmitting) return
    setIsSubmitting(true)
    setErrorMessage('')
    try {
      const error = await finishPasswordRecovery()
      if (error) setErrorMessage(getFriendlyAuthError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleCancelRecovery() {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await cancelPasswordRecovery()
      switchView('signin')
      setIsOpen(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleOAuthSignIn(provider: OAuthProvider) {
    if (!client) return
    setIsSubmitting(true)
    setMessage('')
    setErrorMessage('')
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin,
          ...(provider === 'google' ? { scopes: 'openid email profile' } : {}),
        },
      })
      if (error) setErrorMessage(getFriendlyAuthError(error.message))
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
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/76 bg-white/76 px-2 py-1.5 shadow-[0_12px_28px_rgba(48,34,22,0.05)] backdrop-blur-xl">
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
            size="icon"
            className="size-[var(--ui-control-height-sm)]"
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
            switchView('signin')
            setIsOpen(true)
          }}
        >
          <LogIn className="h-4 w-4" />
          登录
        </Button>
      )}

      {dialogOpen ? (
        <div
          className="ui-dialog-backdrop fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[rgba(28,21,16,0.18)] px-4 py-4 backdrop-blur-md sm:py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-dialog-title"
          onClick={closeDialog}
        >
          <div
            data-testid="auth-dialog-card"
            className="ui-dialog-card flex h-[min(36rem,calc(100dvh-2rem))] w-full max-w-[29rem] flex-col overflow-hidden rounded-[var(--ui-radius-dialog)] border border-white/78 bg-white/94 p-0 shadow-[var(--shadow-elevated)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start gap-3 border-b border-black/[0.045] px-5 py-5 sm:px-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 id="auth-dialog-title" className="text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {getAuthTitle(view)}
                </h2>
                {description ? (
                  <p className="mt-1 max-w-sm text-sm leading-5 text-[var(--muted-foreground)]">
                    {description}
                  </p>
                ) : null}
              </div>
              {!recoveryLocked ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-[var(--ui-control-height-sm)] shrink-0"
                  aria-label="关闭登录窗口"
                  onClick={closeDialog}
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
              {view === 'signin' || view === 'signup' ? (
              <div className="mt-4 grid shrink-0 grid-cols-2 gap-1 rounded-full bg-[var(--secondary)] p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-[var(--ui-control-height-sm)] shadow-none',
                    view === 'signin'
                      ? 'bg-white text-[var(--foreground)] shadow-[0_8px_18px_rgba(48,34,22,0.05)] hover:bg-white'
                      : 'text-[var(--muted-foreground)] hover:bg-white/58',
                  )}
                  onClick={() => switchView('signin')}
                >
                  登录
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-[var(--ui-control-height-sm)] shadow-none',
                    view === 'signup'
                      ? 'bg-white text-[var(--foreground)] shadow-[0_8px_18px_rgba(48,34,22,0.05)] hover:bg-white'
                      : 'text-[var(--muted-foreground)] hover:bg-white/58',
                  )}
                  onClick={() => switchView('signup')}
                >
                  注册
                </Button>
              </div>
              ) : null}

              {view === 'signup-sent' || view === 'recovery-sent' ? (
              <div className="mt-4 grid gap-3">
                <div className="rounded-[var(--ui-radius-card)] border border-[rgba(42,157,143,0.16)] bg-[rgba(232,248,245,0.7)] px-4 py-4 text-sm leading-6 text-[#17675b]" role="status">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    {message}
                  </div>
                  <p className="mt-2 text-[#2c6f66]">已发送至 {email}</p>
                </div>
                {displayedErrorMessage ? (
                  <p className="rounded-[var(--ui-radius-card)] border border-[rgba(214,90,60,0.16)] bg-[rgba(214,90,60,0.06)] px-3 py-2 text-sm text-[var(--destructive)]" role="alert">
                    {displayedErrorMessage}
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting || cooldownSeconds > 0}
                  onClick={view === 'signup-sent' ? handleResendSignup : handleResendRecovery}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {cooldownSeconds > 0 ? `重新发送（${cooldownSeconds}s）` : '重新发送邮件'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => switchView(view === 'signup-sent' ? 'signup' : 'recovery-request')}
                >
                  修改邮箱
                </Button>
                <Button type="button" variant="ghost" onClick={() => switchView('signin')}>
                  返回登录
                </Button>
              </div>
              ) : view === 'password-updated' ? (
              <div className="mt-4 grid gap-3">
                <div className="rounded-[var(--ui-radius-card)] border border-[rgba(42,157,143,0.16)] bg-[rgba(232,248,245,0.7)] px-4 py-4 text-sm leading-6 text-[#17675b]" role="status">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    新密码已经生效
                  </div>
                </div>
                {displayedErrorMessage ? (
                  <p className="rounded-[var(--ui-radius-card)] border border-[rgba(214,90,60,0.16)] bg-[rgba(214,90,60,0.06)] px-3 py-2 text-sm text-[var(--destructive)]" role="alert">
                    {displayedErrorMessage}
                  </p>
                ) : null}
                <Button type="button" disabled={isSubmitting} onClick={handleFinishRecovery}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                  进入 Lumos
                </Button>
                <Button type="button" variant="ghost" disabled={isSubmitting} onClick={handleCancelRecovery}>
                  退出并返回登录
                </Button>
              </div>
              ) : (
              <form className="mt-4 grid content-start gap-[var(--ui-form-gap)]" onSubmit={handleSubmit}>
                {view !== 'password-update' ? (
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
                ) : null}

                {view === 'signin' || view === 'signup' || view === 'password-update' ? (
                  <PasswordField
                    id="auth-password"
                    label={view === 'password-update' ? '新密码' : '密码'}
                    value={password}
                    visible={passwordVisible}
                    autoComplete={view === 'signin' ? 'current-password' : 'new-password'}
                    onChange={setPassword}
                    onToggleVisibility={() => setPasswordVisible((current) => !current)}
                  />
                ) : null}

                {view === 'signup' || view === 'password-update' ? (
                  <PasswordField
                    id="auth-password-confirmation"
                    label={view === 'password-update' ? '再次输入新密码' : '再次输入密码'}
                    value={passwordConfirmation}
                    visible={confirmationVisible}
                    autoComplete="new-password"
                    onChange={setPasswordConfirmation}
                    onToggleVisibility={() => setConfirmationVisible((current) => !current)}
                  />
                ) : null}

                {view === 'signin' ? (
                  <Button
                    type="button"
                    variant="subtle"
                    className="h-auto w-full justify-between whitespace-normal px-3 py-2.5 text-left shadow-none"
                    onClick={() => switchView('recovery-request')}
                  >
                    <span className="grid gap-0.5">
                      <span>忘记密码？</span>
                      <span className="text-xs font-normal text-[var(--muted-foreground)]">
                        发送链接到注册邮箱，重新设置密码
                      </span>
                    </span>
                    <Mail className="h-4 w-4 shrink-0 text-[var(--accent-strong)]" />
                  </Button>
                ) : null}

                {displayedErrorMessage ? (
                  <p className="rounded-[var(--ui-radius-card)] border border-[rgba(214,90,60,0.16)] bg-[rgba(214,90,60,0.06)] px-3 py-2 text-sm text-[var(--destructive)]" role="alert">
                    {displayedErrorMessage}
                  </p>
                ) : null}
                {message ? (
                  <p className="flex items-center gap-2 rounded-[var(--ui-radius-card)] border border-[rgba(42,157,143,0.16)] bg-[rgba(232,248,245,0.7)] px-3 py-2 text-sm text-[#17675b]" role="status">
                    <CheckCircle2 className="h-4 w-4" />
                    {message}
                  </p>
                ) : null}

                <Button type="submit" disabled={!authConfigured || isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {view === 'signin'
                    ? '邮箱登录'
                    : view === 'signup'
                      ? '创建账号'
                      : view === 'password-update'
                        ? '保存新密码'
                        : view === 'recovery-error'
                          ? '重新发送重置邮件'
                          : '发送重置邮件'}
                </Button>

                {view === 'recovery-request' ? (
                  <Button type="button" variant="ghost" onClick={() => switchView('signin')}>
                    返回登录
                  </Button>
                ) : null}
                {view === 'password-update' || view === 'recovery-error' ? (
                  <Button type="button" variant="ghost" disabled={isSubmitting} onClick={handleCancelRecovery}>
                    取消并返回登录
                  </Button>
                ) : null}
              </form>
              )}

              {oauthProviders.length > 0 && (view === 'signin' || view === 'signup') ? (
              <div className="mt-auto grid gap-3 pt-5">
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
        </div>
      ) : null}
    </div>
  )
}
