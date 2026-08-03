import { defineBackground } from 'wxt/utils/define-background'
import type { CurrentUser } from '@lumos-ai/shared'
import {
  getCloudLibrary,
  getCloudLibraryConflictResource,
  getCloudTrash,
  syncAnnotationToCloud,
  syncCloudLibraryOperation,
} from '../lib/cloud-api'
import {
  applyCloudAnnotationIdentity,
  applyCloudLibraryIdentitySnapshot,
} from '../lib/cloud-library-identity'
import {
  CLOUD_USER_STORAGE_KEY,
  getCloudStorageValue,
  getValidCloudAccessToken,
} from '../lib/cloud-session'
import {
  getCloudLibraryOperationQueue,
  getCloudLibraryResourceKey,
  getRememberedCloudResourceId,
  isCloudLibraryOperationProcessable,
  rememberCloudResourceId,
  resolveCloudLibraryOperationCloudId,
  saveCloudLibraryOperationQueue,
  type CloudLibraryOperationAction,
  type CloudLibraryOperationConflict,
  type CloudLibraryOperationJob,
  type CloudLibraryOperationTarget,
} from '../lib/cloud-library-operation-queue'
import {
  getAnnotationCloudSyncQueue,
  saveAnnotationCloudSyncQueue,
  type AnnotationCloudSyncJob,
} from '../lib/cloud-sync-queue'
import { applyCloudTrashSnapshot } from '../lib/cloud-trash-storage'

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
    | {
        type: 'XHS_REFRESH_CLOUD_TRASH'
      }
    | {
        type: 'XHS_QUEUE_CLOUD_LIBRARY_OPERATION'
        action: CloudLibraryOperationAction
        target: CloudLibraryOperationTarget
      }
    | {
        type: 'XHS_PROCESS_CLOUD_LIBRARY_OPERATION_QUEUE'
      }
    | {
        type: 'XHS_RETRY_CLOUD_LIBRARY_OPERATIONS'
      }
    | {
        type: 'XHS_RESOLVE_CLOUD_LIBRARY_CONFLICT'
        jobId: string
        resolution: 'accept-cloud' | 'keep-local'
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
  let cloudLibraryOperationMutationChain: Promise<void> = Promise.resolve()
  let cloudLibraryOperationProcessingPromise: Promise<void> | null = null
  let cloudTrashRefreshPromise: Promise<{
    authenticated: boolean
    deletedFolderCount: number
    deletedNoteCount: number
    restoredFolderCount: number
    restoredNoteCount: number
  }> | null = null

  function refreshCloudTrash() {
    if (cloudTrashRefreshPromise) return cloudTrashRefreshPromise

    cloudTrashRefreshPromise = (async () => {
      const token = await getValidCloudAccessToken()
      if (!token) {
        return {
          authenticated: false,
          deletedFolderCount: 0,
          deletedNoteCount: 0,
          restoredFolderCount: 0,
          restoredNoteCount: 0,
        }
      }

      const [trash, library, operationQueue, annotationQueue, user] = await Promise.all([
        getCloudTrash(token),
        getCloudLibrary(token).catch(() => null),
        getCloudLibraryOperationQueue(),
        getAnnotationCloudSyncQueue(),
        getCloudStorageValue<CurrentUser>(CLOUD_USER_STORAGE_KEY),
      ])
      if (library) {
        await applyCloudLibraryIdentitySnapshot(library, {
          pendingOperations: [
            ...operationQueue.filter(
              (job) => job.userId === user?.id && job.status !== 'conflict',
            ),
            ...annotationQueue.flatMap((job) => [
              ...(job.folder
                ? [
                    {
                      action: 'rename' as const,
                      target: { type: 'folder' as const, localId: job.folder.id },
                    },
                  ]
                : []),
              {
                action: 'rename' as const,
                target: { type: 'note' as const, localId: job.note.id },
              },
            ]),
          ],
        })
      }
      const result = await applyCloudTrashSnapshot(trash.groups, {
        library,
        pendingOperations: operationQueue.filter(
          (job) => job.userId === user?.id && job.status !== 'conflict',
        ),
      })
      return {
        authenticated: true,
        ...result,
      }
    })().finally(() => {
      cloudTrashRefreshPromise = null
    })

    return cloudTrashRefreshPromise
  }

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

      const token = await getValidCloudAccessToken()
      if (!token) {
        await failAnnotationSync(job.id, '云端登录已过期，请在插件中重新登录。')
        continue
      }

      try {
        const result = await syncAnnotationToCloud(token, job)
        await applyCloudAnnotationIdentity(job, result)
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

  function mutateCloudLibraryOperationQueue<T>(
    mutation: (queue: CloudLibraryOperationJob[]) => {
      queue: CloudLibraryOperationJob[]
      value: T
    },
  ) {
    const operation = cloudLibraryOperationMutationChain.then(async () => {
      const queue = await getCloudLibraryOperationQueue()
      const result = mutation(queue)
      await saveCloudLibraryOperationQueue(result.queue)
      return result.value
    })

    cloudLibraryOperationMutationChain = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  async function enqueueCloudLibraryOperation(
    action: CloudLibraryOperationAction,
    target: CloudLibraryOperationTarget,
  ) {
    const user = await getCloudStorageValue<CurrentUser>(CLOUD_USER_STORAGE_KEY)
    if (!user?.id) return false

    const resourceKey = getCloudLibraryResourceKey(user.id, target)
    const rememberedCloudId = await getRememberedCloudResourceId(resourceKey)
    const job: CloudLibraryOperationJob = {
      id: crypto.randomUUID(),
      resourceKey,
      userId: user.id,
      action,
      target: {
        ...target,
        cloudId: target.cloudId ?? rememberedCloudId ?? undefined,
      },
      status: 'pending',
      attempts: 0,
      lastError: '',
      updatedAt: new Date().toISOString(),
    }

    await mutateCloudLibraryOperationQueue((queue) => ({
      queue: [...queue.filter((entry) => entry.resourceKey !== resourceKey), job],
      value: undefined,
    }))
    return true
  }

  function claimNextCloudLibraryOperation() {
    return mutateCloudLibraryOperationQueue<CloudLibraryOperationJob | null>((queue) => {
      const index = queue.findIndex(isCloudLibraryOperationProcessable)
      if (index < 0) return { queue, value: null }

      const claimed: CloudLibraryOperationJob = {
        ...queue[index],
        status: 'syncing',
        attempts: queue[index].attempts + 1,
        updatedAt: new Date().toISOString(),
      }
      const nextQueue = [...queue]
      nextQueue[index] = claimed
      return { queue: nextQueue, value: claimed }
    })
  }

  async function completeCloudLibraryOperation(jobId: string) {
    await mutateCloudLibraryOperationQueue((queue) => ({
      queue: queue.filter((job) => job.id !== jobId),
      value: undefined,
    }))
  }

  async function updateCloudLibraryOperationIdentity(jobId: string, cloudId: string) {
    await mutateCloudLibraryOperationQueue((queue) => ({
      queue: queue.map((job) =>
        job.id === jobId
          ? {
              ...job,
              target: { ...job.target, cloudId },
              updatedAt: new Date().toISOString(),
            }
          : job,
      ),
      value: undefined,
    }))
  }

  async function deferCloudLibraryOperation(jobId: string, error: string) {
    await mutateCloudLibraryOperationQueue((queue) => ({
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

  async function failCloudLibraryOperation(jobId: string, error: string) {
    await mutateCloudLibraryOperationQueue((queue) => ({
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

  async function conflictCloudLibraryOperation(
    jobId: string,
    conflict: CloudLibraryOperationConflict,
  ) {
    await mutateCloudLibraryOperationQueue((queue) => ({
      queue: queue.map((job) =>
        job.id === jobId
          ? {
              ...job,
              status: 'conflict' as const,
              conflict,
              lastError: '名称已在另一台设备更新，请选择要保留的版本。',
              updatedAt: new Date().toISOString(),
            }
          : job,
      ),
      value: undefined,
    }))
  }

  async function resolveCloudLibraryConflict(
    jobId: string,
    resolution: 'accept-cloud' | 'keep-local',
  ) {
    const job = (await getCloudLibraryOperationQueue()).find(
      (entry) => entry.id === jobId && entry.status === 'conflict',
    )
    if (!job?.conflict) return false

    if (resolution === 'accept-cloud') {
      await completeCloudLibraryOperation(jobId)
      await refreshCloudTrash()
      return true
    }

    await mutateCloudLibraryOperationQueue((queue) => ({
      queue: queue.map((entry) =>
        entry.id === jobId
          ? {
              ...entry,
              target: {
                ...entry.target,
                expectedUpdatedAt: job.conflict?.cloudUpdatedAt,
              },
              status: 'pending' as const,
              conflict: undefined,
              lastError: '',
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
      value: undefined,
    }))
    await startCloudLibraryOperationQueue()
    return true
  }

  async function ensureRenameBaseVersion(
    job: CloudLibraryOperationJob,
    cloudId: string,
    token: string,
  ) {
    if (job.target.expectedUpdatedAt) return job.target.expectedUpdatedAt

    const library = await getCloudLibrary(token)
    const currentFolder =
      job.target.type === 'folder'
        ? library.folders.find((folder) => folder.id === cloudId)
        : undefined
    const currentNote =
      job.target.type === 'note'
        ? library.notes.find((note) => note.id === cloudId)
        : undefined
    const cloudName = currentFolder?.name ?? currentNote?.filename
    const cloudUpdatedAt = currentFolder?.updatedAt ?? currentNote?.updatedAt
    if (!cloudName || !cloudUpdatedAt) {
      await failCloudLibraryOperation(job.id, '无法确认云端名称版本，已停止同步。')
      return null
    }

    const originalName = job.target.type === 'folder' ? job.target.name : job.target.filename
    if (cloudName !== originalName) {
      await conflictCloudLibraryOperation(job.id, {
        cloudId,
        resourceType: job.target.type,
        cloudName,
        cloudUpdatedAt,
        localName: job.target.renameTo?.trim() || originalName,
      })
      await refreshCloudTrash().catch(() => undefined)
      return null
    }

    await mutateCloudLibraryOperationQueue((queue) => ({
      queue: queue.map((entry) =>
        entry.id === job.id
          ? {
              ...entry,
              target: { ...entry.target, expectedUpdatedAt: cloudUpdatedAt },
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
      value: undefined,
    }))
    return cloudUpdatedAt
  }

  async function processCloudLibraryOperationQueue() {
    while (true) {
      const job = await claimNextCloudLibraryOperation()
      if (!job) return

      const user = await getCloudStorageValue<CurrentUser>(CLOUD_USER_STORAGE_KEY)
      const token = await getValidCloudAccessToken()
      if (!user?.id || !token) {
        await deferCloudLibraryOperation(job.id, '云端登录已过期，请重新登录。')
        return
      }
      if (user.id !== job.userId) {
        await failCloudLibraryOperation(job.id, '登录账号已变更，未执行跨账号同步。')
        continue
      }

      try {
        let cloudId: string | null | undefined =
          job.target.cloudId ?? (await getRememberedCloudResourceId(job.resourceKey))
        if (!cloudId) {
          const [library, trash] = await Promise.all([
            getCloudLibrary(token),
            getCloudTrash(token),
          ])
          cloudId = resolveCloudLibraryOperationCloudId(job.target, {
            ...library,
            trashGroups: trash.groups,
          })
        }

        if (!cloudId) {
          await failCloudLibraryOperation(job.id, '无法唯一匹配云端对象，已停止同步。')
          continue
        }

        await rememberCloudResourceId(job.resourceKey, cloudId)
        await updateCloudLibraryOperationIdentity(job.id, cloudId)
        if (job.action === 'rename') {
          const renameTo = job.target.renameTo?.trim()
          if (!renameTo) {
            await failCloudLibraryOperation(job.id, '重命名内容为空，已停止同步。')
            continue
          }
          const expectedUpdatedAt = await ensureRenameBaseVersion(job, cloudId, token)
          if (!expectedUpdatedAt) continue
          if (job.target.type === 'folder') {
            await syncCloudLibraryOperation(token, {
              action: 'rename',
              resourceType: 'folder',
              cloudId,
              name: renameTo,
              expectedUpdatedAt,
            })
          } else {
            await syncCloudLibraryOperation(token, {
              action: 'rename',
              resourceType: 'note',
              cloudId,
              filename: renameTo,
              expectedUpdatedAt,
            })
          }
        } else {
          await syncCloudLibraryOperation(token, {
            action: job.action,
            resourceType: job.target.type,
            cloudId,
          })
        }
        await completeCloudLibraryOperation(job.id)
        if (job.action === 'rename') await refreshCloudTrash().catch(() => undefined)
      } catch (error) {
        const resource = getCloudLibraryConflictResource(error)
        if (resource && resource.type === job.target.type) {
          await conflictCloudLibraryOperation(job.id, {
            cloudId: resource.id,
            resourceType: resource.type,
            cloudName: resource.type === 'folder' ? resource.name : resource.filename,
            cloudUpdatedAt: resource.updatedAt,
            localName: job.target.renameTo?.trim() || '',
          })
          await refreshCloudTrash().catch(() => undefined)
          continue
        }
        await deferCloudLibraryOperation(
          job.id,
          error instanceof Error ? error.message : '网络异常，请稍后重试。',
        )
        return
      }
    }
  }

  function startCloudLibraryOperationQueue() {
    if (cloudLibraryOperationProcessingPromise) return cloudLibraryOperationProcessingPromise
    cloudLibraryOperationProcessingPromise = processCloudLibraryOperationQueue().finally(() => {
      cloudLibraryOperationProcessingPromise = null
      void getCloudLibraryOperationQueue()
        .then((queue) => {
          if (queue.some(isCloudLibraryOperationProcessable)) {
            void startCloudLibraryOperationQueue()
          }
        })
        .catch(() => undefined)
    })
    return cloudLibraryOperationProcessingPromise
  }

  async function retryCloudLibraryOperations() {
    await mutateCloudLibraryOperationQueue((queue) => ({
      queue: queue.map((job) =>
        job.status === 'failed'
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
    void startCloudLibraryOperationQueue()
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
    void retryCloudLibraryOperations()
    void refreshCloudTrash().catch(() => undefined)
  })

  chrome.runtime.onStartup?.addListener(() => {
    void enableSidePanelBehavior()
    void retryAnnotationSync()
    void retryCloudLibraryOperations()
    void refreshCloudTrash().catch(() => undefined)
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

    if (message.type === 'XHS_REFRESH_CLOUD_TRASH') {
      void refreshCloudTrash()
        .then((result) => {
          sendResponse({ ok: true, ...result })
          void retryCloudLibraryOperations()
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : '无法读取云端回收站。',
          })
        })
      return true
    }

    if (
      message.type === 'XHS_QUEUE_CLOUD_LIBRARY_OPERATION' &&
      'action' in message &&
      'target' in message
    ) {
      void enqueueCloudLibraryOperation(message.action, message.target)
        .then((queued) => {
          sendResponse({ ok: true, queued })
          if (queued) void startCloudLibraryOperationQueue()
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : '无法加入云端操作队列。',
          })
        })
      return true
    }

    if (message.type === 'XHS_PROCESS_CLOUD_LIBRARY_OPERATION_QUEUE') {
      void startCloudLibraryOperationQueue()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : '无法处理云端操作队列。',
          })
        })
      return true
    }

    if (message.type === 'XHS_RETRY_CLOUD_LIBRARY_OPERATIONS') {
      void retryCloudLibraryOperations()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : '无法重试云端操作。',
          })
        })
      return true
    }

    if (
      message.type === 'XHS_RESOLVE_CLOUD_LIBRARY_CONFLICT' &&
      'jobId' in message &&
      'resolution' in message
    ) {
      void resolveCloudLibraryConflict(message.jobId, message.resolution)
        .then((resolved) => sendResponse({ ok: true, resolved }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : '无法处理名称冲突。',
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
  void startCloudLibraryOperationQueue()
  void refreshCloudTrash().catch(() => undefined)
})
