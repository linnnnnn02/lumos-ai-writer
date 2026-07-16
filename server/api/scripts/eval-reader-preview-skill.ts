import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  aiDraftCopySchema,
  aiReaderPreviewResultSchema,
  generateDraftRequestSchema,
  previewDraftForReaderRequestSchema,
  previewDraftForReaderResponseSchema,
  writingProfileSchema,
} from '@lumos-ai/shared'
import { createApiApp } from '../src/app.js'
import {
  parseJsonContent,
  previewDraftForReaderWithDeepSeek,
} from '../src/ai/deepseek.js'
import { readConfig } from '../src/env.js'
import {
  buildReaderPreviewRepairUserPrompt,
  filterGroundedReaderSuggestions,
  readerPreviewRepairSystemPrompt,
  readerPreviewSkillV1,
  validateReaderPreviewSkillOutput,
} from '../src/skills/reader-preview-v1/index.js'
import { prepareAiSkill } from '../src/skills/runtime.js'

async function readJsonFixture(name: string) {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  ) as unknown
}

const draftInput = generateDraftRequestSchema.parse(
  await readJsonFixture('draft-v1-input.json'),
)
const draft = aiDraftCopySchema.parse(
  await readJsonFixture('draft-v1-output.json'),
)
const input = previewDraftForReaderRequestSchema.parse({
  projectId: '22222222-2222-4222-8222-222222222222',
  projectName: draftInput.projectName,
  topic: draftInput.topic,
  targetAudience: draftInput.targetAudience,
  readerAudience: '想尝试骑车通勤，但担心体力和路线判断压力的上班族',
  draft,
  analysis: draftInput.analysis,
})
const expectedOutput = aiReaderPreviewResultSchema.parse(
  await readJsonFixture('reader-preview-v1-output.json'),
)
const accountWritingProfile = writingProfileSchema.parse(
  await readJsonFixture('writer-model-v1-output.json'),
)
const prepared = await prepareAiSkill(readerPreviewSkillV1, {
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
  draft: input.draft,
  analysis: input.analysis ?? null,
})
const userPayload = JSON.parse(prepared.userPrompt) as {
  task: string
  input: {
    readerAudience: string
    draft: { title: string; body: string[] }
    writingProfile: {
      account: { mustAvoid: string[] } | null
      project: unknown | null
    }
    analysis: { readerView: string[] } | null
    groundingPolicy: {
      mode: string
      suggestionRule: string
      missingInformation: string
    }
  }
}

assert.equal(prepared.metadata.id, 'target-reader-preview')
assert.equal(prepared.metadata.version, '1.0.3')
assert.match(prepared.metadata.promptHash, /^[a-f0-9]{64}$/)
assert.equal(userPayload.task, 'preview_draft_as_target_reader')
assert.equal(userPayload.input.readerAudience, input.readerAudience)
assert.deepEqual(userPayload.input.draft, input.draft)
assert.ok(userPayload.input.analysis?.readerView.length)
assert.ok(userPayload.input.writingProfile.account?.mustAvoid.includes('结尾突然总结上价值'))
assert.equal(userPayload.input.writingProfile.project, null)
assert.equal(userPayload.input.groundingPolicy.mode, 'closed_world')
assert.ok(userPayload.input.groundingPolicy.suggestionRule.includes('不得代写'))
assert.ok(userPayload.input.groundingPolicy.missingInformation.includes('条件式'))
assert.ok(prepared.systemPrompt.includes('这不是用户调研、真实阅读数据或效果预测'))
assert.ok(prepared.systemPrompt.includes('逐字复制一段连续原文'))
assert.ok(prepared.systemPrompt.includes('不得要求补写输入中不存在'))
assert.ok(prepared.systemPrompt.includes('闭世界事实规则'))
assert.deepEqual(
  parseJsonContent('{"items":[{"id":1}\n {"id":2}]}'),
  { items: [{ id: 1 }, { id: 2 }] },
)
assert.deepEqual(
  parseJsonContent('{"annotationIds":["annotation-1"\n "annotation-2"]}'),
  { annotationIds: ['annotation-1', 'annotation-2'] },
)
assert.deepEqual(
  parseJsonContent('{"confidenceBands":[0.7\n 0.9]}'),
  { confidenceBands: [0.7, 0.9] },
)
assert.throws(() =>
  parseJsonContent('{"items":[{"id":1}\n {"id":2}\n {"id":3}]}'),
)
assert.throws(() => parseJsonContent('{"first":1\n "second":2}'))
assert.throws(() => parseJsonContent('{"items":["first"\n invalid]}'))

assert.doesNotThrow(() =>
  validateReaderPreviewSkillOutput(expectedOutput, draft, groundingSource),
)
assert.ok(expectedOutput.annotations.some((item) => item.tone === 'interest'))
assert.ok(expectedOutput.annotations.some((item) => item.tone === 'risk'))
assert.ok(expectedOutput.annotations.some((item) => item.tone === 'question'))
assert.ok(expectedOutput.annotations.every((item) => item.confidence <= 0.9))
for (const annotation of expectedOutput.annotations) {
  const bodyMatch = annotation.fieldId.match(/^body-(\d+)$/)
  const field = annotation.fieldId === 'title'
    ? draft.title
    : bodyMatch
      ? draft.body[Number(bodyMatch[1])]
      : ''
  assert.ok(field.includes(annotation.quote))
}
assert.ok(
  expectedOutput.suggestions.every(
    (item) => !/新增.{0,4}(里程|速度|数据)|更有共鸣|更加生动/.test(item.instruction),
  ),
)
assert.ok(
  expectedOutput.suggestions.some((item) => item.instruction.includes('不追加改变生活')),
)
assert.throws(() =>
  validateReaderPreviewSkillOutput(
    {
      ...expectedOutput,
      annotations: expectedOutput.annotations.map((annotation, index) =>
        index === 0 ? { ...annotation, quote: '草稿中不存在的原句' } : annotation,
      ),
    },
    draft,
    groundingSource,
  ),
)

const invalidGroundingOutput = aiReaderPreviewResultSchema.parse({
  ...expectedOutput,
  suggestions: expectedOutput.suggestions.map((suggestion, index) =>
    index === 0
      ? {
          ...suggestion,
          instruction: '补充比第一天快5分钟或节省15%的具体数据。',
        }
      : index === 1
        ? { ...suggestion, instruction: '补充节省15%的具体结果。' }
        : { ...suggestion, instruction: '增加两分钟的行动示例。' },
  ),
})
const repairPrompt = JSON.parse(
  buildReaderPreviewRepairUserPrompt(
    prepared.userPrompt,
    invalidGroundingOutput,
    'unsupported numeric claims: 5分钟, 15%',
  ),
) as { task: string; validationError: string }
assert.equal(repairPrompt.task, 'repair_reader_preview_grounding')
assert.ok(repairPrompt.validationError.includes('15%'))

const partiallyInvalidOutput = aiReaderPreviewResultSchema.parse({
  ...expectedOutput,
  suggestions: expectedOutput.suggestions.map((suggestion, index) =>
    index === 0
      ? { ...suggestion, instruction: '补充比第一天快5分钟的具体数据。' }
      : suggestion,
  ),
})
const filteredOutput = filterGroundedReaderSuggestions(
  partiallyInvalidOutput,
  groundingSource,
)
assert.equal(filteredOutput.suggestions.length, 2)
assert.doesNotThrow(() =>
  validateReaderPreviewSkillOutput(filteredOutput, draft, groundingSource),
)

const originalFetch = globalThis.fetch
const filteringRequests: unknown[] = []
globalThis.fetch = async (_request, init) => {
  filteringRequests.push(JSON.parse(String(init?.body)))
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(partiallyInvalidOutput) } }],
      usage: { prompt_tokens: 400, completion_tokens: 200, total_tokens: 600 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

try {
  const filtered = await previewDraftForReaderWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    input,
  )
  assert.deepEqual(filtered.preview, filteredOutput)
  assert.equal(filteringRequests.length, 1)
} finally {
  globalThis.fetch = originalFetch
}

const mockedRequests: Array<{ messages: Array<{ content: string }> }> = []
const repairedPreviewEnvelope = JSON.stringify(
  { repairedOutput: { payload: expectedOutput } },
  null,
  2,
)
const malformedRepairedPreview = repairedPreviewEnvelope.replace(/},(\s*){/, '}$1{')
assert.notEqual(malformedRepairedPreview, repairedPreviewEnvelope)
let responseIndex = 0
globalThis.fetch = async (_request, init) => {
  mockedRequests.push(JSON.parse(String(init?.body)))
  const first = responseIndex === 0
  responseIndex += 1
  return new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: first
            ? JSON.stringify(invalidGroundingOutput)
            : malformedRepairedPreview,
        },
      }],
      usage: first
        ? { prompt_tokens: 400, completion_tokens: 200, total_tokens: 600 }
        : { prompt_tokens: 300, completion_tokens: 250, total_tokens: 550 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

try {
  const repaired = await previewDraftForReaderWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    input,
  )
  assert.deepEqual(repaired.preview, expectedOutput)
  assert.deepEqual(repaired.usage, {
    promptTokens: 700,
    completionTokens: 450,
    totalTokens: 1150,
  })
  assert.equal(mockedRequests.length, 2)
  assert.equal(
    mockedRequests[1]?.messages[0]?.content,
    readerPreviewRepairSystemPrompt,
  )
} finally {
  globalThis.fetch = originalFetch
}
assert.throws(() =>
  validateReaderPreviewSkillOutput(
    {
      ...expectedOutput,
      annotations: expectedOutput.annotations.map((annotation, index) =>
        index === 0 ? { ...annotation, confidence: 0.95 } : annotation,
      ),
    },
    draft,
    groundingSource,
  ),
)
assert.throws(() =>
  validateReaderPreviewSkillOutput(
    {
      ...expectedOutput,
      suggestions: expectedOutput.suggestions.map((suggestion, index) =>
        index === 0
          ? {
              ...suggestion,
              instruction: '补充比第一天快5分钟或节省15%的具体数据。',
            }
          : suggestion,
      ),
    },
    draft,
    groundingSource,
  ),
)
assert.throws(() =>
  validateReaderPreviewSkillOutput(
    {
      ...expectedOutput,
      suggestions: expectedOutput.suggestions.map((suggestion, index) =>
        index === 0
          ? {
              ...suggestion,
              instruction: '补充靠右骑行和观察后视镜的应对方法。',
            }
          : suggestion,
      ),
    },
    draft,
    groundingSource,
  ),
)

assert.doesNotThrow(() =>
  previewDraftForReaderResponseSchema.parse({
    ok: true,
    provider: 'deepseek',
    model: prepared.model,
    skill: prepared.metadata,
    preview: expectedOutput,
    usage: null,
  }),
)

const api = createApiApp()
const disabledResponse = await api.request(
  '/v1/ai/reader-preview',
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

console.log('reader-preview-v1 offline evaluation passed')
console.log(`skill: ${prepared.metadata.id}@${prepared.metadata.version}`)
console.log(`prompt hash: ${prepared.metadata.promptHash}`)
console.log(`grounded annotations: ${expectedOutput.annotations.length}`)
console.log('real-research claim: forbidden')
console.log('single grounding repair: simulated and usage-combined')
console.log('AI feature gate: closed')
console.log('paid model calls: 0')
