import {
  aiReaderPreviewResultSchema,
  aiReaderPreviewSuggestionSchema,
  type AiDraftCopy,
  type AiReaderPreviewResult,
  type PreviewDraftForReaderRequest,
  type WritingProfileRevisionDto,
} from '@lumos-ai/shared'
import { z, ZodError } from 'zod'
import type { AiSkillDefinition } from '../runtime.js'
import {
  findUnsupportedMaterialTerms,
  findUnsupportedNumericClaims,
} from '../shared/grounding.js'

export type ReaderPreviewSkillInput = PreviewDraftForReaderRequest & {
  writingProfileContext?: {
    accountProfile: WritingProfileRevisionDto | null
    projectProfile: WritingProfileRevisionDto | null
  }
}

const outputContract = {
  audienceSummary: '一句话说明本次预演采用的读者视角和主要判断边界',
  annotations: [
    {
      id: 'annotation-1',
      fieldId: 'title 或 body-0 等精确字段',
      quote: '从该字段逐字复制的连续原文',
      tone: 'interest | risk | question',
      label: '简短类型标签',
      title: '批注标题',
      reaction: '目标读者此处可能产生的即时反应',
      reason: '为什么该原文会支持这一反应',
      confidence: 0.72,
    },
  ],
  suggestions: [
    {
      priority: 'high | medium | low',
      instruction: '可执行且不改变事实的修改方向',
      rationale: '修改这一处对目标读者的作用',
      annotationIds: ['annotation-1'],
    },
  ],
}

function compactProfile(revision: WritingProfileRevisionDto | null | undefined) {
  if (!revision) return null
  return {
    version: revision.version,
    summary: revision.profile.summary,
    decisionPrinciples: revision.profile.decisionPrinciples,
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

export function compactReaderPreviewSkillInput(input: ReaderPreviewSkillInput) {
  return {
    project: {
      name: input.projectName,
      topic: input.topic,
      targetAudience: input.targetAudience,
    },
    readerAudience: input.readerAudience || input.targetAudience,
    draft: input.draft,
    writingProfile: {
      account: compactProfile(input.writingProfileContext?.accountProfile),
      project: compactProfile(input.writingProfileContext?.projectProfile),
    },
    analysis: input.analysis
      ? {
          writingPath: input.analysis.aiLearningMethod.writingPath,
          styleConstraints: input.analysis.aiLearningMethod.styleConstraints,
          coreJudgement: input.analysis.coreJudgement,
          effectivePatterns: input.analysis.effectivePatterns,
          userPreference: input.analysis.userPreference,
          avoidPitfall: input.analysis.avoidPitfall,
          readerView: input.analysis.readerView,
        }
      : null,
    groundingPolicy: {
      mode: 'closed_world',
      evidenceSources: ['draft', 'analysis'],
      suggestionRule:
        'suggestion.instruction 只能调整、删减、重排或明确已有边界，不得代写输入中不存在的事实、动作、地点、时间、数字、结果或因果',
      missingInformation:
        '读者缺少信息时，只能建议用户核实后补充；必须写成条件式，不得给出虚构数字或事实示例',
    },
  }
}

function getDraftField(draft: AiDraftCopy, fieldId: string) {
  if (fieldId === 'title') return draft.title
  const match = fieldId.match(/^body-(\d+)$/)
  return match ? draft.body[Number(match[1])] : undefined
}

function isGroundedReaderSuggestion(instruction: string, groundingSource: string) {
  return (
    findUnsupportedNumericClaims(instruction, groundingSource).length === 0 &&
    findUnsupportedMaterialTerms(
      instruction,
      groundingSource,
      'reader-instruction',
    ).length === 0
  )
}

export function filterGroundedReaderSuggestions(
  preview: AiReaderPreviewResult,
  groundingSource: string,
) {
  return {
    ...preview,
    suggestions: preview.suggestions.filter((suggestion) =>
      isGroundedReaderSuggestion(suggestion.instruction, groundingSource),
    ),
  }
}

export function validateReaderPreviewSkillOutput(
  preview: AiReaderPreviewResult,
  draft: AiDraftCopy,
  groundingSource = JSON.stringify(draft),
) {
  return aiReaderPreviewResultSchema
    .superRefine((value, context) => {
      const locations = new Set<string>()

      value.annotations.forEach((annotation, index) => {
        const field = getDraftField(draft, annotation.fieldId)
        if (field === undefined) {
          context.addIssue({
            code: 'custom',
            path: ['annotations', index, 'fieldId'],
            message: 'Annotation fieldId does not exist in the draft.',
          })
          return
        }
        if (!field.includes(annotation.quote)) {
          context.addIssue({
            code: 'custom',
            path: ['annotations', index, 'quote'],
            message: 'Annotation quote must be copied exactly from its draft field.',
          })
        }
        if (annotation.confidence > 0.9) {
          context.addIssue({
            code: 'custom',
            path: ['annotations', index, 'confidence'],
            message: 'A simulated reader reaction cannot exceed 0.9 confidence.',
          })
        }

        const location = `${annotation.fieldId}:${annotation.quote}`
        if (locations.has(location)) {
          context.addIssue({
            code: 'custom',
            path: ['annotations', index, 'quote'],
            message: 'Reader annotations must point to distinct draft excerpts.',
          })
        }
        locations.add(location)
      })

      value.suggestions.forEach((suggestion, index) => {
        const unsupportedClaims = findUnsupportedNumericClaims(
          suggestion.instruction,
          groundingSource,
        )
        if (unsupportedClaims.length > 0) {
          context.addIssue({
            code: 'custom',
            path: ['suggestions', index, 'instruction'],
            message: `Reader suggestion contains unsupported numeric claims: ${unsupportedClaims.join(', ')}.`,
          })
        }
        const unsupportedTerms = findUnsupportedMaterialTerms(
          suggestion.instruction,
          groundingSource,
          'reader-instruction',
        )
        if (unsupportedTerms.length > 0) {
          context.addIssue({
            code: 'custom',
            path: ['suggestions', index, 'instruction'],
            message: `Reader suggestion contains unsupported material terms: ${unsupportedTerms.join(', ')}.`,
          })
        }
      })
    })
    .parse(preview)
}

export const readerPreviewSuggestionRepairSchema = z.object({
  suggestions: z.array(aiReaderPreviewSuggestionSchema).min(1).max(4),
})

export function canRepairReaderPreviewSuggestions(error: unknown) {
  return (
    error instanceof ZodError &&
    error.issues.length > 0 &&
    error.issues.every((issue) => issue.path[0] === 'suggestions')
  )
}

export const readerPreviewRepairSystemPrompt = [
  '你是 Lumos AI Writer 的目标读者建议修复器。',
  '候选建议已经因为无证据内容被拒绝。你只能重写 suggestions，不得输出或改写 audienceSummary、annotations。',
  'suggestion.instruction 中的具体动作、地点、时间、数字、结果和因果必须能在 originalInput 的 draft 或 analysis 中找到直接证据。',
  'validationError 明确列出了被拒绝的问题。必须逐项删除；不能用另一个虚构示例替换。',
  '如果读者需要原文没有的信息，只能条件式建议用户核实后补充；不得替用户给出示例数字或答案。',
  '不得把通勤方式、天气、消费、休息、饮食等常见生活场景当作可自由补充的合理联想。',
  '返回 1-4 条 suggestions；每条 suggestion 只能引用 availableAnnotations 中已有的 id。',
  '只输出紧凑的 {"suggestions":[...]} JSON object；不要 Markdown、外层包装、解释或思考过程。',
].join('\n')

export const readerPreviewRepairUserPromptTemplate =
  'JSON.stringify({ task: "repair_reader_preview_suggestions", originalInput, availableAnnotations, candidateSuggestions, validationError })'

export function buildReaderPreviewRepairUserPrompt(
  originalUserPrompt: string,
  candidatePreview: AiReaderPreviewResult,
  validationError: string,
) {
  return JSON.stringify({
    task: 'repair_reader_preview_suggestions',
    originalInput: JSON.parse(originalUserPrompt),
    availableAnnotations: candidatePreview.annotations.map((annotation) => ({
      id: annotation.id,
      fieldId: annotation.fieldId,
      quote: annotation.quote,
      tone: annotation.tone,
      title: annotation.title,
    })),
    candidateSuggestions: candidatePreview.suggestions,
    validationError,
  })
}

const readerPreviewSystemPrompt = [
  '你是 Lumos AI Writer 的目标读者预演 Skill。',
  '目标是基于指定读者视角，对完整草稿做一次有依据的阅读预演，标出可能的停留点、划走风险和自然疑问，并给出克制的修改建议。',
  '这不是用户调研、真实阅读数据或效果预测。reaction 必须使用“可能、容易、会想知道”等审慎措辞，confidence 不得高于 0.9。',
  '判断优先级：明确 readerAudience > 草稿中实际写出的信息 > project writingProfile > account writingProfile > analysis。',
  'writingProfile 用于理解用户希望建立的读者关系，并约束修改建议保持用户表达方式；不得为了套用画像而虚构读者反应。',
  '每条 annotation.quote 必须从 annotation.fieldId 对应的标题或正文段落中逐字复制一段连续原文，不得改写、拼接或跨段引用。',
  '只标注有文本证据的位置。interest 要说明具体内容为何与目标读者相关；risk 要指出理解成本、重复、跳跃或无依据承诺；question 要指出读者完成判断仍缺少什么。',
  '不要机械地为每种 tone 各凑一条；草稿没有明显风险时可以多给 interest 或 question，但总批注必须为 2-6 条且位置不同。',
  'suggestions 必须引用一个或多个 annotationIds，并给出能直接执行的修改方向；不得给“更生动、更有共鸣、优化表达”等空泛建议。',
  '建议只能调整表达、顺序、取舍或明确已有边界，不得要求补写输入中不存在的经历、产品事实、地点、时间、数字、效果或因果。',
  '输入采用闭世界事实规则：suggestion.instruction 不得代写任何输入中不存在的事实、动作或数字，也不得用“例如”给出看似具体但无证据的内容。',
  '如果读者需要草稿未提供的信息，只能建议“若用户有真实信息则核实后补充，否则保持定性表达”，不能替用户填写答案。',
  '输出前逐条检查 suggestion.instruction：其中每个具体动作、地点、时间、数字、结果和因果必须能在 draft 或 analysis 中找到证据；找不到就删除或改成条件式核实建议。',
  '通勤方式、天气、消费、休息、饮食等常见生活场景也属于新增事实，输入没写就不能补。',
  '高置信度用户偏好应被尊重。不能因为通用平台套路而建议用户违背 mustAvoid，也不能把互动、数字、冲突或夸张标题视为必需。',
  '只输出一个 JSON object，不要 Markdown，不要代码块，不要解释或思考过程。',
  'JSON 字段必须严格匹配：',
  JSON.stringify(outputContract),
].join('\n')

export const readerPreviewSkillV1: AiSkillDefinition<
  ReaderPreviewSkillInput,
  AiReaderPreviewResult
> = {
  id: 'target-reader-preview',
  version: '1.0.4',
  taskType: 'reader-preview',
  model: 'deepseek-v4-flash',
  maxTokens: 2200,
  temperature: 0.3,
  systemPrompt: readerPreviewSystemPrompt,
  userPromptTemplate:
    'JSON.stringify({ task: "preview_draft_as_target_reader", input: compactReaderPreviewSkillInput(input) })',
  supplementaryPromptTemplates: [
    readerPreviewRepairSystemPrompt,
    readerPreviewRepairUserPromptTemplate,
  ],
  buildUserPrompt: (input) =>
    JSON.stringify({
      task: 'preview_draft_as_target_reader',
      input: compactReaderPreviewSkillInput(input),
    }),
  outputSchema: aiReaderPreviewResultSchema,
}
