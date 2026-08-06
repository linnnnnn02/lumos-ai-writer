import type {
  NoteLearningStatus,
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
} from '@lumos-ai/shared'
import { normalizeNoteUrl } from '@lumos-ai/shared'
import {
  createFolder as createFolderRequest,
  createSnippet as createSnippetRequest,
  deleteFolder as deleteFolderRequest,
  deleteFolderPermanently as deleteFolderPermanentlyRequest,
  deleteNote as deleteNoteRequest,
  deleteNotePermanently as deleteNotePermanentlyRequest,
  deleteSnippet as deleteSnippetRequest,
  emptyTrash as emptyTrashRequest,
  restoreFolder as restoreFolderRequest,
  restoreNote as restoreNoteRequest,
  updateFolder as updateFolderRequest,
  updateNote as updateNoteRequest,
  updateNoteLearningStatus as updateNoteLearningStatusRequest,
  updateSnippet as updateSnippetRequest,
  upsertNote as upsertNoteRequest,
} from '@/lib/api-client'
import { getCurrentAccessToken } from '@/lib/supabase-browser'
import type { CloudLibraryCacheAction } from './cloud-library-cache-state'

export type LibraryNoteDraft = {
  authorName: string
  contentText: string
  filename: string
  folderId: string
  title: string
}

export type LibrarySnippetDraft = {
  id: string
  colorTagName: string
  colorValue: string
  reasonText: string
  selectedText: string
}

type CloudLibraryActionBridge = {
  commitMutation: (action: CloudLibraryCacheAction) => void
  refresh: () => void
}

type CreateCloudLibraryActionsOptions = {
  cloudLibrary: CloudLibraryActionBridge
  folders: SavedFolderRecord[]
  snippets: SavedSnippetRecord[]
  onItemsRemoved: (itemIds: string[]) => void
}

async function getLibraryAccessToken() {
  const accessToken = await getCurrentAccessToken()
  if (!accessToken) {
    throw new Error('登录状态已过期，请重新登录后再管理文案库。')
  }
  return accessToken
}

export function createCloudLibraryActions({
  cloudLibrary,
  folders,
  snippets,
  onItemsRemoved,
}: CreateCloudLibraryActionsOptions) {
  async function handleCreateLibraryFolder(name: string) {
    const accessToken = await getLibraryAccessToken()
    const response = await createFolderRequest(accessToken, { name })
    cloudLibrary.commitMutation({ type: 'upsert-folder', folder: response.folder })
  }

  async function handleUpdateLibraryFolder(folder: SavedFolderRecord, name: string) {
    const accessToken = await getLibraryAccessToken()
    try {
      const response = await updateFolderRequest(accessToken, folder.id, {
        name,
        expectedUpdatedAt: folder.updatedAt,
      })
      cloudLibrary.commitMutation({ type: 'upsert-folder', folder: response.folder })
      return response.folder
    } catch (error) {
      cloudLibrary.refresh()
      throw error
    }
  }

  async function handleDeleteLibraryFolder(folder: SavedFolderRecord) {
    const accessToken = await getLibraryAccessToken()
    await deleteFolderRequest(accessToken, folder.id)
    cloudLibrary.commitMutation({
      type: 'soft-delete-folder',
      folderId: folder.id,
      deletedAt: new Date().toISOString(),
    })
  }

  async function handleSaveLibraryNote(note: SavedNoteRecord, draft: LibraryNoteDraft) {
    const accessToken = await getLibraryAccessToken()
    const folderId = folders.some((folder) => folder.id === draft.folderId)
      ? draft.folderId
      : null
    const filename = draft.filename || draft.title || note.filename
    const title = draft.title || draft.filename || note.title
    const isNameOnlyUpdate =
      Boolean(note.updatedAt) &&
      draft.authorName === note.authorName &&
      draft.contentText === note.contentText &&
      folderId === (note.folderId || null)

    try {
      if (isNameOnlyUpdate && note.updatedAt) {
        const response = await updateNoteRequest(accessToken, note.id, {
          filename,
          title,
          expectedUpdatedAt: note.updatedAt,
        })
        const updatedNote = {
          ...response.note,
          coverImageUrl: response.note.coverImageUrl ?? '',
        }
        cloudLibrary.commitMutation({ type: 'upsert-note', note: updatedNote })
        return updatedNote
      }

      const response = await upsertNoteRequest(accessToken, {
        authorName: draft.authorName,
        contentText: draft.contentText,
        coverImageUrl: note.coverImageUrl ?? '',
        filename,
        folderId,
        savedAt: note.savedAt,
        sourceUrl: note.sourceUrl,
        title,
      })
      const updatedNote = {
        ...response.note,
        coverImageUrl: response.note.coverImageUrl ?? '',
      }
      cloudLibrary.commitMutation({ type: 'upsert-note', note: updatedNote })
      return updatedNote
    } catch (error) {
      cloudLibrary.refresh()
      throw error
    }
  }

  async function handleDeleteLibraryNote(note: SavedNoteRecord) {
    const accessToken = await getLibraryAccessToken()
    await deleteNoteRequest(accessToken, note.id)
    cloudLibrary.commitMutation({
      type: 'soft-delete-note',
      noteId: note.id,
      deletedAt: new Date().toISOString(),
    })

    const normalizedNoteUrl = normalizeNoteUrl(note.sourceUrl)
    const removedSnippetIds = snippets
      .filter((snippet) => normalizeNoteUrl(snippet.noteUrl) === normalizedNoteUrl)
      .map((snippet) => `snippet:${snippet.id}`)
    onItemsRemoved([`note:${note.id}`, ...removedSnippetIds])
  }

  async function handleUpdateLibraryNoteLearningStatus(
    note: SavedNoteRecord,
    status: Extract<NoteLearningStatus, 'ready' | 'excluded'>,
  ) {
    const accessToken = await getLibraryAccessToken()
    await updateNoteLearningStatusRequest(accessToken, note.id, { status })
    cloudLibrary.commitMutation({
      type: 'set-note-learning-status',
      noteId: note.id,
      status,
    })
  }

  async function handleRestoreLibraryFolder(folderId: string) {
    const accessToken = await getLibraryAccessToken()
    await restoreFolderRequest(accessToken, folderId)
    cloudLibrary.commitMutation({
      type: 'restore-folder',
      folderId,
      restoredAt: new Date().toISOString(),
    })
  }

  async function handleRestoreLibraryNote(noteId: string) {
    const accessToken = await getLibraryAccessToken()
    await restoreNoteRequest(accessToken, noteId)
    cloudLibrary.commitMutation({
      type: 'restore-note',
      noteId,
      restoredAt: new Date().toISOString(),
    })
  }

  async function handleDeleteLibraryFolderPermanently(folderId: string) {
    const accessToken = await getLibraryAccessToken()
    await deleteFolderPermanentlyRequest(accessToken, folderId)
    cloudLibrary.commitMutation({ type: 'delete-folder-permanently', folderId })
  }

  async function handleDeleteLibraryNotePermanently(noteId: string) {
    const accessToken = await getLibraryAccessToken()
    await deleteNotePermanentlyRequest(accessToken, noteId)
    cloudLibrary.commitMutation({ type: 'delete-note-permanently', noteId })
  }

  async function handleEmptyLibraryTrash() {
    const accessToken = await getLibraryAccessToken()
    await emptyTrashRequest(accessToken)
    cloudLibrary.commitMutation({ type: 'empty-trash' })
  }

  async function handleSaveLibraryNoteSnippets(
    note: SavedNoteRecord,
    drafts: LibrarySnippetDraft[],
    existingSnippets: SavedSnippetRecord[],
  ) {
    const accessToken = await getLibraryAccessToken()
    const existingIds = new Set(existingSnippets.map((snippet) => snippet.id))
    const savedDraftIds = new Set<string>()
    const savedSnippets: SavedSnippetRecord[] = []

    try {
      for (const draft of drafts) {
        const selectedText = draft.selectedText.trim()
        if (!selectedText) continue

        if (existingIds.has(draft.id)) {
          const response = await updateSnippetRequest(accessToken, draft.id, {
            colorTagName: draft.colorTagName,
            colorValue: draft.colorValue,
            reasonText: draft.reasonText,
            selectedText,
          })
          savedDraftIds.add(draft.id)
          savedSnippets.push(response.snippet)
          continue
        }

        const response = await createSnippetRequest(accessToken, {
          noteId: note.id,
          colorTagName: draft.colorTagName,
          colorValue: draft.colorValue,
          reasonText: draft.reasonText,
          selectedText,
        })
        savedSnippets.push(response.snippet)
      }

      for (const snippet of existingSnippets) {
        if (savedDraftIds.has(snippet.id)) continue
        await deleteSnippetRequest(accessToken, snippet.id)
      }

      cloudLibrary.commitMutation({
        type: 'replace-note-snippets',
        noteUrl: note.sourceUrl,
        snippets: savedSnippets,
      })
      return savedSnippets
    } catch (error) {
      cloudLibrary.refresh()
      throw error
    }
  }

  return {
    handleCreateLibraryFolder,
    handleDeleteLibraryFolder,
    handleDeleteLibraryFolderPermanently,
    handleDeleteLibraryNote,
    handleDeleteLibraryNotePermanently,
    handleEmptyLibraryTrash,
    handleRestoreLibraryFolder,
    handleRestoreLibraryNote,
    handleSaveLibraryNote,
    handleSaveLibraryNoteSnippets,
    handleUpdateLibraryFolder,
    handleUpdateLibraryNoteLearningStatus,
  }
}
