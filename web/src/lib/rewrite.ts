import type { DraftBlockRecord, SavedSnippetRecord } from '@xhs-ai/shared'

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
