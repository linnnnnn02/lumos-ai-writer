import type {
  AiAnalysisResult,
  ProjectLength,
  SavedNoteRecord,
  SavedSnippetRecord,
} from '@lumos-ai/shared'

type AnalysisInput = {
  folderName: string
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
  topic: string
  targetAudience: string
  projectName: string
  length: ProjectLength
}

function takeUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function topTagNames(snippets: SavedSnippetRecord[]) {
  return takeUnique(snippets.map((snippet) => snippet.colorTagName)).slice(0, 4)
}

function topReasonLines(snippets: SavedSnippetRecord[]) {
  return takeUnique(snippets.map((snippet) => snippet.reasonText)).slice(0, 3)
}

function getSnippetLearningPoint(snippet: SavedSnippetRecord, index: number) {
  const tagName = snippet.colorTagName || ''

  if (index === 0 || tagName.includes('开头') || tagName.includes('钩子')) {
    return {
      label: '选择点处理',
      description: '把选择条件落到具体动作上，读者知道要判断什么。',
    }
  }

  if (index === 1 || tagName.includes('调性') || tagName.includes('互动')) {
    return {
      label: '读者关系处理',
      description: '用称呼或关系感拉近读者，让互动像共同参与。',
    }
  }

  if (tagName.includes('语气') || tagName.includes('文风')) {
    return {
      label: '真实语气处理',
      description: '保留复盘感和顺口表达，减少刻意写作的痕迹。',
    }
  }

  return {
    label: '表达方式处理',
    description: '把抽象的表达重点放进具体语境，后面写同类内容时更好复用。',
  }
}

export function buildDemoAnalysis(input: AnalysisInput): AiAnalysisResult {
  const snippetTags = topTagNames(input.snippets)
  const reasonLines = topReasonLines(input.snippets)
  const noteTitles = input.notes.map((note) => note.filename).slice(0, 3)
  const strongestSnippet = input.snippets[0]?.selectedText
  const strongestReason = input.snippets[0]?.reasonText
  const secondSnippet = input.snippets[1]?.selectedText
  const secondReason = input.snippets[1]?.reasonText
  const tagText = snippetTags.length > 0 ? snippetTags.join('、') : '开头、语气、整体调性'
  const noteCountText = `${input.notes.length} 篇笔记和 ${input.snippets.length} 个标注片段`
  const featuredSnippets = input.snippets.slice(0, 2).map((snippet, index) => ({
    quote: snippet.selectedText,
    noteTitle: snippet.noteTitle,
    noteUrl: snippet.noteUrl,
    reason: snippet.reasonText,
    ...getSnippetLearningPoint(snippet, index),
  }))

  return {
    projectName: input.projectName,
    aiLearningMethod: {
      writingPath: `先让读者做判断 -> 补最关键事实 -> 说清个人取舍 -> 留一个能回复的问题`,
      reusableMechanisms: [
        `把开头写成一个可参与的判断，少做背景介绍。`,
        `让事实只服务当前判断，不在第一屏堆满卖点。`,
        `用真实取舍或关系称呼收束，让互动有具体回复点。`,
      ],
      styleConstraints: [
        `保留真实复盘感和轻互动关系。`,
        `避免模板总结、硬广夸法和空泛提问。`,
      ],
    },
    coreJudgement: `这组参考文案通常先把读者放进具体场景，让读者先做选择或产生疑问，再顺势补背景和关键信息。我会学习这种先给问题感、再解释背景的推进节奏。`,
    evidence:
      strongestSnippet && secondSnippet
        ? `这两处分别处理选择点和读者关系。`
        : strongestSnippet
          ? `这句先给读者一个判断入口，再展开背景。`
          : `这组标注集中在${tagText}，后面会主要参考它们的信息顺序、互动方式和真实语气。`,
    effectivePatterns: [
      `先给具体场景或选择，让读者立刻知道自己要判断什么。`,
      `再补背景、差异和理由，信息只围绕前面的判断展开。`,
      `用你的取舍或一个具体问题收住，让读者有明确回复点。`,
    ],
    featuredSnippets,
    userPreference: strongestReason
      ? `写初稿时保留真实复盘、互动称呼和具体情境，少写模板总结、硬广夸法和过满解释。你标注的“${strongestReason}”会影响开头、称呼和收尾。`
      : reasonLines.length > 0
        ? `写初稿时会参考这些偏好：${reasonLines.join('；')}。它们会影响开头、称呼和收尾。`
        : `写初稿时优先参考${tagText}里的表达方式，让内容更具体、更像真实场景、更少模板腔。`,
    reuseSuggestion: `写作路径：让读者先做判断 -> 补最关键事实 -> 说清你的取舍 -> 留一个能回复的问题。`,
    avoidPitfall: `空泛提问、硬广夸法、模板化总结，以及把所有卖点一次塞进第一屏。`,
    preferenceQuestion: `接下来写初稿时，你希望更偏互动感、真人复盘感，还是信息表达更直接？`,
    writingMove: `起手句模板：帮我选一下：{具体对象/方案}，我现在最纠结的是{真实取舍}。`,
    summary: `这轮选中的 ${noteCountText} 更适合按同一条节奏处理：先让读者判断，再补信息，最后用态度或互动收住。写初稿时会沿着这条路径走。`,
    wording: [
      `语气要像真实取舍，避开宣传稿口吻。句子可以短，但每句都要承担一个动作：让读者判断、理解或回应。`,
      `你圈选最多的标签集中在${tagText}，写初稿时会把这些标签落实到开头任务、称呼方式和收尾力度里。`,
      strongestSnippet
        ? `复用“${strongestSnippet}”这类句子时，重点保留它的进入动作，不照搬具体措辞。`
        : `写初稿时，继续保留“先拉人进场景，再补信息”的表达方式。`,
    ],
    structure: [
      `结构上使用“让读者先做判断 -> 补最关键事实 -> 说清你的取舍 -> 留一个能回复的问题”。`,
      `开头负责让读者判断“这和我有没有关系”；中段补必要信息；结尾用态度、提醒或互动收住。`,
      `后续初稿先搭这个顺序，再填具体卖点和表达细节。`,
    ],
    preference: [
      `当前偏好可以这样处理：保留情绪和态度，避开端着、过满、模板感。`,
      strongestReason
        ? `你标注的“${strongestReason}”会影响开头任务和收尾方式。`
        : secondReason
          ? `“${secondReason}”会影响互动关系的处理，避免把提问写成空泛寒暄。`
        : reasonLines.length > 0
          ? `你给出的理由会被整理成这些偏好：${reasonLines.join('；')}。`
          : `目前更适合保留顺口、留白和真实感，减少总结腔。`,
      `写初稿时先定语气边界，再展开具体内容。`,
    ],
    readerView: [
      `读者的停留点在第一屏：先知道自己能参与什么，再决定要不要看后面的信息。`,
      `信息不要一次讲满，第二步只补支撑判断的事实。`,
      `${noteTitles.length > 0 ? noteTitles.join('、') : '你当前选中的这些笔记'}可以按“先入场、再解释、再收束”的路径复用。`,
    ],
    nextStep: [
      '下一步先进入篇幅选择，再基于这份判断去搭结构化初稿。',
      '后面无论改框架还是逐句打磨，都会更稳。',
    ],
  }
}
