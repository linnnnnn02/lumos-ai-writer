import { z } from 'zod'
import { aiContentModeSchema, aiSkillMetadataSchema, aiUsageSchema } from './ai.js'
import { feedbackMemoryTypeSchema } from './workspace.js'

export const writingProfileScopeSchema = z.enum(['account', 'project'])

export const writingFeedbackCategorySchema = z.enum([
  'fact_correction',
  'draft_requirement',
  'pattern_preference',
  'long_term_habit',
])

export const writingEvidenceScopeSchema = z.enum(['draft', 'project', 'account'])

export const writingPreferenceStatusSchema = z.enum([
  'candidate',
  'active',
  'disabled',
  'rejected',
])

export const writingEditEvidenceSchema = z.object({
  category: writingFeedbackCategorySchema,
  scope: writingEvidenceScopeSchema,
  contentMode: aiContentModeSchema,
  beforeText: z.string().max(30000),
  afterText: z.string().max(30000),
  confidence: z.number().min(0).max(1),
  evidenceCount: z.number().int().positive(),
  status: writingPreferenceStatusSchema,
})

export const writingPreferenceDimensionSchema = z.enum([
  'content_selection',
  'viewpoint',
  'structure',
  'opening',
  'progression',
  'ending',
  'tone',
  'vocabulary',
  'sentence_rhythm',
  'reader_relationship',
  'emotional_expression',
  'persuasion',
  'forbidden_pattern',
])

export const writingEvidenceTypeSchema = z.enum([
  'snippet_reason',
  'snippet_label',
  'library_pattern',
  'rewrite_instruction',
  'manual_edit',
  'accepted_rewrite',
  'rejected_rewrite',
  'final_choice',
  'explicit_correction',
])

export const writingPreferenceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  dimension: writingPreferenceDimensionSchema,
  statement: z.string().trim().min(1).max(800),
  application: z.string().trim().min(1).max(1200),
  avoid: z.string().trim().max(1200),
  scope: writingProfileScopeSchema,
  confidence: z.number().min(0).max(1),
  supportCount: z.number().int().nonnegative(),
  evidenceIds: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
  contradictions: z.array(z.string().trim().min(1).max(800)).max(10),
  sourceCategory: writingFeedbackCategorySchema.default('pattern_preference'),
  status: writingPreferenceStatusSchema.default('active'),
  contentModes: z.array(aiContentModeSchema).max(aiContentModeSchema.options.length).default([]),
})

export const writingProfileSchema = z.object({
  summary: z.string().trim().min(1).max(1600),
  decisionPrinciples: z.array(z.string().trim().min(1).max(800)).max(12),
  contentPatterns: z.array(z.string().trim().min(1).max(800)).max(12),
  structurePatterns: z.array(z.string().trim().min(1).max(800)).max(12),
  voicePatterns: z.array(z.string().trim().min(1).max(800)).max(12),
  readerRelationship: z.array(z.string().trim().min(1).max(800)).max(8),
  mustKeep: z.array(z.string().trim().min(1).max(800)).max(12),
  mustAvoid: z.array(z.string().trim().min(1).max(800)).max(12),
  preferences: z.array(writingPreferenceSchema).max(60),
  openQuestions: z.array(z.string().trim().min(1).max(800)).max(12),
  evidenceCount: z.number().int().nonnegative(),
})

export const writingProfileLibraryEvidenceSchema = z.object({
  notes: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(160),
        title: z.string().trim().max(300),
        contentText: z.string().max(12000),
      }),
    )
    .max(60),
  snippets: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(160),
        noteId: z.string().trim().max(160).optional(),
        selectedText: z.string().trim().min(1).max(4000),
        reasonText: z.string().trim().max(2000),
        colorTagName: z.string().trim().max(120),
      }),
    )
    .max(240),
})

export const writingProfileFeedbackEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(160),
  projectId: z.string().uuid().nullable(),
  type: feedbackMemoryTypeSchema,
  content: z.string().trim().min(1).max(30000),
  context: z.record(z.string(), z.unknown()),
  source: z.string().trim().min(1).max(80),
  createdAt: z.string(),
})

export const buildWritingProfileRequestSchema = z
  .object({
    scope: writingProfileScopeSchema,
    projectId: z.string().uuid().optional(),
    previousProfile: writingProfileSchema.nullable().optional(),
    previousRevisionEvidenceIds: z.array(z.string().trim().min(1).max(160)).max(800).optional(),
    libraryEvidence: writingProfileLibraryEvidenceSchema,
    feedbackEvidence: z.array(writingProfileFeedbackEvidenceSchema).max(400),
    projectContext: z
      .object({
        projectName: z.string().trim().max(160),
        topic: z.string().trim().max(4000),
        targetAudience: z.string().trim().max(4000),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.scope === 'project' && !value.projectId) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'projectId is required for a project writing profile.',
      })
    }
    if (value.scope === 'account' && value.projectId) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'projectId must be omitted for an account writing profile.',
      })
    }
  })

export const writingProfileRevisionDtoSchema = z.object({
  id: z.string().uuid(),
  scope: writingProfileScopeSchema,
  projectId: z.string().uuid().nullable(),
  version: z.number().int().positive(),
  profile: writingProfileSchema,
  evidenceIds: z.array(z.string()),
  skill: aiSkillMetadataSchema,
  createdAt: z.string(),
})

export const getWritingProfileResponseSchema = z.object({
  ok: z.literal(true),
  accountProfile: writingProfileRevisionDtoSchema.nullable(),
  projectProfile: writingProfileRevisionDtoSchema.nullable(),
})

export const manageWritingPreferenceActionSchema = z.enum([
  'enable',
  'disable',
  'delete',
  'correct',
])

export const manageWritingPreferenceRequestSchema = z
  .object({
    scope: writingProfileScopeSchema,
    projectId: z.string().uuid().optional(),
    preferenceId: z.string().trim().min(1).max(120),
    action: manageWritingPreferenceActionSchema,
    feedbackMemoryId: z.string().uuid(),
    expectedRevisionId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  })
  .superRefine((value, context) => {
    if (value.scope === 'project' && !value.projectId) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'projectId is required for a project writing preference.',
      })
    }
    if (value.scope === 'account' && value.projectId) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'projectId must be omitted for an account writing preference.',
      })
    }
  })

export const manageWritingPreferenceResponseSchema = z.object({
  ok: z.literal(true),
  revision: writingProfileRevisionDtoSchema,
})

export const buildWritingProfileResponseSchema = z.object({
  ok: z.literal(true),
  provider: z.literal('deepseek'),
  model: z.string(),
  skill: aiSkillMetadataSchema,
  profile: writingProfileSchema,
  revision: writingProfileRevisionDtoSchema,
  reused: z.boolean(),
  usage: aiUsageSchema.nullable(),
})

export type WritingProfileScope = z.infer<typeof writingProfileScopeSchema>
export type WritingFeedbackCategory = z.infer<typeof writingFeedbackCategorySchema>
export type WritingEvidenceScope = z.infer<typeof writingEvidenceScopeSchema>
export type WritingPreferenceStatus = z.infer<typeof writingPreferenceStatusSchema>
export type WritingEditEvidence = z.infer<typeof writingEditEvidenceSchema>
export type WritingPreference = z.infer<typeof writingPreferenceSchema>
export type WritingProfile = z.infer<typeof writingProfileSchema>
export type BuildWritingProfileRequest = z.infer<typeof buildWritingProfileRequestSchema>
export type WritingProfileRevisionDto = z.infer<typeof writingProfileRevisionDtoSchema>
export type GetWritingProfileResponse = z.infer<typeof getWritingProfileResponseSchema>
export type ManageWritingPreferenceAction = z.infer<
  typeof manageWritingPreferenceActionSchema
>
export type ManageWritingPreferenceRequest = z.infer<
  typeof manageWritingPreferenceRequestSchema
>
export type ManageWritingPreferenceResponse = z.infer<
  typeof manageWritingPreferenceResponseSchema
>
export type BuildWritingProfileResponse = z.infer<typeof buildWritingProfileResponseSchema>
