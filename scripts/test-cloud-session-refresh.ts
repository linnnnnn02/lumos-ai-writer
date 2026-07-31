import assert from 'node:assert/strict'
import {
  CLOUD_SESSION_STORAGE_KEY,
  CLOUD_USER_STORAGE_KEY,
  getValidCloudAccessToken,
} from '../extension/lib/cloud-session'

const storage: Record<string, unknown> = {}
const originalChrome = (globalThis as { chrome?: unknown }).chrome
const originalFetch = globalThis.fetch

;(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      async get(key: string) {
        return { [key]: storage[key] }
      },
      async set(values: Record<string, unknown>) {
        Object.assign(storage, values)
      },
      async remove(key: string) {
        delete storage[key]
      },
    },
  },
}

function createSession(input: {
  accessToken: string
  refreshToken: string
  expiresAt: number
}) {
  return {
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
    expires_at: input.expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      email: 'user@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date(0).toISOString(),
    },
  }
}

async function run() {
  let fetchCount = 0
  storage[CLOUD_SESSION_STORAGE_KEY] = createSession({
    accessToken: 'still-valid',
    refreshToken: 'refresh-1',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })
  globalThis.fetch = async () => {
    fetchCount += 1
    throw new Error('A valid session must not refresh')
  }

  assert.equal(await getValidCloudAccessToken(), 'still-valid')
  assert.equal(fetchCount, 0)

  const refreshedSession = createSession({
    accessToken: 'refreshed-token',
    refreshToken: 'refresh-2',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })
  storage[CLOUD_SESSION_STORAGE_KEY] = createSession({
    accessToken: 'expired-token',
    refreshToken: 'refresh-1',
    expiresAt: Math.floor(Date.now() / 1000) - 60,
  })
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/v1/config/public')) {
      return Response.json({
        authConfigured: true,
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-key',
      })
    }
    assert.equal(
      url,
      'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
    )
    return Response.json(refreshedSession)
  }

  assert.equal(await getValidCloudAccessToken(), 'refreshed-token')
  assert.equal(
    (storage[CLOUD_SESSION_STORAGE_KEY] as { access_token: string }).access_token,
    'refreshed-token',
  )

  storage[CLOUD_SESSION_STORAGE_KEY] = createSession({
    accessToken: 'expired-again',
    refreshToken: 'invalid-refresh',
    expiresAt: Math.floor(Date.now() / 1000) - 60,
  })
  storage[CLOUD_USER_STORAGE_KEY] = { id: 'user-1' }
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/v1/config/public')) {
      return Response.json({
        authConfigured: true,
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-key',
      })
    }
    return Response.json({ error_description: 'Invalid refresh token' }, { status: 400 })
  }

  assert.equal(await getValidCloudAccessToken(), null)
  assert.equal(storage[CLOUD_SESSION_STORAGE_KEY], undefined)
  assert.equal(storage[CLOUD_USER_STORAGE_KEY], undefined)
}

async function main() {
  try {
    await run()
    console.info('Cloud session refresh checks passed.')
  } finally {
    globalThis.fetch = originalFetch
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
  }
}

void main()
