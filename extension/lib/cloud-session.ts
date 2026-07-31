import type { Session } from '@supabase/supabase-js'

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

export async function getStoredCloudAccessToken() {
  const session = await getCloudStorageValue<Session>(CLOUD_SESSION_STORAGE_KEY)
  if (!session?.access_token) return null

  const expiresAtMs = (session.expires_at ?? 0) * 1000
  return expiresAtMs > Date.now() + 5_000 ? session.access_token : null
}
