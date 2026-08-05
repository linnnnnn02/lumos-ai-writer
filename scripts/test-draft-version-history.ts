import assert from 'node:assert/strict'
import { buildDraftVersionDiff } from '../web/src/lib/draft-version-diff.js'
import {
  evolveDraftVersions,
  markDraftVersionFinalized,
  normalizeDraftVersions,
} from '../web/src/lib/draft-versions.js'

const inserted = buildDraftVersionDiff(
  {
    title: '四双足球主题袜子',
    body: ['先看整体设计。', '四双袜子都带有十号元素。', '最后选出你喜欢的一双。'],
  },
  {
    title: '四双足球主题袜子',
    body: [
      '先看整体设计。',
      '这次先从球场号码说起。',
      '四双袜子都带有十号元素。',
      '最后选出你喜欢的一双。',
    ],
  },
)
assert.deepEqual(inserted.summary, {
  added: 1,
  modified: 0,
  removed: 0,
  unchanged: 3,
})
assert.equal(inserted.paragraphs[1]?.kind, 'added')
assert.equal(inserted.paragraphs[2]?.kind, 'unchanged')

const insertedBesideRewrite = buildDraftVersionDiff(
  {
    title: '保持标题',
    body: ['开场。', '四双足球主题袜子，每双有十号元素。', '结尾。'],
  },
  {
    title: '保持标题',
    body: [
      '开场。',
      '这次先从球场号码说起。',
      '四双足球主题袜子，每双都有十号元素。',
      '结尾。',
    ],
  },
)
assert.deepEqual(
  insertedBesideRewrite.paragraphs.map((paragraph) => paragraph.kind),
  ['unchanged', 'added', 'modified', 'unchanged'],
)

const modified = buildDraftVersionDiff(
  {
    title: '旧标题',
    body: ['四双袜子都带有足球元素。'],
  },
  {
    title: '十号元素藏在四双袜子里',
    body: ['四双足球主题袜子，每双都带有十号元素。'],
  },
)
assert.equal(modified.title.changed, true)
assert.deepEqual(modified.summary, {
  added: 0,
  modified: 1,
  removed: 0,
  unchanged: 0,
})

const removed = buildDraftVersionDiff(
  {
    title: '保持标题',
    body: ['开场。', '这段需要删除。', '结尾。'],
  },
  {
    title: '保持标题',
    body: ['开场。', '结尾。'],
  },
)
assert.equal(removed.summary.removed, 1)
assert.equal(removed.paragraphs[1]?.kind, 'removed')

const initialDraft = {
  title: '四双足球主题袜子',
  body: ['四双袜子，每双都带有十号元素。', '你会先选哪一双？'],
}
const generatedVersions = evolveDraftVersions({
  versions: [],
  nextDraft: initialDraft,
  source: 'ai_generation',
  force: true,
})
const generatedVersionId = generatedVersions[0]?.id ?? ''
const finalizedAt = '2026-08-05T05:00:00.000Z'
const finalizedVersions = markDraftVersionFinalized(
  generatedVersions,
  generatedVersionId,
  finalizedAt,
)
assert.equal(
  finalizedVersions[0]?.completionSnapshot?.finalizedAt,
  finalizedAt,
)
assert.equal(
  markDraftVersionFinalized(finalizedVersions, generatedVersionId, finalizedAt),
  finalizedVersions,
)

const manuallyEditedVersions = evolveDraftVersions({
  versions: finalizedVersions,
  nextDraft: {
    ...initialDraft,
    body: ['四双袜子，每双都带有十号元素。', '我会先看配色，再选喜欢的一双。'],
  },
  source: 'manual_edit',
  coalesce: true,
})
assert.equal(manuallyEditedVersions.length, 2)
assert.equal(manuallyEditedVersions[0]?.completionSnapshot?.finalizedAt, finalizedAt)
assert.equal(manuallyEditedVersions[1]?.completionSnapshot, undefined)

const editedVersionId = manuallyEditedVersions[1]?.id ?? ''
const finalizedEditedVersions = markDraftVersionFinalized(
  manuallyEditedVersions,
  editedVersionId,
  '2026-08-05T05:05:00.000Z',
)
const coalescedEdit = evolveDraftVersions({
  versions: finalizedEditedVersions,
  nextDraft: {
    ...initialDraft,
    body: ['四双袜子，每双都带有十号元素。', '最终只保留这一句收束。'],
  },
  source: 'manual_edit',
  coalesce: true,
})
assert.equal(coalescedEdit.length, 2)
assert.equal(coalescedEdit[1]?.id, editedVersionId)
assert.equal(coalescedEdit[1]?.completionSnapshot, undefined)

assert.equal(
  normalizeDraftVersions([
    {
      ...finalizedVersions[0],
      completionSnapshot: { finalizedAt: 'not-a-date' },
    },
  ]).length,
  0,
)

console.log('draft version diff and completion lifecycle passed')
