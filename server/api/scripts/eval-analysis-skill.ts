import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  aiAnalysisResultSchema,
  analyzeReferencesRequestSchema,
} from '@lumos-ai/shared'
import {
  analysisSkillV1,
  normalizeAnalysisContentMode,
} from '../src/skills/analysis-v1/index.js'
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
    notes: Array<{ id: string; contentText: string }>
    snippets: Array<{
      noteId: string | null
      selectedText: string
      reasonText: string
    }>
  }
}

assert.equal(prepared.metadata.id, 'reference-analysis')
assert.equal(prepared.metadata.version, '1.3.2')
assert.match(prepared.metadata.promptHash, /^[a-f0-9]{64}$/)
assert.equal(userPayload.task, 'analyze_reference_writing_patterns')
assert.equal(userPayload.input.notes.length, 1)
assert.equal(userPayload.input.snippets.length, 2)
assert.equal(userPayload.input.notes[0]?.id, input.notes[0]?.id)
assert.ok(userPayload.input.snippets.every((snippet) => snippet.noteId === input.notes[0]?.id))
assert.ok(userPayload.input.notes.every((note) => note.contentText.length <= 1203))
assert.ok(userPayload.input.snippets.every((snippet) => snippet.selectedText.length <= 603))
assert.ok(userPayload.input.snippets.every((snippet) => snippet.reasonText.length <= 403))
assert.ok(prepared.systemPrompt.includes('证据优先级'))
assert.ok(prepared.systemPrompt.includes('开始分析前必须先完成 contentMode'))
assert.ok(prepared.systemPrompt.includes('产品说明不能因为同一品牌就指导抽奖活动的结构'))
assert.ok(prepared.systemPrompt.includes('证据覆盖至少两种不同的 referenceModes.mode'))
assert.ok(prepared.systemPrompt.includes('featuredSnippets 仅用于证据追溯'))
assert.ok(prepared.systemPrompt.includes('一条信息主线'))
assert.ok(prepared.systemPrompt.includes('不得提供成句示例'))
assert.ok(prepared.systemPrompt.includes('不要把参考文章自己的中段任务默认迁移到新主题'))
assert.ok(prepared.systemPrompt.includes('关键词只能作为关键词使用'))
assert.ok(prepared.systemPrompt.includes('surfaceStyle 是供草稿阶段使用的纯形式通道'))
assert.ok(prepared.systemPrompt.includes('一个 body 段落字符串内部使用换行符'))
assert.equal(expectedOutput.surfaceStyle.sentenceRhythm.length > 0, true)
assert.equal(expectedOutput.contentMode.targetMode, 'unclassified')
assert.ok(prepared.systemPrompt.includes('没有足够证据时明确降低结论强度'))
assert.doesNotThrow(() => prepared.outputSchema.parse(expectedOutput))

const normalizedMismatchedMode = normalizeAnalysisContentMode(
  {
    ...expectedOutput,
    contentMode: {
      targetMode: 'campaign_interaction',
      confidence: 'high',
      rationale: '当前任务要求参与动作和奖励。',
      referenceModes: [
        {
          noteId: input.notes[0]?.id ?? 'missing-note',
          mode: 'product_education',
          compatibility: 'compatible',
          reason: '同一主题，所以尝试迁移。',
        },
      ],
      compatibleReferenceIds: [
        input.notes[0]?.id ?? 'missing-note',
        'hallucinated-note-id',
      ],
      excludedReferences: [],
      stableVoiceSignals: ['短句为主'],
      modeSpecificGuidance: {
        informationPriority: '先事件，再参与动作和奖励。',
        interactionPattern: '问题直接连接参与动作。',
        styleBoundary: '不迁移产品说明结构。',
      },
    },
  },
  input,
)
assert.deepEqual(
  normalizedMismatchedMode.contentMode.compatibleReferenceIds,
  [],
)
assert.equal(
  normalizedMismatchedMode.contentMode.referenceModes[0]?.compatibility,
  'stable_voice_only',
)
assert.deepEqual(normalizedMismatchedMode.contentMode.stableVoiceSignals, [])
assert.deepEqual(normalizedMismatchedMode.contentMode.excludedReferences, [
  {
    noteId: input.notes[0]?.id,
    reason: '同一主题，所以尝试迁移。',
  },
])
assert.equal(normalizedMismatchedMode.featuredSnippets.length, 0)
assert.match(
  normalizedMismatchedMode.surfaceStyle.sentenceRhythm,
  /不迁移其他内容模式/,
)
assert.match(normalizedMismatchedMode.evidence, /未找到与活动互动同模式的参考/)
assert.doesNotMatch(normalizedMismatchedMode.writingMove, /产品|功能/)
assert.match(
  normalizedMismatchedMode.contentMode.modeSpecificGuidance.informationPriority,
  /参与主体、参与动作、奖励/,
)

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
