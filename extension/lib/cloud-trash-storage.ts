import type {
  FolderDto,
  NoteDto,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  TrashFolderGroup,
} from '@lumos-ai/shared'
import {
  buildCloudTrashDeletionPlan,
  buildCloudTrashRestorationPlan,
  normalizeLibraryNoteUrl,
  type CloudTrashReconciliationProtection,
  type CloudTrashRestoration,
} from './cloud-trash-reconcile'
import type { TrashItem } from './storage'

const FOLDERS_STORAGE_KEY = 'savedFolders'
const NOTES_STORAGE_KEY = 'savedNotes'
const SNIPPETS_STORAGE_KEY = 'savedSnippets'
const TRASH_STORAGE_KEY = 'trashItems'
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

type CloudLibrarySnapshot = {
  folders: FolderDto[]
  notes: NoteDto[]
}

type PendingCloudLibraryOperation = {
  action: 'delete' | 'restore'
  target: {
    type: 'folder' | 'note'
    localId: string
  }
}

type ApplyCloudTrashSnapshotOptions = {
  library?: CloudLibrarySnapshot | null
  pendingOperations?: PendingCloudLibraryOperation[]
}

function createDefaultFolders(now: string): SavedFolderRecord[] {
  return [
    { id: 'default-folder-beauty', name: '护肤口播感', noteCount: 0, updatedAt: now },
    { id: 'default-folder-lifestyle', name: '生活方式笔记', noteCount: 0, updatedAt: now },
  ]
}

function isFreshTrashItem(item: TrashItem, now: number) {
  const deletedAt = new Date(item.deletedAt).getTime()
  return Number.isFinite(deletedAt) && now - deletedAt < TRASH_RETENTION_MS
}

function reconcileFolderNoteCounts(
  folders: SavedFolderRecord[],
  notes: SavedNoteRecord[],
) {
  const counts = new Map<string, number>()
  notes.forEach((note) => {
    if (!note.folderId) return
    counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1)
  })

  return folders.map((folder) => ({
    ...folder,
    noteCount: counts.get(folder.id) ?? 0,
  }))
}

function buildReconciliationProtection(
  pendingOperations: PendingCloudLibraryOperation[],
): CloudTrashReconciliationProtection {
  const protection: Required<CloudTrashReconciliationProtection> = {
    deletingFolderIds: [],
    deletingNoteIds: [],
    restoringFolderIds: [],
    restoringNoteIds: [],
  }

  pendingOperations.forEach((operation) => {
    const key = `${operation.action === 'delete' ? 'deleting' : 'restoring'}${
      operation.target.type === 'folder' ? 'FolderIds' : 'NoteIds'
    }` as keyof CloudTrashReconciliationProtection
    protection[key].push(operation.target.localId)
  })

  return protection
}

function findCloudNote(
  note: SavedNoteRecord,
  cloudNotes: NoteDto[],
  folderId?: string,
) {
  if (note.cloudId) {
    return cloudNotes.find((cloudNote) => cloudNote.id === note.cloudId) ?? null
  }

  const noteUrl = normalizeLibraryNoteUrl(note.sourceUrl)
  if (!noteUrl) return null
  const candidates = cloudNotes.filter(
    (cloudNote) =>
      (!folderId || cloudNote.folderId === folderId) &&
      normalizeLibraryNoteUrl(cloudNote.sourceUrl) === noteUrl,
  )
  return candidates.length === 1 ? candidates[0] : null
}

function applyCloudRestorations(
  folders: SavedFolderRecord[],
  notes: SavedNoteRecord[],
  snippets: SavedSnippetRecord[],
  trashItems: TrashItem[],
  restorations: CloudTrashRestoration[],
  library: CloudLibrarySnapshot,
) {
  const nextFolders = [...folders]
  const nextNotes = [...notes]
  const nextSnippets = [...snippets]
  const restoredItemIds = new Set<string>()
  const appliedRestorations: CloudTrashRestoration[] = []

  function ensureFolder(
    candidate: SavedFolderRecord | null,
    cloudFolder: FolderDto,
  ) {
    const existingIndex = nextFolders.findIndex(
      (folder) =>
        folder.id === candidate?.id ||
        folder.id === cloudFolder.id ||
        folder.cloudId === cloudFolder.id,
    )
    const restoredFolder: SavedFolderRecord = {
      ...(existingIndex >= 0
        ? nextFolders[existingIndex]
        : candidate ?? {
            id: cloudFolder.id,
            noteCount: 0,
          }),
      cloudId: cloudFolder.id,
      name: cloudFolder.name,
      updatedAt: cloudFolder.updatedAt,
    }

    if (existingIndex >= 0) nextFolders[existingIndex] = restoredFolder
    else nextFolders.unshift(restoredFolder)
    return restoredFolder
  }

  function restoreNote(
    localNote: SavedNoteRecord,
    folder: SavedFolderRecord,
    cloudNote: NoteDto | null,
  ) {
    const noteUrl = normalizeLibraryNoteUrl(localNote.sourceUrl)
    const existingIndex = nextNotes.findIndex(
      (note) =>
        note.id === localNote.id ||
        Boolean(cloudNote && note.cloudId === cloudNote.id) ||
        (noteUrl && normalizeLibraryNoteUrl(note.sourceUrl) === noteUrl),
    )
    const restoredNote: SavedNoteRecord = {
      ...(existingIndex >= 0 ? nextNotes[existingIndex] : localNote),
      ...(cloudNote ? { cloudId: cloudNote.id } : {}),
      folderId: folder.id,
      folderName: folder.name,
    }

    if (existingIndex >= 0) nextNotes[existingIndex] = restoredNote
    else nextNotes.unshift(restoredNote)
  }

  function restoreSnippets(restoredSnippets: SavedSnippetRecord[]) {
    restoredSnippets.forEach((snippet) => {
      if (nextSnippets.some((current) => current.id === snippet.id)) return
      nextSnippets.unshift(snippet)
    })
  }

  restorations.forEach((restoration) => {
    const item = trashItems.find((trashItem) => trashItem.id === restoration.itemId)
    if (!item) return

    if (item.type === 'folder') {
      const cloudFolder = library.folders.find((folder) => folder.id === restoration.cloudId)
      if (!cloudFolder) return
      const restoredFolder = ensureFolder(item.folder, cloudFolder)
      item.notes.forEach((note) => {
        restoreNote(note, restoredFolder, findCloudNote(note, library.notes, cloudFolder.id))
      })
      restoreSnippets(item.snippets)
      restoredItemIds.add(item.id)
      appliedRestorations.push(restoration)
      return
    }

    const cloudNote = library.notes.find((note) => note.id === restoration.cloudId)
    if (!cloudNote) return
    const cloudFolder = library.folders.find((folder) => folder.id === cloudNote.folderId)
    if (!cloudFolder) return
    const restoredFolder = ensureFolder(item.folder, cloudFolder)
    restoreNote(item.note, restoredFolder, cloudNote)
    restoreSnippets(item.snippets)
    restoredItemIds.add(item.id)
    appliedRestorations.push(restoration)
  })

  return {
    folders: nextFolders,
    notes: nextNotes,
    snippets: nextSnippets,
    trashItems: trashItems.filter((item) => !restoredItemIds.has(item.id)),
    restorations: appliedRestorations,
  }
}

export async function applyCloudTrashSnapshot(
  groups: TrashFolderGroup[],
  options: ApplyCloudTrashSnapshotOptions = {},
) {
  const storage = await chrome.storage.local.get([
    FOLDERS_STORAGE_KEY,
    NOTES_STORAGE_KEY,
    SNIPPETS_STORAGE_KEY,
    TRASH_STORAGE_KEY,
  ])
  const folders = (storage[FOLDERS_STORAGE_KEY] as SavedFolderRecord[] | undefined) ?? []
  const notes = (storage[NOTES_STORAGE_KEY] as SavedNoteRecord[] | undefined) ?? []
  const snippets = (storage[SNIPPETS_STORAGE_KEY] as SavedSnippetRecord[] | undefined) ?? []
  const trashItems = (storage[TRASH_STORAGE_KEY] as TrashItem[] | undefined) ?? []
  const now = new Date()
  const deletedAt = now.toISOString()
  const freshTrashItems = trashItems.filter((item) => isFreshTrashItem(item, now.getTime()))
  const protection = buildReconciliationProtection(options.pendingOperations ?? [])
  const restorationPlan = options.library
    ? buildCloudTrashRestorationPlan({
        trashItems: freshTrashItems,
        folders: options.library.folders,
        notes: options.library.notes,
        groups,
        protection,
      })
    : { restorations: [] }
  const restoredState = options.library
    ? applyCloudRestorations(
        folders,
        notes,
        snippets,
        freshTrashItems,
        restorationPlan.restorations,
        options.library,
      )
    : { folders, notes, snippets, trashItems: freshTrashItems }
  const deletionPlan = buildCloudTrashDeletionPlan({
    folders: restoredState.folders,
    notes: restoredState.notes,
    groups,
    protection,
  })
  const appliedRestorations =
    'restorations' in restoredState ? restoredState.restorations : []
  const restoredFolderCount = appliedRestorations.filter(
    (restoration) => restoration.resourceType === 'folder',
  ).length
  const restoredNoteCount = appliedRestorations.filter(
    (restoration) => restoration.resourceType === 'note',
  ).length

  if (
    deletionPlan.folderIds.length === 0 &&
    deletionPlan.noteIds.length === 0 &&
    appliedRestorations.length === 0
  ) {
    return {
      deletedFolderCount: 0,
      deletedNoteCount: 0,
      restoredFolderCount: 0,
      restoredNoteCount: 0,
    }
  }

  const folderIdSet = new Set(deletionPlan.folderIds)
  const noteIdSet = new Set(deletionPlan.noteIds)
  const folderNoteIdSet = new Set(
    restoredState.notes
      .filter((note) => folderIdSet.has(note.folderId))
      .map((note) => note.id),
  )
  const deletedNoteIdSet = new Set([...folderNoteIdSet, ...noteIdSet])
  const deletedNotes = restoredState.notes.filter((note) => deletedNoteIdSet.has(note.id))
  const deletedNoteUrls = new Set(
    deletedNotes.map((note) => normalizeLibraryNoteUrl(note.sourceUrl)),
  )
  const deletedSnippets = restoredState.snippets.filter((snippet) =>
    deletedNoteUrls.has(normalizeLibraryNoteUrl(snippet.noteUrl)),
  )
  const nextNotes = restoredState.notes.filter((note) => !deletedNoteIdSet.has(note.id))
  const nextSnippets = restoredState.snippets.filter(
    (snippet) => !deletedNoteUrls.has(normalizeLibraryNoteUrl(snippet.noteUrl)),
  )
  const activeFolders = restoredState.folders.filter(
    (folder) => !folderIdSet.has(folder.id),
  )
  const nextFolders = reconcileFolderNoteCounts(
    activeFolders.length > 0 ? activeFolders : createDefaultFolders(deletedAt),
    nextNotes,
  )

  const folderTrashItems: TrashItem[] = restoredState.folders
    .filter((folder) => folderIdSet.has(folder.id))
    .map((folder) => {
      const folderNotes = deletedNotes.filter((note) => note.folderId === folder.id)
      const folderNoteUrls = new Set(
        folderNotes.map((note) => normalizeLibraryNoteUrl(note.sourceUrl)),
      )
      return {
        id: `folder-${folder.id}-${crypto.randomUUID()}`,
        type: 'folder' as const,
        deletedAt,
        folder,
        notes: folderNotes,
        snippets: deletedSnippets.filter((snippet) =>
          folderNoteUrls.has(normalizeLibraryNoteUrl(snippet.noteUrl)),
        ),
      }
    })

  const noteTrashItems: TrashItem[] = deletedNotes
    .filter((note) => noteIdSet.has(note.id))
    .map((note) => {
      const noteUrl = normalizeLibraryNoteUrl(note.sourceUrl)
      return {
        id: `note-${note.id}-${crypto.randomUUID()}`,
        type: 'note' as const,
        deletedAt,
        folder: restoredState.folders.find((folder) => folder.id === note.folderId) ?? null,
        note,
        snippets: deletedSnippets.filter(
          (snippet) => normalizeLibraryNoteUrl(snippet.noteUrl) === noteUrl,
        ),
      }
    })

  await chrome.storage.local.set({
    [FOLDERS_STORAGE_KEY]: nextFolders,
    [NOTES_STORAGE_KEY]: nextNotes,
    [SNIPPETS_STORAGE_KEY]: nextSnippets,
    [TRASH_STORAGE_KEY]: [
      ...folderTrashItems,
      ...noteTrashItems,
      ...restoredState.trashItems,
    ],
  })

  return {
    deletedFolderCount: folderTrashItems.length,
    deletedNoteCount: noteTrashItems.length,
    restoredFolderCount,
    restoredNoteCount,
  }
}
