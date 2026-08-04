import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  aiDraftCopySchema,
  generateDraftRequestSchema,
  generateDraftResponseSchema,
  type WritingProfileRevisionDto,
  writingProfileSchema,
} from '@lumos-ai/shared'
import { createApiApp } from '../src/app.js'
import {
  DeepSeekOutputValidationError,
  generateDraftWithDeepSeek,
  parseJsonContent,
} from '../src/ai/deepseek.js'
import { readConfig } from '../src/env.js'
import {
  assessDraftFactSufficiency,
  buildDraftGroundingAuditUserPrompt,
  buildDraftRepairUserPrompt,
  compactDraftSkillInput,
  draftGroundingAuditSystemPrompt,
  draftLengthPolicies,
  draftRepairSystemPrompt,
  draftSkillV1,
  findDraftMetaLanguageIssues,
  findReferenceReuseIssues,
  getDraftOutputRequirements,
  getDraftGroundingIssues,
  resolveDraftContentMode,
  validateDraftGroundingAuditOutput,
  validateDraftSkillOutput,
} from '../src/skills/draft-v1/index.js'
import { prepareAiSkill } from '../src/skills/runtime.js'

async function readJsonFixture(name: string) {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  ) as unknown
}

const input = generateDraftRequestSchema.parse(
  await readJsonFixture('draft-v1-input.json'),
)
const expectedOutput = aiDraftCopySchema.parse(
  await readJsonFixture('draft-v1-output.json'),
)
const accountWritingProfile = writingProfileSchema.parse(
  await readJsonFixture('writer-model-v1-output.json'),
)
const accountWritingProfileRevision: WritingProfileRevisionDto = {
  id: '33333333-3333-4333-8333-333333333333',
  scope: 'account',
  projectId: null,
  version: 1,
  profile: accountWritingProfile,
  evidenceIds: [],
  skill: {
    id: 'user-writing-model',
    version: '1.4.2',
    promptHash: 'a'.repeat(64),
  },
  createdAt: '2026-06-12T09:00:00.000Z',
}
const prepared = await prepareAiSkill(draftSkillV1, {
  ...input,
  writingProfileContext: {
    accountProfile: accountWritingProfileRevision,
    projectProfile: null,
  },
})
const userPayload = JSON.parse(prepared.userPrompt) as {
  task: string
  input: {
    length: keyof typeof draftLengthPolicies
    outputRequirements: {
      maxTitleCharacters: number
      minParagraphs: number
      maxParagraphs: number
      minBodyCharacters: number
      maxBodyCharacters: number
      preferredParagraphs: number
      preferredCharactersPerParagraph: {
        min: number
        max: number
      }
      brevityMode: 'standard' | 'sparse_short' | 'ultra_short'
      countingRule: string
    }
    brief: {
      mustInclude: string
      avoidTone: string
      contentMode: string
      facts: Array<{ id: string; statement: string; required: boolean }>
    }
    contentMode: {
      requestedMode: string
      resolvedMode: string
      modeSource: string
      analysisMode: string
      analysisModeMatches: boolean
      usesLegacyFallback: boolean
    }
    writingProfile: {
      account: {
        summary: string
        mustAvoid: string[]
        preferences: Array<{ statement: string }>
      } | null
      project: unknown | null
    }
    referenceUsagePolicy: {
      purpose: string
      verbatimRule: string
      selectionRule: string
    }
    referenceLearning: {
      noteCount: number
      totalNoteCount: number
      labels: string[]
    }
    analysis: {
      userPreference: string
      avoidPitfall: string
      surfaceStyle: {
        sentenceRhythm: string
        paragraphShape: string
        punctuation: string
        emotionalIntensity: string
        interactionStyle: string
      }
    }
    notes?: never
    snippets?: never
  }
}

assert.equal(prepared.metadata.id, 'xiaohongshu-draft')
assert.equal(prepared.metadata.version, '1.9.1')
assert.match(prepared.metadata.promptHash, /^[a-f0-9]{64}$/)
assert.equal(userPayload.task, 'generate_xiaohongshu_draft')
assert.equal(userPayload.input.length, 'medium')
assert.equal(draftLengthPolicies.short.minCharacters, 40)
assert.equal(draftLengthPolicies.short.minParagraphs, 1)
const sparseShortInput = generateDraftRequestSchema.parse({
  ...input,
  length: 'short',
  brief: {
    ...input.brief,
    mustInclude: '只写一个当前问题和一个不预设答案的互动。',
    facts: [
      { id: 'sparse-1', statement: '当前状态未知。' },
      { id: 'sparse-2', statement: '只能用问题表达。' },
    ],
  },
})
assert.equal(
  getDraftOutputRequirements('short', sparseShortInput).minBodyCharacters,
  12,
)
assert.deepEqual(getDraftOutputRequirements('short', sparseShortInput), {
  maxTitleCharacters: 35,
  minParagraphs: 1,
  maxParagraphs: 2,
  minBodyCharacters: 12,
  maxBodyCharacters: 96,
  preferredParagraphs: 1,
  preferredCharactersPerParagraph: { min: 18, max: 48 },
  brevityMode: 'sparse_short',
  countingRule: 'body 数组元素数量按段落计；body 全部字符串去除空白后按 Unicode 字符计数',
})
const denseShortInput = generateDraftRequestSchema.parse({
  ...sparseShortInput,
  brief: {
    ...sparseShortInput.brief,
    facts: [
      ...sparseShortInput.brief.facts,
      { id: 'dense-3', statement: '还必须说明第三条事实。' },
    ],
  },
})
assert.equal(
  getDraftOutputRequirements('short', denseShortInput).minBodyCharacters,
  40,
)
const ultraShortInput = generateDraftRequestSchema.parse({
  ...denseShortInput,
  brief: {
    ...denseShortInput.brief,
    mustInclude: '把四条事实压成一句极短配文，信息说完即停止。',
    facts: [
      ...denseShortInput.brief.facts,
      { id: 'dense-4', statement: '还必须说明第四条事实。' },
    ],
  },
})
assert.deepEqual(getDraftOutputRequirements('short', ultraShortInput), {
  maxTitleCharacters: 35,
  minParagraphs: 1,
  maxParagraphs: 2,
  minBodyCharacters: 12,
  maxBodyCharacters: 72,
  preferredParagraphs: 1,
  preferredCharactersPerParagraph: { min: 24, max: 56 },
  brevityMode: 'ultra_short',
  countingRule: 'body 数组元素数量按段落计；body 全部字符串去除空白后按 Unicode 字符计数',
})
assert.doesNotThrow(() =>
  validateDraftSkillOutput(
    {
      title: '极短配文',
      body: ['四条事实可以压进同一句完整表达。'],
    },
    'short',
    ultraShortInput,
  ),
)
assert.deepEqual(userPayload.input.outputRequirements, {
  maxTitleCharacters: 35,
  minParagraphs: 3,
  maxParagraphs: 6,
  minBodyCharacters: 201,
  maxBodyCharacters: 600,
  preferredParagraphs: 4,
  preferredCharactersPerParagraph: {
    min: 50,
    max: 90,
  },
  brevityMode: 'standard',
  countingRule: 'body 数组元素数量按段落计；body 全部字符串去除空白后按 Unicode 字符计数',
})
assert.equal(userPayload.input.brief.mustInclude, input.brief.mustInclude)
assert.equal(userPayload.input.brief.avoidTone, input.brief.avoidTone)
assert.equal(userPayload.input.brief.contentMode, 'auto')
assert.deepEqual(userPayload.input.brief.facts, [])
assert.equal(userPayload.input.contentMode.analysisMode, 'unclassified')
assert.equal(userPayload.input.contentMode.resolvedMode, 'other')
assert.equal(userPayload.input.contentMode.modeSource, 'legacy_fallback')
assert.equal(userPayload.input.contentMode.analysisModeMatches, true)
assert.equal(userPayload.input.contentMode.usesLegacyFallback, true)

const insufficientProductInput = generateDraftRequestSchema.parse({
  ...input,
  topic: '写一篇护肤产品说明',
  length: 'short',
  brief: {
    mustInclude: '介绍这款产品，但不要补充未提供的功效。',
    avoidTone: '不要夸大效果。',
    objective: '帮助读者理解产品。',
    sourceFacts: '',
    instructions: '',
    allowConservativeDraft: false,
    contentMode: 'product_education',
    facts: [],
  },
})
const insufficientProductAssessment = assessDraftFactSufficiency(
  insufficientProductInput,
)
assert.deepEqual(
  insufficientProductAssessment?.missingFacts.map((fact) => fact.id),
  ['product_identity', 'product_evidence'],
)
assert.equal(insufficientProductAssessment?.canGenerateConservative, false)

const sufficientProductInput = generateDraftRequestSchema.parse({
  ...insufficientProductInput,
  topic: '炎燥季节，时时特安',
  brief: {
    ...insufficientProductInput.brief,
    sourceFacts:
      '产品组合名为特安双子星；组合包含密集面膜和精华液；两件产品配合使用的护理价值高于单用。',
  },
})
assert.equal(assessDraftFactSufficiency(sufficientProductInput), null)
assert.equal(
  assessDraftFactSufficiency({
    ...insufficientProductInput,
    brief: {
      ...insufficientProductInput.brief,
      allowConservativeDraft: true,
    },
  }),
  null,
)

const legacyAtomicFactInput = generateDraftRequestSchema.parse({
  ...input,
  brief: {
    ...input.brief,
    facts: [{ id: 'legacy-fact', statement: '旧请求没有 required 字段。' }],
  },
})
assert.equal(legacyAtomicFactInput.brief.facts[0]?.required, true)
assert.ok(userPayload.input.writingProfile.account?.summary.includes('时间节点和具体动作'))
assert.ok(userPayload.input.writingProfile.account?.summary.includes('结尾突然总结上价值'))
assert.ok(!userPayload.input.writingProfile.account?.summary.includes('像向朋友复盘'))
assert.ok(
  userPayload.input.writingProfile.account?.mustAvoid.includes(
    '不要追加改变生活、成为更好的自己等拔高句。',
  ),
)
assert.equal(userPayload.input.writingProfile.account?.preferences.length, 2)
assert.equal(userPayload.input.writingProfile.project, null)
const productModeDraftInput = compactDraftSkillInput({
  ...input,
  brief: { ...input.brief, contentMode: 'product_education' },
  writingProfileContext: {
    accountProfile: accountWritingProfileRevision,
    projectProfile: null,
  },
})
assert.equal(productModeDraftInput.writingProfile.account?.preferences.length, 1)
assert.ok(
  productModeDraftInput.writingProfile.account?.preferences.every(
    (preference) => preference.statement !== '偏好用时间节点和具体动作证明变化。',
  ),
)
assert.match(userPayload.input.referenceUsagePolicy.verbatimRule, /连续重合 16 个/)
assert.equal(userPayload.input.referenceLearning.noteCount, input.notes.length)
assert.equal(userPayload.input.referenceLearning.totalNoteCount, input.notes.length)
assert.deepEqual(userPayload.input.analysis.surfaceStyle, input.analysis.surfaceStyle)
assert.deepEqual(userPayload.input.referenceLearning.labels, [
  '反常识判断',
  '具体场景',
])
assert.ok(!('notes' in userPayload.input))
assert.ok(!('snippets' in userPayload.input))
assert.ok(prepared.systemPrompt.includes('不得把参考作者的经历写成用户经历'))
assert.ok(prepared.systemPrompt.includes('brief.mustInclude'))
assert.ok(prepared.systemPrompt.includes('medium：必须 3-6 段'))
assert.ok(prepared.systemPrompt.includes('input.outputRequirements 是本次输出的硬约束'))
assert.ok(prepared.systemPrompt.includes('优先写 4 段，每段 50-90 字'))
assert.ok(prepared.systemPrompt.includes('参考是证据，不是句子仓库'))
assert.ok(prepared.systemPrompt.includes('当前目标稿的事实只能来自 topic 和 brief'))
assert.ok(prepared.systemPrompt.includes('referenceLearning 只提供参考证据数量'))
assert.ok(prepared.systemPrompt.includes('analysis.surfaceStyle 只控制句长节奏'))
assert.ok(prepared.systemPrompt.includes('一个 body 字符串内部使用换行符'))
assert.ok(prepared.systemPrompt.includes('brief.facts 是原子事实清单'))
assert.ok(prepared.systemPrompt.includes('contentMode.resolvedMode 是当前成稿的内容任务'))
assert.ok(prepared.systemPrompt.includes('账号自称或读者称呼'))
assert.ok(prepared.systemPrompt.includes('账号级偏好不等于跨内容模式通用'))
assert.ok(prepared.systemPrompt.includes('不得把这些模式平均混合'))
assert.ok(prepared.systemPrompt.includes('成稿不得提及这些制作过程词'))
assert.ok(draftRepairSystemPrompt.includes('brief.facts 中 required=true 的事实必须保留'))
assert.ok(draftRepairSystemPrompt.includes('groundingIssues'))
assert.ok(draftGroundingAuditSystemPrompt.includes('supported、contradicted 或 unknown'))
assert.ok(draftGroundingAuditSystemPrompt.includes('“今晚 3 点”是 contradicted'))
assert.ok(draftGroundingAuditSystemPrompt.includes('面膜先行，精华跟进'))
assert.ok(draftGroundingAuditSystemPrompt.includes('两件产品静待探索'))
assert.ok(draftGroundingAuditSystemPrompt.includes('功效未知'))
assert.ok(prepared.systemPrompt.includes('不表示每条事实都要单独成句'))
assert.ok(prepared.systemPrompt.includes('“配合使用”不自动提供使用顺序'))
assert.ok(prepared.systemPrompt.includes('brevityMode=ultra_short'))
assert.ok(prepared.systemPrompt.includes('brevityMode=sparse_short'))
assert.ok(prepared.systemPrompt.includes('标签可读性'))
assert.ok(draftRepairSystemPrompt.includes('重复一条已确认信息优于创造一条新信息'))
assert.ok(prepared.systemPrompt.includes('连续逐字重合 16 个及以上字符'))
assert.ok(prepared.systemPrompt.includes('不得完整照抄标注中的短分句'))
assert.ok(prepared.systemPrompt.includes('高亮片段换几个近义词'))
assert.ok(draftRepairSystemPrompt.includes('bannedVerbatimPhrases'))
assert.ok(prepared.systemPrompt.includes('严禁为了表现风格而补写 brief 未提供的物象或动作'))
assert.ok(prepared.systemPrompt.includes('不要把短句、口语词和网络语当作真人感的替代品'))

const mismatchedModeInput = generateDraftRequestSchema.parse({
  ...input,
  analysis: {
    ...input.analysis,
    contentMode: {
      targetMode: 'product_education',
      confidence: 'high',
      rationale: '参考主要解释产品使用体验。',
      referenceModes: [
        {
          noteId: input.notes[0]?.id ?? 'missing-note',
          mode: 'product_education',
          compatibility: 'compatible',
          reason: '与产品说明目标相同。',
        },
      ],
      compatibleReferenceIds: [input.notes[0]?.id],
      excludedReferences: [],
      stableVoiceSignals: ['句子短，情绪克制'],
      modeSpecificGuidance: {
        informationPriority: '先问题，再功能和体验。',
        interactionPattern: '围绕使用问题互动。',
        styleBoundary: '不迁移活动流程。',
      },
    },
  },
  brief: {
    ...input.brief,
    contentMode: 'campaign_interaction',
  },
})
const mismatchedMode = resolveDraftContentMode(mismatchedModeInput)
const mismatchedPayload = compactDraftSkillInput(mismatchedModeInput)
assert.equal(mismatchedMode.resolvedMode, 'campaign_interaction')
assert.equal(mismatchedMode.modeSource, 'brief_explicit')
assert.equal(mismatchedMode.analysisModeMatches, false)
assert.deepEqual(mismatchedMode.compatibleReferenceIds, [])
assert.equal(mismatchedMode.referenceSelectionSource, 'resolved_mode_reclassified')
assert.deepEqual(mismatchedMode.stableVoiceSignals, ['句子短，情绪克制'])
assert.equal(mismatchedPayload.referenceLearning.noteCount, 0)
assert.deepEqual(mismatchedPayload.referenceLearning.labels, [])
assert.match(mismatchedPayload.analysis.surfaceStyle.sentenceRhythm, /不迁移其他内容模式/)
assert.match(
  mismatchedPayload.contentMode.modeSpecificGuidance.informationPriority,
  /参与主体、参与动作、奖励/,
)
const inferredCampaignInput = generateDraftRequestSchema.parse({
  ...mismatchedModeInput,
  brief: {
    ...mismatchedModeInput.brief,
    contentMode: 'auto',
    mustInclude:
      '联名竞猜活动；邀请读者参与预测，关注评论后抽取 1 人获得礼包。',
  },
})
const inferredCampaignMode = resolveDraftContentMode(inferredCampaignInput)
assert.equal(inferredCampaignMode.resolvedMode, 'campaign_interaction')
assert.equal(inferredCampaignMode.modeSource, 'brief_inferred')
assert.equal(inferredCampaignMode.analysisModeMatches, false)
const optionalProductBackgroundInput = generateDraftRequestSchema.parse({
  ...mismatchedModeInput,
  analysis: {
    ...mismatchedModeInput.analysis,
    contentMode: {
      ...mismatchedModeInput.analysis.contentMode,
      targetMode: 'campaign_interaction',
      compatibleReferenceIds: [input.notes[0]?.id],
    },
  },
  brief: {
    ...mismatchedModeInput.brief,
    contentMode: 'auto',
    mustInclude: '围绕当前共同处境，用一个不预设答案的问题与读者互动。',
    avoidTone: '不得补充产品、功能、材质、活动规则和奖品。',
    facts: [
      {
        id: 'required-context',
        statement: '读者的当前状态未知，只能用问题表达。',
        required: true,
      },
      {
        id: 'optional-cover-product',
        statement: '视觉素材展示一个产品款式。',
        required: false,
      },
    ],
  },
})
const optionalProductBackgroundMode = resolveDraftContentMode(
  optionalProductBackgroundInput,
)
assert.equal(optionalProductBackgroundMode.resolvedMode, 'campaign_interaction')
assert.equal(optionalProductBackgroundMode.modeSource, 'analysis')
assert.equal(optionalProductBackgroundMode.analysisModeMatches, true)
const reclassifiedCampaignReferenceInput = generateDraftRequestSchema.parse({
  ...inferredCampaignInput,
  analysis: {
    ...inferredCampaignInput.analysis,
    contentMode: {
      ...inferredCampaignInput.analysis.contentMode,
      targetMode: 'social_moment',
      referenceModes: [
        {
          noteId: input.notes[0]?.id ?? 'missing-note',
          mode: 'campaign_interaction',
          compatibility: 'stable_voice_only',
          reason: '早期目标模式不同，但参考本身是活动互动。',
        },
      ],
      compatibleReferenceIds: [],
    },
  },
})
const reclassifiedCampaignReferenceMode = resolveDraftContentMode(
  reclassifiedCampaignReferenceInput,
)
assert.equal(
  reclassifiedCampaignReferenceMode.resolvedMode,
  'campaign_interaction',
)
assert.equal(reclassifiedCampaignReferenceMode.analysisModeMatches, false)
assert.equal(
  reclassifiedCampaignReferenceMode.referenceSelectionSource,
  'resolved_mode_reclassified',
)
assert.deepEqual(reclassifiedCampaignReferenceMode.compatibleReferenceIds, [
  input.notes[0]?.id,
])
assert.equal(
  compactDraftSkillInput(reclassifiedCampaignReferenceInput).referenceLearning
    .noteCount,
  1,
)
assert.doesNotThrow(() => prepared.outputSchema.parse(expectedOutput))
assert.doesNotThrow(() => validateDraftSkillOutput(expectedOutput, input.length))
assert.doesNotThrow(() => validateDraftSkillOutput(expectedOutput, input.length, input))
assert.doesNotThrow(() =>
  validateDraftSkillOutput(
    {
      title: '两段短稿',
      body: ['第一段'.repeat(14), '第二段'.repeat(14)],
    },
    'short',
  ),
)
assert.doesNotThrow(() =>
  validateDraftSkillOutput(
    {
      title: '单块多行短稿',
      body: [
        ['第一行交代当前事实', '第二行推进下一条信息', '第三行自然收束'].join('\n').repeat(3),
      ],
    },
    'short',
  ),
)
assert.doesNotThrow(() =>
  validateDraftSkillOutput(
    {
      title: expectedOutput.title,
      body: [
        '字'.repeat(54),
        '字'.repeat(54),
        '字'.repeat(54),
        '字'.repeat(54),
        '字'.repeat(52),
      ],
    },
    input.length,
  ),
)
assert.throws(() =>
  validateDraftSkillOutput(
    {
      title: expectedOutput.title,
      body: expectedOutput.body.slice(0, 3),
    },
    input.length,
  ),
)

const copiedReferenceDraft = aiDraftCopySchema.parse({
  title: expectedOutput.title,
  body: [input.notes[0].contentText, ...expectedOutput.body.slice(1)],
})
const referenceReuseIssues = findReferenceReuseIssues(copiedReferenceDraft, input)
assert.ok(referenceReuseIssues.length > 0)
assert.equal(referenceReuseIssues[0]?.sourceTitle, input.notes[0].title)
assert.ok((referenceReuseIssues[0]?.characters ?? 0) >= 16)
assert.throws(() =>
  validateDraftSkillOutput(copiedReferenceDraft, input.length, input),
)

const guanxiaPhrases = [
  {
    title: '裸香氛洗护｜身穿一朵云',
    text: '风吹过的时候，棉株轻轻晃动。远远看去，像一层浅浅的云，落在塔里木盆地边缘。',
  },
  {
    title: '裸｜四重肌肤感官仪式',
    text: '棉花以柔软回应土地，棉籽以丰盈润泽肌肤，它们都生于天然，也保留着原本的质地、气息与温度。',
  },
  {
    title: '白瓷，向天地借一抹本真',
    text: '素棉帷幔呈现与生俱来的白，与素胎白瓷的审美意趣同源，同是化繁为简、取于天然。',
  },
] as const
const guanxiaInput = generateDraftRequestSchema.parse({
  ...input,
  projectName: '观夏盲测',
  topic: '方寸展桌，裸的变奏',
  notes: guanxiaPhrases.map((phrase, index) => ({
    ...input.notes[0],
    id: `note-guanxia-${index + 1}`,
    title: phrase.title,
    contentText: phrase.text,
  })),
  snippets: [],
  brief: {
    mustInclude: '展桌；常玉、棉花、白衬衫、白瓷四个关键词',
    avoidTone: '促销、购买号召',
  },
})
const guanxiaCopiedDraft = aiDraftCopySchema.parse({
  title: '方寸展桌，裸的变奏',
  body: guanxiaPhrases.map((phrase) => phrase.text),
})
const guanxiaReuseIssues = findReferenceReuseIssues(
  guanxiaCopiedDraft,
  guanxiaInput,
)
assert.equal(guanxiaReuseIssues.length, guanxiaPhrases.length)
assert.ok(guanxiaReuseIssues.every((issue) => issue.characters >= 16))
assert.throws(() =>
  validateDraftSkillOutput(guanxiaCopiedDraft, 'short', guanxiaInput),
)

const distinctiveClosingInput = generateDraftRequestSchema.parse({
  ...guanxiaInput,
  snippets: [
    {
      ...input.snippets[0],
      id: 'snippet-guanxia-closing',
      noteTitle: '棉花工坊，晨间三部曲',
      selectedText: '步入棉花工坊，心自安顿。',
    },
  ],
})
const distinctiveClosingIssues = findReferenceReuseIssues(
  aiDraftCopySchema.parse({
    title: '方寸展桌，裸的变奏',
    body: [
      '展桌上陈列着四组创作线索。',
      '白瓷与素棉共同指向未加修饰的状态。',
      '驻足片刻，心自安顿。',
    ],
  }),
  distinctiveClosingInput,
)
assert.ok(distinctiveClosingIssues.some((issue) => issue.overlap === '心自安顿'))

const metadataLeakDraft = aiDraftCopySchema.parse({
  title: '今晚还看球吗',
  body: [
    '封面里的四双袜子用了不同配色，也都带着十号元素。',
    '今晚还熬夜看球吗？先从四双里挑一双喜欢的。',
  ],
})
assert.deepEqual(findDraftMetaLanguageIssues(metadataLeakDraft, input), [
  { phrase: '封面' },
])
assert.throws(() =>
  validateDraftSkillOutput(metadataLeakDraft, 'short', input),
)

const groundedAuditInput = generateDraftRequestSchema.parse({
  ...input,
  length: 'short',
  brief: {
    mustInclude: '四双足球主题袜子带有十号元素',
    avoidTone: '不得断言读者支持的球队已晋级或淘汰',
    facts: [
      { id: 'socks', statement: '有四双足球主题袜子，带有十号元素。' },
      {
        id: 'team-status',
        statement: '读者支持的球队是否仍在比赛中未知，只能以问题表达。',
      },
    ],
  },
})
const groundingCandidate = aiDraftCopySchema.parse({
  title: '今晚还看球吗',
  body: [
    '四双足球主题袜子，都带着十号元素。',
    '你的主队还在吗？心里没底也没关系，今晚先挑一双喜欢的。',
  ],
})
const groundingAudit = validateDraftGroundingAuditOutput(
  {
    assertions: [
      {
        quote: '四双足球主题袜子',
        classification: 'supported',
        reason: 'brief.facts 明确给出。',
      },
      {
        quote: '心里没底',
        classification: 'unknown',
        reason: '输入未提供读者的心理状态。',
      },
    ],
  },
  groundingCandidate,
)
assert.deepEqual(getDraftGroundingIssues(groundingAudit), [
  {
    quote: '心里没底',
    classification: 'unknown',
    reason: '输入未提供读者的心理状态。',
  },
])
assert.deepEqual(
  JSON.parse(
    buildDraftRepairUserPrompt(
      groundedAuditInput,
      groundingCandidate,
      getDraftGroundingIssues(groundingAudit),
    ),
  ).input.bannedGroundingPhrases,
  ['心里没底'],
)
assert.deepEqual(
  JSON.parse(
    buildDraftGroundingAuditUserPrompt(groundedAuditInput, groundingCandidate),
  ).input.allowedSources,
  {
    topic: groundedAuditInput.topic,
    brief: groundedAuditInput.brief,
  },
)

assert.deepEqual(
  parseJsonContent(`{
    "title": "控制字符修复",
    "body": ["第一行
仍然属于同一个 JSON 字符串", "第二段", "第三段"]
  }`),
  {
    title: '控制字符修复',
    body: ['第一行\n仍然属于同一个 JSON 字符串', '第二段', '第三段'],
  },
)

const lengthPolicy = draftLengthPolicies[userPayload.input.length]
const bodyCharacterCount = expectedOutput.body.join('').length
assert.ok(expectedOutput.body.length >= lengthPolicy.minParagraphs)
assert.ok(expectedOutput.body.length <= lengthPolicy.maxParagraphs)
assert.ok(bodyCharacterCount >= lengthPolicy.minCharacters)
assert.ok(bodyCharacterCount <= lengthPolicy.maxCharacters)
assert.ok(expectedOutput.body.join('').includes('提前二十分钟下楼'))
assert.ok(expectedOutput.body.join('').includes('第三天'))
assert.ok(!/热血|逆袭|治愈|彻底改变生活/.test(expectedOutput.body.join('')))

assert.doesNotThrow(() =>
  generateDraftResponseSchema.parse({
    ok: true,
    status: 'generated',
    provider: 'deepseek',
    model: prepared.model,
    skill: prepared.metadata,
    draft: expectedOutput,
    usage: null,
  }),
)
assert.doesNotThrow(() =>
  generateDraftResponseSchema.parse({
    ok: true,
    status: 'insufficient_facts',
    assessment: insufficientProductAssessment,
  }),
)

const underLengthOutput = aiDraftCopySchema.parse({
  title: expectedOutput.title,
  body: [
    '字'.repeat(36),
    '字'.repeat(36),
    '字'.repeat(36),
    '字'.repeat(36),
    '字'.repeat(36),
  ],
})
const repairPrompt = JSON.parse(
  buildDraftRepairUserPrompt(input, underLengthOutput),
) as {
  task: string
  input: {
    actual: { paragraphs: number; bodyCharacters: number }
    outputRequirements: {
      minBodyCharacters: number
      maxBodyCharacters: number
      repairTargetBodyCharacters: number
    }
    referenceReuseIssues: Array<{
      sourceTitle: string
      overlap: string
      characters: number
    }>
    bannedVerbatimPhrases: string[]
  }
}
assert.equal(repairPrompt.task, 'repair_draft_contract')
assert.deepEqual(repairPrompt.input.actual, {
  paragraphs: 5,
  bodyCharacters: 180,
})
assert.equal(repairPrompt.input.outputRequirements.minBodyCharacters, 201)
assert.equal(repairPrompt.input.outputRequirements.maxBodyCharacters, 600)
assert.equal(repairPrompt.input.outputRequirements.repairTargetBodyCharacters, 280)
assert.deepEqual(repairPrompt.input.referenceReuseIssues, [])
assert.deepEqual(repairPrompt.input.bannedVerbatimPhrases, [])

const originalFetch = globalThis.fetch
const mockedRequests: Array<{
  messages: Array<{ role: string; content: string }>
}> = []
let mockedResponseIndex = 0
globalThis.fetch = async (_input, init) => {
  mockedRequests.push(
    JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>
    },
  )
  const firstResponse = mockedResponseIndex === 0
  mockedResponseIndex += 1

  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(firstResponse ? underLengthOutput : expectedOutput),
          },
        },
      ],
      usage: firstResponse
        ? { prompt_tokens: 1200, completion_tokens: 205, total_tokens: 1405 }
        : { prompt_tokens: 400, completion_tokens: 250, total_tokens: 650 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

try {
  const repaired = await generateDraftWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    input,
  )
  assert.deepEqual(repaired.draft, expectedOutput)
  assert.deepEqual(repaired.usage, {
    promptTokens: 1600,
    completionTokens: 455,
    totalTokens: 2055,
  })
  assert.equal(mockedRequests.length, 2)
  assert.equal(
    mockedRequests[1]?.messages[0]?.content,
    draftRepairSystemPrompt,
  )
  assert.equal(
    JSON.parse(mockedRequests[1]?.messages[1]?.content ?? '{}').task,
    'repair_draft_contract',
  )
} finally {
  globalThis.fetch = originalFetch
}

const sourceFactsOnlyInput = generateDraftRequestSchema.parse({
  ...input,
  length: 'short',
  topic: '四双足球主题袜子都带有十号元素',
  targetAudience: '喜欢足球的人',
  notes: [],
  snippets: [],
  brief: {
    mustInclude: '四双足球主题袜子都带有十号元素',
    avoidTone: '不得补写读者心理状态',
    objective: '介绍四双足球主题袜子',
    sourceFacts:
      '有四双足球主题袜子；每双都带有十号元素；主队是否仍在比赛中未知，只能用问题表达。',
    instructions: '保持克制',
    facts: [],
  },
})
const sourceFactsOnlyCandidate = aiDraftCopySchema.parse({
  title: '今晚还看球吗',
  body: [
    '四双足球主题袜子都带有十号元素。你的主队还在吗？心里没底也没关系。',
  ],
})
const sourceFactsOnlyRepairedCandidate = aiDraftCopySchema.parse({
  title: '今晚还看球吗',
  body: ['四双足球主题袜子都带有十号元素。你的主队还在吗？'],
})
const sourceFactsOnlyRequests: Array<{
  messages: Array<{ role: string; content: string }>
}> = []
const sourceFactsOnlyResponses = [
  sourceFactsOnlyCandidate,
  {
    assertions: [
      {
        quote: '心里没底',
        classification: 'unknown',
        reason: 'topic 与 brief.sourceFacts 均未提供读者心理状态。',
      },
    ],
  },
  sourceFactsOnlyRepairedCandidate,
  {
    assertions: [
      {
        quote: '四双足球主题袜子都带有十号元素',
        classification: 'supported',
        reason: 'brief.sourceFacts 明确给出。',
      },
    ],
  },
]
let sourceFactsOnlyResponseIndex = 0
globalThis.fetch = async (_input, init) => {
  sourceFactsOnlyRequests.push(
    JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>
    },
  )
  const responseContent = sourceFactsOnlyResponses[sourceFactsOnlyResponseIndex]
  sourceFactsOnlyResponseIndex += 1

  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(responseContent) } }],
      usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

try {
  const grounded = await generateDraftWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    sourceFactsOnlyInput,
  )
  assert.deepEqual(grounded.draft, sourceFactsOnlyRepairedCandidate)
  assert.deepEqual(grounded.usage, {
    promptTokens: 400,
    completionTokens: 100,
    totalTokens: 500,
  })
  assert.equal(sourceFactsOnlyRequests.length, 4)
  assert.equal(
    sourceFactsOnlyRequests[1]?.messages[0]?.content,
    draftGroundingAuditSystemPrompt,
  )
  assert.equal(
    sourceFactsOnlyRequests[2]?.messages[0]?.content,
    draftRepairSystemPrompt,
  )
  assert.equal(
    sourceFactsOnlyRequests[3]?.messages[0]?.content,
    draftGroundingAuditSystemPrompt,
  )
  const firstAuditPayload = JSON.parse(
    sourceFactsOnlyRequests[1]?.messages[1]?.content ?? '{}',
  ) as {
    input: { allowedSources: { brief: { sourceFacts: string } } }
  }
  assert.equal(
    firstAuditPayload.input.allowedSources.brief.sourceFacts,
    sourceFactsOnlyInput.brief.sourceFacts,
  )
  const repairPayload = JSON.parse(
    sourceFactsOnlyRequests[2]?.messages[1]?.content ?? '{}',
  ) as {
    input: { bannedGroundingPhrases: string[] }
  }
  assert.deepEqual(repairPayload.input.bannedGroundingPhrases, ['心里没底'])
} finally {
  globalThis.fetch = originalFetch
}

const conservativeTopicOnlyInput = generateDraftRequestSchema.parse({
  ...sourceFactsOnlyInput,
  brief: {
    ...sourceFactsOnlyInput.brief,
    sourceFacts: '',
    allowConservativeDraft: true,
  },
})
const conservativeTopicOnlyRequests: Array<{
  messages: Array<{ role: string; content: string }>
}> = []
let conservativeTopicOnlyResponseIndex = 0
globalThis.fetch = async (_input, init) => {
  conservativeTopicOnlyRequests.push(
    JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>
    },
  )
  const responseContent =
    conservativeTopicOnlyResponseIndex === 0
      ? sourceFactsOnlyRepairedCandidate
      : {
          assertions: [
            {
              quote: '四双足球主题袜子都带有十号元素',
              classification: 'supported',
              reason: 'topic 明确给出。',
            },
          ],
        }
  conservativeTopicOnlyResponseIndex += 1

  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(responseContent) } }],
      usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

try {
  const conservativeDraft = await generateDraftWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    conservativeTopicOnlyInput,
  )
  assert.deepEqual(conservativeDraft.draft, sourceFactsOnlyRepairedCandidate)
  assert.equal(conservativeTopicOnlyRequests.length, 2)
  assert.equal(
    conservativeTopicOnlyRequests[1]?.messages[0]?.content,
    draftGroundingAuditSystemPrompt,
  )
} finally {
  globalThis.fetch = originalFetch
}

const failedRepairRequests: unknown[] = []
globalThis.fetch = async (_input, init) => {
  failedRepairRequests.push(JSON.parse(String(init?.body)))
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(underLengthOutput) } }],
      usage: { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

let failedRepairError: unknown
try {
  await generateDraftWithDeepSeek(
    readConfig({
      APP_ENV: 'local',
      AI_FEATURE_ENABLED: 'true',
      AI_PROVIDER_PRIMARY: 'deepseek',
      DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
    }),
    input,
  )
} catch (error) {
  failedRepairError = error
} finally {
  globalThis.fetch = originalFetch
}
assert.ok(failedRepairError instanceof DeepSeekOutputValidationError)
assert.deepEqual(failedRepairError.usage, {
  promptTokens: 900,
  completionTokens: 300,
  totalTokens: 1200,
})
assert.equal(failedRepairRequests.length, 3)

const api = createApiApp()
const disabledAiEnv = {
  APP_ENV: 'local',
  AI_FEATURE_ENABLED: 'false',
  AI_PROVIDER_PRIMARY: 'deepseek',
  DEEPSEEK_API_KEY: 'offline-evaluation-placeholder',
}
const disabledResponse = await api.request(
  '/v1/ai/draft',
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

console.log('draft-v1 offline evaluation passed')
console.log(`skill: ${prepared.metadata.id}@${prepared.metadata.version}`)
console.log(`prompt hash: ${prepared.metadata.promptHash}`)
console.log(`fixture length: ${expectedOutput.body.length} paragraphs, ${bodyCharacterCount} characters`)
console.log('up to two repair attempts: simulated and usage-combined')
console.log('AI feature gate: closed')
console.log('paid model calls: 0')
