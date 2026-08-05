import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  generateDraftRequestSchema,
  type AiDraftCopy,
} from '@lumos-ai/shared'
import {
  buildDraftQualitySnapshot,
  getDraftAuditRequirements,
  validateDraftGroundingAuditOutput,
} from '../server/api/src/skills/draft-v1/index.js'
import {
  evolveDraftVersions,
  recheckDraftQualitySnapshot,
} from '../web/src/lib/draft-versions.js'

const fixture = JSON.parse(
  readFileSync(
    new URL('../server/api/scripts/fixtures/draft-v1-input.json', import.meta.url),
    'utf8',
  ),
) as unknown

const input = generateDraftRequestSchema.parse({
  ...(fixture as Record<string, unknown>),
  length: 'short',
  topic: '四双足球主题袜子都带有十号元素',
  targetAudience: '喜欢足球的人',
  notes: [],
  snippets: [],
  brief: {
    mustInclude: '有四双足球主题袜子，每双都带有十号元素。',
    avoidTone: '不得断言读者支持的球队已晋级或淘汰。',
    objective: '介绍四双足球主题袜子',
    sourceFacts: '有四双足球主题袜子，每双都带有十号元素。',
    instructions: '保持克制',
    allowConservativeDraft: false,
    contentMode: 'auto',
    facts: [
      {
        id: 'socks',
        statement: '有四双足球主题袜子，每双都带有十号元素。',
        required: true,
      },
    ],
  },
})

assert.deepEqual(getDraftAuditRequirements(input), [
  {
    id: 'fact-socks',
    kind: 'required_fact',
    statement: '有四双足球主题袜子，每双都带有十号元素。',
  },
  {
    id: 'boundary-1',
    kind: 'expression_boundary',
    statement: '不得断言读者支持的球队已晋级或淘汰。',
  },
])

const draft: AiDraftCopy = {
  title: '今晚还看球吗',
  body: ['四双足球主题袜子，每双都带着十号元素。', '你的主队还在吗？今晚先挑一双喜欢的。'],
}
const audit = validateDraftGroundingAuditOutput(
  {
    assertions: [
      {
        quote: '四双足球主题袜子',
        classification: 'supported',
        reason: 'brief.facts 明确给出。',
      },
    ],
    requirements: [
      {
        id: 'fact-socks',
        kind: 'required_fact',
        status: 'satisfied',
        evidence: ['四双足球主题袜子', '十号元素'],
        reason: '正文覆盖主体、数量和十号元素。',
      },
      {
        id: 'boundary-1',
        kind: 'expression_boundary',
        status: 'satisfied',
        evidence: [],
        reason: '正文没有断言球队已晋级或淘汰。',
      },
    ],
  },
  draft,
  input,
)
const generatedQuality = buildDraftQualitySnapshot(
  input,
  draft,
  audit,
  '2026-08-05T03:00:00.000Z',
)
assert.equal(generatedQuality.overallStatus, 'passed')
assert.ok(generatedQuality.checks.every((check) =>
  check.status === 'passed' || check.status === 'not_applicable',
))

const unauditedQuality = buildDraftQualitySnapshot(
  input,
  draft,
  null,
  '2026-08-05T03:01:00.000Z',
)
assert.equal(unauditedQuality.overallStatus, 'needs_review')
assert.equal(
  unauditedQuality.checks.find((check) => check.id === 'required_facts')?.status,
  'needs_review',
)
assert.equal(
  unauditedQuality.checks.find((check) => check.id === 'factual_grounding')?.status,
  'needs_review',
)

const failedAudit = validateDraftGroundingAuditOutput(
  {
    assertions: [],
    requirements: [
      {
        id: 'fact-socks',
        kind: 'required_fact',
        status: 'failed',
        evidence: [],
        reason: '正文遗漏了袜子数量。',
      },
      {
        id: 'boundary-1',
        kind: 'expression_boundary',
        status: 'satisfied',
        evidence: [],
        reason: '正文没有断言球队已晋级或淘汰。',
      },
    ],
  },
  draft,
  input,
)
assert.equal(buildDraftQualitySnapshot(input, draft, failedAudit).overallStatus, 'failed')

assert.throws(() =>
  validateDraftGroundingAuditOutput(
    {
      assertions: [],
      requirements: [
        {
          id: 'fact-socks',
          kind: 'required_fact',
          status: 'satisfied',
          evidence: ['四双足球主题袜子'],
          reason: '正文覆盖必含事实。',
        },
      ],
    },
    draft,
    input,
  ),
)

const generatedVersions = evolveDraftVersions({
  versions: [],
  nextDraft: draft,
  source: 'ai_generation',
  force: true,
  qualitySnapshot: generatedQuality,
})
assert.deepEqual(generatedVersions[0]?.qualitySnapshot, generatedQuality)

const editedDraft = { title: draft.title, body: ['太短了。'] }
const editedQuality = recheckDraftQualitySnapshot(
  generatedQuality,
  editedDraft,
  '2026-08-05T03:05:00.000Z',
)
assert.equal(editedQuality?.overallStatus, 'failed')
assert.equal(
  editedQuality?.checks.find((check) => check.id === 'length')?.status,
  'failed',
)
assert.equal(
  editedQuality?.checks.find((check) => check.id === 'required_facts')?.status,
  'needs_review',
)

const editedVersions = evolveDraftVersions({
  versions: generatedVersions,
  nextDraft: editedDraft,
  source: 'manual_edit',
})
assert.equal(editedVersions[1]?.qualitySnapshot?.overallStatus, 'failed')

const restoredVersions = evolveDraftVersions({
  versions: editedVersions,
  nextDraft: draft,
  source: 'restored',
  force: true,
  qualitySnapshot: generatedQuality,
})
assert.deepEqual(restoredVersions[2]?.qualitySnapshot, generatedQuality)

console.log('draft quality snapshot lifecycle passed')
