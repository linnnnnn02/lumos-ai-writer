import assert from 'node:assert/strict'
import type { SavedNoteRecord } from '@lumos-ai/shared'
import {
  buildReferenceRecommendations,
  inferProjectLengthFromWritingRequest,
  inferWritingBriefFromRequest,
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

const brief = inferWritingBriefFromRequest(request)
assert.match(brief.requiredFacts, /轻盈、吸收快和第二天皮肤更柔软/u)
assert.match(brief.requiredFacts, /使用后/u)
assert.match(brief.boundaries, /克制、有留白/u)
assert.match(brief.boundaries, /不要夸张功效/u)
assert.match(brief.instructions, /80字以内/u)

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
