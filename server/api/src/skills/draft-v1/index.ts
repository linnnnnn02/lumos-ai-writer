import {
  aiDraftCopySchema,
  type AiDraftCopy,
  type GenerateDraftRequest,
  type WritingProfileRevisionDto,
} from '@lumos-ai/shared'
import type { AiSkillDefinition } from '../runtime.js'
import { antiAiWritingRulesV1 } from '../shared/anti-ai-writing-rules-v1.js'

export const draftLengthPolicies = {
  short: {
    minParagraphs: 3,
    maxParagraphs: 5,
    minCharacters: 120,
    maxCharacters: 220,
    preferredParagraphs: 4,
    preferredMinCharactersPerParagraph: 35,
    preferredMaxCharactersPerParagraph: 50,
  },
  medium: {
    minParagraphs: 5,
    maxParagraphs: 7,
    minCharacters: 300,
    maxCharacters: 520,
    preferredParagraphs: 6,
    preferredMinCharactersPerParagraph: 55,
    preferredMaxCharactersPerParagraph: 75,
  },
  long: {
    minParagraphs: 7,
    maxParagraphs: 10,
    minCharacters: 650,
    maxCharacters: 950,
    preferredParagraphs: 8,
    preferredMinCharactersPerParagraph: 85,
    preferredMaxCharactersPerParagraph: 105,
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
) {
  const lengthPolicy = draftLengthPolicies[length]
  return {
    maxTitleCharacters: 35,
    minParagraphs: lengthPolicy.minParagraphs,
    maxParagraphs: lengthPolicy.maxParagraphs,
    minBodyCharacters: lengthPolicy.minCharacters,
    maxBodyCharacters: lengthPolicy.maxCharacters,
    preferredParagraphs: lengthPolicy.preferredParagraphs,
    preferredCharactersPerParagraph: {
      min: lengthPolicy.preferredMinCharactersPerParagraph,
      max: lengthPolicy.preferredMaxCharactersPerParagraph,
    },
    countingRule: 'body 数组元素数量按段落计；body 全部字符串去除空白后按 Unicode 字符计数',
  }
}

const outputContract = {
  title: '一条不超过 35 个汉字的小红书标题',
  body: ['完整正文段落；实际数组长度必须严格满足 input.outputRequirements'],
}

function trimText(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function compactProfile(revision: WritingProfileRevisionDto | null | undefined) {
  if (!revision) return null
  return {
    version: revision.version,
    summary: revision.profile.summary,
    decisionPrinciples: revision.profile.decisionPrinciples,
    contentPatterns: revision.profile.contentPatterns,
    structurePatterns: revision.profile.structurePatterns,
    voicePatterns: revision.profile.voicePatterns,
    readerRelationship: revision.profile.readerRelationship,
    mustKeep: revision.profile.mustKeep,
    mustAvoid: revision.profile.mustAvoid,
    preferences: revision.profile.preferences.map((preference) => ({
      dimension: preference.dimension,
      statement: preference.statement,
      application: preference.application,
      avoid: preference.avoid,
      confidence: preference.confidence,
    })),
  }
}

export function compactDraftSkillInput(input: DraftSkillInput) {
  return {
    projectName: input.projectName,
    topic: input.topic,
    targetAudience: input.targetAudience,
    length: input.length,
    outputRequirements: getDraftOutputRequirements(input.length),
    brief: input.brief,
    writingProfile: {
      account: compactProfile(input.writingProfileContext?.accountProfile),
      project: compactProfile(input.writingProfileContext?.projectProfile),
    },
    analysis: {
      writingPath: input.analysis.aiLearningMethod.writingPath,
      reusableMechanisms: input.analysis.aiLearningMethod.reusableMechanisms,
      styleConstraints: input.analysis.aiLearningMethod.styleConstraints,
      coreJudgement: input.analysis.coreJudgement,
      effectivePatterns: input.analysis.effectivePatterns,
      userPreference: input.analysis.userPreference,
      reuseSuggestion: input.analysis.reuseSuggestion,
      avoidPitfall: input.analysis.avoidPitfall,
      writingMove: input.analysis.writingMove,
    },
    notes: input.notes.slice(0, 6).map((note) => ({
      title: note.title,
      authorName: note.authorName,
      contentText: trimText(note.contentText, 900),
    })),
    snippets: input.snippets.slice(0, 16).map((snippet) => ({
      selectedText: trimText(snippet.selectedText, 500),
      reasonText: trimText(snippet.reasonText, 300),
      colorTagName: snippet.colorTagName,
    })),
  }
}

export const draftRepairSystemPrompt = [
  '你是 Lumos AI Writer 的小红书草稿约束修复器。',
  '输入是一版内容方向正确但段落数或字数未达硬约束的候选草稿。你只能修复长度和段落完整性，不能改写成另一篇文章。',
  '保留候选草稿的标题方向、事实、时间顺序、核心判断和 brief.mustInclude；只有标题超限时才压缩标题，并继续遵守 brief.avoidTone。',
  '需要增加字数时，只能展开候选草稿已经支持的动作、场景、判断及其因果关系，不得新增经历、数据、地点、产品或效果。',
  '优先写到 input.outputRequirements.repairTargetBodyCharacters 附近，同时严格落在最小和最大段落数、正文字数范围内。',
  '修复后在内部按 input.outputRequirements.countingRule 复核；不达标时继续调整，直到达标。',
  '只输出一个 JSON object，不要 Markdown、代码块、解释或思考过程。',
  'JSON 字段严格为 title:string 和 body:string[]。',
].join('\n')

export const draftRepairUserPromptTemplate =
  'JSON.stringify({ task: "repair_draft_contract", input: { candidateDraft, actual, outputRequirements, brief, topic, targetAudience } })'

export function buildDraftRepairUserPrompt(
  input: GenerateDraftRequest,
  candidateDraft: AiDraftCopy,
) {
  const requirements = getDraftOutputRequirements(input.length)
  const preferredCharactersPerParagraph = Math.ceil(
    (requirements.preferredCharactersPerParagraph.min +
      requirements.preferredCharactersPerParagraph.max) /
      2,
  )

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
      brief: input.brief,
      topic: input.topic,
      targetAudience: input.targetAudience,
    },
  })
}

export function validateDraftSkillOutput(
  draft: AiDraftCopy,
  length: GenerateDraftRequest['length'],
) {
  const policy = draftLengthPolicies[length]
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
        value.body.length < policy.minParagraphs ||
        value.body.length > policy.maxParagraphs
      ) {
        context.addIssue({
          code: 'custom',
          path: ['body'],
          message: `Draft must contain ${policy.minParagraphs}-${policy.maxParagraphs} paragraphs for ${length} length; received ${value.body.length}.`,
        })
      }

      if (
        bodyCharacterCount < policy.minCharacters ||
        bodyCharacterCount > policy.maxCharacters
      ) {
        context.addIssue({
          code: 'custom',
          path: ['body'],
          message: `Draft must contain ${policy.minCharacters}-${policy.maxCharacters} characters for ${length} length; received ${bodyCharacterCount}.`,
        })
      }
    })
    .parse(draft)
}

const draftSystemPrompt = [
  '你是 Lumos AI Writer 的小红书初稿生成 Skill。',
  '目标是依据用户选题、目标读者、明确要求和已完成的学习拆解，生成一版可以继续编辑的中文初稿。',
  '指令优先级：brief.mustInclude 与 brief.avoidTone > project writingProfile > account writingProfile > analysis 的风格约束与避坑点 > 用户标注理由和标签 > 参考文案。',
  'writingProfile 是对用户长期写作方式的证据化总结。高置信度偏好优先应用；低置信度偏好只能轻量尝试，不能压过当前明确要求。',
  '参考文案只提供写作机制，不提供可直接挪用的个人经历、产品事实、数据或句子。',
  '只有 topic 或 brief 明确支持时才使用第一人称经历；不得把参考作者的经历写成用户经历。',
  'brief.mustInclude 非空时必须自然包含其中的信息，brief.avoidTone 非空时必须视为硬性禁用语气。',
  '标题必须具体、克制且与正文一致，不超过 35 个汉字，不用夸张承诺或无依据的数字。',
  'body 每个数组元素必须是一个完整段落，段落之间要有清晰推进，不写提纲标签或段落功能说明。',
  '长度规则必须按 input.length 执行：',
  `short：必须 ${draftLengthPolicies.short.minParagraphs}-${draftLengthPolicies.short.maxParagraphs} 段、${draftLengthPolicies.short.minCharacters}-${draftLengthPolicies.short.maxCharacters} 字；优先写 ${draftLengthPolicies.short.preferredParagraphs} 段，每段 ${draftLengthPolicies.short.preferredMinCharactersPerParagraph}-${draftLengthPolicies.short.preferredMaxCharactersPerParagraph} 字。`,
  `medium：必须 ${draftLengthPolicies.medium.minParagraphs}-${draftLengthPolicies.medium.maxParagraphs} 段、${draftLengthPolicies.medium.minCharacters}-${draftLengthPolicies.medium.maxCharacters} 字；优先写 ${draftLengthPolicies.medium.preferredParagraphs} 段，每段 ${draftLengthPolicies.medium.preferredMinCharactersPerParagraph}-${draftLengthPolicies.medium.preferredMaxCharactersPerParagraph} 字。`,
  `long：必须 ${draftLengthPolicies.long.minParagraphs}-${draftLengthPolicies.long.maxParagraphs} 段、${draftLengthPolicies.long.minCharacters}-${draftLengthPolicies.long.maxCharacters} 字；优先写 ${draftLengthPolicies.long.preferredParagraphs} 段，每段 ${draftLengthPolicies.long.preferredMinCharactersPerParagraph}-${draftLengthPolicies.long.preferredMaxCharactersPerParagraph} 字。`,
  'input.outputRequirements 是本次输出的硬约束。先按 preferredParagraphs 和 preferredCharactersPerParagraph 写足内容，再核对段落数与去除空白后的正文总字数；不足时补充具体场景、动作或判断，不得用空话凑字，满足后才能输出最终 JSON。',
  '默认不用 emoji；确有语气需要时整篇最多 2 个。结尾可以互动，但不能强行要求点赞、收藏或关注。',
  '去 AI 味规则：',
  ...antiAiWritingRulesV1.map((rule, index) => `${index + 1}. ${rule}`),
  '只输出一个 JSON object，不要 Markdown，不要代码块，不要解释或思考过程。',
  'JSON 字段必须严格匹配：',
  JSON.stringify(outputContract),
].join('\n')

export const draftSkillV1: AiSkillDefinition<
  DraftSkillInput,
  AiDraftCopy
> = {
  id: 'xiaohongshu-draft',
  version: '1.0.3',
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
  ],
  buildUserPrompt: (input) =>
    JSON.stringify({
      task: 'generate_xiaohongshu_draft',
      input: compactDraftSkillInput(input),
    }),
  outputSchema: aiDraftCopySchema,
}
