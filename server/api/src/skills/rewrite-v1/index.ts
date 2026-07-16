import {
  aiRewriteResultSchema,
  type AiRewriteResult,
  type RewriteDraftRequest,
  type WritingProfileRevisionDto,
} from '@lumos-ai/shared'
import type { AiSkillDefinition } from '../runtime.js'
import { antiAiWritingRulesV1 } from '../shared/anti-ai-writing-rules-v1.js'
import { findUnsupportedNumericClaims } from '../shared/grounding.js'

export type RewriteSkillInput = RewriteDraftRequest & {
  writingProfileContext?: {
    accountProfile: WritingProfileRevisionDto | null
    projectProfile: WritingProfileRevisionDto | null
  }
}

const outputContract = {
  summary: '一句话说明本轮改写重点，不复述思考过程',
  suggestions: [
    {
      label: '不超过 12 个汉字的版本标签',
      text: '只用于替换 selectedText 的完整文本',
      rationale: '一句话说明它如何响应用户要求并承接上下文',
    },
  ],
  recommendedIndex: 0,
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

export function compactRewriteSkillInput(input: RewriteSkillInput) {
  return {
    project: {
      name: input.projectName,
      topic: input.topic,
      targetAudience: input.targetAudience,
    },
    instruction: input.instruction,
    selection: {
      fieldId: input.fieldId,
      selectedText: input.selectedText,
      contextBefore: input.contextBefore,
      contextAfter: input.contextAfter,
    },
    fullDraft: input.draft,
    writingProfile: {
      account: compactProfile(input.writingProfileContext?.accountProfile),
      project: compactProfile(input.writingProfileContext?.projectProfile),
    },
    analysis: input.analysis
      ? {
          writingPath: input.analysis.aiLearningMethod.writingPath,
          styleConstraints: input.analysis.aiLearningMethod.styleConstraints,
          coreJudgement: input.analysis.coreJudgement,
          userPreference: input.analysis.userPreference,
          avoidPitfall: input.analysis.avoidPitfall,
          writingMove: input.analysis.writingMove,
        }
      : null,
    groundingPolicy: {
      mode: 'closed_world',
      evidenceSources: [
        'selection.selectedText',
        'selection.contextBefore',
        'selection.contextAfter',
        'fullDraft',
        'analysis',
      ],
      rule: 'suggestion.text 中的每个事实、动作、地点、时间、数字、结果和因果都必须能在 evidenceSources 中找到证据',
      missingInformation:
        '没有证据时改写已有表达或明确请用户补充，不得提供看似具体的虚构示例',
    },
  }
}

function normalizeComparisonText(value: string) {
  return value.replace(/\s+/g, '').replace(/[，。！？、；：“”‘’（）《》]/g, '')
}

export function validateRewriteSkillOutput(
  rewrite: AiRewriteResult,
  selectedText: string,
  groundingSource = selectedText,
) {
  return aiRewriteResultSchema
    .superRefine((value, context) => {
      const original = normalizeComparisonText(selectedText)
      const seen = new Set<string>()

      value.suggestions.forEach((suggestion, index) => {
        const normalized = normalizeComparisonText(suggestion.text)
        if (normalized === original) {
          context.addIssue({
            code: 'custom',
            path: ['suggestions', index, 'text'],
            message: 'A rewrite suggestion must differ from the selected text.',
          })
        }
        if (seen.has(normalized)) {
          context.addIssue({
            code: 'custom',
            path: ['suggestions', index, 'text'],
            message: 'Rewrite suggestions must be meaningfully distinct.',
          })
        }
        const unsupportedClaims = findUnsupportedNumericClaims(
          suggestion.text,
          groundingSource,
        )
        if (unsupportedClaims.length > 0) {
          context.addIssue({
            code: 'custom',
            path: ['suggestions', index, 'text'],
            message: `Rewrite suggestion contains unsupported numeric claims: ${unsupportedClaims.join(', ')}.`,
          })
        }
        seen.add(normalized)
      })
    })
    .parse(rewrite)
}

const rewriteSystemPrompt = [
  '你是 Lumos AI Writer 的局部改写 Skill。',
  '目标是只替换用户当前选中的文字，让它更符合用户的明确要求、写作模型和整篇上下文。',
  '指令优先级：当前 instruction > project writingProfile > account writingProfile > analysis > 当前段落与完整草稿上下文。',
  '当前 instruction 是本轮硬约束。长期模型与本轮要求冲突时服从本轮要求，不把一次要求擅自解释成长期偏好。',
  '高置信度偏好优先应用；低置信度偏好只能作为轻量倾向。project 模型只覆盖当前项目，不得反向覆盖账号模型。',
  'suggestions 必须提供 2-3 个能够直接替换 selectedText 的完整版本，不得返回整篇文案、整段未选文字或改写后的 fullDraft。',
  '默认保留 selectedText 的事实、指代和核心意思；除非 instruction 明确要求改变表达意图。',
  '输入采用闭世界事实规则：suggestion.text 中每个新增事实、动作、地点、时间、数字、结果和因果，都必须能在 selection、fullDraft 或 analysis 中找到直接证据。',
  'instruction 要求“更具体”时，只能复用输入里已有的具体动作和细节；输入没有可用细节时，应保持克制或请用户补充，禁止编写虚构示例。',
  '输出前逐条做事实溯源：无法指出输入证据的新增名词、动作或数字必须删除。rationale 不能把编造包装成“更有画面感”。',
  '必须阅读 contextBefore、contextAfter 和 fullDraft，确保替换后语法、指代、时态和语气能够自然承接。',
  '不同版本必须有明显差异，例如停顿位置、具体程度或语气强弱不同，不能只替换一两个同义词。',
  '不得编造输入中没有的人物、经历、产品、地点、时间、数字、结果或因果。信息不足时宁可克制表达。',
  'recommendedIndex 选择最符合当前 instruction 且不违背高置信度写作偏好的版本。',
  'rationale 只说明版本差异和适用效果，不输出思考过程，不声称已经修改 fullDraft。',
  '去 AI 味规则：',
  ...antiAiWritingRulesV1.map((rule, index) => `${index + 1}. ${rule}`),
  '只输出一个 JSON object，不要 Markdown，不要代码块，不要额外解释。',
  'JSON 字段必须严格匹配：',
  JSON.stringify(outputContract),
].join('\n')

export const rewriteSkillV1: AiSkillDefinition<RewriteSkillInput, AiRewriteResult> = {
  id: 'selection-rewrite',
  version: '1.0.1',
  taskType: 'rewrite',
  model: 'deepseek-v4-flash',
  maxTokens: 1600,
  temperature: 0.32,
  systemPrompt: rewriteSystemPrompt,
  userPromptTemplate:
    'JSON.stringify({ task: "rewrite_selected_text", input: compactRewriteSkillInput(input) })',
  buildUserPrompt: (input) =>
    JSON.stringify({
      task: 'rewrite_selected_text',
      input: compactRewriteSkillInput(input),
    }),
  outputSchema: aiRewriteResultSchema,
}
