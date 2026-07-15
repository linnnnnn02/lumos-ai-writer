import type {
  AiRewriteResult,
  DraftBlockRecord,
  SavedSnippetRecord,
} from '@lumos-ai/shared'

type RewriteInput = {
  blocks: DraftBlockRecord[]
  snippets: SavedSnippetRecord[]
}

export function buildRewriteSuggestions(input: RewriteInput) {
  return input.blocks.map((block, index) => ({
    blockKey: block.key,
    blockTitle: block.title,
    discussion: [
      `如果你想保留这块的功能，当前更适合先稳住“${block.title}”的作用，再去细调语气。`,
      index === 0
        ? '这一块更像决定读者会不会继续看，所以后面改稿时建议优先动这里。'
        : '这一块可以先保留结构位置不变，只细改措辞和情绪强弱。',
    ],
    alternatives: [
      input.snippets[index]?.selectedText ||
        '这里可以换成更像真人顺口说出来的表达，不要一下子把信息说满。',
      input.snippets[index]?.reasonText ||
        '如果这一段改完还是太整齐，可以再往“更口语、更具体”方向压一轮。',
    ],
  }))
}

function replaceFirstCommaWithPause(value: string) {
  const commaIndex = value.search(/[，,；;]/)
  if (commaIndex < 0) return value
  return `${value.slice(0, commaIndex)}。${value.slice(commaIndex + 1).trim()}`
}

function softenSummaryLanguage(value: string) {
  return value
    .replace(/总的来说[，,]?/g, '')
    .replace(/归根结底[，,]?/g, '')
    .replace(/这让我明白了/g, '我开始留意到')
    .replace(/得出什么很大的结论/g, '急着给它一个结论')
    .replace(/只是让我更清楚/g, '下次再看看')
}

function makeConversational(value: string) {
  return value
    .replace(/但是/g, '不过')
    .replace(/因此/g, '所以')
    .replace(/我认为/g, '我觉得')
    .replace(/没有让我急着给它一个结论/g, '先不急着给它一个结论')
}

function softenTone(value: string) {
  return value
    .replace(/最适合/g, '更适合')
    .replace(/非常/g, '挺')
    .replace(/特别/g, '还挺')
    .replace(/一定会/g, '可能会')
    .replace(/更容易坚持下去/g, '下次出门也不会有太大压力')
    .replace(/强度不吓人/g, '强度也不会太为难新手')
}

export function buildFallbackSelectionRewrite(input: {
  selectedText: string
  instruction: string
}): AiRewriteResult {
  const selectedText = input.selectedText.trim()
  const instruction = input.instruction.trim()

  if (/不(?:要|用).*总结|自然.*(?:停|收)|(?:停|收).*自然|不.*上价值/.test(instruction)) {
    return {
      summary: `演示模式会优先响应“${instruction}”，并只调整圈选内容。`,
      suggestions: [
        {
          label: '自然停下',
          text: '先说到这里，剩下的等下一次真的遇到时再看。',
          rationale: '不急着给出结论，把停顿留给下一次真实发生的事。',
        },
        {
          label: '留点余地',
          text: '至于后面会怎么样，等下一次再说。',
          rationale: '像聊天一样暂时收住，不追加意义或统一判断。',
        },
        {
          label: '更轻一点',
          text: '下次再碰到这件事，我想看看自己会不会有新的感觉。',
          rationale: '用一个还没发生的小观察代替总结，让结尾保持开放。',
        },
      ],
      recommendedIndex: 0,
    }
  }

  const softened = softenSummaryLanguage(selectedText)
  const conversational = softenTone(makeConversational(softened))
  const paused = replaceFirstCommaWithPause(conversational)
  const candidates = [conversational, paused, softenTone(replaceFirstCommaWithPause(selectedText))]
  const uniqueCandidates = Array.from(
    new Set(candidates.filter((candidate) => candidate && candidate !== selectedText)),
  )

  while (uniqueCandidates.length < 3) {
    const fallback = uniqueCandidates.length === 0
      ? `${selectedText.replace(/[。！？]$/, '')}，先不把话说满。`
      : uniqueCandidates.length === 1
        ? replaceFirstCommaWithPause(`${selectedText.replace(/[。！？]$/, '')}，换个停顿再说。`)
        : `${selectedText.replace(/[。！？]$/, '')}，这句可以再轻一点。`
    if (!uniqueCandidates.includes(fallback)) uniqueCandidates.push(fallback)
    else uniqueCandidates.push(`先不急着说满：${selectedText}`)
  }

  return {
    summary: `演示模式会优先响应“${instruction}”，并只调整圈选内容。`,
    suggestions: [
      {
        label: '更自然',
        text: uniqueCandidates[0],
        rationale: '弱化总结口吻，让表达更像顺着前文说出来。',
      },
      {
        label: '有停顿',
        text: uniqueCandidates[1],
        rationale: '调整句子停顿，降低一口气把意思说满的感觉。',
      },
      {
        label: '更克制',
        text: uniqueCandidates[2],
        rationale: '尽量保留原意，只收紧语气和结尾力度。',
      },
    ],
    recommendedIndex: 0,
  }
}
