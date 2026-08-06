import assert from 'node:assert/strict'
import type { AiAnalysisResult } from '@lumos-ai/shared'
import {
  createWorkspaceAnalysisState,
  workspaceAnalysisReducer,
} from '../web/src/features/workspace/model/workspace-analysis-state.js'

const conversationId = 'conversation-1'
const otherConversationId = 'conversation-2'
const analysis = {
  summary: '用户偏好具体、克制且有真实体验支撑的表达。',
} as AiAnalysisResult

let state = createWorkspaceAnalysisState({
  analysisByConversation: {},
  analysisPendingConversationId: '',
  analysisWaitStartedAt: null,
  analysisErrorByConversation: { [conversationId]: '旧错误' },
  chatReplyPendingConversationId: '',
})

state = workspaceAnalysisReducer(state, {
  type: 'start-analysis',
  conversationId,
  startedAt: 1_000,
})
assert.equal(state.analysisPendingConversationId, conversationId)
assert.equal(state.analysisWaitStartedAt, 1_000)
assert.equal(state.analysisErrorByConversation[conversationId], undefined)

state = workspaceAnalysisReducer(state, {
  type: 'record-analysis',
  conversationId,
  analysis,
})
assert.equal(state.analysisByConversation[conversationId], analysis)

const pendingState = workspaceAnalysisReducer(state, {
  type: 'finish-analysis',
  conversationId: otherConversationId,
})
assert.equal(pendingState, state)

state = workspaceAnalysisReducer(state, {
  type: 'finish-analysis',
  conversationId,
})
assert.equal(state.analysisPendingConversationId, '')
assert.equal(state.analysisWaitStartedAt, null)

state = workspaceAnalysisReducer(state, {
  type: 'fail-analysis',
  conversationId,
  error: '分析失败',
})
assert.equal(state.analysisErrorByConversation[conversationId], '分析失败')
state = workspaceAnalysisReducer(state, { type: 'clear-error', conversationId })
assert.equal(state.analysisErrorByConversation[conversationId], undefined)

state = workspaceAnalysisReducer(state, {
  type: 'start-chat-reply',
  conversationId,
})
assert.equal(state.chatReplyPendingConversationId, conversationId)
state = workspaceAnalysisReducer(state, {
  type: 'finish-chat-reply',
  conversationId: otherConversationId,
})
assert.equal(state.chatReplyPendingConversationId, conversationId)
state = workspaceAnalysisReducer(state, {
  type: 'finish-chat-reply',
  conversationId,
})
assert.equal(state.chatReplyPendingConversationId, '')

state = workspaceAnalysisReducer(state, {
  type: 'invalidate-analysis',
  conversationId,
})
assert.equal(state.analysisByConversation[conversationId], undefined)
assert.equal(state.analysisErrorByConversation[conversationId], undefined)

state = workspaceAnalysisReducer(
  {
    ...state,
    analysisByConversation: { stale: analysis },
    analysisPendingConversationId: 'stale',
    analysisWaitStartedAt: 2_000,
    analysisErrorByConversation: { stale: '不应跨工作区保留' },
    chatReplyPendingConversationId: 'stale',
  },
  {
    type: 'replace-analyses',
    snapshot: { analysisByConversation: { cloud: analysis } },
  },
)
assert.deepEqual(state.analysisByConversation, { cloud: analysis })
assert.equal(state.analysisPendingConversationId, '')
assert.equal(state.analysisWaitStartedAt, null)
assert.deepEqual(state.analysisErrorByConversation, {})
assert.equal(state.chatReplyPendingConversationId, '')

state = workspaceAnalysisReducer(
  {
    ...state,
    analysisByConversation: { [conversationId]: analysis },
    analysisPendingConversationId: conversationId,
    analysisWaitStartedAt: 3_000,
    analysisErrorByConversation: { [conversationId]: '错误' },
    chatReplyPendingConversationId: conversationId,
  },
  { type: 'reset-conversation', conversationId },
)
assert.equal(state.analysisByConversation[conversationId], undefined)
assert.equal(state.analysisPendingConversationId, '')
assert.equal(state.analysisWaitStartedAt, null)
assert.equal(state.analysisErrorByConversation[conversationId], undefined)
assert.equal(state.chatReplyPendingConversationId, '')

console.log('workspace analysis state passed')
