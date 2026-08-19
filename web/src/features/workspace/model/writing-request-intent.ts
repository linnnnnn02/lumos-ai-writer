import type { ProjectLength, SavedNoteRecord } from '@lumos-ai/shared'
import type { WritingBrief } from '@/features/workspace/model/workspace-model'

export type ReferenceRecommendation = {
  noteId: string
  reason: string
}

export const DEFAULT_TARGET_AUDIENCE = '未特别指定，按本次需求自然判断'

export type OptionalBriefQuestion = {
  id: 'facts' | 'audience' | 'boundaries' | 'length'
  label: string
  prompt: string
  inputPrefix: string
}

const recommendationStopTerms = new Set([
  '一篇',
  '一个',
  '一条',
  '一款',
  '关于',
  '内容',
  '希望',
  '需要',
  '文案',
  '真实',
  '可以',
  '自己',
  '用户',
  '这个',
  '想写',
  '写作',
  '产品',
  '说明',
  '强调',
  '突出',
  '以内',
  '左右',
  '第二天',
  '皮肤',
  '肌肤',
  '语气',
  '不要',
  '避免',
  '夸张',
  '广告',
])

const productRequestPattern =
  /(?:产品|精华|面膜|乳液|乳霜|面霜|洁面|洗发|护发|唇膏|卸妆|咖啡|饮品|鞋|袜|服装|设备|工具|课程|服务)/u
const campaignRequestPattern =
  /(?:活动|抽奖|盲盒|福利|奖品|勋章|限定|联名|征集|挑战|竞猜|报名|预约|上新|发布)/u
const experienceRequestPattern = /(?:体验|测评|路线|探店|攻略|复盘|游记|使用感受)/u
const concreteRequestFactPattern =
  /(?:\d{1,4}\s*(?:年|月|日|号|点|时|分|字|元|公里|分钟|小时|版本)|即日起|截至|截止|包含|名为|有机会|抽中|集齐|SSR|APP\s*ICON)/iu
const explicitLengthPattern =
  /(?:(?:不超过|控制在|限制在|约|大约)\s*)?\d{1,4}\s*(?:字|字符)(?:以内|内|左右|上下)?|一句话|一行|极短|短文|短篇|中篇|中等篇幅|简短|精简|简洁|短一点|短一些|长一点|长一些|详细一点|详细一些|展开一些|长文|长篇|深度|详细展开|完整复盘|系统梳理/u

export function hasExplicitLengthPreference(writingRequest: string) {
  return explicitLengthPattern.test(writingRequest)
}

export function inferTargetAudienceFromWritingRequest(writingRequest: string) {
  const normalizedRequest = writingRequest.replace(/\s+/g, ' ').trim()
  const match = normalizedRequest.match(
    /(?:(?:目标读者|目标人群|受众)\s*(?:是|为|：|:)?|(?:面向|写给)\s*)([^。！？；\n]{2,160})/u,
  )
  const candidate = match?.[1]
    ?.split(/(?:写作目标|核心信息|表达要求|表达边界|篇幅|必须保留|希望保留)/u)[0]
    ?.replace(/^[：:\s]+|[，,\s]+$/gu, '')
    .trim()

  return candidate && candidate.length >= 2 ? candidate : ''
}

export function isOptionalBriefSkipReply(value: string) {
  const normalizedValue = value.trim()
  return (
    /^(?:没有|无|不用|不需要|无需|先这样|就这样|暂不补充)(?:补充(?:信息|内容)?)?[。！!\s]*$/u.test(
      normalizedValue,
    ) || isDirectGenerationReply(normalizedValue)
  )
}

export function isDirectGenerationReply(value: string) {
  return /^(?:(?:我)?(?:不补充了?|不用补充|不需要补充|无需补充)[，,、\s]*)?(?:直接生成|按现有信息生成)(?:初稿|文案)?[。！!\s]*$/u.test(
    value.trim(),
  )
}

export function buildOptionalBriefQuestions(input: {
  writingRequest: string
  targetAudience: string
  brief: WritingBrief
}): OptionalBriefQuestion[] {
  const request = input.writingRequest.trim()
  const questions: OptionalBriefQuestion[] = []
  const isCampaign = campaignRequestPattern.test(request)
  const isProduct = productRequestPattern.test(request)
  const isExperience = experienceRequestPattern.test(request)
  const hasFacts =
    input.brief.requiredFacts.trim().length > 0 || concreteRequestFactPattern.test(request)
  const hasSpecificAudience =
    input.targetAudience.trim().length > 0 &&
    input.targetAudience.trim() !== DEFAULT_TARGET_AUDIENCE

  if (!hasFacts && (isCampaign || isProduct || isExperience)) {
    questions.push({
      id: 'facts',
      label: '补充关键信息',
      prompt: isCampaign
        ? '活动名称、时间、参与规则或奖品里，有必须写准的信息吗？'
        : isProduct
          ? '有必须保留的产品信息或真实体验吗？'
          : '有必须保留的真实经历或具体数据吗？',
      inputPrefix: '必须保留：',
    })
  }

  if (!hasSpecificAudience) {
    questions.push({
      id: 'audience',
      label: '补充目标读者',
      prompt: '这篇有特别想写给或打动的人吗？',
      inputPrefix: '目标读者：',
    })
  }

  if (!input.brief.boundaries.trim() && (isCampaign || isProduct)) {
    questions.push({
      id: 'boundaries',
      label: '补充表达边界',
      prompt: '有没有不能写的承诺，或想避开的表达？',
      inputPrefix: '表达边界：',
    })
  }

  if (!hasExplicitLengthPreference(request)) {
    questions.push({
      id: 'length',
      label: '补充篇幅偏好',
      prompt: '篇幅有偏好吗？不说明时会按中等篇幅处理。',
      inputPrefix: '篇幅：',
    })
  }

  return questions.slice(0, 2)
}

function getRequestTerms(writingRequest: string) {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

  return Array.from(
    new Set(
      Array.from(segmenter.segment(writingRequest), (part) => part.segment.trim())
        .filter((term) => term.length >= 2)
        .filter((term) => !recommendationStopTerms.has(term))
        .filter((term) => !/^\d+$/u.test(term))
        .filter((term) => !/[，。！？、：；,.!?;:]/u.test(term)),
    ),
  )
}

function getRequestedCharacterCount(writingRequest: string) {
  const matches = Array.from(
    writingRequest.matchAll(/(\d{1,4})\s*(?:字|字符)(?:以内|内|左右|上下)?/gu),
  )
  const values = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0)

  return values.length > 0 ? Math.max(...values) : null
}

export function inferProjectLengthFromWritingRequest(writingRequest: string): ProjectLength {
  const characterCount = getRequestedCharacterCount(writingRequest)
  if (characterCount !== null) {
    if (characterCount <= 200) return 'short'
    if (characterCount <= 600) return 'medium'
    return 'long'
  }

  if (/(?:一句话|一行|极短|短文|短篇|简短|精简|简洁|短一点|短一些)/u.test(writingRequest)) {
    return 'short'
  }
  if (/(?:长一点|长一些|详细一点|详细一些|展开一些)/u.test(writingRequest)) {
    return 'medium'
  }
  if (/(?:长文|长篇|深度|详细展开|完整复盘|系统梳理)/u.test(writingRequest)) {
    return 'long'
  }

  return 'medium'
}

export function inferWritingBriefFromRequest(writingRequest: string): WritingBrief {
  const normalizedRequest = writingRequest.replace(/\s+/g, ' ').trim()
  const objectiveMatch = normalizedRequest.match(
    /(?:写作目标|创作目标|目的)\s*(?:是|为|：|:)?\s*([^。！？；]{2,160})/u,
  )
  const factMatch = normalizedRequest.match(
    /(?:强调|突出|重点(?:写出|写|是)?|必须(?:包含|写到|保留|出现)?|需要(?:包含|写到|保留)|希望保留)\s*[:：]?\s*([^。！？；]{2,120})/u,
  )
  const factText =
    factMatch?.[1]
      ?.replace(/^(?:的?是)\s*/u, '')
      .replace(/，(?:语气|口吻|风格|不要|避免).*$/u, '')
      .trim() ?? ''
  const boundaryText = normalizedRequest
    .split(/[。！？；]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => {
      const boundaryIndex = sentence.search(
        /(?:表达边界|不要|避免|不希望|不能|无需|语气|口吻|风格|克制|留白|广告腔)/u,
      )
      return boundaryIndex >= 0 ? sentence.slice(boundaryIndex) : ''
    })
    .filter(Boolean)
    .join('；')
  const lengthRequirement = normalizedRequest.match(
    /(?:(?:不超过|控制在|限制在|约|大约)\s*)?\d{1,4}\s*(?:字|字符)(?:以内|内|左右|上下)?/u,
  )?.[0]

  return {
    objective: objectiveMatch?.[1]?.trim() ?? '',
    requiredFacts: factText
      ? productRequestPattern.test(normalizedRequest)
        ? `使用后可确认的产品体验：${factText}`
        : `需要保留的信息：${factText}`
      : '',
    boundaries: boundaryText,
    instructions: lengthRequirement ? `篇幅要求：${lengthRequirement}。` : '',
  }
}

export function buildReferenceRecommendations(
  writingRequest: string,
  notes: SavedNoteRecord[],
  preferredFolderId?: string,
): ReferenceRecommendation[] {
  const terms = getRequestTerms(writingRequest)
  if (terms.length === 0) return []

  return notes
    .map((note) => {
      const source = `${note.title}\n${note.contentText}`
      const matches = terms.filter((term) => source.includes(term))
      const titleMatches = matches.filter((term) => note.title.includes(term))
      const isPreferredFolder = Boolean(preferredFolderId && note.folderId === preferredFolderId)

      return {
        noteId: note.id,
        isPreferredFolder,
        score: matches.length * 2 + titleMatches.length * 3 + (isPreferredFolder ? 2 : 0),
        matches: Array.from(new Set([...titleMatches, ...matches])).slice(0, 3),
      }
    })
    .filter((item) => item.matches.length >= 1)
    .sort((first, second) => {
      if (first.isPreferredFolder !== second.isPreferredFolder) {
        return first.isPreferredFolder ? -1 : 1
      }
      return second.score - first.score
    })
    .slice(0, 4)
    .map((item) => ({
      noteId: item.noteId,
      reason: item.isPreferredFolder
        ? `来自优先参考文件夹，并覆盖需求中的“${item.matches.join('、')}”。`
        : `覆盖需求中的“${item.matches.join('、')}”，可作为表达结构参考。`,
    }))
}
