import type { SavedFolderRecord, SavedNoteRecord, SavedSnippetRecord } from '@lumos-ai/shared'

export const ANNOTATION_SYNC_QUEUE_STORAGE_KEY = 'annotationCloudSyncQueue'

export type AnnotationCloudSyncJob = {
  id: string
  status: 'pending' | 'syncing' | 'failed'
  folder: SavedFolderRecord | null
  note: SavedNoteRecord
  snippet: SavedSnippetRecord
  attempts: number
  lastError: string
  updatedAt: string
}

export async function getAnnotationCloudSyncQueue() {
  const storage = await chrome.storage.local.get(ANNOTATION_SYNC_QUEUE_STORAGE_KEY)
  return (
    (storage[ANNOTATION_SYNC_QUEUE_STORAGE_KEY] as AnnotationCloudSyncJob[] | undefined) ?? []
  )
}

export async function saveAnnotationCloudSyncQueue(queue: AnnotationCloudSyncJob[]) {
  await chrome.storage.local.set({
    [ANNOTATION_SYNC_QUEUE_STORAGE_KEY]: queue,
  })
}
