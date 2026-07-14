import {
  aiAnalysisResultSchema,
  type AiAnalysisResult,
  type AnalyzeReferencesRequest,
} from '@lumos-ai/shared'
import type { AiSkillDefinition } from '../runtime.js'
import { antiAiWritingRulesV1 } from '../shared/anti-ai-writing-rules-v1.js'

const outputContract = {
  projectName: 'string',
  aiLearningMethod: {
    writingPath: 'string',
    reusableMechanisms: ['string', 'string', 'string'],
    styleConstraints: ['string', 'string'],
  },
  coreJudgement: 'string',
  evidence: 'string',
  effectivePatterns: ['开头策略', '中段策略', '收尾策略'],
  featuredSnippets: [
    {
      quote: '被引用的原文片段',
      noteTitle: '来源标题',
      noteUrl: '来源链接',
      label: '选择点处理',
      description: '这个片段可复用的机制',
      reason: '用户标注理由',
    },
  ],
  userPreference: 'string',
  reuseSuggestion: 'string',
  avoidPitfall: 'string',
  preferenceQuestion: 'string',
  writingMove: 'string',
  summary: 'string',
  wording: ['string', 'string'],
  structure: ['string', 'string'],
  preference: ['string', 'string'],
  readerView: ['string', 'string'],
  nextStep: ['string', 'string'],
}

function trimText(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

export function compactAnalysisSkillInput(input: AnalyzeReferencesRequest) {
  return {
    projectName: input.projectName,
    folderName: input.folderName,
    topic: input.topic,
    targetAudience: input.targetAudience,
    length: input.length,
    notes: input.notes.slice(0, 8).map((note) => ({
      title: note.title,
      filename: note.filename,
      authorName: note.authorName,
      sourceUrl: note.sourceUrl,
      folderName: note.folderName,
      contentText: trimText(note.contentText, 1200),
    })),
    snippets: input.snippets.slice(0, 24).map((snippet) => ({
      noteTitle: snippet.noteTitle,
      noteUrl: snippet.noteUrl,
      selectedText: trimText(snippet.selectedText, 600),
      reasonText: trimText(snippet.reasonText, 400),
      colorTagName: snippet.colorTagName,
    })),
  }
}

const analysisSystemPrompt = [
  '你是 Lumos AI Writer 的参考文案分析 Skill。',
  '目标不是总结原文，而是从用户主动选择的文案、标注片段、理由和颜色标签中提炼下一篇可执行的写作机制。',
  '证据优先级：用户理由 > 用户标签 > 用户选中片段 > 整篇参考文案。',
  '只输出一个 JSON object，不要 Markdown，不要代码块，不要额外解释。',
  '必须使用中文，所有判断都要具体、短、可执行。',
  'coreJudgement 必须结论前置，以动词加结果或判断开头，不写分析过程。',
  'effectivePatterns 至少 3 条，严格按开头、中段、收尾排序。',
  'featuredSnippets 最多 2 个，只能逐字引用 input.snippets 中存在的片段，并保留来源；没有合适片段时返回空数组。',
  'userPreference 只能依据用户理由、标签和多条一致证据提炼；证据不足时明确写成待验证偏好。',
  'reuseSuggestion 和 writingMove 必须能直接指导下一篇怎么写，avoidPitfall 必须指出一个具体风险。',
  '去 AI 味规则：',
  ...antiAiWritingRulesV1.map((rule, index) => `${index + 1}. ${rule}`),
  'JSON 字段必须严格匹配：',
  JSON.stringify(outputContract),
].join('\n')

export const analysisSkillV1: AiSkillDefinition<
  AnalyzeReferencesRequest,
  AiAnalysisResult
> = {
  id: 'reference-analysis',
  version: '1.0.0',
  taskType: 'analyze',
  model: 'deepseek-v4-flash',
  maxTokens: 2200,
  temperature: 0.35,
  systemPrompt: analysisSystemPrompt,
  userPromptTemplate:
    'JSON.stringify({ task: "analyze_reference_writing_patterns", input: compactAnalysisSkillInput(input) })',
  buildUserPrompt: (input) =>
    JSON.stringify({
      task: 'analyze_reference_writing_patterns',
      input: compactAnalysisSkillInput(input),
    }),
  outputSchema: aiAnalysisResultSchema,
}
