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

const folderId = 'folder-guanxia-benchmark'
const folderName = '观夏盲测'
const savedAt = '2026-08-01T06:30:00.000Z'
const references = [
  {
    id: 'note-guanxia-1',
    title: '棉花工坊，晨间三部曲',
    sourceUrl: 'https://www.xiaohongshu.com/explore/6a633f5d000000001c00c853',
    contentText:
      '走进「棉花工坊」，视线停留在素白瓷器之上，感受去除雕饰后，流淌本真之美的极简曲线。素棉织就的帷幔呈现与生俱来的白，与素胎白瓷的审美意趣同源，同是化繁为简、取于天然。\n\n跟随「常玉、棉花、白衬衫、白瓷」4 个关键词，回顾「裸」的创作历程。最后，在读书房稍作停留，取下一本读物，汲取「裸」的精神滋养。\n\n我们将「褪去修饰，回归本真」的留白体验，呈现于北京、上海两地的展览空间。步入棉花工坊，心自安顿。',
    selectedText:
      '我们将「褪去修饰，回归本真」的留白体验，呈现于北京、上海两地的展览空间。步入棉花工坊，心自安顿。',
    reasonText:
      '用一句具体的空间动作承接品牌主张，结尾只有四字感受，不解释、不号召，收得克制。',
    colorTagName: '克制收束',
    colorValue: '#d97757',
  },
  {
    id: 'note-guanxia-2',
    title: '白瓷，向天地借一抹本真',
    sourceUrl: 'https://www.xiaohongshu.com/explore/6a5f547d000000001f01eae3',
    contentText:
      '自宋代以来，匠人们提纯出梅瓶的素简线条：工坊里指尖捏塑，书斋中又眼光摩挲。千百年过去，它洗去繁缛，留下最本真的轮廓。\n\n我们爱着素胎白瓷梅瓶，它承载着古人对曲线之美超越时空的遐想。其身姿如远山起伏，又如人静卧，温柔下自有风骨。\n\n再提笔续写「裸」的历程，我们想，不必添新奇的器型，也无需再做复杂的定义，直接将那一缕曲线呈于你就好。如今，自景德镇寻来的这抹本真曲线，已落于「棉花工坊」展览空间中，静待你走近。',
    selectedText: '其身姿如远山起伏，又如人静卧，温柔下自有风骨。',
    reasonText:
      '比喻来自可见的器物曲线，先让读者看见形态，再落到人格感受；抽象判断有实物支点。',
    colorTagName: '具象比喻',
    colorValue: '#d5a84b',
  },
  {
    id: 'note-guanxia-3',
    title: '裸香氛洗护｜身穿一朵云',
    sourceUrl: 'https://www.xiaohongshu.com/explore/6a59dadd000000000f0098dc',
    contentText:
      '在阿克苏，很难想象有人与棉花无关。\n\n阿克苏在天山南麓，南望塔里木盆地。雪山、戈壁之间，留下一片丰饶的绿洲。棉花最早见于印度河流域，进入中国已有两千多年。那时，丝绸之路北道经过古龟兹，粟特商人、西域僧侣沿克孜尔河谷往来，带来香料、琉璃、葡萄，还有植物种子与耕种经验。棉花，便是其中之一。\n\n风吹过的时候，棉株轻轻晃动。远远看去，像一层浅浅的云，落在塔里木盆地边缘。\n\n「裸」全新香氛洗护系列中，我们加入新疆阿克苏棉籽精粹，其中的植物甾醇，由内帮助肌肤修护屏障，改善肌肤自主锁水能力；黄酮则由外发挥抗氧化作用，改善暗沉，令肌肤更匀净透亮。\n\n这一次，「裸」不只停留于香气，更让肌肤在日复一日的照料中，慢慢回到柔软、丰盈自在的状态。',
    selectedText:
      '风吹过的时候，棉株轻轻晃动。远远看去，像一层浅浅的云，落在塔里木盆地边缘。',
    reasonText:
      '用短动作和远景把原料写成画面，“浅浅的云”与洗护的柔软感自然相连，没有直接叫卖。',
    colorTagName: '物象画面',
    colorValue: '#5f9f87',
  },
  {
    id: 'note-guanxia-4',
    title: '裸｜四重肌肤感官仪式',
    sourceUrl: 'https://www.xiaohongshu.com/explore/6a58b8630000000013024731',
    contentText:
      '城市的夏天，总是倦怠。烈日、空调、酣睡反复交替，肌肤容易干燥、敏感，仿佛呼吸也覆上一层暑气。此时，宜为肌肤来一场云朵SPA。\n\n2026裸·全新香氛洗护系列，以原浆、凝脂、冷霜、雨雾四种绵柔质地，唤醒肌肤感知。让紧绷的身躯舒展，人也慢慢回归本真状态。\n\n全系加入核心成分「棉籽精粹」，取自新疆阿克苏棉花。春夏时节，纯净的天山雪水融入河谷，缓缓滋养绿洲。棉花吸收阳光，经漫长季节的积累，结成饱满的棉桃。人们取走洁白的纤维，也留下棉籽。那是植物孕育一季后，留下的养分，藏在果实深处。\n\n棉花以柔软回应土地，棉籽以丰盈润泽肌肤，它们都生于天然，也保留着原本的质地、气息与温度。\n\n「裸」所追寻的，亦是这份不加修饰的天然之美。在柔软之中，回归肌肤本真的状态。',
    selectedText:
      '棉花以柔软回应土地，棉籽以丰盈润泽肌肤，它们都生于天然，也保留着原本的质地、气息与温度。',
    reasonText:
      '先建立棉花、棉籽与土地的关系，再过渡到肌肤功效；排比服务于两组真实对象，不是空泛的修辞堆叠。',
    colorTagName: '事实递进',
    colorValue: '#8b7bb5',
  },
] as const

const notes = references.map((reference) => ({
  id: reference.id,
  folderId,
  folderName,
  filename: `${reference.title}.md`,
  title: reference.title,
  authorName: '观夏',
  sourceUrl: reference.sourceUrl,
  contentText: reference.contentText,
  savedAt,
}))
const snippets = references.map((reference, index) => ({
  id: `snippet-guanxia-${index + 1}`,
  noteUrl: reference.sourceUrl,
  noteTitle: reference.title,
  noteAuthorName: '观夏',
  selectedText: reference.selectedText,
  reasonText: reference.reasonText,
  colorTagName: reference.colorTagName,
  colorValue: reference.colorValue,
  createdAt: savedAt,
}))

const analysisInput = analyzeReferencesRequestSchema.parse({
  projectName: '观夏盲测：方寸展桌',
  folderName,
  topic: '方寸展桌，裸的变奏：借棉花工坊的展桌回顾「裸」的创作线索',
  targetAudience: '关注观夏香气、美学与创作故事的用户',
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
const draftInput = generateDraftRequestSchema.parse({
  ...analysisInput,
  analysis: analyzed.analysis,
  brief: {
    mustInclude:
      '以棉花工坊中的展桌为载体，回顾「裸」的创作线索；将「常玉、棉花、白衬衫、白瓷」只作为一组并列关键词，用来说明它们共同指向「裸」的创作脉络，不逐词展开。',
    avoidTone:
      '不要写成香氛洗护功效介绍。四个词只是回顾创作的关键词，不要把它们虚构成展桌上的具体陈设、画作、影像或动作；不要虚构年份、人物、创作年代或展览规则，不要促销和号召购买。',
    facts: [
      {
        id: 'table-role',
        statement: '棉花工坊中的展桌用于回顾「裸」的创作线索。',
      },
      {
        id: 'keyword-role',
        statement:
          '「常玉、棉花、白衬衫、白瓷」只是一组共同指向「裸」创作脉络的并列关键词，不代表展桌上的具体陈设。',
      },
    ],
  },
})
const generated = await generateDraftWithDeepSeek(config, draftInput)

console.log(
  JSON.stringify(
    {
      inputDisclosure: {
        usesRevealedTargetBody: false,
        topic: analysisInput.topic,
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
