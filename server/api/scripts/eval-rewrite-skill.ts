import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  aiRewriteResultSchema,
  rewriteDraftRequestSchema,
  rewriteDraftResponseSchema,
  writingProfileSchema,
} from '@lumos-ai/shared'
import { createApiApp } from '../src/app.js'
import { rewriteDraftWithDeepSeek } from '../src/ai/deepseek.js'
import { readConfig } from '../src/env.js'
import {
  buildRewriteRepairUserPrompt,
  filterGroundedRewriteSuggestions,
  rewriteRepairSystemPrompt,
  rewriteSkillV1,
  validateRewriteSkillOutput,
} from '../src/skills/rewrite-v1/index.js'
import { prepareAiSkill } from '../src/skills/runtime.js'
import {
  findUnsupportedMaterialTerms,
  findUnsupportedNumericClaims,
} from '../src/skills/shared/grounding.js'

async function readJsonFixture(name: string) {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  ) as unknown
}

const input = rewriteDraftRequestSchema.parse(
  await readJsonFixture('rewrite-v1-input.json'),
)
const expectedOutput = aiRewriteResultSchema.parse(
  await readJsonFixture('rewrite-v1-output.json'),
)
const accountWritingProfile = writingProfileSchema.parse(
  await readJsonFixture('writer-model-v1-output.json'),
)
const prepared = await prepareAiSkill(rewriteSkillV1, {
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
const groundingSource = JSON.stringify({
  selection: {
    selectedText: input.selectedText,
    contextBefore: input.contextBefore,
    contextAfter: input.contextAfter,
  },
  fullDraft: input.draft,
  analysis: input.analysis ?? null,
})
const userPayload = JSON.parse(prepared.userPrompt) as {
  task: string
  input: {
    instruction: string
    selection: { fieldId: string; selectedText: string }
    fullDraft: { title: string; body: string[] }
    writingProfile: {
      account: { mustAvoid: string[] } | null
      project: unknown | null
    }
    groundingPolicy: {
      mode: string
      evidenceSources: string[]
      missingInformation: string
    }
  }
}

assert.equal(prepared.metadata.id, 'selection-rewrite')
assert.equal(prepared.metadata.version, '1.0.3')
assert.match(prepared.metadata.promptHash, /^[a-f0-9]{64}$/)
assert.equal(userPayload.task, 'rewrite_selected_text')
assert.equal(userPayload.input.instruction, input.instruction)
assert.equal(userPayload.input.selection.fieldId, input.fieldId)
assert.equal(userPayload.input.selection.selectedText, input.selectedText)
assert.deepEqual(userPayload.input.fullDraft, input.draft)
assert.ok(userPayload.input.writingProfile.account?.mustAvoid.includes('结尾突然总结上价值'))
assert.equal(userPayload.input.writingProfile.project, null)
assert.equal(userPayload.input.groundingPolicy.mode, 'closed_world')
assert.ok(userPayload.input.groundingPolicy.evidenceSources.includes('fullDraft'))
assert.ok(userPayload.input.groundingPolicy.missingInformation.includes('不得提供'))
assert.ok(prepared.systemPrompt.includes('当前 instruction > project writingProfile > account writingProfile'))
assert.ok(prepared.systemPrompt.includes('不得返回整篇文案、整段未选文字或改写后的 fullDraft'))
assert.ok(prepared.systemPrompt.includes('闭世界事实规则'))

assert.doesNotThrow(() =>
  validateRewriteSkillOutput(
    expectedOutput,
    input.selectedText,
    groundingSource,
  ),
)
assert.equal(expectedOutput.suggestions.length, 3)
assert.ok(expectedOutput.recommendedIndex < expectedOutput.suggestions.length)
assert.ok(
  expectedOutput.suggestions.every(
    (suggestion) => !/改变生活|成长|意义|成为更好的自己/.test(suggestion.text),
  ),
)
assert.equal(new Set(expectedOutput.suggestions.map((item) => item.text)).size, 3)
for (const editorialTerm of ['也就', '就不', '不好', '心里', '摸清']) {
  assert.deepEqual(
    findUnsupportedMaterialTerms(editorialTerm, '', 'rewrite'),
    [],
  )
}
assert.deepEqual(findUnsupportedMaterialTerms('多花', '花', 'rewrite'), [])
assert.deepEqual(findUnsupportedNumericClaims('先骑两三天', groundingSource), [
  '两三天',
])
assert.throws(() =>
  validateRewriteSkillOutput(
    {
      ...expectedOutput,
      suggestions: expectedOutput.suggestions.map((suggestion, index) =>
        index === 0 ? { ...suggestion, text: input.selectedText } : suggestion,
      ),
    },
    input.selectedText,
    groundingSource,
  ),
)

const invalidGroundingOutput = aiRewriteResultSchema.parse({
  ...expectedOutput,
  suggestions: expectedOutput.suggestions.map((suggestion, index) =>
    index === 0
      ? { ...suggestion, text: '明天换条路，争取快五分钟。' }
      : index === 1
        ? { ...suggestion, text: '明天改坐地铁，顺便休息一下。' }
        : { ...suggestion, text: '先骑两三天，不好再说。' },
  ),
})
const repairPrompt = JSON.parse(
  buildRewriteRepairUserPrompt(
    prepared.userPrompt,
    invalidGroundingOutput,
    'unsupported numeric claims: 五分钟',
  ),
) as { task: string; validationError: string }
assert.equal(repairPrompt.task, 'repair_grounding_violation')
assert.ok(repairPrompt.validationError.includes('五分钟'))

const partiallyInvalidOutput = aiRewriteResultSchema.parse({
  ...expectedOutput,
  suggestions: expectedOutput.suggestions.map((suggestion, index) =>
    index === 2 ? { ...suggestion, text: '先骑两三天，不好再说。' } : suggestion,
  ),
})
const filteredOutput = filterGroundedRewriteSuggestions(
  partiallyInvalidOutput,
  groundingSource,
)
assert.equal(filteredOutput.suggestions.length, 2)
assert.doesNotThrow(() =>
  validateRewriteSkillOutput(filteredOutput, input.selectedText, groundingSource),
)

const originalFetch = globalThis.fetch
const filteringRequests: unknown[] = []
globalThis.fetch = async (_request, init) => {
  filteringRequests.push(JSON.parse(String(init?.body)))
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(partiallyInvalidOutput) } }],
      usage: { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

try {
  const filtered = await rewriteDraftWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    input,
  )
  assert.deepEqual(filtered.rewrite, filteredOutput)
  assert.equal(filteringRequests.length, 1)
} finally {
  globalThis.fetch = originalFetch
}

const mockedRequests: Array<{ messages: Array<{ content: string }> }> = []
let responseIndex = 0
globalThis.fetch = async (_request, init) => {
  mockedRequests.push(JSON.parse(String(init?.body)))
  const first = responseIndex === 0
  responseIndex += 1
  return new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify(
            first
              ? invalidGroundingOutput
              : { repair: { candidate: expectedOutput } },
          ),
        },
      }],
      usage: first
        ? { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 }
        : { prompt_tokens: 200, completion_tokens: 120, total_tokens: 320 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

try {
  const repaired = await rewriteDraftWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    input,
  )
  assert.deepEqual(repaired.rewrite, expectedOutput)
  assert.deepEqual(repaired.usage, {
    promptTokens: 500,
    completionTokens: 220,
    totalTokens: 720,
  })
  assert.equal(mockedRequests.length, 2)
  assert.equal(mockedRequests[1]?.messages[0]?.content, rewriteRepairSystemPrompt)
} finally {
  globalThis.fetch = originalFetch
}
assert.throws(() =>
  validateRewriteSkillOutput(
    {
      ...expectedOutput,
      suggestions: expectedOutput.suggestions.map((suggestion, index) =>
        index === 0
          ? { ...suggestion, text: '明天换条路，争取快五分钟。' }
          : suggestion,
      ),
    },
    input.selectedText,
    groundingSource,
  ),
)
assert.throws(() =>
  validateRewriteSkillOutput(
    {
      ...expectedOutput,
      suggestions: expectedOutput.suggestions.map((suggestion, index) =>
        index === 0
          ? {
              ...suggestion,
              text: '所以明天早上查好路线，反正比挤地铁凉快。',
            }
          : suggestion,
      ),
    },
    input.selectedText,
    groundingSource,
  ),
)
assert.throws(() =>
  validateRewriteSkillOutput(
    {
      ...expectedOutput,
      suggestions: expectedOutput.suggestions.map((suggestion, index) =>
        index === 0
          ? { ...suggestion, text: '今天骑慢点，多吹会儿风。' }
          : suggestion,
      ),
    },
    input.selectedText,
    groundingSource,
  ),
)
assert.throws(() =>
  rewriteDraftRequestSchema.parse({
    ...input,
    fieldId: 'body-1',
  }),
)

assert.doesNotThrow(() =>
  rewriteDraftResponseSchema.parse({
    ok: true,
    provider: 'deepseek',
    model: prepared.model,
    skill: prepared.metadata,
    rewrite: expectedOutput,
    usage: null,
  }),
)

const api = createApiApp()
const disabledResponse = await api.request(
  '/v1/ai/rewrite',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  },
  {
    APP_ENV: 'local',
    AI_FEATURE_ENABLED: 'false',
    AI_PROVIDER_PRIMARY: 'deepseek',
    DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
  },
)
const disabledBody = (await disabledResponse.json()) as {
  error: { code: string }
}
assert.equal(disabledResponse.status, 503)
assert.equal(disabledBody.error.code, 'feature_disabled')

console.log('rewrite-v1 offline evaluation passed')
console.log(`skill: ${prepared.metadata.id}@${prepared.metadata.version}`)
console.log(`prompt hash: ${prepared.metadata.promptHash}`)
console.log(`fixture suggestions: ${expectedOutput.suggestions.length}`)
console.log('selection-only contract: enforced')
console.log('single grounding repair: simulated and usage-combined')
console.log('AI feature gate: closed')
console.log('paid model calls: 0')
