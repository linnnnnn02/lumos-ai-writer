export const noteLearningStatuses = ['ready', 'pending_review', 'excluded'] as const

export type NoteLearningStatus = (typeof noteLearningStatuses)[number]

export const noteQualityFlags = [
  'content_too_short',
  'title_body_mismatch',
  'folder_content_mismatch',
] as const

export type NoteQualityFlag = (typeof noteQualityFlags)[number]

type NoteLearningQualityInput = {
  title: string
  contentText: string
  folderName?: string
}

const semanticDomains = {
  beauty: [
    '护肤',
    '精华',
    '面膜',
    '保湿',
    '补水',
    '防晒',
    '面霜',
    '水乳',
    '美妆',
    '上妆',
    '口红',
    '粉底',
    '皮肤',
    '毛孔',
  ],
  career: [
    '求职',
    '招聘',
    '面试',
    '简历',
    '校招',
    '应届',
    '岗位',
    '职场',
    'offer',
    '入职',
  ],
  cycling: ['骑行', '单车', '自行车', '骑车', '公路车', '山地车', '里程', '码表'],
  food: ['美食', '餐厅', '菜谱', '烹饪', '火锅', '咖啡', '烘焙', '奶茶'],
  parenting: ['母婴', '宝宝', '婴儿', '育儿', '幼儿园', '奶粉', '辅食'],
  technology: [
    '人工智能',
    '大模型',
    '数码',
    '手机',
    '电脑',
    '软件',
    '科技',
    '互联网',
    '芯片',
  ],
  travel: ['旅游', '旅行', '攻略', '酒店', '景点', '机票', '航班', '民宿'],
} as const

function normalizeSemanticText(value: string) {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function detectSemanticDomains(value: string) {
  const normalized = normalizeSemanticText(value)
  return new Set(
    Object.entries(semanticDomains)
      .filter(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)))
      .map(([domain]) => domain),
  )
}

function domainsConflict(first: Set<string>, second: Set<string>) {
  if (first.size === 0 || second.size === 0) return false
  return !Array.from(first).some((domain) => second.has(domain))
}

export function assessNoteLearningQuality(input: NoteLearningQualityInput): NoteQualityFlag[] {
  const title = input.title.trim()
  const contentText = input.contentText.trim()
  const folderName = input.folderName?.trim() ?? ''
  const flags: NoteQualityFlag[] = []

  if (normalizeSemanticText(contentText).length < 16) {
    flags.push('content_too_short')
  }

  const titleDomains = detectSemanticDomains(title)
  const contentDomains = detectSemanticDomains(contentText)
  if (domainsConflict(titleDomains, contentDomains)) {
    flags.push('title_body_mismatch')
  }

  const folderDomains = detectSemanticDomains(folderName)
  const noteDomains = detectSemanticDomains(`${title} ${contentText}`)
  if (domainsConflict(folderDomains, noteDomains)) {
    flags.push('folder_content_mismatch')
  }

  return flags
}

export function isNoteReadyForLearning(note: { learningStatus?: NoteLearningStatus }) {
  return (note.learningStatus ?? 'ready') === 'ready'
}
