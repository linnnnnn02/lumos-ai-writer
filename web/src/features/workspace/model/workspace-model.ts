import type { ProjectLength } from '@lumos-ai/shared'
import type { DraftCopy } from '@/lib/draft-versions'
import type {
  ConversationStage,
  ConversationStep,
} from '@/features/workspace/workflow/workspace-navigation'

export type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  stage: 'setup' | 'analysis' | 'followup'
  title?: string
  lines: string[]
  highlights?: Array<{
    title: string
    body: string
  }>
  featuredSnippets?: Array<{
    quote: string
    noteTitle: string
    noteUrl: string
    label: string
    description: string
    reason: string
  }>
  preferenceQuestion?: string
}

export type WritingBrief = {
  objective: string
  requiredFacts: string
  boundaries: string
  instructions: string
}

export type ConversationRecord = {
  id: string
  title: string
  pinned?: boolean
  finalizedAt?: string
  finalDraft?: DraftCopy
  step: ConversationStep
  workflowStage: ConversationStage
  writingRequest: string
  createdAt: string
  lastOpenedAt: string
  selectedItemIds: string[]
  chatMessages: ChatMessage[]
  analysisReady: boolean
  length: ProjectLength | null
  topic: string
  targetAudience: string
  writingBrief: WritingBrief
  updatedAt: string
}

export type ProjectRecord = {
  id: string
  name: string
  folderId: string
  conversations: ConversationRecord[]
  activeConversationId: string
  updatedAt: string
}
