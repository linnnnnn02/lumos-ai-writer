import {
  writingPreferenceDimensionSchema,
  writingProfileSchema,
  type BuildWritingProfileRequest,
  type WritingProfile,
} from '@lumos-ai/shared'
import type { AiSkillDefinition } from '../runtime.js'

const outputContract = {
  summary: '用户写作方式的简明判断',
  decisionPrinciples: ['选择内容和形成判断时遵循的规则'],
  contentPatterns: ['偏好的内容与证据组织方式'],
  structurePatterns: ['开头、推进和收尾习惯'],
  voicePatterns: ['语气、用词和句子节奏'],
  readerRelationship: ['如何与读者建立关系'],
  mustKeep: ['未来写作必须保留的特征'],
  mustAvoid: ['未来写作必须避免的特征'],
  preferences: [
    {
      id: '稳定偏好 ID',
      dimension: 'tone',
      statement: '有证据支持的偏好结论',
      application: '未来初稿或改写如何应用',
      avoid: '与该偏好冲突的写法',
      scope: 'account',
      confidence: 0.7,
      supportCount: 2,
      evidenceIds: ['真实输入证据 ID'],
      contradictions: [],
    },
  ],
  openQuestions: ['证据不足时需要继续向用户确认的问题'],
  evidenceCount: 4,
}

function trimText(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function buildEvidenceTypeMap(input: BuildWritingProfileRequest) {
  const evidenceTypes = new Map<string, string>()
  for (const note of input.libraryEvidence.notes) {
    evidenceTypes.set(note.id, 'library_pattern')
  }
  for (const snippet of input.libraryEvidence.snippets) {
    evidenceTypes.set(
      snippet.id,
      snippet.reasonText ? 'snippet_reason' : 'snippet_label',
    )
  }
  for (const feedback of input.feedbackEvidence) {
    evidenceTypes.set(feedback.id, feedback.type)
  }
  return evidenceTypes
}

function getConfidenceLimit(evidenceTypes: string[]) {
  if (evidenceTypes.length === 1) {
    return evidenceTypes[0] === 'profile_correction' ? 0.85 : 0.45
  }
  if (evidenceTypes.length === 2) return 0.7

  const hasStrongEvidence = evidenceTypes.some((type) =>
    ['profile_correction', 'manual_edit', 'final_choice'].includes(type),
  )
  return hasStrongEvidence ? 0.95 : 0.8
}

export function normalizeWriterModelOutput(
  value: unknown,
  input: BuildWritingProfileRequest,
) {
  if (!isRecord(value)) return value

  const evidenceTypes = buildEvidenceTypeMap(input)
  const allowedDimensions = new Set(writingPreferenceDimensionSchema.options)
  const preferences = Array.isArray(value.preferences)
    ? value.preferences.flatMap((preference) => {
        if (!isRecord(preference)) return []
        if (
          typeof preference.dimension !== 'string' ||
          !allowedDimensions.has(
            preference.dimension as (typeof writingPreferenceDimensionSchema.options)[number],
          )
        ) {
          return []
        }

        const evidenceIds = Array.from(
          new Set(
            (Array.isArray(preference.evidenceIds) ? preference.evidenceIds : []).filter(
              (id): id is string => typeof id === 'string' && evidenceTypes.has(id),
            ),
          ),
        )
        if (evidenceIds.length === 0) return []

        const evidenceTypeList = evidenceIds
          .map((id) => evidenceTypes.get(id))
          .filter((type): type is string => Boolean(type))
        const rawConfidence =
          typeof preference.confidence === 'number' && Number.isFinite(preference.confidence)
            ? preference.confidence
            : 0

        return [
          {
            ...preference,
            scope: input.scope,
            confidence: Math.min(
              Math.max(rawConfidence, 0),
              getConfidenceLimit(evidenceTypeList),
            ),
            supportCount: evidenceIds.length,
            evidenceIds,
          },
        ]
      })
    : []

  return {
    ...value,
    preferences,
    evidenceCount: evidenceTypes.size,
  }
}

export function compactWriterModelInput(input: BuildWritingProfileRequest) {
  return {
    scope: input.scope,
    projectId: input.projectId,
    projectContext: input.projectContext,
    previousProfile: input.previousProfile ?? null,
    libraryEvidence: {
      notes: input.libraryEvidence.notes.slice(0, 40).map((note) => ({
        id: note.id,
        title: note.title,
        contentText: trimText(note.contentText, 1400),
      })),
      snippets: input.libraryEvidence.snippets.slice(0, 160).map((snippet) => ({
        id: snippet.id,
        noteId: snippet.noteId,
        selectedText: trimText(snippet.selectedText, 600),
        reasonText: trimText(snippet.reasonText, 400),
        colorTagName: snippet.colorTagName,
      })),
    },
    feedbackEvidence: input.feedbackEvidence.slice(0, 240).map((feedback) => ({
      id: feedback.id,
      projectId: feedback.projectId,
      type: feedback.type,
      content: trimText(feedback.content, 1600),
      context: trimText(JSON.stringify(feedback.context), 1400),
      source: feedback.source,
      createdAt: feedback.createdAt,
    })),
  }
}

const writerModelSystemPrompt = [
  '你是 Lumos AI Writer 的用户写作模型学习 Skill，不负责直接写文案。',
  '你的任务有两个：从素材库共性和标注理由中理解用户为什么喜欢这些文案；从用户修改、接受、拒绝和最终选稿中学习用户自己的判断与表达方式。',
  '目标不是模仿某篇参考文案，而是形成可持续更新、可用于初稿和改写的用户写作决策模型。',
  '证据优先级：profile_correction > manual_edit > accepted_rewrite/rejected_rewrite > final_choice > rewrite_preference > snippet reason > snippet label > repeated library pattern。',
  '每条 preferences 必须引用输入中真实存在的 evidence ID；不得编造证据、用户身份、经历或人口属性。',
  'scope=account 时，只保留跨项目仍成立的长期偏好；项目主题、受众和一次性要求只能进入 openQuestions，不能升级为账号偏好。',
  'scope=project 时，可以记录当前项目覆盖，但 preference.scope 必须为 project。',
  '单条非明确纠正证据只能形成待验证偏好，confidence 不得高于 0.45；单条 profile_correction 可达到 0.85；两条一致独立证据不得高于 0.7；三条以上且包含明确纠正、手动改稿或最终选择时才可高于 0.8。',
  'supportCount 必须等于该偏好引用的独立 evidenceIds 数量。出现冲突时保留在 contradictions，不要平均成模糊结论。',
  `dimension 只能是以下值之一：${writingPreferenceDimensionSchema.options.join(', ')}。无法归类时不要输出该条 preference。`,
  'application 必须明确说明未来写作怎么选内容、组织结构或处理措辞，不能只写“更自然”“更像用户”。',
  'previousProfile 只是上一版假设；新证据支持时强化，冲突时降低置信度或保留矛盾，不得无条件复制。',
  'top-level 的原则和模式必须能够由 preferences 中的证据支持。',
  'evidenceCount 必须等于本次输入中 notes、snippets 和 feedbackEvidence 的去重证据总数。',
  '只输出一个 JSON object，不要 Markdown、代码块、额外解释或思考过程。',
  'JSON 字段必须严格匹配：',
  JSON.stringify(outputContract),
].join('\n')

export const writerModelSkillV1: AiSkillDefinition<
  BuildWritingProfileRequest,
  WritingProfile
> = {
  id: 'user-writing-model',
  version: '1.0.0',
  taskType: 'profile-learn',
  model: 'deepseek-v4-flash',
  maxTokens: 3200,
  temperature: 0.25,
  systemPrompt: writerModelSystemPrompt,
  userPromptTemplate:
    'JSON.stringify({ task: "learn_user_writing_model", input: compactWriterModelInput(input) })',
  buildUserPrompt: (input) =>
    JSON.stringify({
      task: 'learn_user_writing_model',
      input: compactWriterModelInput(input),
    }),
  outputSchema: writingProfileSchema,
}
