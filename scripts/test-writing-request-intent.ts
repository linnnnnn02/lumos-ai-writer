import assert from 'node:assert/strict'
import type { SavedNoteRecord } from '@lumos-ai/shared'
import {
  DEFAULT_TARGET_AUDIENCE,
  buildOptionalBriefQuestions,
  buildReferenceRecommendations,
  hasExplicitLengthPreference,
  inferProjectLengthFromWritingRequest,
  inferTargetAudienceFromWritingRequest,
  inferWritingBriefFromRequest,
  isDirectGenerationReply,
  isOptionalBriefSkipReply,
} from '../web/src/features/workspace/model/writing-request-intent.js'

function createNote(
  id: string,
  folderId: string,
  title: string,
  contentText: string,
): SavedNoteRecord {
  return {
    id,
    folderId,
    folderName: folderId,
    filename: `${title}.txt`,
    title,
    authorName: '测试账号',
    sourceUrl: `https://example.com/${id}`,
    coverImageUrl: '',
    contentText,
    savedAt: '2026-08-06T00:00:00.000Z',
  }
}

const request =
  '想为一款夜间修护精华写一条80字以内的产品说明，强调轻盈、吸收快和第二天皮肤更柔软。语气克制、有留白，不要夸张功效，也不要像广告。'

assert.equal(inferProjectLengthFromWritingRequest(request), 'short')
assert.equal(inferProjectLengthFromWritingRequest('写一篇 300 字左右的体验'), 'medium')
assert.equal(inferProjectLengthFromWritingRequest('写一篇 800 字的完整复盘'), 'long')
assert.equal(inferProjectLengthFromWritingRequest('用一句话说清楚重点'), 'short')
assert.equal(inferProjectLengthFromWritingRequest('现在太短了，写长一些、详细一些'), 'medium')
assert.equal(hasExplicitLengthPreference('默认生成就好'), false)
assert.equal(hasExplicitLengthPreference('写长一些、详细一些'), true)

assert.equal(
  inferTargetAudienceFromWritingRequest(
    '宣传勋章盲盒。目标读者：王俊凯粉丝，以及喜欢数字收藏的用户。写作目标：介绍玩法。',
  ),
  '王俊凯粉丝，以及喜欢数字收藏的用户',
)
assert.equal(isOptionalBriefSkipReply('不需要'), true)
assert.equal(isOptionalBriefSkipReply('不需要补充'), true)
assert.equal(isOptionalBriefSkipReply('必须保留活动截止时间'), false)
assert.equal(isDirectGenerationReply('我不补充了，直接生成文案'), true)
assert.equal(isDirectGenerationReply('先不要直接生成'), false)

const brief = inferWritingBriefFromRequest(request)
assert.match(brief.requiredFacts, /轻盈、吸收快和第二天皮肤更柔软/u)
assert.match(brief.requiredFacts, /使用后/u)
assert.match(brief.boundaries, /克制、有留白/u)
assert.match(brief.boundaries, /不要夸张功效/u)
assert.match(brief.instructions, /80字以内/u)

const campaignQuestions = buildOptionalBriefQuestions({
  writingRequest: '帮我写一篇勋章盲盒活动文案',
  targetAudience: DEFAULT_TARGET_AUDIENCE,
  brief: {
    objective: '',
    requiredFacts: '',
    boundaries: '',
    instructions: '',
  },
})
assert.deepEqual(
  campaignQuestions.map((question) => question.id),
  ['facts', 'audience'],
)

const completeCampaignQuestions = buildOptionalBriefQuestions({
  writingRequest:
    '为王俊凯粉丝写勋章盲盒活动文案，活动截至2026年8月10日，集齐全套有机会抽签名照，中篇幅。',
  targetAudience: '王俊凯粉丝',
  brief: {
    objective: '',
    requiredFacts: '活动截至2026年8月10日；集齐全套有机会抽签名照',
    boundaries: '不能写成集齐后必得签名照',
    instructions: '',
  },
})
assert.deepEqual(completeCampaignQuestions, [])

const recommendations = buildReferenceRecommendations(
  request,
  [
    createNote(
      'preferred-relevant',
      'preferred-folder',
      '轻盈，唤醒',
      '质地轻盈，关注夜间修护与吸收体验。',
    ),
    createNote(
      'other-relevant',
      'other-folder',
      '身穿一朵云',
      '帮助修护屏障，慢慢回到柔软、丰盈的状态。',
    ),
    createNote(
      'false-positive',
      'badge-folder',
      '抽皮肤盲盒赢签名照',
      '参与活动，点亮勋章，领取奖励。',
    ),
  ],
  'preferred-folder',
)

assert.deepEqual(
  recommendations.map((item) => item.noteId),
  ['preferred-relevant', 'other-relevant'],
)
assert.match(recommendations[0]?.reason ?? '', /优先参考文件夹/u)
assert.equal(recommendations.some((item) => item.noteId === 'false-positive'), false)

console.log('writing request intent passed')
