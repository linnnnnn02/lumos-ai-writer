import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildWritingProfileRequestSchema,
  writingProfileSchema,
} from '@lumos-ai/shared'
import { createApiApp } from '../src/app.js'
import { prepareAiSkill } from '../src/skills/runtime.js'
import {
  normalizeWriterModelOutput,
  writerModelSkillV1,
} from '../src/skills/writer-model-v1/index.js'
import { collectWritingEvidenceIds } from '../src/writing-profile.js'

async function readJsonFixture(name: string) {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  ) as unknown
}

const input = buildWritingProfileRequestSchema.parse(
  await readJsonFixture('writer-model-v1-input.json'),
)
const expectedOutput = writingProfileSchema.parse(
  await readJsonFixture('writer-model-v1-output.json'),
)
const prepared = await prepareAiSkill(writerModelSkillV1, input)
const userPayload = JSON.parse(prepared.userPrompt) as {
  task: string
  input: {
    scope: string
    libraryEvidence: {
      notes: Array<{ id: string; contentText: string }>
      snippets: Array<{ id: string; selectedText: string; reasonText: string }>
    }
    feedbackEvidence: Array<{ id: string; type: string; content: string }>
  }
}

assert.equal(prepared.metadata.id, 'user-writing-model')
assert.equal(prepared.metadata.version, '1.0.0')
assert.match(prepared.metadata.promptHash, /^[a-f0-9]{64}$/)
assert.equal(userPayload.task, 'learn_user_writing_model')
assert.equal(userPayload.input.scope, 'account')
assert.ok(userPayload.input.libraryEvidence.notes.every((item) => item.contentText.length <= 1403))
assert.ok(userPayload.input.libraryEvidence.snippets.every((item) => item.selectedText.length <= 603))
assert.ok(userPayload.input.libraryEvidence.snippets.every((item) => item.reasonText.length <= 403))
assert.ok(userPayload.input.feedbackEvidence.every((item) => item.content.length <= 1603))
assert.ok(prepared.systemPrompt.includes('profile_correction > manual_edit'))
assert.ok(prepared.systemPrompt.includes('项目主题、受众和一次性要求只能进入 openQuestions'))
assert.doesNotThrow(() => prepared.outputSchema.parse(expectedOutput))
assert.ok(prepared.systemPrompt.includes('dimension 只能是以下值之一'))

const normalizedOutput = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...expectedOutput,
      evidenceCount: 999,
      preferences: [
        {
          ...expectedOutput.preferences[0],
          dimension: 'credibility',
        },
        {
          ...expectedOutput.preferences[1],
          scope: 'project',
          confidence: 1,
          supportCount: 99,
          evidenceIds: [
            expectedOutput.preferences[1].evidenceIds[0],
            'invented-evidence-id',
            expectedOutput.preferences[1].evidenceIds[0],
          ],
        },
      ],
    },
    input,
  ),
)
assert.equal(normalizedOutput.preferences.length, 1)
assert.equal(normalizedOutput.preferences[0]?.scope, input.scope)
assert.equal(normalizedOutput.preferences[0]?.supportCount, 1)
assert.equal(normalizedOutput.preferences[0]?.confidence, 0.45)
assert.deepEqual(normalizedOutput.preferences[0]?.evidenceIds, [
  expectedOutput.preferences[1].evidenceIds[0],
])
assert.equal(
  normalizedOutput.evidenceCount,
  input.libraryEvidence.notes.length +
    input.libraryEvidence.snippets.length +
    input.feedbackEvidence.length,
)

const evidenceTypes = new Map<string, string>()
for (const note of input.libraryEvidence.notes) evidenceTypes.set(note.id, 'library_pattern')
for (const snippet of input.libraryEvidence.snippets) evidenceTypes.set(snippet.id, 'snippet_reason')
for (const feedback of input.feedbackEvidence) evidenceTypes.set(feedback.id, feedback.type)

assert.equal(expectedOutput.evidenceCount, evidenceTypes.size)
for (const preference of expectedOutput.preferences) {
  assert.equal(preference.scope, 'account')
  assert.equal(preference.supportCount, new Set(preference.evidenceIds).size)
  assert.ok(preference.evidenceIds.every((id) => evidenceTypes.has(id)))

  if (preference.supportCount === 1) {
    const onlyEvidenceType = evidenceTypes.get(preference.evidenceIds[0])
    if (onlyEvidenceType === 'profile_correction') {
      assert.ok(preference.confidence <= 0.85)
    } else {
      assert.ok(preference.confidence <= 0.45)
    }
  }
}

const serializedProfile = JSON.stringify(expectedOutput)
assert.ok(!serializedProfile.includes('深圳南山'))
assert.ok(expectedOutput.openQuestions.length > 0)

const originalEvidenceIds = collectWritingEvidenceIds(input)
const changedEvidenceIds = collectWritingEvidenceIds({
  ...input,
  libraryEvidence: {
    ...input.libraryEvidence,
    snippets: input.libraryEvidence.snippets.map((snippet, index) =>
      index === 0
        ? { ...snippet, reasonText: `${snippet.reasonText} 补充了一条新理由。` }
        : snippet,
    ),
  },
})
assert.deepEqual(
  originalEvidenceIds.filter((id) => !id.startsWith('__content_fingerprint__:')),
  changedEvidenceIds.filter((id) => !id.startsWith('__content_fingerprint__:')),
)
assert.notEqual(originalEvidenceIds.at(-1), changedEvidenceIds.at(-1))

const api = createApiApp()
const disabledResponse = await api.request(
  '/v1/ai/writing-profile',
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

console.log('writer-model-v1 offline evaluation passed')
console.log(`skill: ${prepared.metadata.id}@${prepared.metadata.version}`)
console.log(`prompt hash: ${prepared.metadata.promptHash}`)
console.log(`grounded preferences: ${expectedOutput.preferences.length}`)
console.log('scope isolation: account profile excludes project-only route requirement')
console.log('AI feature gate: closed')
console.log('paid model calls: 0')
