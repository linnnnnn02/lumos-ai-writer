import assert from 'node:assert/strict'
import type {
  FolderDto,
  NoteDto,
  SavedFolderRecord,
  SavedNoteRecord,
} from '../packages/shared/src/index'
import { buildCloudLibraryIdentityPlan } from '../extension/lib/cloud-library-identity'

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

console.info('Cloud library identity checks passed.')
