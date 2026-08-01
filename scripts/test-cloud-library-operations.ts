import assert from 'node:assert/strict'
import type { FolderDto, NoteDto, TrashFolderGroup } from '../packages/shared/src/index'
import {
  createCloudFolderOperationTarget,
  createCloudNoteOperationTarget,
  resolveCloudLibraryOperationCloudId,
} from '../extension/lib/cloud-library-operation-queue'
import { syncCloudLibraryOperation } from '../extension/lib/cloud-api'

function folder(id: string, name: string): FolderDto {
  return { id, name, noteCount: 0, updatedAt: '2026-07-31T00:00:00.000Z' }
}

function note(id: string, folderId: string, sourceUrl: string): NoteDto {
  return {
    id,
    folderId,
    folderName: folderId,
    filename: id,
    title: id,
    authorName: 'Author',
    sourceUrl,
    coverImageUrl: '',
    contentText: '',
    savedAt: '2026-07-31T00:00:00.000Z',
    learningStatus: 'ready',
    qualityFlags: [],
  }
}

function trashGroup(
  folderId: string,
  folderName: string,
  notes: NoteDto[],
): TrashFolderGroup {
  return {
    id: `deleted-folder-${folderId}`,
    folderId,
    folderName,
    deletedAt: '2026-07-31T00:00:00.000Z',
    folderDeleted: true,
    notes: notes.map((entry) => ({
      id: `${folderId}-${entry.id}`,
      trashItemId: folderId,
      source: 'folder',
      deletedAt: '2026-07-31T00:00:00.000Z',
      note: entry,
      snippets: [],
    })),
  }
}

const activeNote = note('cloud-note', 'cloud-folder', 'https://example.com/note')
const deletedNote = note('deleted-note', 'deleted-folder', 'https://example.com/deleted')
const deletedFolderGroup = trashGroup('deleted-folder', 'Deleted folder', [deletedNote])
const snapshot = {
  folders: [folder('cloud-folder', 'Cloud folder'), folder('empty-folder', 'Empty folder')],
  notes: [activeNote],
  trashGroups: [deletedFolderGroup],
}

assert.equal(
  resolveCloudLibraryOperationCloudId(
    createCloudNoteOperationTarget({
      id: 'local-note',
      folderId: 'local-folder',
      folderName: 'Local folder',
      filename: 'Local note',
      title: 'Local note',
      authorName: 'Author',
      sourceUrl: 'https://example.com/note?token=temporary',
      coverImageUrl: '',
      contentText: '',
      savedAt: '2026-07-31T00:00:00.000Z',
    }),
    snapshot,
  ),
  'cloud-note',
)

assert.equal(
  resolveCloudLibraryOperationCloudId(
    {
      type: 'note',
      localId: 'local-deleted-note',
      sourceUrl: 'https://example.com/deleted?token=temporary',
    },
    snapshot,
  ),
  'deleted-note',
)

assert.equal(
  resolveCloudLibraryOperationCloudId(
    {
      type: 'folder',
      localId: 'local-deleted-folder',
      name: 'Renamed locally',
      noteSourceUrls: ['https://example.com/deleted?token=temporary'],
    },
    snapshot,
  ),
  'deleted-folder',
)

assert.equal(
  resolveCloudLibraryOperationCloudId(
    createCloudFolderOperationTarget(
      {
        id: 'local-empty-folder',
        name: 'Empty folder',
        noteCount: 0,
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
      [],
    ),
    snapshot,
  ),
  'empty-folder',
)

assert.equal(
  resolveCloudLibraryOperationCloudId(
    {
      type: 'note',
      localId: 'ambiguous-note',
      sourceUrl: 'https://example.com/note',
    },
    {
      ...snapshot,
      trashGroups: [
        trashGroup('another-folder', 'Another folder', [
          note('another-note', 'another-folder', 'https://example.com/note'),
        ]),
      ],
    },
  ),
  null,
)

assert.equal(
  resolveCloudLibraryOperationCloudId(
    {
      type: 'folder',
      localId: 'mixed-folder',
      name: 'Cloud folder',
      noteSourceUrls: ['https://example.com/note', 'https://example.com/deleted'],
    },
    snapshot,
  ),
  null,
)

assert.equal(
  resolveCloudLibraryOperationCloudId(
    {
      type: 'note',
      localId: 'known-note',
      cloudId: 'known-cloud-id',
      sourceUrl: 'https://example.com/changed',
    },
    snapshot,
  ),
  'known-cloud-id',
)

async function testCloudRequests() {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init })
    return Response.json({ ok: true })
  }

  try {
    await syncCloudLibraryOperation('test-token', {
      action: 'delete',
      resourceType: 'note',
      cloudId: 'cloud-note',
    })
    await syncCloudLibraryOperation('test-token', {
      action: 'restore',
      resourceType: 'folder',
      cloudId: 'cloud-folder',
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    requests.map((request) => [request.url, request.init?.method]),
    [
      ['https://lumos-ai-writer.pages.dev/api/v1/notes/cloud-note', 'DELETE'],
      ['https://lumos-ai-writer.pages.dev/api/v1/folders/cloud-folder/restore', 'POST'],
    ],
  )
  assert.equal(
    (requests[0].init?.headers as Record<string, string>).Authorization,
    'Bearer test-token',
  )
}

void testCloudRequests().then(() => {
  console.info('Cloud library operation checks passed.')
})
