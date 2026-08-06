export type ConversationStep = 'learn' | 'length' | 'plan' | 'rewrite' | 'reader'

export type ConversationStage =
  | 'intake'
  | 'references'
  | 'draft'
  | 'review'
  | 'confirm'
  | 'finalized'

export type AppNavigationHistoryState = {
  lumosNavigation: true
  view: 'workspace' | 'library' | 'conversation'
  projectId?: string
  conversationId?: string
  stage?: ConversationStage
  canReturnToWorkspace?: boolean
}

export type WorkspaceNavigationState = {
  view: AppNavigationHistoryState['view']
  stageOverride: ConversationStage | null
  pendingTarget: AppNavigationHistoryState | null
  isConversationSidebarOpen: boolean
}

export type WorkspaceNavigationAction =
  | { type: 'queue-target'; target: AppNavigationHistoryState }
  | { type: 'location-requested'; target: AppNavigationHistoryState }
  | { type: 'show-view'; view: 'workspace' | 'library' }
  | { type: 'show-conversation'; stage: ConversationStage }
  | { type: 'clear-conversation-context' }
  | { type: 'set-sidebar-open'; open: boolean }

type ConversationProgress = {
  analysisReady: boolean
  finalizedAt?: string
  step: ConversationStep
  workflowStage?: ConversationStage
  writingRequest: string
  topic: string
}

const conversationStages: ConversationStage[] = [
  'intake',
  'references',
  'draft',
  'review',
  'confirm',
  'finalized',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isConversationStage(value: unknown): value is ConversationStage {
  return typeof value === 'string' && conversationStages.includes(value as ConversationStage)
}

export function deriveLegacyConversationStage(input: {
  analysisReady: boolean
  finalizedAt?: string
  step: ConversationStep
  topic: string
}): ConversationStage {
  if (input.finalizedAt) return 'finalized'
  if (input.step === 'reader') return 'confirm'
  if (input.step === 'rewrite') return 'review'
  if (input.step === 'plan' || input.step === 'length') return 'draft'
  if (!input.topic.trim()) return 'intake'
  return input.analysisReady ? 'draft' : 'references'
}

export function getConversationStage(conversation: ConversationProgress): ConversationStage {
  return isConversationStage(conversation.workflowStage)
    ? conversation.workflowStage
    : deriveLegacyConversationStage(conversation)
}

export function getStepForStage(stage: ConversationStage): ConversationStep {
  if (stage === 'intake' || stage === 'references') return 'learn'
  if (stage === 'draft') return 'plan'
  if (stage === 'review') return 'rewrite'
  return 'reader'
}

export function getResumableStageFromAvailability(input: {
  conversation: ConversationProgress
  hasAnalysis: boolean
  hasDraft: boolean
}): ConversationStage {
  const { conversation, hasAnalysis, hasDraft } = input
  const hasWritingRequest = Boolean(
    conversation.writingRequest.trim() || conversation.topic.trim(),
  )
  if (!hasWritingRequest) return 'intake'
  if (!hasDraft) return hasAnalysis ? 'draft' : 'references'
  if (conversation.finalizedAt) return 'finalized'

  return getConversationStage(conversation) === 'confirm' ? 'confirm' : 'review'
}

export function getSafeNavigationStage(input: {
  conversation: ConversationProgress
  hasAnalysis: boolean
  hasDraft: boolean
  requestedStage?: ConversationStage
}): ConversationStage {
  const { conversation, hasAnalysis, hasDraft, requestedStage } = input
  const resumableStage = getResumableStageFromAvailability({
    conversation,
    hasAnalysis,
    hasDraft,
  })

  if (!requestedStage) return resumableStage
  if (requestedStage === 'intake') return requestedStage
  if (requestedStage === 'references') {
    return conversation.writingRequest.trim() || conversation.topic.trim()
      ? requestedStage
      : 'intake'
  }
  if (requestedStage === 'draft') return hasAnalysis ? requestedStage : resumableStage
  if (!hasDraft) return resumableStage
  if (requestedStage === 'finalized' && !conversation.finalizedAt) return resumableStage
  return requestedStage
}

export function isAppNavigationHistoryState(
  value: unknown,
): value is AppNavigationHistoryState {
  if (
    !isRecord(value) ||
    value.lumosNavigation !== true ||
    (value.view !== 'workspace' && value.view !== 'library' && value.view !== 'conversation')
  ) {
    return false
  }

  if (value.view === 'conversation' && (typeof value.projectId !== 'string' || !value.projectId)) {
    return false
  }
  if (value.conversationId !== undefined && typeof value.conversationId !== 'string') return false
  if (value.stage !== undefined && !isConversationStage(value.stage)) return false
  return value.canReturnToWorkspace === undefined || typeof value.canReturnToWorkspace === 'boolean'
}

export function parseAppNavigationHash(hash: string): AppNavigationHistoryState | null {
  const value = hash.replace(/^#/, '')
  if (value === 'projects') return { lumosNavigation: true, view: 'workspace' }
  if (value === 'library') return { lumosNavigation: true, view: 'library' }

  const parameters = new URLSearchParams(value)
  const projectId = parameters.get('project')?.trim() ?? ''
  if (!projectId) return null

  const conversationId = parameters.get('conversation')?.trim() || undefined
  const requestedStage = parameters.get('stage')
  const stage = requestedStage && isConversationStage(requestedStage) ? requestedStage : undefined

  return {
    lumosNavigation: true,
    view: 'conversation',
    projectId,
    conversationId,
    stage,
  }
}

export function getAppNavigationHash(state: AppNavigationHistoryState) {
  if (state.view === 'workspace') return '#projects'
  if (state.view === 'library') return '#library'

  const parameters = new URLSearchParams({ project: state.projectId ?? '' })
  if (state.conversationId) parameters.set('conversation', state.conversationId)
  if (state.stage) parameters.set('stage', state.stage)
  return `#${parameters.toString()}`
}

export function readAppNavigationHistory(state: unknown = window.history.state) {
  const hashNavigation = parseAppNavigationHash(window.location.hash)
  if (hashNavigation) {
    return {
      ...hashNavigation,
      canReturnToWorkspace:
        isAppNavigationHistoryState(state) &&
        getAppNavigationHash(state) === window.location.hash &&
        state.canReturnToWorkspace !== undefined
          ? state.canReturnToWorkspace
          : hashNavigation.canReturnToWorkspace,
    }
  }

  if (window.location.hash) {
    return { lumosNavigation: true, view: 'workspace' } satisfies AppNavigationHistoryState
  }

  return isAppNavigationHistoryState(state)
    ? state
    : ({ lumosNavigation: true, view: 'workspace' } satisfies AppNavigationHistoryState)
}

export function writeAppNavigationHistory(
  mode: 'push' | 'replace',
  state: AppNavigationHistoryState,
) {
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](
    state,
    '',
    getAppNavigationHash(state),
  )
}

export function createWorkspaceNavigationState(
  initialTarget: AppNavigationHistoryState,
): WorkspaceNavigationState {
  return {
    view: initialTarget.view,
    stageOverride: null,
    pendingTarget: initialTarget,
    isConversationSidebarOpen: false,
  }
}

export function workspaceNavigationReducer(
  state: WorkspaceNavigationState,
  action: WorkspaceNavigationAction,
): WorkspaceNavigationState {
  if (action.type === 'queue-target') {
    return { ...state, pendingTarget: action.target }
  }

  if (action.type === 'location-requested') {
    return {
      ...state,
      stageOverride: null,
      pendingTarget: action.target,
      isConversationSidebarOpen: false,
    }
  }

  if (action.type === 'show-view') {
    return {
      view: action.view,
      stageOverride: null,
      pendingTarget: null,
      isConversationSidebarOpen: false,
    }
  }

  if (action.type === 'show-conversation') {
    return {
      ...state,
      view: 'conversation',
      stageOverride: action.stage,
      pendingTarget: null,
    }
  }

  if (action.type === 'clear-conversation-context') {
    return {
      ...state,
      stageOverride: null,
      isConversationSidebarOpen: false,
    }
  }

  if (action.type === 'set-sidebar-open') {
    return { ...state, isConversationSidebarOpen: action.open }
  }

  return state
}
