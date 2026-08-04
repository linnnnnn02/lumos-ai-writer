import {
  aiAnalysisResultSchema,
  type AiAnalysisResult,
  type AnalyzeReferencesRequest,
} from '@lumos-ai/shared'
import type { AiSkillDefinition } from '../runtime.js'
import { antiAiWritingRulesV1 } from '../shared/anti-ai-writing-rules-v1.js'

const outputContract = {
  projectName: 'string',
  aiLearningMethod: {
    writingPath: 'string',
    reusableMechanisms: ['string', 'string', 'string'],
    styleConstraints: ['string', 'string'],
  },
  contentMode: {
    targetMode:
      'brand_story | product_education | campaign_interaction | event_announcement | social_moment | other',
    confidence: 'high | medium | low',
    rationale: '只依据当前 topic 和 targetAudience 的分类理由',
    referenceModes: [
      {
        noteId: 'input.notes[].id',
        mode: '该参考自己的主内容模式',
        compatibility: 'compatible | stable_voice_only | excluded',
        reason: '与目标模式的关系',
      },
    ],
    compatibleReferenceIds: ['与当前内容模式兼容的 note id'],
    excludedReferences: [
      { noteId: '不兼容的 note id', reason: '不迁移其模式专属机制的原因' },
    ],
    stableVoiceSignals: ['跨内容模式仍稳定的账号表达特征'],
    modeSpecificGuidance: {
      informationPriority: '当前模式的信息优先级',
      interactionPattern: '当前模式允许的互动方式',
      styleBoundary: '必须阻止迁移的其他模式写法',
    },
  },
  surfaceStyle: {
    sentenceRhythm: '只描述长短句比例、句长变化和节奏',
    paragraphShape: '只描述段落密度、软换行和信息分行方式',
    punctuation: '只描述标点与中英文符号习惯',
    emotionalIntensity: '只描述情绪强度及变化',
    interactionStyle: '只描述提问或互动出现的位置和方式',
  },
  coreJudgement: 'string',
  evidence: 'string',
  effectivePatterns: ['开头策略', '中段策略', '收尾策略'],
  featuredSnippets: [
    {
      quote: '被引用的原文片段',
      noteTitle: '来源标题',
      noteUrl: '来源链接',
      label: '选择点处理',
      description: '这个片段可复用的机制',
      reason: '用户标注理由',
    },
  ],
  userPreference: 'string',
  reuseSuggestion: 'string',
  avoidPitfall: 'string',
  preferenceQuestion: 'string',
  writingMove: 'string',
  summary: 'string',
  wording: ['string', 'string'],
  structure: ['string', 'string'],
  preference: ['string', 'string'],
  readerView: ['string', 'string'],
  nextStep: ['string', 'string'],
}

function trimText(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

export function compactAnalysisSkillInput(input: AnalyzeReferencesRequest) {
  const noteIdByUrl = new Map(
    input.notes.map((note) => [note.sourceUrl, note.id]),
  )

  return {
    projectName: input.projectName,
    folderName: input.folderName,
    topic: input.topic,
    targetAudience: input.targetAudience,
    length: input.length,
    notes: input.notes.slice(0, 8).map((note) => ({
      id: note.id,
      title: note.title,
      filename: note.filename,
      authorName: note.authorName,
      sourceUrl: note.sourceUrl,
      folderName: note.folderName,
      contentText: trimText(note.contentText, 1200),
    })),
    snippets: input.snippets.slice(0, 24).map((snippet) => ({
      noteId: noteIdByUrl.get(snippet.noteUrl) ?? null,
      noteTitle: snippet.noteTitle,
      noteUrl: snippet.noteUrl,
      selectedText: trimText(snippet.selectedText, 600),
      reasonText: trimText(snippet.reasonText, 400),
      colorTagName: snippet.colorTagName,
    })),
  }
}

const neutralSurfaceStyle = {
  sentenceRhythm: '句长服从当前信息密度，不迁移其他内容模式的节奏',
  paragraphShape: '按当前任务的信息顺序分段，不迁移其他内容模式的版式',
  punctuation: '使用自然中文标点，以当前任务可读性为准',
  emotionalIntensity: '情绪强度服从当前内容模式和明确 brief',
  interactionStyle: '仅在当前内容模式需要时安排互动',
}

const contentModeFallbacks = {
  brand_story: {
    label: '品牌叙事',
    informationPriority: '先给具体关系或判断，再用已知事实支撑，最后自然收束',
    interactionPattern: '默认不设置参与任务，确有需要时只做轻量回应',
    styleBoundary: '不迁移抽奖步骤、产品参数或活动流程',
    patterns: [
      '开头：给出当前主题支持的具体关系或判断',
      '中段：只用已提供事实支撑，不补品牌历史或价值',
      '收尾：信息说完即停，不强加互动任务',
    ],
  },
  product_education: {
    label: '产品说明',
    informationPriority: '先交代使用问题，再写已提供的功能或动作，随后落到可核实体验',
    interactionPattern: '互动围绕真实使用问题，不设置无关参与任务',
    styleBoundary: '不迁移品牌宣言、抽奖流程或活动口号',
    patterns: [
      '开头：交代当前 brief 中的使用问题',
      '中段：按事实顺序写功能、动作或条件',
      '收尾：回到可核实体验，不扩大产品效果',
    ],
  },
  campaign_interaction: {
    label: '活动互动',
    informationPriority: '优先写事件、参与主体、参与动作、奖励或结果顺序',
    interactionPattern: '问题直接连接参与动作，参与路径只出现一次',
    styleBoundary: '不套用产品说明结构，也不把活动信息藏在氛围段落后',
    patterns: [
      '开头：交代事件与当前时间或状态',
      '中段：写清参与主体和参与动作',
      '收尾：交代奖励或结果，不重复号召',
    ],
  },
  event_announcement: {
    label: '事件通知',
    informationPriority: '优先写事件、时间地点、对象、流程和到场方式',
    interactionPattern: '互动只服务确认、报名或到场',
    styleBoundary: '不迁移抽奖机制、产品参数或空泛品牌叙事',
    patterns: [
      '开头：直接交代发生什么',
      '中段：按时间地点和流程推进',
      '收尾：只保留必要的到场或确认动作',
    ],
  },
  social_moment: {
    label: '社交瞬间',
    informationPriority: '先写当前瞬间或共同处境，再推进一个已知状态',
    interactionPattern: '最多保留一个不预设答案的自然问题',
    styleBoundary: '不虚构活动规则、产品功效或宏大品牌判断',
    patterns: [
      '开头：点出当前瞬间或共同处境',
      '中段：只推进 topic 已支持的状态',
      '收尾：最多留下一个不预设答案的问题',
    ],
  },
  other: {
    label: '其他内容',
    informationPriority: '按当前 topic 的已知信息顺序推进',
    interactionPattern: '仅在当前任务明确需要时互动',
    styleBoundary: '不迁移与当前任务无关的参考结构',
    patterns: [
      '开头：先写当前任务最重要的已知信息',
      '中段：每段只增加一个事实或判断',
      '收尾：信息说完即停',
    ],
  },
} as const

export function normalizeAnalysisContentMode(
  analysis: AiAnalysisResult,
  input: AnalyzeReferencesRequest,
): AiAnalysisResult {
  if (analysis.contentMode.targetMode === 'unclassified') return analysis

  const validNoteIds = new Set(input.notes.map((note) => note.id))
  const normalizedReferenceModes = Array.from(
    new Map(
      analysis.contentMode.referenceModes
        .filter((reference) => validNoteIds.has(reference.noteId))
        .map((reference) => {
          const hasSameMode = reference.mode === analysis.contentMode.targetMode
          return [
            reference.noteId,
            {
              ...reference,
              compatibility:
                hasSameMode && reference.compatibility === 'compatible'
                  ? ('compatible' as const)
                  : reference.compatibility === 'excluded'
                    ? ('excluded' as const)
                    : ('stable_voice_only' as const),
            },
          ]
        }),
    ).values(),
  )
  const compatibleIdsFromModes = normalizedReferenceModes
    .filter((reference) => reference.compatibility === 'compatible')
    .map((reference) => reference.noteId)
  const requestedCompatibleIds =
    normalizedReferenceModes.length > 0
      ? compatibleIdsFromModes
      : analysis.contentMode.compatibleReferenceIds
  const compatibleReferenceIds = Array.from(
    new Set(
      requestedCompatibleIds.filter((id) =>
        validNoteIds.has(id),
      ),
    ),
  )
  const compatibleIdSet = new Set(compatibleReferenceIds)
  const excludedById = new Map(
    [
      ...analysis.contentMode.excludedReferences,
      ...normalizedReferenceModes
        .filter((reference) => reference.compatibility !== 'compatible')
        .map((reference) => ({
          noteId: reference.noteId,
          reason: reference.reason,
        })),
    ]
      .filter(
        (reference) =>
          validNoteIds.has(reference.noteId) &&
          !compatibleIdSet.has(reference.noteId),
      )
      .map((reference) => [reference.noteId, reference]),
  )

  for (const note of input.notes) {
    if (!compatibleIdSet.has(note.id) && !excludedById.has(note.id)) {
      excludedById.set(note.id, {
        noteId: note.id,
        reason: '未被选为当前内容模式的兼容参考',
      })
    }
  }

  const compatibleUrls = new Set(
    input.notes
      .filter((note) => compatibleIdSet.has(note.id))
      .map((note) => note.sourceUrl),
  )
  const fallback = contentModeFallbacks[analysis.contentMode.targetMode]
  const hasCompatibleReferences = compatibleReferenceIds.length > 0
  const distinctReferenceModes = new Set(
    normalizedReferenceModes.map((reference) => reference.mode),
  )
  const stableVoiceSignals =
    distinctReferenceModes.size >= 2
      ? analysis.contentMode.stableVoiceSignals
      : []
  const fallbackEvidence = `未找到与${fallback.label}同模式的参考；当前只保留跨模式稳定语气，结构以 topic 和后续 brief 为准。`
  const normalizedContentMode = {
    ...analysis.contentMode,
    referenceModes: normalizedReferenceModes,
    compatibleReferenceIds,
    excludedReferences: Array.from(excludedById.values()),
    stableVoiceSignals,
    modeSpecificGuidance: hasCompatibleReferences
      ? analysis.contentMode.modeSpecificGuidance
      : {
          informationPriority: fallback.informationPriority,
          interactionPattern: fallback.interactionPattern,
          styleBoundary: fallback.styleBoundary,
        },
  }

  return {
    ...analysis,
    contentMode: normalizedContentMode,
    aiLearningMethod: hasCompatibleReferences
      ? analysis.aiLearningMethod
      : {
          writingPath: fallback.informationPriority,
          reusableMechanisms: [
            fallback.informationPriority,
            fallback.interactionPattern,
            '每段只推进 topic 或 brief 已支持的信息',
          ],
          styleConstraints: [
            fallback.styleBoundary,
            '没有同模式参考时不模仿其他模式的结构和任务',
          ],
        },
    surfaceStyle:
      hasCompatibleReferences
        ? analysis.surfaceStyle
        : neutralSurfaceStyle,
    coreJudgement: hasCompatibleReferences
      ? analysis.coreJudgement
      : fallback.informationPriority,
    evidence: hasCompatibleReferences ? analysis.evidence : fallbackEvidence,
    effectivePatterns: hasCompatibleReferences
      ? analysis.effectivePatterns
      : [...fallback.patterns],
    featuredSnippets: analysis.featuredSnippets.filter((snippet) =>
      compatibleUrls.has(snippet.noteUrl),
    ),
    userPreference: hasCompatibleReferences
      ? analysis.userPreference
      : stableVoiceSignals.length > 0
        ? `目前仅确认跨模式信号：${stableVoiceSignals.join('、')}；其他偏好待同模式证据验证。`
        : '当前没有同模式参考，账号偏好待验证。',
    reuseSuggestion: hasCompatibleReferences
      ? analysis.reuseSuggestion
      : fallback.informationPriority,
    avoidPitfall: hasCompatibleReferences
      ? analysis.avoidPitfall
      : fallback.styleBoundary,
    preferenceQuestion: hasCompatibleReferences
      ? analysis.preferenceQuestion
      : `是否补充一至两篇${fallback.label}参考，用于验证当前模式的节奏和互动方式？`,
    writingMove: hasCompatibleReferences
      ? analysis.writingMove
      : `${fallback.informationPriority}；${fallback.interactionPattern}。`,
    summary: hasCompatibleReferences ? analysis.summary : fallbackEvidence,
    wording: hasCompatibleReferences
      ? analysis.wording
      : stableVoiceSignals.slice(0, 4).length > 0
        ? stableVoiceSignals.slice(0, 4)
        : ['使用 topic 和 brief 中的具体词'],
    structure: hasCompatibleReferences
      ? analysis.structure
      : [fallback.informationPriority, fallback.interactionPattern],
    preference: hasCompatibleReferences
      ? analysis.preference
      : stableVoiceSignals.slice(0, 4).length > 0
        ? stableVoiceSignals.slice(0, 4)
        : ['当前模式偏好待验证'],
    readerView: hasCompatibleReferences
      ? analysis.readerView
      : [input.targetAudience],
    nextStep: hasCompatibleReferences
      ? analysis.nextStep
      : [
          '先按当前 topic 写事实主线',
          `补充${fallback.label}同模式参考后再学习模式专属表达`,
        ],
  }
}

const analysisSystemPrompt = [
  '你是 Lumos AI Writer 的参考文案分析 Skill。',
  '目标不是总结原文，而是从用户主动选择的文案、标注片段、理由和颜色标签中提炼下一篇可执行的写作机制。',
  '证据优先级：用户理由 > 用户标签 > 用户选中片段 > 整篇参考文案。',
  '开始分析前必须先完成 contentMode。内容模式定义：brand_story=品牌观点与关系叙事；product_education=产品功能、用法、体验或知识说明；campaign_interaction=抽奖、竞猜、征集、联名互动或明确参与动作；event_announcement=门店、展览、快闪或活动时间地点与流程通知；social_moment=热点、日常瞬间或轻量账号互动；other=以上均不适用。不要输出 unclassified。',
  'targetMode 只能依据 input.topic 和 input.targetAudience 判断，不能因为参考文案多数属于某模式就把目标也分到该模式。证据不足时选择最接近的模式并降低 confidence。',
  '逐篇输出 referenceModes，先判断这篇参考自己的主模式，再判断与 targetMode 的关系。只有参考主模式与 targetMode 完全相同，compatibility 才能是 compatible；跨模式但句长、称呼或标点可借鉴时标为 stable_voice_only，其余标为 excluded。',
  'compatibleReferenceIds 必须等于 referenceModes 中 compatibility=compatible 的 noteId，逐字使用 input.notes[].id；每篇参考必须出现且只能出现一次，不能编造 id。内容主题相似、都写日常或来自同一品牌都不代表模式兼容，产品说明不能因为同一品牌就指导抽奖活动的结构。',
  'stableVoiceSignals 只能写跨模式仍稳定的账号特征，如称呼、句长倾向、标点或情绪上限；每条信号必须在至少两篇参考中重复出现，并且证据覆盖至少两种不同的 referenceModes.mode。只在单篇或单一模式出现的“你”、短句、分行、拟人或互动方式不是稳定账号信号，必须省略。不得混入某篇参考的产品、场景、活动机制或事实。modeSpecificGuidance 只能依据兼容参考和当前模式生成。',
  'input.topic 和 input.targetAudience 是下一篇内容的唯一事实边界。若其中没有产品、功能、身体感受、活动或品牌态度，aiLearningMethod、coreJudgement、effectivePatterns、reuseSuggestion、writingMove 和 nextStep 都不得建议加入这些内容，即使参考里反复出现。',
  '只输出一个 JSON object，不要 Markdown，不要代码块，不要额外解释。',
  '必须使用中文，所有判断都要具体、短、可执行。',
  'coreJudgement 必须结论前置，以动词加结果或判断开头，不写分析过程。',
  'effectivePatterns 至少 3 条，严格按开头、中段、收尾排序。',
  'featuredSnippets 最多 2 个，只能逐字引用兼容参考对应的 input.snippets 片段，并保留来源；没有兼容片段时返回空数组。',
  'featuredSnippets 仅用于证据追溯。除 featuredSnippets.quote 外，所有字段必须把原句转成写作机制，不能连续复述 input 中 12 个及以上字符，也不能暗示下一篇直接套用该句。',
  '先从多篇参考中寻找当前主题的事实锚点和一条信息主线，再判断开头、中段、收尾如何服务这条主线；不要把每个高亮都列成下一篇必须使用的内容。',
  'effectivePatterns、reuseSuggestion、writingMove 和 nextStep 不得引用参考原句，也不得用“如/例如”补一条成句示例；只写动作、顺序和约束。',
  'input 未提供的材质、陈设、动作、人物和场景细节必须保持未知。关键词只能作为关键词使用，不能擅自解释成现场可见的物件或画面。',
  'surfaceStyle 是供草稿阶段使用的纯形式通道，只能从 compatibleReferenceIds 对应参考提炼；没有兼容参考时使用中性描述，不得从被排除参考迁移版式。五个字段只能描述句长、节奏、分段、软换行、标点、情绪强度和互动位置；不得出现品牌名、产品名、地点、人物、物象、动作示例、参考原句或下一篇的事实。',
  'paragraphShape 可以明确建议在一个 body 段落字符串内部使用换行符组织多个短行；不要把短行误写成没有信息推进的碎句。',
  'userPreference 只能依据用户理由、标签和多条一致证据提炼；证据不足时明确写成待验证偏好。',
  'reuseSuggestion 和 writingMove 必须能直接指导下一篇怎么写，但只能描述选材、信息顺序、句子功能和判断位置；不得提供成句示例、仿写模板或替换几个词后的参考句。avoidPitfall 必须指出一个具体风险。',
  '如果参考包含产品功效、历史、地点等多条事实，只有与 input.topic 当前主线直接相关的事实才能进入下一步建议；不要把参考文章自己的中段任务默认迁移到新主题。',
  '去 AI 味规则：',
  ...antiAiWritingRulesV1.map((rule, index) => `${index + 1}. ${rule}`),
  'JSON 字段必须严格匹配：',
  JSON.stringify(outputContract),
].join('\n')

export const analysisSkillV1: AiSkillDefinition<
  AnalyzeReferencesRequest,
  AiAnalysisResult
> = {
  id: 'reference-analysis',
  version: '1.3.2',
  taskType: 'analyze',
  model: 'deepseek-v4-flash',
  maxTokens: 2200,
  temperature: 0.35,
  systemPrompt: analysisSystemPrompt,
  userPromptTemplate:
    'JSON.stringify({ task: "analyze_reference_writing_patterns", input: compactAnalysisSkillInput(input) })',
  buildUserPrompt: (input) =>
    JSON.stringify({
      task: 'analyze_reference_writing_patterns',
      input: compactAnalysisSkillInput(input),
    }),
  outputSchema: aiAnalysisResultSchema,
}
