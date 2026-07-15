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
  draftSkillV1,
  validateDraftSkillOutput,
} from '../skills/draft-v1/index.js'
import { prepareAiSkill } from '../skills/runtime.js'
import {
  rewriteSkillV1,
  validateRewriteSkillOutput,
} from '../skills/rewrite-v1/index.js'
import {
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

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new DeepSeekUpstreamError('DeepSeek returned non-JSON content.', 502)
    return JSON.parse(match[0])
  }
}

function toUsage(usage: DeepSeekChatCompletionResponse['usage']): AiUsage | null {
  if (!usage) return null
  return {
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
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

  return {
    analysis: preparedSkill.outputSchema.parse(parseJsonContent(content)),
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: toUsage(data.usage),
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

  const draft = preparedSkill.outputSchema.parse(parseJsonContent(content))

  return {
    draft: validateDraftSkillOutput(draft, input.length),
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: toUsage(data.usage),
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

  const rewrite = preparedSkill.outputSchema.parse(parseJsonContent(content))
  return {
    rewrite: validateRewriteSkillOutput(rewrite, input.selectedText),
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: toUsage(data.usage),
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

  const preview = preparedSkill.outputSchema.parse(parseJsonContent(content))
  return {
    preview: validateReaderPreviewSkillOutput(preview, input.draft),
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: toUsage(data.usage),
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

  return {
    profile: preparedSkill.outputSchema.parse(parseJsonContent(content)),
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: toUsage(data.usage),
  }
}
