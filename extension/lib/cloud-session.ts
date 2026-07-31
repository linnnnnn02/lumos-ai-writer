import type { Session } from '@supabase/supabase-js'
import type { PublicConfigResponse } from '@lumos-ai/shared'
import { getCloudApiBaseUrl } from './cloud-config'

export const CLOUD_SESSION_STORAGE_KEY = 'lumosCloudSession'
export const CLOUD_USER_STORAGE_KEY = 'lumosCloudUser'

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

export async function getCloudStorageValue<T>(key: string) {
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

export async function setCloudStorageValue<T>(key: string, value: T | null) {
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
    // Extension preview can still render when localStorage is unavailable.
  }
}

export async function getCloudPublicConfig(): Promise<PublicConfigResponse> {
  const response = await fetch(`${getCloudApiBaseUrl()}/v1/config/public`)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message || '云端配置读取失败')
  }

  return data as PublicConfigResponse
}

async function clearStoredCloudSession() {
  await Promise.all([
    setCloudStorageValue(CLOUD_SESSION_STORAGE_KEY, null),
    setCloudStorageValue(CLOUD_USER_STORAGE_KEY, null),
  ])
}

export async function getValidCloudAccessToken() {
  const session = await getCloudStorageValue<Session>(CLOUD_SESSION_STORAGE_KEY)
  if (!session?.access_token) return null

  const expiresAtMs = (session.expires_at ?? 0) * 1000
  if (expiresAtMs > Date.now() + 60_000) return session.access_token
  if (!session.refresh_token) {
    await clearStoredCloudSession()
    return null
  }

  const config = await getCloudPublicConfig()
  if (!config.authConfigured || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('云端登录还没有配置好')
  }

  const response = await fetch(
    `${config.supabaseUrl.replace(/\/+$/, '')}/auth/v1/token?grant_type=refresh_token`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    },
  )
  const refreshedSession = (await response.json()) as Session

  if (!response.ok || !refreshedSession.access_token) {
    await clearStoredCloudSession()
    return null
  }

  const normalizedSession = {
    ...refreshedSession,
    expires_at:
      refreshedSession.expires_at ??
      Math.floor(Date.now() / 1000) + (refreshedSession.expires_in ?? 3600),
  }
  await setCloudStorageValue(CLOUD_SESSION_STORAGE_KEY, normalizedSession)
  return normalizedSession.access_token
}
