import type {
  FolderDto,
  NoteDto,
  SavedFolderRecord,
  SavedNoteRecord,
  SyncAnnotationResponse,
} from '@lumos-ai/shared'
import { normalizeLibraryNoteUrl } from './cloud-trash-reconcile'

const FOLDERS_STORAGE_KEY = 'savedFolders'
const NOTES_STORAGE_KEY = 'savedNotes'

export type CloudLibraryIdentityPlan = {
  folders: Array<{ localId: string; cloudId: string }>
  notes: Array<{ localId: string; cloudId: string }>
}

type CloudLibrarySnapshot = {
  folders: FolderDto[]
  notes: NoteDto[]
}

export function buildCloudLibraryIdentityPlan(
  localFolders: SavedFolderRecord[],
  localNotes: SavedNoteRecord[],
  cloud: CloudLibrarySnapshot,
): CloudLibraryIdentityPlan {
  const cloudNotesByUrl = new Map<string, NoteDto[]>()
  cloud.notes.forEach((note) => {
    const url = normalizeLibraryNoteUrl(note.sourceUrl)
    if (!url) return
    cloudNotesByUrl.set(url, [...(cloudNotesByUrl.get(url) ?? []), note])
  })

  const noteMatches = localNotes.flatMap((note) => {
    if (note.cloudId && cloud.notes.some((cloudNote) => cloudNote.id === note.cloudId)) {
      return [{ localId: note.id, cloudId: note.cloudId }]
    }

    const matches = cloudNotesByUrl.get(normalizeLibraryNoteUrl(note.sourceUrl)) ?? []
    return matches.length === 1 ? [{ localId: note.id, cloudId: matches[0].id }] : []
  })
  const cloudNoteIdByLocalId = new Map(
    noteMatches.map((match) => [match.localId, match.cloudId]),
  )
  const cloudNoteById = new Map(cloud.notes.map((note) => [note.id, note]))

  const folderMatches = localFolders.flatMap((folder) => {
    if (folder.cloudId && cloud.folders.some((cloudFolder) => cloudFolder.id === folder.cloudId)) {
      return [{ localId: folder.id, cloudId: folder.cloudId }]
    }

    const matchedCloudFolderIds = new Set(
      localNotes
        .filter((note) => note.folderId === folder.id)
        .map((note) => cloudNoteIdByLocalId.get(note.id))
        .filter((cloudNoteId): cloudNoteId is string => Boolean(cloudNoteId))
        .map((cloudNoteId) => cloudNoteById.get(cloudNoteId)?.folderId)
        .filter((cloudFolderId): cloudFolderId is string => Boolean(cloudFolderId)),
    )

    if (matchedCloudFolderIds.size === 1) {
      return [{ localId: folder.id, cloudId: Array.from(matchedCloudFolderIds)[0] }]
    }
    if (matchedCloudFolderIds.size > 1) return []

    const nameMatches = cloud.folders.filter(
      (cloudFolder) => cloudFolder.name.trim() === folder.name.trim(),
    )
    return nameMatches.length === 1
      ? [{ localId: folder.id, cloudId: nameMatches[0].id }]
      : []
  })

  return {
    folders: folderMatches,
    notes: noteMatches,
  }
}

export async function applyCloudLibraryIdentitySnapshot(cloud: CloudLibrarySnapshot) {
  const storage = await chrome.storage.local.get([FOLDERS_STORAGE_KEY, NOTES_STORAGE_KEY])
  const folders = (storage[FOLDERS_STORAGE_KEY] as SavedFolderRecord[] | undefined) ?? []
  const notes = (storage[NOTES_STORAGE_KEY] as SavedNoteRecord[] | undefined) ?? []
  const plan = buildCloudLibraryIdentityPlan(folders, notes, cloud)
  const folderCloudIdByLocalId = new Map(
    plan.folders.map((match) => [match.localId, match.cloudId]),
  )
  const noteCloudIdByLocalId = new Map(plan.notes.map((match) => [match.localId, match.cloudId]))
  let updatedFolderCount = 0
  let updatedNoteCount = 0

  const nextFolders = folders.map((folder) => {
    const cloudId = folderCloudIdByLocalId.get(folder.id)
    if (!cloudId || cloudId === folder.cloudId) return folder
    updatedFolderCount += 1
    return { ...folder, cloudId }
  })
  const nextNotes = notes.map((note) => {
    const cloudId = noteCloudIdByLocalId.get(note.id)
    if (!cloudId || cloudId === note.cloudId) return note
    updatedNoteCount += 1
    return { ...note, cloudId }
  })

  if (updatedFolderCount > 0 || updatedNoteCount > 0) {
    await chrome.storage.local.set({
      [FOLDERS_STORAGE_KEY]: nextFolders,
      [NOTES_STORAGE_KEY]: nextNotes,
    })
  }

  return { updatedFolderCount, updatedNoteCount }
}

export async function applyCloudAnnotationIdentity(
  local: {
    folder: SavedFolderRecord | null
    note: SavedNoteRecord
  },
  cloud: SyncAnnotationResponse,
) {
  const storage = await chrome.storage.local.get([FOLDERS_STORAGE_KEY, NOTES_STORAGE_KEY])
  const folders = (storage[FOLDERS_STORAGE_KEY] as SavedFolderRecord[] | undefined) ?? []
  const notes = (storage[NOTES_STORAGE_KEY] as SavedNoteRecord[] | undefined) ?? []
  const noteUrl = normalizeLibraryNoteUrl(local.note.sourceUrl)

  await chrome.storage.local.set({
    [FOLDERS_STORAGE_KEY]: folders.map((folder) =>
      local.folder && folder.id === local.folder.id
        ? { ...folder, cloudId: cloud.folder.id }
        : folder,
    ),
    [NOTES_STORAGE_KEY]: notes.map((note) =>
      note.id === local.note.id || normalizeLibraryNoteUrl(note.sourceUrl) === noteUrl
        ? { ...note, cloudId: cloud.note.id }
        : note,
    ),
  })
}
