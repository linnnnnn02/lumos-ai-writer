import {
  aiDraftCopySchema,
  type AiDraftCopy,
  type GenerateDraftRequest,
} from '@lumos-ai/shared'
import type { AiSkillDefinition } from '../runtime.js'
import { antiAiWritingRulesV1 } from '../shared/anti-ai-writing-rules-v1.js'

export const draftLengthPolicies = {
  short: {
    minParagraphs: 3,
    maxParagraphs: 5,
    minCharacters: 120,
    maxCharacters: 220,
  },
  medium: {
    minParagraphs: 5,
    maxParagraphs: 7,
    minCharacters: 300,
    maxCharacters: 520,
  },
  long: {
    minParagraphs: 7,
    maxParagraphs: 10,
    minCharacters: 650,
    maxCharacters: 950,
  },
} as const

const outputContract = {
  title: '一条不超过 35 个汉字的小红书标题',
  body: ['独立正文段落 1', '独立正文段落 2', '独立正文段落 3'],
}

function trimText(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

export function compactDraftSkillInput(input: GenerateDraftRequest) {
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

export function validateDraftSkillOutput(
  draft: AiDraftCopy,
  length: GenerateDraftRequest['length'],
) {
  const policy = draftLengthPolicies[length]
  return aiDraftCopySchema
    .superRefine((value, context) => {
      const titleLength = Array.from(value.title).length
      const bodyCharacterCount = Array.from(value.body.join('').replace(/\s/g, '')).length

      if (titleLength > 35) {
        context.addIssue({
          code: 'custom',
          path: ['title'],
          message: 'Draft title must not exceed 35 characters.',
        })
      }

      if (
        value.body.length < policy.minParagraphs ||
        value.body.length > policy.maxParagraphs
      ) {
        context.addIssue({
          code: 'custom',
          path: ['body'],
          message: `Draft must contain ${policy.minParagraphs}-${policy.maxParagraphs} paragraphs for ${length} length.`,
        })
      }

      if (
        bodyCharacterCount < policy.minCharacters ||
        bodyCharacterCount > policy.maxCharacters
      ) {
        context.addIssue({
          code: 'custom',
          path: ['body'],
          message: `Draft must contain ${policy.minCharacters}-${policy.maxCharacters} characters for ${length} length.`,
        })
      }
    })
    .parse(draft)
}

const draftSystemPrompt = [
  '你是 Lumos AI Writer 的小红书初稿生成 Skill。',
  '目标是依据用户选题、目标读者、明确要求和已完成的学习拆解，生成一版可以继续编辑的中文初稿。',
  '指令优先级：brief.mustInclude 与 brief.avoidTone > analysis 的风格约束与避坑点 > 用户标注理由和标签 > 参考文案。',
  '参考文案只提供写作机制，不提供可直接挪用的个人经历、产品事实、数据或句子。',
  '只有 topic 或 brief 明确支持时才使用第一人称经历；不得把参考作者的经历写成用户经历。',
  'brief.mustInclude 非空时必须自然包含其中的信息，brief.avoidTone 非空时必须视为硬性禁用语气。',
  '标题必须具体、克制且与正文一致，不超过 35 个汉字，不用夸张承诺或无依据的数字。',
  'body 每个数组元素必须是一个完整段落，段落之间要有清晰推进，不写提纲标签或段落功能说明。',
  '长度规则必须按 input.length 执行：',
  `short：${draftLengthPolicies.short.minParagraphs}-${draftLengthPolicies.short.maxParagraphs} 段，总字数约 ${draftLengthPolicies.short.minCharacters}-${draftLengthPolicies.short.maxCharacters} 字。`,
  `medium：${draftLengthPolicies.medium.minParagraphs}-${draftLengthPolicies.medium.maxParagraphs} 段，总字数约 ${draftLengthPolicies.medium.minCharacters}-${draftLengthPolicies.medium.maxCharacters} 字。`,
  `long：${draftLengthPolicies.long.minParagraphs}-${draftLengthPolicies.long.maxParagraphs} 段，总字数约 ${draftLengthPolicies.long.minCharacters}-${draftLengthPolicies.long.maxCharacters} 字。`,
  '默认不用 emoji；确有语气需要时整篇最多 2 个。结尾可以互动，但不能强行要求点赞、收藏或关注。',
  '去 AI 味规则：',
  ...antiAiWritingRulesV1.map((rule, index) => `${index + 1}. ${rule}`),
  '只输出一个 JSON object，不要 Markdown，不要代码块，不要解释或思考过程。',
  'JSON 字段必须严格匹配：',
  JSON.stringify(outputContract),
].join('\n')

export const draftSkillV1: AiSkillDefinition<
  GenerateDraftRequest,
  AiDraftCopy
> = {
  id: 'xiaohongshu-draft',
  version: '1.0.0',
  taskType: 'draft',
  model: 'deepseek-v4-flash',
  maxTokens: 2600,
  temperature: 0.68,
  systemPrompt: draftSystemPrompt,
  userPromptTemplate:
    'JSON.stringify({ task: "generate_xiaohongshu_draft", input: compactDraftSkillInput(input) })',
  buildUserPrompt: (input) =>
    JSON.stringify({
      task: 'generate_xiaohongshu_draft',
      input: compactDraftSkillInput(input),
    }),
  outputSchema: aiDraftCopySchema,
}
