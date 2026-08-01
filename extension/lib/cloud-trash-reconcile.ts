import type {
  FolderDto,
  NoteDto,
  SavedFolderRecord,
  SavedNoteRecord,
  TrashFolderGroup,
} from '@lumos-ai/shared'

export type CloudTrashDeletionPlan = {
  folderIds: string[]
  noteIds: string[]
}

export type CloudTrashRestoration = {
  itemId: string
  resourceType: 'folder' | 'note'
  cloudId: string
}

export type CloudTrashRestorationPlan = {
  restorations: CloudTrashRestoration[]
}

export type CloudTrashReconciliationProtection = {
  deletingFolderIds?: string[]
  deletingNoteIds?: string[]
  restoringFolderIds?: string[]
  restoringNoteIds?: string[]
}

type RestorableTrashItem =
  | {
      id: string
      type: 'folder'
      folder: SavedFolderRecord
      notes: SavedNoteRecord[]
    }
  | {
      id: string
      type: 'note'
      note: SavedNoteRecord
    }

type BuildCloudTrashDeletionPlanInput = {
  folders: SavedFolderRecord[]
  notes: SavedNoteRecord[]
  groups: TrashFolderGroup[]
  protection?: CloudTrashReconciliationProtection
}

type BuildCloudTrashRestorationPlanInput = {
  trashItems: RestorableTrashItem[]
  folders: FolderDto[]
  notes: NoteDto[]
  groups: TrashFolderGroup[]
  protection?: CloudTrashReconciliationProtection
}

export function normalizeLibraryNoteUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.trim()
  }
}

function getCloudGroupNoteUrls(group: TrashFolderGroup) {
  return new Set(
    group.notes
      .map((entry) => normalizeLibraryNoteUrl(entry.note.sourceUrl))
      .filter(Boolean),
  )
}

function getDeletedCloudNotes(groups: TrashFolderGroup[]) {
  return groups.flatMap((group) => group.notes.map((entry) => entry.note))
}

function resolveCloudNoteId(
  note: SavedNoteRecord,
  cloudNotes: NoteDto[],
) {
  if (note.cloudId) return note.cloudId

  const noteUrl = normalizeLibraryNoteUrl(note.sourceUrl)
  if (!noteUrl) return null

  const candidateIds = new Set(
    cloudNotes
      .filter((cloudNote) => normalizeLibraryNoteUrl(cloudNote.sourceUrl) === noteUrl)
      .map((cloudNote) => cloudNote.id),
  )
  return candidateIds.size === 1 ? Array.from(candidateIds)[0] : null
}

function resolveCloudFolderId(
  folder: SavedFolderRecord,
  localNotes: SavedNoteRecord[],
  activeFolders: FolderDto[],
  activeNotes: NoteDto[],
  groups: TrashFolderGroup[],
) {
  if (folder.cloudId) return folder.cloudId

  const deletedNotes = getDeletedCloudNotes(groups)
  const cloudNotes = [...activeNotes, ...deletedNotes]
  const cloudNotesById = new Map(cloudNotes.map((note) => [note.id, note]))
  const candidateFolderIds = new Set<string>()

  localNotes.forEach((note) => {
    const cloudNoteId = resolveCloudNoteId(note, cloudNotes)
    const cloudNote = cloudNoteId ? cloudNotesById.get(cloudNoteId) : null
    if (cloudNote?.folderId) candidateFolderIds.add(cloudNote.folderId)
  })

  if (candidateFolderIds.size === 1) return Array.from(candidateFolderIds)[0]
  if (candidateFolderIds.size > 1) return null

  const normalizedName = folder.name.trim()
  if (!normalizedName) return null

  const nameCandidateIds = new Set<string>()
  activeFolders.forEach((cloudFolder) => {
    if (cloudFolder.name.trim() === normalizedName) nameCandidateIds.add(cloudFolder.id)
  })
  groups.forEach((group) => {
    if (group.folderDeleted && group.folderName.trim() === normalizedName) {
      nameCandidateIds.add(group.folderId)
    }
  })
  return nameCandidateIds.size === 1 ? Array.from(nameCandidateIds)[0] : null
}

export function buildCloudTrashRestorationPlan({
  trashItems,
  folders,
  notes,
  groups,
  protection,
}: BuildCloudTrashRestorationPlanInput): CloudTrashRestorationPlan {
  const deletingFolderIds = new Set(protection?.deletingFolderIds ?? [])
  const deletingNoteIds = new Set(protection?.deletingNoteIds ?? [])
  const activeFolderIds = new Set(folders.map((folder) => folder.id))
  const activeNoteIds = new Set(notes.map((note) => note.id))
  const deletedFolderIds = new Set(
    groups.filter((group) => group.folderDeleted).map((group) => group.folderId),
  )
  const deletedNoteIds = new Set(
    groups.flatMap((group) => group.notes.map((entry) => entry.note.id)),
  )
  const allCloudNotes = [...notes, ...getDeletedCloudNotes(groups)]
  const restorations: CloudTrashRestoration[] = []

  trashItems.forEach((item) => {
    if (item.type === 'folder') {
      if (deletingFolderIds.has(item.folder.id)) return
      const cloudId = resolveCloudFolderId(item.folder, item.notes, folders, notes, groups)
      if (!cloudId || !activeFolderIds.has(cloudId) || deletedFolderIds.has(cloudId)) return
      restorations.push({ itemId: item.id, resourceType: 'folder', cloudId })
      return
    }

    if (deletingNoteIds.has(item.note.id)) return
    const cloudId = resolveCloudNoteId(item.note, allCloudNotes)
    if (!cloudId || !activeNoteIds.has(cloudId) || deletedNoteIds.has(cloudId)) return
    restorations.push({ itemId: item.id, resourceType: 'note', cloudId })
  })

  return { restorations }
}

export function buildCloudTrashDeletionPlan({
  folders,
  notes,
  groups,
  protection,
}: BuildCloudTrashDeletionPlanInput): CloudTrashDeletionPlan {
  const plannedFolderIds = new Set<string>()
  const plannedNoteIds = new Set<string>()
  const noteUrlsByFolderId = new Map<string, Set<string>>()
  const restoringFolderIds = new Set(protection?.restoringFolderIds ?? [])
  const restoringNoteIds = new Set(protection?.restoringNoteIds ?? [])

  notes.forEach((note) => {
    const noteUrl = normalizeLibraryNoteUrl(note.sourceUrl)
    if (!noteUrl || !note.folderId) return
    const folderUrls = noteUrlsByFolderId.get(note.folderId) ?? new Set<string>()
    folderUrls.add(noteUrl)
    noteUrlsByFolderId.set(note.folderId, folderUrls)
  })

  for (const group of groups) {
    if (!group.folderDeleted) continue

    const exactFolder = folders.find(
      (folder) => folder.cloudId === group.folderId || folder.id === group.folderId,
    )
    const exactFolderHasProtectedNote = exactFolder
      ? notes.some(
          (note) =>
            note.folderId === exactFolder.id && restoringNoteIds.has(note.id),
        )
      : false
    if (
      exactFolder &&
      !restoringFolderIds.has(exactFolder.id) &&
      !exactFolderHasProtectedNote
    ) {
      plannedFolderIds.add(exactFolder.id)
      continue
    }

    const cloudNoteUrls = getCloudGroupNoteUrls(group)
    if (cloudNoteUrls.size === 0) continue

    const overlappingFolders = folders.filter((folder) => {
      if (restoringFolderIds.has(folder.id)) return false
      if (
        notes.some(
          (note) => note.folderId === folder.id && restoringNoteIds.has(note.id),
        )
      ) {
        return false
      }
      const localNoteUrls = noteUrlsByFolderId.get(folder.id)
      if (!localNoteUrls) return false
      const hasOverlap = Array.from(cloudNoteUrls).some((noteUrl) => localNoteUrls.has(noteUrl))
      const hasOnlyCloudDeletedNotes = Array.from(localNoteUrls).every((noteUrl) =>
        cloudNoteUrls.has(noteUrl),
      )
      return hasOverlap && hasOnlyCloudDeletedNotes
    })

    if (overlappingFolders.length === 1) {
      plannedFolderIds.add(overlappingFolders[0].id)
    }
  }

  for (const group of groups) {
    const cloudEntries = group.notes
    for (const entry of cloudEntries) {
      const cloudNoteUrl = normalizeLibraryNoteUrl(entry.note.sourceUrl)
      const exactNote = notes.find(
        (note) => note.cloudId === entry.note.id || note.id === entry.note.id,
      )
      const urlMatches = cloudNoteUrl
        ? notes.filter(
            (note) => normalizeLibraryNoteUrl(note.sourceUrl) === cloudNoteUrl,
          )
        : []
      const localNote = exactNote ?? (urlMatches.length === 1 ? urlMatches[0] : null)
      if (!localNote || plannedFolderIds.has(localNote.folderId)) continue
      if (
        restoringFolderIds.has(localNote.folderId) ||
        restoringNoteIds.has(localNote.id)
      ) {
        continue
      }
      plannedNoteIds.add(localNote.id)
    }
  }

  return {
    folderIds: folders.filter((folder) => plannedFolderIds.has(folder.id)).map((folder) => folder.id),
    noteIds: notes.filter((note) => plannedNoteIds.has(note.id)).map((note) => note.id),
  }
}
