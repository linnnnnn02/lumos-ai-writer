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
  DEEPSEEK_DRAFT_MODEL,
  DeepSeekOutputValidationError,
  generateDraftWithDeepSeek,
  learnWritingProfileWithDeepSeek,
} from '../src/ai/deepseek.js'
import { readConfig } from '../src/env.js'
import {
  blindJudgeResultSchema,
  buildBlindPair,
  scoreLanguagePreference,
  summarizeBlindResults,
  type BlindJudgeResult,
  type BlindPair,
} from './writing-profile-blind-eval.js'

const repoEnvPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.env',
)
loadEnv({ path: process.env.BLIND_EVAL_ENV || repoEnvPath })

const reportPath = process.env.BLIND_EVAL_REPORT ||
  path.resolve('/tmp/lumos-writing-profile-blind-v133.json')
const reviewPath = process.env.BLIND_EVAL_REVIEW ||
  path.resolve('/tmp/lumos-writing-profile-blind-review-v133.md')
const repeatsArgument = process.argv.find((argument) =>
  argument.startsWith('--repeats='),
)
const repeats = Number(
  repeatsArgument?.slice('--repeats='.length) ||
    process.env.BLIND_EVAL_REPEATS ||
    '2',
)

assert.ok(
  Number.isInteger(repeats) && repeats >= 1 && repeats <= 3,
  'Blind evaluation repeats must be an integer between 1 and 3.',
)
const writerInput = buildWritingProfileRequestSchema.parse({
  scope: 'account',
  previousProfile: null,
  libraryEvidence: {
    notes: [
      {
        id: 'note-laundry-actions',
        title: '洗完衣服以后',
        contentText:
          '洗衣机停了。我把衬衫一件件抖开，挂到最外侧。最后把地上的两个夹子捡回篮子。',
      },
      {
        id: 'note-breakfast-actions',
        title: '出门前的十分钟',
        contentText:
          '面包烤到第二格弹起，鸡蛋切成两半。吃完把盘子冲净，关灯出门。',
      },
    ],
    snippets: [
      {
        id: 'snippet-laundry-concrete',
        noteId: 'note-laundry-actions',
        selectedText: '最后把地上的两个夹子捡回篮子。',
        reasonText:
          '喜欢停在能看见的动作上，不把普通日常总结成治愈、松弛感或生活意义。',
        colorTagName: '具体收尾',
      },
      {
        id: 'snippet-breakfast-concrete',
        noteId: 'note-breakfast-actions',
        selectedText: '吃完把盘子冲净，关灯出门。',
        reasonText:
          '动作本身已经够清楚，不需要再补仪式感、热爱生活之类的抽象评价。',
        colorTagName: '不拔高',
      },
    ],
  },
  feedbackEvidence: [
    {
      id: 'feedback-desk-remove-cliche',
      projectId: '11111111-1111-4111-8111-111111111111',
      type: 'manual_edit',
      content: '关掉台灯前，我把最后一只杯子放回架子。',
      context: {
        beforeText: '收拾完桌面，生活也多了一点治愈感。',
        afterText: '关掉台灯前，我把最后一只杯子放回架子。',
        learningEvidence: {
          category: 'pattern_preference',
          scope: 'draft',
          contentMode: 'brand_story',
          beforeText: '收拾完桌面，生活也多了一点治愈感。',
          afterText: '关掉台灯前，我把最后一只杯子放回架子。',
          confidence: 0.35,
          evidenceCount: 1,
          status: 'candidate',
        },
      },
      source: 'manual_editor',
      createdAt: '2026-07-01T08:00:00.000Z',
    },
    {
      id: 'feedback-plant-remove-cliche',
      projectId: '22222222-2222-4222-8222-222222222222',
      type: 'manual_edit',
      content: '水从盆底流出来，我把托盘擦干。',
      context: {
        beforeText: '浇花是忙碌生活里难得的仪式感。',
        afterText: '水从盆底流出来，我把托盘擦干。',
        learningEvidence: {
          category: 'pattern_preference',
          scope: 'draft',
          contentMode: 'brand_story',
          beforeText: '浇花是忙碌生活里难得的仪式感。',
          afterText: '水从盆底流出来，我把托盘擦干。',
          confidence: 0.35,
          evidenceCount: 1,
          status: 'candidate',
        },
      },
      source: 'manual_editor',
      createdAt: '2026-07-08T08:00:00.000Z',
    },
  ],
})

function createNeutralAnalysis(projectName: string, summary: string) {
  return {
    projectName,
    aiLearningMethod: {
      writingPath: '围绕任务已知事实组织正文，不预设用户的表达风格。',
      reusableMechanisms: ['让每段承担一个清楚的事实'],
      styleConstraints: ['不补充输入中没有的人物、地点、结果或感受'],
    },
    contentMode: {
      targetMode: 'brand_story' as const,
      confidence: 'high' as const,
      rationale: '任务是围绕第一人称日常使用过程形成简短叙事。',
      referenceModes: [],
      compatibleReferenceIds: [],
      excludedReferences: [],
      stableVoiceSignals: [],
      modeSpecificGuidance: {
        informationPriority: '优先写清任务中真实发生的动作和变化。',
        interactionPattern: '没有事实支持时不增加读者互动。',
        styleBoundary: '不得补充任务未提供的心理感受和生活判断。',
      },
    },
    surfaceStyle: {
      sentenceRhythm: '句长自然变化，以完整表达事实为准。',
      paragraphShape: '按信息推进组织完整段落。',
      punctuation: '使用自然中文标点。',
      emotionalIntensity: '情绪强度服从当前事实。',
      interactionStyle: '仅在当前情境支持时互动。',
    },
    coreJudgement: '把任务中确认的日常过程讲清楚。',
    evidence: '本轮只提供任务事实，不在分析层预置用户表达偏好。',
    effectivePatterns: ['说明开始动作', '说明中间变化', '说明最后状态'],
    featuredSnippets: [],
    userPreference: '本轮不在参考分析中提供额外表达偏好。',
    reuseSuggestion: '只复用事实关系，不模仿任何具体句子。',
    avoidPitfall: '不要编造输入中没有的细节或感受。',
    preferenceQuestion: '需要更多用户反馈后再判断表达习惯。',
    writingMove: '让每段承担一个明确事实。',
    summary,
    wording: ['使用准确、可核验的日常词语'],
    structure: ['事实推进'],
    preference: ['暂无分析层偏好'],
    readerView: ['读者能理解事情如何发生'],
    nextStep: ['根据简报生成初稿'],
  }
}

const scenarios = [
  {
    id: 'evening-desk',
    endingTerms: ['笔记本', '抽屉', '杯子', '水池'],
    input: generateDraftRequestSchema.parse({
      projectName: '晚间桌面记录',
      topic: '我每天晚上十点后会做的几件事',
      targetAudience: '想了解普通居家习惯的读者',
      length: 'short',
      analysis: createNeutralAnalysis(
        '晚间桌面记录',
        '根据几个已知动作写一篇晚间桌面记录。',
      ),
      notes: [],
      snippets: [],
      brief: {
        objective: '分享每天结束电脑工作后固定完成的几个动作。',
        mustInclude:
          '晚上十点关掉电脑；把充电线绕好放在桌角；把杯子放进水池；把当天使用的笔记本收进抽屉。',
        sourceFacts:
          '每天晚上十点，使用者关掉电脑。随后把充电线绕好放在桌角，把桌上的杯子放进水池，再把当天使用的笔记本收进抽屉。',
        instructions:
          '使用第一人称，根据给定事实写一篇正文约 80-120 字的简短记录。',
        avoidTone:
          '不得补充职业、房间大小、其他家庭成员、坚持时长或任何未提供的心理感受。',
        contentMode: 'brand_story',
        facts: [
          {
            id: 'desk-close-computer',
            statement: '每天晚上十点关掉电脑。',
            required: true,
          },
          {
            id: 'desk-cable-corner',
            statement: '随后把充电线绕好放在桌角。',
            required: true,
          },
          {
            id: 'desk-mug-sink',
            statement: '随后把桌上的杯子放进水池。',
            required: true,
          },
          {
            id: 'desk-notebook-drawer',
            statement: '最后把当天使用的笔记本收进抽屉。',
            required: true,
          },
        ],
      },
    }),
  },
  {
    id: 'balcony-mint',
    endingTerms: ['新叶', '托盘', '擦干', '盆底'],
    input: generateDraftRequestSchema.parse({
      projectName: '阳台薄荷记录',
      topic: '这盆薄荷从周六到周三的变化',
      targetAudience: '对简单植物养护记录感兴趣的读者',
      length: 'short',
      analysis: createNeutralAnalysis(
        '阳台薄荷记录',
        '根据周六和周三的已知事实写一篇薄荷养护记录。',
      ),
      notes: [],
      snippets: [],
      brief: {
        objective: '记录一次修剪、浇水和随后观察到的新叶。',
        mustInclude:
          '周六剪掉两片发黄的叶子并冲洗剪刀；浇水到盆底出水并擦干托盘；周三看到三片新叶。',
        sourceFacts:
          '周六，使用者剪掉薄荷上两片发黄的叶子，并在水槽冲洗剪刀。随后浇水到盆底出水，并把托盘擦干。周三，使用者看到三片新叶。',
        instructions:
          '使用第一人称，根据给定事实写一篇正文约 80-120 字的简短记录。',
        avoidTone:
          '不得补充花盆颜色、阳台朝向、肥料、气味、生长原因或任何未提供的心理感受。',
        contentMode: 'brand_story',
        facts: [
          {
            id: 'mint-prune',
            statement: '周六剪掉薄荷上两片发黄的叶子。',
            required: true,
          },
          {
            id: 'mint-rinse-scissors',
            statement: '修剪后在水槽冲洗剪刀。',
            required: true,
          },
          {
            id: 'mint-water',
            statement: '浇水到盆底出水，并把托盘擦干。',
            required: true,
          },
          {
            id: 'mint-new-leaves',
            statement: '周三看到三片新叶。',
            required: true,
          },
        ],
      },
    }),
  },
  {
    id: 'commute-bottle',
    endingTerms: ['冲洗', '杯盖', '水槽', '保温杯'],
    input: generateDraftRequestSchema.parse({
      projectName: '保温杯通勤记录',
      topic: '一个保温杯从早上七点四十到下班',
      targetAudience: '想了解普通通勤物品使用过程的读者',
      length: 'short',
      analysis: createNeutralAnalysis(
        '保温杯通勤记录',
        '根据三个时间点写一篇保温杯通勤使用记录。',
      ),
      notes: [],
      snippets: [],
      brief: {
        objective: '分享一个工作日里使用保温杯的真实过程。',
        mustInclude:
          '早上七点四十装入温水；到办公室后把杯子放在显示器右侧；中午十二点二十重新加水；下午六点十分在水槽冲洗杯子和杯盖。',
        sourceFacts:
          '早上七点四十，使用者在保温杯里装入温水。到办公室后把杯子放在显示器右侧。中午十二点二十重新加水。下午六点十分，使用者在水槽冲洗杯子和杯盖。',
        instructions:
          '使用第一人称，根据给定事实写一篇正文约 80-120 字的简短记录。',
        avoidTone:
          '不得补充品牌、容量、价格、办公室地点、饮水量、保温效果或任何未提供的心理感受。',
        contentMode: 'brand_story',
        facts: [
          {
            id: 'bottle-morning',
            statement: '早上七点四十在保温杯里装入温水。',
            required: true,
          },
          {
            id: 'bottle-desk-position',
            statement: '到办公室后把杯子放在显示器右侧。',
            required: true,
          },
          {
            id: 'bottle-noon',
            statement: '中午十二点二十重新加水。',
            required: true,
          },
          {
            id: 'bottle-evening',
            statement: '下午六点十分在水槽冲洗杯子和杯盖。',
            required: true,
          },
        ],
      },
    }),
  },
]

assert.equal(scenarios.length, 3)
assert.ok(scenarios.every((scenario) => scenario.input.notes.length === 0))
assert.ok(scenarios.every((scenario) => scenario.input.snippets.length === 0))
if (process.argv.includes('--preflight')) {
  console.log(
    `Writing-profile blind benchmark historical preflight passed: ${scenarios.length} scenarios, ${repeats} repeat(s), 0 paid calls. Known baseline-rule overlap prevents a new paid run.`,
  )
  process.exit(0)
}
if (!process.argv.includes('--confirm-paid')) {
  throw new Error(
    'Writing-profile blind evaluation uses paid AI calls. Re-run with --confirm-paid.',
  )
}
if (!process.argv.includes('--allow-baseline-overlap')) {
  throw new Error(
    'This historical target overlaps universal Draft Skill rules, so another paid run would be invalid. Add --allow-baseline-overlap only to reproduce the recorded negative control.',
  )
}

type DraftResult = Awaited<ReturnType<typeof generateDraftWithDeepSeek>>
type GeneratedPair = {
  id: string
  scenarioId: string
  repeat: number
  generationOrder: Array<'baseline' | 'personalized'>
  brief: (typeof scenarios)[number]['input']['brief']
  endingTerms: string[]
  baseline: DraftResult
  personalized: DraftResult
  blindPair: BlindPair
  judge: BlindJudgeResult | null
  judgeUsage: AiUsage | null
}

type DeepSeekJudgeResponse = {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  error?: { message?: string }
}

class BlindJudgeValidationError extends Error {
  usage: AiUsage | null

  constructor(error: unknown, usage: AiUsage | null) {
    super(error instanceof Error ? error.message : String(error))
    this.name = 'BlindJudgeValidationError'
    this.usage = usage
  }
}

function toUsage(usage: DeepSeekJudgeResponse['usage']): AiUsage | null {
  if (!usage) return null
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  }
}

type UsageTotal = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

function sumUsage(usages: Array<AiUsage | null>): UsageTotal {
  return usages.reduce<UsageTotal>(
    (total, usage) => ({
      promptTokens: total.promptTokens + (usage?.promptTokens ?? 0),
      completionTokens: total.completionTokens + (usage?.completionTokens ?? 0),
      totalTokens: total.totalTokens + (usage?.totalTokens ?? 0),
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  )
}

function estimateCostCny(
  usage: UsageTotal,
  inputRate: number | undefined,
  outputRate: number | undefined,
) {
  if (inputRate === undefined || outputRate === undefined) return null
  return (
    (usage.promptTokens / 1_000_000) * inputRate +
    (usage.completionTokens / 1_000_000) * outputRate
  )
}

function getFailure(error: unknown) {
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
    usage:
      error instanceof DeepSeekOutputValidationError ||
      error instanceof BlindJudgeValidationError
        ? error.usage
        : null,
  }
}

function summarizeProfile(
  learned: Awaited<ReturnType<typeof learnWritingProfileWithDeepSeek>>,
) {
  return {
    skill: learned.skill,
    summary: learned.profile.summary,
    activePreferences: learned.profile.preferences
      .filter((preference) => preference.status === 'active')
      .map((preference) => ({
        id: preference.id,
        dimension: preference.dimension,
        statement: preference.statement,
        application: preference.application,
        avoid: preference.avoid,
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

function formatDraft(draft: AiDraftCopy) {
  return [`标题：${draft.title}`, ...draft.body].join('\n\n')
}

function buildJudgePrompt(pair: GeneratedPair) {
  return JSON.stringify(
    {
      evaluationRule: {
        targetPreference:
          '普通日常应优先用可观察动作表达，不使用“治愈”“松弛感”“仪式感”“热爱生活”“生活的意义”等抽象生活方式评价，不在结尾突然拔高。',
        priority: [
          '任何文案若补充输入没有的事实或心理感受，不得仅凭文风获胜。',
          '事实都可靠时，优先选择更符合目标偏好且停在具体细节上的文案。',
          '偏好符合度接近时，再比较自然度、准确度和信息组织。',
          '没有可感知差异时必须判 tie，不得强行选择。',
        ],
      },
      sourceFacts: pair.brief.sourceFacts,
      forbiddenAdditions: pair.brief.avoidTone,
      firstDraft: pair.blindPair.firstDraft,
      secondDraft: pair.blindPair.secondDraft,
      outputContract: {
        winner: 'first | second | tie',
        confidence: 'low | medium | high',
        preferenceFit: { first: '0-4 integer', second: '0-4 integer' },
        factualReliability: { first: '0-4 integer', second: '0-4 integer' },
        naturalness: { first: '0-4 integer', second: '0-4 integer' },
        unsupportedClaims: { first: ['quote'], second: ['quote'] },
        reasons: ['1-5 concise observable reasons'],
      },
    },
    null,
    2,
  )
}

async function judgeBlindPair(
  config: ReturnType<typeof readConfig>,
  pair: GeneratedPair,
) {
  if (!config.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is required for blind judging.')
  }

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_DRAFT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            '你是离线文案盲评员。你不知道两份文案来自哪个实验组，也不得猜测来源。严格按用户提供的偏好、事实可靠性和自然度比较；无明显差异时判平局。只返回合法 JSON，不输出解释性前缀。',
        },
        { role: 'user', content: buildJudgePrompt(pair) },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      max_tokens: 1600,
      temperature: 0,
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  })

  const data = (await response.json()) as DeepSeekJudgeResponse
  const usage = toUsage(data.usage)
  if (!response.ok || data.error?.message) {
    throw new BlindJudgeValidationError(
      new Error(
        data.error?.message || `Blind judge failed with HTTP ${response.status}.`,
      ),
      usage,
    )
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new BlindJudgeValidationError(
      new Error('Blind judge returned empty content.'),
      usage,
    )
  }

  try {
    return {
      judge: blindJudgeResultSchema.parse(JSON.parse(content)),
      usage,
    }
  } catch (error) {
    throw new BlindJudgeValidationError(error, usage)
  }
}

function buildBlindReview(pairs: GeneratedPair[]) {
  const sections = pairs.map((pair, index) =>
    [
      `## 对比 ${index + 1}：${pair.scenarioId}`,
      '',
      `任务事实：${pair.brief.sourceFacts}`,
      '',
      '### 文案一',
      '',
      formatDraft(pair.blindPair.firstDraft),
      '',
      '### 文案二',
      '',
      formatDraft(pair.blindPair.secondDraft),
      '',
      '你的选择：文案一 / 文案二 / 无明显差异',
    ].join('\n'),
  )

  return [
    '# 表达档案人工盲评',
    '',
    '请先不要查看 JSON 报告中的 answerKey。只根据以下标准比较：事实可靠；普通日常用具体动作表达；不使用治愈、松弛感、仪式感、热爱生活等抽象评价；没有明显差异时选择“无明显差异”。',
    '',
    ...sections,
    '',
  ].join('\n')
}

async function writeJsonReport(value: unknown) {
  await writeFile(reportPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const config = readConfig({
  APP_ENV: 'local',
  AI_FEATURE_ENABLED: 'true',
  AI_PROVIDER_PRIMARY: 'deepseek',
})
assert.ok(config.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY is required for the paid benchmark.')

const usages: Array<AiUsage | null> = []
const targetDistinctFromUniversalDraftRules = false

function summarizeUsage() {
  const usage = sumUsage(usages)
  return {
    ...usage,
    estimatedCostCny: estimateCostCny(
      usage,
      config.AI_DEEPSEEK_INPUT_CNY_PER_1M_TOKENS,
      config.AI_DEEPSEEK_OUTPUT_CNY_PER_1M_TOKENS,
    ),
  }
}

const generatedPairs: GeneratedPair[] = []
const reportState: Record<string, unknown> = {
  evaluation: 'writing-profile-language-blind-ab-v1',
  status: 'started',
  hypothesis:
    'Adding an evidence-learned concrete-over-cliche preference will increase blind preference without reducing factual safety.',
  design: {
    scenarioCount: scenarios.length,
    repeats,
    plannedPairs: scenarios.length * repeats,
    generationOrder: 'counterbalanced',
    presentationOrder: 'counterbalanced and source-blind',
    primaryMetric: 'blind pairwise win rate',
    guardrails: [
      'all draft quality audits pass',
      'target active preference reaches every personalized draft',
      'candidate preferences never reach a draft',
    ],
    strongerInferenceTarget: 'approximately 47 decisive pairs for a 70% vs 50% effect',
    targetDistinctFromUniversalDraftRules,
    knownBaselineRuleOverlap: [
      '通用规则已要求先写可观察事实和动作，不用抽象名词把内容说满。',
      '通用规则已要求结尾不默认升华，写到最后一个有效信息即可结束。',
    ],
  },
  reportPath,
  reviewPath,
  pairs: generatedPairs,
}
await writeJsonReport(reportState)

let learned: Awaited<ReturnType<typeof learnWritingProfileWithDeepSeek>>
try {
  learned = await learnWritingProfileWithDeepSeek(config, writerInput)
  usages.push(learned.usage)
} catch (error) {
  if (error instanceof DeepSeekOutputValidationError) usages.push(error.usage)
  Object.assign(reportState, {
    status: 'failed',
    failedStage: 'profile_learning',
    failure: getFailure(error),
    usage: summarizeUsage(),
  })
  await writeJsonReport(reportState)
  throw error
}

const targetPreferencePattern =
  /治愈|松弛|仪式感|热爱生活|生活(?:方式|意义)|抽象(?:评价|感受|情绪)|具体动作|可观察动作/
const targetActivePreferenceIds = learned.profile.preferences
  .filter((preference) => {
    const text = [
      preference.statement,
      preference.application,
      preference.avoid,
    ].join('\n')
    return preference.status === 'active' && targetPreferencePattern.test(text)
  })
  .map((preference) => preference.id)

Object.assign(reportState, {
  status: 'profile_learned',
  learnedProfile: summarizeProfile(learned),
  targetActivePreferenceIds,
  usage: summarizeUsage(),
})
await writeJsonReport(reportState)

if (targetActivePreferenceIds.length === 0) {
  Object.assign(reportState, {
    status: 'stopped',
    failedStage: 'target_preference_activation',
    verdict: {
      linkApplied: false,
      summary:
        '素材和跨项目修改没有形成目标 active 规则，已停止后续付费生成，不能测试下游质量。',
    },
  })
  await writeJsonReport(reportState)
  throw new Error('Target language preference did not become active.')
}

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

let pairIndex = 0
for (const scenario of scenarios) {
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const generationOrder: Array<'baseline' | 'personalized'> =
      pairIndex % 2 === 0
        ? ['personalized', 'baseline']
        : ['baseline', 'personalized']
    let baseline: DraftResult | null = null
    let personalized: DraftResult | null = null

    for (const arm of generationOrder) {
      try {
        if (arm === 'baseline') {
          baseline = await generateDraftWithDeepSeek(config, scenario.input)
          usages.push(baseline.usage)
        } else {
          personalized = await generateDraftWithDeepSeek(config, scenario.input, {
            accountProfile: revision,
            projectProfile: null,
          })
          usages.push(personalized.usage)
        }
      } catch (error) {
        if (error instanceof DeepSeekOutputValidationError) usages.push(error.usage)
        Object.assign(reportState, {
          status: 'failed',
          failedStage: `${scenario.id}-repeat-${repeat}-${arm}`,
          failure: getFailure(error),
          usage: summarizeUsage(),
        })
        await writeJsonReport(reportState)
        throw error
      }
    }

    assert.ok(baseline && personalized)
    assert.equal(baseline.appliedWritingProfile.account, null)
    assert.ok(personalized.appliedWritingProfile.account)

    const blindPair = buildBlindPair(
      `${scenario.id}-repeat-${repeat}`,
      pairIndex,
      baseline.draft,
      personalized.draft,
    )
    generatedPairs.push({
      id: blindPair.id,
      scenarioId: scenario.id,
      repeat,
      generationOrder,
      brief: scenario.input.brief,
      endingTerms: scenario.endingTerms,
      baseline,
      personalized,
      blindPair,
      judge: null,
      judgeUsage: null,
    })
    pairIndex += 1

    Object.assign(reportState, {
      status: 'drafts_generating',
      completedDraftPairs: generatedPairs.length,
      usage: summarizeUsage(),
    })
    await writeJsonReport(reportState)
  }
}

await writeFile(reviewPath, buildBlindReview(generatedPairs), 'utf8')
Object.assign(reportState, {
  status: 'drafts_generated',
  completedDraftPairs: generatedPairs.length,
})
await writeJsonReport(reportState)

for (const pair of generatedPairs) {
  try {
    const judged = await judgeBlindPair(config, pair)
    pair.judge = judged.judge
    pair.judgeUsage = judged.usage
    usages.push(judged.usage)
  } catch (error) {
    if (error instanceof BlindJudgeValidationError) usages.push(error.usage)
    Object.assign(reportState, {
      status: 'failed',
      failedStage: `${pair.id}-blind-judge`,
      failure: getFailure(error),
      usage: summarizeUsage(),
    })
    await writeJsonReport(reportState)
    throw error
  }

  Object.assign(reportState, {
    status: 'judging',
    completedJudgements: generatedPairs.filter((item) => item.judge).length,
    usage: summarizeUsage(),
  })
  await writeJsonReport(reportState)
}

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
const appliedPreferenceIdsByPair = generatedPairs.map((pair) =>
  pair.personalized.appliedWritingProfile.account?.preferences.map(
    (preference) => preference.id,
  ) ?? [],
)
const linkApplied = appliedPreferenceIdsByPair.every((ids) =>
  ids.some((id) => targetActivePreferenceIds.includes(id)),
)
const candidateLeakage = appliedPreferenceIdsByPair.some((ids) =>
  ids.some((id) => candidatePreferenceIds.has(id) || !activePreferenceIds.has(id)),
)
const allQualityAuditsPassed = generatedPairs.every(
  (pair) =>
    pair.baseline.quality.overallStatus === 'passed' &&
    pair.personalized.quality.overallStatus === 'passed',
)
const safetyPassed = allQualityAuditsPassed && !candidateLeakage

const judgedResults = generatedPairs.map((pair) => ({
  pair: pair.blindPair,
  judge: assertJudge(pair.judge),
}))
const blindSummary = summarizeBlindResults(judgedResults)
const baselineScores = generatedPairs.map((pair) =>
  scoreLanguagePreference(pair.baseline.draft, pair.endingTerms),
)
const personalizedScores = generatedPairs.map((pair) =>
  scoreLanguagePreference(pair.personalized.draft, pair.endingTerms),
)
const scoreSummary = {
  baseline: summarizeScores(baselineScores),
  personalized: summarizeScores(personalizedScores),
}
const qualityDirectionObserved =
  blindSummary.personalizedWins > blindSummary.baselineWins
const statisticallySignificantWithinSample =
  blindSummary.twoSidedSignTestPValue < 0.05
const offlineSignal =
  !targetDistinctFromUniversalDraftRules || !linkApplied || !safetyPassed
    ? 'invalid'
    : blindSummary.personalizedWins < blindSummary.baselineWins
      ? 'regression'
      : qualityDirectionObserved &&
          scoreSummary.personalized.averageScore >= scoreSummary.baseline.averageScore
        ? 'promising'
        : 'inconclusive'

const finalReport = {
  ...reportState,
  status: 'completed',
  limitations: [
    `${generatedPairs.length} 对样本是离线方向性质量门，不代表真实用户偏好或线上统计显著性。`,
    '生成与盲评使用同一模型家族，可能存在模型自身的表达偏置。',
    '双侧符号检验只基于非平局样本，重复生成不能视为完全独立用户样本。',
  ],
  verdict: {
    linkApplied,
    safetyPassed,
    candidateLeakage,
    qualityDirectionObserved,
    statisticallySignificantWithinSample,
    productQualityProven: false,
    offlineSignal,
    summary: !targetDistinctFromUniversalDraftRules
      ? '目标偏好与通用 Draft Skill 规则重复，本轮只能作为负向对照，不能判断个性化质量。'
      : !linkApplied
        ? '目标表达偏好没有稳定进入 B 组，实验链路无效。'
        : !safetyPassed
          ? '表达偏好进入了 B 组，但事实安全或候选隔离失败，不能接受。'
          : offlineSignal === 'regression'
            ? '盲评更偏向基线，表达档案在本轮出现回归信号。'
            : offlineSignal === 'promising'
              ? '盲评方向与确定性指标共同偏向个性化稿，可进入人工盲评，但仍不能宣称产品质量已被证明。'
              : '本轮没有形成一致的质量方向，需要保留结论为不确定。',
  },
  blindSummary,
  scoreSummary,
  appliedPreferenceIdsByPair,
  usage: summarizeUsage(),
}
await writeJsonReport(finalReport)
console.log(JSON.stringify(finalReport, null, 2))

function assertJudge(judge: BlindJudgeResult | null) {
  assert.ok(judge)
  return judge
}

function summarizeScores(
  scores: Array<ReturnType<typeof scoreLanguagePreference>>,
) {
  const totalScore = scores.reduce((total, score) => total + score.score, 0)
  const totalClicheHits = scores.reduce(
    (total, score) => total + score.clicheHits,
    0,
  )
  const concreteEndingCount = scores.filter(
    (score) => score.endsOnConcreteDetail,
  ).length
  return {
    averageScore: scores.length === 0 ? 0 : totalScore / scores.length,
    totalClicheHits,
    clicheFreeRate:
      scores.length === 0
        ? 0
        : scores.filter((score) => score.clicheHits === 0).length / scores.length,
    concreteEndingRate:
      scores.length === 0 ? 0 : concreteEndingCount / scores.length,
    samples: scores,
  }
}
