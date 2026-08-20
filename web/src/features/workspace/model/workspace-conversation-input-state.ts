import type { ChatAttachment } from './workspace-model'

export type PlanAttachment = ChatAttachment

export type WorkspaceConversationInputSnapshot = {
  chatInputByConversation: Record<string, string>
  planAttachmentsByConversation: Record<string, PlanAttachment[]>
}

export type WorkspaceConversationInputState = WorkspaceConversationInputSnapshot & {
  writingRequestDraftByConversation: Record<string, string>
  referenceSelectionDraftByConversation: Record<string, string[]>
}

export type WorkspaceConversationInputAction =
  | {
      type: 'replace-persisted-inputs'
      snapshot: WorkspaceConversationInputSnapshot
    }
  | { type: 'set-chat-input'; conversationId: string; input: string }
  | { type: 'set-writing-request'; conversationId: string; input: string }
  | { type: 'open-reference-selection'; conversationId: string; itemIds: string[] }
  | { type: 'set-reference-selection'; conversationId: string; itemIds: string[] }
  | { type: 'toggle-reference-items'; conversationId: string; itemIds: string[] }
  | { type: 'select-reference-items'; conversationId: string; itemIds: string[] }
  | { type: 'deselect-reference-items'; conversationId: string; itemIds: string[] }
  | { type: 'clear-reference-selection'; conversationId: string }
  | { type: 'clear-writing-request'; conversationId: string }
  | { type: 'clear-conversation-transient'; conversationId: string }
  | { type: 'clear-all-transient' }
  | {
      type: 'add-attachments'
      conversationId: string
      attachments: PlanAttachment[]
    }
  | { type: 'remove-attachment'; conversationId: string; attachmentId: string }
  | { type: 'clear-attachments'; conversationId: string }
  | { type: 'reset-conversation'; conversationId: string }

function withoutConversation<T>(record: Record<string, T>, conversationId: string) {
  if (!(conversationId in record)) return record

  const next = { ...record }
  delete next[conversationId]
  return next
}

function uniqueItemIds(itemIds: string[]) {
  return Array.from(new Set(itemIds))
}

export function createWorkspaceConversationInputState(
  initialState: WorkspaceConversationInputState,
): WorkspaceConversationInputState {
  return {
    chatInputByConversation: initialState.chatInputByConversation,
    planAttachmentsByConversation: initialState.planAttachmentsByConversation,
    writingRequestDraftByConversation: initialState.writingRequestDraftByConversation,
    referenceSelectionDraftByConversation:
      initialState.referenceSelectionDraftByConversation,
  }
}

export function workspaceConversationInputReducer(
  state: WorkspaceConversationInputState,
  action: WorkspaceConversationInputAction,
): WorkspaceConversationInputState {
  if (action.type === 'replace-persisted-inputs') {
    return {
      ...action.snapshot,
      writingRequestDraftByConversation: {},
      referenceSelectionDraftByConversation: {},
    }
  }

  if (action.type === 'set-chat-input') {
    return {
      ...state,
      chatInputByConversation: {
        ...state.chatInputByConversation,
        [action.conversationId]: action.input,
      },
    }
  }

  if (action.type === 'set-writing-request') {
    return {
      ...state,
      writingRequestDraftByConversation: {
        ...state.writingRequestDraftByConversation,
        [action.conversationId]: action.input,
      },
    }
  }

  if (action.type === 'open-reference-selection' || action.type === 'set-reference-selection') {
    return {
      ...state,
      referenceSelectionDraftByConversation: {
        ...state.referenceSelectionDraftByConversation,
        [action.conversationId]: uniqueItemIds(action.itemIds),
      },
    }
  }

  if (action.type === 'toggle-reference-items') {
    const nextIds = new Set(
      state.referenceSelectionDraftByConversation[action.conversationId] ?? [],
    )
    const allSelected = action.itemIds.every((itemId) => nextIds.has(itemId))
    action.itemIds.forEach((itemId) => {
      if (allSelected) nextIds.delete(itemId)
      else nextIds.add(itemId)
    })

    return {
      ...state,
      referenceSelectionDraftByConversation: {
        ...state.referenceSelectionDraftByConversation,
        [action.conversationId]: Array.from(nextIds),
      },
    }
  }

  if (action.type === 'select-reference-items') {
    return {
      ...state,
      referenceSelectionDraftByConversation: {
        ...state.referenceSelectionDraftByConversation,
        [action.conversationId]: uniqueItemIds([
          ...(state.referenceSelectionDraftByConversation[action.conversationId] ?? []),
          ...action.itemIds,
        ]),
      },
    }
  }

  if (action.type === 'deselect-reference-items') {
    const removedIds = new Set(action.itemIds)
    return {
      ...state,
      referenceSelectionDraftByConversation: {
        ...state.referenceSelectionDraftByConversation,
        [action.conversationId]: (
          state.referenceSelectionDraftByConversation[action.conversationId] ?? []
        ).filter((itemId) => !removedIds.has(itemId)),
      },
    }
  }

  if (action.type === 'clear-reference-selection') {
    return {
      ...state,
      referenceSelectionDraftByConversation: withoutConversation(
        state.referenceSelectionDraftByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'clear-writing-request') {
    return {
      ...state,
      writingRequestDraftByConversation: withoutConversation(
        state.writingRequestDraftByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'clear-conversation-transient') {
    return {
      ...state,
      writingRequestDraftByConversation: withoutConversation(
        state.writingRequestDraftByConversation,
        action.conversationId,
      ),
      referenceSelectionDraftByConversation: withoutConversation(
        state.referenceSelectionDraftByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'clear-all-transient') {
    return {
      ...state,
      writingRequestDraftByConversation: {},
      referenceSelectionDraftByConversation: {},
    }
  }

  if (action.type === 'add-attachments') {
    return {
      ...state,
      planAttachmentsByConversation: {
        ...state.planAttachmentsByConversation,
        [action.conversationId]: [
          ...(state.planAttachmentsByConversation[action.conversationId] ?? []),
          ...action.attachments,
        ],
      },
    }
  }

  if (action.type === 'remove-attachment') {
    return {
      ...state,
      planAttachmentsByConversation: {
        ...state.planAttachmentsByConversation,
        [action.conversationId]: (
          state.planAttachmentsByConversation[action.conversationId] ?? []
        ).filter((attachment) => attachment.id !== action.attachmentId),
      },
    }
  }

  if (action.type === 'clear-attachments') {
    return {
      ...state,
      planAttachmentsByConversation: withoutConversation(
        state.planAttachmentsByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'reset-conversation') {
    return {
      chatInputByConversation: withoutConversation(
        state.chatInputByConversation,
        action.conversationId,
      ),
      planAttachmentsByConversation: withoutConversation(
        state.planAttachmentsByConversation,
        action.conversationId,
      ),
      writingRequestDraftByConversation: withoutConversation(
        state.writingRequestDraftByConversation,
        action.conversationId,
      ),
      referenceSelectionDraftByConversation: withoutConversation(
        state.referenceSelectionDraftByConversation,
        action.conversationId,
      ),
    }
  }

  return state
}
