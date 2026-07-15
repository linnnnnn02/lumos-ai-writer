import assert from 'node:assert/strict'
import {
  createAiExecutionConfig,
  getAiAccessBlockReason,
  hasAnyAiAudience,
  isAiEnabledForUser,
} from '../src/ai/access.js'
import { readConfig } from '../src/env.js'

const pilotUserId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const config = readConfig({
  APP_ENV: 'local',
  AI_FEATURE_ENABLED: 'false',
  AI_PILOT_USER_IDS: pilotUserId,
  AI_PROVIDER_PRIMARY: 'deepseek',
  AI_DAILY_BUDGET_CNY: '2',
  AI_DEEPSEEK_INPUT_CNY_PER_1M_TOKENS: '2',
  AI_DEEPSEEK_OUTPUT_CNY_PER_1M_TOKENS: '8',
})

assert.equal(config.AI_FEATURE_ENABLED, false)
assert.equal(hasAnyAiAudience(config), true)
assert.equal(isAiEnabledForUser(config, pilotUserId), true)
assert.equal(isAiEnabledForUser(config, otherUserId), false)
assert.equal(getAiAccessBlockReason(config, otherUserId, 0), 'feature_disabled')
assert.equal(getAiAccessBlockReason(config, pilotUserId, 1.999999), null)
assert.equal(getAiAccessBlockReason(config, pilotUserId, 2), 'budget_exhausted')

const executionConfig = createAiExecutionConfig(config)
assert.equal(executionConfig.AI_FEATURE_ENABLED, true)
assert.equal(config.AI_FEATURE_ENABLED, false)

const missingBudgetConfig = readConfig({
  APP_ENV: 'local',
  AI_FEATURE_ENABLED: 'false',
  AI_PILOT_USER_IDS: pilotUserId,
  AI_PROVIDER_PRIMARY: 'deepseek',
})
assert.equal(
  getAiAccessBlockReason(missingBudgetConfig, pilotUserId, 0),
  'budget_not_configured',
)

console.log('AI pilot access evaluation passed')
console.log('global AI feature gate: closed')
console.log('allowlisted account: admitted')
console.log('non-allowlisted account: blocked')
console.log('daily budget exhaustion: blocks before model execution')
console.log('paid model calls: 0')
