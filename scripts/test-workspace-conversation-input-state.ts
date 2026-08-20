import assert from 'node:assert/strict'
import {
  createWorkspaceConversationInputState,
  workspaceConversationInputReducer,
} from '../web/src/features/workspace/model/workspace-conversation-input-state.js'

const conversationId = 'conversation-1'
const otherConversationId = 'conversation-2'
const imageAttachment = {
  id: 'attachment-1',
  name: '参考图.png',
  kind: 'image' as const,
}

let state = createWorkspaceConversationInputState({
  chatInputByConversation: { [conversationId]: '分析一下这些素材' },
  planAttachmentsByConversation: { [conversationId]: [imageAttachment] },
  writingRequestDraftByConversation: {
    [conversationId]: '写一篇真实体验',
    [otherConversationId]: '保留另一个需求',
  },
  referenceSelectionDraftByConversation: {
    [conversationId]: ['note-1'],
    [otherConversationId]: ['note-other'],
  },
})

state = workspaceConversationInputReducer(state, {
  type: 'set-chat-input',
  conversationId,
  input: '只分析已选择的素材',
})
state = workspaceConversationInputReducer(state, {
  type: 'set-writing-request',
  conversationId,
  input: '写一篇克制的真实体验',
})
assert.equal(state.chatInputByConversation[conversationId], '只分析已选择的素材')
assert.equal(
  state.writingRequestDraftByConversation[conversationId],
  '写一篇克制的真实体验',
)

state = workspaceConversationInputReducer(state, {
  type: 'open-reference-selection',
  conversationId,
  itemIds: ['note-1', 'note-1', 'note-2'],
})
assert.deepEqual(state.referenceSelectionDraftByConversation[conversationId], [
  'note-1',
  'note-2',
])

state = workspaceConversationInputReducer(state, {
  type: 'toggle-reference-items',
  conversationId,
  itemIds: ['note-1', 'note-2'],
})
assert.deepEqual(state.referenceSelectionDraftByConversation[conversationId], [])

state = workspaceConversationInputReducer(state, {
  type: 'toggle-reference-items',
  conversationId,
  itemIds: ['note-2', 'note-3'],
})
assert.deepEqual(state.referenceSelectionDraftByConversation[conversationId], [
  'note-2',
  'note-3',
])

state = workspaceConversationInputReducer(state, {
  type: 'select-reference-items',
  conversationId,
  itemIds: ['note-3', 'note-4'],
})
assert.deepEqual(state.referenceSelectionDraftByConversation[conversationId], [
  'note-2',
  'note-3',
  'note-4',
])

state = workspaceConversationInputReducer(state, {
  type: 'deselect-reference-items',
  conversationId,
  itemIds: ['note-2', 'note-4'],
})
assert.deepEqual(state.referenceSelectionDraftByConversation[conversationId], ['note-3'])

const documentAttachment = {
  id: 'attachment-2',
  name: '采访记录.pdf',
  kind: 'document' as const,
}
state = workspaceConversationInputReducer(state, {
  type: 'add-attachments',
  conversationId,
  attachments: [documentAttachment],
})
assert.deepEqual(
  state.planAttachmentsByConversation[conversationId]?.map((attachment) => attachment.id),
  ['attachment-1', 'attachment-2'],
)
state = workspaceConversationInputReducer(state, {
  type: 'remove-attachment',
  conversationId,
  attachmentId: imageAttachment.id,
})
assert.deepEqual(
  state.planAttachmentsByConversation[conversationId]?.map((attachment) => attachment.id),
  ['attachment-2'],
)
state = workspaceConversationInputReducer(state, {
  type: 'clear-attachments',
  conversationId,
})
assert.equal(state.planAttachmentsByConversation[conversationId], undefined)
assert.equal(state.chatInputByConversation[conversationId], '只分析已选择的素材')

state = workspaceConversationInputReducer(state, {
  type: 'clear-conversation-transient',
  conversationId,
})
assert.equal(state.writingRequestDraftByConversation[conversationId], undefined)
assert.equal(state.referenceSelectionDraftByConversation[conversationId], undefined)
assert.equal(
  state.writingRequestDraftByConversation[otherConversationId],
  '保留另一个需求',
)
assert.deepEqual(state.referenceSelectionDraftByConversation[otherConversationId], [
  'note-other',
])

state = workspaceConversationInputReducer(state, { type: 'clear-all-transient' })
assert.deepEqual(state.writingRequestDraftByConversation, {})
assert.deepEqual(state.referenceSelectionDraftByConversation, {})

state = workspaceConversationInputReducer(
  {
    ...state,
    writingRequestDraftByConversation: { stale: '不应保留' },
    referenceSelectionDraftByConversation: { stale: ['note-stale'] },
  },
  {
    type: 'replace-persisted-inputs',
    snapshot: {
      chatInputByConversation: { cloud: '云端输入' },
      planAttachmentsByConversation: { cloud: [imageAttachment] },
    },
  },
)
assert.deepEqual(state.chatInputByConversation, { cloud: '云端输入' })
assert.deepEqual(state.planAttachmentsByConversation, { cloud: [imageAttachment] })
assert.deepEqual(state.writingRequestDraftByConversation, {})
assert.deepEqual(state.referenceSelectionDraftByConversation, {})

state = workspaceConversationInputReducer(
  {
    ...state,
    chatInputByConversation: { [conversationId]: '输入' },
    planAttachmentsByConversation: { [conversationId]: [imageAttachment] },
    writingRequestDraftByConversation: { [conversationId]: '需求' },
    referenceSelectionDraftByConversation: { [conversationId]: ['note-1'] },
  },
  { type: 'reset-conversation', conversationId },
)
assert.equal(state.chatInputByConversation[conversationId], undefined)
assert.equal(state.planAttachmentsByConversation[conversationId], undefined)
assert.equal(state.writingRequestDraftByConversation[conversationId], undefined)
assert.equal(state.referenceSelectionDraftByConversation[conversationId], undefined)

console.log('workspace conversation input state passed')
