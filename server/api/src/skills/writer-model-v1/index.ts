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

function getStringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'string' ? value[key] : ''
}

function summarizeTextSurface(text: string) {
  const compactCharacters = Array.from(text.replace(/\s/g, '')).length
  const sentences = text
    .split(/[。！？!?]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const paragraphs = text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)

  return {
    characters: compactCharacters,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    averageSentenceCharacters:
      sentences.length > 0 ? Math.round((compactCharacters / sentences.length) * 10) / 10 : 0,
    punctuation: {
      comma: (text.match(/[，,]/g) ?? []).length,
      fullStop: (text.match(/[。]/g) ?? []).length,
      question: (text.match(/[？?]/g) ?? []).length,
      exclamation: (text.match(/[！!]/g) ?? []).length,
      colon: (text.match(/[：:]/g) ?? []).length,
      ellipsis: (text.match(/……|\.\.\./g) ?? []).length,
    },
  }
}

function getChangedMiddle(beforeText: string, afterText: string) {
  let prefixLength = 0
  const maxPrefix = Math.min(beforeText.length, afterText.length)
  while (
    prefixLength < maxPrefix &&
    beforeText[prefixLength] === afterText[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  const maxSuffix = Math.min(
    beforeText.length - prefixLength,
    afterText.length - prefixLength,
  )
  while (
    suffixLength < maxSuffix &&
    beforeText[beforeText.length - 1 - suffixLength] ===
      afterText[afterText.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  return {
    removed: trimText(
      beforeText.slice(prefixLength, beforeText.length - suffixLength),
      600,
    ),
    added: trimText(
      afterText.slice(prefixLength, afterText.length - suffixLength),
      600,
    ),
  }
}

export function buildWritingEditSignal(
  feedback: BuildWritingProfileRequest['feedbackEvidence'][number],
) {
  if (!['manual_edit', 'accepted_rewrite'].includes(feedback.type)) return null

  const beforeText = getStringField(feedback.context, 'beforeText') ||
    getStringField(feedback.context, 'selectedText')
  const afterText = getStringField(feedback.context, 'afterText') || feedback.content
  if (!beforeText || !afterText || beforeText === afterText) return null

  return {
    before: summarizeTextSurface(beforeText),
    after: summarizeTextSurface(afterText),
    changedMiddle: getChangedMiddle(beforeText, afterText),
  }
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
      editSignal: buildWritingEditSignal(feedback),
      source: feedback.source,
      createdAt: feedback.createdAt,
    })),
  }
}

const writerModelSystemPrompt = [
  '你是 Lumos AI Writer 的用户写作模型学习 Skill，不负责直接写文案。',
  '你的任务有两个：从素材库共性和标注理由中理解用户为什么喜欢这些文案；从用户修改、接受、拒绝和最终选稿中学习用户自己的判断与表达方式。',
  '需要分别观察字词选择、固定替换、禁用表达、句式长度、停顿与标点、段落节奏、情感强度、确定性和与读者的距离；这些表层习惯必须落入 vocabulary、sentence_rhythm、emotional_expression、tone 或 forbidden_pattern，不能只概括成“自然”“像真人”。',
  'manual_edit 和 accepted_rewrite 可能包含 editSignal。它只帮助识别修改前后的表层变化，结论仍必须引用原始 feedback evidence ID。',
  '先判断修改原因。事实修正、名称替换、错别字、字数压缩和本次任务硬约束不是长期风格；只有可跨内容复用的选择才可进入 preference。',
  '学习替换关系时必须保留方向，例如“用户删除了什么、改成了什么、未来何时适用”；不要把修改前后的两种表达都写成偏好。',
  '不要因为用户偶尔保留一个网络词就推断其偏好口语化，也不要因为一次短句拆分就推断所有文案都应该短句化。',
  '目标不是模仿某篇参考文案，而是形成可持续更新、可用于初稿和改写的用户写作决策模型。',
  '证据优先级：profile_correction > manual_edit > accepted_rewrite/rejected_rewrite > final_choice > rewrite_preference > snippet reason > snippet label > repeated library pattern。',
  '每条 preferences 必须引用输入中真实存在的 evidence ID；不得编造证据、用户身份、经历或人口属性。',
  'scope=account 时，只保留跨项目仍成立的长期偏好；项目主题、受众和一次性要求只能进入 openQuestions，不能升级为账号偏好。',
  'scope=account 只表示偏好可跨项目长期保存，不表示它适用于所有内容模式。同一账号可以同时有品牌叙事、产品说明、活动互动、事件通知和日常热点等不同写法，不得平均成一个全局语气。',
  'scope=project 时，可以记录当前项目覆盖，但 preference.scope 必须为 project。',
  '每条 preference 都要判断迁移边界。若证据只来自一种内容模式，application 必须明确写出适用模式和触发条件；只有证据覆盖至少两种不同内容模式，或用户通过 profile_correction 明确说明是长期通用习惯，才可写成跨模式默认规则。',
  '事实准确、不得编造、不得照抄参考等正确性约束可以跨模式成立；账号自称、互动动作、句长、分行、双关和结尾方式默认是模式相关偏好，除非有跨模式证据。',
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
  version: '1.2.0',
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
