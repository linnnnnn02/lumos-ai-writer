import assert from 'node:assert/strict'
import {
  blindJudgeResultSchema,
  buildBlindPair,
  resolveBlindWinner,
  scoreLanguagePreference,
  summarizeBlindResults,
  twoSidedSignTestPValue,
} from './writing-profile-blind-eval.js'

const baseline = {
  title: '把晚上留给一点仪式感',
  body: ['十点关掉电脑，把杯子放进水池。', '普通的一晚，也有平凡的美好。'],
}
const personalized = {
  title: '十点以后，我先把桌面收干净',
  body: ['十点关掉电脑，把杯子放进水池。', '最后把笔记本收进抽屉。'],
}

const baselineScore = scoreLanguagePreference(baseline, ['笔记本', '抽屉'])
const personalizedScore = scoreLanguagePreference(personalized, ['笔记本', '抽屉'])
assert.equal(baselineScore.clicheHits, 2)
assert.equal(baselineScore.endsOnConcreteDetail, false)
assert.equal(personalizedScore.clicheHits, 0)
assert.equal(personalizedScore.endsOnConcreteDetail, true)
assert.ok(personalizedScore.score > baselineScore.score)

const pairs = Array.from({ length: 6 }, (_, index) =>
  buildBlindPair(`pair-${index + 1}`, index, baseline, personalized),
)
assert.deepEqual(
  pairs.map((pair) => pair.firstArm),
  ['baseline', 'personalized', 'baseline', 'personalized', 'baseline', 'personalized'],
)
assert.equal(resolveBlindWinner(pairs[0], 'second'), 'personalized')
assert.equal(resolveBlindWinner(pairs[1], 'first'), 'personalized')
assert.equal(resolveBlindWinner(pairs[0], 'tie'), 'tie')

assert.equal(twoSidedSignTestPValue(6, 0), 0.03125)
assert.equal(twoSidedSignTestPValue(5, 1), 0.21875)
assert.equal(twoSidedSignTestPValue(0, 0), 1)

const judge = blindJudgeResultSchema.parse({
  winner: 'second',
  confidence: 'high',
  preferenceFit: { first: 1, second: 4 },
  factualReliability: { first: 4, second: 4 },
  naturalness: { first: 2, second: 4 },
  unsupportedClaims: { first: [], second: [] },
  reasons: ['第二份停在具体动作上，没有抽象拔高。'],
})
assert.throws(() =>
  blindJudgeResultSchema.parse({
    ...judge,
    factualReliability: { first: 4, second: 4 },
    unsupportedClaims: {
      first: ['补充了输入没有的状态。'],
      second: [],
    },
  }),
)
const summary = summarizeBlindResults([
  { pair: pairs[0], judge },
  {
    pair: pairs[1],
    judge: { ...judge, winner: 'first' },
  },
  {
    pair: pairs[2],
    judge: { ...judge, winner: 'tie' },
  },
])
assert.equal(summary.personalizedWins, 2)
assert.equal(summary.baselineWins, 0)
assert.equal(summary.ties, 1)
assert.equal(summary.personalizedWinRate, 1)
assert.deepEqual(summary.positionCheck, {
  firstPositionWins: 1,
  secondPositionWins: 1,
})

console.log('Writing-profile blind benchmark evaluation passed.')
