import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildWritingProfileRequestSchema,
  writingProfileSchema,
} from '@lumos-ai/shared'
import { createApiApp } from '../src/app.js'
import { prepareAiSkill } from '../src/skills/runtime.js'
import {
  compactWriterModelInput,
  normalizeWriterModelOutput,
  writerModelSkillV1,
} from '../src/skills/writer-model-v1/index.js'
import { compactActiveWritingProfile } from '../src/skills/shared/writing-profile.js'
import {
  canReuseWritingProfileRevision,
  collectWritingEvidenceIds,
  parseStoredWritingProfile,
} from '../src/writing-profile.js'

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
    feedbackEvidence: Array<{
      id: string
      type: string
      content: string
      editSignal: null | {
        changedMiddle: { removed: string; added: string }
      }
      learningEvidence: null | {
        category: string
        status: string
      }
    }>
  }
}

assert.equal(prepared.metadata.id, 'user-writing-model')
assert.equal(prepared.metadata.version, '1.4.2')
assert.match(prepared.metadata.promptHash, /^[a-f0-9]{64}$/)
assert.equal(userPayload.task, 'learn_user_writing_model')
assert.equal(userPayload.input.scope, 'account')
assert.ok(userPayload.input.libraryEvidence.notes.every((item) => item.contentText.length <= 1403))
assert.ok(userPayload.input.libraryEvidence.snippets.every((item) => item.selectedText.length <= 603))
assert.ok(userPayload.input.libraryEvidence.snippets.every((item) => item.reasonText.length <= 403))
assert.ok(userPayload.input.feedbackEvidence.every((item) => item.content.length <= 1603))
assert.ok(prepared.systemPrompt.includes('profile_correction > manual_edit'))
assert.ok(prepared.systemPrompt.includes('项目主题、受众和一次性要求只能进入 openQuestions'))
assert.ok(prepared.systemPrompt.includes('不表示它适用于所有内容模式'))
assert.ok(prepared.systemPrompt.includes('至少两种不同内容模式'))
assert.ok(prepared.systemPrompt.includes('不表示模型一定采用了它'))
assert.ok(prepared.systemPrompt.includes('不得因本轮模型漏项而静默遗忘'))
assert.ok(prepared.systemPrompt.includes('不得把重叠结论拆成多条'))
assert.ok(prepared.systemPrompt.includes('必须沿用原 ID'))
assert.doesNotThrow(() => prepared.outputSchema.parse(expectedOutput))
assert.ok(prepared.systemPrompt.includes('dimension 只能是以下值之一'))
assert.ok(prepared.systemPrompt.includes('事实修正、名称替换、错别字'))
assert.ok(prepared.systemPrompt.includes('fact_correction、draft_requirement'))
assert.ok(prepared.systemPrompt.includes('单条非明确证据必须为 candidate'))
const manualEditPayload = userPayload.input.feedbackEvidence.find(
  (item) => item.type === 'manual_edit',
)
assert.equal(manualEditPayload?.editSignal?.changedMiddle.removed, '后来我逐渐熟悉了骑行通勤')
assert.equal(
  manualEditPayload?.editSignal?.changedMiddle.added,
  '第三天，我已经知道在哪个路口提前减速',
)
assert.equal(manualEditPayload?.learningEvidence?.category, 'pattern_preference')
assert.equal(manualEditPayload?.learningEvidence?.status, 'candidate')

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
assert.equal(normalizedOutput.preferences[0]?.status, 'candidate')
assert.deepEqual(normalizedOutput.preferences[0]?.evidenceIds, [
  expectedOutput.preferences[1].evidenceIds[0],
])
assert.equal(
  normalizedOutput.evidenceCount,
  input.libraryEvidence.notes.length +
    input.libraryEvidence.snippets.length +
    input.feedbackEvidence.length,
)

const manualFeedback = input.feedbackEvidence.find((feedback) => feedback.type === 'manual_edit')
assert.ok(manualFeedback)
const singleManualInput = buildWritingProfileRequestSchema.parse({
  scope: 'account',
  previousProfile: null,
  libraryEvidence: { notes: [], snippets: [] },
  feedbackEvidence: [manualFeedback],
})
const singleManualProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...expectedOutput,
      preferences: [
        {
          ...expectedOutput.preferences[0],
          confidence: 0.99,
          evidenceIds: [manualFeedback.id],
        },
      ],
    },
    singleManualInput,
  ),
)
assert.equal(singleManualProfile.preferences.length, 1)
assert.equal(singleManualProfile.preferences[0]?.supportCount, 1)
assert.equal(singleManualProfile.preferences[0]?.confidence, 0.45)
assert.equal(singleManualProfile.preferences[0]?.status, 'candidate')
assert.deepEqual(singleManualProfile.preferences[0]?.contentModes, ['brand_story'])
assert.equal(
  compactActiveWritingProfile(
    {
      id: '33333333-3333-4333-8333-333333333333',
      scope: 'account',
      projectId: null,
      version: 1,
      profile: singleManualProfile,
      evidenceIds: [manualFeedback.id],
      skill: prepared.metadata,
      createdAt: '2026-06-20T08:00:00.000Z',
    },
    'brand_story',
  ),
  null,
)

const repeatedSameProjectFeedback = [
  manualFeedback,
  {
    ...manualFeedback,
    id: 'feedback-manual-concrete-edit-2',
    createdAt: '2026-06-02T08:10:00.000Z',
  },
]
const repeatedPreferenceOutput = {
  ...expectedOutput,
  preferences: [
    {
      ...expectedOutput.preferences[0],
      confidence: 0.7,
      evidenceIds: repeatedSameProjectFeedback.map((feedback) => feedback.id),
    },
  ],
}
const sameProjectAccountProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    repeatedPreferenceOutput,
    buildWritingProfileRequestSchema.parse({
      scope: 'account',
      previousProfile: null,
      libraryEvidence: { notes: [], snippets: [] },
      feedbackEvidence: repeatedSameProjectFeedback,
    }),
  ),
)
assert.equal(sameProjectAccountProfile.preferences[0]?.status, 'candidate')
const sameProjectProjectProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    repeatedPreferenceOutput,
    buildWritingProfileRequestSchema.parse({
      scope: 'project',
      projectId: manualFeedback.projectId ?? undefined,
      previousProfile: null,
      libraryEvidence: { notes: [], snippets: [] },
      feedbackEvidence: repeatedSameProjectFeedback,
    }),
  ),
)
assert.equal(sameProjectProjectProfile.preferences[0]?.status, 'active')
const lowConfidenceRepeatedOutput = {
  ...repeatedPreferenceOutput,
  preferences: repeatedPreferenceOutput.preferences.map((preference) => ({
    ...preference,
    confidence: 0.45,
  })),
}
const lowConfidenceProjectProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    lowConfidenceRepeatedOutput,
    buildWritingProfileRequestSchema.parse({
      scope: 'project',
      projectId: manualFeedback.projectId ?? undefined,
      previousProfile: null,
      libraryEvidence: { notes: [], snippets: [] },
      feedbackEvidence: repeatedSameProjectFeedback,
    }),
  ),
)
assert.equal(lowConfidenceProjectProfile.preferences[0]?.confidence, 0.55)
assert.equal(lowConfidenceProjectProfile.preferences[0]?.status, 'active')

const factCorrectionInput = buildWritingProfileRequestSchema.parse({
  ...singleManualInput,
  feedbackEvidence: [
    {
      ...manualFeedback,
      context: {
        ...manualFeedback.context,
        learningEvidence: {
          ...manualFeedback.context.learningEvidence as Record<string, unknown>,
          category: 'fact_correction',
        },
      },
    },
  ],
})
const factCorrectionProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...expectedOutput,
      preferences: [
        {
          ...expectedOutput.preferences[0],
          evidenceIds: [manualFeedback.id],
        },
      ],
    },
    factCorrectionInput,
  ),
)
assert.equal(factCorrectionProfile.preferences.length, 0)

const activePreference = expectedOutput.preferences[0]
const disableFeedback = {
  id: 'feedback-disable-preference',
  projectId: null,
  type: 'profile_correction' as const,
  content: activePreference.statement,
  context: {
    scope: 'account',
    preferenceAction: {
      action: 'disable',
      preferenceId: activePreference.id,
      snapshot: activePreference,
    },
    learningEvidence: {
      category: 'long_term_habit',
      scope: 'account',
      contentMode: 'unclassified',
      beforeText: activePreference.statement,
      afterText: activePreference.statement,
      confidence: 0.95,
      evidenceCount: 1,
      status: 'disabled',
    },
  },
  source: 'profile_preference_management',
  createdAt: '2026-06-20T08:00:00.000Z',
}
const disableInput = buildWritingProfileRequestSchema.parse({
  scope: 'account',
  previousProfile: expectedOutput,
  libraryEvidence: { notes: [], snippets: [] },
  feedbackEvidence: [disableFeedback],
})
const disabledProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput({ ...expectedOutput, preferences: [] }, disableInput),
)
const disabledPreference = disabledProfile.preferences.find(
  (preference) => preference.id === activePreference.id,
)
assert.ok(disabledPreference)
assert.equal(disabledProfile.preferences.length, expectedOutput.preferences.length)
assert.equal(disabledPreference.status, 'disabled')
assert.deepEqual(
  disabledProfile.preferences
    .filter((preference) => preference.id !== activePreference.id)
    .map((preference) => preference.id),
  expectedOutput.preferences.slice(1).map((preference) => preference.id),
)

const enableInput = buildWritingProfileRequestSchema.parse({
  ...disableInput,
  previousProfile: disabledProfile,
  feedbackEvidence: [
    {
      ...disableFeedback,
      id: 'feedback-enable-preference',
      context: {
        ...disableFeedback.context,
        preferenceAction: {
          ...disableFeedback.context.preferenceAction,
          action: 'enable',
          snapshot: disabledPreference,
        },
        learningEvidence: {
          ...disableFeedback.context.learningEvidence,
          status: 'active',
        },
      },
      createdAt: '2026-06-21T08:00:00.000Z',
    },
  ],
})
const enabledProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...expectedOutput,
      preferences: [
        {
          ...activePreference,
          id: 'duplicate-confirmed-preference',
          evidenceIds: ['feedback-enable-preference'],
        },
      ],
    },
    enableInput,
  ),
)
const enabledPreference = enabledProfile.preferences.find(
  (preference) => preference.id === activePreference.id,
)
assert.ok(enabledPreference)
assert.equal(enabledProfile.preferences.length, expectedOutput.preferences.length)
assert.equal(enabledPreference.status, 'active')
assert.ok(enabledPreference.confidence >= 0.85)
assert.deepEqual(enabledPreference.contentModes, ['brand_story'])
const enabledRevision = {
  id: '44444444-4444-4444-8444-444444444444',
  scope: 'account' as const,
  projectId: null,
  version: 2,
  profile: enabledProfile,
  evidenceIds: ['feedback-enable-preference'],
  skill: prepared.metadata,
  createdAt: '2026-06-21T08:00:00.000Z',
}
assert.equal(
  compactActiveWritingProfile(enabledRevision, 'brand_story')?.preferences.length,
  2,
)
assert.equal(
  compactActiveWritingProfile(enabledRevision, 'product_education')?.preferences.length,
  1,
)

const projectOnlyDisableFeedback = {
  ...disableFeedback,
  id: 'feedback-project-only-disable',
  projectId: manualFeedback.projectId,
  context: {
    ...disableFeedback.context,
    scope: 'project',
    learningEvidence: {
      ...disableFeedback.context.learningEvidence,
      category: 'pattern_preference',
      scope: 'project',
    },
  },
  createdAt: '2026-06-22T08:00:00.000Z',
}
const accountWithProjectControlInput = buildWritingProfileRequestSchema.parse({
  ...input,
  previousProfile: expectedOutput,
  feedbackEvidence: [...input.feedbackEvidence, projectOnlyDisableFeedback],
})
const accountAfterProjectControl = writingProfileSchema.parse(
  normalizeWriterModelOutput(expectedOutput, accountWithProjectControlInput),
)
assert.equal(accountAfterProjectControl.preferences[0]?.status, 'active')
assert.ok(
  !compactWriterModelInput(accountWithProjectControlInput).feedbackEvidence.some(
    (feedback) => feedback.id === projectOnlyDisableFeedback.id,
  ),
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

const legacyProfile = JSON.parse(JSON.stringify(expectedOutput)) as {
  preferences: Array<Record<string, unknown>>
}
for (const preference of legacyProfile.preferences) {
  delete preference.status
  delete preference.contentModes
}
const parsedLegacyProfile = parseStoredWritingProfile(legacyProfile)
assert.equal(parsedLegacyProfile.preferences[0]?.status, 'active')
assert.equal(parsedLegacyProfile.preferences[1]?.status, 'candidate')
assert.deepEqual(parsedLegacyProfile.preferences[1]?.contentModes, [])
const persistedDisabledProfile = parseStoredWritingProfile({
  ...expectedOutput,
  preferences: [
    {
      ...expectedOutput.preferences[1],
      status: 'disabled',
    },
  ],
})
assert.equal(persistedDisabledProfile.preferences[0]?.status, 'disabled')

const currentRevision = {
  id: '11111111-1111-4111-8111-111111111111',
  scope: 'account' as const,
  projectId: null,
  version: 2,
  profile: expectedOutput,
  evidenceIds: originalEvidenceIds,
  skill: prepared.metadata,
  createdAt: '2026-08-04T00:00:00.000Z',
}
assert.equal(
  canReuseWritingProfileRevision(
    currentRevision,
    [...originalEvidenceIds].reverse(),
    prepared.metadata,
  ),
  true,
)
assert.equal(
  canReuseWritingProfileRevision(currentRevision, changedEvidenceIds, prepared.metadata),
  false,
)
assert.equal(
  canReuseWritingProfileRevision(currentRevision, originalEvidenceIds, {
    ...prepared.metadata,
    version: '1.4.1',
  }),
  false,
)
assert.equal(
  canReuseWritingProfileRevision(currentRevision, originalEvidenceIds, {
    ...prepared.metadata,
    promptHash: 'b'.repeat(64),
  }),
  false,
)

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
