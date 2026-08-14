import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildWritingProfileRequestSchema,
  generateDraftRequestSchema,
  type AiDraftCopy,
  type AiUsage,
  type WritingProfileRevisionDto,
} from '@lumos-ai/shared'
import { config as loadEnv } from 'dotenv'
import {
  DeepSeekOutputValidationError,
  generateDraftWithDeepSeek,
  learnWritingProfileWithDeepSeek,
} from '../src/ai/deepseek.js'
import { readConfig } from '../src/env.js'

const repoEnvPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.env',
)
loadEnv({ path: process.env.FORWARD_EVAL_ENV || repoEnvPath })
const reportPath = process.env.FORWARD_EVAL_REPORT ||
  path.resolve('/tmp/lumos-writing-profile-forward-v132.json')

if (!process.argv.includes('--confirm-paid')) {
  throw new Error(
    'Writing-profile forward evaluation uses paid AI calls. Re-run with --confirm-paid.',
  )
}

const writerInput = buildWritingProfileRequestSchema.parse({
  scope: 'account',
  previousProfile: null,
  libraryEvidence: {
    notes: [
      {
        id: 'note-riding-review',
        title: '骑车通勤一周后的真实记录',
        contentText:
          '第一天担心迟到，第三天开始记住需要提前减速的路口。最难的不是体力，而是路线判断。',
      },
      {
        id: 'note-camera-review',
        title: '相机用了一个月，我留下的是这三个习惯',
        contentText:
          '没有先列参数，而是从第一次带出门、第三次拍夜景和现在的使用变化展开。',
      },
    ],
    snippets: [
      {
        id: 'snippet-concrete-change',
        noteId: 'note-riding-review',
        selectedText: '第三天开始记住需要提前减速的路口。',
        reasonText: '用时间和动作证明变化，不空泛地说越来越熟练。',
        colorTagName: '具体变化',
      },
      {
        id: 'snippet-counter-intuition',
        noteId: 'note-riding-review',
        selectedText: '最难的不是体力，而是路线判断。',
        reasonText: '先推翻常见担心，再给出更具体的问题，像真人复盘。',
        colorTagName: '反常识判断',
      },
      {
        id: 'snippet-use-sequence',
        noteId: 'note-camera-review',
        selectedText: '第一次带出门、第三次拍夜景和现在的使用变化。',
        reasonText: '喜欢按实际使用顺序讲，不先堆参数和结论。',
        colorTagName: '使用顺序',
      },
    ],
  },
  feedbackEvidence: [
    {
      id: 'feedback-manual-concrete-edit',
      projectId: '11111111-1111-4111-8111-111111111111',
      type: 'manual_edit',
      content: '第三天，我已经知道在哪个路口提前减速。',
      context: {
        beforeText: '后来我逐渐熟悉了骑行通勤。',
        afterText: '第三天，我已经知道在哪个路口提前减速。',
        learningEvidence: {
          category: 'pattern_preference',
          scope: 'draft',
          contentMode: 'brand_story',
          beforeText: '后来我逐渐熟悉了骑行通勤。',
          afterText: '第三天，我已经知道在哪个路口提前减速。',
          confidence: 0.35,
          evidenceCount: 1,
          status: 'candidate',
        },
      },
      source: 'manual_editor',
      createdAt: '2026-06-01T08:10:00.000Z',
    },
    {
      id: 'feedback-final-camera',
      projectId: '22222222-2222-4222-8222-222222222222',
      type: 'final_choice',
      content:
        '第一次带出门时我只拍了白天。第三次拍夜景后，才知道自己真正需要调的是哪一项。',
      context: {
        learningEvidence: {
          category: 'pattern_preference',
          scope: 'draft',
          contentMode: 'brand_story',
          beforeText: '',
          afterText:
            '第一次带出门时我只拍了白天。第三次拍夜景后，才知道自己真正需要调的是哪一项。',
          confidence: 0.35,
          evidenceCount: 1,
          status: 'candidate',
        },
      },
      source: 'explicit_user_action',
      createdAt: '2026-06-10T08:00:00.000Z',
    },
    {
      id: 'feedback-explicit-no-elevation',
      projectId: null,
      type: 'profile_correction',
      content: '我不喜欢最后突然总结上价值，写到具体感受结束就好。',
      context: {
        scope: 'account',
        learningEvidence: {
          category: 'long_term_habit',
          scope: 'account',
          contentMode: 'unclassified',
          beforeText: '',
          afterText: '我不喜欢最后突然总结上价值，写到具体感受结束就好。',
          confidence: 0.95,
          evidenceCount: 1,
          status: 'active',
        },
      },
      source: 'explicit_profile_correction',
      createdAt: '2026-06-12T08:00:00.000Z',
    },
  ],
})

const neutralAnalysis = {
  projectName: '相机使用复盘',
  aiLearningMethod: {
    writingPath: '围绕真实使用过程组织信息，不预设固定表达风格。',
    reusableMechanisms: ['按事实之间的先后关系组织正文'],
    styleConstraints: ['不补充输入中没有的参数、功能或拍摄结果'],
  },
  contentMode: {
    targetMode: 'brand_story' as const,
    confidence: 'high' as const,
    rationale: '任务是围绕个人使用变化形成一篇体验叙事。',
    referenceModes: [],
    compatibleReferenceIds: [],
    excludedReferences: [],
    stableVoiceSignals: [],
    modeSpecificGuidance: {
      informationPriority: '优先说明每次使用中真实发生的变化。',
      interactionPattern: '没有必要时不强加互动。',
      styleBoundary: '不得补充未提供的设备参数和拍摄效果。',
    },
  },
  surfaceStyle: {
    sentenceRhythm: '句长自然变化，以完整表达事实为准。',
    paragraphShape: '按信息推进组织完整段落。',
    punctuation: '使用自然中文标点。',
    emotionalIntensity: '情绪强度服从当前事实。',
    interactionStyle: '仅在当前情境支持时互动。',
  },
  coreJudgement: '把三次使用中已经确认的变化讲清楚。',
  evidence: '本轮只提供任务事实，不在分析层预置用户表达偏好。',
  effectivePatterns: ['说明第一次使用', '说明第三次使用', '说明现在的判断'],
  featuredSnippets: [],
  userPreference: '本轮不在参考分析中提供额外表达偏好。',
  reuseSuggestion: '只复用事实关系，不模仿任何具体句子。',
  avoidPitfall: '不要编造型号、参数、地点、人物或拍摄结果。',
  preferenceQuestion: '需要更多用户反馈后再判断表达习惯。',
  writingMove: '让每段承担一个明确事实。',
  summary: '围绕三次相机使用经历完成一篇事实清楚的复盘。',
  wording: ['使用准确、可核验的日常词语'],
  structure: ['事实推进'],
  preference: ['暂无分析层偏好'],
  readerView: ['读者能理解使用判断如何形成'],
  nextStep: ['根据简报生成初稿'],
}

const draftInput = generateDraftRequestSchema.parse({
  projectName: '相机使用复盘',
  topic: '相机带出门三次后，我才知道自己真正需要调什么',
  targetAudience: '想开始用相机记录生活，但容易被参数吓退的新手',
  length: 'short',
  analysis: neutralAnalysis,
  notes: [],
  snippets: [],
  brief: {
    objective: '分享三次真实使用后形成的判断，帮助新手降低开始记录的压力。',
    mustInclude:
      '第一次只在白天使用自动模式；第三次拍夜景时才发现自己最常调整的是曝光补偿；现在出门前只会确认电池是否有电。',
    sourceFacts:
      '第一次带相机出门是在白天，只使用自动模式。第三次带相机拍夜景时，使用者发现自己最常调整的是曝光补偿。现在出门前只确认电池是否有电。使用者还没有学会所有设置。',
    instructions: '以第一人称写真实使用体验。',
    avoidTone:
      '不得补充相机品牌、型号、参数数值、拍摄地点或照片效果；不要写成产品测评、摄影教程或购买建议。',
    contentMode: 'brand_story',
    facts: [
      {
        id: 'first-use',
        statement: '第一次带相机出门是在白天，只使用自动模式。',
        required: true,
      },
      {
        id: 'third-use',
        statement:
          '第三次带相机拍夜景时，使用者发现自己最常调整的是曝光补偿。',
        required: true,
      },
      {
        id: 'current-check',
        statement: '现在出门前只确认电池是否有电。',
        required: true,
      },
      {
        id: 'learning-boundary',
        statement: '使用者还没有学会所有设置。',
        required: true,
      },
    ],
  },
})

const temporalPatterns = [/第一次/, /第三次/, /现在/]
const actionTerms = ['带出门', '拍夜景', '调整', '确认', '有电', '使用自动模式']
const vaguePatterns = [/逐渐/g, /越来越/g, /慢慢变得/g, /更好的自己/g, /热爱生活/g]
const elevatedEndingPatterns = [
  /改变生活/g,
  /生活的意义/g,
  /成为更好的自己/g,
  /热爱生活/g,
  /人生/g,
  /真正的自由/g,
]
const unsupportedMindsetPatterns = [
  /没想过别的/g,
  /也不着急/g,
  /已经够用了/g,
  /终于放心/g,
]

function countPatternHits(text: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (text.match(pattern)?.length ?? 0), 0)
}

function scoreDraft(draft: AiDraftCopy) {
  const text = [draft.title, ...draft.body].join('\n')
  const ending = draft.body.at(-1) ?? ''
  const temporalMarkers = temporalPatterns.filter((pattern) => pattern.test(text)).length
  const observableActions = actionTerms.filter((term) => text.includes(term)).length
  const vagueHits = countPatternHits(text, vaguePatterns)
  const elevatedEndingHits = countPatternHits(ending, elevatedEndingPatterns)
  const unsupportedMindsetHits = countPatternHits(text, unsupportedMindsetPatterns)

  return {
    temporalMarkers,
    observableActions,
    vagueHits,
    elevatedEndingHits,
    unsupportedMindsetHits,
    score:
      Math.min(temporalMarkers, 3) * 2 +
      Math.min(observableActions, 4) +
      (vagueHits === 0 ? 2 : 0) +
      (elevatedEndingHits === 0 ? 2 : 0) +
      (unsupportedMindsetHits === 0 ? 2 : -2),
  }
}

function sumUsage(usages: Array<AiUsage | null>) {
  return usages.reduce(
    (total, usage) => ({
      promptTokens: total.promptTokens + (usage?.promptTokens ?? 0),
      completionTokens: total.completionTokens + (usage?.completionTokens ?? 0),
      totalTokens: total.totalTokens + (usage?.totalTokens ?? 0),
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  )
}

function estimateCostCny(
  usage: ReturnType<typeof sumUsage>,
  inputRate: number | undefined,
  outputRate: number | undefined,
) {
  if (inputRate === undefined || outputRate === undefined) return null
  return (
    (usage.promptTokens / 1_000_000) * inputRate +
    (usage.completionTokens / 1_000_000) * outputRate
  )
}

async function writeReport(value: unknown) {
  await writeFile(reportPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function getFailure(error: unknown) {
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
    usage:
      error instanceof DeepSeekOutputValidationError
        ? error.usage
        : null,
  }
}

function summarizeProfile(learned: Awaited<ReturnType<typeof learnWritingProfileWithDeepSeek>>) {
  return {
    skill: learned.skill,
    summary: learned.profile.summary,
    activePreferences: learned.profile.preferences
      .filter((preference) => preference.status === 'active')
      .map((preference) => ({
        id: preference.id,
        statement: preference.statement,
        application: preference.application,
        contentModes: preference.contentModes,
      })),
    candidatePreferences: learned.profile.preferences
      .filter((preference) => preference.status === 'candidate')
      .map((preference) => ({
        id: preference.id,
        statement: preference.statement,
      })),
  }
}

const config = readConfig({
  APP_ENV: 'local',
  AI_FEATURE_ENABLED: 'true',
  AI_PROVIDER_PRIMARY: 'deepseek',
})
assert.ok(config.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY is required for the paid benchmark.')

const learned = await learnWritingProfileWithDeepSeek(config, writerInput)
await writeReport({
  evaluation: 'writing-profile-forward-ab-v1',
  status: 'profile_learned',
  learnedProfile: summarizeProfile(learned),
  usage: learned.usage,
})
const revision: WritingProfileRevisionDto = {
  id: '33333333-3333-4333-8333-333333333333',
  scope: 'account',
  projectId: null,
  version: 1,
  profile: learned.profile,
  evidenceIds: [
    ...writerInput.libraryEvidence.notes.map((item) => item.id),
    ...writerInput.libraryEvidence.snippets.map((item) => item.id),
    ...writerInput.feedbackEvidence.map((item) => item.id),
  ],
  skill: learned.skill,
  createdAt: new Date().toISOString(),
}

let baseline: Awaited<ReturnType<typeof generateDraftWithDeepSeek>>
try {
  baseline = await generateDraftWithDeepSeek(config, draftInput)
} catch (error) {
  await writeReport({
    evaluation: 'writing-profile-forward-ab-v1',
    status: 'failed',
    failedStage: 'baseline_draft',
    learnedProfile: summarizeProfile(learned),
    failure: getFailure(error),
  })
  throw error
}
await writeReport({
  evaluation: 'writing-profile-forward-ab-v1',
  status: 'baseline_generated',
  learnedProfile: summarizeProfile(learned),
  baseline: {
    draft: baseline.draft,
    score: scoreDraft(baseline.draft),
    quality: baseline.quality,
    usage: baseline.usage,
  },
})

let personalized: Awaited<ReturnType<typeof generateDraftWithDeepSeek>>
try {
  personalized = await generateDraftWithDeepSeek(config, draftInput, {
    accountProfile: revision,
    projectProfile: null,
  })
} catch (error) {
  await writeReport({
    evaluation: 'writing-profile-forward-ab-v1',
    status: 'failed',
    failedStage: 'personalized_draft',
    learnedProfile: summarizeProfile(learned),
    baseline: {
      draft: baseline.draft,
      score: scoreDraft(baseline.draft),
      quality: baseline.quality,
      usage: baseline.usage,
    },
    failure: getFailure(error),
  })
  throw error
}

assert.equal(baseline.appliedWritingProfile.account, null)
assert.ok(personalized.appliedWritingProfile.account)
const activePreferenceIds = new Set(
  learned.profile.preferences
    .filter((preference) => preference.status === 'active')
    .map((preference) => preference.id),
)
const candidatePreferenceIds = new Set(
  learned.profile.preferences
    .filter((preference) => preference.status === 'candidate')
    .map((preference) => preference.id),
)
const appliedPreferenceIds =
  personalized.appliedWritingProfile.account?.preferences.map((preference) => preference.id) ?? []
assert.ok(appliedPreferenceIds.every((id) => activePreferenceIds.has(id)))
assert.ok(appliedPreferenceIds.every((id) => !candidatePreferenceIds.has(id)))

const usage = sumUsage([learned.usage, baseline.usage, personalized.usage])
const estimatedCostCny = estimateCostCny(
  usage,
  config.AI_DEEPSEEK_INPUT_CNY_PER_1M_TOKENS,
  config.AI_DEEPSEEK_OUTPUT_CNY_PER_1M_TOKENS,
)
const baselineScore = scoreDraft(baseline.draft)
const personalizedScore = scoreDraft(personalized.draft)
const activeProgressionPreferenceIds = new Set(
  learned.profile.preferences
    .filter(
      (preference) =>
        preference.status === 'active' &&
        ['progression', 'structure'].includes(preference.dimension),
    )
    .map((preference) => preference.id),
)
const progressionPreferenceApplied = appliedPreferenceIds.some((id) =>
  activeProgressionPreferenceIds.has(id),
)
const linkApplied = appliedPreferenceIds.length > 0 && progressionPreferenceApplied
const safetyPassed =
  personalized.quality.overallStatus === 'passed' &&
  personalizedScore.unsupportedMindsetHits === 0 &&
  appliedPreferenceIds.every((id) => !candidatePreferenceIds.has(id))
const qualityGainObserved = personalizedScore.score > baselineScore.score

const report = {
      evaluation: 'writing-profile-forward-ab-v1',
      status: 'completed',
      limitations: [
        '单次 A/B 只用于发现明显问题，不代表统计显著性。',
        '两组共用相同简报和事实，差异只来自表达档案与模型自然波动。',
      ],
      verdict: {
        linkApplied,
        progressionPreferenceApplied,
        safetyPassed,
        qualityGainObserved,
        summary: !linkApplied
          ? '表达档案没有进入个性化初稿，链路未通过。'
          : !safetyPassed
            ? '表达档案已进入初稿，但存在事实或候选规则泄漏，安全性未通过。'
            : qualityGainObserved
              ? '表达档案已安全应用，并在本组确定性指标上优于基线。'
              : '表达档案已安全应用，但本组未观察到明确质量增益；不能据此宣称文案变好。',
      },
      learnedProfile: summarizeProfile(learned),
      baseline: {
        draft: baseline.draft,
        score: baselineScore,
        quality: baseline.quality,
        appliedPreferenceIds:
          baseline.appliedWritingProfile.account?.preferences.map((item) => item.id) ?? [],
        usage: baseline.usage,
      },
      personalized: {
        draft: personalized.draft,
        score: personalizedScore,
        quality: personalized.quality,
        appliedPreferenceIds,
        usage: personalized.usage,
      },
      usage: {
        ...usage,
        estimatedCostCny,
      },
    }
await writeReport(report)
console.log(JSON.stringify(report, null, 2))
