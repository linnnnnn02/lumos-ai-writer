import type { SavedFolderRecord, SavedNoteRecord, TrashFolderGroup } from '@lumos-ai/shared'

export type CloudTrashDeletionPlan = {
  folderIds: string[]
  noteIds: string[]
}

type BuildCloudTrashDeletionPlanInput = {
  folders: SavedFolderRecord[]
  notes: SavedNoteRecord[]
  groups: TrashFolderGroup[]
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

export function buildCloudTrashDeletionPlan({
  folders,
  notes,
  groups,
}: BuildCloudTrashDeletionPlanInput): CloudTrashDeletionPlan {
  const plannedFolderIds = new Set<string>()
  const plannedNoteIds = new Set<string>()
  const noteUrlsByFolderId = new Map<string, Set<string>>()

  notes.forEach((note) => {
    const noteUrl = normalizeLibraryNoteUrl(note.sourceUrl)
    if (!noteUrl || !note.folderId) return
    const folderUrls = noteUrlsByFolderId.get(note.folderId) ?? new Set<string>()
    folderUrls.add(noteUrl)
    noteUrlsByFolderId.set(note.folderId, folderUrls)
  })

  for (const group of groups) {
    if (!group.folderDeleted) continue

    const exactFolder = folders.find((folder) => folder.id === group.folderId)
    if (exactFolder) {
      plannedFolderIds.add(exactFolder.id)
      continue
    }

    const cloudNoteUrls = getCloudGroupNoteUrls(group)
    if (cloudNoteUrls.size === 0) continue

    const overlappingFolders = folders.filter((folder) => {
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
      const localNote = notes.find(
        (note) =>
          note.id === entry.note.id ||
          (cloudNoteUrl && normalizeLibraryNoteUrl(note.sourceUrl) === cloudNoteUrl),
      )
      if (!localNote || plannedFolderIds.has(localNote.folderId)) continue
      plannedNoteIds.add(localNote.id)
    }
  }

  return {
    folderIds: folders.filter((folder) => plannedFolderIds.has(folder.id)).map((folder) => folder.id),
    noteIds: notes.filter((note) => plannedNoteIds.has(note.id)).map((note) => note.id),
  }
}
