import { z } from 'zod'
import { noteDtoSchema, snippetDtoSchema } from './library.js'

export const projectLengthSchema = z.enum(['short', 'medium', 'long'])

export const aiFeaturedSnippetSchema = z.object({
  quote: z.string().min(1),
  noteTitle: z.string(),
  noteUrl: z.string(),
  label: z.string().min(1),
  description: z.string().min(1),
  reason: z.string(),
})

export const aiAnalysisResultSchema = z.object({
  projectName: z.string(),
  aiLearningMethod: z.object({
    writingPath: z.string().min(1),
    reusableMechanisms: z.array(z.string().min(1)).min(1).max(5),
    styleConstraints: z.array(z.string().min(1)).min(1).max(5),
  }),
  coreJudgement: z.string().min(1),
  evidence: z.string().min(1),
  effectivePatterns: z.array(z.string().min(1)).min(3).max(5),
  featuredSnippets: z.array(aiFeaturedSnippetSchema).max(3),
  userPreference: z.string().min(1),
  reuseSuggestion: z.string().min(1),
  avoidPitfall: z.string().min(1),
  preferenceQuestion: z.string().min(1),
  writingMove: z.string().min(1),
  summary: z.string().min(1),
  wording: z.array(z.string().min(1)).min(1).max(4),
  structure: z.array(z.string().min(1)).min(1).max(4),
  preference: z.array(z.string().min(1)).min(1).max(4),
  readerView: z.array(z.string().min(1)).min(1).max(4),
  nextStep: z.array(z.string().min(1)).min(1).max(3),
})

export const aiDraftCopySchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.array(z.string().trim().min(1).max(1200)).min(3).max(12),
})

export const analyzeReferencesRequestSchema = z.object({
  projectName: z.string().trim().min(1).max(160),
  folderName: z.string().trim().max(160),
  topic: z.string().trim().min(1).max(800),
  targetAudience: z.string().trim().min(1).max(800),
  length: projectLengthSchema,
  notes: z.array(noteDtoSchema).min(1).max(12),
  snippets: z.array(snippetDtoSchema).max(40),
})

export const generateDraftRequestSchema = z.object({
  projectId: z.string().uuid().optional(),
  projectName: z.string().trim().min(1).max(160),
  topic: z.string().trim().min(1).max(800),
  targetAudience: z.string().trim().min(1).max(800),
  length: projectLengthSchema,
  analysis: aiAnalysisResultSchema,
  notes: z.array(noteDtoSchema).min(1).max(12),
  snippets: z.array(snippetDtoSchema).max(40),
  brief: z.object({
    mustInclude: z.string().trim().max(800),
    avoidTone: z.string().trim().max(800),
  }),
})

export const rewriteDraftRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    projectName: z.string().trim().min(1).max(160),
    topic: z.string().trim().min(1).max(800),
    targetAudience: z.string().trim().min(1).max(800),
    draft: aiDraftCopySchema,
    fieldId: z.string().regex(/^(title|body-\d+)$/),
    selectedText: z.string().trim().min(1).max(1200),
    contextBefore: z.string().max(1200),
    contextAfter: z.string().max(1200),
    instruction: z.string().trim().min(1).max(2000),
    analysis: aiAnalysisResultSchema.optional(),
  })
  .superRefine((value, context) => {
    const bodyMatch = value.fieldId.match(/^body-(\d+)$/)
    const fieldValue =
      value.fieldId === 'title'
        ? value.draft.title
        : bodyMatch
          ? value.draft.body[Number(bodyMatch[1])]
          : undefined

    if (fieldValue === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['fieldId'],
        message: 'fieldId does not exist in the draft.',
      })
      return
    }

    if (!fieldValue.includes(value.selectedText)) {
      context.addIssue({
        code: 'custom',
        path: ['selectedText'],
        message: 'selectedText must exist in the selected draft field.',
      })
    }
  })

export const aiRewriteSuggestionSchema = z.object({
  label: z.string().trim().min(1).max(24),
  text: z.string().trim().min(1).max(1200),
  rationale: z.string().trim().min(1).max(500),
})

export const aiRewriteResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    suggestions: z.array(aiRewriteSuggestionSchema).min(2).max(3),
    recommendedIndex: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (value.recommendedIndex >= value.suggestions.length) {
      context.addIssue({
        code: 'custom',
        path: ['recommendedIndex'],
        message: 'recommendedIndex must point to an existing suggestion.',
      })
    }
  })

export const aiUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
})

export const aiSkillMetadataSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
})

export const analyzeReferencesResponseSchema = z.object({
  ok: z.literal(true),
  provider: z.literal('deepseek'),
  model: z.string(),
  skill: aiSkillMetadataSchema,
  analysis: aiAnalysisResultSchema,
  usage: aiUsageSchema.nullable(),
})

export const generateDraftResponseSchema = z.object({
  ok: z.literal(true),
  provider: z.literal('deepseek'),
  model: z.string(),
  skill: aiSkillMetadataSchema,
  draft: aiDraftCopySchema,
  usage: aiUsageSchema.nullable(),
})

export const rewriteDraftResponseSchema = z.object({
  ok: z.literal(true),
  provider: z.literal('deepseek'),
  model: z.string(),
  skill: aiSkillMetadataSchema,
  rewrite: aiRewriteResultSchema,
  usage: aiUsageSchema.nullable(),
})

export type AiFeaturedSnippet = z.infer<typeof aiFeaturedSnippetSchema>
export type AiAnalysisResult = z.infer<typeof aiAnalysisResultSchema>
export type AiDraftCopy = z.infer<typeof aiDraftCopySchema>
export type AiRewriteSuggestion = z.infer<typeof aiRewriteSuggestionSchema>
export type AiRewriteResult = z.infer<typeof aiRewriteResultSchema>
export type AnalyzeReferencesRequest = z.infer<typeof analyzeReferencesRequestSchema>
export type GenerateDraftRequest = z.infer<typeof generateDraftRequestSchema>
export type RewriteDraftRequest = z.infer<typeof rewriteDraftRequestSchema>
export type AiUsage = z.infer<typeof aiUsageSchema>
export type AiSkillMetadata = z.infer<typeof aiSkillMetadataSchema>
export type AnalyzeReferencesResponse = z.infer<typeof analyzeReferencesResponseSchema>
export type GenerateDraftResponse = z.infer<typeof generateDraftResponseSchema>
export type RewriteDraftResponse = z.infer<typeof rewriteDraftResponseSchema>
