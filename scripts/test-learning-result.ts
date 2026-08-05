import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { aiAnalysisResultSchema } from '@lumos-ai/shared'
import { buildLearningResultViewModel } from '../web/src/features/workspace/analysis/learning-result-model.js'

const fixture = JSON.parse(
  readFileSync(
    new URL('../server/api/scripts/fixtures/analysis-v1-output.json', import.meta.url),
    'utf8',
  ),
) as unknown

const analysis = aiAnalysisResultSchema.parse(fixture)
const cloudResult = buildLearningResultViewModel(analysis, true)

assert.equal(cloudResult.conclusion, analysis.coreJudgement)
assert.deepEqual(cloudResult.patterns, analysis.aiLearningMethod.reusableMechanisms)
assert.equal(cloudResult.evidenceSummary, analysis.evidence)
assert.deepEqual(cloudResult.evidenceItems, [
  {
    quote: analysis.featuredSnippets[0]?.quote,
    source: analysis.featuredSnippets[0]?.noteTitle,
    reason: analysis.featuredSnippets[0]?.reason,
  },
])
assert.equal(cloudResult.applicability.modeLabel, '按当前需求判断')
assert.equal(cloudResult.applicability.confidenceLabel, '仅作初步参考')
assert.match(cloudResult.applicability.boundary, /不要把一次通勤写成彻底改变生活/)
assert.deepEqual(cloudResult.pendingItems, [analysis.preferenceQuestion])
assert.match(cloudResult.memory.current, /当前初稿/)
assert.match(cloudResult.memory.longTerm, /单次结论不会自动变成永久规则/)

const localResult = buildLearningResultViewModel(analysis, false)
assert.match(localResult.memory.longTerm, /不会把这次结论写入跨设备表达档案/)

console.log('learning result view model passed')
