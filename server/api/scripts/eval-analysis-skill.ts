import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  aiAnalysisResultSchema,
  analyzeReferencesRequestSchema,
} from '@lumos-ai/shared'
import { analysisSkillV1 } from '../src/skills/analysis-v1/index.js'
import { createApiApp } from '../src/app.js'
import { prepareAiSkill } from '../src/skills/runtime.js'

async function readJsonFixture(name: string) {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  ) as unknown
}

const input = analyzeReferencesRequestSchema.parse(
  await readJsonFixture('analysis-v1-input.json'),
)
const expectedOutput = aiAnalysisResultSchema.parse(
  await readJsonFixture('analysis-v1-output.json'),
)
const prepared = await prepareAiSkill(analysisSkillV1, input)
const userPayload = JSON.parse(prepared.userPrompt) as {
  task: string
  input: {
    notes: Array<{ contentText: string }>
    snippets: Array<{ selectedText: string; reasonText: string }>
  }
}

assert.equal(prepared.metadata.id, 'reference-analysis')
assert.equal(prepared.metadata.version, '1.0.0')
assert.match(prepared.metadata.promptHash, /^[a-f0-9]{64}$/)
assert.equal(userPayload.task, 'analyze_reference_writing_patterns')
assert.equal(userPayload.input.notes.length, 1)
assert.equal(userPayload.input.snippets.length, 2)
assert.ok(userPayload.input.notes.every((note) => note.contentText.length <= 1203))
assert.ok(userPayload.input.snippets.every((snippet) => snippet.selectedText.length <= 603))
assert.ok(userPayload.input.snippets.every((snippet) => snippet.reasonText.length <= 403))
assert.ok(prepared.systemPrompt.includes('证据优先级'))
assert.ok(prepared.systemPrompt.includes('没有足够证据时明确降低结论强度'))
assert.doesNotThrow(() => prepared.outputSchema.parse(expectedOutput))

for (const snippet of expectedOutput.featuredSnippets) {
  assert.ok(
    input.snippets.some(
      (source) =>
        source.selectedText === snippet.quote && source.noteUrl === snippet.noteUrl,
    ),
    `Featured snippet is not grounded in input: ${snippet.quote}`,
  )
}

const api = createApiApp()
const disabledAiEnv = {
  APP_ENV: 'local',
  AI_FEATURE_ENABLED: 'false',
  AI_PROVIDER_PRIMARY: 'deepseek',
  DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
}
const statusResponse = await api.request('/v1/config/status', {}, disabledAiEnv)
const statusBody = (await statusResponse.json()) as {
  ai: { enabled: boolean; configured: boolean }
}
assert.equal(statusResponse.status, 200)
assert.equal(statusBody.ai.enabled, false)
assert.equal(statusBody.ai.configured, true)

const disabledResponse = await api.request(
  '/v1/ai/analyze',
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

console.log('analysis-v1 offline evaluation passed')
console.log(`skill: ${prepared.metadata.id}@${prepared.metadata.version}`)
console.log(`prompt hash: ${prepared.metadata.promptHash}`)
console.log('AI feature gate: closed')
console.log('paid model calls: 0')
