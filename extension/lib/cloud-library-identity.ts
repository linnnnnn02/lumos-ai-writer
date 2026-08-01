import type {
  FolderDto,
  NoteDto,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  SyncAnnotationResponse,
} from '@lumos-ai/shared'
import { normalizeLibraryNoteUrl } from './cloud-trash-reconcile'

const FOLDERS_STORAGE_KEY = 'savedFolders'
const NOTES_STORAGE_KEY = 'savedNotes'
const SNIPPETS_STORAGE_KEY = 'savedSnippets'

export type CloudLibraryIdentityPlan = {
  folders: Array<{ localId: string; cloudId: string }>
  notes: Array<{ localId: string; cloudId: string }>
}

type CloudLibrarySnapshot = {
  folders: FolderDto[]
  notes: NoteDto[]
}

type PendingCloudLibraryOperation = {
  action: 'delete' | 'restore' | 'rename'
  target: {
    type: 'folder' | 'note'
    localId: string
  }
}

type ApplyCloudLibraryIdentityOptions = {
  pendingOperations?: PendingCloudLibraryOperation[]
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

export async function applyCloudLibraryIdentitySnapshot(
  cloud: CloudLibrarySnapshot,
  options: ApplyCloudLibraryIdentityOptions = {},
) {
  const storage = await chrome.storage.local.get([
    FOLDERS_STORAGE_KEY,
    NOTES_STORAGE_KEY,
    SNIPPETS_STORAGE_KEY,
  ])
  const folders = (storage[FOLDERS_STORAGE_KEY] as SavedFolderRecord[] | undefined) ?? []
  const notes = (storage[NOTES_STORAGE_KEY] as SavedNoteRecord[] | undefined) ?? []
  const snippets = (storage[SNIPPETS_STORAGE_KEY] as SavedSnippetRecord[] | undefined) ?? []
  const plan = buildCloudLibraryIdentityPlan(folders, notes, cloud)
  const folderCloudIdByLocalId = new Map(
    plan.folders.map((match) => [match.localId, match.cloudId]),
  )
  const noteCloudIdByLocalId = new Map(plan.notes.map((match) => [match.localId, match.cloudId]))
  const localFolderIdByCloudId = new Map(
    plan.folders.map((match) => [match.cloudId, match.localId]),
  )
  const cloudFolderById = new Map(cloud.folders.map((folder) => [folder.id, folder]))
  const cloudNoteById = new Map(cloud.notes.map((note) => [note.id, note]))
  const protectedFolderIds = new Set(
    (options.pendingOperations ?? [])
      .filter((operation) => operation.action === 'rename' && operation.target.type === 'folder')
      .map((operation) => operation.target.localId),
  )
  const protectedNoteIds = new Set(
    (options.pendingOperations ?? [])
      .filter((operation) => operation.action === 'rename' && operation.target.type === 'note')
      .map((operation) => operation.target.localId),
  )
  let updatedFolderCount = 0
  let updatedNoteCount = 0
  let updatedSnippetCount = 0

  const nextFolders = folders.map((folder) => {
    const cloudId = folderCloudIdByLocalId.get(folder.id)
    if (!cloudId) return folder
    const cloudFolder = cloudFolderById.get(cloudId)
    const protectRename = protectedFolderIds.has(folder.id)
    const nextFolder = {
      ...folder,
      cloudId,
      ...(!protectRename && cloudFolder
        ? { name: cloudFolder.name, updatedAt: cloudFolder.updatedAt }
        : {}),
    }
    if (
      nextFolder.cloudId === folder.cloudId &&
      nextFolder.name === folder.name &&
      nextFolder.updatedAt === folder.updatedAt
    ) {
      return folder
    }
    updatedFolderCount += 1
    return nextFolder
  })
  const nextNotes = notes.map((note) => {
    const cloudId = noteCloudIdByLocalId.get(note.id)
    if (!cloudId) return note
    const cloudNote = cloudNoteById.get(cloudId)
    if (!cloudNote) return note
    const localFolderId = localFolderIdByCloudId.get(cloudNote.folderId) ?? note.folderId
    const protectNoteRename = protectedNoteIds.has(note.id)
    const protectFolderRename = protectedFolderIds.has(localFolderId)
    const cloudFolderName = cloudFolderById.get(cloudNote.folderId)?.name || cloudNote.folderName
    const nextNote = {
      ...note,
      cloudId,
      folderId: localFolderId,
      ...(!protectFolderRename && cloudFolderName ? { folderName: cloudFolderName } : {}),
      ...(!protectNoteRename
        ? {
            filename: cloudNote.filename,
            title: cloudNote.title,
            ...(cloudNote.updatedAt ? { updatedAt: cloudNote.updatedAt } : {}),
          }
        : {}),
    }
    if (
      nextNote.cloudId === note.cloudId &&
      nextNote.folderId === note.folderId &&
      nextNote.folderName === note.folderName &&
      nextNote.filename === note.filename &&
      nextNote.title === note.title &&
      nextNote.updatedAt === note.updatedAt
    ) {
      return note
    }
    updatedNoteCount += 1
    return nextNote
  })
  const cloudNoteCandidatesByUrl = new Map<string, NoteDto[]>()
  cloud.notes.forEach((note) => {
    const url = normalizeLibraryNoteUrl(note.sourceUrl)
    if (!url) return
    cloudNoteCandidatesByUrl.set(url, [...(cloudNoteCandidatesByUrl.get(url) ?? []), note])
  })
  const cloudNoteByUrl = new Map(
    Array.from(cloudNoteCandidatesByUrl.entries()).flatMap(([url, candidates]) =>
      candidates.length === 1 ? [[url, candidates[0]] as const] : [],
    ),
  )
  const nextSnippets = snippets.map((snippet) => {
    const cloudNote = cloudNoteByUrl.get(normalizeLibraryNoteUrl(snippet.noteUrl))
    if (!cloudNote || snippet.noteTitle === cloudNote.title) return snippet
    updatedSnippetCount += 1
    return { ...snippet, noteTitle: cloudNote.title }
  })

  if (updatedFolderCount > 0 || updatedNoteCount > 0 || updatedSnippetCount > 0) {
    await chrome.storage.local.set({
      [FOLDERS_STORAGE_KEY]: nextFolders,
      [NOTES_STORAGE_KEY]: nextNotes,
      [SNIPPETS_STORAGE_KEY]: nextSnippets,
    })
  }

  return { updatedFolderCount, updatedNoteCount, updatedSnippetCount }
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
        ? {
            ...note,
            cloudId: cloud.note.id,
            filename: cloud.note.filename,
            title: cloud.note.title,
            ...(cloud.note.updatedAt ? { updatedAt: cloud.note.updatedAt } : {}),
          }
        : note,
    ),
  })
}
