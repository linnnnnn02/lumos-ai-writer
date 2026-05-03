import type { SavedFolderRecord, SavedNoteRecord, SavedSnippetRecord } from '@xhs-ai/shared'

function makeDemoCover(lines: string[], background: string, accent: string) {
  const textLines = lines
    .map(
      (line, index) =>
        `<text x="96" y="${460 + index * 112}" font-size="74" font-weight="760" fill="#34404a">${line}</text>`,
    )
    .join('')

  return `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1080">
      <rect width="900" height="1080" fill="${background}"/>
      <text x="96" y="190" font-size="150" font-weight="800" fill="${accent}" opacity="0.55">“</text>
      ${textLines}
      <rect x="720" y="980" width="58" height="12" rx="6" fill="${accent}" opacity="0.62"/>
    </svg>
  `)}`
}

export const demoFolders: SavedFolderRecord[] = [
  {
    id: 'default-folder-beauty',
    name: '护肤口播感',
    noteCount: 3,
    updatedAt: '2026-04-30T12:00:00.000Z',
  },
  {
    id: 'default-folder-lifestyle',
    name: '生活方式笔记',
    noteCount: 2,
    updatedAt: '2026-04-30T13:30:00.000Z',
  },
  {
    id: 'folder-tech',
    name: '数码科技',
    noteCount: 2,
    updatedAt: '2026-04-30T15:00:00.000Z',
  },
]

export const demoNotes: SavedNoteRecord[] = [
  {
    id: 'note-1',
    folderId: 'default-folder-beauty',
    folderName: '护肤口播感',
    filename: '帮我选选！小红书评审团！',
    title: '帮我选选！小红书评审团！',
    authorName: '桔点设计商店',
    sourceUrl: 'https://www.xiaohongshu.com/explore/69f321120000000000000001',
    coverImageUrl: makeDemoCover(['帮我选选！', '小红书评审团！'], '#d8f4ff', '#8fd8ee'),
    contentText:
      '帮我选选！小红书评审团！N200消光白的实拍图，在各位股东热情的关怀中样品已马上排产，只差最后一步，就是选壳子的颜色。',
    savedAt: '2026-04-30T21:03:09.000Z',
  },
  {
    id: 'note-2',
    folderId: 'default-folder-beauty',
    folderName: '护肤口播感',
    filename: '现在ai发展这么快，但是还是很多应届生在找互联网的工作',
    title: '现在ai发展这么快，但是还是很多应届生在找互联网的工作',
    authorName: '小木鱼 22',
    sourceUrl: 'https://www.xiaohongshu.com/explore/69f321120000000000000002',
    coverImageUrl: makeDemoCover(['随手一发', '这么多人赞'], '#f3eedf', '#e7c27a'),
    contentText:
      '900人赞过的深圳市区骑行路线，没想到随手一发能有这么多网友赞，高频问题其实不是打通的环线，而是深圳什么季节更适合骑。',
    savedAt: '2026-04-30T21:17:00.000Z',
  },
  {
    id: 'note-3',
    folderId: 'folder-tech',
    folderName: '数码科技',
    filename: 'N200白色实拍到底值不值得发',
    title: 'N200白色实拍到底值不值得发',
    authorName: '桔点设计商店',
    sourceUrl: 'https://www.xiaohongshu.com/explore/69f321120000000000000003',
    coverImageUrl: makeDemoCover(['第一屏到底', '放颜值还是卖点'], '#e7f5ec', '#a8d8bc'),
    contentText:
      '如果你也在发产品笔记，第一屏到底放颜值还是卖点，其实决定了读者会不会继续停留。',
    savedAt: '2026-04-30T18:48:00.000Z',
  },
]

export const demoSnippets: SavedSnippetRecord[] = [
  {
    id: 'snippet-1',
    noteUrl: 'https://www.xiaohongshu.com/explore/69f321120000000000000001',
    noteTitle: '帮我选选！小红书评审团！',
    noteAuthorName: '桔点设计商店',
    selectedText: '只差最后一步，就是选壳子的颜色。',
    colorTagName: '开头钩子',
    colorValue: '#2A9D8F',
    reasonText: '一句话就把用户带进投票情境里，很自然。',
    createdAt: '2026-04-30T21:05:00.000Z',
  },
  {
    id: 'snippet-2',
    noteUrl: 'https://www.xiaohongshu.com/explore/69f321120000000000000001',
    noteTitle: '帮我选选！小红书评审团！',
    noteAuthorName: '桔点设计商店',
    selectedText: '在各位股东热情的关怀中样品已马上排产',
    colorTagName: '整体调性',
    colorValue: '#DD6C32',
    reasonText: '把用户叫成股东，互动感很强，也不油。',
    createdAt: '2026-04-30T21:06:00.000Z',
  },
  {
    id: 'snippet-3',
    noteUrl: 'https://www.xiaohongshu.com/explore/69f321120000000000000002',
    noteTitle: '现在ai发展这么快，但是还是很多应届生在找互联网的工作',
    noteAuthorName: '小木鱼 22',
    selectedText: '没想到随手一发能有这么多网友赞',
    colorTagName: '语气',
    colorValue: '#4D78F2',
    reasonText: '像真人在复盘，不像为了写而写。',
    createdAt: '2026-04-30T21:18:00.000Z',
  },
]
