#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(repoRoot, '.env')

function parseDotenv(content) {
  const values = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    values[key] = value
  }

  return values
}

function loadEnv() {
  if (!existsSync(envPath)) return {}
  return parseDotenv(readFileSync(envPath, 'utf8'))
}

function getNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function getDays() {
  const rawDays = process.argv.find((arg) => arg.startsWith('--days='))?.split('=')[1]
  const days = rawDays ? Number(rawDays) : 1
  return Number.isFinite(days) && days > 0 ? days : 1
}

function getWindowStart(days) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return start
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    const text = await response.text()
    const data = text ? JSON.parse(text) : null

    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`
      throw new Error(message)
    }

    return data
  } finally {
    clearTimeout(timeout)
  }
}

function getEstimateFromRates(row, env) {
  const inputRate = getNumber(env.AI_DEEPSEEK_INPUT_CNY_PER_1M_TOKENS)
  const outputRate = getNumber(env.AI_DEEPSEEK_OUTPUT_CNY_PER_1M_TOKENS)
  if (inputRate === null || outputRate === null) return null

  const inputTokens = Number(row.input_token_count ?? 0)
  const outputTokens = Number(row.output_token_count ?? 0)
  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate
}

function getCostEstimate(row, env) {
  const storedEstimate = getNumber(row.cost_estimate_cny)
  if (storedEstimate !== null) return storedEstimate
  return getEstimateFromRates(row, env)
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatCny(value) {
  return `CNY ${value.toFixed(6)}`
}

async function main() {
  const env = {
    ...loadEnv(),
    ...process.env,
  }
  const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  const missingEnv = requiredEnv.filter((key) => !env[key])

  if (missingEnv.length > 0) {
    throw new Error(`Missing env keys: ${missingEnv.join(', ')}`)
  }

  const days = getDays()
  const start = getWindowStart(days)
  const url = new URL('/rest/v1/ai_runs', env.SUPABASE_URL)
  url.searchParams.set(
    'select',
    'task_type,status,input_token_count,output_token_count,cost_estimate_cny,created_at,error_code',
  )
  url.searchParams.set('created_at', `gte.${start.toISOString()}`)
  url.searchParams.set('order', 'created_at.desc')

  const rows = await fetchJson(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })

  let succeeded = 0
  let failed = 0
  let inputTokens = 0
  let outputTokens = 0
  let estimatedCost = 0
  let hasCostEstimate = false
  const byTask = new Map()

  for (const row of rows ?? []) {
    if (row.status === 'succeeded') succeeded += 1
    if (row.status === 'failed') failed += 1

    const rowInputTokens = Number(row.input_token_count ?? 0)
    const rowOutputTokens = Number(row.output_token_count ?? 0)
    inputTokens += rowInputTokens
    outputTokens += rowOutputTokens

    const cost = getCostEstimate(row, env)
    if (cost !== null) {
      estimatedCost += cost
      hasCostEstimate = true
    }

    const task = row.task_type || 'unknown'
    const taskStats = byTask.get(task) ?? {
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    taskStats.runs += 1
    taskStats.inputTokens += rowInputTokens
    taskStats.outputTokens += rowOutputTokens
    byTask.set(task, taskStats)
  }

  const totalRuns = rows?.length ?? 0
  const totalTokens = inputTokens + outputTokens
  const budget = getNumber(env.AI_DAILY_BUDGET_CNY)

  console.log('Lumos AI usage report')
  console.log(`Window: ${days} day(s), since ${start.toISOString()}`)
  console.log(`Runs: ${totalRuns} total, ${succeeded} succeeded, ${failed} failed`)
  console.log(
    `Tokens: ${formatNumber(totalTokens)} total, ${formatNumber(inputTokens)} input, ${formatNumber(outputTokens)} output`,
  )

  if (hasCostEstimate) {
    console.log(`Estimated cost: ${formatCny(estimatedCost)}`)
    if (budget !== null) {
      const ratio = budget > 0 ? estimatedCost / budget : 0
      console.log(`Budget: ${formatCny(budget)} (${(ratio * 100).toFixed(1)}% used)`)
      if (ratio >= 0.8) {
        console.log('Warning: AI usage is above 80% of the configured daily budget.')
      }
    }
  } else {
    console.log(
      'Estimated cost: unavailable. Set AI_DEEPSEEK_INPUT_CNY_PER_1M_TOKENS and AI_DEEPSEEK_OUTPUT_CNY_PER_1M_TOKENS to enable it.',
    )
  }

  if (byTask.size > 0) {
    console.log('')
    console.log('By task')
    for (const [task, stats] of byTask.entries()) {
      console.log(
        `${task}: ${stats.runs} runs, ${formatNumber(stats.inputTokens + stats.outputTokens)} tokens`,
      )
    }
  }
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
