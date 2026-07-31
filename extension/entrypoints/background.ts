import { defineBackground } from 'wxt/utils/define-background'
import { syncAnnotationToCloud } from '../lib/cloud-api'
import { getStoredCloudAccessToken } from '../lib/cloud-session'
import {
  getAnnotationCloudSyncQueue,
  saveAnnotationCloudSyncQueue,
  type AnnotationCloudSyncJob,
} from '../lib/cloud-sync-queue'

export default defineBackground(() => {
  type RuntimeMessage =
    | {
        type?: string
      }
    | {
        type: 'XHS_OPEN_SIDE_PANEL'
      }
    | {
        type: 'XHS_FETCH_NOTE_COVER'
        sourceUrl?: string
      }
    | {
        type: 'XHS_QUEUE_ANNOTATION_SYNC'
        job: Pick<AnnotationCloudSyncJob, 'id' | 'folder' | 'note' | 'snippet'>
      }
    | {
        type: 'XHS_RETRY_ANNOTATION_SYNC'
        jobId?: string
      }
    | {
        type: 'XHS_PROCESS_ANNOTATION_SYNC_QUEUE'
      }

  type FetchNoteCoverResponse =
    | {
        ok: true
        coverImageUrl: string
      }
    | {
        ok: false
        error: string
      }

  let queueMutationChain: Promise<void> = Promise.resolve()
  let queueProcessingPromise: Promise<void> | null = null

  function mutateSyncQueue<T>(
    mutation: (queue: AnnotationCloudSyncJob[]) => {
      queue: AnnotationCloudSyncJob[]
      value: T
    },
  ) {
    const operation = queueMutationChain.then(async () => {
      const queue = await getAnnotationCloudSyncQueue()
      const result = mutation(queue)
      await saveAnnotationCloudSyncQueue(result.queue)
      return result.value
    })

    queueMutationChain = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  async function enqueueAnnotationSync(
    input: Pick<AnnotationCloudSyncJob, 'id' | 'folder' | 'note' | 'snippet'>,
  ) {
    await mutateSyncQueue((queue) => ({
      queue: [
        ...queue.filter((job) => job.id !== input.id),
        {
          ...input,
          status: 'pending',
          attempts: 0,
          lastError: '',
          updatedAt: new Date().toISOString(),
        },
      ],
      value: undefined,
    }))
  }

  function claimNextAnnotationSync() {
    return mutateSyncQueue<AnnotationCloudSyncJob | null>((queue) => {
      const index = queue.findIndex((job) => job.status !== 'failed')
      if (index < 0) return { queue, value: null }

      const claimed = {
        ...queue[index],
        status: 'syncing' as const,
        attempts: queue[index].attempts + 1,
        updatedAt: new Date().toISOString(),
      }
      const nextQueue = [...queue]
      nextQueue[index] = claimed
      return { queue: nextQueue, value: claimed }
    })
  }

  async function completeAnnotationSync(jobId: string) {
    await mutateSyncQueue((queue) => ({
      queue: queue.filter((job) => job.id !== jobId),
      value: undefined,
    }))
  }

  async function failAnnotationSync(jobId: string, error: string) {
    await mutateSyncQueue((queue) => ({
      queue: queue.map((job) =>
        job.id === jobId
          ? {
              ...job,
              status: 'failed' as const,
              lastError: error,
              updatedAt: new Date().toISOString(),
            }
          : job,
      ),
      value: undefined,
    }))
  }

  async function processAnnotationSyncQueue() {
    while (true) {
      const job = await claimNextAnnotationSync()
      if (!job) return

      const token = await getStoredCloudAccessToken()
      if (!token) {
        await failAnnotationSync(job.id, '云端登录已过期，请在插件中重新登录。')
        continue
      }

      try {
        await syncAnnotationToCloud(token, job)
        await completeAnnotationSync(job.id)
      } catch (error) {
        await failAnnotationSync(
          job.id,
          error instanceof Error ? error.message : '网络异常，请稍后重试。',
        )
      }
    }
  }

  function startAnnotationSyncQueue() {
    if (queueProcessingPromise) return queueProcessingPromise
    queueProcessingPromise = processAnnotationSyncQueue().finally(() => {
      queueProcessingPromise = null
      void getAnnotationCloudSyncQueue().then((queue) => {
        if (queue.some((job) => job.status !== 'failed')) {
          void startAnnotationSyncQueue()
        }
      }).catch(() => undefined)
    })
    return queueProcessingPromise
  }

  async function retryAnnotationSync(jobId?: string) {
    await mutateSyncQueue((queue) => ({
      queue: queue.map((job) =>
        job.status === 'failed' && (!jobId || job.id === jobId)
          ? {
              ...job,
              status: 'pending' as const,
              lastError: '',
              updatedAt: new Date().toISOString(),
            }
          : job,
      ),
      value: undefined,
    }))
    void startAnnotationSyncQueue()
  }

  function cleanText(text: string | null | undefined) {
    return (text ?? '').replace(/\s+/g, ' ').trim()
  }

  function decodeHtmlText(text: string) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\\u002F/g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/\\u003D/g, '=')
      .replace(/\\\//g, '/')
  }

  function normalizeImageUrl(url: string, baseUrl: string) {
    const trimmed = cleanText(decodeHtmlText(url))
    if (!trimmed || trimmed.startsWith('data:image/svg') || trimmed.startsWith('blob:')) return ''
    if (trimmed.startsWith('//')) return `https:${trimmed}`

    try {
      const parsed = new URL(trimmed, baseUrl)
      if (parsed.protocol === 'http:' && /\.xhscdn\.com$/i.test(parsed.hostname)) {
        parsed.protocol = 'https:'
      }
      return parsed.href
    } catch {
      return ''
    }
  }

  function getHtmlAttribute(tag: string, name: string) {
    const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i')
    return decodeHtmlText(tag.match(pattern)?.[1] || '')
  }

  function extractMetaCoverImage(html: string, baseUrl: string) {
    const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
    for (const tag of metaTags) {
      const name = getHtmlAttribute(tag, 'property') || getHtmlAttribute(tag, 'name')
      if (!/^(og:image|og:image:url|twitter:image)$/i.test(name)) continue

      const coverImageUrl = normalizeImageUrl(getHtmlAttribute(tag, 'content'), baseUrl)
      if (coverImageUrl) return coverImageUrl
    }

    return ''
  }

  function collectImagesFromJsonLd(value: unknown): string[] {
    if (!value) return []
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap((item) => collectImagesFromJsonLd(item))
    if (typeof value !== 'object') return []

    const record = value as Record<string, unknown>
    return [
      ...collectImagesFromJsonLd(record.image),
      ...collectImagesFromJsonLd(record.thumbnailUrl),
      ...collectImagesFromJsonLd(record.url),
      ...collectImagesFromJsonLd(record.contentUrl),
    ]
  }

  function extractJsonLdCoverImage(html: string, baseUrl: string) {
    const scripts = html.match(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
    )

    for (const script of scripts ?? []) {
      const jsonText = decodeHtmlText(script.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, ''))
      try {
        const parsed = JSON.parse(jsonText) as unknown
        for (const candidate of collectImagesFromJsonLd(parsed)) {
          const coverImageUrl = normalizeImageUrl(candidate, baseUrl)
          if (coverImageUrl) return coverImageUrl
        }
      } catch {
        // JSON-LD is optional. If it is malformed, fallback regex extraction can still help.
      }
    }

    return ''
  }

  function extractInlineCoverImage(html: string, baseUrl: string) {
    const decodedHtml = decodeHtmlText(html)
    const candidates = decodedHtml.match(/https?:\/\/[^"'\\<>\s]+/gi) ?? []
    const imageCandidate = candidates.find((candidate) =>
      /(^https?:\/\/[^/]*xhscdn\.com\/|sns-webpic|image|cover|thumbnail|poster)/i.test(candidate),
    )

    return imageCandidate ? normalizeImageUrl(imageCandidate, baseUrl) : ''
  }

  function isSafeXhsSourceUrl(sourceUrl: string) {
    try {
      const parsed = new URL(sourceUrl)
      return parsed.protocol === 'https:' && /\.xiaohongshu\.com$/i.test(parsed.hostname)
    } catch {
      return false
    }
  }

  async function fetchNoteCover(sourceUrl: string): Promise<FetchNoteCoverResponse> {
    if (!isSafeXhsSourceUrl(sourceUrl)) {
      return { ok: false, error: '只支持小红书笔记链接。' }
    }

    try {
      const response = await fetch(sourceUrl, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) return { ok: false, error: `页面请求失败：${response.status}` }

      const html = await response.text()
      const coverImageUrl =
        extractMetaCoverImage(html, sourceUrl) ||
        extractJsonLdCoverImage(html, sourceUrl) ||
        extractInlineCoverImage(html, sourceUrl)

      return coverImageUrl
        ? { ok: true, coverImageUrl }
        : { ok: false, error: '没有从页面里找到封面。' }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '封面请求失败。',
      }
    }
  }

  async function enableSidePanelBehavior() {
    try {
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: true,
      })
    } catch (error) {
      console.warn('Failed to enable side panel behavior', error)
    }
  }

  async function openSidePanel(tabId?: number) {
    const sidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
      open?: (options: { tabId?: number; windowId?: number }) => Promise<void>
    }

    if (!sidePanel.open) return false

    try {
      if (tabId) {
        await sidePanel.open({ tabId })
        return true
      }

      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })

      if (activeTab?.id) {
        await sidePanel.open({ tabId: activeTab.id })
        return true
      }
    } catch (error) {
      console.warn('Failed to open side panel', error)
    }

    return false
  }

  chrome.runtime.onInstalled.addListener(() => {
    console.info('Lumos AI Writer extension installed')
    void enableSidePanelBehavior()
    void retryAnnotationSync()
  })

  chrome.runtime.onStartup?.addListener(() => {
    void enableSidePanelBehavior()
    void retryAnnotationSync()
  })

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === 'XHS_QUEUE_ANNOTATION_SYNC' && 'job' in message) {
      void enqueueAnnotationSync(message.job)
        .then(() => {
          sendResponse({ ok: true })
          void startAnnotationSyncQueue()
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : '无法加入同步队列。',
          })
        })
      return true
    }

    if (message.type === 'XHS_RETRY_ANNOTATION_SYNC') {
      const jobId = 'jobId' in message ? message.jobId : undefined
      void retryAnnotationSync(jobId)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : '无法重试云端同步。',
          })
        })
      return true
    }

    if (message.type === 'XHS_PROCESS_ANNOTATION_SYNC_QUEUE') {
      void startAnnotationSyncQueue()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : '无法处理云端同步队列。',
          })
        })
      return true
    }

    if (message.type === 'XHS_OPEN_SIDE_PANEL') {
      void openSidePanel(sender.tab?.id).then((ok) => {
        sendResponse({ ok })
      })
      return true
    }

    if (message.type === 'XHS_FETCH_NOTE_COVER') {
      const sourceUrl = 'sourceUrl' in message ? message.sourceUrl : ''
      void fetchNoteCover(sourceUrl || '').then(sendResponse)
      return true
    }
  })

  void startAnnotationSyncQueue()
})
