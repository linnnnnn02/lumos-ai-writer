import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { User } from '@supabase/supabase-js'
import { ZodError, type ZodSchema } from 'zod'
import {
  analyzeReferencesRequestSchema,
  analyzeReferencesResponseSchema,
  buildWritingProfileRequestSchema,
  buildWritingProfileResponseSchema,
  createFolderRequestSchema,
  createFolderResponseSchema,
  createFeedbackMemoryRequestSchema,
  createFeedbackMemoryResponseSchema,
  configStatusResponseSchema,
  createSnippetRequestSchema,
  createSnippetResponseSchema,
  deleteResourceResponseSchema,
  generateDraftRequestSchema,
  generateDraftResponseSchema,
  getWritingProfileResponseSchema,
  getWorkspaceResponseSchema,
  healthResponseSchema,
  listFoldersResponseSchema,
  listNotesResponseSchema,
  listSnippetsResponseSchema,
  listTrashResponseSchema,
  meResponseSchema,
  previewDraftForReaderRequestSchema,
  previewDraftForReaderResponseSchema,
  publicConfigResponseSchema,
  rewriteDraftRequestSchema,
  rewriteDraftResponseSchema,
  syncWorkspaceRequestSchema,
  syncWorkspaceResponseSchema,
  syncAnnotationRequestSchema,
  syncAnnotationResponseSchema,
  updateFolderRequestSchema,
  updateFolderResponseSchema,
  updateNoteLearningStatusRequestSchema,
  updateSnippetRequestSchema,
  updateSnippetResponseSchema,
  upsertNoteRequestSchema,
  upsertNoteResponseSchema,
  type OAuthProvider,
} from '@lumos-ai/shared'
import {
  AiFeatureDisabledError,
  analyzeReferencesWithDeepSeek,
  DEEPSEEK_ANALYZE_MODEL,
  DEEPSEEK_DRAFT_MODEL,
  DEEPSEEK_REWRITE_MODEL,
  DEEPSEEK_READER_PREVIEW_MODEL,
  DEEPSEEK_WRITER_MODEL,
  DeepSeekNotConfiguredError,
  DeepSeekOutputValidationError,
  DeepSeekUpstreamError,
  generateDraftWithDeepSeek,
  getDeepSeekConfigStatus,
  learnWritingProfileWithDeepSeek,
  rewriteDraftWithDeepSeek,
  previewDraftForReaderWithDeepSeek,
} from './ai/deepseek.js'
import {
  createAiExecutionConfig,
  getAiAccessBlockReason,
  hasAnyAiAudience,
  isAiEnabledForUser,
} from './ai/access.js'
import { requireCurrentUser } from './auth.js'
import { getConfigChecks, isSupabaseConfigured, readConfig, type RuntimeBindings } from './env.js'
import { getBearerToken, jsonError } from './http.js'
import {
  createFolder,
  createSnippet,
  deleteFolder,
  deleteFolderPermanently,
  deleteNote,
  deleteNotePermanently,
  deleteSnippet,
  emptyTrash,
  getAiDailySpendCny,
  listFolders,
  listNotes,
  listSnippets,
  listTrash,
  recordAiRun,
  restoreFolder,
  restoreNote,
  syncAnnotation,
  SupabaseSchemaMissingError,
  updateFolder,
  updateNoteLearningStatus,
  updateSnippet,
  upsertNote,
  upsertUserProfile,
} from './library.js'
import { getUserFromAccessToken, toCurrentUser } from './supabase.js'
import {
  createFeedbackMemory,
  listWorkspace,
  syncWorkspace,
  WorkspaceOwnershipError,
} from './workspace.js'
import {
  collectWritingEvidenceIds,
  createWritingProfileRevision,
  getWritingProfileContext,
} from './writing-profile.js'

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
const localCorsOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]
const chromeExtensionOriginPattern = /^chrome-extension:\/\/[a-p]{32}$/

function getOAuthProviders(rawProviders: string): OAuthProvider[] {
  return rawProviders
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is OAuthProvider =>
      supportedOAuthProviders.has(provider as OAuthProvider),
    )
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function normalizeCorsOrigin(value: string) {
  const trimmedValue = value.trim().replace(/\/+$/, '')
  if (!trimmedValue) return null
  if (trimmedValue.startsWith('chrome-extension://')) {
    return chromeExtensionOriginPattern.test(trimmedValue) ? trimmedValue : null
  }
  return normalizeOrigin(trimmedValue)
}

function getCommaSeparatedOrigins(rawOrigins: string | undefined) {
  if (!rawOrigins) return []
  return rawOrigins
    .split(',')
    .map((origin) => normalizeCorsOrigin(origin))
    .filter((origin): origin is string => Boolean(origin))
}

function getAllowedCorsOrigin(origin: string, config: ApiVariables['config'] | null) {
  if (!origin) return null

  const normalizedOrigin = normalizeCorsOrigin(origin)
  if (!normalizedOrigin) return null

  const isLocalDev = config?.APP_ENV !== 'production'
  const allowedOrigins = new Set([
    ...(isLocalDev ? localCorsOrigins : []),
    ...getCommaSeparatedOrigins(config?.PUBLIC_APP_URL),
    ...getCommaSeparatedOrigins(config?.CORS_ALLOWED_ORIGINS),
  ])

  if (allowedOrigins.has(normalizedOrigin)) return origin
  if (
    config?.CORS_ALLOW_CHROME_EXTENSIONS &&
    chromeExtensionOriginPattern.test(normalizedOrigin)
  ) {
    return origin
  }
  if (isLocalDev && normalizedOrigin.startsWith('chrome-extension://')) return origin

  return null
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
    message: 'Supabase schema is incomplete. Apply all SQL files in server/api/migrations.',
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

function estimateDeepSeekCostCny(
  config: ApiVariables['config'],
  usage: { promptTokens: number | null; completionTokens: number | null } | null,
) {
  if (!usage) return null

  const inputRate = config.AI_DEEPSEEK_INPUT_CNY_PER_1M_TOKENS
  const outputRate = config.AI_DEEPSEEK_OUTPUT_CNY_PER_1M_TOKENS
  if (inputRate === undefined || outputRate === undefined) return null

  const inputTokens = usage.promptTokens ?? 0
  const outputTokens = usage.completionTokens ?? 0
  const estimate =
    (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate

  return Number(estimate.toFixed(6))
}

function getFailedAiRunAccounting(
  config: ApiVariables['config'],
  error: unknown,
) {
  if (!(error instanceof DeepSeekOutputValidationError)) return {}

  return {
    usage: error.usage,
    promptHash: error.promptHash,
    costEstimateCny: estimateDeepSeekCostCny(config, error.usage),
  }
}

async function requireAiExecutionConfig(
  c: Context<ApiHonoEnv>,
  user: User,
): Promise<ApiVariables['config'] | Response> {
  const config = c.get('config')

  if (!isAiEnabledForUser(config, user.id)) {
    return jsonError(c, {
      code: 'feature_disabled',
      message: 'AI features are not enabled for this account.',
      status: 503,
    })
  }

  if (getAiAccessBlockReason(config, user.id, 0) === 'budget_not_configured') {
    return jsonError(c, {
      code: 'service_not_configured',
      message: 'AI pilot budget tracking is not fully configured.',
      status: 503,
    })
  }

  let dailySpendCny: number
  try {
    dailySpendCny = await getAiDailySpendCny(config, user)
  } catch (error) {
    if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
    throw error
  }

  if (getAiAccessBlockReason(config, user.id, dailySpendCny) === 'budget_exhausted') {
    return jsonError(c, {
      code: 'budget_exhausted',
      message: 'Today\'s AI trial budget has been used. Please continue tomorrow.',
      status: 429,
    })
  }

  return createAiExecutionConfig(config)
}

export function createApiApp() {
  const app = new Hono<ApiHonoEnv>()

  app.use(
    '*',
    cors({
      origin: (origin, c) => {
        let config: ApiVariables['config'] | null = null
        try {
          config = readConfig(c.env)
        } catch {
          config = null
        }
        return getAllowedCorsOrigin(origin, config)
      },
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['authorization', 'content-type', 'x-request-id', 'apikey'],
      exposeHeaders: ['x-request-id'],
      maxAge: 600,
    }),
  )

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

  app.patch('/v1/folders/:folderId', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Folders will be connected after Supabase setup.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, updateFolderRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const folder = await updateFolder(config, user, c.req.param('folderId'), body)
      return c.json(updateFolderResponseSchema.parse({ ok: true, folder }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Folder not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Folder not found.',
          status: 404,
        })
      }
      throw error
    }
  })

  app.delete('/v1/folders/:folderId', async (c) => {
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
      await deleteFolder(config, user, c.req.param('folderId'))
      return c.json(deleteResourceResponseSchema.parse({ ok: true }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Folder not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Folder not found.',
          status: 404,
        })
      }
      throw error
    }
  })

  app.post('/v1/folders/:folderId/restore', async (c) => {
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
      await restoreFolder(config, user, c.req.param('folderId'))
      return c.json(deleteResourceResponseSchema.parse({ ok: true }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Folder not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Folder not found.',
          status: 404,
        })
      }
      throw error
    }
  })

  app.delete('/v1/folders/:folderId/permanent', async (c) => {
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
      await deleteFolderPermanently(config, user, c.req.param('folderId'))
      return c.json(deleteResourceResponseSchema.parse({ ok: true }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Folder not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Folder not found.',
          status: 404,
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

  app.patch('/v1/notes/:noteId/learning-status', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Notes will be connected after Supabase setup.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, updateNoteLearningStatusRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      await updateNoteLearningStatus(config, user, c.req.param('noteId'), body)
      return c.json(deleteResourceResponseSchema.parse({ ok: true }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Note not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Note not found.',
          status: 404,
        })
      }
      throw error
    }
  })

  app.delete('/v1/notes/:noteId', async (c) => {
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
      await deleteNote(config, user, c.req.param('noteId'))
      return c.json(deleteResourceResponseSchema.parse({ ok: true }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Note not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Note not found.',
          status: 404,
        })
      }
      throw error
    }
  })

  app.post('/v1/notes/:noteId/restore', async (c) => {
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
      await restoreNote(config, user, c.req.param('noteId'))
      return c.json(deleteResourceResponseSchema.parse({ ok: true }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Note not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Note not found.',
          status: 404,
        })
      }
      throw error
    }
  })

  app.delete('/v1/notes/:noteId/permanent', async (c) => {
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
      await deleteNotePermanently(config, user, c.req.param('noteId'))
      return c.json(deleteResourceResponseSchema.parse({ ok: true }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Note not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Note not found.',
          status: 404,
        })
      }
      throw error
    }
  })

  app.get('/v1/trash', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Trash will be connected after Supabase setup.',
        status: 503,
      })
    }

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const groups = await listTrash(config, user)
      return c.json(listTrashResponseSchema.parse({ ok: true, groups }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      throw error
    }
  })

  app.delete('/v1/trash', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Trash will be connected after Supabase setup.',
        status: 503,
      })
    }

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      await emptyTrash(config, user)
      return c.json(deleteResourceResponseSchema.parse({ ok: true }))
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

  app.post('/v1/annotation-sync', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Cloud sync is unavailable.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, syncAnnotationRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const result = await syncAnnotation(config, user, body)
      return c.json(syncAnnotationResponseSchema.parse({ ok: true, ...result }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      throw error
    }
  })

  app.patch('/v1/snippets/:snippetId', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Snippets will be connected after Supabase setup.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, updateSnippetRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const snippet = await updateSnippet(config, user, c.req.param('snippetId'), body)
      return c.json(updateSnippetResponseSchema.parse({ ok: true, snippet }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Snippet not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Snippet not found.',
          status: 404,
        })
      }
      throw error
    }
  })

  app.delete('/v1/snippets/:snippetId', async (c) => {
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
      await deleteSnippet(config, user, c.req.param('snippetId'))
      return c.json(deleteResourceResponseSchema.parse({ ok: true }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (getErrorMessage(error) === 'Snippet not found.') {
        return jsonError(c, {
          code: 'not_found',
          message: 'Snippet not found.',
          status: 404,
        })
      }
      throw error
    }
  })

  app.get('/v1/workspace', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Workspace persistence is unavailable.',
        status: 503,
      })
    }

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const workspace = await listWorkspace(config, user)
      return c.json(getWorkspaceResponseSchema.parse(workspace))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      throw error
    }
  })

  app.put('/v1/workspace', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Workspace persistence is unavailable.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, syncWorkspaceRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const result = await syncWorkspace(config, user, body)
      return c.json(syncWorkspaceResponseSchema.parse(result))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (error instanceof WorkspaceOwnershipError) {
        return jsonError(c, {
          code: 'forbidden',
          message: error.message,
          status: 403,
        })
      }
      throw error
    }
  })

  app.post('/v1/feedback-memories', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Feedback memory is unavailable.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, createFeedbackMemoryRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const memory = await createFeedbackMemory(config, user, body)
      return c.json(createFeedbackMemoryResponseSchema.parse({ ok: true, memory }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (error instanceof WorkspaceOwnershipError) {
        return jsonError(c, {
          code: 'forbidden',
          message: error.message,
          status: 403,
        })
      }
      throw error
    }
  })

  app.get('/v1/writing-profile', async (c) => {
    const config = c.get('config')
    if (!isSupabaseConfigured(config)) {
      return jsonError(c, {
        code: 'service_not_configured',
        message: 'Supabase is not configured yet. Writing profiles are unavailable.',
        status: 503,
      })
    }

    const projectId = c.req.query('projectId')
    if (projectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
      return jsonError(c, {
        code: 'validation_failed',
        message: 'projectId is invalid.',
        status: 400,
      })
    }

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user

    try {
      const profiles = await getWritingProfileContext(config, user, projectId)
      return c.json(getWritingProfileResponseSchema.parse({ ok: true, ...profiles }))
    } catch (error) {
      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (error instanceof WorkspaceOwnershipError) {
        return jsonError(c, {
          code: 'forbidden',
          message: error.message,
          status: 403,
        })
      }
      throw error
    }
  })

  app.post('/v1/ai/writing-profile', async (c) => {
    const config = c.get('config')
    if (!hasAnyAiAudience(config)) {
      return jsonError(c, {
        code: 'feature_disabled',
        message: 'Writing profile learning is paused until writer-model-v1 passes evaluation.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, buildWritingProfileRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user
    const aiConfig = await requireAiExecutionConfig(c, user)
    if (aiConfig instanceof Response) return aiConfig

    const startedAt = Date.now()
    try {
      const profileContext = await getWritingProfileContext(config, user, body.projectId)
      const currentRevision =
        body.scope === 'account'
          ? profileContext.accountProfile
          : profileContext.projectProfile
      const evidenceIds = collectWritingEvidenceIds(body)
      const hasSameEvidence =
        currentRevision !== null &&
        currentRevision.evidenceIds.length === evidenceIds.length &&
        evidenceIds.every((id) => currentRevision.evidenceIds.includes(id))

      if (currentRevision && hasSameEvidence) {
        return c.json(
          buildWritingProfileResponseSchema.parse({
            ok: true,
            provider: 'deepseek',
            model: DEEPSEEK_WRITER_MODEL,
            skill: currentRevision.skill,
            profile: currentRevision.profile,
            revision: currentRevision,
            reused: true,
            usage: null,
          }),
        )
      }

      const learningInput = {
        ...body,
        previousProfile: currentRevision?.profile ?? null,
      }
      const result = await learnWritingProfileWithDeepSeek(aiConfig, learningInput)
      const revision = await createWritingProfileRevision(
        config,
        user,
        learningInput,
        result.profile,
        result.skill,
      )
      await recordAiRunSafely(config, user, {
        taskType: 'profile-learn',
        provider: 'deepseek',
        model: result.model,
        status: 'succeeded',
        usage: result.usage,
        promptHash: result.skill.promptHash,
        costEstimateCny: estimateDeepSeekCostCny(config, result.usage),
        latencyMs: Date.now() - startedAt,
      })
      return c.json(
        buildWritingProfileResponseSchema.parse({
          ok: true,
          provider: 'deepseek',
          model: result.model,
          skill: result.skill,
          profile: result.profile,
          revision,
          reused: false,
          usage: result.usage,
        }),
      )
    } catch (error) {
      await recordAiRunSafely(config, user, {
        taskType: 'profile-learn',
        provider: 'deepseek',
        model: DEEPSEEK_WRITER_MODEL,
        status: 'failed',
        ...getFailedAiRunAccounting(config, error),
        latencyMs: Date.now() - startedAt,
        errorCode:
          error instanceof AiFeatureDisabledError
            ? 'feature_disabled'
            : error instanceof DeepSeekNotConfiguredError
            ? 'service_not_configured'
            : error instanceof DeepSeekUpstreamError ||
                error instanceof DeepSeekOutputValidationError ||
                error instanceof ZodError
              ? 'upstream_error'
              : 'internal_error',
        errorMessage: getErrorMessage(error),
      })

      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (error instanceof WorkspaceOwnershipError) {
        return jsonError(c, {
          code: 'forbidden',
          message: error.message,
          status: 403,
        })
      }
      if (error instanceof DeepSeekNotConfiguredError) {
        return jsonError(c, {
          code: 'service_not_configured',
          message: 'DeepSeek API key is not configured yet.',
          status: 503,
        })
      }
      if (
        error instanceof DeepSeekUpstreamError ||
        error instanceof DeepSeekOutputValidationError ||
        error instanceof ZodError
      ) {
        return jsonError(c, {
          code: 'upstream_error',
          message:
            error instanceof DeepSeekUpstreamError
              ? error.message
              : 'DeepSeek returned a writing profile in an unexpected format.',
          status: error instanceof DeepSeekUpstreamError && error.status === 504 ? 504 : 502,
        })
      }
      throw error
    }
  })

  app.post('/v1/ai/analyze', async (c) => {
    const config = c.get('config')
    if (!hasAnyAiAudience(config)) {
      return jsonError(c, {
        code: 'feature_disabled',
        message: 'AI analysis is paused until analysis-v1 passes evaluation.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, analyzeReferencesRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user
    const aiConfig = await requireAiExecutionConfig(c, user)
    if (aiConfig instanceof Response) return aiConfig

    const startedAt = Date.now()
    try {
      const result = await analyzeReferencesWithDeepSeek(aiConfig, body)
      await recordAiRunSafely(config, user, {
        taskType: 'analyze',
        provider: 'deepseek',
        model: result.model,
        status: 'succeeded',
        usage: result.usage,
        promptHash: result.skill.promptHash,
        costEstimateCny: estimateDeepSeekCostCny(config, result.usage),
        latencyMs: Date.now() - startedAt,
      })
      return c.json(
        analyzeReferencesResponseSchema.parse({
          ok: true,
          provider: 'deepseek',
          model: result.model,
          skill: result.skill,
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
        ...getFailedAiRunAccounting(config, error),
        latencyMs: Date.now() - startedAt,
        errorCode:
          error instanceof AiFeatureDisabledError
            ? 'feature_disabled'
            : error instanceof DeepSeekNotConfiguredError
            ? 'service_not_configured'
            : error instanceof DeepSeekUpstreamError ||
                error instanceof DeepSeekOutputValidationError ||
                error instanceof ZodError
              ? 'upstream_error'
              : 'internal_error',
        errorMessage: getErrorMessage(error),
      })

      if (error instanceof AiFeatureDisabledError) {
        return jsonError(c, {
          code: 'feature_disabled',
          message: error.message,
          status: 503,
        })
      }

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
          status: error.status === 504 ? 504 : 502,
        })
      }

      if (error instanceof DeepSeekOutputValidationError || error instanceof ZodError) {
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
    if (!hasAnyAiAudience(config)) {
      return jsonError(c, {
        code: 'feature_disabled',
        message: 'AI drafting is paused until its Skill passes evaluation.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, generateDraftRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user
    const aiConfig = await requireAiExecutionConfig(c, user)
    if (aiConfig instanceof Response) return aiConfig

    const startedAt = Date.now()
    try {
      const writingProfileContext = await getWritingProfileContext(
        config,
        user,
        body.projectId,
      )
      const result = await generateDraftWithDeepSeek(aiConfig, body, writingProfileContext)
      await recordAiRunSafely(config, user, {
        taskType: 'draft',
        provider: 'deepseek',
        model: result.model,
        status: 'succeeded',
        usage: result.usage,
        promptHash: result.skill.promptHash,
        costEstimateCny: estimateDeepSeekCostCny(config, result.usage),
        latencyMs: Date.now() - startedAt,
      })
      return c.json(
        generateDraftResponseSchema.parse({
          ok: true,
          provider: 'deepseek',
          model: result.model,
          skill: result.skill,
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
        ...getFailedAiRunAccounting(config, error),
        latencyMs: Date.now() - startedAt,
        errorCode:
          error instanceof AiFeatureDisabledError
            ? 'feature_disabled'
            : error instanceof DeepSeekNotConfiguredError
            ? 'service_not_configured'
            : error instanceof DeepSeekUpstreamError ||
                error instanceof DeepSeekOutputValidationError ||
                error instanceof ZodError
              ? 'upstream_error'
              : 'internal_error',
        errorMessage: getErrorMessage(error),
      })

      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (error instanceof WorkspaceOwnershipError) {
        return jsonError(c, {
          code: 'forbidden',
          message: error.message,
          status: 403,
        })
      }

      if (error instanceof AiFeatureDisabledError) {
        return jsonError(c, {
          code: 'feature_disabled',
          message: error.message,
          status: 503,
        })
      }

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
          status: error.status === 504 ? 504 : 502,
        })
      }

      if (error instanceof DeepSeekOutputValidationError || error instanceof ZodError) {
        return jsonError(c, {
          code: 'upstream_error',
          message: 'DeepSeek returned draft in an unexpected format. Please retry.',
          status: 502,
        })
      }

      throw error
    }
  })

  app.post('/v1/ai/rewrite', async (c) => {
    const config = c.get('config')
    if (!hasAnyAiAudience(config)) {
      return jsonError(c, {
        code: 'feature_disabled',
        message: 'AI rewriting is paused until rewrite-v1 passes evaluation.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, rewriteDraftRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user
    const aiConfig = await requireAiExecutionConfig(c, user)
    if (aiConfig instanceof Response) return aiConfig

    const startedAt = Date.now()
    try {
      const writingProfileContext = await getWritingProfileContext(
        config,
        user,
        body.projectId,
      )
      const result = await rewriteDraftWithDeepSeek(
        aiConfig,
        body,
        writingProfileContext,
      )
      await recordAiRunSafely(config, user, {
        taskType: 'rewrite',
        provider: 'deepseek',
        model: result.model,
        status: 'succeeded',
        usage: result.usage,
        promptHash: result.skill.promptHash,
        costEstimateCny: estimateDeepSeekCostCny(config, result.usage),
        latencyMs: Date.now() - startedAt,
      })
      return c.json(
        rewriteDraftResponseSchema.parse({
          ok: true,
          provider: 'deepseek',
          model: result.model,
          skill: result.skill,
          rewrite: result.rewrite,
          usage: result.usage,
        }),
      )
    } catch (error) {
      await recordAiRunSafely(config, user, {
        taskType: 'rewrite',
        provider: 'deepseek',
        model: DEEPSEEK_REWRITE_MODEL,
        status: 'failed',
        ...getFailedAiRunAccounting(config, error),
        latencyMs: Date.now() - startedAt,
        errorCode:
          error instanceof AiFeatureDisabledError
            ? 'feature_disabled'
            : error instanceof DeepSeekNotConfiguredError
              ? 'service_not_configured'
              : error instanceof DeepSeekUpstreamError ||
                  error instanceof DeepSeekOutputValidationError ||
                  error instanceof ZodError
                ? 'upstream_error'
                : 'internal_error',
        errorMessage: getErrorMessage(error),
      })

      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (error instanceof WorkspaceOwnershipError) {
        return jsonError(c, {
          code: 'forbidden',
          message: error.message,
          status: 403,
        })
      }
      if (error instanceof AiFeatureDisabledError) {
        return jsonError(c, {
          code: 'feature_disabled',
          message: error.message,
          status: 503,
        })
      }
      if (error instanceof DeepSeekNotConfiguredError) {
        return jsonError(c, {
          code: 'service_not_configured',
          message: 'DeepSeek API key is not configured yet. Add DEEPSEEK_API_KEY before rewriting real copy.',
          status: 503,
        })
      }
      if (error instanceof DeepSeekUpstreamError) {
        return jsonError(c, {
          code: 'upstream_error',
          message: error.message,
          status: error.status === 504 ? 504 : 502,
        })
      }
      if (error instanceof DeepSeekOutputValidationError || error instanceof ZodError) {
        return jsonError(c, {
          code: 'upstream_error',
          message: 'DeepSeek returned rewrite suggestions in an unexpected format. Please retry.',
          status: 502,
        })
      }

      throw error
    }
  })

  app.post('/v1/ai/reader-preview', async (c) => {
    const config = c.get('config')
    if (!hasAnyAiAudience(config)) {
      return jsonError(c, {
        code: 'feature_disabled',
        message: 'AI reader preview is paused until reader-preview-v1 passes evaluation.',
        status: 503,
      })
    }

    const body = await parseJsonBody(c, previewDraftForReaderRequestSchema)
    if (body instanceof Response) return body

    const user = await requireCurrentUser(c)
    if (user instanceof Response) return user
    const aiConfig = await requireAiExecutionConfig(c, user)
    if (aiConfig instanceof Response) return aiConfig

    const startedAt = Date.now()
    try {
      const writingProfileContext = await getWritingProfileContext(
        config,
        user,
        body.projectId,
      )
      const result = await previewDraftForReaderWithDeepSeek(
        aiConfig,
        body,
        writingProfileContext,
      )
      await recordAiRunSafely(config, user, {
        taskType: 'reader-preview',
        provider: 'deepseek',
        model: result.model,
        status: 'succeeded',
        usage: result.usage,
        promptHash: result.skill.promptHash,
        costEstimateCny: estimateDeepSeekCostCny(config, result.usage),
        latencyMs: Date.now() - startedAt,
      })
      return c.json(
        previewDraftForReaderResponseSchema.parse({
          ok: true,
          provider: 'deepseek',
          model: result.model,
          skill: result.skill,
          preview: result.preview,
          usage: result.usage,
        }),
      )
    } catch (error) {
      await recordAiRunSafely(config, user, {
        taskType: 'reader-preview',
        provider: 'deepseek',
        model: DEEPSEEK_READER_PREVIEW_MODEL,
        status: 'failed',
        ...getFailedAiRunAccounting(config, error),
        latencyMs: Date.now() - startedAt,
        errorCode:
          error instanceof AiFeatureDisabledError
            ? 'feature_disabled'
            : error instanceof DeepSeekNotConfiguredError
              ? 'service_not_configured'
              : error instanceof DeepSeekUpstreamError ||
                  error instanceof DeepSeekOutputValidationError ||
                  error instanceof ZodError
                ? 'upstream_error'
                : 'internal_error',
        errorMessage: getErrorMessage(error),
      })

      if (error instanceof SupabaseSchemaMissingError) return getSchemaMissingErrorResponse(c)
      if (error instanceof WorkspaceOwnershipError) {
        return jsonError(c, {
          code: 'forbidden',
          message: error.message,
          status: 403,
        })
      }
      if (error instanceof AiFeatureDisabledError) {
        return jsonError(c, {
          code: 'feature_disabled',
          message: error.message,
          status: 503,
        })
      }
      if (error instanceof DeepSeekNotConfiguredError) {
        return jsonError(c, {
          code: 'service_not_configured',
          message: 'DeepSeek API key is not configured yet. Add DEEPSEEK_API_KEY before previewing real copy.',
          status: 503,
        })
      }
      if (error instanceof DeepSeekUpstreamError) {
        return jsonError(c, {
          code: 'upstream_error',
          message: error.message,
          status: error.status === 504 ? 504 : 502,
        })
      }
      if (error instanceof DeepSeekOutputValidationError || error instanceof ZodError) {
        return jsonError(c, {
          code: 'upstream_error',
          message: 'DeepSeek returned reader feedback in an unexpected format. Please retry.',
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
