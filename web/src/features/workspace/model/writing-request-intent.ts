import type { ProjectLength, SavedNoteRecord } from '@lumos-ai/shared'
import type { WritingBrief } from '@/features/workspace/model/workspace-model'

export type ReferenceRecommendation = {
  noteId: string
  reason: string
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

  if (/(?:一句话|一行|极短|短文|短篇|简短|精简|简洁)/u.test(writingRequest)) {
    return 'short'
  }
  if (/(?:长文|长篇|深度|详细展开|完整复盘|系统梳理)/u.test(writingRequest)) {
    return 'long'
  }

  return 'medium'
}

export function inferWritingBriefFromRequest(writingRequest: string): WritingBrief {
  const normalizedRequest = writingRequest.replace(/\s+/g, ' ').trim()
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
        /(?:不要|避免|不希望|不能|无需|语气|口吻|风格|克制|留白|广告腔)/u,
      )
      return boundaryIndex >= 0 ? sentence.slice(boundaryIndex) : ''
    })
    .filter(Boolean)
    .join('；')
  const lengthRequirement = normalizedRequest.match(
    /(?:(?:不超过|控制在|限制在|约|大约)\s*)?\d{1,4}\s*(?:字|字符)(?:以内|内|左右|上下)?/u,
  )?.[0]

  return {
    objective: '',
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
