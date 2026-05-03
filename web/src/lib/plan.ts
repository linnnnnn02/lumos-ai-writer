import type { DraftBlockRecord, ProjectLength, SavedSnippetRecord } from '@xhs-ai/shared'

type PlanInput = {
  topic: string
  targetAudience: string
  length: ProjectLength
  snippets: SavedSnippetRecord[]
}

const blockColors = ['#F1B24A', '#DD6C32', '#2A9D8F', '#4D78F2']

function getLengthHint(length: ProjectLength) {
  if (length === 'short') return '控制在轻量表达里，优先抓最强的一两个点。'
  if (length === 'medium') return '信息量够用，但不要写成说明书。'
  return '可以完整展开，但每一段都要有推进感。'
}

export function buildDemoPlan(input: PlanInput): DraftBlockRecord[] {
  const snippetExamples = input.snippets.slice(0, 3)

  return [
    {
      key: 'hook',
      title: 'A. 开头钩子',
      toneHint: `先把人拉进具体场景。${getLengthHint(input.length)}`,
      content:
        snippetExamples[0]?.selectedText ||
        `先用一个${input.targetAudience}会立刻有感受的问题或反差开场，不要直接讲完整结论。`,
      blockColor: blockColors[0],
    },
    {
      key: 'body',
      title: 'B. 主体展开',
      toneHint: '把信息拆成读者能顺着看下去的几步，而不是一次性堆满。',
      content:
        snippetExamples[1]?.selectedText ||
        `围绕“${input.topic}”展开主体内容，补充真实细节、选择理由、对比点或过程感。`,
      blockColor: blockColors[1],
    },
    {
      key: 'emotion',
      title: 'C. 情绪与态度',
      toneHint: '保留一点像真人说话的态度，不要太工整。',
      content:
        snippetExamples[2]?.reasonText ||
        '在主体后半段补上情绪态度或个人判断，让内容更像真实分享，而不是模板输出。',
      blockColor: blockColors[2],
    },
    {
      key: 'ending',
      title: 'D. 收尾',
      toneHint: '轻一点收束，给读者留互动空间。',
      content:
        '最后不要用总结腔收尾，可以落在提问、邀请讨论、轻提醒，或者一个自然的个人结论上。',
      blockColor: blockColors[3],
    },
  ]
}
