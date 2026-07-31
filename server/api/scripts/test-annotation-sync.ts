import assert from 'node:assert/strict'
import { syncAnnotationRequestSchema } from '@lumos-ai/shared'
import { syncAnnotationToCloud } from '../../../extension/lib/cloud-api.js'

const snippetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const syncInput = {
  folder: {
    id: 'local-folder',
    name: '验收文件夹',
    noteCount: 1,
    updatedAt: '2026-07-31T00:00:00.000Z',
  },
  note: {
    id: 'local-note',
    folderId: 'local-folder',
    folderName: '验收文件夹',
    filename: '测试文案',
    title: '测试文案',
    authorName: '测试作者',
    sourceUrl: 'https://www.xiaohongshu.com/explore/test-note',
    coverImageUrl: '',
    contentText: '测试正文',
    savedAt: '2026-07-31T00:00:00.000Z',
  },
  snippet: {
    id: snippetId,
    noteUrl: 'https://www.xiaohongshu.com/explore/test-note',
    noteTitle: '测试文案',
    noteAuthorName: '测试作者',
    selectedText: '值得保存的片段',
    reasonText: '结构清楚',
    colorTagName: '结构',
    colorValue: '#64748B',
    createdAt: '2026-07-31T00:00:00.000Z',
  },
}

const requests: Array<{ url: string; init?: RequestInit }> = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  requests.push({ url: String(input), init })
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

try {
  await syncAnnotationToCloud('test-token', syncInput)
} finally {
  globalThis.fetch = originalFetch
}

assert.equal(requests.length, 1)
assert.equal(
  requests[0].url,
  'https://lumos-ai-writer.pages.dev/api/v1/annotation-sync',
)
assert.equal(requests[0].init?.method, 'POST')
assert.equal(
  (requests[0].init?.headers as Record<string, string>).Authorization,
  'Bearer test-token',
)

const body = JSON.parse(String(requests[0].init?.body)) as Record<string, unknown>
const parsed = syncAnnotationRequestSchema.parse(body)
assert.equal(parsed.folderName, '验收文件夹')
assert.equal(parsed.snippet.id, snippetId)
assert.equal('folderId' in parsed.note, false)

const missingId = {
  ...body,
  snippet: {
    ...(body.snippet as Record<string, unknown>),
    id: undefined,
  },
}
assert.equal(syncAnnotationRequestSchema.safeParse(missingId).success, false)

console.log('Annotation cloud sync uses one idempotent API request.')
