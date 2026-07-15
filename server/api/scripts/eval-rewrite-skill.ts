import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  aiRewriteResultSchema,
  rewriteDraftRequestSchema,
  rewriteDraftResponseSchema,
  writingProfileSchema,
} from '@lumos-ai/shared'
import { createApiApp } from '../src/app.js'
import {
  rewriteSkillV1,
  validateRewriteSkillOutput,
} from '../src/skills/rewrite-v1/index.js'
import { prepareAiSkill } from '../src/skills/runtime.js'

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
  }
}

assert.equal(prepared.metadata.id, 'selection-rewrite')
assert.equal(prepared.metadata.version, '1.0.0')
assert.match(prepared.metadata.promptHash, /^[a-f0-9]{64}$/)
assert.equal(userPayload.task, 'rewrite_selected_text')
assert.equal(userPayload.input.instruction, input.instruction)
assert.equal(userPayload.input.selection.fieldId, input.fieldId)
assert.equal(userPayload.input.selection.selectedText, input.selectedText)
assert.deepEqual(userPayload.input.fullDraft, input.draft)
assert.ok(userPayload.input.writingProfile.account?.mustAvoid.includes('结尾突然总结上价值'))
assert.equal(userPayload.input.writingProfile.project, null)
assert.ok(prepared.systemPrompt.includes('当前 instruction > project writingProfile > account writingProfile'))
assert.ok(prepared.systemPrompt.includes('不得返回整篇文案、整段未选文字或改写后的 fullDraft'))

assert.doesNotThrow(() => validateRewriteSkillOutput(expectedOutput, input.selectedText))
assert.equal(expectedOutput.suggestions.length, 3)
assert.ok(expectedOutput.recommendedIndex < expectedOutput.suggestions.length)
assert.ok(
  expectedOutput.suggestions.every(
    (suggestion) => !/改变生活|成长|意义|成为更好的自己/.test(suggestion.text),
  ),
)
assert.equal(new Set(expectedOutput.suggestions.map((item) => item.text)).size, 3)
assert.throws(() =>
  validateRewriteSkillOutput(
    {
      ...expectedOutput,
      suggestions: expectedOutput.suggestions.map((suggestion, index) =>
        index === 0 ? { ...suggestion, text: input.selectedText } : suggestion,
      ),
    },
    input.selectedText,
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
console.log('AI feature gate: closed')
console.log('paid model calls: 0')
