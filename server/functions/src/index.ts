import { z } from 'zod'
import { projectLengths, type DraftBlockRecord } from '@lumos-ai/shared'

const projectBriefSchema = z.object({
  topic: z.string().min(1),
  targetAudience: z.string().min(1),
  desiredLength: z.enum(projectLengths),
})

export interface GenerateDraftInput {
  topic: string
  targetAudience: string
  desiredLength: 'short' | 'medium' | 'long'
}

export function validateProjectBrief(input: GenerateDraftInput) {
  return projectBriefSchema.parse(input)
}

export function buildDraftOutline(input: GenerateDraftInput): DraftBlockRecord[] {
  const { topic, targetAudience, desiredLength } = validateProjectBrief(input)

  return [
    {
      key: 'hook',
      title: '开头钩子',
      toneHint: '用一个能让人继续读下去的问题或反差开场',
      content: `围绕“${topic}”提出一个让 ${targetAudience} 有共鸣的开场。`,
    },
    {
      key: 'core',
      title: '核心内容',
      toneHint: `控制在 ${desiredLength} 篇幅对应的主体长度内，优先写真实场景和具体感受`,
      content: '把经验、观察、步骤或观点写具体，少用空话。',
    },
    {
      key: 'ending',
      title: '结尾收束',
      toneHint: '避免总结腔，尽量像真人自然收尾',
      content: '用轻一点的语气收束，并给读者留下行动或讨论空间。',
    },
  ]
}

