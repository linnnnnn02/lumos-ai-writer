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
import { findReferenceReuseIssues } from '../src/skills/draft-v1/index.js'

loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
})

const folderId = 'folder-saturnbird-benchmark'
const folderName = '三顿半盲测'
const savedAt = '2026-08-01T08:20:00.000Z'
const usesRevealedTargetFacts =
  process.env.BENCHMARK_REVEALED_TARGET_FACTS === 'true'
const references = [
  {
    id: 'note-saturnbird-1',
    title: "Let's PONG! 为相聚和热爱碰杯",
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a4b1c08000000000f015746',
    contentText:
      '闹钟一响，翻身起床。\n比赛升级，快乐加码。\n激动人心的进球瞬间，当然要碰杯庆祝。\n\n世界碰杯，啤酒花风味限定咖啡，已就位。\n\nLet\'s PONG! 不止为比赛的胜负，此刻更为相聚和热爱「碰」杯！',
    selectedText:
      "Let's PONG! 不止为比赛的胜负，此刻更为相聚和热爱「碰」杯！",
    reasonText:
      '先借 PONG 的声音完成碰杯双关，再把比赛输赢转到相聚和热爱，品牌态度有转折但不说教。',
    colorTagName: '双关转折',
    colorValue: '#d97757',
  },
  {
    id: 'note-saturnbird-2',
    title: "Let's PONG! 世界「碰」杯",
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a447fc3000000000f01741f',
    contentText:
      '总有一些时刻，值得一起碰杯。\n\n绿茵赛场的哨声已吹响，满格热血氛围就位。与好友围坐在荧幕前，欢呼呐喊，举杯庆祝。\n\nCheers！不止为比赛的胜负，此刻更为相聚和热爱「碰」杯！\n\n世界碰杯，啤酒花风味限定礼盒，现已在「三顿半会员中心」开启订阅。',
    selectedText:
      '绿茵赛场的哨声已吹响，满格热血氛围就位。与好友围坐在荧幕前，欢呼呐喊，举杯庆祝。',
    reasonText:
      '用哨声、围坐、呐喊和举杯组成连续动作，先把读者带进共同看球的现场，再出现产品。',
    colorTagName: '场景推进',
    colorValue: '#d5a84b',
  },
  {
    id: 'note-saturnbird-3',
    title: '好戏开场，先来PONG个杯！',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a3ce361000000000f005cc1',
    contentText:
      '2026世界杯小组赛已进行到最后一轮，1/16决赛即将开始。\n\n你支持哪些球队？最期待谁的表现？早起看球你会做什么准备？\n\n广阔的绿茵赛场，足够容纳下无限的想象空间。终场哨响之前一切皆有可能。\n\n先PONG个杯，尽情享受这场夏日狂欢吧！',
    selectedText:
      '你支持哪些球队？最期待谁的表现？早起看球你会做什么准备？',
    reasonText:
      '连续三个具体问题让读者自然代入自己的看球习惯，互动来自真实情境，不是结尾突然求评论。',
    colorTagName: '情境提问',
    colorValue: '#5f9f87',
  },
  {
    id: 'note-saturnbird-4',
    title: '啤酒花风味限定咖啡，全新上市',
    sourceUrl:
      'https://www.xiaohongshu.com/explore/6a462e4c000000000f0290d5',
    contentText:
      '在欢聚时刻举杯，“PONG”的一声，有说有笑也有滋有味。\n\n当来自哥伦比亚景秀庄园的瑰夏碰上巴西日晒豆，就像喝下无酒精的精酿，一口回到热闹凉爽的盛夏夜晚。\n\nLet\'s PONG! 世界碰杯，啤酒花风味限定礼盒，7月6日全新上市。',
    selectedText:
      '当来自哥伦比亚景秀庄园的瑰夏碰上巴西日晒豆，就像喝下无酒精的精酿，一口回到热闹凉爽的盛夏夜晚。',
    reasonText:
      '先给出两种咖啡豆的事实，再用无酒精精酿解释风味，类比有产品依据，也继续服务“碰”的活动概念。',
    colorTagName: '产品类比',
    colorValue: '#8b7bb5',
  },
] as const

const notes = references.map((reference) => ({
  id: reference.id,
  folderId,
  folderName,
  filename: `${reference.title}.md`,
  title: reference.title,
  authorName: '三顿半',
  sourceUrl: reference.sourceUrl,
  contentText: reference.contentText,
  savedAt,
}))
const snippets = references.map((reference, index) => ({
  id: `snippet-saturnbird-${index + 1}`,
  noteUrl: reference.sourceUrl,
  noteTitle: reference.title,
  noteAuthorName: '三顿半',
  selectedText: reference.selectedText,
  reasonText: reference.reasonText,
  colorTagName: reference.colorTagName,
  colorValue: reference.colorValue,
  createdAt: savedAt,
}))

const analysisInput = analyzeReferencesRequestSchema.parse({
  projectName: '三顿半盲测：线下 PONG 个面',
  folderName,
  topic: '来线下 PONG 个面，亲手进一球',
  targetAudience: '关注世界杯、喜欢和朋友看球，也愿意参加品牌线下活动的年轻用户',
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
      mustInclude:
        '世界杯 1/4 决赛进行中；活动在三顿半空间；啤酒花风味限定咖啡礼盒已到店；返航计划回收的咖啡空罐被制成循环材料，再通过 3D 打印成为迷你球场；现场可以动手玩指尖足球；活动时间为 2026.7.6-7.20；邀请读者到店体验。',
      avoidTone:
        '不得补充具体城市、门店地址、报名方式、奖品、收费信息或目标原文未提供的规则；不要照抄目标原句，不要强行要求评论转发。',
      facts: [
        { id: 'match-stage', statement: '世界杯 1/4 决赛正在进行中。' },
        { id: 'location', statement: '线下活动发生在三顿半空间。' },
        {
          id: 'product-status',
          statement: '世界碰杯啤酒花风味限定咖啡礼盒已经到店。',
        },
        {
          id: 'material-process',
          statement:
            '返航计划先回收咖啡空罐，将空罐制成循环材料，再用该循环材料通过 3D 打印制成迷你球场；三个步骤的先后顺序不得改变。',
        },
        { id: 'interaction', statement: '到店后可以动手玩指尖足球。' },
        { id: 'date-range', statement: '活动时间是 2026.7.6-7.20。' },
      ],
    }
  : {
      mustInclude:
        '为三顿半 PONG 系列的一次线下见面活动写预告；邀请读者来线下见面并亲手完成一次进球互动；让“PONG”同时关联进球、碰面和碰杯。',
      avoidTone:
        '未提供城市、日期、场地、报名方式、奖品和具体活动规则，不得自行补充；不要虚构球星或比赛结果，不要使用泛化的热血口号，不要强行要求评论转发。',
      facts: [
        { id: 'offline', statement: '这是一次邀请读者线下见面的活动。' },
        { id: 'interaction', statement: '现场存在亲手完成进球的互动。' },
        {
          id: 'wordplay',
          statement: 'PONG 同时关联进球、碰面和碰杯，但具体装置和规则未知。',
        },
      ],
    }
const draftInput = generateDraftRequestSchema.parse({
  ...analysisInput,
  analysis: analyzed.analysis,
  brief,
})
const generated = await generateDraftWithDeepSeek(config, draftInput)

console.log(
  JSON.stringify(
    {
      inputDisclosure: {
        usesRevealedTargetFacts,
        usesRevealedTargetWording: false,
        targetTitle: analysisInput.topic,
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
