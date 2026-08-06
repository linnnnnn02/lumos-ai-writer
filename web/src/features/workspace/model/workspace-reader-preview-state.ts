import type { AiReaderPreviewResult } from '@lumos-ai/shared'
import type { DraftCopy } from '../../../lib/draft-versions'

export type ReaderPreviewRecord = {
  audience: string
  draft: DraftCopy
  preview: AiReaderPreviewResult
}

export type WorkspaceReaderPreviewSnapshot = {
  readerAudienceByConversation: Record<string, string>
  readerPreviewByConversation: Record<string, ReaderPreviewRecord>
}

export type WorkspaceReaderPreviewState = WorkspaceReaderPreviewSnapshot & {
  readerPreviewPendingConversationId: string
  readerPreviewErrorByConversation: Record<string, string>
}

export type WorkspaceReaderPreviewAction =
  | {
      type: 'replace-reader-preview'
      snapshot: WorkspaceReaderPreviewSnapshot
    }
  | { type: 'set-audience'; conversationId: string; audience: string }
  | { type: 'invalidate-preview'; conversationId: string }
  | { type: 'clear-error'; conversationId: string }
  | { type: 'set-error'; conversationId: string; error: string }
  | { type: 'start-request'; conversationId: string }
  | {
      type: 'finish-success'
      conversationId: string
      record: ReaderPreviewRecord
    }
  | { type: 'finish-error'; conversationId: string; error: string }
  | { type: 'reset-conversation'; conversationId: string }

function withoutConversation<T>(record: Record<string, T>, conversationId: string) {
  if (!(conversationId in record)) return record

  const next = { ...record }
  delete next[conversationId]
  return next
}

export function createWorkspaceReaderPreviewState(
  initialState: WorkspaceReaderPreviewState,
): WorkspaceReaderPreviewState {
  return {
    readerAudienceByConversation: initialState.readerAudienceByConversation,
    readerPreviewByConversation: initialState.readerPreviewByConversation,
    readerPreviewPendingConversationId:
      initialState.readerPreviewPendingConversationId,
    readerPreviewErrorByConversation: initialState.readerPreviewErrorByConversation,
  }
}

export function workspaceReaderPreviewReducer(
  state: WorkspaceReaderPreviewState,
  action: WorkspaceReaderPreviewAction,
): WorkspaceReaderPreviewState {
  if (action.type === 'replace-reader-preview') {
    return {
      ...action.snapshot,
      readerPreviewPendingConversationId: '',
      readerPreviewErrorByConversation: {},
    }
  }

  if (action.type === 'set-audience') {
    return {
      ...state,
      readerAudienceByConversation: {
        ...state.readerAudienceByConversation,
        [action.conversationId]: action.audience,
      },
      readerPreviewByConversation: withoutConversation(
        state.readerPreviewByConversation,
        action.conversationId,
      ),
      readerPreviewErrorByConversation: withoutConversation(
        state.readerPreviewErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'invalidate-preview') {
    return {
      ...state,
      readerPreviewByConversation: withoutConversation(
        state.readerPreviewByConversation,
        action.conversationId,
      ),
      readerPreviewErrorByConversation: withoutConversation(
        state.readerPreviewErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'clear-error') {
    return {
      ...state,
      readerPreviewErrorByConversation: withoutConversation(
        state.readerPreviewErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'set-error') {
    return {
      ...state,
      readerPreviewErrorByConversation: action.error
        ? {
            ...state.readerPreviewErrorByConversation,
            [action.conversationId]: action.error,
          }
        : withoutConversation(
            state.readerPreviewErrorByConversation,
            action.conversationId,
          ),
    }
  }

  if (action.type === 'start-request') {
    return {
      ...state,
      readerPreviewPendingConversationId: action.conversationId,
      readerPreviewErrorByConversation: withoutConversation(
        state.readerPreviewErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'finish-success') {
    return {
      ...state,
      readerPreviewByConversation: {
        ...state.readerPreviewByConversation,
        [action.conversationId]: {
          ...action.record,
          draft: {
            title: action.record.draft.title,
            body: [...action.record.draft.body],
          },
        },
      },
      readerPreviewPendingConversationId:
        state.readerPreviewPendingConversationId === action.conversationId
          ? ''
          : state.readerPreviewPendingConversationId,
      readerPreviewErrorByConversation: withoutConversation(
        state.readerPreviewErrorByConversation,
        action.conversationId,
      ),
    }
  }

  if (action.type === 'finish-error') {
    return {
      ...state,
      readerPreviewPendingConversationId:
        state.readerPreviewPendingConversationId === action.conversationId
          ? ''
          : state.readerPreviewPendingConversationId,
      readerPreviewErrorByConversation: {
        ...state.readerPreviewErrorByConversation,
        [action.conversationId]: action.error,
      },
    }
  }

  if (action.type === 'reset-conversation') {
    return {
      readerAudienceByConversation: withoutConversation(
        state.readerAudienceByConversation,
        action.conversationId,
      ),
      readerPreviewByConversation: withoutConversation(
        state.readerPreviewByConversation,
        action.conversationId,
      ),
      readerPreviewPendingConversationId:
        state.readerPreviewPendingConversationId === action.conversationId
          ? ''
          : state.readerPreviewPendingConversationId,
      readerPreviewErrorByConversation: withoutConversation(
        state.readerPreviewErrorByConversation,
        action.conversationId,
      ),
    }
  }

  return state
}
