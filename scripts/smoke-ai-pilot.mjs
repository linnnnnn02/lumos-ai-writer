#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(repoRoot, '.env')
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8788/api'
const paidRunConfirmed = process.argv.includes('--confirm-paid')
const printJson = process.argv.includes('--json')

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

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!response.ok) {
      const message =
        typeof data?.error?.message === 'string'
          ? data.error.message
          : typeof data?.message === 'string'
          ? data.message
          : typeof data?.msg === 'string'
            ? data.msg
            : `HTTP ${response.status}`
      throw new Error(message)
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

function adminHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function createPilotSession(env, userId) {
  const user = await fetchJson(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: adminHeaders(env),
  })
  if (!user?.email) throw new Error('Pilot user does not have an email address.')

  const link = await fetchJson(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: adminHeaders(env),
    body: JSON.stringify({ type: 'magiclink', email: user.email }),
  })
  const tokenHash = link?.hashed_token || link?.properties?.hashed_token
  if (!tokenHash) throw new Error('Supabase did not return a magic-link token hash.')

  const session = await fetchJson(`${env.SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  })
  if (!session?.access_token) throw new Error('Supabase did not return an access token.')
  return session.access_token
}

async function apiRequest(pathname, accessToken, body) {
  return fetchJson(`${apiBaseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: 90_000,
  })
}

async function createIsolatedProject(env, userId, projectId, projectName) {
  await fetchJson(`${env.SUPABASE_URL}/rest/v1/projects`, {
    method: 'POST',
    headers: adminHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify({
      id: projectId,
      user_id: userId,
      name: projectName,
      updated_at: new Date().toISOString(),
    }),
  })
}

async function deleteIsolatedProject(env, userId, projectId) {
  const query = new URL('/rest/v1/projects', env.SUPABASE_URL)
  query.searchParams.set('id', `eq.${projectId}`)
  query.searchParams.set('user_id', `eq.${userId}`)
  await fetchJson(query, {
    method: 'DELETE',
    headers: adminHeaders(env, { Prefer: 'return=minimal' }),
  })
}

function buildFixture(projectId, projectName) {
  const now = new Date().toISOString()
  const topic = '插件和网页如何一步步学会用户的写作方式'
  const targetAudience = '不懂技术、但希望 AI 越写越像自己的内容创作者'
  const notes = [
    {
      id: 'pilot-chain-note-1',
      folderId: 'pilot-chain-folder-1',
      folderName: '产品表达参考',
      filename: '它不是突然懂我.md',
      title: '它不是突然懂我',
      authorName: 'Lumos Pilot',
      sourceUrl: 'https://example.com/lumos-pilot-chain',
      coverImageUrl: '',
      contentText:
        '系统没有在某一天突然掌握我的风格。每次我留下一个版本、划去不合适的句子，下一次结果都会有一点变化。连续使用后，我发现它会优先保留我反复选择的细节。这个过程更像是在一次次选择里，慢慢积累判断依据。',
      savedAt: now,
    },
  ]
  const snippets = [
    {
      id: 'pilot-chain-snippet-1',
      noteUrl: notes[0].sourceUrl,
      noteTitle: notes[0].title,
      noteAuthorName: notes[0].authorName,
      selectedText: '系统没有在某一天突然掌握我的风格。',
      reasonText: '喜欢先承认边界，不把产品写成一步到位的神器。',
      colorTagName: '克制可信',
      colorValue: '#64748b',
      createdAt: now,
    },
    {
      id: 'pilot-chain-snippet-2',
      noteUrl: notes[0].sourceUrl,
      noteTitle: notes[0].title,
      noteAuthorName: notes[0].authorName,
      selectedText: '这个过程更像是在一次次选择里，慢慢积累判断依据。',
      reasonText: '喜欢先纠正常见误解，再用具体动作解释原因，结尾不喊口号。',
      colorTagName: '因果解释',
      colorValue: '#0f766e',
      createdAt: now,
    },
  ]
  const profileBody = {
    scope: 'project',
    projectId,
    previousProfile: null,
    libraryEvidence: {
      notes: notes.map((note) => ({
        id: note.id,
        title: note.title,
        contentText: note.contentText,
      })),
      snippets: snippets.map((snippet) => ({
        id: snippet.id,
        noteId: notes[0].id,
        selectedText: snippet.selectedText,
        reasonText: snippet.reasonText,
        colorTagName: snippet.colorTagName,
      })),
    },
    feedbackEvidence: [
      {
        id: 'pilot-chain-feedback-1',
        projectId,
        type: 'manual_edit',
        content: '连续用了几次，开头那些多余的形容词少了。',
        context: {
          beforeText: '这个功能越来越智能。',
          afterText: '连续用了几次，开头那些多余的形容词少了。',
        },
        source: 'isolated_ai_pilot',
        createdAt: now,
      },
      {
        id: 'pilot-chain-feedback-2',
        projectId,
        type: 'rejected_rewrite',
        content: '彻底改变你的创作方式。',
        context: { reason: '夸大、像广告，也无法由现有证据支持。' },
        source: 'isolated_ai_pilot',
        createdAt: now,
      },
      {
        id: 'pilot-chain-feedback-3',
        projectId,
        type: 'final_choice',
        content: '我更愿意保留能说明变化过程的具体动作。',
        context: { reason: '保留克制的因果解释作为收尾。' },
        source: 'isolated_ai_pilot',
        createdAt: now,
      },
    ],
    projectContext: { projectName, topic, targetAudience },
  }
  return { now, topic, targetAudience, notes, snippets, profileBody }
}

function countCharacters(value) {
  return Array.from(value.replace(/\s/g, '')).length
}

function assertDraftContract(draft) {
  const bodyCharacters = countCharacters(draft.body.join(''))
  if (draft.body.length < 3 || draft.body.length > 6) {
    throw new Error(`Medium draft has ${draft.body.length} paragraphs; expected 3-6.`)
  }
  if (bodyCharacters < 201 || bodyCharacters > 600) {
    throw new Error(`Medium draft has ${bodyCharacters} characters; expected 201-600.`)
  }
  if (countCharacters(draft.title) > 35) {
    throw new Error('Draft title exceeds 35 characters.')
  }
  return bodyCharacters
}

async function main() {
  if (!paidRunConfirmed) {
    throw new Error('Paid AI smoke test requires --confirm-paid.')
  }

  const env = { ...loadEnv(), ...process.env }
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'AI_PILOT_USER_IDS',
  ]
  const missing = required.filter((key) => !env[key])
  if (missing.length > 0) throw new Error(`Missing env keys: ${missing.join(', ')}`)

  const pilotUserId = env.AI_PILOT_USER_IDS.split(',').map((value) => value.trim()).find(Boolean)
  if (!pilotUserId) throw new Error('AI_PILOT_USER_IDS does not contain a user ID.')

  const projectId = randomUUID()
  const projectName = `Lumos isolated AI pilot ${Date.now()}`
  const fixture = buildFixture(projectId, projectName)
  let projectCreated = false

  console.log('Lumos isolated AI pilot smoke test')
  console.log(`API: ${apiBaseUrl}`)

  try {
    const token = await createPilotSession(env, pilotUserId)
    console.log('OK authenticated allowlisted pilot account')

    await createIsolatedProject(env, pilotUserId, projectId, projectName)
    projectCreated = true
    console.log('OK created isolated project')

    const profile = await apiRequest('/v1/ai/writing-profile', token, fixture.profileBody)
    if (!profile?.ok || !profile.profile?.summary || profile.reused) {
      throw new Error('Writing profile did not create a new project revision.')
    }
    console.log(`OK writing profile - ${profile.usage?.totalTokens ?? '?'} tokens`)

    const analysis = await apiRequest('/v1/ai/analyze', token, {
      projectName,
      folderName: '产品表达参考',
      topic: fixture.topic,
      targetAudience: fixture.targetAudience,
      length: 'medium',
      notes: fixture.notes,
      snippets: fixture.snippets,
    })
    if (!analysis?.ok || !analysis.analysis?.coreJudgement) {
      throw new Error('Reference analysis did not return a usable result.')
    }
    console.log(`OK reference analysis - ${analysis.usage?.totalTokens ?? '?'} tokens`)

    const insufficientDraft = await apiRequest('/v1/ai/draft', token, {
      projectId,
      projectName,
      topic: '介绍一款尚未提供具体信息的产品',
      targetAudience: fixture.targetAudience,
      length: 'medium',
      analysis: analysis.analysis,
      notes: fixture.notes,
      snippets: fixture.snippets,
      brief: {
        mustInclude: '只使用已确认的产品事实。',
        avoidTone: '不补写产品名称、成分、功效或使用体验。',
        objective: '帮助读者理解产品。',
        sourceFacts: '',
        instructions: '',
        allowConservativeDraft: false,
        contentMode: 'product_education',
        facts: [],
      },
    })
    if (
      !insufficientDraft?.ok ||
      insufficientDraft.status !== 'insufficient_facts' ||
      !insufficientDraft.assessment?.missingFacts?.length
    ) {
      throw new Error('Draft fact gate did not return the expected insufficient_facts result.')
    }
    console.log(
      `OK draft fact gate - ${insufficientDraft.assessment.missingFacts.length} missing fact prompts, no model call for this step`,
    )

    const draft = await apiRequest('/v1/ai/draft', token, {
      projectId,
      projectName,
      topic: fixture.topic,
      targetAudience: fixture.targetAudience,
      length: 'medium',
      analysis: analysis.analysis,
      notes: fixture.notes,
      snippets: fixture.snippets,
      brief: {
        mustInclude:
          '第一天删掉广告腔；第二天开头不再堆形容词；第三天真实细节被前置；明确说明变化来自用户留下的可追溯反馈，而非系统凭空猜测。',
        avoidTone: '不使用神器、颠覆、彻底改变、精准拿捏；不承诺完全替代人工。',
        objective: '用具体的三天变化解释插件和网页如何逐步学会用户的写作方式。',
        sourceFacts:
          '第一天，用户删掉一句太像广告的话并改成自己的日常表达。第二天，同类内容的开头不再堆三个形容词。第三天，用户标注过的真实细节被放到前面。系统依据每次选择、删除和改写留下的证据调整写作。',
        instructions: '先说明学习依赖累计反馈，再按三天的变化解释过程，结尾保持克制。',
        allowConservativeDraft: false,
        contentMode: 'other',
        facts: [
          {
            id: 'day-one-edit',
            statement: '第一天，用户删掉一句太像广告的话并改成自己的日常表达。',
            required: true,
          },
          {
            id: 'day-two-opening',
            statement: '第二天，同类内容的开头不再堆三个形容词。',
            required: true,
          },
          {
            id: 'day-three-detail',
            statement: '第三天，用户标注过的真实细节被放到前面。',
            required: true,
          },
          {
            id: 'learning-evidence',
            statement: '系统依据每次选择、删除和改写留下的证据调整写作。',
            required: true,
          },
        ],
      },
    })
    if (!draft?.ok) throw new Error('Draft generation failed.')
    if (draft.status === 'insufficient_facts') {
      const missingLabels = draft.assessment.missingFacts
        .map((fact) => fact.label)
        .join(', ')
      throw new Error(`Grounded draft fixture is missing required facts: ${missingLabels}`)
    }
    if (draft.status !== 'generated' || !draft.draft?.body) {
      throw new Error(`Draft returned an unsupported status: ${String(draft.status)}`)
    }
    const draftCharacters = assertDraftContract(draft.draft)
    console.log(
      `OK medium draft - ${draft.draft.body.length} paragraphs, ${draftCharacters} characters, ${draft.usage?.totalTokens ?? '?'} tokens`,
    )

    const selectedIndex = Math.min(1, draft.draft.body.length - 1)
    const selectedText = draft.draft.body[selectedIndex]
    const rewrite = await apiRequest('/v1/ai/rewrite', token, {
      projectId,
      projectName,
      topic: fixture.topic,
      targetAudience: fixture.targetAudience,
      draft: draft.draft,
      fieldId: `body-${selectedIndex}`,
      selectedText,
      contextBefore: draft.draft.body[selectedIndex - 1] || '',
      contextAfter: draft.draft.body[selectedIndex + 1] || '',
      instruction: '保持事实不变，减少解释腔，写得更像亲身体验；不要添加数字、结果或新动作。',
      analysis: analysis.analysis,
    })
    if (!rewrite?.ok || rewrite.rewrite?.suggestions?.length < 2) {
      throw new Error('Rewrite did not return at least two grounded suggestions.')
    }
    console.log(
      `OK grounded rewrite - ${rewrite.rewrite.suggestions.length} suggestions, ${rewrite.usage?.totalTokens ?? '?'} tokens`,
    )

    const preview = await apiRequest('/v1/ai/reader-preview', token, {
      projectId,
      projectName,
      topic: fixture.topic,
      targetAudience: fixture.targetAudience,
      readerAudience: fixture.targetAudience,
      draft: draft.draft,
      analysis: analysis.analysis,
    })
    if (!preview?.ok || preview.preview?.annotations?.length < 2) {
      throw new Error('Reader preview did not return grounded annotations.')
    }
    console.log(
      `OK reader preview - ${preview.preview.annotations.length} annotations, ${preview.preview.suggestions.length} suggestions, ${preview.usage?.totalTokens ?? '?'} tokens`,
    )

    if (printJson) {
      console.log(
        JSON.stringify(
          {
            profile: profile.profile,
            analysis: analysis.analysis,
            draft: draft.draft,
            rewrite: rewrite.rewrite,
            preview: preview.preview,
          },
          null,
          2,
        ),
      )
    }
  } finally {
    if (projectCreated) {
      await deleteIsolatedProject(env, pilotUserId, projectId)
      console.log('OK deleted isolated project and project-scoped profile')
    }
  }
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
