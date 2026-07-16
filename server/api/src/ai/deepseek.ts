import type { AppConfig } from '../env.js'
import {
  type AiAnalysisResult,
  type AiDraftCopy,
  type AiRewriteResult,
  type AiReaderPreviewResult,
  type AiSkillMetadata,
  type AiUsage,
  type AnalyzeReferencesRequest,
  type BuildWritingProfileRequest,
  type GenerateDraftRequest,
  type RewriteDraftRequest,
  type PreviewDraftForReaderRequest,
  type WritingProfile,
} from '@lumos-ai/shared'
import { analysisSkillV1 } from '../skills/analysis-v1/index.js'
import {
  buildDraftRepairUserPrompt,
  draftRepairSystemPrompt,
  draftSkillV1,
  validateDraftSkillOutput,
} from '../skills/draft-v1/index.js'
import { prepareAiSkill } from '../skills/runtime.js'
import {
  buildRewriteRepairUserPrompt,
  filterGroundedRewriteSuggestions,
  rewriteRepairSystemPrompt,
  rewriteSkillV1,
  validateRewriteSkillOutput,
} from '../skills/rewrite-v1/index.js'
import {
  buildReaderPreviewRepairUserPrompt,
  filterGroundedReaderSuggestions,
  readerPreviewRepairSystemPrompt,
  readerPreviewSkillV1,
  validateReaderPreviewSkillOutput,
} from '../skills/reader-preview-v1/index.js'
import { writerModelSkillV1 } from '../skills/writer-model-v1/index.js'
import type { WritingProfileContext } from '../writing-profile.js'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const DEEPSEEK_REQUEST_TIMEOUT_MS = 60_000
export const DEEPSEEK_ANALYZE_MODEL = analysisSkillV1.model
export const DEEPSEEK_WRITER_MODEL = writerModelSkillV1.model
export const DEEPSEEK_DRAFT_MODEL = draftSkillV1.model
export const DEEPSEEK_REWRITE_MODEL = rewriteSkillV1.model
export const DEEPSEEK_READER_PREVIEW_MODEL = readerPreviewSkillV1.model

type DeepSeekChatCompletionRequest = {
  model: string
  messages: Array<{
    role: 'system' | 'user'
    content: string
  }>
  response_format: {
    type: 'json_object'
  }
  thinking: {
    type: 'disabled'
  }
  max_tokens: number
  temperature: number
  stream: false
}

type DeepSeekChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  error?: {
    message?: string
  }
}

export class DeepSeekNotConfiguredError extends Error {
  constructor() {
    super('DeepSeek API key is not configured. Add DEEPSEEK_API_KEY to the API environment.')
    this.name = 'DeepSeekNotConfiguredError'
  }
}

export class AiFeatureDisabledError extends Error {
  constructor() {
    super('AI features are disabled until the active Skill passes evaluation.')
    this.name = 'AiFeatureDisabledError'
  }
}

export class DeepSeekUpstreamError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'DeepSeekUpstreamError'
    this.status = status
  }
}

export class DeepSeekOutputValidationError extends Error {
  usage: AiUsage | null
  promptHash: string

  constructor(error: unknown, usage: AiUsage | null, promptHash: string) {
    super(getErrorMessage(error))
    this.name = 'DeepSeekOutputValidationError'
    this.usage = usage
    this.promptHash = promptHash
  }
}

export function isDeepSeekConfigured(config: AppConfig) {
  return Boolean(config.DEEPSEEK_API_KEY)
}

export function getDeepSeekConfigStatus(config: AppConfig) {
  return {
    provider: 'deepseek',
    enabled: config.AI_FEATURE_ENABLED,
    configured: isDeepSeekConfigured(config),
    dailyBudgetCny: config.AI_DAILY_BUDGET_CNY ?? null,
    model: DEEPSEEK_ANALYZE_MODEL,
  }
}

function parseJsonWithSingleMissingArrayComma(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch (error) {
    const positionMatch =
      error instanceof SyntaxError
        ? error.message.match(
            /Expected ',' or '\]' after array element in JSON at position (\d+)/,
          )
        : null
    const position = Number(positionMatch?.[1])
    if (!Number.isInteger(position) || position <= 0 || position >= content.length) {
      throw error
    }

    const before = content.slice(0, position)
    const after = content.slice(position)
    // The parser has already confirmed that one array value ended here. A
    // successful full parse after this single insertion proves no other
    // syntax repair was needed, regardless of the JSON value types involved.
    return JSON.parse(`${before},${after}`)
  }
}

export function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new DeepSeekUpstreamError('DeepSeek returned non-JSON content.', 502)
    return parseJsonWithSingleMissingArrayComma(match[0])
  }
}

function unwrapDeepSeekObject(
  value: unknown,
  requiredKeys: string[],
) {
  const queue: Array<{ candidate: unknown; depth: number }> = [
    { candidate: value, depth: 0 },
  ]
  let visited = 0

  while (queue.length > 0 && visited < 24) {
    const current = queue.shift()
    if (!current) break
    visited += 1

    if (
      current.candidate &&
      typeof current.candidate === 'object' &&
      !Array.isArray(current.candidate)
    ) {
      const record = current.candidate as Record<string, unknown>
      if (requiredKeys.every((key) => key in record)) return current.candidate
    }

    if (current.depth >= 3 || !current.candidate || typeof current.candidate !== 'object') {
      continue
    }

    for (const nested of Object.values(current.candidate)) {
      if (nested && typeof nested === 'object') {
        queue.push({ candidate: nested, depth: current.depth + 1 })
      }
    }
  }

  return value
}

function getRewriteGroundingSource(input: RewriteDraftRequest) {
  return JSON.stringify({
    selection: {
      selectedText: input.selectedText,
      contextBefore: input.contextBefore,
      contextAfter: input.contextAfter,
    },
    fullDraft: input.draft,
    analysis: input.analysis ?? null,
  })
}

function getReaderPreviewGroundingSource(input: PreviewDraftForReaderRequest) {
  return JSON.stringify({
    draft: input.draft,
    analysis: input.analysis ?? null,
  })
}

function toUsage(usage: DeepSeekChatCompletionResponse['usage']): AiUsage | null {
  if (!usage) return null
  return {
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  }
}

export function mergeAiUsage(...usages: Array<AiUsage | null>): AiUsage | null {
  const populated = usages.filter((usage): usage is AiUsage => usage !== null)
  if (populated.length === 0) return null

  const sum = (field: keyof AiUsage) => {
    const values = populated
      .map((usage) => usage[field])
      .filter((value): value is number => value !== null)
    return values.length > 0
      ? values.reduce((total, value) => total + value, 0)
      : null
  }

  return {
    promptTokens: sum('promptTokens'),
    completionTokens: sum('completionTokens'),
    totalTokens: sum('totalTokens'),
  }
}

function parseValidatedDeepSeekOutput<T>(
  content: string,
  data: DeepSeekChatCompletionResponse,
  skill: AiSkillMetadata,
  validate: (value: unknown) => T,
) {
  const usage = toUsage(data.usage)

  try {
    return {
      value: validate(parseJsonContent(content)),
      usage,
    }
  } catch (error) {
    throw new DeepSeekOutputValidationError(error, usage, skill.promptHash)
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Unknown error'
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

async function requestDeepSeekChatCompletion(
  config: AppConfig,
  body: DeepSeekChatCompletionRequest,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_REQUEST_TIMEOUT_MS)
  let response: Response

  try {
    response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw new DeepSeekUpstreamError('DeepSeek request timed out. Please retry.', 504)
    }

    throw new DeepSeekUpstreamError(`DeepSeek request failed: ${getErrorMessage(error)}`, 502)
  } finally {
    clearTimeout(timeout)
  }

  let data: DeepSeekChatCompletionResponse
  try {
    data = (await response.json()) as DeepSeekChatCompletionResponse
  } catch {
    throw new DeepSeekUpstreamError(
      response.ok
        ? 'DeepSeek returned a non-JSON response.'
        : `DeepSeek request failed with status ${response.status}.`,
      response.ok ? 502 : response.status,
    )
  }

  if (!response.ok) {
    throw new DeepSeekUpstreamError(
      data.error?.message || `DeepSeek request failed with status ${response.status}.`,
      response.status,
    )
  }

  return data
}

export async function analyzeReferencesWithDeepSeek(
  config: AppConfig,
  input: AnalyzeReferencesRequest,
): Promise<{
  analysis: AiAnalysisResult
  skill: AiSkillMetadata
  model: string
  usage: AiUsage | null
}> {
  if (!config.AI_FEATURE_ENABLED) {
    throw new AiFeatureDisabledError()
  }

  if (!config.DEEPSEEK_API_KEY) {
    throw new DeepSeekNotConfiguredError()
  }

  const preparedSkill = await prepareAiSkill(analysisSkillV1, input)

  const data = await requestDeepSeekChatCompletion(config, {
    model: preparedSkill.model,
    messages: [
      {
        role: 'system',
        content: preparedSkill.systemPrompt,
      },
      {
        role: 'user',
        content: preparedSkill.userPrompt,
      },
    ],
    response_format: {
      type: 'json_object',
    },
    thinking: {
      type: 'disabled',
    },
    max_tokens: preparedSkill.maxTokens,
    temperature: preparedSkill.temperature,
    stream: false,
  })

  if (data.error?.message) {
    throw new DeepSeekUpstreamError(
      data.error.message,
      502,
    )
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new DeepSeekUpstreamError('DeepSeek returned an empty analysis.', 502)
  }

  const parsed = parseValidatedDeepSeekOutput(
    content,
    data,
    preparedSkill.metadata,
    (value) => preparedSkill.outputSchema.parse(value),
  )

  return {
    analysis: parsed.value,
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: parsed.usage,
  }
}

export async function generateDraftWithDeepSeek(
  config: AppConfig,
  input: GenerateDraftRequest,
  writingProfileContext?: WritingProfileContext,
): Promise<{
  draft: AiDraftCopy
  skill: AiSkillMetadata
  model: string
  usage: AiUsage | null
}> {
  if (!config.AI_FEATURE_ENABLED) {
    throw new AiFeatureDisabledError()
  }

  if (!config.DEEPSEEK_API_KEY) {
    throw new DeepSeekNotConfiguredError()
  }

  const preparedSkill = await prepareAiSkill(draftSkillV1, {
    ...input,
    writingProfileContext,
  })

  const data = await requestDeepSeekChatCompletion(config, {
    model: preparedSkill.model,
    messages: [
      {
        role: 'system',
        content: preparedSkill.systemPrompt,
      },
      {
        role: 'user',
        content: preparedSkill.userPrompt,
      },
    ],
    response_format: {
      type: 'json_object',
    },
    thinking: {
      type: 'disabled',
    },
    max_tokens: preparedSkill.maxTokens,
    temperature: preparedSkill.temperature,
    stream: false,
  })

  if (data.error?.message) {
    throw new DeepSeekUpstreamError(
      data.error.message,
      502,
    )
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new DeepSeekUpstreamError('DeepSeek returned an empty draft.', 502)
  }

  const initialUsage = toUsage(data.usage)
  let candidateDraft: AiDraftCopy

  try {
    candidateDraft = preparedSkill.outputSchema.parse(parseJsonContent(content))
  } catch (error) {
    throw new DeepSeekOutputValidationError(
      error,
      initialUsage,
      preparedSkill.metadata.promptHash,
    )
  }

  try {
    candidateDraft = validateDraftSkillOutput(candidateDraft, input.length)
  } catch {
    let repairData: DeepSeekChatCompletionResponse
    try {
      repairData = await requestDeepSeekChatCompletion(config, {
        model: preparedSkill.model,
        messages: [
          {
            role: 'system',
            content: draftRepairSystemPrompt,
          },
          {
            role: 'user',
            content: buildDraftRepairUserPrompt(input, candidateDraft),
          },
        ],
        response_format: {
          type: 'json_object',
        },
        thinking: {
          type: 'disabled',
        },
        max_tokens: preparedSkill.maxTokens,
        temperature: 0.2,
        stream: false,
      })
    } catch (error) {
      throw new DeepSeekOutputValidationError(
        error,
        initialUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    const repairUsage = toUsage(repairData.usage)
    const combinedUsage = mergeAiUsage(initialUsage, repairUsage)
    if (repairData.error?.message) {
      throw new DeepSeekOutputValidationError(
        new DeepSeekUpstreamError(repairData.error.message, 502),
        combinedUsage,
        preparedSkill.metadata.promptHash,
      )
    }
    const repairContent = repairData.choices?.[0]?.message?.content
    if (!repairContent) {
      throw new DeepSeekOutputValidationError(
        new Error('DeepSeek returned an empty repaired draft.'),
        combinedUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    try {
      candidateDraft = validateDraftSkillOutput(
        preparedSkill.outputSchema.parse(parseJsonContent(repairContent)),
        input.length,
      )
    } catch (error) {
      throw new DeepSeekOutputValidationError(
        error,
        combinedUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    return {
      draft: candidateDraft,
      skill: preparedSkill.metadata,
      model: preparedSkill.model,
      usage: combinedUsage,
    }
  }

  return {
    draft: candidateDraft,
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: initialUsage,
  }
}

export async function rewriteDraftWithDeepSeek(
  config: AppConfig,
  input: RewriteDraftRequest,
  writingProfileContext?: WritingProfileContext,
): Promise<{
  rewrite: AiRewriteResult
  skill: AiSkillMetadata
  model: string
  usage: AiUsage | null
}> {
  if (!config.AI_FEATURE_ENABLED) {
    throw new AiFeatureDisabledError()
  }

  if (!config.DEEPSEEK_API_KEY) {
    throw new DeepSeekNotConfiguredError()
  }

  const preparedSkill = await prepareAiSkill(rewriteSkillV1, {
    ...input,
    writingProfileContext,
  })
  const data = await requestDeepSeekChatCompletion(config, {
    model: preparedSkill.model,
    messages: [
      { role: 'system', content: preparedSkill.systemPrompt },
      { role: 'user', content: preparedSkill.userPrompt },
    ],
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    max_tokens: preparedSkill.maxTokens,
    temperature: preparedSkill.temperature,
    stream: false,
  })

  if (data.error?.message) {
    throw new DeepSeekUpstreamError(data.error.message, 502)
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new DeepSeekUpstreamError('DeepSeek returned an empty rewrite.', 502)
  }

  const initialUsage = toUsage(data.usage)
  const groundingSource = getRewriteGroundingSource(input)
  let candidateRewrite: AiRewriteResult
  try {
    candidateRewrite = preparedSkill.outputSchema.parse(
      unwrapDeepSeekObject(
        parseJsonContent(content),
        ['summary', 'suggestions', 'recommendedIndex'],
      ),
    )
  } catch (error) {
    throw new DeepSeekOutputValidationError(
      error,
      initialUsage,
      preparedSkill.metadata.promptHash,
    )
  }

  try {
    candidateRewrite = validateRewriteSkillOutput(
      candidateRewrite,
      input.selectedText,
      groundingSource,
    )
  } catch (validationError) {
    const filteredRewrite = filterGroundedRewriteSuggestions(
      candidateRewrite,
      groundingSource,
    )
    if (filteredRewrite.suggestions.length >= 2) {
      try {
        candidateRewrite = validateRewriteSkillOutput(
          filteredRewrite,
          input.selectedText,
          groundingSource,
        )
        return {
          rewrite: candidateRewrite,
          skill: preparedSkill.metadata,
          model: preparedSkill.model,
          usage: initialUsage,
        }
      } catch {
        // Non-grounding contract errors still get the single repair attempt below.
      }
    }

    let repairData: DeepSeekChatCompletionResponse
    try {
      repairData = await requestDeepSeekChatCompletion(config, {
        model: preparedSkill.model,
        messages: [
          { role: 'system', content: rewriteRepairSystemPrompt },
          {
            role: 'user',
            content: buildRewriteRepairUserPrompt(
              preparedSkill.userPrompt,
              candidateRewrite,
              getErrorMessage(validationError),
            ),
          },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        max_tokens: preparedSkill.maxTokens,
        temperature: 0.1,
        stream: false,
      })
    } catch (error) {
      throw new DeepSeekOutputValidationError(
        error,
        initialUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    const combinedUsage = mergeAiUsage(initialUsage, toUsage(repairData.usage))
    const repairContent = repairData.choices?.[0]?.message?.content
    if (repairData.error?.message || !repairContent) {
      throw new DeepSeekOutputValidationError(
        new Error(
          repairData.error?.message || 'DeepSeek returned an empty repaired rewrite.',
        ),
        combinedUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    try {
      const repairedRewrite = preparedSkill.outputSchema.parse(
        unwrapDeepSeekObject(
          parseJsonContent(repairContent),
          ['summary', 'suggestions', 'recommendedIndex'],
        ),
      )
      const filteredRepair = filterGroundedRewriteSuggestions(
        repairedRewrite,
        groundingSource,
      )
      candidateRewrite = validateRewriteSkillOutput(
        filteredRepair.suggestions.length >= 2 ? filteredRepair : repairedRewrite,
        input.selectedText,
        groundingSource,
      )
    } catch (error) {
      throw new DeepSeekOutputValidationError(
        error,
        combinedUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    return {
      rewrite: candidateRewrite,
      skill: preparedSkill.metadata,
      model: preparedSkill.model,
      usage: combinedUsage,
    }
  }

  return {
    rewrite: candidateRewrite,
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: initialUsage,
  }
}

export async function previewDraftForReaderWithDeepSeek(
  config: AppConfig,
  input: PreviewDraftForReaderRequest,
  writingProfileContext?: WritingProfileContext,
): Promise<{
  preview: AiReaderPreviewResult
  skill: AiSkillMetadata
  model: string
  usage: AiUsage | null
}> {
  if (!config.AI_FEATURE_ENABLED) {
    throw new AiFeatureDisabledError()
  }

  if (!config.DEEPSEEK_API_KEY) {
    throw new DeepSeekNotConfiguredError()
  }

  const preparedSkill = await prepareAiSkill(readerPreviewSkillV1, {
    ...input,
    writingProfileContext,
  })
  const data = await requestDeepSeekChatCompletion(config, {
    model: preparedSkill.model,
    messages: [
      { role: 'system', content: preparedSkill.systemPrompt },
      { role: 'user', content: preparedSkill.userPrompt },
    ],
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    max_tokens: preparedSkill.maxTokens,
    temperature: preparedSkill.temperature,
    stream: false,
  })

  if (data.error?.message) {
    throw new DeepSeekUpstreamError(data.error.message, 502)
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new DeepSeekUpstreamError('DeepSeek returned an empty reader preview.', 502)
  }

  const initialUsage = toUsage(data.usage)
  const groundingSource = getReaderPreviewGroundingSource(input)
  let candidatePreview: AiReaderPreviewResult
  try {
    candidatePreview = preparedSkill.outputSchema.parse(
      unwrapDeepSeekObject(
        parseJsonContent(content),
        ['audienceSummary', 'annotations', 'suggestions'],
      ),
    )
  } catch (error) {
    throw new DeepSeekOutputValidationError(
      error,
      initialUsage,
      preparedSkill.metadata.promptHash,
    )
  }

  try {
    candidatePreview = validateReaderPreviewSkillOutput(
      candidatePreview,
      input.draft,
      groundingSource,
    )
  } catch (validationError) {
    const filteredPreview = filterGroundedReaderSuggestions(
      candidatePreview,
      groundingSource,
    )
    if (filteredPreview.suggestions.length >= 1) {
      try {
        candidatePreview = validateReaderPreviewSkillOutput(
          filteredPreview,
          input.draft,
          groundingSource,
        )
        return {
          preview: candidatePreview,
          skill: preparedSkill.metadata,
          model: preparedSkill.model,
          usage: initialUsage,
        }
      } catch {
        // Non-grounding contract errors still get the single repair attempt below.
      }
    }

    let repairData: DeepSeekChatCompletionResponse
    try {
      repairData = await requestDeepSeekChatCompletion(config, {
        model: preparedSkill.model,
        messages: [
          { role: 'system', content: readerPreviewRepairSystemPrompt },
          {
            role: 'user',
            content: buildReaderPreviewRepairUserPrompt(
              preparedSkill.userPrompt,
              candidatePreview,
              getErrorMessage(validationError),
            ),
          },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        max_tokens: preparedSkill.maxTokens,
        temperature: 0.1,
        stream: false,
      })
    } catch (error) {
      throw new DeepSeekOutputValidationError(
        error,
        initialUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    const combinedUsage = mergeAiUsage(initialUsage, toUsage(repairData.usage))
    const repairContent = repairData.choices?.[0]?.message?.content
    if (repairData.error?.message || !repairContent) {
      throw new DeepSeekOutputValidationError(
        new Error(
          repairData.error?.message || 'DeepSeek returned an empty repaired reader preview.',
        ),
        combinedUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    try {
      const repairedPreview = preparedSkill.outputSchema.parse(
        unwrapDeepSeekObject(
          parseJsonContent(repairContent),
          ['audienceSummary', 'annotations', 'suggestions'],
        ),
      )
      const filteredRepair = filterGroundedReaderSuggestions(
        repairedPreview,
        groundingSource,
      )
      candidatePreview = validateReaderPreviewSkillOutput(
        filteredRepair.suggestions.length >= 1 ? filteredRepair : repairedPreview,
        input.draft,
        groundingSource,
      )
    } catch (error) {
      throw new DeepSeekOutputValidationError(
        error,
        combinedUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    return {
      preview: candidatePreview,
      skill: preparedSkill.metadata,
      model: preparedSkill.model,
      usage: combinedUsage,
    }
  }

  return {
    preview: candidatePreview,
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: initialUsage,
  }
}

export async function learnWritingProfileWithDeepSeek(
  config: AppConfig,
  input: BuildWritingProfileRequest,
): Promise<{
  profile: WritingProfile
  skill: AiSkillMetadata
  model: string
  usage: AiUsage | null
}> {
  if (!config.AI_FEATURE_ENABLED) {
    throw new AiFeatureDisabledError()
  }

  if (!config.DEEPSEEK_API_KEY) {
    throw new DeepSeekNotConfiguredError()
  }

  const preparedSkill = await prepareAiSkill(writerModelSkillV1, input)
  const data = await requestDeepSeekChatCompletion(config, {
    model: preparedSkill.model,
    messages: [
      { role: 'system', content: preparedSkill.systemPrompt },
      { role: 'user', content: preparedSkill.userPrompt },
    ],
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    max_tokens: preparedSkill.maxTokens,
    temperature: preparedSkill.temperature,
    stream: false,
  })

  if (data.error?.message) {
    throw new DeepSeekUpstreamError(data.error.message, 502)
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new DeepSeekUpstreamError('DeepSeek returned an empty writing profile.', 502)
  }

  const parsed = parseValidatedDeepSeekOutput(
    content,
    data,
    preparedSkill.metadata,
    (value) => preparedSkill.outputSchema.parse(value),
  )

  return {
    profile: parsed.value,
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: parsed.usage,
  }
}
