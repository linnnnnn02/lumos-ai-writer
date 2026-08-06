import assert from 'node:assert/strict'
import {
  createWorkspaceReviewState,
  workspaceReviewReducer,
  type RewriteChatMessage,
} from '../web/src/features/workspace/model/workspace-review-state.js'

const conversationId = 'conversation-1'
const initialMessage: RewriteChatMessage = {
  id: 'message-1',
  role: 'assistant',
  lines: ['先圈选想修改的文字。'],
}

let state = createWorkspaceReviewState({
  rewriteInputByConversation: { [conversationId]: '写得更自然' },
  rewriteMessagesByConversation: { [conversationId]: [initialMessage] },
  rewritePendingConversationId: '',
})

state = workspaceReviewReducer(state, {
  type: 'set-input',
  conversationId,
  input: '语气再克制一点',
})
assert.equal(state.rewriteInputByConversation[conversationId], '语气再克制一点')

const localUserMessage: RewriteChatMessage = {
  id: 'message-2',
  role: 'user',
  selectedText: '真的特别好',
  lines: ['不要把话说满'],
}
const localAssistantMessage: RewriteChatMessage = {
  id: 'message-3',
  role: 'assistant',
  selectedText: '真的特别好',
  lines: ['先收紧语气，再看前后承接。'],
}
state = workspaceReviewReducer(state, {
  type: 'append-messages',
  conversationId,
  messages: [localUserMessage, localAssistantMessage],
  clearInput: true,
})
assert.equal(state.rewriteInputByConversation[conversationId], '')
assert.deepEqual(
  state.rewriteMessagesByConversation[conversationId]?.map((message) => message.id),
  ['message-1', 'message-2', 'message-3'],
)

const requestMessage: RewriteChatMessage = {
  id: 'message-4',
  role: 'user',
  selectedText: '真的特别好',
  fieldId: 'body-0',
  instruction: '换成真实体验',
  lines: ['换成真实体验'],
}
state = workspaceReviewReducer(state, {
  type: 'start-request',
  conversationId,
  userMessage: requestMessage,
})
assert.equal(state.rewritePendingConversationId, conversationId)
assert.equal(state.rewriteInputByConversation[conversationId], '')
assert.equal(state.rewriteMessagesByConversation[conversationId]?.at(-1)?.id, 'message-4')

const suggestionMessage: RewriteChatMessage = {
  id: 'message-5',
  role: 'assistant',
  selectedText: '真的特别好',
  fieldId: 'body-0',
  lines: ['可以改成更具体的感受。'],
  suggestions: [
    {
      id: 'suggestion-1',
      label: '更具体',
      text: '上手时没有想象中厚重。',
      rationale: '用可感知的体验替代笼统判断。',
      status: 'available',
    },
    {
      id: 'suggestion-2',
      label: '更克制',
      text: '这次用下来没有明显负担。',
      rationale: '保留判断空间，不把结论说满。',
      status: 'available',
    },
  ],
  recommendedIndex: 0,
}
state = workspaceReviewReducer(state, {
  type: 'finish-request',
  conversationId,
  assistantMessage: suggestionMessage,
})
assert.equal(state.rewritePendingConversationId, '')
assert.equal(state.rewriteMessagesByConversation[conversationId]?.at(-1)?.id, 'message-5')

state = workspaceReviewReducer(state, {
  type: 'accept-suggestion',
  conversationId,
  messageId: suggestionMessage.id,
  suggestionId: 'suggestion-1',
})
const acceptedSuggestions = state.rewriteMessagesByConversation[conversationId]?.at(-1)
  ?.suggestions
assert.equal(acceptedSuggestions?.[0]?.status, 'accepted')
assert.equal(acceptedSuggestions?.[1]?.status, 'superseded')

const secondSuggestionMessage: RewriteChatMessage = {
  ...suggestionMessage,
  id: 'message-6',
  suggestions: suggestionMessage.suggestions?.map((suggestion) => ({
    ...suggestion,
    status: 'available',
  })),
}
state = workspaceReviewReducer(state, {
  type: 'append-messages',
  conversationId,
  messages: [secondSuggestionMessage],
})
state = workspaceReviewReducer(state, {
  type: 'reject-suggestion',
  conversationId,
  messageId: secondSuggestionMessage.id,
  suggestionId: 'suggestion-2',
})
const rejectedSuggestions = state.rewriteMessagesByConversation[conversationId]?.at(-1)
  ?.suggestions
assert.equal(rejectedSuggestions?.[0]?.status, 'available')
assert.equal(rejectedSuggestions?.[1]?.status, 'rejected')

state = workspaceReviewReducer(state, {
  type: 'reset-conversation',
  conversationId,
})
assert.equal(state.rewriteInputByConversation[conversationId], undefined)
assert.equal(state.rewriteMessagesByConversation[conversationId], undefined)
assert.equal(state.rewritePendingConversationId, '')

state = workspaceReviewReducer(
  {
    ...state,
    rewritePendingConversationId: 'stale-conversation',
  },
  {
    type: 'replace-review',
    snapshot: {
      rewriteInputByConversation: {},
      rewriteMessagesByConversation: {},
    },
  },
)
assert.equal(state.rewritePendingConversationId, '')

console.log('workspace review state passed')
