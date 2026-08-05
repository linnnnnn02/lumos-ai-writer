import { defineContentScript } from 'wxt/utils/define-content-script'
import type {
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
} from '@lumos-ai/shared'

const PAGE_SOURCE = 'lumos-web'
const EXTENSION_SOURCE = 'lumos-extension'
const SNAPSHOT_REQUEST = 'LUMOS_LIBRARY_SNAPSHOT_REQUEST'
const SNAPSHOT_RESPONSE = 'LUMOS_LIBRARY_SNAPSHOT_RESPONSE'
const BRIDGE_READY = 'LUMOS_LIBRARY_BRIDGE_READY'
const LIBRARY_CHANGED = 'LUMOS_LIBRARY_CHANGED'
const OPEN_LIBRARY_REQUEST = 'LUMOS_OPEN_EXTENSION_LIBRARY_REQUEST'
const FOLDERS_STORAGE_KEY = 'savedFolders'
const NOTES_STORAGE_KEY = 'savedNotes'
const SNIPPETS_STORAGE_KEY = 'savedSnippets'
const LIBRARY_STORAGE_KEYS = new Set([
  FOLDERS_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  SNIPPETS_STORAGE_KEY,
])

function createDefaultFolders(): SavedFolderRecord[] {
  const updatedAt = new Date().toISOString()
  return [
    { id: 'default-folder-beauty', name: '护肤口播感', noteCount: 0, updatedAt },
    { id: 'default-folder-lifestyle', name: '生活方式笔记', noteCount: 0, updatedAt },
  ]
}

function reconcileFolderNoteCounts(
  folders: SavedFolderRecord[],
  notes: SavedNoteRecord[],
) {
  const noteCountByFolderId = new Map<string, number>()
  notes.forEach((note) => {
    if (!note.folderId) return
    noteCountByFolderId.set(note.folderId, (noteCountByFolderId.get(note.folderId) ?? 0) + 1)
  })

  return folders.map((folder) => ({
    ...folder,
    noteCount: noteCountByFolderId.get(folder.id) ?? 0,
  }))
}

function postToPage(message: Record<string, unknown>) {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      ...message,
    },
    window.location.origin,
  )
}

export default defineContentScript({
  matches: ['https://lumos-ai-writer.pages.dev/*'],
  main() {
    async function handleMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return
      if (!event.data || typeof event.data !== 'object') return

      const message = event.data as Record<string, unknown>
      if (message.source !== PAGE_SOURCE) return
      if (message.type === OPEN_LIBRARY_REQUEST) {
        void chrome.runtime.openOptionsPage()
        return
      }
      if (message.type !== SNAPSHOT_REQUEST) return
      if (typeof message.requestId !== 'string' || !message.requestId) return

      try {
        const storage = await chrome.storage.local.get([
          FOLDERS_STORAGE_KEY,
          NOTES_STORAGE_KEY,
          SNIPPETS_STORAGE_KEY,
        ])
        const notes =
          (storage[NOTES_STORAGE_KEY] as SavedNoteRecord[] | undefined) ?? []
        const snippets =
          (storage[SNIPPETS_STORAGE_KEY] as SavedSnippetRecord[] | undefined) ?? []
        const storedFolders =
          (storage[FOLDERS_STORAGE_KEY] as SavedFolderRecord[] | undefined) ??
          createDefaultFolders()
        const folders = reconcileFolderNoteCounts(storedFolders, notes)

        postToPage({
          type: SNAPSHOT_RESPONSE,
          requestId: message.requestId,
          ok: true,
          payload: { folders, notes, snippets },
        })
      } catch (error) {
        postToPage({
          type: SNAPSHOT_RESPONSE,
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : '插件文案库读取失败',
        })
      }
    }

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== 'local') return
      if (!Object.keys(changes).some((key) => LIBRARY_STORAGE_KEYS.has(key))) return
      postToPage({ type: LIBRARY_CHANGED })
    }

    window.addEventListener('message', handleMessage)
    chrome.storage.onChanged.addListener(handleStorageChange)
    postToPage({ type: BRIDGE_READY })
  },
})
