import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'service_not_configured',
  'upstream_error',
  'internal_error',
])

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const apiErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
  }),
})

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('lumos-api'),
  env: z.string(),
  timestamp: z.string(),
  checks: z.object({
    supabaseUrl: z.boolean(),
    supabaseAnonKey: z.boolean(),
    supabaseServiceRoleKey: z.boolean(),
    deepseekApiKey: z.boolean(),
  }),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const currentUserSchema = z.object({
  id: z.string(),
  email: z.string().email().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
})

export type CurrentUser = z.infer<typeof currentUserSchema>

export const meResponseSchema = z.object({
  ok: z.literal(true),
  user: currentUserSchema.nullable(),
  authConfigured: z.boolean(),
})

export type MeResponse = z.infer<typeof meResponseSchema>
