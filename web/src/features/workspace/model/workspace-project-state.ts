import type { ConversationRecord, ProjectRecord } from './workspace-model'

export type WorkspaceProjectState = {
  projects: ProjectRecord[]
  activeProjectId: string
}

export type WorkspaceProjectAction =
  | {
      type: 'replace-projects'
      projects: ProjectRecord[]
      preferredActiveProjectId?: string
    }
  | {
      type: 'activate-project'
      projectId: string
      conversationId?: string
    }
  | {
      type: 'add-project'
      project: ProjectRecord
      activate?: boolean
    }
  | { type: 'delete-project'; projectId: string }
  | {
      type: 'update-project'
      projectId: string
      update: (project: ProjectRecord) => ProjectRecord
    }
  | {
      type: 'update-conversation'
      projectId: string
      conversationId: string
      now: string
      update: (conversation: ConversationRecord) => ConversationRecord
    }
  | { type: 'remove-selected-items'; itemIds: string[] }

function resolveActiveProjectId(projects: ProjectRecord[], preferredActiveProjectId?: string) {
  if (
    preferredActiveProjectId &&
    projects.some((project) => project.id === preferredActiveProjectId)
  ) {
    return preferredActiveProjectId
  }

  return projects[0]?.id ?? ''
}

export function createWorkspaceProjectState(
  initialState: WorkspaceProjectState,
): WorkspaceProjectState {
  return {
    projects: initialState.projects,
    activeProjectId: resolveActiveProjectId(
      initialState.projects,
      initialState.activeProjectId,
    ),
  }
}

export function workspaceProjectReducer(
  state: WorkspaceProjectState,
  action: WorkspaceProjectAction,
): WorkspaceProjectState {
  if (action.type === 'replace-projects') {
    return {
      projects: action.projects,
      activeProjectId: resolveActiveProjectId(
        action.projects,
        action.preferredActiveProjectId,
      ),
    }
  }

  if (action.type === 'activate-project') {
    const project = state.projects.find((item) => item.id === action.projectId)
    if (!project) return state

    const canActivateConversation =
      action.conversationId &&
      project.conversations.some((conversation) => conversation.id === action.conversationId)

    return {
      projects: canActivateConversation
        ? state.projects.map((item) =>
            item.id === action.projectId
              ? { ...item, activeConversationId: action.conversationId ?? item.activeConversationId }
              : item,
          )
        : state.projects,
      activeProjectId: action.projectId,
    }
  }

  if (action.type === 'add-project') {
    const projects = [
      action.project,
      ...state.projects.filter((project) => project.id !== action.project.id),
    ]
    return {
      projects,
      activeProjectId: action.activate
        ? action.project.id
        : resolveActiveProjectId(projects, state.activeProjectId),
    }
  }

  if (action.type === 'delete-project') {
    const projects = state.projects.filter((project) => project.id !== action.projectId)
    return {
      projects,
      activeProjectId: resolveActiveProjectId(projects, state.activeProjectId),
    }
  }

  if (action.type === 'update-project') {
    return {
      ...state,
      projects: state.projects.map((project) =>
        project.id === action.projectId ? action.update(project) : project,
      ),
    }
  }

  if (action.type === 'update-conversation') {
    return {
      ...state,
      projects: state.projects.map((project) =>
        project.id === action.projectId
          ? {
              ...project,
              updatedAt: action.now,
              conversations: project.conversations.map((conversation) =>
                conversation.id === action.conversationId
                  ? { ...action.update(conversation), updatedAt: action.now }
                  : conversation,
              ),
            }
          : project,
      ),
    }
  }

  if (action.type === 'remove-selected-items') {
    const removedItemIds = new Set(action.itemIds)
    if (removedItemIds.size === 0) return state

    return {
      ...state,
      projects: state.projects.map((project) => ({
        ...project,
        conversations: project.conversations.map((conversation) => ({
          ...conversation,
          selectedItemIds: conversation.selectedItemIds.filter(
            (itemId) => !removedItemIds.has(itemId),
          ),
        })),
      })),
    }
  }

  return state
}
