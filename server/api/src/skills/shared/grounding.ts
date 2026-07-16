const numericClaimPattern =
  /(?:\d+(?:\.\d+)?(?:%|％|分钟|小时|天|周|月|年|公里|千米|米|元|倍|成|次)?|[零〇一二两三四五六七八九十百千万亿]+(?:%|％|分钟|小时|天|周|月|年|公里|千米|米|元|倍|成|次))/g
const numericClaimTokenPattern = new RegExp(`^(?:${numericClaimPattern.source})$`)

// Grammar and editorial vocabulary may be new; concrete nouns and actions may not.
const sharedNonMaterialTerms = new Set([
  '所以',
  '不过',
  '但是',
  '其实',
  '只是',
  '而且',
  '然后',
  '如果',
  '要是',
  '因为',
  '反正',
  '可能',
  '也许',
  '大概',
  '可以',
  '需要',
  '不用',
  '不要',
  '没有',
  '已经',
  '现在',
  '这样',
  '那样',
  '这个',
  '那个',
  '这些',
  '那些',
  '一些',
  '一点',
  '一下',
  '自己',
  '觉得',
  '来说',
  '就是',
  '也就',
  '就不',
  '真的',
  '确实',
  '比较',
  '更像',
  '的话',
  '时候',
  '之后',
  '之前',
  '最后',
  '开始',
  '继续',
  '慢慢',
  '仍然',
  '依然',
  '自然',
  '直接',
  '简单',
  '轻松',
  '清楚',
  '明白',
  '不好',
  '心里',
  '摸清',
  '好像',
  '没关系',
  '下次',
  '说到',
  '这里',
  '再说',
  '再看',
  '看看',
  '先不',
  '还是',
])

const readerInstructionTerms = new Set([
  '补充',
  '删除',
  '删去',
  '调整',
  '改写',
  '改成',
  '重排',
  '保留',
  '弱化',
  '加强',
  '突出',
  '说明',
  '明确',
  '核实',
  '避免',
  '减少',
  '增加',
  '收回',
  '对应',
  '表达',
  '描述',
  '语气',
  '句子',
  '内容',
  '信息',
  '细节',
  '读者',
  '建议',
  '方法',
  '结论',
  '风险',
  '逻辑',
  '衔接',
  '开头',
  '结尾',
  '标题',
  '段落',
  '此处',
  '这句',
  '其中',
  '保持',
  '定性',
  '真实',
  '条件',
  '条件式',
  '修改',
  '方向',
  '出现',
  '克制',
  '前文',
  '原文',
  '已有',
  '动作',
  '判断',
  '意义',
  '生活',
  '成长',
  '力度',
  '追加',
  '用户',
  '目标',
  '问题',
  '概括',
  '具体',
  '数据',
  '一段',
  '这类',
  '何时',
  '不变',
])

const riskySingleCharacterTerms = new Set([
  '买',
  '卖',
  '吃',
  '喝',
  '跑',
  '逛',
  '睡',
  '穿',
  '戴',
  '拿',
  '扔',
  '拍',
  '赚',
  '省',
  '赔',
  '查',
  '吹',
  '慢',
  '风',
  '雨',
  '雪',
  '海',
  '山',
  '店',
  '钱',
  '票',
  '药',
  '酒',
  '茶',
  '饭',
])

const removablePrefixes = /^(?:再|先|更|多|也|不|没|很|最|真|就|只|还|会|能|可|要|想|让|把|被|给|去|来)+/
const removableSuffixes = /(?:了|着|过|一下|一点|起来|下来|出去|回来)$/

type MaterialGroundingMode = 'rewrite' | 'reader-instruction'

function isGroundedTerm(term: string, groundingSource: string) {
  if (groundingSource.includes(term)) return true

  const withoutPrefix = term.replace(removablePrefixes, '')
  const core = withoutPrefix.replace(removableSuffixes, '')
  return core.length > 0 && core !== term && groundingSource.includes(core)
}

export function findUnsupportedMaterialTerms(
  candidate: string,
  groundingSource: string,
  mode: MaterialGroundingMode,
) {
  const normalizedSource = groundingSource.toLowerCase()
  const allowedTerms =
    mode === 'reader-instruction'
      ? new Set([...sharedNonMaterialTerms, ...readerInstructionTerms])
      : sharedNonMaterialTerms
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  const unsupported = new Set<string>()

  for (const part of segmenter.segment(candidate)) {
    if (!part.isWordLike) continue
    const term = part.segment.trim().toLowerCase()
    if (!term || numericClaimTokenPattern.test(term)) continue
    if (allowedTerms.has(term) || isGroundedTerm(term, normalizedSource)) continue

    const length = Array.from(term).length
    if (length >= 2 || riskySingleCharacterTerms.has(term)) unsupported.add(term)
  }

  return Array.from(unsupported)
}

export function findUnsupportedNumericClaims(
  candidate: string,
  groundingSource: string,
) {
  const groundedClaims = new Set(groundingSource.match(numericClaimPattern) ?? [])
  return Array.from(new Set(candidate.match(numericClaimPattern) ?? []))
    .filter((claim) => !groundedClaims.has(claim))
}
