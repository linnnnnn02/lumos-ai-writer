import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
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

const folderId = 'folder-bananain-benchmark'
const folderName = '蕉内活动互动盲测'
const savedAt = '2026-08-01T09:30:00.000Z'
const usesRevealedTargetFacts =
  process.env.BENCHMARK_REVEALED_TARGET_FACTS === 'true'
const references = [
  {
    id: 'note-bananain-1',
    title: '暂停看球 看我！🙋',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a549b090000000017029e8b',
    contentText:
      '夏日足球狂欢倒计时⏳\n比赛看一场，少一场\n现在先暂停一会比赛🤚\n\n看看阿蕉和好朋友\n@飞科  @雪花啤酒勇闯天涯  @上好佳\n一起为大家准备的「看球大礼包」！\n\n💬参与方式：🐷+💗+💬+⭐\n🍎分享你的独家看球姿势\n⏰活动时间：7月13日-7月21日\n*通过小🍊序【@我们爱抽奖 】\n\n👌1⃣️送「看球大礼包」\n一起陪你看到决赛～',
    selectedText:
      '看看阿蕉和好朋友\n@飞科  @雪花啤酒勇闯天涯  @上好佳\n一起为大家准备的「看球大礼包」！\n\n💬参与方式：🐷+💗+💬+⭐\n🍎分享你的独家看球姿势',
    reasonText:
      '用“阿蕉和好朋友”把多品牌联名说成人与人的邀约；奖品与参与动作紧接出现，信息密但仍像账号本人招呼大家。',
    colorTagName: '阿蕉邀约',
    colorValue: '#d97757',
  },
  {
    id: 'note-bananain-2',
    title: '奖池还在叠加😆',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a44bf5d000000000f0149eb',
    contentText:
      '「竞猜第三弹‼」又来押题咯\n199积分能兑______元优惠券？\n\n#蕉内',
    selectedText:
      '「竞猜第三弹‼」又来押题咯\n199积分能兑______元优惠券？',
    reasonText:
      '先用连续活动编号制造追更感，再把核心互动压成一道留空题；“又来押题咯”比正式活动口令轻很多。',
    colorTagName: '竞猜钩子',
    colorValue: '#d5a84b',
  },
  {
    id: 'note-bananain-3',
    title: '这把送分题😎',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a438b8c0000000011006e53',
    contentText:
      '「竞猜第二弹！！」我猜猜猜\n剪影中的会员节赠品是什么？\n\n#蕉内',
    selectedText:
      '「竞猜第二弹！！」我猜猜猜\n剪影中的会员节赠品是什么？',
    reasonText:
      '“我猜猜猜”把品牌也放进游戏里，随后只留一个可直接回答的问题；不解释规则，让评论动作几乎没有门槛。',
    colorTagName: '低门槛互动',
    colorValue: '#5f9f87',
  },
  {
    id: 'note-bananain-4',
    title: '阿蕉掐指一算🤔️',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a43272a000000001603fb9d',
    contentText:
      '会员节将至\n积分抵现功能即将上线\n先卖个关子，让大家猜猜看\n\n「竞猜第一弹！！」一起来押个答案\n会员节期间，_____积分抵现1元？💰\n\n#蕉内',
    selectedText:
      '先卖个关子，让大家猜猜看\n\n「竞猜第一弹！！」一起来押个答案\n会员节期间，_____积分抵现1元？💰',
    reasonText:
      '先把尚未公布的信息变成“卖个关子”，再用“押个答案”发起竞猜；语气有一点俏皮，但问题和利益点都清楚。',
    colorTagName: '悬念转互动',
    colorValue: '#8b7bb5',
  },
] as const

const notes = references.map((reference) => ({
  id: reference.id,
  folderId,
  folderName,
  filename: `${reference.title}.md`,
  title: reference.title,
  authorName: 'Bananain蕉内',
  sourceUrl: reference.sourceUrl,
  contentText: reference.contentText,
  savedAt,
}))
const snippets = references.map((reference, index) => ({
  id: `snippet-bananain-${index + 1}`,
  noteUrl: reference.sourceUrl,
  noteTitle: reference.title,
  noteAuthorName: 'Bananain蕉内',
  selectedText: reference.selectedText,
  reasonText: reference.reasonText,
  colorTagName: reference.colorTagName,
  colorValue: reference.colorValue,
  createdAt: savedAt,
}))

const analysisInput = analyzeReferencesRequestSchema.parse({
  projectName: '蕉内盲测：今天还熬夜看球吗',
  folderName,
  topic: '今天还熬夜看球吗？⚽️',
  targetAudience: '最近持续熬夜看球、会关注主队赛况，也在意穿着体感的年轻用户',
  length: 'short',
  notes,
  snippets,
})
const config = readConfig({
  APP_ENV: 'local',
  AI_FEATURE_ENABLED: 'true',
  AI_PROVIDER_PRIMARY: 'deepseek',
})
const analyzed = await analyzeReferencesWithDeepSeek(config, analysisInput)
const brief = usesRevealedTargetFacts
  ? {
      contentMode: 'auto' as const,
      mustInclude:
        '为一场世界杯半决赛联名熬夜看球活动写短文案；比赛在今天凌晨 3 点；蕉内与飞科、雪花啤酒勇闯天涯、上好佳邀请读者一起看比赛；请读者预测哪位 10 号球员会成为冠军；说明参与互动后会抽取 1 人获得看球礼包。',
      avoidTone:
        '不要照抄目标原文；不得补充未提供的具体比赛结果、冠军、球员、抽奖截止时间、开奖时间、资格限制或额外奖品；不要把封面袜子强行写成活动主角。',
      facts: [
        {
          id: 'month-context',
          statement: '读者已经经历了大约一个月的熬夜看球。',
          required: true,
        },
        {
          id: 'semifinal-time',
          statement: '今天凌晨 3 点有一场世界杯半决赛。',
          required: true,
        },
        {
          id: 'partner-invitation',
          statement:
            '蕉内与飞科、雪花啤酒勇闯天涯、上好佳一起邀请读者熬夜看比赛。',
          required: true,
        },
        {
          id: 'prediction',
          statement: '活动请读者预测哪位 10 号球员会成为冠军。',
          required: true,
        },
        {
          id: 'participation',
          statement: '参与动作包含关注、点赞、评论和收藏。',
          required: true,
        },
        {
          id: 'winner',
          statement: '活动会抽取 1 人获得看球礼包。',
          required: true,
        },
        {
          id: 'gift-bundle',
          statement:
            '看球礼包包含蕉内氮气 520Dry 男士速干球衣短袖短裤家居服、飞科往复式便携剃须刀、12 听勇闯天涯啤酒和上好佳足球佳油包。',
          required: false,
        },
        {
          id: 'cover-products',
          statement:
            '视觉素材展示四双足球主题袜子，使用不同球队感的配色，其中可见 10 号元素。',
          required: false,
        },
      ],
    }
  : {
      contentMode: 'auto' as const,
      mustInclude:
        '围绕近期持续熬夜看球和主队去留写一篇短文案；可以用一个不预设答案的具体问题与读者互动。',
      avoidTone:
        '没有提供赛事名称、比赛阶段、具体球队、球员、日期、袜子型号、材质、价格、功能、授权关系、活动规则和购买方式，不得自行补充；不得断言读者的主队已晋级或已淘汰；不要写成赛事解说或电商叫卖。',
      facts: [
        {
          id: 'watching-context',
          statement: '目标读者最近可能持续熬夜看球，但具体持续时间因人而异。',
          required: true,
        },
        {
          id: 'team-status',
          statement: '读者支持的球队是否仍在比赛中未知，只能以问题表达。',
          required: true,
        },
        {
          id: 'cover-products',
          statement:
            '视觉素材展示四双足球主题袜子，使用不同球队感的配色，其中可见 10 号元素。',
          required: false,
        },
      ],
    }
const draftInput = generateDraftRequestSchema.parse({
  ...analysisInput,
  analysis: analyzed.analysis,
  brief,
})
const contentModeResolution = resolveDraftContentMode(draftInput)
const generated = await generateDraftWithDeepSeek(config, draftInput)

console.log(
  JSON.stringify(
    {
      inputDisclosure: {
        usesRevealedTargetFacts,
        usesRevealedTargetWording: false,
        usesTargetTitle: true,
        usesTargetCover: true,
        targetTitle: analysisInput.topic,
        contentMode: draftInput.brief.contentMode,
        resolvedContentMode: contentModeResolution.resolvedMode,
        contentModeSource: contentModeResolution.modeSource,
        referenceSelectionSource:
          contentModeResolution.referenceSelectionSource,
        compatibleReferenceCount:
          contentModeResolution.compatibleReferenceIds.length,
        mustInclude: draftInput.brief.mustInclude,
        avoidTone: draftInput.brief.avoidTone,
      },
      analysis: analyzed,
      draft: generated,
      referenceReuseIssues: findReferenceReuseIssues(generated.draft, draftInput),
    },
    null,
    2,
  ),
)
