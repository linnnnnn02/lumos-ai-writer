import assert from 'node:assert/strict'
import {
  createWorkspaceDraftState,
  workspaceDraftReducer,
} from '../web/src/features/workspace/model/workspace-draft-state.js'
import type { DraftVersionRecord } from '../web/src/lib/draft-versions.js'

const conversationId = 'conversation-1'
const firstDraft = {
  title: '第一版标题',
  body: ['第一段正文'],
}
const firstVersion: DraftVersionRecord = {
  id: 'version-1',
  version: 1,
  ...firstDraft,
  source: 'ai_generation',
  createdAt: '2026-08-06T10:00:00.000Z',
  updatedAt: '2026-08-06T10:00:00.000Z',
}

let state = createWorkspaceDraftState({
  draftReadyByConversation: { [conversationId]: true },
  draftCopyByConversation: { [conversationId]: firstDraft },
  draftVersionsByConversation: { [conversationId]: [firstVersion] },
  currentDraftVersionIdByConversation: { [conversationId]: firstVersion.id },
  draftGenerationErrorByConversation: { [conversationId]: '旧错误' },
})

state = workspaceDraftReducer(state, {
  type: 'invalidate-draft',
  conversationId,
})
assert.equal(state.draftReadyByConversation[conversationId], false)
assert.equal(state.draftGenerationErrorByConversation[conversationId], undefined)
assert.equal(state.draftCopyByConversation[conversationId]?.title, firstDraft.title)
assert.equal(state.draftVersionsByConversation[conversationId]?.length, 1)
assert.equal(state.currentDraftVersionIdByConversation[conversationId], firstVersion.id)

state = workspaceDraftReducer(state, {
  type: 'set-generation-error',
  conversationId,
  error: '生成失败',
  restoreReady: true,
})
assert.equal(state.draftGenerationErrorByConversation[conversationId], '生成失败')
assert.equal(state.draftReadyByConversation[conversationId], true)

state = workspaceDraftReducer(state, {
  type: 'invalidate-draft',
  conversationId,
})
state = workspaceDraftReducer(state, {
  type: 'restore-draft-readiness',
  conversationId,
})
assert.equal(state.draftReadyByConversation[conversationId], true)

const secondDraft = {
  title: '第二版标题',
  body: ['新的第一段', '新的第二段'],
}
const secondVersion: DraftVersionRecord = {
  id: 'version-2',
  version: 2,
  ...secondDraft,
  source: 'manual_edit',
  createdAt: '2026-08-06T10:05:00.000Z',
  updatedAt: '2026-08-06T10:05:00.000Z',
}

state = workspaceDraftReducer(state, {
  type: 'record-draft',
  conversationId,
  draft: secondDraft,
  versions: [firstVersion, secondVersion],
  currentVersionId: secondVersion.id,
})
assert.equal(state.draftReadyByConversation[conversationId], true)
assert.deepEqual(state.draftCopyByConversation[conversationId], secondDraft)
assert.equal(state.draftVersionsByConversation[conversationId]?.length, 2)
assert.equal(state.currentDraftVersionIdByConversation[conversationId], secondVersion.id)
assert.equal(state.draftGenerationErrorByConversation[conversationId], undefined)

const finalizedVersions = [
  firstVersion,
  {
    ...secondVersion,
    completionSnapshot: { finalizedAt: '2026-08-06T10:10:00.000Z' },
  },
]
state = workspaceDraftReducer(state, {
  type: 'update-versions',
  conversationId,
  versions: finalizedVersions,
})
assert.deepEqual(
  state.draftVersionsByConversation[conversationId]?.[1]?.completionSnapshot,
  { finalizedAt: '2026-08-06T10:10:00.000Z' },
)
assert.equal(state.currentDraftVersionIdByConversation[conversationId], secondVersion.id)
assert.deepEqual(state.draftCopyByConversation[conversationId], secondDraft)

state = workspaceDraftReducer(state, {
  type: 'reset-conversation',
  conversationId,
})
assert.equal(state.draftReadyByConversation[conversationId], undefined)
assert.equal(state.draftCopyByConversation[conversationId], undefined)
assert.equal(state.draftVersionsByConversation[conversationId], undefined)
assert.equal(state.currentDraftVersionIdByConversation[conversationId], undefined)
assert.equal(state.draftGenerationErrorByConversation[conversationId], undefined)

state = workspaceDraftReducer(
  {
    ...state,
    draftGenerationErrorByConversation: { stale: '不应跨工作区保留' },
  },
  {
    type: 'replace-drafts',
    snapshot: {
      draftReadyByConversation: {},
      draftCopyByConversation: {},
      draftVersionsByConversation: {},
      currentDraftVersionIdByConversation: {},
    },
  },
)
assert.deepEqual(state.draftGenerationErrorByConversation, {})

console.log('workspace draft state passed')
