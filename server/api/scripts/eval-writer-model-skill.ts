import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildWritingProfileRequestSchema,
  manageWritingPreferenceRequestSchema,
  writingProfileSchema,
} from '@lumos-ai/shared'
import { createApiApp } from '../src/app.js'
import { prepareAiSkill } from '../src/skills/runtime.js'
import {
  compactWriterModelInput,
  normalizeWriterModelOutput,
  writerModelSkillV1,
} from '../src/skills/writer-model-v1/index.js'
import {
  compactActiveWritingProfile,
  getAppliedWritingProfileContext,
} from '../src/skills/shared/writing-profile.js'
import {
  applyWritingPreferenceAction,
  canReuseWritingProfileRevision,
  collectWritingEvidenceIds,
  parseStoredWritingProfile,
  WritingPreferenceTransitionError,
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
assert.equal(prepared.metadata.version, '1.4.4')
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
assert.ok(prepared.systemPrompt.includes('同一篇 note 本身及其全部 snippets 只算一个素材来源'))
assert.ok(prepared.systemPrompt.includes('至少两篇不同 note'))
assert.ok(prepared.systemPrompt.includes('纯素材证据无法可靠建立内容模式时使用 unclassified'))
assert.ok(prepared.systemPrompt.includes('用第一天、第三天、现在推进'))
assert.ok(prepared.systemPrompt.includes('不得因为拆分导致原本跨独立来源的共性'))
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
const weakSecondProjectFeedback = {
  ...manualFeedback,
  id: 'feedback-weak-second-project',
  projectId: '22222222-2222-4222-8222-222222222222',
  type: 'rewrite_preference' as const,
  createdAt: '2026-06-10T08:05:00.000Z',
}
const weakCrossProjectAccountProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...repeatedPreferenceOutput,
      preferences: repeatedPreferenceOutput.preferences.map((preference) => ({
        ...preference,
        evidenceIds: [
          ...preference.evidenceIds,
          weakSecondProjectFeedback.id,
        ],
      })),
    },
    buildWritingProfileRequestSchema.parse({
      scope: 'account',
      previousProfile: null,
      libraryEvidence: { notes: [], snippets: [] },
      feedbackEvidence: [
        ...repeatedSameProjectFeedback,
        weakSecondProjectFeedback,
      ],
    }),
  ),
)
assert.equal(weakCrossProjectAccountProfile.preferences[0]?.status, 'candidate')
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

const secondProjectFeedback = {
  ...manualFeedback,
  id: 'feedback-manual-concrete-edit-second-project',
  projectId: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-06-10T08:10:00.000Z',
}
const crossProjectAccountProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...expectedOutput,
      preferences: [
        {
          ...expectedOutput.preferences[0],
          confidence: 0.7,
          evidenceIds: [manualFeedback.id, secondProjectFeedback.id],
        },
      ],
    },
    buildWritingProfileRequestSchema.parse({
      scope: 'account',
      previousProfile: null,
      libraryEvidence: { notes: [], snippets: [] },
      feedbackEvidence: [manualFeedback, secondProjectFeedback],
    }),
  ),
)
assert.equal(crossProjectAccountProfile.preferences[0]?.status, 'active')
assert.deepEqual(crossProjectAccountProfile.preferences[0]?.contentModes, ['brand_story'])

const sameNoteLibraryInput = buildWritingProfileRequestSchema.parse({
  scope: 'account',
  previousProfile: null,
  libraryEvidence: {
    notes: [input.libraryEvidence.notes[0]],
    snippets: input.libraryEvidence.snippets.filter(
      (snippet) => snippet.noteId === input.libraryEvidence.notes[0]?.id,
    ),
  },
  feedbackEvidence: [],
})
const sameNoteLibraryProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...expectedOutput,
      preferences: [
        {
          ...expectedOutput.preferences[0],
          confidence: 0.99,
          evidenceIds: sameNoteLibraryInput.libraryEvidence.snippets.map(
            (snippet) => snippet.id,
          ),
        },
      ],
    },
    sameNoteLibraryInput,
  ),
)
assert.equal(sameNoteLibraryProfile.preferences[0]?.status, 'candidate')
assert.equal(sameNoteLibraryProfile.preferences[0]?.confidence, 0.45)
assert.deepEqual(sameNoteLibraryProfile.preferences[0]?.contentModes, ['unclassified'])

const unlinkedSnippetLibraryInput = buildWritingProfileRequestSchema.parse({
  scope: 'account',
  previousProfile: null,
  libraryEvidence: {
    notes: [input.libraryEvidence.notes[0]],
    snippets: [
      input.libraryEvidence.snippets[0],
      {
        ...input.libraryEvidence.snippets[2],
        id: 'legacy-unlinked-snippet',
        noteId: undefined,
      },
    ],
  },
  feedbackEvidence: [],
})
const unlinkedSnippetLibraryProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...expectedOutput,
      preferences: [
        {
          ...expectedOutput.preferences[0],
          confidence: 0.7,
          evidenceIds: ['snippet-concrete-change', 'legacy-unlinked-snippet'],
        },
      ],
    },
    unlinkedSnippetLibraryInput,
  ),
)
assert.equal(unlinkedSnippetLibraryProfile.preferences[0]?.status, 'candidate')

const distinctNoteLibraryInput = buildWritingProfileRequestSchema.parse({
  scope: 'account',
  previousProfile: null,
  libraryEvidence: input.libraryEvidence,
  feedbackEvidence: [],
})
const distinctNoteLibraryOutput = {
  ...expectedOutput,
  preferences: [
    {
      ...expectedOutput.preferences[0],
      confidence: 0.7,
      evidenceIds: ['snippet-concrete-change', 'snippet-use-sequence'],
    },
  ],
}
const distinctNoteLibraryProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(distinctNoteLibraryOutput, distinctNoteLibraryInput),
)
assert.equal(distinctNoteLibraryProfile.preferences[0]?.status, 'active')
assert.equal(distinctNoteLibraryProfile.preferences[0]?.confidence, 0.7)
assert.deepEqual(distinctNoteLibraryProfile.preferences[0]?.contentModes, ['unclassified'])

const distinctNoteLibraryRevision = {
  id: '12121212-1212-4212-8212-121212121212',
  scope: 'account' as const,
  projectId: null,
  version: 1,
  profile: distinctNoteLibraryProfile,
  evidenceIds: distinctNoteLibraryProfile.preferences[0]?.evidenceIds ?? [],
  skill: prepared.metadata,
  createdAt: '2026-06-20T08:00:00.000Z',
}
assert.equal(
  compactActiveWritingProfile(distinctNoteLibraryRevision, 'brand_story'),
  null,
)
assert.equal(
  compactActiveWritingProfile(distinctNoteLibraryRevision, 'unclassified')
    ?.preferences.length,
  1,
)

const contradictedLibraryProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...distinctNoteLibraryOutput,
      preferences: distinctNoteLibraryOutput.preferences.map((preference) => ({
        ...preference,
        contradictions: ['另一篇素材使用了相反的推进方式。'],
      })),
    },
    distinctNoteLibraryInput,
  ),
)
assert.equal(contradictedLibraryProfile.preferences[0]?.status, 'candidate')
assert.equal(
  compactActiveWritingProfile(
    {
      ...distinctNoteLibraryRevision,
      profile: contradictedLibraryProfile,
    },
    'unclassified',
  ),
  null,
)

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
const appliedBrandStoryProfile = getAppliedWritingProfileContext(
  { accountProfile: enabledRevision, projectProfile: null },
  'brand_story',
)
assert.equal(appliedBrandStoryProfile.account?.revisionId, enabledRevision.id)
assert.equal(appliedBrandStoryProfile.account?.version, enabledRevision.version)
assert.deepEqual(
  appliedBrandStoryProfile.account?.preferences.map((preference) => preference.statement),
  compactActiveWritingProfile(enabledRevision, 'brand_story')?.preferences.map(
    (preference) => preference.statement,
  ),
)
assert.equal(appliedBrandStoryProfile.project, null)

const deleteInput = buildWritingProfileRequestSchema.parse({
  ...disableInput,
  previousProfile: disabledProfile,
  feedbackEvidence: [
    {
      ...disableFeedback,
      id: 'feedback-delete-preference',
      context: {
        ...disableFeedback.context,
        preferenceAction: {
          ...disableFeedback.context.preferenceAction,
          action: 'delete',
          snapshot: disabledPreference,
        },
        learningEvidence: {
          ...disableFeedback.context.learningEvidence,
          status: 'rejected',
        },
      },
      createdAt: '2026-06-22T08:00:00.000Z',
    },
  ],
})
const rejectedProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput({ ...expectedOutput, preferences: [] }, deleteInput),
)
const rejectedPreference = rejectedProfile.preferences.find(
  (preference) => preference.id === activePreference.id,
)
assert.ok(rejectedPreference)
assert.equal(rejectedPreference.status, 'rejected')

const restoreInput = buildWritingProfileRequestSchema.parse({
  ...deleteInput,
  previousProfile: rejectedProfile,
  feedbackEvidence: [
    {
      ...disableFeedback,
      id: 'feedback-restore-preference',
      context: {
        ...disableFeedback.context,
        preferenceAction: {
          ...disableFeedback.context.preferenceAction,
          action: 'enable',
          snapshot: rejectedPreference,
        },
        learningEvidence: {
          ...disableFeedback.context.learningEvidence,
          status: 'active',
        },
      },
      createdAt: '2026-06-23T08:00:00.000Z',
    },
  ],
})
const restoredProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput(
    {
      ...expectedOutput,
      preferences: [
        {
          ...activePreference,
          id: 'duplicate-restored-preference',
          evidenceIds: ['feedback-restore-preference'],
        },
      ],
    },
    restoreInput,
  ),
)
const restoredPreference = restoredProfile.preferences.find(
  (preference) => preference.id === activePreference.id,
)
assert.ok(restoredPreference)
assert.equal(restoredPreference.status, 'active')
assert.equal(restoredProfile.preferences.length, expectedOutput.preferences.length)

const correctedStatement = '结尾写到具体感受就停，不额外拔高主题。'
const correctInput = buildWritingProfileRequestSchema.parse({
  ...enableInput,
  previousProfile: enabledProfile,
  feedbackEvidence: [
    {
      ...disableFeedback,
      id: 'feedback-correct-preference',
      content: correctedStatement,
      context: {
        ...disableFeedback.context,
        preferenceAction: {
          ...disableFeedback.context.preferenceAction,
          action: 'correct',
          snapshot: enabledPreference,
        },
        learningEvidence: {
          ...disableFeedback.context.learningEvidence,
          afterText: correctedStatement,
          status: 'active',
        },
      },
      createdAt: '2026-06-24T08:00:00.000Z',
    },
  ],
})
const correctedProfile = writingProfileSchema.parse(
  normalizeWriterModelOutput({ ...expectedOutput, preferences: [] }, correctInput),
)
const correctedPreference = correctedProfile.preferences.find(
  (preference) => preference.id === activePreference.id,
)
assert.ok(correctedPreference)
assert.equal(correctedPreference.status, 'active')
assert.equal(correctedPreference.statement, correctedStatement)
assert.ok(correctedPreference.evidenceIds.includes('feedback-correct-preference'))

const staleCorrectInput = buildWritingProfileRequestSchema.parse({
  ...correctInput,
  previousRevisionEvidenceIds: [],
})
const profileAfterStaleCorrection = writingProfileSchema.parse(
  normalizeWriterModelOutput({ ...expectedOutput, preferences: [] }, staleCorrectInput),
)
assert.equal(
  profileAfterStaleCorrection.preferences.find(
    (preference) => preference.id === activePreference.id,
  )?.statement,
  enabledPreference.statement,
)
assert.ok(
  !compactWriterModelInput(staleCorrectInput).feedbackEvidence.some(
    (feedback) => feedback.id === 'feedback-correct-preference',
  ),
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

const activeControlPreference = expectedOutput.preferences.find(
  (preference) => preference.status === 'active',
)
const candidateControlPreference = expectedOutput.preferences.find(
  (preference) => preference.status === 'candidate',
)
assert.ok(activeControlPreference)
assert.ok(candidateControlPreference)

const disabledControlProfile = applyWritingPreferenceAction(expectedOutput, {
  preferenceId: activeControlPreference.id,
  action: 'disable',
  content: activeControlPreference.statement,
  feedbackMemoryId: '55555555-5555-4555-8555-555555555555',
})
assert.equal(disabledControlProfile.evidenceCount, expectedOutput.evidenceCount + 1)
assert.equal(
  disabledControlProfile.preferences.find(
    (preference) => preference.id === activeControlPreference.id,
  )?.status,
  'disabled',
)
assert.throws(
  () =>
    applyWritingPreferenceAction(expectedOutput, {
      preferenceId: activeControlPreference.id,
      action: 'delete',
      content: activeControlPreference.statement,
      feedbackMemoryId: '66666666-6666-4666-8666-666666666666',
    }),
  WritingPreferenceTransitionError,
)

const removedControlProfile = applyWritingPreferenceAction(disabledControlProfile, {
  preferenceId: activeControlPreference.id,
  action: 'delete',
  content: activeControlPreference.statement,
  feedbackMemoryId: '77777777-7777-4777-8777-777777777777',
})
assert.equal(
  removedControlProfile.preferences.find(
    (preference) => preference.id === activeControlPreference.id,
  )?.status,
  'rejected',
)

const restoredControlProfile = applyWritingPreferenceAction(removedControlProfile, {
  preferenceId: activeControlPreference.id,
  action: 'enable',
  content: activeControlPreference.statement,
  feedbackMemoryId: '88888888-8888-4888-8888-888888888888',
})
const restoredControlPreference = restoredControlProfile.preferences.find(
  (preference) => preference.id === activeControlPreference.id,
)
assert.equal(restoredControlPreference?.status, 'active')
assert.ok(restoredControlPreference?.evidenceIds.includes('88888888-8888-4888-8888-888888888888'))

const correctedControlStatement = '结尾写到具体感受就停，不额外总结或升华。'
const correctedControlProfile = applyWritingPreferenceAction(expectedOutput, {
  preferenceId: candidateControlPreference.id,
  action: 'correct',
  content: correctedControlStatement,
  feedbackMemoryId: '99999999-9999-4999-8999-999999999999',
})
const correctedControlPreference = correctedControlProfile.preferences.find(
  (preference) => preference.id === candidateControlPreference.id,
)
assert.equal(correctedControlPreference?.id, candidateControlPreference.id)
assert.equal(correctedControlPreference?.statement, correctedControlStatement)
assert.equal(correctedControlPreference?.status, 'active')
assert.ok(correctedControlPreference?.confidence >= 0.85)

const validControlRequest = manageWritingPreferenceRequestSchema.parse({
  scope: 'account',
  preferenceId: candidateControlPreference.id,
  action: 'enable',
  feedbackMemoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  expectedRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  expectedVersion: 3,
})
assert.equal(validControlRequest.scope, 'account')
assert.equal(
  manageWritingPreferenceRequestSchema.safeParse({
    ...validControlRequest,
    projectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  }).success,
  false,
)

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

const controlResponse = await api.request(
  '/v1/writing-profile/preferences',
  {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validControlRequest),
  },
  {
    APP_ENV: 'local',
    AI_FEATURE_ENABLED: 'false',
  },
)
const controlBody = (await controlResponse.json()) as {
  error: { code: string }
}
assert.equal(controlResponse.status, 503)
assert.equal(controlBody.error.code, 'service_not_configured')

console.log('writer-model-v1 offline evaluation passed')
console.log(`skill: ${prepared.metadata.id}@${prepared.metadata.version}`)
console.log(`prompt hash: ${prepared.metadata.promptHash}`)
console.log(`grounded preferences: ${expectedOutput.preferences.length}`)
console.log('scope isolation: account profile excludes project-only route requirement')
console.log('preference controls: deterministic route bypasses the AI feature gate')
console.log('AI feature gate: closed')
console.log('paid model calls: 0')
