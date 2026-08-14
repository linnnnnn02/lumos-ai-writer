import type { AiDraftCopy } from '@lumos-ai/shared'
import { z } from 'zod'

export type BlindArm = 'baseline' | 'personalized'
export type BlindWinner = 'first' | 'second' | 'tie'

export const blindJudgeResultSchema = z
  .object({
    winner: z.enum(['first', 'second', 'tie']),
    confidence: z.enum(['low', 'medium', 'high']),
    preferenceFit: z.object({
      first: z.number().int().min(0).max(4),
      second: z.number().int().min(0).max(4),
    }),
    factualReliability: z.object({
      first: z.number().int().min(0).max(4),
      second: z.number().int().min(0).max(4),
    }),
    naturalness: z.object({
      first: z.number().int().min(0).max(4),
      second: z.number().int().min(0).max(4),
    }),
    unsupportedClaims: z.object({
      first: z.array(z.string().trim().min(1).max(300)).max(8),
      second: z.array(z.string().trim().min(1).max(300)).max(8),
    }),
    reasons: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    for (const arm of ['first', 'second'] as const) {
      if (
        value.unsupportedClaims[arm].length > 0 &&
        value.factualReliability[arm] > 2
      ) {
        context.addIssue({
          code: 'custom',
          path: ['factualReliability', arm],
          message:
            'A draft with unsupported claims cannot receive factual reliability above 2.',
        })
      }
    }
  })

export type BlindJudgeResult = z.infer<typeof blindJudgeResultSchema>

export type BlindPair = {
  id: string
  firstArm: BlindArm
  secondArm: BlindArm
  firstDraft: AiDraftCopy
  secondDraft: AiDraftCopy
}

const clichePatterns = [
  { label: '治愈', pattern: /治愈/g },
  { label: '松弛感', pattern: /松弛感/g },
  { label: '仪式感', pattern: /仪式感/g },
  { label: '热爱生活', pattern: /热爱生活/g },
  { label: '生活的意义', pattern: /生活的意义/g },
  { label: '平凡的美好', pattern: /平凡(?:里|中|的)?(?:也有|自有|藏着|藏了)?(?:一点|属于自己的)?美好/g },
  { label: '给生活一点', pattern: /给生活(?:加上|留出|多留|添上)?一点/g },
]

function draftText(draft: AiDraftCopy) {
  return [draft.title, ...draft.body].join('\n')
}

function countPattern(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

export function scoreLanguagePreference(
  draft: AiDraftCopy,
  concreteEndingTerms: string[],
) {
  const text = draftText(draft)
  const ending = draft.body.at(-1) ?? ''
  const clicheTerms = clichePatterns
    .map(({ label, pattern }) => ({ label, count: countPattern(text, pattern) }))
    .filter(({ count }) => count > 0)
  const clicheHits = clicheTerms.reduce((total, item) => total + item.count, 0)
  const concreteEndingTermHits = concreteEndingTerms.filter((term) =>
    ending.includes(term),
  ).length

  return {
    clicheHits,
    clicheTerms,
    concreteEndingTermHits,
    endsOnConcreteDetail: concreteEndingTermHits > 0 && clicheHits === 0,
    score:
      (clicheHits === 0 ? 4 : -2 * clicheHits) +
      Math.min(concreteEndingTermHits, 2),
  }
}

export function buildBlindPair(
  id: string,
  pairIndex: number,
  baseline: AiDraftCopy,
  personalized: AiDraftCopy,
): BlindPair {
  const personalizedFirst = pairIndex % 2 === 1
  return personalizedFirst
    ? {
        id,
        firstArm: 'personalized',
        secondArm: 'baseline',
        firstDraft: personalized,
        secondDraft: baseline,
      }
    : {
        id,
        firstArm: 'baseline',
        secondArm: 'personalized',
        firstDraft: baseline,
        secondDraft: personalized,
      }
}

export function resolveBlindWinner(
  pair: Pick<BlindPair, 'firstArm' | 'secondArm'>,
  winner: BlindWinner,
): BlindArm | 'tie' {
  if (winner === 'tie') return 'tie'
  return winner === 'first' ? pair.firstArm : pair.secondArm
}

function combinations(n: number, k: number) {
  if (k < 0 || k > n) return 0
  const smallerK = Math.min(k, n - k)
  let result = 1
  for (let index = 1; index <= smallerK; index += 1) {
    result = (result * (n - smallerK + index)) / index
  }
  return result
}

export function twoSidedSignTestPValue(
  personalizedWins: number,
  baselineWins: number,
) {
  const decisivePairs = personalizedWins + baselineWins
  if (decisivePairs === 0) return 1

  const smallerWinCount = Math.min(personalizedWins, baselineWins)
  let lowerTail = 0
  for (let wins = 0; wins <= smallerWinCount; wins += 1) {
    lowerTail += combinations(decisivePairs, wins) / 2 ** decisivePairs
  }
  return Math.min(1, lowerTail * 2)
}

export function summarizeBlindResults(
  results: Array<{
    pair: Pick<BlindPair, 'firstArm' | 'secondArm'>
    judge: Pick<BlindJudgeResult, 'winner'>
  }>,
) {
  let personalizedWins = 0
  let baselineWins = 0
  let ties = 0
  let firstPositionWins = 0
  let secondPositionWins = 0

  for (const result of results) {
    if (result.judge.winner === 'first') firstPositionWins += 1
    if (result.judge.winner === 'second') secondPositionWins += 1

    const resolved = resolveBlindWinner(result.pair, result.judge.winner)
    if (resolved === 'personalized') personalizedWins += 1
    if (resolved === 'baseline') baselineWins += 1
    if (resolved === 'tie') ties += 1
  }

  const decisivePairs = personalizedWins + baselineWins
  return {
    totalPairs: results.length,
    decisivePairs,
    personalizedWins,
    baselineWins,
    ties,
    personalizedWinRate:
      decisivePairs === 0 ? null : personalizedWins / decisivePairs,
    twoSidedSignTestPValue: twoSidedSignTestPValue(
      personalizedWins,
      baselineWins,
    ),
    positionCheck: {
      firstPositionWins,
      secondPositionWins,
    },
  }
}
