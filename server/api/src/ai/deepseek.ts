import type { AppConfig } from '../env.js'

export function isDeepSeekConfigured(config: AppConfig) {
  return Boolean(config.DEEPSEEK_API_KEY)
}

export function getDeepSeekConfigStatus(config: AppConfig) {
  return {
    provider: 'deepseek',
    configured: isDeepSeekConfigured(config),
    dailyBudgetCny: config.AI_DAILY_BUDGET_CNY ?? null,
  }
}
