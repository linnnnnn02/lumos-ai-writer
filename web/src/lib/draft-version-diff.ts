import type { DraftCopy } from '@/lib/draft-versions'

export type DraftParagraphDiff = {
  kind: 'unchanged' | 'modified' | 'added' | 'removed'
  beforeIndex?: number
  afterIndex?: number
  before?: string
  after?: string
}

export type DraftVersionDiff = {
  title: {
    changed: boolean
    before: string
    after: string
  }
  paragraphs: DraftParagraphDiff[]
  summary: {
    added: number
    modified: number
    removed: number
    unchanged: number
  }
}

type RawParagraphDiff = {
  kind: 'unchanged' | 'added' | 'removed'
  beforeIndex?: number
  afterIndex?: number
  before?: string
  after?: string
}

function alignDraftParagraphs(before: string[], after: string[]): RawParagraphDiff[] {
  const longestCommonSubsequence = Array.from({ length: before.length + 1 }, () =>
    Array<number>(after.length + 1).fill(0),
  )

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      longestCommonSubsequence[beforeIndex][afterIndex] =
        before[beforeIndex] === after[afterIndex]
          ? longestCommonSubsequence[beforeIndex + 1][afterIndex + 1] + 1
          : Math.max(
              longestCommonSubsequence[beforeIndex + 1][afterIndex],
              longestCommonSubsequence[beforeIndex][afterIndex + 1],
            )
    }
  }

  const aligned: RawParagraphDiff[] = []
  let beforeIndex = 0
  let afterIndex = 0

  while (beforeIndex < before.length || afterIndex < after.length) {
    if (
      beforeIndex < before.length &&
      afterIndex < after.length &&
      before[beforeIndex] === after[afterIndex]
    ) {
      aligned.push({
        kind: 'unchanged',
        beforeIndex: beforeIndex + 1,
        afterIndex: afterIndex + 1,
        before: before[beforeIndex],
        after: after[afterIndex],
      })
      beforeIndex += 1
      afterIndex += 1
      continue
    }

    const shouldRemove =
      beforeIndex < before.length &&
      (afterIndex >= after.length ||
        longestCommonSubsequence[beforeIndex + 1][afterIndex] >=
          longestCommonSubsequence[beforeIndex][afterIndex + 1])

    if (shouldRemove) {
      aligned.push({
        kind: 'removed',
        beforeIndex: beforeIndex + 1,
        before: before[beforeIndex],
      })
      beforeIndex += 1
      continue
    }

    aligned.push({
      kind: 'added',
      afterIndex: afterIndex + 1,
      after: after[afterIndex],
    })
    afterIndex += 1
  }

  return aligned
}

function paragraphSimilarity(before: string, after: string) {
  const normalize = (value: string) => Array.from(value.replace(/\s/g, ''))
  const toBigrams = (value: string) => {
    const characters = normalize(value)
    if (characters.length < 2) return characters
    return characters.slice(0, -1).map((character, index) =>
      `${character}${characters[index + 1]}`,
    )
  }
  const beforeBigrams = toBigrams(before)
  const afterBigrams = toBigrams(after)
  if (beforeBigrams.length === 0 && afterBigrams.length === 0) return 1
  if (beforeBigrams.length === 0 || afterBigrams.length === 0) return 0

  const remaining = new Map<string, number>()
  beforeBigrams.forEach((bigram) => {
    remaining.set(bigram, (remaining.get(bigram) ?? 0) + 1)
  })
  let overlap = 0
  afterBigrams.forEach((bigram) => {
    const count = remaining.get(bigram) ?? 0
    if (count === 0) return
    overlap += 1
    remaining.set(bigram, count - 1)
  })
  return (2 * overlap) / (beforeBigrams.length + afterBigrams.length)
}

function alignChangedGroup(
  removed: RawParagraphDiff[],
  added: RawParagraphDiff[],
): DraftParagraphDiff[] {
  const gapPenalty = -0.7
  const scores = Array.from({ length: removed.length + 1 }, () =>
    Array<number>(added.length + 1).fill(0),
  )
  const actions = Array.from({ length: removed.length + 1 }, () =>
    Array<'modified' | 'removed' | 'added' | null>(added.length + 1).fill(null),
  )

  for (let beforeIndex = 1; beforeIndex <= removed.length; beforeIndex += 1) {
    scores[beforeIndex][0] = beforeIndex * gapPenalty
    actions[beforeIndex][0] = 'removed'
  }
  for (let afterIndex = 1; afterIndex <= added.length; afterIndex += 1) {
    scores[0][afterIndex] = afterIndex * gapPenalty
    actions[0][afterIndex] = 'added'
  }

  for (let beforeIndex = 1; beforeIndex <= removed.length; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= added.length; afterIndex += 1) {
      const similarity = paragraphSimilarity(
        removed[beforeIndex - 1].before ?? '',
        added[afterIndex - 1].after ?? '',
      )
      const modifiedScore =
        scores[beforeIndex - 1][afterIndex - 1] + similarity * 2 - 0.25
      const removedScore = scores[beforeIndex - 1][afterIndex] + gapPenalty
      const addedScore = scores[beforeIndex][afterIndex - 1] + gapPenalty
      const bestScore = Math.max(modifiedScore, removedScore, addedScore)
      scores[beforeIndex][afterIndex] = bestScore
      actions[beforeIndex][afterIndex] =
        bestScore === modifiedScore
          ? 'modified'
          : bestScore === removedScore
            ? 'removed'
            : 'added'
    }
  }

  const group: DraftParagraphDiff[] = []
  let beforeIndex = removed.length
  let afterIndex = added.length
  while (beforeIndex > 0 || afterIndex > 0) {
    const action = actions[beforeIndex][afterIndex]
    if (action === 'modified') {
      const beforeParagraph = removed[beforeIndex - 1]
      const afterParagraph = added[afterIndex - 1]
      group.push({
        kind: 'modified',
        beforeIndex: beforeParagraph.beforeIndex,
        afterIndex: afterParagraph.afterIndex,
        before: beforeParagraph.before,
        after: afterParagraph.after,
      })
      beforeIndex -= 1
      afterIndex -= 1
    } else if (action === 'removed') {
      group.push(removed[beforeIndex - 1])
      beforeIndex -= 1
    } else {
      group.push(added[afterIndex - 1])
      afterIndex -= 1
    }
  }

  return group.reverse()
}

function pairChangedParagraphs(aligned: RawParagraphDiff[]): DraftParagraphDiff[] {
  const result: DraftParagraphDiff[] = []
  let pendingRemoved: RawParagraphDiff[] = []
  let pendingAdded: RawParagraphDiff[] = []

  const flushPending = () => {
    result.push(...alignChangedGroup(pendingRemoved, pendingAdded))
    pendingRemoved = []
    pendingAdded = []
  }

  aligned.forEach((paragraph) => {
    if (paragraph.kind === 'unchanged') {
      flushPending()
      result.push(paragraph)
      return
    }
    if (paragraph.kind === 'removed') {
      pendingRemoved.push(paragraph)
      return
    }
    pendingAdded.push(paragraph)
  })
  flushPending()

  return result
}

export function buildDraftVersionDiff(
  before: DraftCopy,
  after: DraftCopy,
): DraftVersionDiff {
  const paragraphs = pairChangedParagraphs(alignDraftParagraphs(before.body, after.body))

  return {
    title: {
      changed: before.title !== after.title,
      before: before.title,
      after: after.title,
    },
    paragraphs,
    summary: {
      added: paragraphs.filter((paragraph) => paragraph.kind === 'added').length,
      modified: paragraphs.filter((paragraph) => paragraph.kind === 'modified').length,
      removed: paragraphs.filter((paragraph) => paragraph.kind === 'removed').length,
      unchanged: paragraphs.filter((paragraph) => paragraph.kind === 'unchanged').length,
    },
  }
}
