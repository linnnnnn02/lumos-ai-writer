import {
  aiDraftCopySchema,
  type AiDraftCopy,
  type DraftFactSufficiencyResult,
  type GenerateDraftRequest,
  type WritingProfileRevisionDto,
} from '@lumos-ai/shared'
import { z } from 'zod'
import type { AiSkillDefinition } from '../runtime.js'
import { humanChineseCopyRulesV1 } from '../shared/human-chinese-copy-rules-v1.js'
import { compactActiveWritingProfile } from '../shared/writing-profile.js'

export const draftLengthPolicies = {
  short: {
    minParagraphs: 1,
    maxParagraphs: 4,
    minCharacters: 40,
    maxCharacters: 200,
    preferredParagraphs: 2,
    preferredMinCharactersPerParagraph: 40,
    preferredMaxCharactersPerParagraph: 100,
  },
  medium: {
    minParagraphs: 3,
    maxParagraphs: 6,
    minCharacters: 201,
    maxCharacters: 600,
    preferredParagraphs: 4,
    preferredMinCharactersPerParagraph: 50,
    preferredMaxCharactersPerParagraph: 90,
  },
  long: {
    minParagraphs: 7,
    maxParagraphs: 10,
    minCharacters: 601,
    maxCharacters: 1000,
    preferredParagraphs: 8,
    preferredMinCharactersPerParagraph: 80,
    preferredMaxCharactersPerParagraph: 110,
  },
} as const

export type DraftSkillInput = GenerateDraftRequest & {
  writingProfileContext?: {
    accountProfile: WritingProfileRevisionDto | null
    projectProfile: WritingProfileRevisionDto | null
  }
}

export function getDraftOutputRequirements(
  length: GenerateDraftRequest['length'],
  input?: GenerateDraftRequest,
) {
  const lengthPolicy = draftLengthPolicies[length]
  const mustInclude = input?.brief.mustInclude ?? ''
  const requiredFactCount =
    input?.brief.facts.filter((fact) => fact.required).length ?? 0
  const explicitlyRequestsUltraShort =
    length === 'short' &&
    /极短|一句话|单句|一行(?:文案|配文|正文)|一句(?:短句|配文)/.test(mustInclude)
  const hasSparseShortBrief =
    length === 'short' &&
    input !== undefined &&
    requiredFactCount <= 2 &&
    Array.from(mustInclude.replace(/\s/g, '')).length <= 120
  const brevityMode = explicitlyRequestsUltraShort
    ? ('ultra_short' as const)
    : hasSparseShortBrief
      ? ('sparse_short' as const)
      : ('standard' as const)
  const minimumBodyCharacters =
    brevityMode === 'ultra_short'
      ? 12
      : brevityMode === 'sparse_short'
        ? 12
        : lengthPolicy.minCharacters

  return {
    maxTitleCharacters: 35,
    minParagraphs: lengthPolicy.minParagraphs,
    maxParagraphs:
      brevityMode === 'ultra_short' || brevityMode === 'sparse_short'
        ? 2
        : lengthPolicy.maxParagraphs,
    minBodyCharacters: minimumBodyCharacters,
    maxBodyCharacters:
      brevityMode === 'ultra_short'
        ? 72
        : brevityMode === 'sparse_short'
          ? 96
          : lengthPolicy.maxCharacters,
    preferredParagraphs:
      brevityMode === 'ultra_short' || brevityMode === 'sparse_short'
        ? 1
        : lengthPolicy.preferredParagraphs,
    preferredCharactersPerParagraph:
      brevityMode === 'ultra_short'
        ? { min: 24, max: 56 }
        : brevityMode === 'sparse_short'
          ? { min: 18, max: 48 }
        : {
            min: lengthPolicy.preferredMinCharactersPerParagraph,
            max: lengthPolicy.preferredMaxCharactersPerParagraph,
          },
    brevityMode,
    countingRule: 'body 数组元素数量按段落计；body 全部字符串去除空白后按 Unicode 字符计数',
  }
}

const outputContract = {
  title: '一条不超过 35 个汉字的小红书标题',
  body: ['完整正文段落；实际数组长度必须严格满足 input.outputRequirements'],
}

const minimumReferenceOverlapCharacters = 16

const draftMetaLanguagePhrases = [
  '封面',
  '配图',
  '图中',
  '图片中',
  '画面中',
  'brief',
  '输入中',
  '参考文案',
  '参考笔记',
  '标注内容',
  '事实清单',
  '目标读者',
  '用户要求',
  '写作要求',
] as const

export type DraftMetaLanguageIssue = {
  phrase: string
}

export function findDraftMetaLanguageIssues(
  draft: AiDraftCopy,
  input?: Pick<GenerateDraftRequest, 'projectName' | 'topic'>,
): DraftMetaLanguageIssue[] {
  const text = [draft.title, ...draft.body].join('\n').toLowerCase()
  const explicitlyRequestedText = [input?.projectName, input?.topic]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()

  return draftMetaLanguagePhrases
    .filter(
      (phrase) =>
        text.includes(phrase.toLowerCase()) &&
        !explicitlyRequestedText.includes(phrase.toLowerCase()),
    )
    .map((phrase) => ({ phrase }))
}

export const draftGroundingAuditOutputSchema = z.object({
  assertions: z
    .array(
      z.object({
        quote: z.string().trim().min(1).max(160),
        classification: z.enum(['supported', 'contradicted', 'unknown']),
        reason: z.string().trim().min(1).max(240),
      }),
    )
    .max(24),
})

export type DraftGroundingAuditOutput = z.infer<
  typeof draftGroundingAuditOutputSchema
>

export type DraftGroundingIssue = DraftGroundingAuditOutput['assertions'][number]

export const draftGroundingAuditSystemPrompt = [
  '你是 Lumos AI Writer 的成稿事实审计器。',
  '你的唯一任务是检查候选成稿中的具体断言是否被 topic 和 brief 支持；参考文案、写作风格、常识联想和目标读者画像都不是事实来源。',
  '逐条抽取标题和正文中可被外部核验的具体断言，包括人物或读者的情绪与认知、产品属性与效果、物体与数量、时间地点、事件状态、动作关系、因果和先后顺序。',
  '每条断言只能分类为 supported、contradicted 或 unknown：supported 表示 topic 或 brief 明确给出或必然蕴含；contradicted 表示与 brief.sourceFacts、brief.facts 或 brief.avoidTone 冲突；unknown 表示输入既未支持也未否定。',
  'supported 必须覆盖断言里的每个限定词。若主体被支持，但成稿新增了精确数字、位置、表面、动作、程度、结果或心理状态，新增部分仍是 unknown，应把 quote 缩到该最小片段。',
  '未知不能因为“听起来合理”、符合常识、出现在目标读者画像中或适合品牌语气而判为 supported。输入允许用问题保留未知时，不把不预设答案的问题当作断言；但问题里暗含的情绪、状态或前提仍需单独审计。',
  '逐项读取 brief.avoidTone 里的禁区并反查候选稿。产品名包含“修护、净澈、舒缓”等字样，只能支持名称本身，不能据此推导产品效果；两件产品“配合使用”也不蕴含先后顺序、协同机制、双倍效果或任何新增功效。',
  '输入缺少某项事实，只表示该项不能写，不支持把材料缺口叙述成产品状态。“功效未知、标签难辨、静待探索、更多信息待揭晓”只有在 brief 明确要求悬念叙事时才 supported；不能用“未知”替代被删除的幻觉。季节处境也不自动支持“皮肤易感不适、肌肤需要安抚或关怀”。',
  '边界示例：输入只说“大约一个月”，成稿“第 30 天”中的“第 30 天”是 unknown；输入只说视觉素材展示袜子，成稿“袜子摆在桌上”中的“摆在桌上”是 unknown；输入只说两件产品配合使用，成稿“面膜先行，精华跟进”与“带来更深层舒缓”都是 unknown；输入只说炎热干燥和两件产品，成稿“皮肤易感不适”“两件产品静待探索”和“功效未知”都是 unknown；输入只说主队状态未知，成稿“心里没底”是 unknown；输入只说凌晨 3 点开赛并邀请一起看，成稿“陪你守到天亮”中的“守到天亮”是 unknown。',
  '时间词必须语义保真：输入“今天凌晨 3 点”时，成稿“今晚 3 点”是 contradicted。今天、今晚、明天以及上午、下午、晚上、凌晨不能因口语化而互换。',
  'quote 必须逐字复制候选成稿中的最小充分片段，不能改写、概括或补词。同一个事实不要重复抽取。主观号召和纯修辞若不暗含可核验事实，可以不列出。',
  '只输出一个 JSON object，不要 Markdown、代码块、解释或思考过程。',
  'JSON 字段严格为 assertions:{quote:string,classification:"supported"|"contradicted"|"unknown",reason:string}[]。',
].join('\n')

export const draftGroundingAuditUserPromptTemplate =
  'JSON.stringify({ task: "audit_draft_grounding", input: { candidateDraft, allowedSources: { topic, brief } } })'

export function buildDraftGroundingAuditUserPrompt(
  input: GenerateDraftRequest,
  candidateDraft: AiDraftCopy,
) {
  return JSON.stringify({
    task: 'audit_draft_grounding',
    input: {
      candidateDraft,
      allowedSources: {
        topic: input.topic,
        brief: input.brief,
      },
    },
  })
}

export function validateDraftGroundingAuditOutput(
  output: unknown,
  candidateDraft: AiDraftCopy,
) {
  const parsed = draftGroundingAuditOutputSchema.parse(output)
  const draftText = [candidateDraft.title, ...candidateDraft.body].join('\n')

  return draftGroundingAuditOutputSchema
    .superRefine((value, context) => {
      value.assertions.forEach((assertion, index) => {
        if (!draftText.includes(assertion.quote)) {
          context.addIssue({
            code: 'custom',
            path: ['assertions', index, 'quote'],
            message: 'Audit quote must be an exact substring of the candidate draft.',
          })
        }
      })
    })
    .parse(parsed)
}

export function getDraftGroundingIssues(
  output: DraftGroundingAuditOutput,
): DraftGroundingIssue[] {
  return output.assertions.filter(
    (assertion) => assertion.classification !== 'supported',
  )
}

function normalizeReferenceText(text: string) {
  return Array.from(text.normalize('NFKC').toLowerCase())
    .filter((character) => /[\p{L}\p{N}]/u.test(character))
    .join('')
}

function getAnnotatedReferenceClauses(text: string) {
  return text
    .split(/[，,。.!！？?；;：:\n\r]+/u)
    .map((clause) => clause.trim())
    .filter((clause) => Array.from(normalizeReferenceText(clause)).length >= 4)
}

function findLongestCommonSubstring(left: string, right: string) {
  const leftCharacters = Array.from(left)
  const rightCharacters = Array.from(right)
  const lengths = new Uint16Array(rightCharacters.length + 1)
  let longestLength = 0
  let longestEnd = 0

  for (let leftIndex = 1; leftIndex <= leftCharacters.length; leftIndex += 1) {
    for (let rightIndex = rightCharacters.length; rightIndex >= 1; rightIndex -= 1) {
      if (leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 1]) {
        lengths[rightIndex] = lengths[rightIndex - 1] + 1
        if (lengths[rightIndex] > longestLength) {
          longestLength = lengths[rightIndex]
          longestEnd = leftIndex
        }
      } else {
        lengths[rightIndex] = 0
      }
    }
  }

  return leftCharacters.slice(longestEnd - longestLength, longestEnd).join('')
}

export type ReferenceReuseIssue = {
  sourceTitle: string
  overlap: string
  characters: number
}

export function findReferenceReuseIssues(
  draft: AiDraftCopy,
  input: GenerateDraftRequest,
): ReferenceReuseIssue[] {
  const draftBody = normalizeReferenceText(draft.body.join('\n'))
  const allowedVerbatimText = normalizeReferenceText(
    [input.projectName, input.topic].join('\n'),
  )
  const sources = [
    ...input.notes.map((note) => ({
      title: note.title,
      text: note.contentText,
      minimumCharacters: minimumReferenceOverlapCharacters,
    })),
    ...input.snippets.flatMap((snippet) =>
      getAnnotatedReferenceClauses(snippet.selectedText).map((clause) => ({
        title: `${snippet.noteTitle}（标注）`,
        text: clause,
        minimumCharacters: Math.min(
          minimumReferenceOverlapCharacters,
          Array.from(normalizeReferenceText(clause)).length,
        ),
      })),
    ),
  ]

  const issues = sources
    .map((source) => {
      const overlap = findLongestCommonSubstring(
        draftBody,
        normalizeReferenceText(source.text),
      )
      return {
        sourceTitle: source.title,
        overlap,
        characters: Array.from(overlap).length,
        minimumCharacters: source.minimumCharacters,
      }
    })
    .filter(
      (issue) =>
        issue.characters >= issue.minimumCharacters &&
        !allowedVerbatimText.includes(issue.overlap),
    )
    .sort((left, right) => right.characters - left.characters)

  return Array.from(
    new Map(
      issues.map(({ minimumCharacters: _minimumCharacters, ...issue }) => [
        issue.overlap,
        issue,
      ]),
    ).values(),
  ).slice(0, 4)
}

const neutralModeMismatchSurfaceStyle = {
  sentenceRhythm: '句长服从当前事实密度，不迁移其他内容模式的节奏',
  paragraphShape: '按当前任务的信息顺序分段，不迁移其他内容模式的版式',
  punctuation: '使用自然中文标点，以当前任务可读性为准',
  emotionalIntensity: '情绪强度服从当前内容模式和明确 brief',
  interactionStyle: '仅按当前内容模式安排互动',
}

const defaultModeGuidance = {
  brand_story: {
    informationPriority: '先给具体关系或判断，再用事实支撑，最后自然收束',
    interactionPattern: '默认不设置参与任务，确有需要时只做轻量回应',
    styleBoundary: '不迁移抽奖步骤、参数清单或活动流程',
  },
  product_education: {
    informationPriority: '先交代使用问题，再写功能或动作，随后落到可核实体验',
    interactionPattern: '互动围绕真实使用问题，不设置无关参与任务',
    styleBoundary: '不迁移品牌宣言、抽奖流程或活动口号',
  },
  campaign_interaction: {
    informationPriority: '优先写时间与事件、参与主体、参与动作、奖励或结果顺序',
    interactionPattern: '问题必须直接连接参与动作，参与路径清楚且只出现一次',
    styleBoundary: '不套用产品说明结构，也不把活动信息藏在氛围段落后',
  },
  event_announcement: {
    informationPriority: '优先写事件、时间地点、对象、流程和到场方式',
    interactionPattern: '互动只服务确认、报名或到场，不增加无关任务',
    styleBoundary: '不迁移抽奖机制、产品参数或空泛品牌叙事',
  },
  social_moment: {
    informationPriority: '先写当前瞬间或共同处境，再给一个反应或轻量问题',
    interactionPattern: '最多保留一个自然问题，不预设读者答案',
    styleBoundary: '不虚构活动规则、产品功效或宏大品牌判断',
  },
  other: {
    informationPriority: '按 brief 的必写事实顺序推进，每段只增加一个信息',
    interactionPattern: '仅在 brief 明确需要时互动',
    styleBoundary: '不迁移与当前任务无关的参考内容结构',
  },
} as const

function inferDraftContentModeFromBrief(input: DraftSkillInput) {
  const text = [
    input.brief.mustInclude,
    ...input.brief.facts
      .filter((fact) => fact.required)
      .map((fact) => fact.statement),
  ].join('\n')
  const signalGroups = {
    campaign_interaction: [
      /抽奖|抽取|中奖|奖品|礼包|赠送|送出/u,
      /参与|关注|点赞|评论|收藏|转发|竞猜|预测|征集|投票/u,
      /联名|合作品牌|合作方/u,
    ],
    event_announcement: [
      /开业|展览|快闪|发布会|见面会|线下活动|到店|门店/u,
      /时间|日期|地点|地址|报名|预约|流程|场次/u,
      /举办|开放|开幕|闭幕/u,
    ],
    product_education: [
      /功能|材质|成分|参数|性能|效果|功效/u,
      /使用|用法|步骤|教程|指南|洗护|搭配|适合/u,
      /产品|新品|款式|型号|规格/u,
    ],
    brand_story: [
      /品牌故事|品牌理念|品牌态度|价值观|品牌主张/u,
      /创立|初心|长期坚持|品牌历史/u,
    ],
  } as const

  for (const mode of [
    'campaign_interaction',
    'event_announcement',
    'product_education',
    'brand_story',
  ] as const) {
    const score = signalGroups[mode].filter((pattern) => pattern.test(text)).length
    if (score >= 2) return mode
  }

  return null
}

export function resolveDraftContentMode(input: DraftSkillInput) {
  const analysisMode = input.analysis.contentMode.targetMode
  const requestedMode = input.brief.contentMode
  const inferredBriefMode =
    requestedMode === 'auto' ? inferDraftContentModeFromBrief(input) : null
  const resolvedMode =
    requestedMode === 'auto'
      ? inferredBriefMode ??
        (analysisMode === 'unclassified' ? 'other' : analysisMode)
      : requestedMode
  const usesLegacyFallback =
    analysisMode === 'unclassified' &&
    requestedMode === 'auto' &&
    inferredBriefMode === null
  const knownNoteIds = new Set(input.notes.map((note) => note.id))
  const analysisModeMatches = usesLegacyFallback || analysisMode === resolvedMode
  const compatibleReferenceIds = usesLegacyFallback
    ? input.notes.map((note) => note.id)
    : analysisModeMatches
      ? input.analysis.contentMode.compatibleReferenceIds
      : input.analysis.contentMode.referenceModes
          .filter((reference) => reference.mode === resolvedMode)
          .map((reference) => reference.noteId)
          .filter((noteId) => knownNoteIds.has(noteId))
  const modeSpecificGuidance =
    analysisModeMatches && !usesLegacyFallback
      ? input.analysis.contentMode.modeSpecificGuidance
      : defaultModeGuidance[resolvedMode]

  return {
    requestedMode,
    resolvedMode,
    modeSource:
      requestedMode !== 'auto'
        ? ('brief_explicit' as const)
        : inferredBriefMode
          ? ('brief_inferred' as const)
          : usesLegacyFallback
            ? ('legacy_fallback' as const)
            : ('analysis' as const),
    analysisMode,
    analysisModeMatches,
    usesLegacyFallback,
    referenceSelectionSource: usesLegacyFallback
      ? ('legacy_all' as const)
      : analysisModeMatches
        ? ('analysis_compatible' as const)
        : ('resolved_mode_reclassified' as const),
    compatibleReferenceIds,
    stableVoiceSignals: input.analysis.contentMode.stableVoiceSignals,
    modeSpecificGuidance,
  }
}

const concreteFactRelationPattern =
  /(?:是|为|有|含|包含|采用|使用|配合|支持|提供|适合|面向|位于|来自|将在|已经|现已|开始|结束|开放|举办|获得|抽取|减少|增加|达到|约为|可(?:以|供|用于)?)/u
const productIdentityPattern =
  /(?:名为|名称|型号|系列|组合|这款|本款|面膜|精华|乳液|乳霜|面霜|洁面|洗发|护发|唇膏|卸妆|咖啡|饮品|鞋|袜|服装|设备|工具|课程|服务|[A-Za-z][A-Za-z0-9-]{2,})/u
const productEvidencePattern =
  /(?:成分|材质|工艺|机制|质地|规格|功能|功效|用途|场景|条件|配合|采用|包含|适合|支持|提供|可用于|使用时|使用后)/u
const campaignBasicsPattern =
  /(?:活动|联名|抽奖|竞猜|征集|挑战|直播|福利|礼包|奖品|优惠|上新|发布|开启|主题)/u
const participationPattern =
  /(?:参与|关注|点赞|评论|收藏|转发|报名|预约|搜索|进入|提交|领取|购买|兑换|抽取|获得|截止)/u
const timeOrLocationPattern =
  /(?:\d{1,4}[年月日号点时分:%：./-]|今天|明天|本周|周[一二三四五六日天]|上午|下午|晚上|凌晨|时间|日期|地点|地址|门店|展厅|线上|线下)/u

function splitDraftFactStatements(value: string) {
  return value
    .split(/[\n；;]+/u)
    .map((statement) => statement.trim().replace(/^[-*•]\s*/u, ''))
    .filter(Boolean)
}

function isConcreteFactStatement(statement: string) {
  const compact = statement.replace(/\s/g, '')
  if (compact.length < 4) return false
  return (
    /\d/u.test(compact) ||
    /[:：]/u.test(compact) ||
    concreteFactRelationPattern.test(compact)
  )
}

export function assessDraftFactSufficiency(
  input: DraftSkillInput,
): DraftFactSufficiencyResult | null {
  if (input.brief.allowConservativeDraft) return null

  const { resolvedMode } = resolveDraftContentMode(input)
  if (
    resolvedMode !== 'product_education' &&
    resolvedMode !== 'campaign_interaction' &&
    resolvedMode !== 'event_announcement'
  ) {
    return null
  }

  const sourceStatements = [
    ...splitDraftFactStatements(input.brief.sourceFacts),
    ...input.brief.facts
      .filter((fact) => fact.required)
      .map((fact) => fact.statement.trim())
      .filter(Boolean),
  ]
  const topicStatement = input.topic.trim()
  const candidateStatements = [topicStatement, ...sourceStatements]
  const concreteFacts = Array.from(
    new Set(candidateStatements.filter(isConcreteFactStatement)),
  )
  const evidenceText = candidateStatements.join('\n')
  const missingFacts: DraftFactSufficiencyResult['missingFacts'] = []

  if (resolvedMode === 'product_education') {
    if (!productIdentityPattern.test(evidenceText)) {
      missingFacts.push({
        id: 'product_identity',
        label: '产品或组合',
        question: '这篇具体写哪个产品、系列或组合？请补充准确名称和主体关系。',
        reason: '主体不明确时，模型容易把参考产品或封面物体误写成本篇对象。',
        targetField: 'source_facts',
      })
    }
    if (
      concreteFacts.length === 0 ||
      !productEvidencePattern.test(sourceStatements.join('\n'))
    ) {
      missingFacts.push({
        id: 'product_evidence',
        label: '可确认的产品事实',
        question: '可以确认的功能、机制、使用条件或组合价值是什么？没有功效依据时也请明确说明。',
        reason: '缺少事实支点时，短稿也容易用泛化关怀、画面氛围或名称里的功效词补位。',
        targetField: 'source_facts',
      })
    }
  }

  if (resolvedMode === 'campaign_interaction') {
    if (!campaignBasicsPattern.test(evidenceText) || !timeOrLocationPattern.test(evidenceText)) {
      missingFacts.push({
        id: 'campaign_basics',
        label: '活动基本信息',
        question: '活动是什么、何时发生？请补充活动名称、时间或有效期限。',
        reason: '没有事件和时间，活动文案会只剩通用号召。',
        targetField: 'source_facts',
      })
    }
    if (!participationPattern.test(sourceStatements.join('\n'))) {
      missingFacts.push({
        id: 'participation_path',
        label: '参与路径',
        question: '用户需要做什么，完成后会得到什么结果或奖励？',
        reason: '参与动作和结果必须来自明确规则，不能根据其他活动参考推断。',
        targetField: 'source_facts',
      })
    }
  }

  if (resolvedMode === 'event_announcement') {
    if (!timeOrLocationPattern.test(sourceStatements.join('\n'))) {
      missingFacts.push({
        id: 'event_time_location',
        label: '时间与地点',
        question: '事件在什么时间、什么地点发生？线上活动请补充入口或平台。',
        reason: '时间地点缺失时，事件通知无法承担实际到场或参与任务。',
        targetField: 'source_facts',
      })
    }
    if (!participationPattern.test(sourceStatements.join('\n'))) {
      missingFacts.push({
        id: 'event_action',
        label: '到场或参与方式',
        question: '读者需要报名、预约、到店，还是直接前往？',
        reason: '行动方式必须明确，不能用模糊号召代替流程。',
        targetField: 'source_facts',
      })
    }
  }

  if (missingFacts.length === 0) return null

  const modeLabel =
    resolvedMode === 'product_education'
      ? '产品说明'
      : resolvedMode === 'campaign_interaction'
        ? '活动文案'
        : '事件通知'

  return {
    summary: `这篇${modeLabel}还缺少支撑正文的关键信息，补充后再生成会更准确。`,
    missingFacts: missingFacts.slice(0, 3),
    confirmedFacts: concreteFacts.slice(0, 6),
    canGenerateConservative:
      topicStatement.length >= 4 && concreteFacts.length > 0,
  }
}

export function compactDraftSkillInput(input: DraftSkillInput) {
  const contentMode = resolveDraftContentMode(input)
  const compatibleReferenceIdSet = new Set(contentMode.compatibleReferenceIds)
  const compatibleNotes = input.notes.filter((note) =>
    compatibleReferenceIdSet.has(note.id),
  )
  const compatibleNoteUrls = new Set(
    compatibleNotes.map((note) => note.sourceUrl),
  )
  const compatibleNoteTitles = new Set(
    compatibleNotes.map((note) => note.title),
  )
  const compatibleSnippets = contentMode.usesLegacyFallback
    ? input.snippets
    : input.snippets.filter(
        (snippet) =>
          compatibleNoteUrls.has(snippet.noteUrl) ||
          compatibleNoteTitles.has(snippet.noteTitle),
      )

  return {
    projectName: input.projectName,
    topic: input.topic,
    targetAudience: input.targetAudience,
    length: input.length,
    outputRequirements: getDraftOutputRequirements(input.length, input),
    brief: input.brief,
    contentMode,
    writingProfile: {
      account: compactActiveWritingProfile(
        input.writingProfileContext?.accountProfile,
        contentMode.usesLegacyFallback ? 'unclassified' : contentMode.resolvedMode,
      ),
      project: compactActiveWritingProfile(
        input.writingProfileContext?.projectProfile,
        contentMode.usesLegacyFallback ? 'unclassified' : contentMode.resolvedMode,
      ),
    },
    analysis: {
      userPreference: input.analysis.userPreference,
      avoidPitfall: contentMode.analysisModeMatches
        ? input.analysis.avoidPitfall
        : '不要迁移与当前内容模式不一致的结构、互动任务或信息顺序',
      surfaceStyle: contentMode.analysisModeMatches
        ? input.analysis.surfaceStyle
        : neutralModeMismatchSurfaceStyle,
    },
    referenceLearning: {
      noteCount: compatibleNotes.length,
      totalNoteCount: input.notes.length,
      labels: Array.from(
        new Set(
          compatibleSnippets
            .map((snippet) => snippet.colorTagName.trim())
            .filter(Boolean),
        ),
      ).slice(0, 12),
    },
    referenceUsagePolicy: {
      purpose: '参考用于提炼信息组织、句子节奏和判断位置，不是可拼接的句子素材库',
      verbatimRule: `除项目名和选题中的明确固定表达外，不得与任一参考正文连续重合 ${minimumReferenceOverlapCharacters} 个及以上字符，也不得完整照抄标注中的短分句；brief.mustInclude 默认是必须表达的事实，不是必须照抄的句子`,
      selectionRule: '不要求用完所有高亮；每个段落只保留能推进当前信息主线的机制',
    },
  }
}

export const draftRepairSystemPrompt = [
  '你是 Lumos AI Writer 的小红书草稿约束修复器。',
  '输入是一版内容方向正确、但长度、参考复用、元信息泄漏或事实边界未达标的候选草稿。你只能修复明确列出的约束问题，不能改写成另一篇文章。',
  '保留候选草稿的标题方向、事实、时间顺序、核心判断和 brief.mustInclude 要求的信息；brief.mustInclude 默认不是必须照抄的句子。brief.facts 中 required=true 的事实必须保留，required=false 的事实只有在直接推进 mustInclude 主线时才可使用，不能为了补字数另起一条信息线；任何已使用事实的主体、关系、先后顺序、时间和状态都不得改变。只有标题超限时才压缩标题，并继续遵守 brief.avoidTone。',
  '需要增加字数时，只能展开候选草稿已经支持的动作、场景、判断及其因果关系，不得新增经历、数据、地点、产品或效果。',
  'referenceReuseIssues 非空时，必须删除其中逐字重合的表达，只保留 brief 和 topic 支持的事实，以及参考背后的写作机制；不要在原句附近做同义词替换式仿写。',
  'bannedVerbatimPhrases 中每一项都是最终 JSON 里不得再次出现的禁用字串，必须逐项做字面检查。若禁用字串位于结尾，可以重写整个收束句；当输入没有支持情绪或动作时，直接停在最后一条事实。',
  'metadataLeakageIssues 非空时，删除制作过程词，不得在成稿中提及封面、配图、输入、brief、参考、标注、事实清单或写作要求。只写这些载体承载的产品与事件事实。',
  'groundingIssues 非空时，逐项删除 contradicted 和 unknown 断言，或仅用 topic、brief.sourceFacts、brief.mustInclude 与 brief.facts 已支持的信息改写。bannedGroundingPhrases 中每一项都不得再次逐字出现。不得为了让句子完整而发明替代事实，也不得把未知改写成明确否定。',
  '若 groundingIssue 所在句主要来自 required=false 的可选背景，删除整句或整段，不要尝试换一种修辞保留。可选事实不值得消耗修复次数，也不能压过 required=true 的主线。',
  '不要为了保留所有参考亮点而拼接句子。选择一条信息主线，每段只推进一个新信息，同一品牌母题只表达一次。',
  'required=true 只要求语义覆盖，不要求逐条成句或展开解释。input.outputRequirements.brevityMode=ultra_short 时优先压成一个完整句子；删掉问题铺垫、泛化关怀和总结，只保留主体、关系与一个有依据的判断。',
  'input.outputRequirements.brevityMode=sparse_short 时同样允许一句话结束。若产品名、功能或机制缺失，删除不推进必写主线的视觉构图、标签可读性和氛围描述，不用抽象关怀补位；只保留 topic 与 required facts 能确认的关系。',
  '若删除 groundingIssues 后，全部 required facts 已被 topic 本身覆盖，可以用一句对 topic 的直接重述作为正文，不必保留任何 optional fact。重复一条已确认信息优于创造一条新信息。',
  '优先写到 input.outputRequirements.repairTargetBodyCharacters 附近，同时严格落在最小和最大段落数、正文字数范围内。',
  '修复后在内部按 input.outputRequirements.countingRule 和 referenceUsagePolicy 复核；不达标时继续调整，直到达标。',
  '只输出一个 JSON object，不要 Markdown、代码块、解释或思考过程。',
  'JSON 字段严格为 title:string 和 body:string[]。',
].join('\n')

export const draftRepairUserPromptTemplate =
  'JSON.stringify({ task: "repair_draft_contract", input: { candidateDraft, actual, outputRequirements, brief, topic, targetAudience } })'

export function buildDraftRepairUserPrompt(
  input: GenerateDraftRequest,
  candidateDraft: AiDraftCopy,
  groundingIssues: DraftGroundingIssue[] = [],
) {
  const requirements = getDraftOutputRequirements(input.length, input)
  const preferredCharactersPerParagraph = Math.ceil(
    (requirements.preferredCharactersPerParagraph.min +
      requirements.preferredCharactersPerParagraph.max) /
    2,
  )
  const referenceReuseIssues = findReferenceReuseIssues(candidateDraft, input)
  const metadataLeakageIssues = findDraftMetaLanguageIssues(candidateDraft, input)

  return JSON.stringify({
    task: 'repair_draft_contract',
    input: {
      candidateDraft,
      actual: {
        paragraphs: candidateDraft.body.length,
        bodyCharacters: Array.from(
          candidateDraft.body.join('').replace(/\s/g, ''),
        ).length,
      },
      outputRequirements: {
        ...requirements,
        repairTargetBodyCharacters:
          requirements.preferredParagraphs * preferredCharactersPerParagraph,
      },
      referenceUsagePolicy: {
        longReferenceOverlapCharacters: minimumReferenceOverlapCharacters,
        instruction: '消除未被明确要求的连续重合和标注短分句复用，保留事实，不保留参考原句',
      },
      referenceReuseIssues,
      bannedVerbatimPhrases: referenceReuseIssues.map(
        (issue) => issue.overlap,
      ),
      metadataLeakageIssues,
      bannedMetaLanguagePhrases: metadataLeakageIssues.map(
        (issue) => issue.phrase,
      ),
      groundingIssues,
      bannedGroundingPhrases: groundingIssues.map((issue) => issue.quote),
      brief: input.brief,
      topic: input.topic,
      targetAudience: input.targetAudience,
    },
  })
}

export function validateDraftSkillOutput(
  draft: AiDraftCopy,
  length: GenerateDraftRequest['length'],
  input?: GenerateDraftRequest,
) {
  const requirements = getDraftOutputRequirements(length, input)
  return aiDraftCopySchema
    .superRefine((value, context) => {
      const titleLength = Array.from(value.title).length
      const bodyCharacterCount = Array.from(value.body.join('').replace(/\s/g, '')).length

      if (titleLength > 35) {
        context.addIssue({
          code: 'custom',
          path: ['title'],
          message: 'Draft title must not exceed 35 characters.',
        })
      }

      if (
        value.body.length < requirements.minParagraphs ||
        value.body.length > requirements.maxParagraphs
      ) {
        context.addIssue({
          code: 'custom',
          path: ['body'],
          message: `Draft must contain ${requirements.minParagraphs}-${requirements.maxParagraphs} paragraphs for ${length} length; received ${value.body.length}.`,
        })
      }

      if (
        bodyCharacterCount < requirements.minBodyCharacters ||
        bodyCharacterCount > requirements.maxBodyCharacters
      ) {
        context.addIssue({
          code: 'custom',
          path: ['body'],
          message: `Draft must contain ${requirements.minBodyCharacters}-${requirements.maxBodyCharacters} characters for ${length} length; received ${bodyCharacterCount}.`,
        })
      }

      if (input) {
        for (const issue of findReferenceReuseIssues(value, input)) {
          context.addIssue({
            code: 'custom',
            path: ['body'],
            message: `Draft reuses ${issue.characters} continuous characters from reference "${issue.sourceTitle}": ${issue.overlap}`,
          })
        }

        for (const issue of findDraftMetaLanguageIssues(value, input)) {
          context.addIssue({
            code: 'custom',
            path: ['body'],
            message: `Draft leaks writing metadata into reader-facing copy: ${issue.phrase}`,
          })
        }
      }
    })
    .parse(draft)
}

const draftSystemPrompt = [
  '你是 Lumos AI Writer 的小红书初稿生成 Skill。',
  '目标是依据用户选题、目标读者、明确要求和已完成的学习拆解，生成一版可以继续编辑的中文初稿。',
  '指令优先级：brief.facts > brief.mustInclude、brief.avoidTone 与 brief.contentMode > contentMode.modeSpecificGuidance > project writingProfile > account writingProfile > analysis.userPreference、analysis.avoidPitfall 与 analysis.surfaceStyle > referenceLearning.labels。',
  'writingProfile 是对用户长期写作方式的证据化总结。高置信度偏好优先应用；低置信度偏好只能轻量尝试，不能压过当前明确要求。',
  'writingProfile.preferences.application 同时描述执行方式和适用条件。账号级偏好不等于跨内容模式通用：只应用与 contentMode.resolvedMode 和当前 brief 条件相符的偏好；其他模式的账号自称、互动动作、句长、分行、双关或结尾习惯必须忽略。',
  '参考是证据，不是句子仓库。参考文案只提供写作机制和可核实的背景事实，不提供可直接挪用的个人经历、产品事实、数据或句子。',
  '当前目标稿的事实只能来自 topic 和 brief。参考笔记中的产品、地点、历史、材质、陈设和动作都不自动属于当前目标；analysis 只用于语气、判断位置和避坑，不得覆盖 brief 的事实边界。',
  '输入里的封面、配图、图片、参考、标注、brief、事实清单和目标读者等字段名只是写作材料的来源说明，不是面向读者的内容。除非 topic 本身明确以这些对象为主题，成稿不得提及这些制作过程词，只能写其承载的事实。',
  'brief.facts 是原子事实清单。required=true 的事实必须在正文中得到语义保真的表达；required=false 是可用背景，只有在直接推进 brief.mustInclude 主线时才使用，不得为增加字数、显得具体或另起一条产品线而加入。任何被使用的事实都不得合并步骤、倒置因果、改变先后、扩大范围或把“已发生/进行中/将发生”互换。写完后逐条核对 required fact id。',
  'required=true 表示语义必须覆盖，不表示每条事实都要单独成句、解释或展开。允许把主体、组合关系和一个有依据的判断压进同一句；事实已覆盖后立即停止。产品名称中的功效词只属于名称，不能当作可展开的效果证据；“配合使用”不自动提供使用顺序、协同机制、程度提升或具体效果。',
  'referenceLearning 只提供参考证据数量和用户标签概览，不是本篇必须逐项体现的内容清单。',
  'contentMode.resolvedMode 是当前成稿的内容任务。brief.contentMode 非 auto 时优先；auto 会先根据 brief 中的参与动作、活动流程、产品说明或品牌叙事信号推断，再回退到分析阶段判断。analysisModeMatches=false 表示完整 brief 改变了早期目标模式，必须忽略旧目标的模式指南和 surfaceStyle；系统会按每篇参考自己的主模式重新筛选，referenceLearning 中只保留与 resolvedMode 相同的参考。',
  'contentMode.stableVoiceSignals 是经过分析确认的账号级表达习惯，只能控制自称、读者称呼、句长、标点和情绪上限。若其中包含明确且一致的账号自称或读者称呼，且不与 brief 冲突，优先在自然位置使用一次；不得把其中的产品、事件、场景或动作当作当前事实。',
  '内容模式边界：brand_story 以关系和判断为主，不强加参与任务；product_education 以问题、功能或动作和体验为主；campaign_interaction 必须让事件、参与主体、参与动作和奖励路径清楚；event_announcement 优先时间地点与流程；social_moment 只保留一个共同瞬间或轻量问题。不得把这些模式平均混合。',
  'contentMode.modeSpecificGuidance 控制本篇的信息优先级、互动方式和禁止迁移项。referenceLearning.noteCount=0 时代表没有同模式参考，不得为了模仿账号而补写模式专属句式。',
  'analysis.surfaceStyle 只控制句长节奏、段落与软换行、标点、情绪强度和互动位置。它不能提供或暗示任何事实；其中若出现具体对象或动作，一律忽略。',
  `除项目名和 topic 中的明确固定表达外，正文不得与任一参考文案连续逐字重合 ${minimumReferenceOverlapCharacters} 个及以上字符，也不得完整照抄标注中的短分句。brief.mustInclude 默认是必须表达的事实，不是必须照抄的句子；不要把高亮片段换几个近义词后继续沿用。`,
  '先把输入分成三类：当前 brief 明确要求的事实、analysis 与标注理由提供的写作机制、只属于参考原文的措辞。先确定一条能用一句话说清的信息主线，再开始写。',
  '不要求体现全部标签。严禁为了表现风格而补写 brief 未提供的物象或动作；每段必须推进一个新信息，同一品牌主张或情绪母题只表达一次。',
  '事实稀少时不要把视觉素材的构图、遮挡、标签可读性、静止状态或氛围当作产品信息。required=false 的视觉事实只有在 brief 明确要求画面叙事、且它直接推进主线时才使用；否则用 topic 与 required facts 写一句后停止。',
  '输入没有给出产品功效时，不要在成稿里解释“功效未知、标签看不清、难以辨认、等待探索或揭晓”；这些是写作材料的缺口，不是读者需要接收的产品信息。季节事实只能写季节本身，不能自动推出肌肤不适、焦虑、需求或护理结论。',
  '当 brevityMode=sparse_short 且 required facts 都已由 topic 覆盖时，正文可以只直接重述 topic 的已知关系并结束；不要为了避免标题与正文接近而加入 optional 画面、读者心理或产品判断。',
  '克制不等于反复使用柔软、天然、安静等轻柔意象。克制首先来自事实清楚、判断后置、修辞有实物依据，以及在信息说完时停止。',
  '只有 topic 或 brief 明确支持时才使用第一人称经历；不得把参考作者的经历写成用户经历。',
  'brief.mustInclude 非空时必须自然包含其中的信息，brief.avoidTone 非空时必须视为硬性禁用语气。',
  '标题必须具体、克制且与正文一致，不超过 35 个汉字，不用夸张承诺或无依据的数字。',
  'body 每个数组元素必须是一个完整段落，段落之间要有清晰推进，不写提纲标签或段落功能说明。',
  '当 analysis.surfaceStyle.paragraphShape 明确要求逐行节奏时，优先在一个 body 字符串内部使用换行符组织多个短行；保留这些软换行，每一行仍须推进事实、动作或问题，不能只为整齐而断行。',
  '长度规则必须按 input.length 执行：',
  `short：通常必须 ${draftLengthPolicies.short.minParagraphs}-${draftLengthPolicies.short.maxParagraphs} 段、${draftLengthPolicies.short.minCharacters}-${draftLengthPolicies.short.maxCharacters} 字；事实稀少时 brevityMode=sparse_short，允许 12-96 字、优先 1 段；brief 明确要求极短、单句或一行配文时 brevityMode=ultra_short，允许 12-72 字、优先 1 段。所有情况都必须以本次 outputRequirements 为准。`,
  `medium：必须 ${draftLengthPolicies.medium.minParagraphs}-${draftLengthPolicies.medium.maxParagraphs} 段、${draftLengthPolicies.medium.minCharacters}-${draftLengthPolicies.medium.maxCharacters} 字；优先写 ${draftLengthPolicies.medium.preferredParagraphs} 段，每段 ${draftLengthPolicies.medium.preferredMinCharactersPerParagraph}-${draftLengthPolicies.medium.preferredMaxCharactersPerParagraph} 字。`,
  `long：必须 ${draftLengthPolicies.long.minParagraphs}-${draftLengthPolicies.long.maxParagraphs} 段、${draftLengthPolicies.long.minCharacters}-${draftLengthPolicies.long.maxCharacters} 字；优先写 ${draftLengthPolicies.long.preferredParagraphs} 段，每段 ${draftLengthPolicies.long.preferredMinCharactersPerParagraph}-${draftLengthPolicies.long.preferredMaxCharactersPerParagraph} 字。`,
  'input.outputRequirements 是本次输出的硬约束。先按 preferredParagraphs 和 preferredCharactersPerParagraph 写足内容，再核对段落数与去除空白后的正文总字数；不足时补充具体场景、动作或判断，不得用空话凑字，满足后才能输出最终 JSON。',
  '默认不用 emoji；确有语气需要时整篇最多 2 个。结尾可以互动，但不能强行要求点赞、收藏或关注。',
  '去 AI 味规则：',
  ...humanChineseCopyRulesV1.map((rule, index) => `${index + 1}. ${rule}`),
  '只输出一个 JSON object，不要 Markdown，不要代码块，不要解释或思考过程。',
  'JSON 字段必须严格匹配：',
  JSON.stringify(outputContract),
].join('\n')

export const draftSkillV1: AiSkillDefinition<
  DraftSkillInput,
  AiDraftCopy
> = {
  id: 'xiaohongshu-draft',
  version: '1.9.1',
  taskType: 'draft',
  model: 'deepseek-v4-flash',
  maxTokens: 2600,
  temperature: 0.45,
  systemPrompt: draftSystemPrompt,
  userPromptTemplate:
    'JSON.stringify({ task: "generate_xiaohongshu_draft", input: compactDraftSkillInput(input) })',
  supplementaryPromptTemplates: [
    draftRepairSystemPrompt,
    draftRepairUserPromptTemplate,
    draftGroundingAuditSystemPrompt,
    draftGroundingAuditUserPromptTemplate,
  ],
  buildUserPrompt: (input) =>
    JSON.stringify({
      task: 'generate_xiaohongshu_draft',
      input: compactDraftSkillInput(input),
    }),
  outputSchema: aiDraftCopySchema,
}
