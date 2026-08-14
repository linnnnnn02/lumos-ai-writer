import {
  writingEditEvidenceSchema,
  writingPreferenceSchema,
  writingPreferenceDimensionSchema,
  writingProfileSchema,
  type BuildWritingProfileRequest,
  type WritingEditEvidence,
  type WritingPreference,
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
      sourceCategory: 'pattern_preference',
      status: 'active',
      contentModes: ['brand_story'],
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

function getStringArrayField(value: Record<string, unknown>, key: string) {
  return Array.isArray(value[key])
    ? value[key].filter((item): item is string => typeof item === 'string')
    : []
}

type FeedbackEvidence = BuildWritingProfileRequest['feedbackEvidence'][number]
const maxWritingPreferenceCount = 60
type PreferenceAction = {
  action: 'enable' | 'disable' | 'delete' | 'correct'
  preferenceId: string
  snapshot: WritingPreference | null
}

function getLearningEvidence(feedback: FeedbackEvidence): WritingEditEvidence | null {
  const result = writingEditEvidenceSchema.safeParse(feedback.context.learningEvidence)
  return result.success ? result.data : null
}

function getPreferenceAction(feedback: FeedbackEvidence): PreferenceAction | null {
  if (feedback.type !== 'profile_correction' || !isRecord(feedback.context.preferenceAction)) {
    return null
  }

  const value = feedback.context.preferenceAction
  const action = getStringField(value, 'action')
  const preferenceId = getStringField(value, 'preferenceId')
  if (
    !preferenceId ||
    !['enable', 'disable', 'delete', 'correct'].includes(action)
  ) {
    return null
  }

  const snapshotResult = writingPreferenceSchema.safeParse(value.snapshot)
  return {
    action: action as PreferenceAction['action'],
    preferenceId,
    snapshot: snapshotResult.success ? snapshotResult.data : null,
  }
}

function isPersistedPreferenceAction(
  feedback: FeedbackEvidence,
  input: BuildWritingProfileRequest,
) {
  if (!getPreferenceAction(feedback)) return true

  // Undefined keeps offline fixtures and older callers backward compatible. The API always supplies
  // the current revision evidence list, so an action from a failed concurrent update is excluded.
  return (
    input.previousRevisionEvidenceIds === undefined ||
    input.previousRevisionEvidenceIds.includes(feedback.id)
  )
}

function getAppliedPreferenceIds(feedback: FeedbackEvidence) {
  return Array.from(
    new Set([
      ...getStringArrayField(feedback.context, 'appliedPreferenceIds'),
      ...getStringArrayField(feedback.context, 'draftAppliedPreferenceIds'),
    ]),
  ).slice(0, 120)
}

function isPreferenceEvidence(
  feedback: FeedbackEvidence,
  input: BuildWritingProfileRequest,
) {
  if (!isPersistedPreferenceAction(feedback, input)) return false
  const action = getPreferenceAction(feedback)
  if (action?.action === 'disable' || action?.action === 'delete') return false
  if (
    feedback.type === 'profile_correction' &&
    (feedback.context.scope === 'account' || feedback.context.scope === 'project') &&
    feedback.context.scope !== input.scope
  ) {
    return false
  }

  const learningEvidence = getLearningEvidence(feedback)
  return (
    !learningEvidence ||
    learningEvidence.category === 'pattern_preference' ||
    learningEvidence.category === 'long_term_habit'
  )
}

function isFeedbackVisibleToProfile(
  feedback: FeedbackEvidence,
  input: BuildWritingProfileRequest,
) {
  if (!isPersistedPreferenceAction(feedback, input)) return false
  return !(
    feedback.type === 'profile_correction' &&
    (feedback.context.scope === 'account' || feedback.context.scope === 'project') &&
    feedback.context.scope !== input.scope
  )
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

type EvidenceMetadata = {
  type: string
  originId: string
}

function buildEvidenceMetadataMap(input: BuildWritingProfileRequest) {
  const evidenceMetadata = new Map<string, EvidenceMetadata>()
  for (const note of input.libraryEvidence.notes) {
    evidenceMetadata.set(note.id, {
      type: 'library_pattern',
      originId: `library-note:${note.id}`,
    })
  }
  for (const snippet of input.libraryEvidence.snippets) {
    evidenceMetadata.set(snippet.id, {
      type: snippet.reasonText ? 'snippet_reason' : 'snippet_label',
      // Unlinked snippets share one unknown origin so missing note IDs cannot inflate support.
      originId: snippet.noteId
        ? `library-note:${snippet.noteId}`
        : 'library-note:unknown',
    })
  }
  for (const feedback of input.feedbackEvidence) {
    if (isPreferenceEvidence(feedback, input)) {
      evidenceMetadata.set(feedback.id, {
        type: feedback.type,
        originId: `feedback:${feedback.id}`,
      })
    }
  }
  return evidenceMetadata
}

function buildFeedbackMap(input: BuildWritingProfileRequest) {
  return new Map(input.feedbackEvidence.map((feedback) => [feedback.id, feedback]))
}

function getLatestPreferenceActions(input: BuildWritingProfileRequest) {
  const latestActions = new Map<string, { feedback: FeedbackEvidence; action: PreferenceAction }>()
  const feedbackByTime = [...input.feedbackEvidence].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  )

  for (const feedback of feedbackByTime) {
    const action = getPreferenceAction(feedback)
    if (
      action &&
      feedback.context.scope === input.scope &&
      isPersistedPreferenceAction(feedback, input)
    ) {
      latestActions.set(action.preferenceId, { feedback, action })
    }
  }
  return latestActions
}

function getIndependentEvidenceTypes(
  evidenceIds: string[],
  evidenceMetadata: Map<string, EvidenceMetadata>,
) {
  const typeByOrigin = new Map<string, string>()
  const typePriority = [
    'profile_correction',
    'manual_edit',
    'accepted_rewrite',
    'rejected_rewrite',
    'final_choice',
    'rewrite_preference',
    'snippet_reason',
    'snippet_label',
    'library_pattern',
  ]

  for (const evidenceId of evidenceIds) {
    const metadata = evidenceMetadata.get(evidenceId)
    if (!metadata) continue
    const currentType = typeByOrigin.get(metadata.originId)
    if (
      !currentType ||
      typePriority.indexOf(metadata.type) < typePriority.indexOf(currentType)
    ) {
      typeByOrigin.set(metadata.originId, metadata.type)
    }
  }

  return Array.from(typeByOrigin.values())
}

function getConfidenceLimit(independentEvidenceTypes: string[]) {
  if (independentEvidenceTypes.length === 1) {
    return independentEvidenceTypes[0] === 'profile_correction' ? 0.85 : 0.45
  }
  if (independentEvidenceTypes.length === 2) return 0.7

  const hasStrongEvidence = independentEvidenceTypes.some((type) =>
    ['profile_correction', 'manual_edit', 'final_choice'].includes(type),
  )
  return hasStrongEvidence ? 0.95 : 0.8
}

export function normalizeWriterModelOutput(
  value: unknown,
  input: BuildWritingProfileRequest,
) {
  if (!isRecord(value)) return value

  const evidenceMetadata = buildEvidenceMetadataMap(input)
  const feedbackById = buildFeedbackMap(input)
  const allowedDimensions = new Set(writingPreferenceDimensionSchema.options)
  const preferences: WritingPreference[] = Array.isArray(value.preferences)
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
              (id): id is string => typeof id === 'string' && evidenceMetadata.has(id),
            ),
          ),
        )
        if (evidenceIds.length === 0) return []

        const independentEvidenceTypes = getIndependentEvidenceTypes(
          evidenceIds,
          evidenceMetadata,
        )
        const rawConfidence =
          typeof preference.confidence === 'number' && Number.isFinite(preference.confidence)
            ? preference.confidence
            : 0
        const boundedConfidence = Math.min(
          Math.max(rawConfidence, 0),
          getConfidenceLimit(independentEvidenceTypes),
        )
        const feedbackEvidence = evidenceIds
          .map((id) => feedbackById.get(id))
          .filter((feedback): feedback is FeedbackEvidence => Boolean(feedback))
        const hasExplicitPreference = feedbackEvidence.some((feedback) => {
          if (feedback.type !== 'profile_correction') return false
          const action = getPreferenceAction(feedback)
          return !action || action.action === 'enable' || action.action === 'correct'
        })
        const hasLongTermEvidence = feedbackEvidence.some(
          (feedback) =>
            getLearningEvidence(feedback)?.category === 'long_term_habit' &&
            !getPreferenceAction(feedback),
        )
        const observedContentModes = Array.from(
          new Set(
            feedbackEvidence
              .map((feedback) => getLearningEvidence(feedback)?.contentMode)
              .filter(
                (mode): mode is WritingEditEvidence['contentMode'] =>
                  Boolean(mode) && mode !== 'unclassified',
              ),
          ),
        )
        const previousPreference = input.previousProfile?.preferences.find(
          (item) => item.id === preference.id,
        )
        const previousContentModes = previousPreference?.contentModes.filter(
          (mode) => mode !== 'unclassified' || observedContentModes.length === 0,
        ) ?? []
        const contentModes = hasLongTermEvidence
          ? []
          : previousPreference
            ? Array.from(
                new Set([
                  ...previousContentModes,
                  ...observedContentModes,
                ]),
              )
            : observedContentModes.length > 0
              ? observedContentModes
              : ['unclassified']
        const independentLibrarySourceIds = new Set(
          evidenceIds
            .filter((id) => !feedbackById.has(id))
            .map((id) => evidenceMetadata.get(id)?.originId)
            .filter(
              (originId): originId is string =>
                Boolean(originId) && originId !== 'library-note:unknown',
            ),
        )
        const strongFeedback = feedbackEvidence.filter((feedback) =>
          ['manual_edit', 'final_choice'].includes(feedback.type),
        )
        const strongFeedbackProjectIds = new Set(
          strongFeedback
            .map((feedback) => feedback.projectId)
            .filter((projectId): projectId is string => Boolean(projectId)),
        )
        const hasContradiction =
          Array.isArray(preference.contradictions) &&
          preference.contradictions.length > 0
        const canActivateFromFeedback =
          strongFeedback.length >= 2 &&
          (input.scope === 'project' || strongFeedbackProjectIds.size >= 2)
        const canActivateFromLibrary = independentLibrarySourceIds.size >= 2
        const canActivateFromRepeatedEvidence =
          (canActivateFromFeedback || canActivateFromLibrary) && !hasContradiction
        const confidence = canActivateFromRepeatedEvidence
          ? Math.max(boundedConfidence, 0.55)
          : boundedConfidence

        const normalizedPreference = writingPreferenceSchema.safeParse({
          ...preference,
          scope: input.scope,
          confidence,
          supportCount: evidenceIds.length,
          evidenceIds,
          sourceCategory: hasExplicitPreference
            ? 'long_term_habit'
            : 'pattern_preference',
          status:
            hasExplicitPreference ||
            (canActivateFromRepeatedEvidence && confidence >= 0.55)
              ? 'active'
              : 'candidate',
          contentModes,
        })
        return normalizedPreference.success ? [normalizedPreference.data] : []
      })
    : []

  const latestPreferenceActions = getLatestPreferenceActions(input)
  const controlledPreferenceIdByEvidenceId = new Map(
    Array.from(latestPreferenceActions.values())
      .filter(
        ({ action }) => action.action === 'enable' || action.action === 'correct',
      )
      .map(({ feedback, action }) => [feedback.id, action.preferenceId]),
  )
  const preferencesById = new Map(
    preferences
      .filter((preference) =>
        preference.evidenceIds.every((evidenceId) => {
          const controlledPreferenceId = controlledPreferenceIdByEvidenceId.get(evidenceId)
          return !controlledPreferenceId || controlledPreferenceId === preference.id
        }),
      )
      .slice(0, maxWritingPreferenceCount)
      .map((preference) => [String(preference.id), preference]),
  )

  for (const previousPreference of input.previousProfile?.preferences ?? []) {
    if (preferencesById.size >= maxWritingPreferenceCount) break
    if (!preferencesById.has(previousPreference.id)) {
      preferencesById.set(previousPreference.id, previousPreference)
    }
  }

  for (const [preferenceId, control] of latestPreferenceActions) {
    const current =
      preferencesById.get(preferenceId) ??
      input.previousProfile?.preferences.find((item) => item.id === preferenceId) ??
      control.action.snapshot
    if (!current) continue

    if (!preferencesById.has(preferenceId) && preferencesById.size >= maxWritingPreferenceCount) {
      const removablePreferenceId = Array.from(preferencesById.keys())
        .reverse()
        .find((id) => !latestPreferenceActions.has(id))
      if (removablePreferenceId) preferencesById.delete(removablePreferenceId)
    }

    if (control.action.action === 'disable') {
      preferencesById.set(preferenceId, { ...current, status: 'disabled' })
      continue
    }
    if (control.action.action === 'delete') {
      preferencesById.set(preferenceId, { ...current, status: 'rejected' })
      continue
    }

    const evidenceIds = evidenceMetadata.has(control.feedback.id)
      ? Array.from(new Set([...current.evidenceIds, control.feedback.id]))
      : current.evidenceIds
    preferencesById.set(preferenceId, {
      ...current,
      scope: input.scope,
      statement:
        control.action.action === 'correct' ? control.feedback.content : current.statement,
      application:
        control.action.action === 'correct'
          ? '未来写作直接遵循这条用户明确规则，当前任务的事实和明确要求仍然优先。'
          : current.application,
      confidence: Math.max(current.confidence, 0.85),
      supportCount: evidenceIds.length,
      evidenceIds,
      sourceCategory: 'long_term_habit',
      status: 'active',
      contentModes: current.contentModes,
    })
  }

  return {
    ...value,
    preferences: Array.from(preferencesById.values()),
    evidenceCount:
      input.libraryEvidence.notes.length +
      input.libraryEvidence.snippets.length +
      input.feedbackEvidence.length,
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
    feedbackEvidence: input.feedbackEvidence
      .filter((feedback) => isFeedbackVisibleToProfile(feedback, input))
      .slice(0, 240)
      .map((feedback) => ({
        id: feedback.id,
        projectId: feedback.projectId,
        type: feedback.type,
        content: trimText(feedback.content, 1600),
        context: trimText(JSON.stringify(feedback.context), 1400),
        learningEvidence: getLearningEvidence(feedback),
        preferenceAction: getPreferenceAction(feedback),
        appliedPreferenceIds: getAppliedPreferenceIds(feedback),
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
  'feedbackEvidence.appliedPreferenceIds 只表示这些规则曾作为上下文提供给对应 AI 操作，不表示模型一定采用了它，也不表示后续修改一定在反对它。必须结合 before、after 和 editSignal 判断修改是否真正支持、细化或冲突；不得把一次修改计为所有关联规则的共同证据。',
  'feedbackEvidence.learningEvidence 已将变化分为 fact_correction、draft_requirement、pattern_preference、long_term_habit。前两类只服务事实或本篇任务，不得进入 preference；后两类才是偏好证据。',
  'preferenceAction 是用户对已有规则的管理指令。disable、delete 不是写作偏好，不能据此生成新规则；enable 是明确确认，correct 的 content 是用户纠正后的规则。',
  '先判断修改原因。事实修正、名称替换、错别字、字数压缩和本次任务硬约束不是长期风格；只有可跨内容复用的选择才可进入 preference。',
  '学习替换关系时必须保留方向，例如“用户删除了什么、改成了什么、未来何时适用”；不要把修改前后的两种表达都写成偏好。',
  '不要因为用户偶尔保留一个网络词就推断其偏好口语化，也不要因为一次短句拆分就推断所有文案都应该短句化。',
  '目标不是模仿某篇参考文案，而是形成可持续更新、可用于初稿和改写的用户写作决策模型。',
  '证据优先级：profile_correction > manual_edit > accepted_rewrite/rejected_rewrite > final_choice > rewrite_preference > snippet reason > snippet label > repeated library pattern。',
  '每条 preferences 必须引用输入中真实存在的 evidence ID；不得编造证据、用户身份、经历或人口属性。',
  'scope=account 时，只保留跨项目仍成立的长期偏好；项目主题、受众和一次性要求只能进入 openQuestions，不能升级为账号偏好。',
  '账号级规则若只来自 feedbackEvidence，至少需要覆盖两个不同 projectId；同一项目中的重复修改只能在 project 画像中晋级，账号画像仍为 candidate。素材库共性可以作为独立账号级证据。',
  '晋级时按独立来源计数，而不是按原始 evidence ID 计数。同一篇 note 本身及其全部 snippets 只算一个素材来源；只有至少两篇不同 note 一致支持、没有 contradictions 的素材库规律才可自动成为 active。',
  'scope=account 只表示偏好可跨项目长期保存，不表示它适用于所有内容模式。同一账号可以同时有品牌叙事、产品说明、活动互动、事件通知和日常热点等不同写法，不得平均成一个全局语气。',
  'scope=project 时，可以记录当前项目覆盖，但 preference.scope 必须为 project。',
  'profile_correction 和 preferenceAction 只作用于 context.scope 指定的画像，不得把项目规则的确认、纠正、停用或删除同步到账号画像，反之亦然。',
  '每条 preference 都要判断迁移边界。若证据只来自一种内容模式，application 必须明确写出适用模式和触发条件；只有证据覆盖至少两种不同内容模式，或用户通过 profile_correction 明确说明是长期通用习惯，才可写成跨模式默认规则。',
  '事实准确、不得编造、不得照抄参考等正确性约束可以跨模式成立；账号自称、互动动作、句长、分行、双关和结尾方式默认是模式相关偏好，除非有跨模式证据。',
  '输出前先按“同一方向、同一适用条件、同一未来动作”聚类证据。多条修改共享同一种表层变化时，应由一条 preference 引用全部支持证据；不得把重叠结论拆成多条各自只有一个 evidenceId 的候选。',
  '聚类必须发生在“未来写作动作”层，而不是素材标签层。比如“用第一天、第三天、现在推进”“按实际使用顺序讲”“用时间点和可观察动作代替逐渐熟练”都要求未来草稿用具体过程承载变化，应合并为一条 progression preference，并引用各自真实证据；不能拆成时间、顺序、动作三条候选。反常识开头若要求的是不同写作动作，可以单独保留。',
  '保留两条 candidate 之前，必须检查它们的 application 是否会让未来草稿执行实质不同的操作。若只是同一机制的主题、标签、例子或表层表现不同，合并而不是分别等待验证；不得因为拆分导致原本跨独立来源的共性永远停留在 candidate。',
  '单条非明确纠正证据只能形成待验证偏好，confidence 不得高于 0.45；单条 profile_correction 可达到 0.85；两条一致独立证据不得高于 0.7；三条以上且包含明确纠正、手动改稿或最终选择时才可高于 0.8。',
  '两条以上一致的手动修改或最终选择被同一条 preference 引用、没有 contradictions 且已满足当前 scope 的晋级门槛时，confidence 不应低于 0.55；不得为凑数量重复引用同一证据。',
  'supportCount 必须等于该偏好引用的去重 evidenceIds 数量；晋级门槛另按独立来源判断，同一篇 note 的多个 evidenceIds 不能重复计为多个来源。出现冲突时保留在 contradictions，不要平均成模糊结论。',
  'status 只能表达证据成熟度：单条非明确证据必须为 candidate；重复一致证据或用户明确确认才可为 active。disabled 和 rejected 只由系统根据用户管理动作写入。',
  'contentModes 记录证据真实覆盖的内容模式。只有 long_term_habit 明确纠正才可为空数组表示通用；纯素材证据无法可靠建立内容模式时使用 unclassified，不能据素材主题猜测为全场景规则。',
  `dimension 只能是以下值之一：${writingPreferenceDimensionSchema.options.join(', ')}。无法归类时不要输出该条 preference。`,
  'application 必须明确说明未来写作怎么选内容、组织结构或处理措辞，不能只写“更自然”“更像用户”。',
  'previousProfile 是需要持续维护的上一版假设。没有相关新证据时保留原 ID、状态、证据和适用模式，不得因本轮模型漏项而静默遗忘；新证据支持时强化，冲突时使用同一 ID 降低置信度并写入 contradictions，用户明确纠正时更新，只有 preferenceAction 可以停用、删除或恢复。',
  '新证据与 previousProfile 中已有 preference 同方向时，必须沿用原 ID，追加真实 evidenceIds 并重新校准状态；不要为同义或上下位关系的规则另建新 ID。',
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
  version: '1.4.4',
  taskType: 'profile-learn',
  model: 'deepseek-v4-flash',
  maxTokens: 3200,
  temperature: 0,
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
