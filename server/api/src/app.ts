import { Hono } from 'hono'
import { logger } from 'hono/logger'
import {
  healthResponseSchema,
  listFoldersResponseSchema,
  listNotesResponseSchema,
  listSnippetsResponseSchema,
  meResponseSchema,
} from '@lumos-ai/shared'
import { getDeepSeekConfigStatus } from './ai/deepseek.js'
import { requireCurrentUser } from './auth.js'
import { getConfigChecks, isSupabaseConfigured, readConfig, type RuntimeBindings } from './env.js'
import { getBearerToken, jsonError } from './http.js'
import {
  listFolders,
  listNotes,
  listSnippets,
  SupabaseSchemaMissingError,
} from './library.js'
import { getUserFromAccessToken, toCurrentUser } from './supabase.js'

type ApiVariables = {
  config: ReturnType<typeof readConfig>
  requestId: string
}

type ApiBindings = RuntimeBindings

export type ApiHonoEnv = {
  Bindings: ApiBindings
  Variables: ApiVariables
}

export function createApiApp() {
  const app = new Hono<ApiHonoEnv>()

  app.use('*', logger())

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') || crypto.randomUUID()
    c.set('requestId', requestId)

    try {
      c.set('config', readConfig(c.env))
    } catch {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'API environment variables are invalid.',
        status: 503,
      })
    }

    c.header('x-request-id', requestId)
    await next()
  })

  app.get('/health', (c) => {
    const config = c.get('config')
    return c.json(
      healthResponseSchema.parse({
        ok: true,
        service: 'lumos-api',
        env: config.APP_ENV,
        timestamp: new Date().toISOString(),
        checks: getConfigChecks(config),
      }),
    )
  })

  app.get('/v1/config/status', (c) => {
    const config = c.get('config')
    return c.json({
      ok: true,
      env: config.APP_ENV,
      supabaseConfigured: isSupabaseConfigured(config),
      ai: getDeepSeekConfigStatus(config),
    })
  })

  app.get('/v1/me', async (c) => {
    const config = c.get('config')
    const token = getBearerToken(c.req.header('authorization'))

    if (!token) {
      return c.json(
        meResponseSchema.parse({
          ok: true,
          user: null,
          authConfigured: isSupabaseConfigured(config),
        }),
      )
    }

    const result = await getUserFromAccessToken(config, token)

    if (result.error === 'supabase_not_configured') {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY.',
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

    return c.json(
      meResponseSchema.parse({
        ok: true,
        user: toCurrentUser(result.user),
        authConfigured: true,
      }),
    )
  })

  app.get('/v1/folders', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Folders will be connected after Supabase setup.',
        status: 503,
      })
    }

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const folders = await listFolders(config, user)
      return c.json(listFoldersResponseSchema.parse({ ok: true, folders }))
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
  })

  app.get('/v1/notes', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Notes will be connected after Supabase setup.',
        status: 503,
      })
    }

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const notes = await listNotes(config, user)
      return c.json(listNotesResponseSchema.parse({ ok: true, notes }))
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
  })

  app.get('/v1/snippets', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Snippets will be connected after Supabase setup.',
        status: 503,
      })
    }

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const snippets = await listSnippets(config, user)
      return c.json(listSnippetsResponseSchema.parse({ ok: true, snippets }))
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
  })

  app.notFound((c) =>
    jsonError(c, {
      code: 'not_found',
      message: 'API route not found.',
      status: 404,
    }),
  )

  app.onError((error, c) => {
    console.error(error)
    return jsonError(c, {
      code: 'internal_error',
      message: 'Unexpected API error.',
      status: 500,
    })
  })

  return app
}

export const apiApp = createApiApp()
