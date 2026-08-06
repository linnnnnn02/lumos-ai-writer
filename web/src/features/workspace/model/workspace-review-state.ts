import type {
  AiRewriteSuggestion,
  AppliedWritingProfileContext,
} from '@lumos-ai/shared'

export type RewriteChatMessage = {
  id: string
  role: 'assistant' | 'user'
  selectedText?: string
  lines: string[]
  fieldId?: string
  instruction?: string
  suggestions?: Array<
    AiRewriteSuggestion & {
      id: string
      status: 'available' | 'accepted' | 'rejected' | 'superseded'
    }
  >
  recommendedIndex?: number
  appliedWritingProfile?: AppliedWritingProfileContext
}

export type WorkspaceReviewSnapshot = {
  rewriteInputByConversation: Record<string, string>
  rewriteMessagesByConversation: Record<string, RewriteChatMessage[]>
}

export type WorkspaceReviewState = WorkspaceReviewSnapshot & {
  rewritePendingConversationId: string
}

export type WorkspaceReviewAction =
  | { type: 'replace-review'; snapshot: WorkspaceReviewSnapshot }
  | { type: 'set-input'; conversationId: string; input: string }
  | {
      type: 'append-messages'
      conversationId: string
      messages: RewriteChatMessage[]
      clearInput?: boolean
    }
  | {
      type: 'start-request'
      conversationId: string
      userMessage: RewriteChatMessage
    }
  | {
      type: 'finish-request'
      conversationId: string
      assistantMessage: RewriteChatMessage
    }
  | {
      type: 'accept-suggestion'
      conversationId: string
      messageId: string
      suggestionId: string
    }
  | {
      type: 'reject-suggestion'
      conversationId: string
      messageId: string
      suggestionId: string
    }
  | { type: 'reset-conversation'; conversationId: string }

function withoutConversation<T>(record: Record<string, T>, conversationId: string) {
  if (!(conversationId in record)) return record

  const next = { ...record }
  delete next[conversationId]
  return next
}

function appendMessages(
  state: WorkspaceReviewState,
  conversationId: string,
  messages: RewriteChatMessage[],
) {
  return {
    ...state.rewriteMessagesByConversation,
    [conversationId]: [
      ...(state.rewriteMessagesByConversation[conversationId] ?? []),
      ...messages,
    ],
  }
}

function updateSuggestionStatus(
  messages: RewriteChatMessage[],
  messageId: string,
  suggestionId: string,
  status: 'accepted' | 'rejected',
) {
  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          suggestions: message.suggestions?.map((suggestion) => ({
            ...suggestion,
            status:
              suggestion.id === suggestionId
                ? status
                : status === 'accepted' && suggestion.status === 'available'
                  ? 'superseded'
                  : suggestion.status,
          })),
        }
      : message,
  )
}

export function createWorkspaceReviewState(
  initialState: WorkspaceReviewState,
): WorkspaceReviewState {
  return {
    rewriteInputByConversation: initialState.rewriteInputByConversation,
    rewriteMessagesByConversation: initialState.rewriteMessagesByConversation,
    rewritePendingConversationId: initialState.rewritePendingConversationId,
  }
}

export function workspaceReviewReducer(
  state: WorkspaceReviewState,
  action: WorkspaceReviewAction,
): WorkspaceReviewState {
  if (action.type === 'replace-review') {
    return {
      ...action.snapshot,
      rewritePendingConversationId: '',
    }
  }

  if (action.type === 'set-input') {
    return {
      ...state,
      rewriteInputByConversation: {
        ...state.rewriteInputByConversation,
        [action.conversationId]: action.input,
      },
    }
  }

  if (action.type === 'append-messages') {
    return {
      ...state,
      rewriteInputByConversation: action.clearInput
        ? {
            ...state.rewriteInputByConversation,
            [action.conversationId]: '',
          }
        : state.rewriteInputByConversation,
      rewriteMessagesByConversation: appendMessages(
        state,
        action.conversationId,
        action.messages,
      ),
    }
  }

  if (action.type === 'start-request') {
    return {
      ...state,
      rewriteInputByConversation: {
        ...state.rewriteInputByConversation,
        [action.conversationId]: '',
      },
      rewriteMessagesByConversation: appendMessages(
        state,
        action.conversationId,
        [action.userMessage],
      ),
      rewritePendingConversationId: action.conversationId,
    }
  }

  if (action.type === 'finish-request') {
    return {
      ...state,
      rewriteMessagesByConversation: appendMessages(
        state,
        action.conversationId,
        [action.assistantMessage],
      ),
      rewritePendingConversationId:
        state.rewritePendingConversationId === action.conversationId
          ? ''
          : state.rewritePendingConversationId,
    }
  }

  if (action.type === 'accept-suggestion' || action.type === 'reject-suggestion') {
    return {
      ...state,
      rewriteMessagesByConversation: {
        ...state.rewriteMessagesByConversation,
        [action.conversationId]: updateSuggestionStatus(
          state.rewriteMessagesByConversation[action.conversationId] ?? [],
          action.messageId,
          action.suggestionId,
          action.type === 'accept-suggestion' ? 'accepted' : 'rejected',
        ),
      },
    }
  }

  if (action.type === 'reset-conversation') {
    return {
      rewriteInputByConversation: withoutConversation(
        state.rewriteInputByConversation,
        action.conversationId,
      ),
      rewriteMessagesByConversation: withoutConversation(
        state.rewriteMessagesByConversation,
        action.conversationId,
      ),
      rewritePendingConversationId:
        state.rewritePendingConversationId === action.conversationId
          ? ''
          : state.rewritePendingConversationId,
    }
  }

  return state
}
