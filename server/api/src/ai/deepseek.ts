import type { AppConfig } from '../env.js'
import {
  aiDraftCopySchema,
  type AiAnalysisResult,
  type AiDraftCopy,
  type AiSkillMetadata,
  type AiUsage,
  type AnalyzeReferencesRequest,
  type GenerateDraftRequest,
} from '@lumos-ai/shared'
import { analysisSkillV1 } from '../skills/analysis-v1/index.js'
import { prepareAiSkill } from '../skills/runtime.js'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const DEEPSEEK_REQUEST_TIMEOUT_MS = 60_000
export const DEEPSEEK_ANALYZE_MODEL = analysisSkillV1.model
export const DEEPSEEK_DRAFT_MODEL = 'deepseek-v4-flash'

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

function trimText(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function compactDraftInput(input: GenerateDraftRequest) {
  return {
    projectName: input.projectName,
    topic: input.topic,
    targetAudience: input.targetAudience,
    length: input.length,
    brief: input.brief,
    analysis: {
      writingPath: input.analysis.aiLearningMethod.writingPath,
      reusableMechanisms: input.analysis.aiLearningMethod.reusableMechanisms,
      styleConstraints: input.analysis.aiLearningMethod.styleConstraints,
      coreJudgement: input.analysis.coreJudgement,
      effectivePatterns: input.analysis.effectivePatterns,
      userPreference: input.analysis.userPreference,
      reuseSuggestion: input.analysis.reuseSuggestion,
      avoidPitfall: input.analysis.avoidPitfall,
      writingMove: input.analysis.writingMove,
    },
    notes: input.notes.slice(0, 6).map((note) => ({
      title: note.title,
      authorName: note.authorName,
      contentText: trimText(note.contentText, 900),
    })),
    snippets: input.snippets.slice(0, 16).map((snippet) => ({
      selectedText: trimText(snippet.selectedText, 500),
      reasonText: trimText(snippet.reasonText, 300),
      colorTagName: snippet.colorTagName,
    })),
  }
}

function getDraftLengthInstruction(length: GenerateDraftRequest['length']) {
  if (length === 'short') return '正文控制在 3-5 段，总字数约 120-220 字。'
  if (length === 'medium') return '正文控制在 5-7 段，总字数约 300-520 字。'
  return '正文控制在 7-10 段，总字数约 650-950 字。'
}

function buildDraftSystemPrompt(input: GenerateDraftRequest) {
  return [
    '你是 Lumos AI Writer 的小红书初稿写作助手。',
    '你会根据学习拆解结果和用户补充信息生成第一版可编辑文案。',
    '只输出一个 JSON object，不要 Markdown，不要代码块，不要解释。',
    '必须使用中文，语气自然、具体、像真人分享，避免广告腔和模板总结。',
    getDraftLengthInstruction(input.length),
    'JSON 字段必须严格匹配：',
    JSON.stringify({
      title: '一条小红书标题，不超过 35 个汉字',
      body: ['正文段落1', '正文段落2', '正文段落3'],
    }),
    'body 每个数组元素是一段正文，不要把所有内容塞进一个字符串。',
    '可以适度使用 emoji，但不要堆砌；不要编造无法从输入推断的事实。',
  ].join('\n')
}

function buildDraftUserPrompt(input: GenerateDraftRequest) {
  return JSON.stringify({
    task: 'generate_xiaohongshu_draft',
    input: compactDraftInput(input),
  })
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
): Promise<{
  draft: AiDraftCopy
  model: string
  usage: AiUsage | null
}> {
  if (!config.AI_FEATURE_ENABLED) {
    throw new AiFeatureDisabledError()
  }

  if (!config.DEEPSEEK_API_KEY) {
    throw new DeepSeekNotConfiguredError()
  }

  const data = await requestDeepSeekChatCompletion(config, {
    model: DEEPSEEK_DRAFT_MODEL,
    messages: [
      {
        role: 'system',
        content: buildDraftSystemPrompt(input),
      },
      {
        role: 'user',
        content: buildDraftUserPrompt(input),
      },
    ],
    response_format: {
      type: 'json_object',
    },
    thinking: {
      type: 'disabled',
    },
    max_tokens: 2600,
    temperature: 0.72,
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

  return {
    draft: aiDraftCopySchema.parse(parseJsonContent(content)),
    model: DEEPSEEK_DRAFT_MODEL,
    usage: toUsage(data.usage),
  }
}
