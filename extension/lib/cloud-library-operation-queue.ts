import type {
  FolderDto,
  NoteDto,
  SavedFolderRecord,
  SavedNoteRecord,
  TrashFolderGroup,
} from '@lumos-ai/shared'
import { normalizeLibraryNoteUrl } from './cloud-trash-reconcile'

export const CLOUD_LIBRARY_OPERATION_QUEUE_STORAGE_KEY = 'cloudLibraryOperationQueue'
export const CLOUD_RESOURCE_IDENTITIES_STORAGE_KEY = 'cloudResourceIdentities'

export type CloudLibraryOperationAction = 'delete' | 'restore' | 'rename'

export type CloudLibraryOperationTarget =
  | {
      type: 'folder'
      localId: string
      cloudId?: string
      name: string
      expectedUpdatedAt?: string
      noteSourceUrls: string[]
      renameTo?: string
    }
  | {
      type: 'note'
      localId: string
      cloudId?: string
      filename: string
      expectedUpdatedAt?: string
      sourceUrl: string
      renameTo?: string
    }

export type CloudLibraryOperationConflict = {
  cloudId: string
  resourceType: 'folder' | 'note'
  cloudName: string
  cloudUpdatedAt: string
  localName: string
}

export type CloudLibraryOperationJob = {
  id: string
  resourceKey: string
  userId: string
  action: CloudLibraryOperationAction
  target: CloudLibraryOperationTarget
  status: 'pending' | 'syncing' | 'failed' | 'conflict'
  attempts: number
  lastError: string
  conflict?: CloudLibraryOperationConflict
  updatedAt: string
}

export function isCloudLibraryOperationProcessable(job: CloudLibraryOperationJob) {
  return job.status === 'pending' || job.status === 'syncing'
}

type CloudLibraryOperationSnapshot = {
  folders: FolderDto[]
  notes: NoteDto[]
  trashGroups: TrashFolderGroup[]
}

export function createCloudFolderOperationTarget(
  folder: SavedFolderRecord,
  notes: SavedNoteRecord[],
): CloudLibraryOperationTarget {
  return {
    type: 'folder',
    localId: folder.id,
    cloudId: folder.cloudId,
    name: folder.name,
    ...(folder.cloudId ? { expectedUpdatedAt: folder.updatedAt } : {}),
    noteSourceUrls: notes
      .filter((note) => note.folderId === folder.id)
      .map((note) => note.sourceUrl),
  }
}

export function createCloudNoteOperationTarget(
  note: SavedNoteRecord,
): CloudLibraryOperationTarget {
  return {
    type: 'note',
    localId: note.id,
    cloudId: note.cloudId,
    filename: note.filename,
    ...(note.cloudId && note.updatedAt ? { expectedUpdatedAt: note.updatedAt } : {}),
    sourceUrl: note.sourceUrl,
  }
}

export function createCloudFolderRenameTarget(
  folder: SavedFolderRecord,
  notes: SavedNoteRecord[],
  renameTo: string,
): CloudLibraryOperationTarget {
  return {
    ...createCloudFolderOperationTarget(folder, notes),
    renameTo,
  }
}

export function createCloudNoteRenameTarget(
  note: SavedNoteRecord,
  renameTo: string,
): CloudLibraryOperationTarget {
  return {
    ...createCloudNoteOperationTarget(note),
    renameTo,
  }
}

export function getCloudLibraryResourceKey(
  userId: string,
  target: CloudLibraryOperationTarget,
) {
  return `${userId}:${target.type}:${target.localId}`
}

export function resolveCloudLibraryOperationCloudId(
  target: CloudLibraryOperationTarget,
  snapshot: CloudLibraryOperationSnapshot,
) {
  if (target.cloudId) return target.cloudId

  if (target.type === 'note') {
    const targetUrl = normalizeLibraryNoteUrl(target.sourceUrl)
    const candidateIds = new Set<string>()
    snapshot.notes.forEach((note) => {
      if (normalizeLibraryNoteUrl(note.sourceUrl) === targetUrl) candidateIds.add(note.id)
    })
    snapshot.trashGroups.forEach((group) => {
      group.notes.forEach((entry) => {
        if (normalizeLibraryNoteUrl(entry.note.sourceUrl) === targetUrl) {
          candidateIds.add(entry.note.id)
        }
      })
    })
    return candidateIds.size === 1 ? Array.from(candidateIds)[0] : null
  }

  const targetUrls = new Set(target.noteSourceUrls.map(normalizeLibraryNoteUrl).filter(Boolean))
  const candidateFolderIds = new Set<string>()
  snapshot.notes.forEach((note) => {
    if (targetUrls.has(normalizeLibraryNoteUrl(note.sourceUrl))) {
      candidateFolderIds.add(note.folderId)
    }
  })
  snapshot.trashGroups.forEach((group) => {
    if (
      group.folderDeleted &&
      group.notes.some((entry) =>
        targetUrls.has(normalizeLibraryNoteUrl(entry.note.sourceUrl)),
      )
    ) {
      candidateFolderIds.add(group.folderId)
    }
  })

  if (candidateFolderIds.size === 1) return Array.from(candidateFolderIds)[0]
  if (candidateFolderIds.size > 1) return null

  const nameCandidateIds = new Set<string>()
  snapshot.folders.forEach((folder) => {
    if (folder.name.trim() === target.name.trim()) nameCandidateIds.add(folder.id)
  })
  snapshot.trashGroups.forEach((group) => {
    if (group.folderDeleted && group.folderName.trim() === target.name.trim()) {
      nameCandidateIds.add(group.folderId)
    }
  })
  return nameCandidateIds.size === 1 ? Array.from(nameCandidateIds)[0] : null
}

export async function getCloudLibraryOperationQueue() {
  const storage = await chrome.storage.local.get(CLOUD_LIBRARY_OPERATION_QUEUE_STORAGE_KEY)
  return (
    (storage[CLOUD_LIBRARY_OPERATION_QUEUE_STORAGE_KEY] as
      | CloudLibraryOperationJob[]
      | undefined) ?? []
  )
}

export async function saveCloudLibraryOperationQueue(queue: CloudLibraryOperationJob[]) {
  await chrome.storage.local.set({
    [CLOUD_LIBRARY_OPERATION_QUEUE_STORAGE_KEY]: queue,
  })
}

export async function getRememberedCloudResourceId(resourceKey: string) {
  const storage = await chrome.storage.local.get(CLOUD_RESOURCE_IDENTITIES_STORAGE_KEY)
  const identities =
    (storage[CLOUD_RESOURCE_IDENTITIES_STORAGE_KEY] as Record<string, string> | undefined) ?? {}
  return identities[resourceKey] ?? null
}

export async function rememberCloudResourceId(resourceKey: string, cloudId: string) {
  const storage = await chrome.storage.local.get(CLOUD_RESOURCE_IDENTITIES_STORAGE_KEY)
  const identities =
    (storage[CLOUD_RESOURCE_IDENTITIES_STORAGE_KEY] as Record<string, string> | undefined) ?? {}
  await chrome.storage.local.set({
    [CLOUD_RESOURCE_IDENTITIES_STORAGE_KEY]: {
      ...identities,
      [resourceKey]: cloudId,
    },
  })
}
