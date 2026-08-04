import assert from 'node:assert/strict'
import { recoverProjectConversationState } from '../web/src/lib/conversation-recovery.ts'

type TestConversation = { id: string; title: string }

function createRecoveredConversation(): TestConversation {
  return { id: 'recovered-conversation', title: '新的文案对话' }
}

const emptyCloudProject = recoverProjectConversationState(
  { id: 'cloud-project', activeConversationId: '', conversations: [] as TestConversation[] },
  createRecoveredConversation,
)
assert.equal(emptyCloudProject.conversations.length, 1)
assert.equal(emptyCloudProject.activeConversationId, 'recovered-conversation')

const localProjectWithoutValidConversations = recoverProjectConversationState(
  {
    id: 'local-project',
    activeConversationId: 'invalid-local-id',
    conversations: [] as TestConversation[],
  },
  createRecoveredConversation,
)
assert.equal(localProjectWithoutValidConversations.conversations[0]?.title, '新的文案对话')
assert.equal(localProjectWithoutValidConversations.activeConversationId, 'recovered-conversation')

const projectWithInvalidActiveConversation = recoverProjectConversationState(
  {
    id: 'existing-project',
    activeConversationId: 'missing-conversation',
    conversations: [
      { id: 'first-conversation', title: '第一条对话' },
      { id: 'second-conversation', title: '第二条对话' },
    ],
  },
  createRecoveredConversation,
)
assert.equal(projectWithInvalidActiveConversation.conversations.length, 2)
assert.equal(projectWithInvalidActiveConversation.activeConversationId, 'first-conversation')

const validProject = {
  id: 'valid-project',
  activeConversationId: 'second-conversation',
  conversations: [
    { id: 'first-conversation', title: '第一条对话' },
    { id: 'second-conversation', title: '第二条对话' },
  ],
}
assert.equal(
  recoverProjectConversationState(validProject, createRecoveredConversation),
  validProject,
)

console.log('Empty conversation recovery regression checks passed.')
