#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(repoRoot, '.env')
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8788/api'
const shouldCheckAi = process.argv.includes('--ai')

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
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)

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

    if (!response.ok) {
      const message =
        typeof data?.error_description === 'string'
          ? data.error_description
          : typeof data?.error?.message === 'string'
            ? data.error.message
            : typeof data?.msg === 'string'
              ? data.msg
              : typeof data?.message === 'string'
                ? data.message
                : `HTTP ${response.status}`
      throw new Error(message)
    }

    return { response, data }
  } finally {
    clearTimeout(timeout)
  }
}

function authAdminHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

function authAnonHeaders(env) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  }
}

async function createConfirmedUser(env, email, password) {
  const { data } = await fetchJson(new URL('/auth/v1/admin/users', env.SUPABASE_URL), {
    method: 'POST',
    headers: authAdminHeaders(env),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: 'Lumos P0 Smoke Test',
      },
    }),
  })

  const user = data?.user ?? data
  if (!user?.id) throw new Error('Supabase did not return a user id.')

  return user
}

async function deleteUser(env, userId) {
  await fetchJson(new URL(`/auth/v1/admin/users/${userId}`, env.SUPABASE_URL), {
    method: 'DELETE',
    headers: authAdminHeaders(env),
  })
}

async function signIn(env, email, password) {
  const tokenUrl = new URL('/auth/v1/token', env.SUPABASE_URL)
  tokenUrl.searchParams.set('grant_type', 'password')

  const { data } = await fetchJson(tokenUrl, {
    method: 'POST',
    headers: authAnonHeaders(env),
    body: JSON.stringify({ email, password }),
  })

  if (!data?.access_token) throw new Error('Supabase did not return an access token.')
  return data.access_token
}

async function apiRequest(pathname, token, options = {}) {
  const { data } = await fetchJson(`${apiBaseUrl}${pathname}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: options.timeoutMs,
  })

  return data
}

function createAnalyzeBody() {
  const now = new Date().toISOString()

  return {
    projectName: 'P0 smoke test',
    folderName: 'Smoke references',
    topic: '用人话解释插件和网页如何打通',
    targetAudience: '不懂后端的产品创建者',
    length: 'short',
    notes: [
      {
        id: 'smoke-note-1',
        folderId: 'smoke-folder-1',
        folderName: 'Smoke references',
        filename: 'smoke-note.md',
        title: '联调说明参考',
        authorName: 'Smoke',
        sourceUrl: 'https://example.com/lumos-smoke-note',
        coverImageUrl: '',
        contentText:
          '先讲用户能看到什么，再讲背后发生了什么。账号、数据库、AI 调用要拆成三步，让非技术用户也知道系统已经真正打通。',
        savedAt: now,
      },
    ],
    snippets: [
      {
        id: 'smoke-snippet-1',
        noteUrl: 'https://example.com/lumos-smoke-note',
        noteTitle: '联调说明参考',
        noteAuthorName: 'Smoke',
        selectedText: '先讲用户能看到什么，再讲背后发生了什么',
        reasonText: '适合解释复杂系统',
        colorTagName: '结构',
        colorValue: '#4D78F2',
        createdAt: now,
      },
    ],
  }
}

function printStep(label, detail = '') {
  const suffix = detail ? ` - ${detail}` : ''
  console.log(`OK ${label}${suffix}`)
}

async function main() {
  const env = {
    ...loadEnv(),
    ...process.env,
  }
  const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  const missingEnv = requiredEnv.filter((key) => !env[key])

  if (missingEnv.length > 0) {
    throw new Error(`Missing env keys: ${missingEnv.join(', ')}`)
  }

  const stamp = Date.now()
  const email = `lumos.smoke.${stamp}@gmail.com`
  const password = `Lumos-smoke-${randomUUID()}!`
  let userId = ''

  console.log('Lumos P0 smoke test')
  console.log(`API: ${apiBaseUrl}`)
  console.log(`Supabase project: ${getProjectRef(env.SUPABASE_URL) ?? 'unknown'}`)
  console.log(`Temporary user: ${email}`)
  console.log('')

  try {
    const user = await createConfirmedUser(env, email, password)
    userId = user.id
    printStep('created temporary confirmed user')

    const accessToken = await signIn(env, email, password)
    printStep('signed in with Supabase password auth')

    const me = await apiRequest('/v1/me', accessToken)
    if (!me?.ok || me.user?.email !== email) throw new Error('/v1/me did not return the smoke user.')
    printStep('/v1/me', me.user.email)

    const foldersBefore = await apiRequest('/v1/folders', accessToken)
    if (!foldersBefore?.ok || !Array.isArray(foldersBefore.folders)) {
      throw new Error('/v1/folders did not return a folder list.')
    }
    printStep('/v1/folders', `${foldersBefore.folders.length} existing folders`)

    const createdFolder = await apiRequest('/v1/folders', accessToken, {
      method: 'POST',
      body: { name: `Smoke Folder ${stamp}` },
    })
    if (!createdFolder?.ok || !createdFolder.folder?.id) {
      throw new Error('/v1/folders did not create a folder.')
    }
    printStep('created folder', createdFolder.folder.name)

    const projectId = randomUUID()
    const conversationId = randomUUID()
    const messageId = randomUUID()
    const firstDraftId = randomUUID()
    const now = new Date().toISOString()
    const workspaceInput = {
      projects: [
        {
          id: projectId,
          name: `Smoke Project ${stamp}`,
          folderId: createdFolder.folder.id,
          activeConversationId: conversationId,
          updatedAt: now,
          conversations: [
            {
              id: conversationId,
              title: '新的文案对话',
              step: 'learn',
              pinned: false,
              selectedReferenceIds: [],
              length: null,
              topic: '验证云端工作区持久化',
              targetAudience: '产品测试人员',
              analysisReady: false,
              finalizedAt: null,
              createdAt: now,
              updatedAt: now,
              lastOpenedAt: now,
              state: { currentDraftVersionId: firstDraftId },
              messages: [
                {
                  id: messageId,
                  channel: 'analysis',
                  role: 'user',
                  content: {
                    stage: 'setup',
                    lines: ['验证工作区消息保存。'],
                  },
                  createdAt: now,
                },
              ],
              draft: {
                title: '工作草稿',
                body: ['这是无 AI 的持久化冒烟测试。', '测试账号删除后数据会自动清理。', '不产生模型费用。'],
                source: 'smoke_test',
              },
              drafts: [
                {
                  id: firstDraftId,
                  version: 1,
                  title: '工作草稿',
                  body: ['这是无 AI 的持久化冒烟测试。', '测试账号删除后数据会自动清理。', '不产生模型费用。'],
                  source: 'smoke_test',
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            },
          ],
        },
      ],
    }

    const syncedWorkspace = await apiRequest('/v1/workspace', accessToken, {
      method: 'PUT',
      body: workspaceInput,
    })
    if (!syncedWorkspace?.ok) throw new Error('/v1/workspace did not sync the workspace.')
    printStep('synced cloud workspace')

    const workspace = await apiRequest('/v1/workspace', accessToken)
    const smokeProject = workspace?.projects?.find((project) => project.id === projectId)
    if (
      !workspace?.ok ||
      smokeProject?.conversations?.[0]?.messages?.[0]?.id !== messageId ||
      smokeProject?.conversations?.[0]?.draft?.title !== '工作草稿' ||
      smokeProject?.conversations?.[0]?.drafts?.length !== 1
    ) {
      throw new Error('/v1/workspace did not return the saved workspace state.')
    }
    printStep('read cloud workspace', smokeProject.name)

    const secondDraftId = randomUUID()
    const secondDraftTime = new Date(Date.now() + 1000).toISOString()
    const workspaceConversation = workspaceInput.projects[0].conversations[0]
    workspaceConversation.state = { currentDraftVersionId: secondDraftId }
    workspaceConversation.draft = {
      title: '工作草稿第二版',
      body: ['第一版仍应保留。', '第二版成为当前工作稿。'],
      source: 'manual_edit',
    }
    workspaceConversation.drafts.push({
      id: secondDraftId,
      version: 2,
      title: '工作草稿第二版',
      body: ['第一版仍应保留。', '第二版成为当前工作稿。'],
      source: 'manual_edit',
      createdAt: secondDraftTime,
      updatedAt: secondDraftTime,
    })

    await apiRequest('/v1/workspace', accessToken, {
      method: 'PUT',
      body: workspaceInput,
    })
    const versionedWorkspace = await apiRequest('/v1/workspace', accessToken)
    const versionedConversation = versionedWorkspace?.projects
      ?.find((project) => project.id === projectId)
      ?.conversations?.find((conversation) => conversation.id === conversationId)
    if (
      versionedConversation?.draft?.id !== secondDraftId ||
      versionedConversation?.drafts?.length !== 2 ||
      !versionedConversation.drafts.some((draft) => draft.id === firstDraftId)
    ) {
      throw new Error('/v1/workspace did not preserve both draft versions.')
    }
    printStep('preserved draft history', '2 versions')

    const firstDraftSnapshot = workspaceConversation.drafts[0]
    firstDraftSnapshot.title = '不应覆盖的新标题'
    firstDraftSnapshot.body = ['这是一份来自旧设备的过期内容。']
    firstDraftSnapshot.updatedAt = new Date(Date.parse(now) - 1000).toISOString()
    await apiRequest('/v1/workspace', accessToken, {
      method: 'PUT',
      body: workspaceInput,
    })
    const staleWorkspace = await apiRequest('/v1/workspace', accessToken)
    const staleConversation = staleWorkspace?.projects
      ?.find((project) => project.id === projectId)
      ?.conversations?.find((conversation) => conversation.id === conversationId)
    if (staleConversation?.drafts?.find((draft) => draft.id === firstDraftId)?.title !== '工作草稿') {
      throw new Error('/v1/workspace allowed a stale client to overwrite draft history.')
    }
    printStep('rejected stale draft overwrite')

    firstDraftSnapshot.title = '工作草稿'
    firstDraftSnapshot.body = ['这是无 AI 的持久化冒烟测试。', '测试账号删除后数据会自动清理。', '不产生模型费用。']
    firstDraftSnapshot.updatedAt = now
    workspaceConversation.state = { currentDraftVersionId: null }
    workspaceConversation.draft = null
    await apiRequest('/v1/workspace', accessToken, {
      method: 'PUT',
      body: workspaceInput,
    })
    const invalidatedWorkspace = await apiRequest('/v1/workspace', accessToken)
    const invalidatedConversation = invalidatedWorkspace?.projects
      ?.find((project) => project.id === projectId)
      ?.conversations?.find((conversation) => conversation.id === conversationId)
    if (invalidatedConversation?.draft !== null || invalidatedConversation?.drafts?.length !== 2) {
      throw new Error('/v1/workspace deleted history when the current draft was invalidated.')
    }
    printStep('invalidated current draft', 'history retained')

    const memory = await apiRequest('/v1/feedback-memories', accessToken, {
      method: 'POST',
      body: {
        projectId,
        conversationId,
        type: 'manual_edit',
        content: '第三天，我已经知道在哪个路口提前减速。',
        context: {
          beforeText: '后来我逐渐熟悉了路线。',
          afterText: '第三天，我已经知道在哪个路口提前减速。',
          source: 'smoke_test',
        },
      },
    })
    if (!memory?.ok || memory.memory?.type !== 'manual_edit') {
      throw new Error('/v1/feedback-memories did not create a memory.')
    }
    printStep('created feedback memory')

    const writingProfiles = await apiRequest(
      `/v1/writing-profile?projectId=${projectId}`,
      accessToken,
    )
    if (
      !writingProfiles?.ok ||
      writingProfiles.accountProfile !== null ||
      writingProfiles.projectProfile !== null
    ) {
      throw new Error('/v1/writing-profile did not return an empty profile context.')
    }
    printStep('read writing profile context', 'account and project revisions are empty')

    if (shouldCheckAi) {
      const ai = await apiRequest('/v1/ai/analyze', accessToken, {
        method: 'POST',
        body: createAnalyzeBody(),
        timeoutMs: 60_000,
      })
      if (!ai?.ok || !ai.analysis?.summary) throw new Error('/v1/ai/analyze did not return analysis.')
      printStep('DeepSeek analyze', `${ai.model}, ${ai.usage?.totalTokens ?? '?'} tokens`)
    } else {
      console.log('SKIP DeepSeek analyze - run `pnpm smoke:p0:ai` when you want to spend a tiny AI request.')
    }
  } finally {
    if (userId) {
      try {
        await deleteUser(env, userId)
        printStep('deleted temporary user')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'delete failed'
        console.log(`FAIL deleted temporary user - ${message}`)
        process.exitCode = 1
      }
    }
  }

  console.log('')
  console.log('Result: P0 account, API auth, and write path are healthy.')
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
