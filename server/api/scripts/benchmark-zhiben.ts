import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  aiAnalysisResultSchema,
  analyzeReferencesRequestSchema,
  generateDraftRequestSchema,
} from '@lumos-ai/shared'
import { config as loadEnv } from 'dotenv'
import {
  analyzeReferencesWithDeepSeek,
  generateDraftWithDeepSeek,
} from '../src/ai/deepseek.js'
import { readConfig } from '../src/env.js'
import {
  findReferenceReuseIssues,
  resolveDraftContentMode,
} from '../src/skills/draft-v1/index.js'

loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
})

const referenceSet = process.env.BENCHMARK_REFERENCE_SET ?? 'same'
const usesRevealedTargetFacts =
  process.env.BENCHMARK_REVEALED_TARGET_FACTS === 'true'
const requestedRuns = Number.parseInt(process.env.BENCHMARK_RUNS ?? '1', 10)
if (!['none', 'cross', 'same'].includes(referenceSet)) {
  throw new Error('BENCHMARK_REFERENCE_SET must be none, cross, or same.')
}
if (!Number.isInteger(requestedRuns) || requestedRuns < 1 || requestedRuns > 10) {
  throw new Error('BENCHMARK_RUNS must be an integer from 1 to 10.')
}

const folderId = 'folder-zhiben-product-education'
const savedAt = '2026-08-03T11:30:00.000Z'
const sameModeReferences = [
  {
    id: 'note-zhiben-product-1',
    title: '自然，净澈',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a1d44a40000000007020a34',
    contentText:
      '30℃自然结晶，泡沫细腻绵柔；既是清洁过程，亦是温和享受。\n\n#舒颜修护洁面乳',
    selectedText: '30℃自然结晶，泡沫细腻绵柔',
    reasonText:
      '先给出温度与结晶方式这一具体事实，再落到泡沫触感；质地感受有工艺支点，不是单独堆“温和”。',
    colorTagName: '事实转触感',
    colorValue: '#d97757',
  },
  {
    id: 'note-zhiben-product-2',
    title: '润而不腻',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a16a15c000000000702974a',
    contentText:
      '轻盈，顺滑，四季皆宜。\n\n#至本丰润滋养护唇膏',
    selectedText: '轻盈，顺滑，四季皆宜。',
    reasonText:
      '三个短判断分别回答使用负担、触感和季节范围，没有追加夸张结果；适合短视频配文快速交代产品定位。',
    colorTagName: '三点定位',
    colorValue: '#d5a84b',
  },
  {
    id: 'note-zhiben-product-3',
    title: '夏天的15分钟',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a16a1960000000008024d9d',
    contentText:
      '一种夏天也合适的乳霜质地；多重修护油脂封闭渗透，避免「过度水合」。敏弱肌可享的安稳修护体验。\n\n#特安修护密集面膜',
    selectedText:
      '一种夏天也合适的乳霜质地；多重修护油脂封闭渗透，避免「过度水合」。',
    reasonText:
      '先回应“夏天会不会厚重”的季节顾虑，再解释油脂与过度水合的关系；机制说明直接服务使用判断。',
    colorTagName: '顾虑转机制',
    colorValue: '#5f9f87',
  },
  {
    id: 'note-zhiben-product-4',
    title: '轻盈，唤醒',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a3cd313000000001102dbc3',
    contentText:
      '紧致淡纹，修护提亮；多维焕活肌肤光采。\n\n#至本多元优效精华露',
    selectedText: '紧致淡纹，修护提亮；多维焕活肌肤光采。',
    reasonText:
      '用分号把多个功效压成“具体改善方向—整体状态”的两层表达；只学习信息压缩，功效本身仍须当前 brief 逐条支持。',
    colorTagName: '功效压缩',
    colorValue: '#8b7bb5',
  },
] as const

const crossModeReferences = [
  {
    id: 'note-zhiben-campaign-1',
    title: '限时掉落 | 舒颜卸妆膏好礼派送',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a194894000000000803cc3f',
    contentText:
      '至本舒颜卸妆膏，全新翻盖设计，开合顺畅，取用更丝滑。延续植萃温和卸妆力，让卸妆过程更加轻松舒适。\n\n掉落时间：2026年6月1日-2026年6月7日。惊喜礼遇：200份全新舒颜卸妆膏正装随机掉落，1800份舒颜修护卸妆膏3ml*2试用装惊喜好礼。\n\n小红书站内搜索相关关键词，浏览相关笔记或前往活动话题页参与互动，即有机会触发惊喜盒子。只评论不会触发惊喜盒子。',
    selectedText:
      '掉落时间：2026年6月1日-2026年6月7日。惊喜礼遇：200份全新舒颜卸妆膏正装随机掉落。',
    reasonText:
      '活动文案先交代时间与奖品，再说明参与路径；这是活动通知的信息顺序，不应迁移到极短产品说明。',
    colorTagName: '活动路径',
    colorValue: '#d97757',
  },
  {
    id: 'note-zhiben-sustainability-1',
    title: '1个收纳筐≈4.3支空瓶',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a23ad24000000000702bff4',
    contentText:
      '你可能想知道，寄回的空瓶去了哪里？这一次，我们将回收的空瓶加工重塑，「摇身一变」成这只轻巧能装的收纳筐。可叠放、可折叠，两款经典拼色，满足日常桌面收纳需求。\n\n回收不是终点，每个收纳筐的背后，是约4.3支空瓶的循环复用，并减少约51.9g碳排放。让回收的空瓶，以新的方式继续陪伴你的日常。',
    selectedText:
      '回收不是终点，每个收纳筐的背后，是约4.3支空瓶的循环复用，并减少约51.9g碳排放。',
    reasonText:
      '用可核验数字解释循环价值，再落到日常用途；回收数据和叙事只属于环保内容，不能成为护肤产品事实。',
    colorTagName: '数据转价值',
    colorValue: '#5f9f87',
  },
  {
    id: 'note-zhiben-sustainability-2',
    title: '瓶生迎来重大转折',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a23ac360000000007020c39',
    contentText:
      '进入了「瓶行时空」的空瓶们，迎来了属于它们的命运转折点——我们将空瓶加工成粒子，塑成由70% PCR-PP（回收PP塑料）材质制成的收纳筐。经历瓶生转折的空瓶们，将会回到你的手中，经由折叠、展开，在桌面之上成为新的陪伴。6月8日，「桌面折叠收纳筐」正式登场。',
    selectedText:
      '经历瓶生转折的空瓶们，将会回到你的手中，经由折叠、展开，在桌面之上成为新的陪伴。',
    reasonText:
      '用拟人化承接材料再生过程；它适合环保叙事，但产品说明不能借用“命运、陪伴”等关系线补充事实。',
    colorTagName: '拟人叙事',
    colorValue: '#8b7bb5',
  },
] as const

const references =
  referenceSet === 'same'
    ? sameModeReferences
    : referenceSet === 'cross'
      ? crossModeReferences
      : []
const folderName =
  referenceSet === 'cross' ? '至本跨模式干扰参考' : '至本产品说明参考'

const allNotes = references.map((reference) => ({
  id: reference.id,
  folderId,
  folderName,
  filename: `${reference.title}.md`,
  title: reference.title,
  authorName: '至本',
  sourceUrl: reference.sourceUrl,
  contentText: reference.contentText,
  savedAt,
}))
const allSnippets = references.map((reference, index) => ({
  id: `snippet-zhiben-product-${index + 1}`,
  noteUrl: reference.sourceUrl,
  noteTitle: reference.title,
  noteAuthorName: '至本',
  selectedText: reference.selectedText,
  reasonText: reference.reasonText,
  colorTagName: reference.colorTagName,
  colorValue: reference.colorValue,
  createdAt: savedAt,
}))

const projectInput = {
  projectName: '至本盲测：炎燥季节，时时特安',
  topic: '炎燥季节，时时特安',
  targetAudience: '希望了解炎热季节护肤产品信息、重视温和与事实依据的用户',
  length: 'short' as const,
}
const config = readConfig({
  APP_ENV: 'local',
  AI_FEATURE_ENABLED: 'true',
  AI_PROVIDER_PRIMARY: 'deepseek',
})

const neutralAnalysis = aiAnalysisResultSchema.parse({
  projectName: projectInput.projectName,
  aiLearningMethod: {
    writingPath: '先交代季节问题，再写当前事实支持的产品信息和使用判断',
    reusableMechanisms: ['用事实解释产品与季节的关系'],
    styleConstraints: ['句长服从事实密度，不添加无依据功效'],
  },
  contentMode: {
    targetMode: 'product_education',
    confidence: 'medium',
    rationale: '标题与目标读者指向季节性护肤产品说明，但具体产品事实未知。',
    referenceModes: [],
    compatibleReferenceIds: [],
    excludedReferences: [],
    stableVoiceSignals: [],
    modeSpecificGuidance: {
      informationPriority: '先问题，再写功能或动作，随后落到可核实体验',
      interactionPattern: '不设置参与任务，只保留必要的使用判断',
      styleBoundary: '不补充未提供的成分、功效、肤质和使用步骤',
    },
  },
  surfaceStyle: {
    sentenceRhythm: '句长按事实密度自然变化',
    paragraphShape: '按问题与已知事实分段',
    punctuation: '使用自然中文标点',
    emotionalIntensity: '克制，不放大产品效果',
    interactionStyle: '默认不互动',
  },
  coreJudgement: '先写季节问题，只解释当前事实支持的产品关系',
  evidence: '无参考基线，只使用标题、封面和 brief。',
  effectivePatterns: [
    '开头点出炎热与干燥并存的季节处境',
    '中段只推进已知产品事实',
    '收尾停在可支持的使用判断',
  ],
  featuredSnippets: [],
  userPreference: '无参考偏好，使用中性产品说明方式。',
  reuseSuggestion: '围绕标题和原子事实组织正文。',
  avoidPitfall: '不要把封面氛围扩写成产品功效。',
  preferenceQuestion: '需要更多产品事实后再验证表达偏好。',
  writingMove: '先问题，再事实，信息说完即停止。',
  summary: '无参考产品说明基线。',
  wording: ['具体', '克制'],
  structure: ['问题', '事实', '判断'],
  preference: ['当前偏好待验证'],
  readerView: [projectInput.targetAudience],
  nextStep: ['根据 brief 写事实主线'],
})

const analyzed =
  referenceSet !== 'none'
    ? await analyzeReferencesWithDeepSeek(
        config,
        analyzeReferencesRequestSchema.parse({
          ...projectInput,
          folderName,
          notes: allNotes,
          snippets: allSnippets,
        }),
      )
    : null
const notes = allNotes
const snippets = allSnippets
const brief = usesRevealedTargetFacts
  ? {
      contentMode: 'auto' as const,
      mustInclude:
        '为至本特安系列的双产品组合写一篇极短配文；两件产品是特安修护密集面膜和特安修护密集精华液；在炎热、干燥并存的季节，表达两件产品配合使用带来的密集护理价值高于分别使用。',
      avoidTone:
        '不要照抄目标原句；未提供成分、配方、协同机制、使用顺序、使用时长、适用肤质、具体效果、临床数据、价格和购买方式，不得自行补充；不要把组合价值改写成双倍效果或确定性修复承诺。',
      facts: [
        {
          id: 'title-season',
          statement: '标题将炎热、干燥并存的季节处境与“特安”概念并置。',
          required: true,
        },
        {
          id: 'pair-name',
          statement: '这组双产品组合名为“特安双子星”。',
          required: true,
        },
        {
          id: 'pair-products',
          statement:
            '组合包含特安修护密集面膜和特安修护密集精华液。',
          required: true,
        },
        {
          id: 'combined-value',
          statement:
            '文案需要表达两件产品配合使用的密集护理价值高于分别使用。',
          required: true,
        },
        {
          id: 'cover-products',
          statement:
            '封面展示两件护肤产品，位于带水滴的模糊玻璃后。',
          required: false,
        },
      ],
    }
  : {
      contentMode: 'auto' as const,
      mustInclude:
        '围绕炎热、干燥并存的季节处境，为《炎燥季节，时时特安》写一篇短文案；可以提及封面中的两件护肤产品，但不能猜测产品类别或功效。',
      avoidTone:
        '未提供产品名、成分、配方、质地、功效、适用肤质、使用步骤、频次、价格和临床数据，不得自行补充；不要把水滴或模糊画面写成真实使用场景，不要写医疗或确定性修复承诺。',
      facts: [
        {
          id: 'title-season',
          statement: '标题将炎热、干燥并存的季节处境与“特安”概念并置。',
          required: true,
        },
        {
          id: 'cover-products',
          statement:
            '封面展示两件标签不可读的护肤产品，位于带水滴的模糊玻璃后。',
          required: false,
        },
      ],
    }
const draftInput = generateDraftRequestSchema.parse({
  ...projectInput,
  analysis: analyzed?.analysis ?? neutralAnalysis,
  notes,
  snippets,
  brief,
})
const contentModeResolution = resolveDraftContentMode(draftInput)

const emptyFillerPatterns = [
  /肌肤需要(?:更|一份)?(?:细致|温和|贴心|稳妥)?的?(?:关怀|呵护|照顾|应对)/,
  /(?:皮肤|肌肤)(?:易感不适|需要时时特安|需要安抚)/,
  /营造出.{0,12}(?:宁静|安静|舒适|安心)的?氛围/,
  /给肌肤(?:多|更)?一份(?:安心|安稳|呵护|照顾)/,
] as const
const unsupportedVisualPatterns = [
  /桌上|桌面上|摆在|摆放|静静|静置|静待探索|待在/,
  /天气越来越热|空气.{0,8}发紧/,
  /水滴.{0,8}(?:滑落|凝结)|玻璃.{0,8}(?:映出|隔开)/,
  /标签(?:模糊|不可读|难辨)|功效未知|难以辨认/,
] as const
const unsupportedBenefitPatterns = [
  /双倍(?:修护|护理|效果)|加倍(?:修护|护理|效果)/,
  /协同(?:修护|增效)|促进渗透|深层渗透/,
  /(?:补水|保湿|舒缓|抗炎|维稳|退红)(?:效果|功效|作用)?/,
] as const

function countPatternHits(text: string, patterns: readonly RegExp[]) {
  return patterns.filter((pattern) => pattern.test(text)).map(String)
}

const runs = []
for (let run = 1; run <= requestedRuns; run += 1) {
  try {
    const generated = await generateDraftWithDeepSeek(config, draftInput)
    const draftText = [generated.draft.title, ...generated.draft.body].join('\n')
    const benefitAuditText = draftText
      .replaceAll('特安修护密集面膜', '')
      .replaceAll('特安修护密集精华液', '')
    runs.push({
      run,
      status: 'success' as const,
      draft: generated.draft,
      bodyCharacters: Array.from(
        generated.draft.body.join('').replace(/\s/g, ''),
      ).length,
      emptyFillerHits: countPatternHits(draftText, emptyFillerPatterns),
      unsupportedVisualHits: countPatternHits(
        draftText,
        unsupportedVisualPatterns,
      ),
      unsupportedBenefitHits: countPatternHits(
        benefitAuditText,
        unsupportedBenefitPatterns,
      ),
      referenceReuseIssues: findReferenceReuseIssues(
        generated.draft,
        draftInput,
      ),
      usage: generated.usage,
    })
  } catch (error) {
    runs.push({
      run,
      status: 'failed' as const,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const successfulRuns = runs.filter((run) => run.status === 'success')
const failedRuns = runs.filter((run) => run.status === 'failed')
const totalMetricHits = (key: 'emptyFillerHits' | 'unsupportedVisualHits' | 'unsupportedBenefitHits') =>
  successfulRuns.reduce((total, run) => total + run[key].length, 0)

console.log(
  JSON.stringify(
    {
      inputDisclosure: {
        referenceSet,
        usesRevealedTargetFacts,
        usesRevealedTargetWording: false,
        usesTargetTitle: true,
        usesTargetCover: true,
        targetTitle: projectInput.topic,
        targetCover:
          '两件标签不可读的护肤产品，位于带水滴的模糊玻璃后',
        resolvedContentMode: contentModeResolution.resolvedMode,
        contentModeSource: contentModeResolution.modeSource,
        compatibleReferenceCount:
          contentModeResolution.compatibleReferenceIds.length,
      },
      analysis: analyzed ?? { analysis: neutralAnalysis, source: 'neutral_baseline' },
      stabilitySummary: {
        requestedRuns,
        successfulRuns: successfulRuns.length,
        failedRuns: failedRuns.length,
        pipelineSuccessRate: successfulRuns.length / requestedRuns,
        emptyFillerRuns: successfulRuns.filter(
          (run) => run.emptyFillerHits.length > 0,
        ).length,
        unsupportedVisualRuns: successfulRuns.filter(
          (run) => run.unsupportedVisualHits.length > 0,
        ).length,
        unsupportedBenefitRuns: successfulRuns.filter(
          (run) => run.unsupportedBenefitHits.length > 0,
        ).length,
        emptyFillerHits: totalMetricHits('emptyFillerHits'),
        unsupportedVisualHits: totalMetricHits('unsupportedVisualHits'),
        unsupportedBenefitHits: totalMetricHits('unsupportedBenefitHits'),
        bodyCharacterRange:
          successfulRuns.length > 0
            ? {
                min: Math.min(...successfulRuns.map((run) => run.bodyCharacters)),
                max: Math.max(...successfulRuns.map((run) => run.bodyCharacters)),
              }
            : null,
      },
      runs,
    },
    null,
    2,
  ),
)
