import { createClient, type Session } from '@supabase/supabase-js'
import type { CurrentUser, PublicConfigResponse } from '@lumos-ai/shared'

const CLOUD_SESSION_STORAGE_KEY = 'lumosCloudSession'
const CLOUD_USER_STORAGE_KEY = 'lumosCloudUser'
const LOCAL_API_BASE_URL = 'http://localhost:8788/api'
const PRODUCTION_API_BASE_URL = 'https://lumos-ai-writer.pages.dev/api'

export type CloudAuthState =
  | {
      status: 'authenticated'
      user: CurrentUser
    }
  | {
      status: 'unauthenticated'
      user: null
    }

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

async function getStorageValue<T>(key: string): Promise<T | null> {
  if (hasChromeStorage()) {
    const data = await chrome.storage.local.get(key)
    return (data[key] as T | undefined) ?? null
  }

  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

async function setStorageValue<T>(key: string, value: T | null) {
  if (hasChromeStorage()) {
    if (value === null) {
      await chrome.storage.local.remove(key)
      return
    }
    await chrome.storage.local.set({ [key]: value })
    return
  }

  try {
    if (value === null) {
      globalThis.localStorage?.removeItem(key)
    } else {
      globalThis.localStorage?.setItem(key, JSON.stringify(value))
    }
  } catch {
    // Extension preview can still render even when localStorage is unavailable.
  }
}

export function getCloudApiBaseUrl() {
  const env = (import.meta as unknown as {
    env?: Record<string, string | undefined>
  }).env
  const fallbackUrl = env?.COMMAND === 'serve' ? LOCAL_API_BASE_URL : PRODUCTION_API_BASE_URL
  return (env?.WXT_PUBLIC_API_BASE_URL || fallbackUrl).replace(/\/+$/, '')
}

async function getPublicConfig(): Promise<PublicConfigResponse> {
  const response = await fetch(`${getCloudApiBaseUrl()}/v1/config/public`)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message || '云端配置读取失败')
  }

  return data as PublicConfigResponse
}

function getDisplayNameFromSession(session: Session) {
  const metadata = session.user.user_metadata ?? {}
  if (typeof metadata.name === 'string') return metadata.name
  if (typeof metadata.full_name === 'string') return metadata.full_name
  return null
}

function getAvatarUrlFromSession(session: Session) {
  const avatarUrl = session.user.user_metadata?.avatar_url
  return typeof avatarUrl === 'string' ? avatarUrl : null
}

function toCurrentUser(session: Session): CurrentUser {
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    displayName: getDisplayNameFromSession(session),
    avatarUrl: getAvatarUrlFromSession(session),
  }
}

async function createSupabaseAuthClient() {
  const config = await getPublicConfig()
  if (!config.authConfigured || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('云端登录还没有配置好')
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

export async function getCloudAuthState(): Promise<CloudAuthState> {
  const user = await getStorageValue<CurrentUser>(CLOUD_USER_STORAGE_KEY)
  const session = await getStorageValue<Session>(CLOUD_SESSION_STORAGE_KEY)

  if (!user || !session?.access_token) {
    return { status: 'unauthenticated', user: null }
  }

  return { status: 'authenticated', user }
}

async function saveCloudSession(session: Session) {
  await Promise.all([
    setStorageValue(CLOUD_SESSION_STORAGE_KEY, session),
    setStorageValue(CLOUD_USER_STORAGE_KEY, toCurrentUser(session)),
  ])
}

export async function signInToCloud(email: string, password: string): Promise<CloudAuthState> {
  const supabase = await createSupabaseAuthClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw new Error(error.message)
  if (!data.session) throw new Error('登录没有返回有效 session')

  await saveCloudSession(data.session)
  return {
    status: 'authenticated',
    user: toCurrentUser(data.session),
  }
}

export async function signOutFromCloud() {
  await Promise.all([
    setStorageValue(CLOUD_SESSION_STORAGE_KEY, null),
    setStorageValue(CLOUD_USER_STORAGE_KEY, null),
  ])
}

export async function getValidCloudAccessToken() {
  const session = await getStorageValue<Session>(CLOUD_SESSION_STORAGE_KEY)
  if (!session?.access_token) return null

  const expiresAtMs = (session.expires_at ?? 0) * 1000
  if (expiresAtMs > Date.now() + 60_000) return session.access_token

  const supabase = await createSupabaseAuthClient()
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: session.refresh_token,
  })

  if (error || !data.session) {
    await signOutFromCloud()
    return null
  }

  await saveCloudSession(data.session)
  return data.session.access_token
}
