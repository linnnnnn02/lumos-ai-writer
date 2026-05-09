import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { AppConfig } from './env.js'

type ServerSupabaseClient = SupabaseClient

function createServerClient(url: string, key: string): ServerSupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

export function createSupabaseUserClient(config: AppConfig) {
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return null
  return createServerClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
}

export function createSupabaseAdminClient(config: AppConfig) {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServerClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
}

export async function getUserFromAccessToken(config: AppConfig, token: string) {
  const supabase = createSupabaseUserClient(config)
  if (!supabase) return { user: null, error: 'supabase_not_configured' as const }

  const { data, error } = await supabase.auth.getUser(token)
  if (error) return { user: null, error: error.message }

  return { user: data.user, error: null }
}

export function toCurrentUser(user: User) {
  const metadata = user.user_metadata ?? {}
  const displayName =
    typeof metadata.name === 'string'
      ? metadata.name
      : typeof metadata.full_name === 'string'
        ? metadata.full_name
        : null
  const avatarUrl = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null

  return {
    id: user.id,
    email: user.email ?? null,
    displayName,
    avatarUrl,
  }
}
