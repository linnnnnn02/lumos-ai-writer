import type {
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  TrashFolderGroup,
} from '@lumos-ai/shared'
import {
  buildCloudTrashDeletionPlan,
  normalizeLibraryNoteUrl,
} from './cloud-trash-reconcile'

const FOLDERS_STORAGE_KEY = 'savedFolders'
const NOTES_STORAGE_KEY = 'savedNotes'
const SNIPPETS_STORAGE_KEY = 'savedSnippets'
const TRASH_STORAGE_KEY = 'trashItems'
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

type LocalTrashedNoteItem = {
  id: string
  type: 'note'
  deletedAt: string
  folder: SavedFolderRecord | null
  note: SavedNoteRecord
  snippets: SavedSnippetRecord[]
}

type LocalTrashedFolderItem = {
  id: string
  type: 'folder'
  deletedAt: string
  folder: SavedFolderRecord
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
}

type LocalTrashItem = LocalTrashedNoteItem | LocalTrashedFolderItem

function createDefaultFolders(now: string): SavedFolderRecord[] {
  return [
    { id: 'default-folder-beauty', name: '护肤口播感', noteCount: 0, updatedAt: now },
    { id: 'default-folder-lifestyle', name: '生活方式笔记', noteCount: 0, updatedAt: now },
  ]
}

function isFreshTrashItem(item: LocalTrashItem, now: number) {
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

export async function applyCloudTrashSnapshot(groups: TrashFolderGroup[]) {
  const storage = await chrome.storage.local.get([
    FOLDERS_STORAGE_KEY,
    NOTES_STORAGE_KEY,
    SNIPPETS_STORAGE_KEY,
    TRASH_STORAGE_KEY,
  ])
  const folders = (storage[FOLDERS_STORAGE_KEY] as SavedFolderRecord[] | undefined) ?? []
  const notes = (storage[NOTES_STORAGE_KEY] as SavedNoteRecord[] | undefined) ?? []
  const snippets = (storage[SNIPPETS_STORAGE_KEY] as SavedSnippetRecord[] | undefined) ?? []
  const trashItems = (storage[TRASH_STORAGE_KEY] as LocalTrashItem[] | undefined) ?? []
  const plan = buildCloudTrashDeletionPlan({ folders, notes, groups })

  if (plan.folderIds.length === 0 && plan.noteIds.length === 0) {
    return { deletedFolderCount: 0, deletedNoteCount: 0 }
  }

  const now = new Date()
  const deletedAt = now.toISOString()
  const folderIdSet = new Set(plan.folderIds)
  const noteIdSet = new Set(plan.noteIds)
  const folderNoteIdSet = new Set(
    notes.filter((note) => folderIdSet.has(note.folderId)).map((note) => note.id),
  )
  const deletedNoteIdSet = new Set([...folderNoteIdSet, ...noteIdSet])
  const deletedNotes = notes.filter((note) => deletedNoteIdSet.has(note.id))
  const deletedNoteUrls = new Set(
    deletedNotes.map((note) => normalizeLibraryNoteUrl(note.sourceUrl)),
  )
  const deletedSnippets = snippets.filter((snippet) =>
    deletedNoteUrls.has(normalizeLibraryNoteUrl(snippet.noteUrl)),
  )
  const nextNotes = notes.filter((note) => !deletedNoteIdSet.has(note.id))
  const nextSnippets = snippets.filter(
    (snippet) => !deletedNoteUrls.has(normalizeLibraryNoteUrl(snippet.noteUrl)),
  )
  const activeFolders = folders.filter((folder) => !folderIdSet.has(folder.id))
  const nextFolders = reconcileFolderNoteCounts(
    activeFolders.length > 0 ? activeFolders : createDefaultFolders(deletedAt),
    nextNotes,
  )

  const folderTrashItems: LocalTrashedFolderItem[] = folders
    .filter((folder) => folderIdSet.has(folder.id))
    .map((folder) => {
      const folderNotes = deletedNotes.filter((note) => note.folderId === folder.id)
      const folderNoteUrls = new Set(
        folderNotes.map((note) => normalizeLibraryNoteUrl(note.sourceUrl)),
      )
      return {
        id: `folder-${folder.id}-${crypto.randomUUID()}`,
        type: 'folder',
        deletedAt,
        folder,
        notes: folderNotes,
        snippets: deletedSnippets.filter((snippet) =>
          folderNoteUrls.has(normalizeLibraryNoteUrl(snippet.noteUrl)),
        ),
      }
    })

  const noteTrashItems: LocalTrashedNoteItem[] = deletedNotes
    .filter((note) => noteIdSet.has(note.id))
    .map((note) => {
      const noteUrl = normalizeLibraryNoteUrl(note.sourceUrl)
      return {
        id: `note-${note.id}-${crypto.randomUUID()}`,
        type: 'note',
        deletedAt,
        folder: folders.find((folder) => folder.id === note.folderId) ?? null,
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
      ...trashItems.filter((item) => isFreshTrashItem(item, now.getTime())),
    ],
  })

  return {
    deletedFolderCount: folderTrashItems.length,
    deletedNoteCount: noteTrashItems.length,
  }
}
