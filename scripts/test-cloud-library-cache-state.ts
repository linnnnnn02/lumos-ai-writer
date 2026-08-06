import assert from 'node:assert/strict'
import type {
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
} from '@lumos-ai/shared'
import { cloudLibraryCacheReducer } from '../web/src/features/library/model/cloud-library-cache-state.js'

const folder: SavedFolderRecord = {
  id: 'folder-1',
  name: '真实体验',
  noteCount: 1,
  updatedAt: '2026-08-06T08:00:00.000Z',
}
const note: SavedNoteRecord = {
  id: 'note-1',
  folderId: folder.id,
  folderName: folder.name,
  filename: '第一次体验',
  title: '第一次体验',
  authorName: '作者',
  sourceUrl: 'https://example.com/note-1?track=1',
  coverImageUrl: '',
  contentText: '具体体验正文',
  savedAt: '2026-08-06T08:00:00.000Z',
  updatedAt: '2026-08-06T08:00:00.000Z',
  learningStatus: 'ready',
  qualityFlags: [],
}
const snippet: SavedSnippetRecord = {
  id: 'snippet-1',
  noteUrl: 'https://example.com/note-1',
  noteTitle: note.title,
  noteAuthorName: note.authorName,
  selectedText: '具体体验',
  reasonText: '有事实支撑',
  colorTagName: '事实',
  colorValue: '#64748B',
}
const secondNote: SavedNoteRecord = {
  ...note,
  id: 'note-2',
  filename: '第二次体验',
  title: '第二次体验',
  sourceUrl: 'https://example.com/note-2',
}
const secondSnippet: SavedSnippetRecord = {
  ...snippet,
  id: 'snippet-2-for-note-2',
  noteUrl: secondNote.sourceUrl,
  noteTitle: secondNote.title,
}

let state = {
  folders: [folder],
  notes: [note],
  snippets: [snippet],
  trashGroups: [],
}

const renamedFolder = { ...folder, name: '克制表达', updatedAt: '2026-08-06T08:01:00.000Z' }
state = cloudLibraryCacheReducer(state, {
  type: 'upsert-folder',
  folder: renamedFolder,
})
assert.equal(state.folders[0].name, '克制表达')
assert.equal(state.notes[0].folderName, '克制表达')

const renamedNote = { ...note, folderName: '克制表达', title: '一次克制的体验' }
state = cloudLibraryCacheReducer(state, { type: 'upsert-note', note: renamedNote })
assert.equal(state.notes[0].title, '一次克制的体验')
assert.equal(state.snippets[0].noteTitle, '一次克制的体验')

state = cloudLibraryCacheReducer(state, {
  type: 'set-note-learning-status',
  noteId: note.id,
  status: 'excluded',
})
assert.equal(state.notes[0].learningStatus, 'excluded')

state = cloudLibraryCacheReducer(state, {
  type: 'soft-delete-note',
  noteId: note.id,
  deletedAt: '2026-08-06T08:02:00.000Z',
})
assert.equal(state.notes.length, 0)
assert.equal(state.snippets.length, 0)
assert.equal(state.folders[0].noteCount, 0)
assert.equal(state.trashGroups[0].notes[0].note.id, note.id)
assert.equal(state.trashGroups[0].notes[0].snippets[0].id, snippet.id)

state = cloudLibraryCacheReducer(state, {
  type: 'restore-note',
  noteId: note.id,
  restoredAt: '2026-08-06T08:03:00.000Z',
})
assert.equal(state.notes[0].id, note.id)
assert.equal(state.snippets[0].id, snippet.id)
assert.equal(state.folders[0].noteCount, 1)
assert.equal(state.trashGroups.length, 0)

let folderRestoreState = {
  folders: [folder],
  notes: [note],
  snippets: [snippet],
  trashGroups: [
    {
      id: `note-folder-${folder.id}`,
      folderId: folder.id,
      folderName: folder.name,
      deletedAt: '2026-08-06T08:03:30.000Z',
      folderDeleted: false,
      notes: [
        {
          id: secondNote.id,
          trashItemId: secondNote.id,
          source: 'note' as const,
          deletedAt: '2026-08-06T08:03:30.000Z',
          note: {
            ...secondNote,
            learningStatus: secondNote.learningStatus ?? 'ready',
            qualityFlags: secondNote.qualityFlags ?? [],
          },
          snippets: [secondSnippet],
        },
      ],
    },
  ],
}
folderRestoreState = cloudLibraryCacheReducer(folderRestoreState, {
  type: 'soft-delete-folder',
  folderId: folder.id,
  deletedAt: '2026-08-06T08:04:00.000Z',
})
assert.deepEqual(
  folderRestoreState.trashGroups[0].notes.map((entry) => entry.note.id).sort(),
  [note.id, secondNote.id],
)
assert.ok(folderRestoreState.trashGroups[0].notes.every((entry) => entry.source === 'folder'))
folderRestoreState = cloudLibraryCacheReducer(folderRestoreState, {
  type: 'restore-note',
  noteId: note.id,
  restoredAt: '2026-08-06T08:04:30.000Z',
})
assert.equal(folderRestoreState.folders[0].id, folder.id)
assert.deepEqual(folderRestoreState.notes.map((item) => item.id), [note.id])
assert.equal(folderRestoreState.folders[0].noteCount, 1)
assert.equal(folderRestoreState.trashGroups[0].folderDeleted, false)
assert.deepEqual(
  folderRestoreState.trashGroups[0].notes.map((entry) => entry.note.id),
  [secondNote.id],
)
assert.equal(folderRestoreState.trashGroups[0].notes[0].source, 'note')
folderRestoreState = cloudLibraryCacheReducer(folderRestoreState, {
  type: 'restore-note',
  noteId: secondNote.id,
  restoredAt: '2026-08-06T08:05:00.000Z',
})
assert.equal(folderRestoreState.folders[0].noteCount, 2)
assert.deepEqual(
  folderRestoreState.notes.map((item) => item.id).sort(),
  [note.id, secondNote.id],
)
assert.equal(folderRestoreState.trashGroups.length, 0)

state = cloudLibraryCacheReducer(state, {
  type: 'soft-delete-folder',
  folderId: folder.id,
  deletedAt: '2026-08-06T08:04:00.000Z',
})
assert.equal(state.folders.length, 0)
assert.equal(state.notes.length, 0)
assert.equal(state.snippets.length, 0)
assert.equal(state.trashGroups[0].folderDeleted, true)
assert.equal(state.trashGroups[0].notes[0].source, 'folder')

state = cloudLibraryCacheReducer(state, {
  type: 'restore-folder',
  folderId: folder.id,
  restoredAt: '2026-08-06T08:05:00.000Z',
})
assert.equal(state.folders[0].id, folder.id)
assert.equal(state.notes[0].id, note.id)
assert.equal(state.snippets[0].id, snippet.id)
assert.equal(state.trashGroups.length, 0)

const replacementSnippet = { ...snippet, id: 'snippet-2', selectedText: '新的片段' }
state = cloudLibraryCacheReducer(state, {
  type: 'replace-note-snippets',
  noteUrl: note.sourceUrl,
  snippets: [replacementSnippet],
})
assert.deepEqual(state.snippets.map((item) => item.id), ['snippet-2'])

state = cloudLibraryCacheReducer(state, {
  type: 'soft-delete-note',
  noteId: note.id,
  deletedAt: '2026-08-06T08:06:00.000Z',
})
state = cloudLibraryCacheReducer(state, {
  type: 'delete-note-permanently',
  noteId: note.id,
})
assert.equal(state.trashGroups.length, 0)

state = cloudLibraryCacheReducer(
  {
    folders: [],
    notes: [],
    snippets: [],
    trashGroups: [
      {
        id: `deleted-folder-${folder.id}`,
        folderId: folder.id,
        folderName: folder.name,
        deletedAt: '2026-08-06T08:07:00.000Z',
        folderDeleted: true,
        notes: [],
      },
    ],
  },
  { type: 'delete-folder-permanently', folderId: folder.id },
)
assert.equal(state.trashGroups.length, 0)

state = cloudLibraryCacheReducer(
  { ...state, trashGroups: [{
    id: 'trash',
    folderId: folder.id,
    folderName: folder.name,
    deletedAt: '2026-08-06T08:08:00.000Z',
    folderDeleted: true,
    notes: [],
  }] },
  { type: 'empty-trash' },
)
assert.equal(state.trashGroups.length, 0)

console.log('cloud library cache state passed')
