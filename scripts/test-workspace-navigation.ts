import assert from 'node:assert/strict'
import {
  createWorkspaceNavigationState,
  getAppNavigationHash,
  getSafeNavigationStage,
  parseAppNavigationHash,
  workspaceNavigationReducer,
  type AppNavigationHistoryState,
} from '../web/src/features/workspace/workflow/workspace-navigation.js'

const conversationTarget: AppNavigationHistoryState = {
  lumosNavigation: true,
  view: 'conversation',
  projectId: 'project-1',
  conversationId: 'conversation-1',
  stage: 'references',
  canReturnToWorkspace: true,
}

assert.deepEqual(parseAppNavigationHash('#projects'), {
  lumosNavigation: true,
  view: 'workspace',
})
assert.deepEqual(parseAppNavigationHash('#library'), {
  lumosNavigation: true,
  view: 'library',
})
assert.deepEqual(
  parseAppNavigationHash('#project=project-1&conversation=conversation-1&stage=review'),
  {
    lumosNavigation: true,
    view: 'conversation',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    stage: 'review',
  },
)
assert.deepEqual(parseAppNavigationHash('#project=project-1&stage=unknown'), {
  lumosNavigation: true,
  view: 'conversation',
  projectId: 'project-1',
  conversationId: undefined,
  stage: undefined,
})
assert.equal(
  getAppNavigationHash(conversationTarget),
  '#project=project-1&conversation=conversation-1&stage=references',
)

let state = createWorkspaceNavigationState(conversationTarget)
assert.equal(state.view, 'conversation')
assert.equal(state.pendingTarget, conversationTarget)

state = workspaceNavigationReducer(state, { type: 'show-conversation', stage: 'references' })
assert.equal(state.view, 'conversation')
assert.equal(state.stageOverride, 'references')
assert.equal(state.pendingTarget, null)

state = workspaceNavigationReducer(state, { type: 'set-sidebar-open', open: true })
state = workspaceNavigationReducer(state, {
  type: 'location-requested',
  target: { lumosNavigation: true, view: 'workspace' },
})
assert.equal(state.isConversationSidebarOpen, false)
assert.equal(state.stageOverride, null)
assert.equal(state.pendingTarget?.view, 'workspace')

state = workspaceNavigationReducer(state, { type: 'show-view', view: 'workspace' })
assert.deepEqual(state, {
  view: 'workspace',
  stageOverride: null,
  pendingTarget: null,
  isConversationSidebarOpen: false,
})

state = workspaceNavigationReducer(state, { type: 'show-view', view: 'library' })
assert.equal(state.view, 'library')
assert.equal(state.stageOverride, null)
assert.equal(state.pendingTarget, null)

const conversation = {
  analysisReady: false,
  step: 'learn' as const,
  workflowStage: 'references' as const,
  writingRequest: '写一篇真实体验',
  topic: '写一篇真实体验',
}

assert.equal(
  getSafeNavigationStage({
    conversation,
    hasAnalysis: false,
    hasDraft: false,
    requestedStage: 'draft',
  }),
  'references',
)
assert.equal(
  getSafeNavigationStage({
    conversation,
    hasAnalysis: true,
    hasDraft: false,
    requestedStage: 'review',
  }),
  'draft',
)
assert.equal(
  getSafeNavigationStage({
    conversation: { ...conversation, writingRequest: '', topic: '' },
    hasAnalysis: false,
    hasDraft: false,
    requestedStage: 'references',
  }),
  'intake',
)

console.log('workspace navigation state passed')
