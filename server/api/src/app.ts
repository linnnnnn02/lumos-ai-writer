import { Hono, type Context } from 'hono'
import { logger } from 'hono/logger'
import type { User } from '@supabase/supabase-js'
import { ZodError, type ZodSchema } from 'zod'
import {
  analyzeReferencesRequestSchema,
  analyzeReferencesResponseSchema,
  createFolderRequestSchema,
  createFolderResponseSchema,
  configStatusResponseSchema,
  createSnippetRequestSchema,
  createSnippetResponseSchema,
  generateDraftRequestSchema,
  generateDraftResponseSchema,
  healthResponseSchema,
  listFoldersResponseSchema,
  listNotesResponseSchema,
  listSnippetsResponseSchema,
  meResponseSchema,
  publicConfigResponseSchema,
  upsertNoteRequestSchema,
  upsertNoteResponseSchema,
  type OAuthProvider,
} from '@lumos-ai/shared'
import {
  analyzeReferencesWithDeepSeek,
  DEEPSEEK_ANALYZE_MODEL,
  DEEPSEEK_DRAFT_MODEL,
  DeepSeekNotConfiguredError,
  DeepSeekUpstreamError,
  generateDraftWithDeepSeek,
  getDeepSeekConfigStatus,
} from './ai/deepseek.js'
import { requireCurrentUser } from './auth.js'
import { getConfigChecks, isSupabaseConfigured, readConfig, type RuntimeBindings } from './env.js'
import { getBearerToken, jsonError } from './http.js'
import {
  createFolder,
  createSnippet,
  listFolders,
  listNotes,
  listSnippets,
  recordAiRun,
  SupabaseSchemaMissingError,
  upsertNote,
  upsertUserProfile,
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

const supportedOAuthProviders = new Set<OAuthProvider>(['github', 'google'])

function getOAuthProviders(rawProviders: string): OAuthProvider[] {
  return rawProviders
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is OAuthProvider =>
      supportedOAuthProviders.has(provider as OAuthProvider),
    )
}

async function parseJsonBody<T>(c: Context<ApiHonoEnv>, schema: ZodSchema<T>) {
  try {
    return schema.parse(await c.req.json())
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return jsonError(c, {
        code: 'validation_failed',
        message: 'Request body is invalid.',
        status: 400,
      })
    }
    throw error
  }
}

function getSchemaMissingErrorResponse(c: Context<ApiHonoEnv>) {
  return jsonError(c, {
    code: 'service_not_configured',
    message: 'Supabase tables are not created yet. Run server/api/migrations/001_initial_schema.sql.',
    status: 503,
  })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Unknown error'
}

async function recordAiRunSafely(
  config: ApiVariables['config'],
  user: User,
  input: Parameters<typeof recordAiRun>[2],
) {
  try {
    await recordAiRun(config, user, input)
  } catch (error) {
    console.warn('Failed to record ai_runs row.', error)
  }
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
    return c.json(
      configStatusResponseSchema.parse({
        ok: true,
        env: config.APP_ENV,
        supabaseConfigured: isSupabaseConfigured(config),
        ai: getDeepSeekConfigStatus(config),
      }),
    )
  })

  app.get('/v1/config/public', (c) => {
    const config = c.get('config')
    const authConfigured = isSupabaseConfigured(config)

    return c.json(
      publicConfigResponseSchema.parse({
        ok: true,
        authConfigured,
        supabaseUrl: authConfigured ? config.SUPABASE_URL : null,
        supabaseAnonKey: authConfigured ? config.SUPABASE_ANON_KEY : null,
        oauthProviders: getOAuthProviders(config.AUTH_OAUTH_PROVIDERS),
      }),
    )
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
        return getSchemaMissingErrorResponse(c)
      }
      throw error
    }
  })

  app.post('/v1/folders', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Folders will be connected after Supabase setup.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, createFolderRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const folder = await createFolder(config, user, body)
      return c.json(createFolderResponseSchema.parse({ ok: true, folder }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
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
        return getSchemaMissingErrorResponse(c)
      }
      throw error
    }
  })

  app.post('/v1/notes', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Notes will be connected after Supabase setup.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, upsertNoteRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const note = await upsertNote(config, user, body)
      return c.json(upsertNoteResponseSchema.parse({ ok: true, note }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
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
        return getSchemaMissingErrorResponse(c)
      }
      throw error
    }
  })

  app.post('/v1/snippets', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Snippets will be connected after Supabase setup.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, createSnippetRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const snippet = await createSnippet(config, user, body)
      return c.json(createSnippetResponseSchema.parse({ ok: true, snippet }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      throw error
    }
  })

  app.post('/v1/ai/analyze', async (c) => {
    const config = c.get('config')
    const body = await parseJsonBody(c, analyzeReferencesRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    const startedAt = Date.now()
    try {
      const result = await analyzeReferencesWithDeepSeek(config, body)
      await recordAiRunSafely(config, user, {
        taskType: 'analyze',
        provider: 'deepseek',
        model: result.model,
        status: 'succeeded',
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      })
      return c.json(
        analyzeReferencesResponseSchema.parse({
          ok: true,
          provider: 'deepseek',
          model: result.model,
          analysis: result.analysis,
          usage: result.usage,
        }),
      )
    } catch (error) {
      await recordAiRunSafely(config, user, {
        taskType: 'analyze',
        provider: 'deepseek',
        model: DEEPSEEK_ANALYZE_MODEL,
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        errorCode:
          error instanceof DeepSeekNotConfiguredError
            ? 'service_not_configured'
            : error instanceof DeepSeekUpstreamError || error instanceof ZodError
              ? 'upstream_error'
              : 'internal_error',
        errorMessage: getErrorMessage(error),
      })

      if (error instanceof DeepSeekNotConfiguredError) {
        return jsonError(c, {
          code: 'service_not_configured',
          message: 'DeepSeek API key is not configured yet. Add DEEPSEEK_API_KEY before running real AI analysis.',
          status: 503,
        })
      }

      if (error instanceof DeepSeekUpstreamError) {
        return jsonError(c, {
          code: 'upstream_error',
          message: error.message,
          status: 502,
        })
      }

      if (error instanceof ZodError) {
        return jsonError(c, {
          code: 'upstream_error',
          message: 'DeepSeek returned analysis in an unexpected format. Please retry.',
          status: 502,
        })
      }

      throw error
    }
  })

  app.post('/v1/ai/draft', async (c) => {
    const config = c.get('config')
    const body = await parseJsonBody(c, generateDraftRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    const startedAt = Date.now()
    try {
      const result = await generateDraftWithDeepSeek(config, body)
      await recordAiRunSafely(config, user, {
        taskType: 'draft',
        provider: 'deepseek',
        model: result.model,
        status: 'succeeded',
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      })
      return c.json(
        generateDraftResponseSchema.parse({
          ok: true,
          provider: 'deepseek',
          model: result.model,
          draft: result.draft,
          usage: result.usage,
        }),
      )
    } catch (error) {
      await recordAiRunSafely(config, user, {
        taskType: 'draft',
        provider: 'deepseek',
        model: DEEPSEEK_DRAFT_MODEL,
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        errorCode:
          error instanceof DeepSeekNotConfiguredError
            ? 'service_not_configured'
            : error instanceof DeepSeekUpstreamError || error instanceof ZodError
              ? 'upstream_error'
              : 'internal_error',
        errorMessage: getErrorMessage(error),
      })

      if (error instanceof DeepSeekNotConfiguredError) {
        return jsonError(c, {
          code: 'service_not_configured',
          message: 'DeepSeek API key is not configured yet. Add DEEPSEEK_API_KEY before generating a real draft.',
          status: 503,
        })
      }

      if (error instanceof DeepSeekUpstreamError) {
        return jsonError(c, {
          code: 'upstream_error',
          message: error.message,
          status: 502,
        })
      }

      if (error instanceof ZodError) {
        return jsonError(c, {
          code: 'upstream_error',
          message: 'DeepSeek returned draft in an unexpected format. Please retry.',
          status: 502,
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
