import type { Context } from 'hono'
import type { User } from '@supabase/supabase-js'
import type { ApiHonoEnv } from './app.js'
import { getBearerToken, jsonError } from './http.js'
import { SupabaseSchemaMissingError, upsertUserProfile } from './library.js'
import { getUserFromAccessToken } from './supabase.js'

export async function requireCurrentUser(c: Context<ApiHonoEnv>): Promise<User | Response> {
  const config = c.get('config')
  const token = getBearerToken(c.req.header('authorization'))

  if (!token) {
    return jsonError(c, {
      code: 'unauthorized',
      message: 'Login is required for this API.',
      status: 401,
    })
  }

  const result = await getUserFromAccessToken(config, token)

  if (result.error === 'supabase_not_configured') {
    return jsonError(c, {
      code: 'service_not_configured',
      message: 'Supabase is not configured yet.',
      status: 503,
    })
  }

  if (result.error || !result.user) {
    return jsonError(c, {
      code: 'unauthorized',
      message: 'Login token is invalid or expired.',
      status: 401,
    })
  }

  try {
    await upsertUserProfile(config, result.user)
  } catch (error) {
    if (error instanceof SupabaseSchemaMissingError) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase tables are not created yet. Run server/api/migrations/001_initial_schema.sql.',
        status: 503,
      })
    }
    throw error
  }

  return result.user
}
