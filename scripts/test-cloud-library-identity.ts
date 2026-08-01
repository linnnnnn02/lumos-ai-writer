import assert from 'node:assert/strict'
import type {
  FolderDto,
  NoteDto,
  SavedFolderRecord,
  SavedNoteRecord,
} from '../packages/shared/src/index'
import {
  applyCloudLibraryIdentitySnapshot,
  buildCloudLibraryIdentityPlan,
} from '../extension/lib/cloud-library-identity'

function cloudFolder(id: string, name: string): FolderDto {
  return {
    id,
    name,
    noteCount: 0,
    updatedAt: new Date(0).toISOString(),
  }
}

function cloudNote(id: string, folderId: string, sourceUrl: string): NoteDto {
  return {
    id,
    folderId,
    folderName: 'Cloud folder',
    filename: id,
    title: id,
    authorName: 'Author',
    sourceUrl,
    coverImageUrl: '',
    contentText: '',
    savedAt: new Date(0).toISOString(),
    updatedAt: new Date(1).toISOString(),
    learningStatus: 'ready',
    qualityFlags: [],
  }
}

function localFolder(id: string, name: string, cloudId?: string): SavedFolderRecord {
  return {
    id,
    cloudId,
    name,
    noteCount: 0,
    updatedAt: new Date(0).toISOString(),
  }
}

function localNote(
  id: string,
  folderId: string,
  sourceUrl: string,
  cloudId?: string,
): SavedNoteRecord {
  return {
    id,
    cloudId,
    folderId,
    folderName: 'Local folder',
    filename: id,
    title: id,
    authorName: 'Author',
    sourceUrl,
    coverImageUrl: '',
    contentText: '',
    savedAt: new Date(0).toISOString(),
  }
}

const folders = [
  localFolder('local-folder', 'Renamed locally'),
  localFolder('empty-folder', 'Unique empty folder'),
  localFolder('ambiguous-folder', 'Duplicate'),
  localFolder('mixed-folder', 'Cloud folder'),
]
const notes = [
  localNote(
    'local-note',
    'local-folder',
    'https://www.xiaohongshu.com/explore/note-1?xsec_token=temporary',
  ),
  localNote('local-only-note', 'local-folder', 'https://example.com/local-only'),
  localNote('ambiguous-note', 'ambiguous-folder', 'https://example.com/duplicate'),
  localNote('mixed-note-1', 'mixed-folder', 'https://example.com/mixed-1'),
  localNote('mixed-note-2', 'mixed-folder', 'https://example.com/mixed-2'),
  localNote('known-note', 'local-folder', 'https://example.com/old-url', 'cloud-known'),
]
const cloud = {
  folders: [
    cloudFolder('cloud-folder', 'Cloud folder'),
    cloudFolder('cloud-empty', 'Unique empty folder'),
    cloudFolder('cloud-duplicate-1', 'Duplicate'),
    cloudFolder('cloud-duplicate-2', 'Duplicate'),
  ],
  notes: [
    cloudNote('cloud-note', 'cloud-folder', 'https://www.xiaohongshu.com/explore/note-1'),
    cloudNote('cloud-duplicate-note-1', 'cloud-duplicate-1', 'https://example.com/duplicate'),
    cloudNote('cloud-duplicate-note-2', 'cloud-duplicate-2', 'https://example.com/duplicate'),
    cloudNote('cloud-known', 'cloud-folder', 'https://example.com/current-url'),
    cloudNote('cloud-mixed-1', 'cloud-folder', 'https://example.com/mixed-1'),
    cloudNote('cloud-mixed-2', 'cloud-duplicate-1', 'https://example.com/mixed-2'),
  ],
}

const plan = buildCloudLibraryIdentityPlan(folders, notes, cloud)

assert.deepEqual(plan.notes, [
  { localId: 'local-note', cloudId: 'cloud-note' },
  { localId: 'mixed-note-1', cloudId: 'cloud-mixed-1' },
  { localId: 'mixed-note-2', cloudId: 'cloud-mixed-2' },
  { localId: 'known-note', cloudId: 'cloud-known' },
])
assert.deepEqual(plan.folders, [
  { localId: 'local-folder', cloudId: 'cloud-folder' },
  { localId: 'empty-folder', cloudId: 'cloud-empty' },
])

async function testCloudNameReconciliation() {
  const storageState: Record<string, unknown> = {
    savedFolders: [
      localFolder('local-folder', 'Local folder', 'cloud-folder'),
    ],
    savedNotes: [
      {
        ...localNote('local-note', 'local-folder', 'https://example.com/note', 'cloud-note'),
        filename: 'Local filename',
        title: 'Local title',
      },
    ],
    savedSnippets: [
      {
        id: 'local-snippet',
        noteUrl: 'https://example.com/note',
        noteTitle: 'Local title',
        noteAuthorName: 'Author',
        selectedText: 'Selected text',
        reasonText: 'Reason',
        colorTagName: 'Tag',
      },
    ],
  }

  ;(globalThis as typeof globalThis & { chrome: unknown }).chrome = {
    storage: {
      local: {
        async get(keys: string[]) {
          return Object.fromEntries(keys.map((key) => [key, storageState[key]]))
        },
        async set(values: Record<string, unknown>) {
          Object.assign(storageState, values)
        },
      },
    },
  }

  const renamedCloud = {
    folders: [cloudFolder('cloud-folder', 'Cloud renamed folder')],
    notes: [
      {
        ...cloudNote('cloud-note', 'cloud-folder', 'https://example.com/note'),
        folderName: 'Cloud renamed folder',
        filename: 'Cloud renamed filename',
        title: 'Cloud renamed title',
      },
    ],
  }
  const result = await applyCloudLibraryIdentitySnapshot(renamedCloud)
  assert.deepEqual(result, {
    updatedFolderCount: 1,
    updatedNoteCount: 1,
    updatedSnippetCount: 1,
  })
  assert.equal((storageState.savedFolders as SavedFolderRecord[])[0].name, 'Cloud renamed folder')
  assert.deepEqual(
    (storageState.savedNotes as SavedNoteRecord[]).map((note) => [
      note.filename,
      note.title,
      note.folderName,
    ]),
    [['Cloud renamed filename', 'Cloud renamed title', 'Cloud renamed folder']],
  )
  assert.equal(
    (storageState.savedSnippets as Array<{ noteTitle: string }>)[0].noteTitle,
    'Cloud renamed title',
  )

  storageState.savedFolders = [
    { ...localFolder('local-folder', 'Pending local folder', 'cloud-folder'), updatedAt: new Date(2).toISOString() },
  ]
  storageState.savedNotes = [
    {
      ...localNote('local-note', 'local-folder', 'https://example.com/note', 'cloud-note'),
      folderName: 'Pending local folder',
      filename: 'Pending local filename',
      title: 'Local title',
      updatedAt: new Date(2).toISOString(),
    },
  ]
  await applyCloudLibraryIdentitySnapshot(renamedCloud, {
    pendingOperations: [
      { action: 'rename', target: { type: 'folder', localId: 'local-folder' } },
      { action: 'rename', target: { type: 'note', localId: 'local-note' } },
    ],
  })
  assert.equal((storageState.savedFolders as SavedFolderRecord[])[0].name, 'Pending local folder')
  assert.deepEqual(
    (storageState.savedNotes as SavedNoteRecord[]).map((note) => [
      note.filename,
      note.title,
      note.folderName,
    ]),
    [['Pending local filename', 'Local title', 'Pending local folder']],
  )

  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome
}

void testCloudNameReconciliation().then(() => {
  console.info('Cloud library identity checks passed.')
})
