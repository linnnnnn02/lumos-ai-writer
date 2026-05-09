import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { OAuthProvider, PublicConfigResponse } from '@lumos-ai/shared'
import { getPublicConfig } from './api-client'

type SupabaseBrowserState = {
  client: SupabaseClient | null
  config: PublicConfigResponse
}

let cachedClient: Promise<SupabaseBrowserState> | null = null

function getEnvConfig(): PublicConfigResponse | null {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) return null

  return {
    ok: true,
    authConfigured: true,
    supabaseUrl,
    supabaseAnonKey,
    oauthProviders: ['github', 'google'],
  }
}

function createBrowserClient(config: PublicConfigResponse) {
  if (!config.authConfigured || !config.supabaseUrl || !config.supabaseAnonKey) return null

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

export async function getSupabaseBrowserClient(): Promise<SupabaseBrowserState> {
  cachedClient ??= (async () => {
    const config = getEnvConfig() ?? (await getPublicConfig())
    return {
      client: createBrowserClient(config),
      config,
    }
  })()

  return cachedClient
}

export async function getCurrentAccessToken() {
  const { client } = await getSupabaseBrowserClient()
  if (!client) return null

  const { data, error } = await client.auth.getSession()
  if (error) throw new Error(error.message)

  return data.session?.access_token ?? null
}

export type { OAuthProvider, Session }
