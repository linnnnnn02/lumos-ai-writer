import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  aiDraftCopySchema,
  generateDraftRequestSchema,
  generateDraftResponseSchema,
  writingProfileSchema,
} from '@lumos-ai/shared'
import { createApiApp } from '../src/app.js'
import {
  DeepSeekOutputValidationError,
  generateDraftWithDeepSeek,
} from '../src/ai/deepseek.js'
import { readConfig } from '../src/env.js'
import {
  buildDraftRepairUserPrompt,
  draftLengthPolicies,
  draftRepairSystemPrompt,
  draftSkillV1,
  validateDraftSkillOutput,
} from '../src/skills/draft-v1/index.js'
import { prepareAiSkill } from '../src/skills/runtime.js'

async function readJsonFixture(name: string) {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  ) as unknown
}

const input = generateDraftRequestSchema.parse(
  await readJsonFixture('draft-v1-input.json'),
)
const expectedOutput = aiDraftCopySchema.parse(
  await readJsonFixture('draft-v1-output.json'),
)
const accountWritingProfile = writingProfileSchema.parse(
  await readJsonFixture('writer-model-v1-output.json'),
)
const prepared = await prepareAiSkill(draftSkillV1, {
  ...input,
  writingProfileContext: {
    accountProfile: {
      id: '33333333-3333-4333-8333-333333333333',
      scope: 'account',
      projectId: null,
      version: 1,
      profile: accountWritingProfile,
      evidenceIds: [],
      skill: {
        id: 'user-writing-model',
        version: '1.0.0',
        promptHash: 'a'.repeat(64),
      },
      createdAt: '2026-06-12T09:00:00.000Z',
    },
    projectProfile: null,
  },
})
const userPayload = JSON.parse(prepared.userPrompt) as {
  task: string
  input: {
    length: keyof typeof draftLengthPolicies
    outputRequirements: {
      maxTitleCharacters: number
      minParagraphs: number
      maxParagraphs: number
      minBodyCharacters: number
      maxBodyCharacters: number
      preferredParagraphs: number
      preferredCharactersPerParagraph: {
        min: number
        max: number
      }
      countingRule: string
    }
    brief: { mustInclude: string; avoidTone: string }
    writingProfile: {
      account: { summary: string; mustAvoid: string[] } | null
      project: unknown | null
    }
    notes: Array<{ contentText: string }>
    snippets: Array<{ selectedText: string; reasonText: string }>
  }
}

assert.equal(prepared.metadata.id, 'xiaohongshu-draft')
assert.equal(prepared.metadata.version, '1.0.4')
assert.match(prepared.metadata.promptHash, /^[a-f0-9]{64}$/)
assert.equal(userPayload.task, 'generate_xiaohongshu_draft')
assert.equal(userPayload.input.length, 'medium')
assert.deepEqual(userPayload.input.outputRequirements, {
  maxTitleCharacters: 35,
  minParagraphs: 5,
  maxParagraphs: 7,
  minBodyCharacters: 201,
  maxBodyCharacters: 600,
  preferredParagraphs: 6,
  preferredCharactersPerParagraph: {
    min: 45,
    max: 75,
  },
  countingRule: 'body 数组元素数量按段落计；body 全部字符串去除空白后按 Unicode 字符计数',
})
assert.equal(userPayload.input.brief.mustInclude, input.brief.mustInclude)
assert.equal(userPayload.input.brief.avoidTone, input.brief.avoidTone)
assert.equal(userPayload.input.writingProfile.account?.summary, accountWritingProfile.summary)
assert.ok(userPayload.input.writingProfile.account?.mustAvoid.includes('结尾突然总结上价值'))
assert.equal(userPayload.input.writingProfile.project, null)
assert.ok(userPayload.input.notes.every((note) => note.contentText.length <= 903))
assert.ok(userPayload.input.snippets.every((snippet) => snippet.selectedText.length <= 503))
assert.ok(userPayload.input.snippets.every((snippet) => snippet.reasonText.length <= 303))
assert.ok(prepared.systemPrompt.includes('不得把参考作者的经历写成用户经历'))
assert.ok(prepared.systemPrompt.includes('brief.mustInclude'))
assert.ok(prepared.systemPrompt.includes('medium：必须 5-7 段'))
assert.ok(prepared.systemPrompt.includes('input.outputRequirements 是本次输出的硬约束'))
assert.ok(prepared.systemPrompt.includes('优先写 6 段，每段 45-75 字'))
assert.doesNotThrow(() => prepared.outputSchema.parse(expectedOutput))
assert.doesNotThrow(() => validateDraftSkillOutput(expectedOutput, input.length))
assert.doesNotThrow(() =>
  validateDraftSkillOutput(
    {
      title: expectedOutput.title,
      body: [
        '字'.repeat(54),
        '字'.repeat(54),
        '字'.repeat(54),
        '字'.repeat(54),
        '字'.repeat(52),
      ],
    },
    input.length,
  ),
)
assert.throws(() =>
  validateDraftSkillOutput(
    {
      title: expectedOutput.title,
      body: expectedOutput.body.slice(0, 3),
    },
    input.length,
  ),
)

const lengthPolicy = draftLengthPolicies[userPayload.input.length]
const bodyCharacterCount = expectedOutput.body.join('').length
assert.ok(expectedOutput.body.length >= lengthPolicy.minParagraphs)
assert.ok(expectedOutput.body.length <= lengthPolicy.maxParagraphs)
assert.ok(bodyCharacterCount >= lengthPolicy.minCharacters)
assert.ok(bodyCharacterCount <= lengthPolicy.maxCharacters)
assert.ok(expectedOutput.body.join('').includes('提前二十分钟下楼'))
assert.ok(expectedOutput.body.join('').includes('第三天'))
assert.ok(!/热血|逆袭|治愈|彻底改变生活/.test(expectedOutput.body.join('')))

assert.doesNotThrow(() =>
  generateDraftResponseSchema.parse({
    ok: true,
    provider: 'deepseek',
    model: prepared.model,
    skill: prepared.metadata,
    draft: expectedOutput,
    usage: null,
  }),
)

const underLengthOutput = aiDraftCopySchema.parse({
  title: expectedOutput.title,
  body: [
    '字'.repeat(36),
    '字'.repeat(36),
    '字'.repeat(36),
    '字'.repeat(36),
    '字'.repeat(36),
  ],
})
const repairPrompt = JSON.parse(
  buildDraftRepairUserPrompt(input, underLengthOutput),
) as {
  task: string
  input: {
    actual: { paragraphs: number; bodyCharacters: number }
    outputRequirements: {
      minBodyCharacters: number
      maxBodyCharacters: number
      repairTargetBodyCharacters: number
    }
  }
}
assert.equal(repairPrompt.task, 'repair_draft_contract')
assert.deepEqual(repairPrompt.input.actual, {
  paragraphs: 5,
  bodyCharacters: 180,
})
assert.equal(repairPrompt.input.outputRequirements.minBodyCharacters, 201)
assert.equal(repairPrompt.input.outputRequirements.maxBodyCharacters, 600)
assert.equal(repairPrompt.input.outputRequirements.repairTargetBodyCharacters, 360)

const originalFetch = globalThis.fetch
const mockedRequests: Array<{
  messages: Array<{ role: string; content: string }>
}> = []
let mockedResponseIndex = 0
globalThis.fetch = async (_input, init) => {
  mockedRequests.push(
    JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>
    },
  )
  const firstResponse = mockedResponseIndex === 0
  mockedResponseIndex += 1

  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(firstResponse ? underLengthOutput : expectedOutput),
          },
        },
      ],
      usage: firstResponse
        ? { prompt_tokens: 1200, completion_tokens: 205, total_tokens: 1405 }
        : { prompt_tokens: 400, completion_tokens: 250, total_tokens: 650 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

try {
  const repaired = await generateDraftWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    input,
  )
  assert.deepEqual(repaired.draft, expectedOutput)
  assert.deepEqual(repaired.usage, {
    promptTokens: 1600,
    completionTokens: 455,
    totalTokens: 2055,
  })
  assert.equal(mockedRequests.length, 2)
  assert.equal(
    mockedRequests[1]?.messages[0]?.content,
    draftRepairSystemPrompt,
  )
  assert.equal(
    JSON.parse(mockedRequests[1]?.messages[1]?.content ?? '{}').task,
    'repair_draft_contract',
  )
} finally {
  globalThis.fetch = originalFetch
}

const failedRepairRequests: unknown[] = []
globalThis.fetch = async (_input, init) => {
  failedRepairRequests.push(JSON.parse(String(init?.body)))
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(underLengthOutput) } }],
      usage: { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

let failedRepairError: unknown
try {
  await generateDraftWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    input,
  )
} catch (error) {
  failedRepairError = error
} finally {
  globalThis.fetch = originalFetch
}
assert.ok(failedRepairError instanceof DeepSeekOutputValidationError)
assert.deepEqual(failedRepairError.usage, {
  promptTokens: 600,
  completionTokens: 200,
  totalTokens: 800,
})
assert.equal(failedRepairRequests.length, 2)

const api = createApiApp()
const disabledAiEnv = {
  APP_ENV: 'local',
  AI_FEATURE_ENABLED: 'false',
  AI_PROVIDER_PRIMARY: 'deepseek',
  DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
}
const disabledResponse = await api.request(
  '/v1/ai/draft',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  },
  disabledAiEnv,
)
const disabledBody = (await disabledResponse.json()) as {
  error: { code: string }
}
assert.equal(disabledResponse.status, 503)
assert.equal(disabledBody.error.code, 'feature_disabled')

console.log('draft-v1 offline evaluation passed')
console.log(`skill: ${prepared.metadata.id}@${prepared.metadata.version}`)
console.log(`prompt hash: ${prepared.metadata.promptHash}`)
console.log(`fixture length: ${expectedOutput.body.length} paragraphs, ${bodyCharacterCount} characters`)
console.log('single repair attempt: simulated and usage-combined')
console.log('AI feature gate: closed')
console.log('paid model calls: 0')
