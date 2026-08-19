import type { AppConfig } from '../env.js'
import {
  type AiAnalysisResult,
  type AiDraftCopy,
  type AiRewriteResult,
  type AiReaderPreviewResult,
  type AiSkillMetadata,
  type AiUsage,
  type AppliedWritingProfileContext,
  type AnalyzeReferencesRequest,
  type BuildWritingProfileRequest,
  type DraftQualitySnapshot,
  type GenerateDraftRequest,
  type RewriteDraftRequest,
  type PreviewDraftForReaderRequest,
  type WritingProfile,
} from '@lumos-ai/shared'
import {
  analysisSkillV1,
  normalizeAnalysisContentMode,
} from '../skills/analysis-v1/index.js'
import {
  buildDraftQualitySnapshot,
  buildDraftGroundingAuditUserPrompt,
  buildDraftRepairUserPrompt,
  draftGroundingAuditSystemPrompt,
  getDraftGroundingIssues,
  getDraftRequirementIssues,
  draftRepairSystemPrompt,
  draftSkillV1,
  findUnsupportedMindsetIssues,
  resolveDraftContentMode,
  validateDraftGroundingAuditOutput,
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
  filterGroundedReaderSuggestions,
  normalizeReaderPreviewConfidence,
  normalizeReaderPreviewOutput,
  readerPreviewSkillV1,
  validateReaderPreviewSkillOutput,
} from '../skills/reader-preview-v1/index.js'
import {
  normalizeWriterModelOutput,
  writerModelSkillV1,
} from '../skills/writer-model-v1/index.js'
import type { WritingProfileContext } from '../writing-profile.js'
import { getAppliedWritingProfileContext } from '../skills/shared/writing-profile.js'

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

function parseJsonWithBoundedMissingCommas(content: string): unknown {
  const maxRepairs = 2
  let candidate = content

  for (let repairCount = 0; repairCount <= maxRepairs; repairCount += 1) {
    try {
      return JSON.parse(candidate)
    } catch (error) {
      if (repairCount === maxRepairs) throw error

      const positionMatch =
        error instanceof SyntaxError
          ? error.message.match(
              /Expected ',' or (?:'\]' after array element|'\}' after property value) in JSON at position (\d+)/,
            )
          : null
      const position = Number(positionMatch?.[1])
      if (!Number.isInteger(position) || position <= 0 || position >= candidate.length) {
        throw error
      }

      // Each insertion is anchored to the native parser's exact delimiter error.
      // Any third syntax defect or different grammar error remains rejected.
      candidate = `${candidate.slice(0, position)},${candidate.slice(position)}`
    }
  }

  throw new DeepSeekUpstreamError('DeepSeek returned invalid JSON content.', 502)
}

function extractFirstJsonObject(content: string) {
  const start = content.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let insideString = false
  let escaped = false

  for (let index = start; index < content.length; index += 1) {
    const character = content[index]
    if (insideString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        insideString = false
      }
      continue
    }

    if (character === '"') {
      insideString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) return content.slice(start, index + 1)
    }
  }

  return null
}

function escapeControlCharactersInsideJsonStrings(content: string) {
  let result = ''
  let insideString = false
  let escaped = false

  for (const character of content) {
    if (!insideString) {
      result += character
      if (character === '"') insideString = true
      continue
    }

    if (escaped) {
      result += character
      escaped = false
      continue
    }

    if (character === '\\') {
      result += character
      escaped = true
      continue
    }

    if (character === '"') {
      result += character
      insideString = false
      continue
    }

    if (character.charCodeAt(0) < 0x20) {
      result += JSON.stringify(character).slice(1, -1)
      continue
    }

    result += character
  }

  return result
}

export function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    const candidate = extractFirstJsonObject(content)
    if (!candidate) {
      throw new DeepSeekUpstreamError('DeepSeek returned non-JSON content.', 502)
    }
    return parseJsonWithBoundedMissingCommas(
      escapeControlCharactersInsideJsonStrings(candidate),
    )
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
    analysis: normalizeAnalysisContentMode(parsed.value, input),
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: parsed.usage,
  }
}

async function auditDraftGroundingWithDeepSeek(
  config: AppConfig,
  input: GenerateDraftRequest,
  candidateDraft: AiDraftCopy,
  model: string,
) {
  if (
    input.brief.sourceFacts.trim().length === 0 &&
    input.brief.facts.length === 0
  ) {
    return {
      audit: null,
      issues: [],
      requirementIssues: [],
      usage: null,
    }
  }

  const data = await requestDeepSeekChatCompletion(config, {
    model,
    messages: [
      {
        role: 'system',
        content: draftGroundingAuditSystemPrompt,
      },
      {
        role: 'user',
        content: buildDraftGroundingAuditUserPrompt(input, candidateDraft),
      },
    ],
    response_format: {
      type: 'json_object',
    },
    thinking: {
      type: 'disabled',
    },
    max_tokens: 1800,
    temperature: 0,
    stream: false,
  })

  if (data.error?.message) {
    throw new DeepSeekUpstreamError(data.error.message, 502)
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new DeepSeekUpstreamError(
      'DeepSeek returned an empty draft grounding audit.',
      502,
    )
  }

  const audit = validateDraftGroundingAuditOutput(
    parseJsonContent(content),
    candidateDraft,
    input,
  )

  return {
    audit,
    issues: getDraftGroundingIssues(audit),
    requirementIssues: getDraftRequirementIssues(audit),
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
  appliedWritingProfile: AppliedWritingProfileContext
  quality: DraftQualitySnapshot
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
  const contentMode = resolveDraftContentMode({ ...input, writingProfileContext })
  const appliedWritingProfile = getAppliedWritingProfileContext(
    writingProfileContext,
    contentMode.usesLegacyFallback ? 'unclassified' : contentMode.resolvedMode,
  )

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

  let combinedUsage = initialUsage
  let lastValidationError: unknown = new Error('Draft validation did not run.')

  for (let repairAttempt = 0; repairAttempt <= 2; repairAttempt += 1) {
    let groundingIssues: Awaited<
      ReturnType<typeof auditDraftGroundingWithDeepSeek>
    >['issues'] = []
    let requirementIssues: Awaited<
      ReturnType<typeof auditDraftGroundingWithDeepSeek>
    >['requirementIssues'] = []
    let groundingAudit: Awaited<
      ReturnType<typeof auditDraftGroundingWithDeepSeek>
    >['audit'] = null
    let contractIsValid = false

    try {
      candidateDraft = validateDraftSkillOutput(candidateDraft, input.length, input)
      contractIsValid = true
    } catch (error) {
      lastValidationError = error
    }

    if (contractIsValid) {
      try {
        const audit = await auditDraftGroundingWithDeepSeek(
          config,
          input,
          candidateDraft,
          preparedSkill.model,
        )
        combinedUsage = mergeAiUsage(combinedUsage, audit.usage)
        groundingIssues = [
          ...audit.issues,
          ...findUnsupportedMindsetIssues(candidateDraft, input).filter(
            (issue) =>
              !audit.issues.some(
                (auditIssue) => auditIssue.quote === issue.quote,
              ),
          ),
        ]
        requirementIssues = audit.requirementIssues
        groundingAudit = audit.audit
      } catch (error) {
        throw new DeepSeekOutputValidationError(
          error,
          combinedUsage,
          preparedSkill.metadata.promptHash,
        )
      }

      if (groundingIssues.length === 0 && requirementIssues.length === 0) {
        return {
          draft: candidateDraft,
          skill: preparedSkill.metadata,
          model: preparedSkill.model,
          appliedWritingProfile,
          quality: buildDraftQualitySnapshot(input, candidateDraft, groundingAudit),
          usage: combinedUsage,
        }
      }

      lastValidationError = new Error(
        `Draft contains ${groundingIssues.length} unsupported assertion(s) and ${requirementIssues.length} unmet requirement(s): ${groundingIssues
          .map((issue) => issue.quote)
          .concat(requirementIssues.map((issue) => issue.id))
          .join(' | ')}`,
      )
    }

    if (repairAttempt === 2) break

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
            content: buildDraftRepairUserPrompt(
              input,
              candidateDraft,
              groundingIssues,
              requirementIssues,
            ),
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
        combinedUsage,
        preparedSkill.metadata.promptHash,
      )
    }

    combinedUsage = mergeAiUsage(combinedUsage, toUsage(repairData.usage))
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
      candidateDraft = preparedSkill.outputSchema.parse(
        parseJsonContent(repairContent),
      )
    } catch (error) {
      throw new DeepSeekOutputValidationError(
        error,
        combinedUsage,
        preparedSkill.metadata.promptHash,
      )
    }
  }

  throw new DeepSeekOutputValidationError(
    lastValidationError,
    combinedUsage,
    preparedSkill.metadata.promptHash,
  )
}

export async function rewriteDraftWithDeepSeek(
  config: AppConfig,
  input: RewriteDraftRequest,
  writingProfileContext?: WritingProfileContext,
): Promise<{
  rewrite: AiRewriteResult
  skill: AiSkillMetadata
  model: string
  appliedWritingProfile: AppliedWritingProfileContext
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
  const appliedWritingProfile = getAppliedWritingProfileContext(
    writingProfileContext,
    input.analysis?.contentMode.targetMode ?? 'unclassified',
  )
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
          appliedWritingProfile,
          usage: initialUsage,
        }
      } catch {
        // Non-grounding contract errors still get the single repair attempt below.
      }
    }

    let combinedUsage = initialUsage
    let latestValidationError: unknown = validationError

    for (let repairAttempt = 1; repairAttempt <= 2; repairAttempt += 1) {
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
                getErrorMessage(latestValidationError),
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
          combinedUsage,
          preparedSkill.metadata.promptHash,
        )
      }

      combinedUsage = mergeAiUsage(combinedUsage, toUsage(repairData.usage))
      const repairContent = repairData.choices?.[0]?.message?.content
      if (repairData.error?.message || !repairContent) {
        latestValidationError = new Error(
          repairData.error?.message || 'DeepSeek returned an empty repaired rewrite.',
        )
        continue
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
        return {
          rewrite: candidateRewrite,
          skill: preparedSkill.metadata,
          model: preparedSkill.model,
          appliedWritingProfile,
          usage: combinedUsage,
        }
      } catch (error) {
        latestValidationError = error
      }
    }

    throw new DeepSeekOutputValidationError(
      latestValidationError,
      combinedUsage,
      preparedSkill.metadata.promptHash,
    )
  }

  return {
    rewrite: candidateRewrite,
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    appliedWritingProfile,
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
    candidatePreview = normalizeReaderPreviewConfidence(
      preparedSkill.outputSchema.parse(
        normalizeReaderPreviewOutput(
          unwrapDeepSeekObject(
            parseJsonContent(content),
            ['audienceSummary', 'annotations', 'suggestions'],
          ),
        ),
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
  } catch {
    const filteredPreview = filterGroundedReaderSuggestions(
      candidatePreview,
      groundingSource,
    )
    try {
      candidatePreview = validateReaderPreviewSkillOutput(
        filteredPreview,
        input.draft,
        groundingSource,
      )
    } catch (error) {
      throw new DeepSeekOutputValidationError(
        error,
        initialUsage,
        preparedSkill.metadata.promptHash,
      )
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
    (value) =>
      preparedSkill.outputSchema.parse(normalizeWriterModelOutput(value, input)),
  )

  return {
    profile: parsed.value,
    skill: preparedSkill.metadata,
    model: preparedSkill.model,
    usage: parsed.usage,
  }
}
