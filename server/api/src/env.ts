import { z } from 'zod'

export type RuntimeBindings = Record<string, string | undefined>

const appEnvSchema = z.enum(['local', 'preview', 'staging', 'production'])

const configSchema = z.object({
  APP_ENV: appEnvSchema.default('local'),
  PUBLIC_APP_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  AI_PROVIDER_PRIMARY: z.literal('deepseek').default('deepseek'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  AI_DAILY_BUDGET_CNY: z.coerce.number().nonnegative().optional(),
})

export type AppConfig = z.infer<typeof configSchema>

function getProcessEnv(): RuntimeBindings {
  if (typeof process === 'undefined') return {}
  return process.env
}

export function readConfig(bindings: RuntimeBindings = {}): AppConfig {
  const raw = {
    ...getProcessEnv(),
    ...bindings,
  }

  return configSchema.parse({
    APP_ENV: raw.APP_ENV || undefined,
    PUBLIC_APP_URL: raw.PUBLIC_APP_URL || undefined,
    SUPABASE_URL: raw.SUPABASE_URL || undefined,
    SUPABASE_ANON_KEY: raw.SUPABASE_ANON_KEY || undefined,
    SUPABASE_SERVICE_ROLE_KEY: raw.SUPABASE_SERVICE_ROLE_KEY || undefined,
    SUPABASE_JWT_SECRET: raw.SUPABASE_JWT_SECRET || undefined,
    AI_PROVIDER_PRIMARY: raw.AI_PROVIDER_PRIMARY || undefined,
    DEEPSEEK_API_KEY: raw.DEEPSEEK_API_KEY || undefined,
    AI_DAILY_BUDGET_CNY: raw.AI_DAILY_BUDGET_CNY || undefined,
  })
}

export function getConfigChecks(config: AppConfig) {
  return {
    supabaseUrl: Boolean(config.SUPABASE_URL),
    supabaseAnonKey: Boolean(config.SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: Boolean(config.SUPABASE_SERVICE_ROLE_KEY),
    deepseekApiKey: Boolean(config.DEEPSEEK_API_KEY),
  }
}

export function isSupabaseConfigured(config: AppConfig) {
  return Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY)
}

export function isSupabaseAdminConfigured(config: AppConfig) {
  return Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY)
}
