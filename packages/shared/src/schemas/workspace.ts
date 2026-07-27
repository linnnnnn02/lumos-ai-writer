import { z } from 'zod'
import { projectLengthSchema } from './ai.js'

export const conversationStepSchema = z.enum(['learn', 'length', 'plan', 'rewrite', 'reader'])

export const workspaceChatMessageDtoSchema = z.object({
  id: z.string().uuid(),
  channel: z.string().trim().min(1).max(80),
  role: z.enum(['assistant', 'user', 'system']),
  content: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
})

export const workspaceDraftDtoSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  body: z.array(z.string()),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const workspaceConversationDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  step: conversationStepSchema,
  pinned: z.boolean(),
  selectedReferenceIds: z.array(z.string()),
  length: projectLengthSchema.nullable(),
  topic: z.string(),
  targetAudience: z.string(),
  analysisReady: z.boolean(),
  finalizedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string(),
  state: z.record(z.string(), z.unknown()),
  messages: z.array(workspaceChatMessageDtoSchema),
  draft: workspaceDraftDtoSchema.nullable(),
  drafts: z.array(workspaceDraftDtoSchema).default([]),
})

export const workspaceProjectDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  folderId: z.string().uuid().nullable(),
  activeConversationId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  conversations: z.array(workspaceConversationDtoSchema),
})

export const feedbackMemoryTypeSchema = z.enum([
  'like',
  'dislike',
  'rewrite_preference',
  'manual_edit',
  'accepted_rewrite',
  'rejected_rewrite',
  'profile_correction',
  'ai_smell_feedback',
  'final_choice',
])

export const feedbackMemoryDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  conversationId: z.string().uuid().nullable(),
  draftId: z.string().uuid().nullable(),
  type: feedbackMemoryTypeSchema,
  content: z.string(),
  context: z.record(z.string(), z.unknown()),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const getWorkspaceResponseSchema = z.object({
  ok: z.literal(true),
  projects: z.array(workspaceProjectDtoSchema),
  feedbackMemories: z.array(feedbackMemoryDtoSchema),
})

const syncWorkspaceMessageSchema = workspaceChatMessageDtoSchema.omit({ createdAt: true }).extend({
  createdAt: z.string().optional(),
})

const syncWorkspaceDraftSchema = z.object({
  title: z.string().max(2000),
  body: z.array(z.string().max(50000)).max(200),
  source: z.string().trim().min(1).max(80),
})

const syncWorkspaceDraftSnapshotSchema = syncWorkspaceDraftSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

const syncWorkspaceConversationSchema = workspaceConversationDtoSchema
  .omit({ messages: true, draft: true, drafts: true, createdAt: true })
  .extend({
    createdAt: z.string().optional(),
    title: z.string().trim().min(1).max(240),
    selectedReferenceIds: z.array(z.string().max(240)).max(120),
    topic: z.string().max(4000),
    targetAudience: z.string().max(4000),
    state: z.record(z.string(), z.unknown()),
    messages: z.array(syncWorkspaceMessageSchema).max(500),
    draft: syncWorkspaceDraftSchema.nullable(),
    drafts: z.array(syncWorkspaceDraftSnapshotSchema).optional(),
  })

export const syncWorkspaceRequestSchema = z.object({
  projects: z
    .array(
      workspaceProjectDtoSchema
        .omit({ conversations: true, createdAt: true })
        .extend({
          createdAt: z.string().optional(),
          name: z.string().trim().min(1).max(160),
          conversations: z.array(syncWorkspaceConversationSchema).max(200),
        }),
    )
    .max(100),
})

export const syncWorkspaceResponseSchema = z.object({
  ok: z.literal(true),
  syncedAt: z.string(),
})

export const createFeedbackMemoryRequestSchema = z.object({
  projectId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  draftId: z.string().uuid().optional(),
  type: feedbackMemoryTypeSchema,
  content: z.string().trim().min(1).max(30000),
  context: z.record(z.string(), z.unknown()).optional(),
  source: z.string().trim().min(1).max(80).optional(),
})

export const createFeedbackMemoryResponseSchema = z.object({
  ok: z.literal(true),
  memory: feedbackMemoryDtoSchema,
})

export type ConversationStep = z.infer<typeof conversationStepSchema>
export type WorkspaceChatMessageDto = z.infer<typeof workspaceChatMessageDtoSchema>
export type WorkspaceDraftDto = z.infer<typeof workspaceDraftDtoSchema>
export type WorkspaceConversationDto = z.infer<typeof workspaceConversationDtoSchema>
export type WorkspaceProjectDto = z.infer<typeof workspaceProjectDtoSchema>
export type FeedbackMemoryType = z.infer<typeof feedbackMemoryTypeSchema>
export type FeedbackMemoryDto = z.infer<typeof feedbackMemoryDtoSchema>
export type GetWorkspaceResponse = z.infer<typeof getWorkspaceResponseSchema>
export type SyncWorkspaceRequest = z.infer<typeof syncWorkspaceRequestSchema>
export type SyncWorkspaceResponse = z.infer<typeof syncWorkspaceResponseSchema>
export type CreateFeedbackMemoryRequest = z.infer<typeof createFeedbackMemoryRequestSchema>
export type CreateFeedbackMemoryResponse = z.infer<typeof createFeedbackMemoryResponseSchema>
