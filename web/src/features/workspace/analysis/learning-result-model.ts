import type { AiAnalysisResult } from '@lumos-ai/shared'

const contentModeLabels: Record<AiAnalysisResult['contentMode']['targetMode'], string> = {
  unclassified: '按当前需求判断',
  brand_story: '品牌叙事',
  product_education: '产品说明',
  campaign_interaction: '活动互动',
  event_announcement: '事件通知',
  social_moment: '日常分享',
  other: '其他内容类型',
}

const confidenceLabels: Record<AiAnalysisResult['contentMode']['confidence'], string> = {
  high: '判断较明确',
  medium: '仍需结合简报',
  low: '仅作初步参考',
}

function takeUnique(values: Array<string | undefined>, limit: number) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).slice(
    0,
    limit,
  )
}

export type LearningResultViewModel = {
  conclusion: string
  patterns: string[]
  evidenceSummary: string
  evidenceItems: Array<{
    quote: string
    source: string
    reason: string
  }>
  applicability: {
    modeLabel: string
    confidenceLabel: string
    rationale: string
    reuseSuggestion: string
    boundary: string
  }
  pendingItems: string[]
  memory: {
    current: string
    longTerm: string
  }
}

export function buildLearningResultViewModel(
  analysis: AiAnalysisResult,
  isCloudEnabled: boolean,
): LearningResultViewModel {
  const targetMode = analysis.contentMode?.targetMode ?? 'unclassified'
  const confidence = analysis.contentMode?.confidence ?? 'low'
  const reusableMechanisms = analysis.aiLearningMethod?.reusableMechanisms ?? []
  const patterns = takeUnique([...reusableMechanisms, ...analysis.effectivePatterns], 3)
  const boundary = takeUnique(
    [
      analysis.avoidPitfall,
      analysis.contentMode?.modeSpecificGuidance?.styleBoundary,
    ],
    2,
  )
    .map((item) => item.replace(/[。；;]+$/, ''))
    .join('；')

  return {
    conclusion: analysis.coreJudgement,
    patterns,
    evidenceSummary: analysis.evidence,
    evidenceItems: analysis.featuredSnippets.slice(0, 3).map((snippet) => ({
      quote: snippet.quote,
      source: snippet.noteTitle || '已选参考',
      reason: snippet.reason || snippet.description,
    })),
    applicability: {
      modeLabel: contentModeLabels[targetMode],
      confidenceLabel: confidenceLabels[confidence],
      rationale: analysis.contentMode?.rationale ?? '生成时会继续结合当前创作简报判断。',
      reuseSuggestion: analysis.reuseSuggestion,
      boundary: boundary ? `${boundary}。` : '不迁移参考文案里的具体事实、对象和承诺。',
    },
    pendingItems: takeUnique([analysis.preferenceQuestion], 2),
    memory: {
      current: '这次分析会直接作为当前初稿的写作依据；修改参考后需要重新分析。',
      longTerm: isCloudEnabled
        ? '登录后，素材共性可参与账号与项目表达档案；单次结论不会自动变成永久规则。'
        : '当前是本地演示，不会把这次结论写入跨设备表达档案。',
    },
  }
}
