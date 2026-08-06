import type { DraftCopy, DraftVersionRecord } from '../../../lib/draft-versions'

export type WorkspaceDraftSnapshot = {
  draftReadyByConversation: Record<string, boolean>
  draftCopyByConversation: Record<string, DraftCopy>
  draftVersionsByConversation: Record<string, DraftVersionRecord[]>
  currentDraftVersionIdByConversation: Record<string, string>
}

export type WorkspaceDraftState = WorkspaceDraftSnapshot & {
  draftGenerationErrorByConversation: Record<string, string>
}

export type WorkspaceDraftAction =
  | { type: 'replace-drafts'; snapshot: WorkspaceDraftSnapshot }
  | { type: 'invalidate-draft'; conversationId: string }
  | { type: 'restore-draft-readiness'; conversationId: string }
  | {
      type: 'set-generation-error'
      conversationId: string
      error: string
      restoreReady?: boolean
    }
  | {
      type: 'record-draft'
      conversationId: string
      draft: DraftCopy
      versions: DraftVersionRecord[]
      currentVersionId: string
    }
  | {
      type: 'update-versions'
      conversationId: string
      versions: DraftVersionRecord[]
    }
  | { type: 'reset-conversation'; conversationId: string }

function withoutConversation<T>(record: Record<string, T>, conversationId: string) {
  if (!(conversationId in record)) return record

  const next = { ...record }
  delete next[conversationId]
  return next
}

export function createWorkspaceDraftState(
  initialState: WorkspaceDraftState,
): WorkspaceDraftState {
  return {
    draftReadyByConversation: initialState.draftReadyByConversation,
    draftCopyByConversation: initialState.draftCopyByConversation,
    draftVersionsByConversation: initialState.draftVersionsByConversation,
    currentDraftVersionIdByConversation:
      initialState.currentDraftVersionIdByConversation,
    draftGenerationErrorByConversation:
      initialState.draftGenerationErrorByConversation,
  }
}

export function workspaceDraftReducer(
  state: WorkspaceDraftState,
  action: WorkspaceDraftAction,
): WorkspaceDraftState {
  if (action.type === 'replace-drafts') {
    return {
      ...action.snapshot,
      draftGenerationErrorByConversation: {},
    }
  }

  if (action.type === 'invalidate-draft') {
    return {
      ...state,
      draftReadyByConversation: {
        ...state.draftReadyByConversation,
        [action.conversationId]: false,
      },
      draftGenerationErrorByConversation: withoutConversation(
        state.draftGenerationErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'restore-draft-readiness') {
    if (!state.draftCopyByConversation[action.conversationId]) return state

    return {
      ...state,
      draftReadyByConversation: {
        ...state.draftReadyByConversation,
        [action.conversationId]: true,
      },
    }
  }

  if (action.type === 'set-generation-error') {
    const draftGenerationErrorByConversation = action.error
      ? {
          ...state.draftGenerationErrorByConversation,
          [action.conversationId]: action.error,
        }
      : withoutConversation(
          state.draftGenerationErrorByConversation,
          action.conversationId,
        )
    const canRestoreReady =
      action.restoreReady && Boolean(state.draftCopyByConversation[action.conversationId])

    return {
      ...state,
      ...(canRestoreReady
        ? {
            draftReadyByConversation: {
              ...state.draftReadyByConversation,
              [action.conversationId]: true,
            },
          }
        : {}),
      draftGenerationErrorByConversation,
    }
  }

  if (action.type === 'record-draft') {
    const currentVersionId = action.versions.some(
      (version) => version.id === action.currentVersionId,
    )
      ? action.currentVersionId
      : action.versions[action.versions.length - 1]?.id ?? ''

    return {
      ...state,
      draftReadyByConversation: {
        ...state.draftReadyByConversation,
        [action.conversationId]: true,
      },
      draftCopyByConversation: {
        ...state.draftCopyByConversation,
        [action.conversationId]: {
          title: action.draft.title,
          body: [...action.draft.body],
        },
      },
      draftVersionsByConversation: {
        ...state.draftVersionsByConversation,
        [action.conversationId]: action.versions,
      },
      currentDraftVersionIdByConversation: currentVersionId
        ? {
            ...state.currentDraftVersionIdByConversation,
            [action.conversationId]: currentVersionId,
          }
        : withoutConversation(
            state.currentDraftVersionIdByConversation,
            action.conversationId,
          ),
      draftGenerationErrorByConversation: withoutConversation(
        state.draftGenerationErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'update-versions') {
    return {
      ...state,
      draftVersionsByConversation: {
        ...state.draftVersionsByConversation,
        [action.conversationId]: action.versions,
      },
    }
  }

  if (action.type === 'reset-conversation') {
    return {
      draftReadyByConversation: withoutConversation(
        state.draftReadyByConversation,
        action.conversationId,
      ),
      draftCopyByConversation: withoutConversation(
        state.draftCopyByConversation,
        action.conversationId,
      ),
      draftVersionsByConversation: withoutConversation(
        state.draftVersionsByConversation,
        action.conversationId,
      ),
      currentDraftVersionIdByConversation: withoutConversation(
        state.currentDraftVersionIdByConversation,
        action.conversationId,
      ),
      draftGenerationErrorByConversation: withoutConversation(
        state.draftGenerationErrorByConversation,
        action.conversationId,
      ),
    }
  }

  return state
}
