import { z } from 'zod'
import { noteDtoSchema, snippetDtoSchema } from './library.js'

export const projectLengthSchema = z.enum(['short', 'medium', 'long'])
const aiReferenceNoteSchema = noteDtoSchema.partial({
  learningStatus: true,
  qualityFlags: true,
})

export const aiFeaturedSnippetSchema = z.object({
  quote: z.string().min(1),
  noteTitle: z.string(),
  noteUrl: z.string(),
  label: z.string().min(1),
  description: z.string().min(1),
  reason: z.string(),
})

const defaultAiSurfaceStyle = {
  sentenceRhythm: '句长自然变化，以完整表达当前事实为准',
  paragraphShape: '按信息推进组织完整段落',
  punctuation: '使用自然中文标点',
  emotionalIntensity: '情绪强度服从当前需求',
  interactionStyle: '仅在当前情境支持时互动',
}

export const aiSurfaceStyleSchema = z.object({
  sentenceRhythm: z.string().min(1),
  paragraphShape: z.string().min(1),
  punctuation: z.string().min(1),
  emotionalIntensity: z.string().min(1),
  interactionStyle: z.string().min(1),
})

export const aiContentModeSchema = z.enum([
  'unclassified',
  'brand_story',
  'product_education',
  'campaign_interaction',
  'event_announcement',
  'social_moment',
  'other',
])

export const draftContentModeSchema = z.enum([
  'auto',
  'brand_story',
  'product_education',
  'campaign_interaction',
  'event_announcement',
  'social_moment',
  'other',
])

const defaultAiContentMode = {
  targetMode: 'unclassified' as const,
  confidence: 'low' as const,
  rationale: '旧分析数据尚未分类内容模式',
  referenceModes: [] as Array<{
    noteId: string
    mode: z.infer<typeof aiContentModeSchema>
    compatibility: 'compatible' | 'stable_voice_only' | 'excluded'
    reason: string
  }>,
  compatibleReferenceIds: [] as string[],
  excludedReferences: [] as Array<{ noteId: string; reason: string }>,
  stableVoiceSignals: [] as string[],
  modeSpecificGuidance: {
    informationPriority: '以当前 topic 和 brief 的事实顺序为准',
    interactionPattern: '仅在当前任务需要时互动',
    styleBoundary: '不迁移参考文案的具体内容任务',
  },
}

export const aiContentModeResultSchema = z.object({
  targetMode: aiContentModeSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  rationale: z.string().trim().min(1).max(300),
  referenceModes: z
    .array(
      z.object({
        noteId: z.string().trim().min(1).max(120),
        mode: aiContentModeSchema,
        compatibility: z.enum([
          'compatible',
          'stable_voice_only',
          'excluded',
        ]),
        reason: z.string().trim().min(1).max(240),
      }),
    )
    .max(12),
  compatibleReferenceIds: z.array(z.string().trim().min(1).max(120)).max(12),
  excludedReferences: z
    .array(
      z.object({
        noteId: z.string().trim().min(1).max(120),
        reason: z.string().trim().min(1).max(240),
      }),
    )
    .max(12),
  stableVoiceSignals: z.array(z.string().trim().min(1).max(160)).max(5),
  modeSpecificGuidance: z.object({
    informationPriority: z.string().trim().min(1).max(240),
    interactionPattern: z.string().trim().min(1).max(240),
    styleBoundary: z.string().trim().min(1).max(240),
  }),
})

export const aiAnalysisResultSchema = z.object({
  projectName: z.string(),
  aiLearningMethod: z.object({
    writingPath: z.string().min(1),
    reusableMechanisms: z.array(z.string().min(1)).min(1).max(5),
    styleConstraints: z.array(z.string().min(1)).min(1).max(5),
  }),
  contentMode: aiContentModeResultSchema.default(defaultAiContentMode),
  surfaceStyle: aiSurfaceStyleSchema.default(defaultAiSurfaceStyle),
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
  body: z.array(z.string().trim().min(1).max(1200)).min(1).max(12),
})

export const analyzeReferencesRequestSchema = z.object({
  projectName: z.string().trim().min(1).max(160),
  folderName: z.string().trim().max(160),
  topic: z.string().trim().min(1).max(800),
  targetAudience: z.string().trim().min(1).max(800),
  length: projectLengthSchema,
  notes: z.array(aiReferenceNoteSchema).min(1).max(12),
  snippets: z.array(snippetDtoSchema).max(40),
})

export const generateDraftRequestSchema = z.object({
  projectId: z.string().uuid().optional(),
  projectName: z.string().trim().min(1).max(160),
  topic: z.string().trim().min(1).max(800),
  targetAudience: z.string().trim().min(1).max(800),
  length: projectLengthSchema,
  analysis: aiAnalysisResultSchema,
  notes: z.array(aiReferenceNoteSchema).max(12),
  snippets: z.array(snippetDtoSchema).max(40),
  brief: z.object({
    mustInclude: z.string().trim().max(800),
    avoidTone: z.string().trim().max(800),
    objective: z.string().trim().max(500).default(''),
    sourceFacts: z.string().trim().max(1600).default(''),
    instructions: z.string().trim().max(800).default(''),
    contentMode: draftContentModeSchema.default('auto'),
    facts: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(80),
          statement: z.string().trim().min(1).max(500),
          required: z.boolean().default(true),
        }),
      )
      .max(20)
      .default([]),
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

export const previewDraftForReaderRequestSchema = z.object({
  projectId: z.string().uuid(),
  projectName: z.string().trim().min(1).max(160),
  topic: z.string().trim().min(1).max(800),
  targetAudience: z.string().trim().min(1).max(800),
  readerAudience: z.string().trim().max(800),
  draft: aiDraftCopySchema,
  analysis: aiAnalysisResultSchema.optional(),
})

export const readerPreviewToneSchema = z.enum(['interest', 'risk', 'question'])

export const aiReaderPreviewAnnotationSchema = z.object({
  id: z.string().trim().min(1).max(80),
  fieldId: z.string().regex(/^(title|body-\d+)$/),
  quote: z.string().trim().min(2).max(240),
  tone: readerPreviewToneSchema,
  label: z.string().trim().min(1).max(24),
  title: z.string().trim().min(1).max(80),
  reaction: z.string().trim().min(1).max(600),
  reason: z.string().trim().min(1).max(600),
  confidence: z.number().min(0).max(1),
})

export const aiReaderPreviewSuggestionSchema = z.object({
  priority: z.enum(['high', 'medium', 'low']),
  instruction: z.string().trim().min(1).max(600),
  rationale: z.string().trim().min(1).max(600),
  annotationIds: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
})

export const aiReaderPreviewResultSchema = z
  .object({
    audienceSummary: z.string().trim().min(1).max(800),
    annotations: z.array(aiReaderPreviewAnnotationSchema).min(2).max(6),
    suggestions: z.array(aiReaderPreviewSuggestionSchema).max(4),
  })
  .superRefine((value, context) => {
    const annotationIds = new Set<string>()
    value.annotations.forEach((annotation, index) => {
      if (annotationIds.has(annotation.id)) {
        context.addIssue({
          code: 'custom',
          path: ['annotations', index, 'id'],
          message: 'Reader preview annotation IDs must be unique.',
        })
      }
      annotationIds.add(annotation.id)
    })

    value.suggestions.forEach((suggestion, suggestionIndex) => {
      suggestion.annotationIds.forEach((annotationId, annotationIndex) => {
        if (!annotationIds.has(annotationId)) {
          context.addIssue({
            code: 'custom',
            path: ['suggestions', suggestionIndex, 'annotationIds', annotationIndex],
            message: 'Suggestion annotationIds must reference an existing annotation.',
          })
        }
      })
    })
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

export const appliedWritingPreferenceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  scope: z.enum(['account', 'project']),
  dimension: z.string().trim().min(1).max(80),
  statement: z.string().trim().min(1).max(800),
})

export const appliedWritingProfileRevisionSchema = z.object({
  revisionId: z.string().uuid(),
  version: z.number().int().positive(),
  scope: z.enum(['account', 'project']),
  preferences: z.array(appliedWritingPreferenceSchema).max(60),
})

export const appliedWritingProfileContextSchema = z.object({
  account: appliedWritingProfileRevisionSchema.nullable(),
  project: appliedWritingProfileRevisionSchema.nullable(),
})

export const draftQualityCheckIdSchema = z.enum([
  'length',
  'required_facts',
  'expression_boundaries',
  'factual_grounding',
])

export const draftQualityCheckStatusSchema = z.enum([
  'passed',
  'needs_review',
  'failed',
  'not_applicable',
])

export const draftQualityCheckSchema = z.object({
  id: draftQualityCheckIdSchema,
  label: z.string().trim().min(1).max(40),
  status: draftQualityCheckStatusSchema,
  summary: z.string().trim().min(1).max(300),
  details: z.array(z.string().trim().min(1).max(500)).max(20),
  actual: z
    .object({
      bodyCharacters: z.number().int().nonnegative(),
      paragraphs: z.number().int().nonnegative(),
    })
    .optional(),
  expected: z
    .object({
      minBodyCharacters: z.number().int().nonnegative(),
      maxBodyCharacters: z.number().int().positive(),
      minParagraphs: z.number().int().nonnegative(),
      maxParagraphs: z.number().int().positive(),
    })
    .optional(),
})

export const draftQualitySnapshotSchema = z
  .object({
    overallStatus: z.enum(['passed', 'needs_review', 'failed']),
    checkedAt: z.string().datetime(),
    checks: z.array(draftQualityCheckSchema).length(4),
  })
  .superRefine((value, context) => {
    const checkIds = new Set(value.checks.map((check) => check.id))
    if (checkIds.size !== 4) {
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'Draft quality snapshots must include each check exactly once.',
      })
    }
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
  status: z.literal('generated'),
  provider: z.literal('deepseek'),
  model: z.string(),
  skill: aiSkillMetadataSchema,
  draft: aiDraftCopySchema,
  appliedWritingProfile: appliedWritingProfileContextSchema,
  quality: draftQualitySnapshotSchema,
  usage: aiUsageSchema.nullable(),
})

export const rewriteDraftResponseSchema = z.object({
  ok: z.literal(true),
  provider: z.literal('deepseek'),
  model: z.string(),
  skill: aiSkillMetadataSchema,
  rewrite: aiRewriteResultSchema,
  appliedWritingProfile: appliedWritingProfileContextSchema,
  usage: aiUsageSchema.nullable(),
})

export const previewDraftForReaderResponseSchema = z.object({
  ok: z.literal(true),
  provider: z.literal('deepseek'),
  model: z.string(),
  skill: aiSkillMetadataSchema,
  preview: aiReaderPreviewResultSchema,
  usage: aiUsageSchema.nullable(),
})

export type AiFeaturedSnippet = z.infer<typeof aiFeaturedSnippetSchema>
export type AiContentMode = z.infer<typeof aiContentModeSchema>
export type AiAnalysisResult = z.infer<typeof aiAnalysisResultSchema>
export type AiDraftCopy = z.infer<typeof aiDraftCopySchema>
export type AiRewriteSuggestion = z.infer<typeof aiRewriteSuggestionSchema>
export type AiRewriteResult = z.infer<typeof aiRewriteResultSchema>
export type AiReaderPreviewAnnotation = z.infer<typeof aiReaderPreviewAnnotationSchema>
export type AiReaderPreviewSuggestion = z.infer<typeof aiReaderPreviewSuggestionSchema>
export type AiReaderPreviewResult = z.infer<typeof aiReaderPreviewResultSchema>
export type AnalyzeReferencesRequest = z.infer<typeof analyzeReferencesRequestSchema>
export type GenerateDraftRequest = z.infer<typeof generateDraftRequestSchema>
export type RewriteDraftRequest = z.infer<typeof rewriteDraftRequestSchema>
export type PreviewDraftForReaderRequest = z.infer<typeof previewDraftForReaderRequestSchema>
export type AiUsage = z.infer<typeof aiUsageSchema>
export type AiSkillMetadata = z.infer<typeof aiSkillMetadataSchema>
export type AppliedWritingPreference = z.infer<typeof appliedWritingPreferenceSchema>
export type AppliedWritingProfileRevision = z.infer<
  typeof appliedWritingProfileRevisionSchema
>
export type AppliedWritingProfileContext = z.infer<
  typeof appliedWritingProfileContextSchema
>
export type DraftQualityCheckId = z.infer<typeof draftQualityCheckIdSchema>
export type DraftQualityCheckStatus = z.infer<typeof draftQualityCheckStatusSchema>
export type DraftQualityCheck = z.infer<typeof draftQualityCheckSchema>
export type DraftQualitySnapshot = z.infer<typeof draftQualitySnapshotSchema>
export type AnalyzeReferencesResponse = z.infer<typeof analyzeReferencesResponseSchema>
export type GenerateDraftResponse = z.infer<typeof generateDraftResponseSchema>
export type RewriteDraftResponse = z.infer<typeof rewriteDraftResponseSchema>
export type PreviewDraftForReaderResponse = z.infer<typeof previewDraftForReaderResponseSchema>
