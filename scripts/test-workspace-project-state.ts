import assert from 'node:assert/strict'
import {
  createWorkspaceProjectState,
  workspaceProjectReducer,
} from '../web/src/features/workspace/model/workspace-project-state.js'
import type {
  ConversationRecord,
  ProjectRecord,
} from '../web/src/features/workspace/model/workspace-model.js'

function createConversation(id: string): ConversationRecord {
  return {
    id,
    title: `对话 ${id}`,
    step: 'learn',
    workflowStage: 'references',
    writingRequest: '写一篇真实体验',
    createdAt: '2026-08-01T00:00:00.000Z',
    lastOpenedAt: '2026-08-01T00:00:00.000Z',
    selectedItemIds: ['note:keep', 'note:remove', 'snippet:remove'],
    chatMessages: [],
    analysisReady: false,
    length: 'medium',
    topic: '真实体验',
    targetAudience: '普通读者',
    writingBrief: {
      objective: '说明体验',
      requiredFacts: '时间和地点',
      boundaries: '不夸张',
      instructions: '',
    },
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function createProject(id: string, conversationId: string): ProjectRecord {
  return {
    id,
    name: `项目 ${id}`,
    folderId: '',
    conversations: [createConversation(conversationId)],
    activeConversationId: conversationId,
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

const projectOne = createProject('project-1', 'conversation-1')
const projectTwo = createProject('project-2', 'conversation-2')

let state = createWorkspaceProjectState({
  projects: [projectOne, projectTwo],
  activeProjectId: 'missing-project',
})
assert.equal(state.activeProjectId, 'project-1')

state = workspaceProjectReducer(state, {
  type: 'activate-project',
  projectId: 'project-2',
  conversationId: 'conversation-2',
})
assert.equal(state.activeProjectId, 'project-2')
assert.equal(state.projects[1]?.activeConversationId, 'conversation-2')

const beforeMissingActivation = state
state = workspaceProjectReducer(state, {
  type: 'activate-project',
  projectId: 'missing-project',
})
assert.equal(state, beforeMissingActivation)

state = workspaceProjectReducer(state, {
  type: 'update-conversation',
  projectId: 'project-2',
  conversationId: 'conversation-2',
  now: '2026-08-06T10:00:00.000Z',
  update: (conversation) => ({ ...conversation, title: '已更新的对话' }),
})
assert.equal(state.projects[1]?.updatedAt, '2026-08-06T10:00:00.000Z')
assert.equal(state.projects[1]?.conversations[0]?.updatedAt, '2026-08-06T10:00:00.000Z')
assert.equal(state.projects[1]?.conversations[0]?.title, '已更新的对话')

state = workspaceProjectReducer(state, {
  type: 'remove-selected-items',
  itemIds: ['note:remove', 'snippet:remove'],
})
assert.deepEqual(state.projects[0]?.conversations[0]?.selectedItemIds, ['note:keep'])
assert.deepEqual(state.projects[1]?.conversations[0]?.selectedItemIds, ['note:keep'])

state = workspaceProjectReducer(state, { type: 'delete-project', projectId: 'project-2' })
assert.equal(state.activeProjectId, 'project-1')
assert.deepEqual(state.projects.map((project) => project.id), ['project-1'])

const projectThree = createProject('project-3', 'conversation-3')
state = workspaceProjectReducer(state, {
  type: 'add-project',
  project: projectThree,
  activate: true,
})
assert.equal(state.activeProjectId, 'project-3')
assert.deepEqual(state.projects.map((project) => project.id), ['project-3', 'project-1'])

state = workspaceProjectReducer(state, {
  type: 'replace-projects',
  projects: [],
  preferredActiveProjectId: 'project-3',
})
assert.equal(state.activeProjectId, '')
assert.deepEqual(state.projects, [])

console.log('workspace project state passed')
