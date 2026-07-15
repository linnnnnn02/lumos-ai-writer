import type { AiSkillMetadata } from '@lumos-ai/shared'
import type { ZodType } from 'zod'

export type AiSkillTaskType =
  | 'analyze'
  | 'profile-learn'
  | 'draft'
  | 'rewrite'
  | 'reader-preview'

export type AiSkillDefinition<TInput, TOutput> = {
  id: string
  version: string
  taskType: AiSkillTaskType
  model: string
  maxTokens: number
  temperature: number
  systemPrompt: string
  userPromptTemplate: string
  buildUserPrompt: (input: TInput) => string
  outputSchema: ZodType<TOutput>
}

export type PreparedAiSkill<TOutput> = {
  metadata: AiSkillMetadata
  model: string
  maxTokens: number
  temperature: number
  systemPrompt: string
  userPrompt: string
  outputSchema: ZodType<TOutput>
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function createSkillPromptHash<TInput, TOutput>(
  skill: AiSkillDefinition<TInput, TOutput>,
) {
  const revisionSource = [
    skill.id,
    skill.version,
    skill.taskType,
    skill.model,
    String(skill.maxTokens),
    String(skill.temperature),
    skill.systemPrompt,
    skill.userPromptTemplate,
  ].join('\n---\n')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(revisionSource),
  )

  return toHex(new Uint8Array(digest))
}

export async function prepareAiSkill<TInput, TOutput>(
  skill: AiSkillDefinition<TInput, TOutput>,
  input: TInput,
): Promise<PreparedAiSkill<TOutput>> {
  return {
    metadata: {
      id: skill.id,
      version: skill.version,
      promptHash: await createSkillPromptHash(skill),
    },
    model: skill.model,
    maxTokens: skill.maxTokens,
    temperature: skill.temperature,
    systemPrompt: skill.systemPrompt,
    userPrompt: skill.buildUserPrompt(input),
    outputSchema: skill.outputSchema,
  }
}
