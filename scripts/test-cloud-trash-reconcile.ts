import assert from 'node:assert/strict'
import type { SavedFolderRecord, SavedNoteRecord, TrashFolderGroup } from '@lumos-ai/shared'
import { buildCloudTrashDeletionPlan } from '../extension/lib/cloud-trash-reconcile'
import { applyCloudTrashSnapshot } from '../extension/lib/cloud-trash-storage'

const folders: SavedFolderRecord[] = [
  { id: 'local-test-folder', name: '验收-可删除', noteCount: 2, updatedAt: '2026-07-31T10:00:00.000Z' },
  { id: 'local-real-folder', name: '勋章文案', noteCount: 1, updatedAt: '2026-07-31T09:00:00.000Z' },
]

const notes: SavedNoteRecord[] = [
  {
    id: 'local-note-1',
    folderId: 'local-test-folder',
    folderName: '验收-可删除',
    filename: '测试一',
    title: '测试一',
    authorName: '作者',
    sourceUrl: 'https://www.xiaohongshu.com/explore/test-1?token=old',
    coverImageUrl: '',
    contentText: '内容',
    savedAt: '2026-07-31T10:00:00.000Z',
  },
  {
    id: 'local-note-2',
    folderId: 'local-test-folder',
    folderName: '验收-可删除',
    filename: '测试二',
    title: '测试二',
    authorName: '作者',
    sourceUrl: 'https://www.xiaohongshu.com/explore/test-2',
    coverImageUrl: '',
    contentText: '内容',
    savedAt: '2026-07-31T10:01:00.000Z',
  },
  {
    id: 'local-note-real',
    folderId: 'local-real-folder',
    folderName: '勋章文案',
    filename: '真实素材',
    title: '真实素材',
    authorName: '作者',
    sourceUrl: 'https://www.xiaohongshu.com/explore/real',
    coverImageUrl: '',
    contentText: '内容',
    savedAt: '2026-07-31T09:00:00.000Z',
  },
]

function createTrashGroup(input: {
  folderId: string
  folderName: string
  folderDeleted: boolean
  notes: SavedNoteRecord[]
}): TrashFolderGroup {
  return {
    id: `group-${input.folderId}`,
    folderId: input.folderId,
    folderName: input.folderName,
    deletedAt: '2026-07-31T11:00:00.000Z',
    folderDeleted: input.folderDeleted,
    notes: input.notes.map((note) =>
      ({
        id: `entry-${note.id}`,
        trashItemId: note.id,
        source: input.folderDeleted ? 'folder' : 'note',
        deletedAt: '2026-07-31T11:00:00.000Z',
        note: {
          ...note,
          id: `cloud-${note.id}`,
          folderId: input.folderId,
          folderName: input.folderName,
          sourceUrl: `${note.sourceUrl.split('?')[0]}?token=cloud`,
          learningStatus: 'ready',
          qualityFlags: [],
        },
        snippets: [],
      }) satisfies TrashFolderGroup['notes'][number],
    ),
  }
}

const deletedFolderPlan = buildCloudTrashDeletionPlan({
  folders,
  notes,
  groups: [
    createTrashGroup({
      folderId: 'cloud-test-folder',
      folderName: '验收-可删除',
      folderDeleted: true,
      notes: notes.slice(0, 2),
    }),
  ],
})
assert.deepEqual(deletedFolderPlan, { folderIds: ['local-test-folder'], noteIds: [] })

const deletedNotePlan = buildCloudTrashDeletionPlan({
  folders,
  notes,
  groups: [
    createTrashGroup({
      folderId: 'cloud-real-folder',
      folderName: '勋章文案',
      folderDeleted: false,
      notes: [notes[2]],
    }),
  ],
})
assert.deepEqual(deletedNotePlan, { folderIds: [], noteIds: ['local-note-real'] })

const unrelatedPlan = buildCloudTrashDeletionPlan({
  folders,
  notes,
  groups: [
    createTrashGroup({
      folderId: 'cloud-other-folder',
      folderName: '验收-可删除',
      folderDeleted: true,
      notes: [
        {
          ...notes[0],
          id: 'other-note',
          sourceUrl: 'https://www.xiaohongshu.com/explore/other',
        },
      ],
    }),
  ],
})
assert.deepEqual(unrelatedPlan, { folderIds: [], noteIds: [] })

const localOnlyNotePlan = buildCloudTrashDeletionPlan({
  folders,
  notes,
  groups: [
    createTrashGroup({
      folderId: 'cloud-test-folder',
      folderName: '验收-可删除',
      folderDeleted: true,
      notes: [notes[0]],
    }),
  ],
})
assert.deepEqual(localOnlyNotePlan, { folderIds: [], noteIds: ['local-note-1'] })

async function testStorageApplication() {
  const storageState: Record<string, unknown> = {
    savedFolders: structuredClone(folders),
    savedNotes: structuredClone(notes),
    savedSnippets: [
      {
        id: 'snippet-test',
        noteUrl: notes[0].sourceUrl,
        noteTitle: notes[0].title,
        noteAuthorName: notes[0].authorName,
        selectedText: '片段',
        reasonText: '理由',
        colorTagName: '整体',
        colorValue: '#000000',
      },
    ],
    trashItems: [],
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

  const cloudFolderTrash = createTrashGroup({
    folderId: 'cloud-test-folder',
    folderName: '验收-可删除',
    folderDeleted: true,
    notes: notes.slice(0, 2),
  })
  const appliedResult = await applyCloudTrashSnapshot([cloudFolderTrash])
  assert.deepEqual(appliedResult, { deletedFolderCount: 1, deletedNoteCount: 0 })
  assert.deepEqual(
    (storageState.savedFolders as SavedFolderRecord[]).map((folder) => [
      folder.id,
      folder.noteCount,
    ]),
    [['local-real-folder', 1]],
  )
  assert.deepEqual(
    (storageState.savedNotes as SavedNoteRecord[]).map((note) => note.id),
    ['local-note-real'],
  )
  assert.equal((storageState.savedSnippets as unknown[]).length, 0)
  assert.equal((storageState.trashItems as Array<{ type: string; notes: unknown[] }>).length, 1)
  assert.equal(
    (storageState.trashItems as Array<{ type: string; notes: unknown[] }>)[0].type,
    'folder',
  )
  assert.equal(
    (storageState.trashItems as Array<{ type: string; notes: unknown[] }>)[0].notes.length,
    2,
  )

  const repeatedResult = await applyCloudTrashSnapshot([cloudFolderTrash])
  assert.deepEqual(repeatedResult, { deletedFolderCount: 0, deletedNoteCount: 0 })
  assert.equal((storageState.trashItems as unknown[]).length, 1)

  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome
}

testStorageApplication()
  .then(() => console.info('Cloud trash reconcile checks passed.'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
