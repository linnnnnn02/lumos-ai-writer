#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(repoRoot, '.env')
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8788/api'
const expectedTables = [
  'profiles',
  'folders',
  'notes',
  'snippets',
  'extension_devices',
  'projects',
  'conversations',
  'chat_messages',
  'drafts',
  'ai_runs',
  'feedback_memories',
]

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

function getProjectRef(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0]
  } catch {
    return null
  }
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
    let data = null

    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }

    return { response, data }
  } finally {
    clearTimeout(timeout)
  }
}

function statusIcon(ok) {
  return ok ? 'OK' : 'FAIL'
}

function printCheck(label, ok, detail = '') {
  const suffix = detail ? ` - ${detail}` : ''
  console.log(`${statusIcon(ok)} ${label}${suffix}`)
}

async function checkApiEndpoint(pathname) {
  try {
    const { response, data } = await fetchJson(`${apiBaseUrl}${pathname}`)
    return {
      ok: response.ok && data?.ok === true,
      detail: `${response.status}`,
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'request failed',
    }
  }
}

async function checkCorsPreflight(origin) {
  try {
    const { response } = await fetchJson(`${apiBaseUrl}/v1/config/public`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type,x-request-id',
      },
    })
    const allowOrigin = response.headers.get('access-control-allow-origin')
    const allowMethods = response.headers.get('access-control-allow-methods') || ''
    const allowHeaders = response.headers.get('access-control-allow-headers') || ''

    return {
      ok:
        response.status === 204 &&
        allowOrigin === origin &&
        allowMethods.includes('GET') &&
        allowHeaders.toLowerCase().includes('authorization'),
      detail: `${response.status} allow-origin=${allowOrigin ?? 'missing'}`,
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'request failed',
    }
  }
}

async function checkSupabaseTable(env, table) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL)
  url.searchParams.set('select', 'id')
  url.searchParams.set('limit', '1')

  try {
    const { response, data } = await fetchJson(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })

    return {
      ok: response.ok,
      detail: response.ok
        ? `${response.status}`
        : `${response.status} ${typeof data?.message === 'string' ? data.message : ''}`.trim(),
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'request failed',
    }
  }
}

async function main() {
  const fileEnv = loadEnv()
  const env = {
    ...fileEnv,
    ...process.env,
  }
  const requiredEnv = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DEEPSEEK_API_KEY',
  ]
  const missingEnv = requiredEnv.filter((key) => !env[key])
  const projectRef = getProjectRef(env.SUPABASE_URL)
  let hasFailure = false

  console.log('Lumos P0 health check')
  console.log(`API: ${apiBaseUrl}`)
  console.log(`Supabase project: ${projectRef ?? 'not configured'}`)
  console.log('')

  printCheck('.env exists', existsSync(envPath), '.env is ignored by git')
  for (const key of requiredEnv) {
    printCheck(`${key} configured`, Boolean(env[key]))
  }

  if (missingEnv.length > 0) {
    hasFailure = true
    console.log('')
    console.log(`Missing env keys: ${missingEnv.join(', ')}`)
  }

  console.log('')
  console.log('Local API')
  for (const pathname of ['/health', '/v1/config/status', '/v1/config/public']) {
    const result = await checkApiEndpoint(pathname)
    if (!result.ok) hasFailure = true
    printCheck(pathname, result.ok, result.detail)
  }

  console.log('')
  console.log('CORS preflight')
  for (const origin of [
    'http://localhost:5173',
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ]) {
    const result = await checkCorsPreflight(origin)
    if (!result.ok) hasFailure = true
    printCheck(origin, result.ok, result.detail)
  }

  console.log('')
  console.log('Supabase tables')
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    hasFailure = true
    printCheck('table checks', false, 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing')
  } else {
    for (const table of expectedTables) {
      const result = await checkSupabaseTable(env, table)
      if (!result.ok) hasFailure = true
      printCheck(table, result.ok, result.detail)
    }
  }

  console.log('')
  if (hasFailure) {
    console.log('Result: P0 is not fully healthy yet.')
    console.log('Tip: start API with `pnpm dev:api`, then rerun `pnpm check:p0`.')
    process.exitCode = 1
    return
  }

  console.log('Result: P0 backend, auth config, AI config, and Supabase schema look healthy.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
