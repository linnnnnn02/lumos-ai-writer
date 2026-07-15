import type { AppConfig } from '../env.js'

export type AiAccessBlockReason =
  | 'feature_disabled'
  | 'budget_not_configured'
  | 'budget_exhausted'

export function hasAnyAiAudience(config: AppConfig) {
  return config.AI_FEATURE_ENABLED || config.AI_PILOT_USER_IDS.length > 0
}

export function isAiEnabledForUser(config: AppConfig, userId: string) {
  return config.AI_FEATURE_ENABLED || config.AI_PILOT_USER_IDS.includes(userId)
}

export function getAiAccessBlockReason(
  config: AppConfig,
  userId: string,
  dailySpendCny: number,
): AiAccessBlockReason | null {
  if (!isAiEnabledForUser(config, userId)) return 'feature_disabled'

  if (
    config.AI_DAILY_BUDGET_CNY === undefined ||
    config.AI_DEEPSEEK_INPUT_CNY_PER_1M_TOKENS === undefined ||
    config.AI_DEEPSEEK_OUTPUT_CNY_PER_1M_TOKENS === undefined
  ) {
    return 'budget_not_configured'
  }

  if (dailySpendCny >= config.AI_DAILY_BUDGET_CNY) return 'budget_exhausted'
  return null
}

export function createAiExecutionConfig(config: AppConfig): AppConfig {
  return config.AI_FEATURE_ENABLED
    ? config
    : {
        ...config,
        AI_FEATURE_ENABLED: true,
      }
}
