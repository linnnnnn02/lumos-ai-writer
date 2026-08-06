import type {
  NoteLearningStatus,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  TrashFolderGroup,
  TrashNoteEntry,
} from '@lumos-ai/shared'
import { normalizeNoteUrl } from '@lumos-ai/shared'

export type CloudLibraryCacheState = {
  folders: SavedFolderRecord[]
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
  trashGroups: TrashFolderGroup[]
}

export type CloudLibraryCacheAction =
  | { type: 'replace-cache'; cache: CloudLibraryCacheState }
  | { type: 'upsert-folder'; folder: SavedFolderRecord }
  | { type: 'upsert-note'; note: SavedNoteRecord }
  | {
      type: 'set-note-learning-status'
      noteId: string
      status: Extract<NoteLearningStatus, 'ready' | 'excluded'>
    }
  | { type: 'soft-delete-folder'; folderId: string; deletedAt: string }
  | { type: 'soft-delete-note'; noteId: string; deletedAt: string }
  | { type: 'restore-folder'; folderId: string; restoredAt: string }
  | { type: 'restore-note'; noteId: string; restoredAt: string }
  | { type: 'delete-folder-permanently'; folderId: string }
  | { type: 'delete-note-permanently'; noteId: string }
  | { type: 'empty-trash' }
  | {
      type: 'replace-note-snippets'
      noteUrl: string
      snippets: SavedSnippetRecord[]
    }

function upsertById<T extends { id: string }>(items: T[], item: T) {
  const existingIndex = items.findIndex((current) => current.id === item.id)
  if (existingIndex < 0) return [item, ...items]
  return items.map((current) => (current.id === item.id ? item : current))
}

function normalizeNote(note: TrashNoteEntry['note']): SavedNoteRecord {
  return {
    ...note,
    coverImageUrl: note.coverImageUrl ?? '',
  }
}

function normalizeTrashNote(note: SavedNoteRecord): TrashNoteEntry['note'] {
  return {
    ...note,
    learningStatus: note.learningStatus ?? 'ready',
    qualityFlags: note.qualityFlags ?? [],
  }
}

function getNoteSnippets(
  note: Pick<SavedNoteRecord, 'sourceUrl'>,
  snippets: SavedSnippetRecord[],
) {
  const noteUrl = normalizeNoteUrl(note.sourceUrl)
  return snippets.filter((snippet) => normalizeNoteUrl(snippet.noteUrl) === noteUrl)
}

function sortTrashGroups(groups: TrashFolderGroup[]) {
  return [...groups].sort(
    (left, right) =>
      new Date(right.deletedAt).getTime() - new Date(left.deletedAt).getTime(),
  )
}

function withDerivedFolderCounts(state: CloudLibraryCacheState): CloudLibraryCacheState {
  const counts = new Map<string, number>()
  state.notes.forEach((note) => {
    if (!note.folderId) return
    counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1)
  })

  return {
    ...state,
    folders: state.folders.map((folder) => ({
      ...folder,
      noteCount: counts.get(folder.id) ?? 0,
    })),
  }
}

function getLatestIso(first: string, second: string) {
  return new Date(first).getTime() >= new Date(second).getTime() ? first : second
}

function removeTrashNote(groups: TrashFolderGroup[], noteId: string) {
  return groups
    .map((group) => ({
      ...group,
      notes: group.notes.filter((entry) => entry.note.id !== noteId),
    }))
    .filter((group) => group.folderDeleted || group.notes.length > 0)
}

export function cloudLibraryCacheReducer(
  state: CloudLibraryCacheState,
  action: CloudLibraryCacheAction,
): CloudLibraryCacheState {
  if (action.type === 'replace-cache') return withDerivedFolderCounts(action.cache)

  if (action.type === 'upsert-folder') {
    return withDerivedFolderCounts({
      ...state,
      folders: upsertById(state.folders, action.folder),
      notes: state.notes.map((note) =>
        note.folderId === action.folder.id
          ? { ...note, folderName: action.folder.name }
          : note,
      ),
      trashGroups: state.trashGroups.map((group) =>
        group.folderId === action.folder.id
          ? {
              ...group,
              folderName: action.folder.name,
              notes: group.notes.map((entry) => ({
                ...entry,
                note: { ...entry.note, folderName: action.folder.name },
              })),
            }
          : group,
      ),
    })
  }

  if (action.type === 'upsert-note') {
    const noteUrl = normalizeNoteUrl(action.note.sourceUrl)
    return withDerivedFolderCounts({
      ...state,
      notes: upsertById(state.notes, action.note),
      snippets: state.snippets.map((snippet) =>
        normalizeNoteUrl(snippet.noteUrl) === noteUrl
          ? {
              ...snippet,
              noteTitle: action.note.title,
              noteAuthorName: action.note.authorName,
            }
          : snippet,
      ),
    })
  }

  if (action.type === 'set-note-learning-status') {
    return {
      ...state,
      notes: state.notes.map((note) =>
        note.id === action.noteId ? { ...note, learningStatus: action.status } : note,
      ),
    }
  }

  if (action.type === 'soft-delete-folder') {
    const folder = state.folders.find((item) => item.id === action.folderId)
    if (!folder) return state

    const folderNotes = state.notes.filter((note) => note.folderId === folder.id)
    const folderNoteIds = new Set(folderNotes.map((note) => note.id))
    const folderNoteUrls = new Set(
      folderNotes.map((note) => normalizeNoteUrl(note.sourceUrl)),
    )
    const existingEntries = state.trashGroups
      .filter((group) => group.folderId === folder.id)
      .flatMap((group) => group.notes)
    const entriesByNoteId = new Map<string, TrashNoteEntry>()

    existingEntries.forEach((entry) => entriesByNoteId.set(entry.note.id, entry))
    folderNotes.forEach((note) => {
      entriesByNoteId.set(note.id, {
        id: `${folder.id}-${note.id}`,
        trashItemId: folder.id,
        source: 'folder',
        deletedAt: action.deletedAt,
        note: normalizeTrashNote(note),
        snippets: getNoteSnippets(note, state.snippets),
      })
    })

    const group: TrashFolderGroup = {
      id: `deleted-folder-${folder.id}`,
      folderId: folder.id,
      folderName: folder.name,
      deletedAt: action.deletedAt,
      folderDeleted: true,
      notes: Array.from(entriesByNoteId.values()).map((entry) => ({
        ...entry,
        id: `${folder.id}-${entry.note.id}`,
        trashItemId: folder.id,
        source: 'folder',
      })),
    }

    return withDerivedFolderCounts({
      folders: state.folders.filter((item) => item.id !== folder.id),
      notes: state.notes.filter((note) => !folderNoteIds.has(note.id)),
      snippets: state.snippets.filter(
        (snippet) => !folderNoteUrls.has(normalizeNoteUrl(snippet.noteUrl)),
      ),
      trashGroups: sortTrashGroups([
        group,
        ...state.trashGroups.filter((item) => item.folderId !== folder.id),
      ]),
    })
  }

  if (action.type === 'soft-delete-note') {
    const note = state.notes.find((item) => item.id === action.noteId)
    if (!note) return state

    const existingGroup = state.trashGroups.find(
      (group) => group.folderId === note.folderId,
    )
    const folderDeleted = existingGroup?.folderDeleted ?? false
    const groupId = folderDeleted
      ? `deleted-folder-${note.folderId}`
      : `note-folder-${note.folderId || 'unknown'}`
    const entry: TrashNoteEntry = {
      id: folderDeleted ? `${note.folderId}-${note.id}` : note.id,
      trashItemId: folderDeleted ? note.folderId || note.id : note.id,
      source: folderDeleted ? 'folder' : 'note',
      deletedAt: action.deletedAt,
      note: normalizeTrashNote(note),
      snippets: getNoteSnippets(note, state.snippets),
    }
    const group: TrashFolderGroup = existingGroup
      ? {
          ...existingGroup,
          id: groupId,
          deletedAt: getLatestIso(existingGroup.deletedAt, action.deletedAt),
          notes: [
            entry,
            ...existingGroup.notes.filter((current) => current.note.id !== note.id),
          ],
        }
      : {
          id: groupId,
          folderId: note.folderId,
          folderName: note.folderName || '原文件夹未知',
          deletedAt: action.deletedAt,
          folderDeleted: false,
          notes: [entry],
        }
    const noteUrl = normalizeNoteUrl(note.sourceUrl)

    return withDerivedFolderCounts({
      ...state,
      notes: state.notes.filter((item) => item.id !== note.id),
      snippets: state.snippets.filter(
        (snippet) => normalizeNoteUrl(snippet.noteUrl) !== noteUrl,
      ),
      trashGroups: sortTrashGroups([
        group,
        ...state.trashGroups.filter((item) => item.folderId !== note.folderId),
      ]),
    })
  }

  if (action.type === 'restore-folder') {
    const matchingGroups = state.trashGroups.filter(
      (group) => group.folderId === action.folderId,
    )
    const deletedFolderGroup = matchingGroups.find((group) => group.folderDeleted)
    if (!deletedFolderGroup) return state

    const entries = matchingGroups.flatMap((group) => group.notes)
    const restoredNotes = entries.map((entry) => normalizeNote(entry.note))
    const restoredSnippets = entries.flatMap((entry) => entry.snippets)
    const folder: SavedFolderRecord = {
      id: action.folderId,
      name: deletedFolderGroup.folderName,
      noteCount: restoredNotes.length,
      updatedAt: action.restoredAt,
    }

    return withDerivedFolderCounts({
      folders: upsertById(state.folders, folder),
      notes: restoredNotes.reduce(upsertById, state.notes),
      snippets: restoredSnippets.reduce(upsertById, state.snippets),
      trashGroups: state.trashGroups.filter(
        (group) => group.folderId !== action.folderId,
      ),
    })
  }

  if (action.type === 'restore-note') {
    const sourceGroup = state.trashGroups.find((group) =>
      group.notes.some((entry) => entry.note.id === action.noteId),
    )
    const sourceEntry = sourceGroup?.notes.find(
      (entry) => entry.note.id === action.noteId,
    )
    if (!sourceGroup || !sourceEntry) return state

    const note = normalizeNote(sourceEntry.note)
    const remainingEntries = sourceGroup.notes
      .filter((entry) => entry.note.id !== action.noteId)
      .map((entry) => ({
        ...entry,
        id: entry.note.id,
        trashItemId: entry.note.id,
        source: 'note' as const,
      }))
    const remainingGroups = state.trashGroups.filter(
      (group) => group.folderId !== sourceGroup.folderId,
    )
    if (remainingEntries.length > 0) {
      remainingGroups.push({
        ...sourceGroup,
        id: `note-folder-${sourceGroup.folderId || 'unknown'}`,
        folderDeleted: false,
        deletedAt: remainingEntries.reduce(
          (latest, entry) => getLatestIso(latest, entry.deletedAt),
          remainingEntries[0].deletedAt,
        ),
        notes: remainingEntries,
      })
    }

    const folder = state.folders.find((item) => item.id === sourceGroup.folderId)
    const restoredFolder =
      folder || !sourceGroup.folderId
        ? folder
        : {
            id: sourceGroup.folderId,
            name: sourceGroup.folderName,
            noteCount: 1,
            updatedAt: action.restoredAt,
          }

    return withDerivedFolderCounts({
      folders: restoredFolder ? upsertById(state.folders, restoredFolder) : state.folders,
      notes: upsertById(state.notes, note),
      snippets: sourceEntry.snippets.reduce(upsertById, state.snippets),
      trashGroups: sortTrashGroups(remainingGroups),
    })
  }

  if (action.type === 'delete-folder-permanently') {
    return {
      ...state,
      trashGroups: state.trashGroups.filter(
        (group) => group.folderId !== action.folderId,
      ),
    }
  }

  if (action.type === 'delete-note-permanently') {
    return {
      ...state,
      trashGroups: removeTrashNote(state.trashGroups, action.noteId),
    }
  }

  if (action.type === 'empty-trash') {
    return { ...state, trashGroups: [] }
  }

  if (action.type === 'replace-note-snippets') {
    const noteUrl = normalizeNoteUrl(action.noteUrl)
    return {
      ...state,
      snippets: [
        ...action.snippets,
        ...state.snippets.filter(
          (snippet) => normalizeNoteUrl(snippet.noteUrl) !== noteUrl,
        ),
      ],
    }
  }

  return state
}
