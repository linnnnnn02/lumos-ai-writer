import type { AiAnalysisResult } from '@lumos-ai/shared'

export type WorkspaceAnalysisSnapshot = {
  analysisByConversation: Record<string, AiAnalysisResult>
}

export type WorkspaceAnalysisState = WorkspaceAnalysisSnapshot & {
  analysisPendingConversationId: string
  analysisWaitStartedAt: number | null
  analysisErrorByConversation: Record<string, string>
  chatReplyPendingConversationId: string
}

export type WorkspaceAnalysisAction =
  | { type: 'replace-analyses'; snapshot: WorkspaceAnalysisSnapshot }
  | { type: 'invalidate-analysis'; conversationId: string }
  | { type: 'clear-error'; conversationId: string }
  | { type: 'start-analysis'; conversationId: string; startedAt: number }
  | {
      type: 'record-analysis'
      conversationId: string
      analysis: AiAnalysisResult
    }
  | { type: 'fail-analysis'; conversationId: string; error: string }
  | { type: 'finish-analysis'; conversationId: string }
  | { type: 'start-chat-reply'; conversationId: string }
  | { type: 'finish-chat-reply'; conversationId: string }
  | { type: 'clear-chat-reply' }
  | { type: 'reset-conversation'; conversationId: string }

function withoutConversation<T>(record: Record<string, T>, conversationId: string) {
  if (!(conversationId in record)) return record

  const next = { ...record }
  delete next[conversationId]
  return next
}

export function createWorkspaceAnalysisState(
  initialState: WorkspaceAnalysisState,
): WorkspaceAnalysisState {
  return {
    analysisByConversation: initialState.analysisByConversation,
    analysisPendingConversationId: initialState.analysisPendingConversationId,
    analysisWaitStartedAt: initialState.analysisWaitStartedAt,
    analysisErrorByConversation: initialState.analysisErrorByConversation,
    chatReplyPendingConversationId: initialState.chatReplyPendingConversationId,
  }
}

export function workspaceAnalysisReducer(
  state: WorkspaceAnalysisState,
  action: WorkspaceAnalysisAction,
): WorkspaceAnalysisState {
  if (action.type === 'replace-analyses') {
    return {
      ...action.snapshot,
      analysisPendingConversationId: '',
      analysisWaitStartedAt: null,
      analysisErrorByConversation: {},
      chatReplyPendingConversationId: '',
    }
  }

  if (action.type === 'invalidate-analysis') {
    return {
      ...state,
      analysisByConversation: withoutConversation(
        state.analysisByConversation,
        action.conversationId,
      ),
      analysisErrorByConversation: withoutConversation(
        state.analysisErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'clear-error') {
    return {
      ...state,
      analysisErrorByConversation: withoutConversation(
        state.analysisErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'start-analysis') {
    return {
      ...state,
      analysisPendingConversationId: action.conversationId,
      analysisWaitStartedAt: action.startedAt,
      analysisErrorByConversation: withoutConversation(
        state.analysisErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'record-analysis') {
    return {
      ...state,
      analysisByConversation: {
        ...state.analysisByConversation,
        [action.conversationId]: action.analysis,
      },
    }
  }

  if (action.type === 'fail-analysis') {
    return {
      ...state,
      analysisErrorByConversation: {
        ...state.analysisErrorByConversation,
        [action.conversationId]: action.error,
      },
    }
  }

  if (action.type === 'finish-analysis') {
    if (state.analysisPendingConversationId !== action.conversationId) return state

    return {
      ...state,
      analysisPendingConversationId: '',
      analysisWaitStartedAt: null,
    }
  }

  if (action.type === 'start-chat-reply') {
    return {
      ...state,
      chatReplyPendingConversationId: action.conversationId,
    }
  }

  if (action.type === 'finish-chat-reply') {
    if (state.chatReplyPendingConversationId !== action.conversationId) return state

    return {
      ...state,
      chatReplyPendingConversationId: '',
    }
  }

  if (action.type === 'clear-chat-reply') {
    if (!state.chatReplyPendingConversationId) return state

    return {
      ...state,
      chatReplyPendingConversationId: '',
    }
  }

  if (action.type === 'reset-conversation') {
    return {
      analysisByConversation: withoutConversation(
        state.analysisByConversation,
        action.conversationId,
      ),
      analysisPendingConversationId:
        state.analysisPendingConversationId === action.conversationId
          ? ''
          : state.analysisPendingConversationId,
      analysisWaitStartedAt:
        state.analysisPendingConversationId === action.conversationId
          ? null
          : state.analysisWaitStartedAt,
      analysisErrorByConversation: withoutConversation(
        state.analysisErrorByConversation,
        action.conversationId,
      ),
      chatReplyPendingConversationId:
        state.chatReplyPendingConversationId === action.conversationId
          ? ''
          : state.chatReplyPendingConversationId,
    }
  }

  return state
}
