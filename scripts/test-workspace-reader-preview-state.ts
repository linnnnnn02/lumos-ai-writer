import assert from 'node:assert/strict'
import {
  createWorkspaceReaderPreviewState,
  workspaceReaderPreviewReducer,
  type ReaderPreviewRecord,
} from '../web/src/features/workspace/model/workspace-reader-preview-state.js'

const conversationId = 'conversation-1'
const draft = {
  title: '一篇真实体验',
  body: ['第一段真实体验', '第二段购买判断'],
}
const previewRecord: ReaderPreviewRecord = {
  audience: '第一次购买的人',
  draft,
  preview: {
    audienceSummary: '关心真实使用感受和购买风险。',
    annotations: [
      {
        id: 'annotation-1',
        fieldId: 'body-0',
        quote: '第一段真实体验',
        tone: 'interest',
        label: '有兴趣',
        title: '想继续了解',
        reaction: '这里有具体体验，愿意继续读。',
        reason: '描述与自己的购买场景有关。',
        confidence: 0.8,
      },
      {
        id: 'annotation-2',
        fieldId: 'body-1',
        quote: '第二段购买判断',
        tone: 'question',
        label: '有疑问',
        title: '依据还不够',
        reaction: '想知道这个判断来自什么使用细节。',
        reason: '结论比前面的事实更具体。',
        confidence: 0.7,
      },
    ],
    suggestions: [
      {
        priority: 'high',
        instruction: '补充支撑购买判断的使用细节。',
        rationale: '让读者能判断结论是否适合自己。',
        annotationIds: ['annotation-2'],
      },
    ],
  },
}

let state = createWorkspaceReaderPreviewState({
  readerAudienceByConversation: { [conversationId]: previewRecord.audience },
  readerPreviewByConversation: { [conversationId]: previewRecord },
  readerPreviewPendingConversationId: '',
  readerPreviewErrorByConversation: { [conversationId]: '旧错误' },
})

state = workspaceReaderPreviewReducer(state, {
  type: 'set-audience',
  conversationId,
  audience: '更谨慎的第一次购买者',
})
assert.equal(
  state.readerAudienceByConversation[conversationId],
  '更谨慎的第一次购买者',
)
assert.equal(state.readerPreviewByConversation[conversationId], undefined)
assert.equal(state.readerPreviewErrorByConversation[conversationId], undefined)

state = workspaceReaderPreviewReducer(state, {
  type: 'set-error',
  conversationId,
  error: '连接失败',
})
assert.equal(state.readerPreviewErrorByConversation[conversationId], '连接失败')
state = workspaceReaderPreviewReducer(state, {
  type: 'clear-error',
  conversationId,
})
assert.equal(state.readerPreviewErrorByConversation[conversationId], undefined)

state = workspaceReaderPreviewReducer(state, {
  type: 'start-request',
  conversationId,
})
assert.equal(state.readerPreviewPendingConversationId, conversationId)

state = workspaceReaderPreviewReducer(state, {
  type: 'finish-success',
  conversationId,
  record: previewRecord,
})
assert.equal(state.readerPreviewPendingConversationId, '')
assert.deepEqual(state.readerPreviewByConversation[conversationId], previewRecord)
assert.notEqual(state.readerPreviewByConversation[conversationId]?.draft, draft)

state = workspaceReaderPreviewReducer(state, {
  type: 'start-request',
  conversationId,
})
state = workspaceReaderPreviewReducer(state, {
  type: 'finish-error',
  conversationId,
  error: '预演失败',
})
assert.equal(state.readerPreviewPendingConversationId, '')
assert.equal(state.readerPreviewErrorByConversation[conversationId], '预演失败')

state = workspaceReaderPreviewReducer(state, {
  type: 'invalidate-preview',
  conversationId,
})
assert.equal(state.readerPreviewByConversation[conversationId], undefined)
assert.equal(state.readerPreviewErrorByConversation[conversationId], undefined)
assert.equal(
  state.readerAudienceByConversation[conversationId],
  '更谨慎的第一次购买者',
)

state = workspaceReaderPreviewReducer(
  {
    ...state,
    readerPreviewPendingConversationId: 'stale-conversation',
    readerPreviewErrorByConversation: { stale: '不应跨工作区保留' },
  },
  {
    type: 'replace-reader-preview',
    snapshot: {
      readerAudienceByConversation: {},
      readerPreviewByConversation: {},
    },
  },
)
assert.equal(state.readerPreviewPendingConversationId, '')
assert.deepEqual(state.readerPreviewErrorByConversation, {})

state = workspaceReaderPreviewReducer(
  {
    ...state,
    readerAudienceByConversation: { [conversationId]: previewRecord.audience },
    readerPreviewByConversation: { [conversationId]: previewRecord },
    readerPreviewPendingConversationId: conversationId,
    readerPreviewErrorByConversation: { [conversationId]: '错误' },
  },
  { type: 'reset-conversation', conversationId },
)
assert.equal(state.readerAudienceByConversation[conversationId], undefined)
assert.equal(state.readerPreviewByConversation[conversationId], undefined)
assert.equal(state.readerPreviewPendingConversationId, '')
assert.equal(state.readerPreviewErrorByConversation[conversationId], undefined)

console.log('workspace reader preview state passed')
