import {
  normalizeNoteUrl,
  type PendingSnippetSelectionRecord,
  type SavedFolderRecord,
  type SavedNoteRecord,
  type SavedSnippetRecord,
} from '@lumos-ai/shared'

export const FOLDERS_STORAGE_KEY = 'savedFolders'
export const NOTES_STORAGE_KEY = 'savedNotes'
export const SNIPPETS_STORAGE_KEY = 'savedSnippets'
export const PENDING_SNIPPET_SELECTION_KEY = 'pendingSnippetSelection'
export const FOLDER_TAG_NAMES_STORAGE_KEY = 'folderTagNames'
export const COLOR_TAG_NAMES_STORAGE_KEY = 'colorTagNames'
export const TRASH_STORAGE_KEY = 'trashItems'
const PREVIEW_STORAGE_KEY = 'lumos-ai-writer-preview-storage-v1'
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export type TrashedNoteItem = {
  id: string
  type: 'note'
  deletedAt: string
  folder: SavedFolderRecord | null
  note: SavedNoteRecord
  snippets: SavedSnippetRecord[]
}

export type TrashedFolderItem = {
  id: string
  type: 'folder'
  deletedAt: string
  folder: SavedFolderRecord
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
}

export type TrashItem = TrashedNoteItem | TrashedFolderItem

type StorageShape = {
  [FOLDERS_STORAGE_KEY]?: SavedFolderRecord[]
  [NOTES_STORAGE_KEY]?: SavedNoteRecord[]
  [SNIPPETS_STORAGE_KEY]?: SavedSnippetRecord[]
  [PENDING_SNIPPET_SELECTION_KEY]?: PendingSnippetSelectionRecord | null
  [FOLDER_TAG_NAMES_STORAGE_KEY]?: Record<string, Record<string, string>>
  [COLOR_TAG_NAMES_STORAGE_KEY]?: Record<string, string>
  [TRASH_STORAGE_KEY]?: TrashItem[]
}

export function createDefaultFolders(): SavedFolderRecord[] {
  return [
    {
      id: 'default-folder-beauty',
      name: '护肤口播感',
      noteCount: 0,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'default-folder-lifestyle',
      name: '生活方式笔记',
      noteCount: 0,
      updatedAt: new Date().toISOString(),
    },
  ]
}

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function createPreviewStorage(): Required<StorageShape> {
  const now = Date.now()
  const folders: SavedFolderRecord[] = [
    {
      id: 'preview-folder-hook',
      name: '爆款开头拆解',
      noteCount: 0,
      updatedAt: new Date(now - 1000 * 60 * 18).toISOString(),
    },
    {
      id: 'preview-folder-tone',
      name: '温柔种草语气',
      noteCount: 0,
      updatedAt: new Date(now - 1000 * 60 * 60 * 6).toISOString(),
    },
    {
      id: 'preview-folder-life',
      name: '生活方式选题',
      noteCount: 0,
      updatedAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
    },
  ]

  const notes: SavedNoteRecord[] = [
    {
      id: 'preview-note-1',
      folderId: 'preview-folder-hook',
      folderName: '爆款开头拆解',
      filename: '一句话把痛点说透',
      title: '一句话把痛点说透',
      authorName: '阿眠',
      sourceUrl: 'https://www.xiaohongshu.com/explore/preview-1',
      coverImageUrl:
        'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?auto=format&fit=crop&w=720&q=80',
      contentText:
        '很多人不是不会变好看，而是一直在用不适合自己的方法。今天把我踩过的坑整理成一张清单，照着改就能少走很多弯路。',
      savedAt: new Date(now - 1000 * 60 * 22).toISOString(),
    },
    {
      id: 'preview-note-2',
      folderId: 'preview-folder-hook',
      folderName: '爆款开头拆解',
      filename: '反常识开头',
      title: '反常识开头',
      authorName: '小岛',
      sourceUrl: 'https://www.xiaohongshu.com/explore/preview-2',
      coverImageUrl:
        'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=720&q=80',
      contentText:
        '别再一上来就夸产品好用了。真正让人停下来的，是你先说出她心里那个没被说出口的小尴尬。',
      savedAt: new Date(now - 1000 * 60 * 58).toISOString(),
    },
    {
      id: 'preview-note-3',
      folderId: 'preview-folder-hook',
      folderName: '爆款开头拆解',
      filename: '强场景代入',
      title: '强场景代入',
      authorName: '梨子',
      sourceUrl: 'https://www.xiaohongshu.com/explore/preview-3',
      coverImageUrl:
        'https://images.unsplash.com/photo-1526045478516-99145907023c?auto=format&fit=crop&w=720&q=80',
      contentText:
        '如果你也经常早上赶时间、脸上又干又卡粉，先别急着换粉底，可能只是妆前顺序错了。',
      savedAt: new Date(now - 1000 * 60 * 85).toISOString(),
    },
    {
      id: 'preview-note-4',
      folderId: 'preview-folder-tone',
      folderName: '温柔种草语气',
      filename: '像朋友一样提醒',
      title: '像朋友一样提醒',
      authorName: '南枝',
      sourceUrl: 'https://www.xiaohongshu.com/explore/preview-4',
      coverImageUrl:
        'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=720&q=80',
      contentText:
        '这个方法不是立刻惊艳的那种，但它很适合慢慢把状态养回来。尤其是熬夜后脸色暗的人，可以先试三天。',
      savedAt: new Date(now - 1000 * 60 * 60 * 7).toISOString(),
    },
    {
      id: 'preview-note-5',
      folderId: 'preview-folder-life',
      folderName: '生活方式选题',
      filename: '周末自救清单',
      title: '周末自救清单',
      authorName: '一只杯子',
      sourceUrl: 'https://www.xiaohongshu.com/explore/preview-5',
      coverImageUrl:
        'https://images.unsplash.com/photo-1522441815192-d9f04eb0615c?auto=format&fit=crop&w=720&q=80',
      contentText:
        '我发现状态变差的时候，不一定需要做很多事。把房间、冰箱、手机相册这三个地方整理一下，人会轻一点。',
      savedAt: new Date(now - 1000 * 60 * 60 * 28).toISOString(),
    },
  ]

  const snippets: SavedSnippetRecord[] = [
    {
      id: 'preview-snippet-1',
      noteUrl: notes[0].sourceUrl,
      noteTitle: notes[0].title,
      noteAuthorName: notes[0].authorName,
      selectedText: '很多人不是不会变好看，而是一直在用不适合自己的方法。',
      reasonText: '开头先替用户解释问题，压力感低。',
      colorTagName: '开头钩子',
      colorValue: '#DD6C32',
      createdAt: new Date(now - 1000 * 60 * 20).toISOString(),
    },
    {
      id: 'preview-snippet-2',
      noteUrl: notes[1].sourceUrl,
      noteTitle: notes[1].title,
      noteAuthorName: notes[1].authorName,
      selectedText: '先说出她心里那个没被说出口的小尴尬。',
      reasonText: '很适合做用户洞察。',
      colorTagName: '用户洞察',
      colorValue: '#E9C46A',
      createdAt: new Date(now - 1000 * 60 * 49).toISOString(),
    },
    {
      id: 'preview-snippet-3',
      noteUrl: notes[2].sourceUrl,
      noteTitle: notes[2].title,
      noteAuthorName: notes[2].authorName,
      selectedText: '早上赶时间、脸上又干又卡粉',
      reasonText: '场景很具体。',
      colorTagName: '场景',
      colorValue: '#2A9D8F',
      createdAt: new Date(now - 1000 * 60 * 80).toISOString(),
    },
    {
      id: 'preview-snippet-4',
      noteUrl: notes[3].sourceUrl,
      noteTitle: notes[3].title,
      noteAuthorName: notes[3].authorName,
      selectedText: '不是立刻惊艳的那种，但它很适合慢慢把状态养回来。',
      reasonText: '语气真诚，不像硬广。',
      colorTagName: '文风',
      colorValue: '#4D78F2',
      createdAt: new Date(now - 1000 * 60 * 60 * 6).toISOString(),
    },
  ]

  return {
    [FOLDERS_STORAGE_KEY]: folders.map((folder) => ({
      ...folder,
      noteCount: notes.filter((note) => note.folderId === folder.id).length,
    })),
    [NOTES_STORAGE_KEY]: notes,
    [SNIPPETS_STORAGE_KEY]: snippets,
    [FOLDER_TAG_NAMES_STORAGE_KEY]: {
      'preview-folder-hook': {
        '#DD6C32': '开头钩子',
        '#E9C46A': '用户洞察',
        '#2A9D8F': '场景',
      },
      'preview-folder-tone': {
        '#4D78F2': '文风',
      },
    },
    [COLOR_TAG_NAMES_STORAGE_KEY]: {
      '#DD6C32': '开头钩子',
      '#E9C46A': '用户洞察',
      '#2A9D8F': '场景',
      '#4D78F2': '文风',
    },
    [TRASH_STORAGE_KEY]: [],
    [PENDING_SNIPPET_SELECTION_KEY]: {
      selectedText: '很多人不是不会变好看，而是一直在用不适合自己的方法。',
      noteUrl: notes[0].sourceUrl,
      noteTitle: notes[0].title,
      noteAuthorName: notes[0].authorName,
      createdAt: new Date(now - 1000 * 40).toISOString(),
    },
  }
}

function readPreviewStorage(): Required<StorageShape> {
  try {
    const raw = globalThis.localStorage?.getItem(PREVIEW_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Required<StorageShape>
  } catch {
    // Ignore malformed local preview data and recreate it below.
  }

  const seeded = createPreviewStorage()
  try {
    globalThis.localStorage?.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(seeded))
  } catch {
    // Local preview can still render even when localStorage is unavailable.
  }
  return seeded
}

async function storageGet(keys: string | string[]) {
  if (hasChromeStorage()) {
    return chrome.storage.local.get(keys)
  }

  const preview = readPreviewStorage()
  const selectedKeys = Array.isArray(keys) ? keys : [keys]
  return selectedKeys.reduce<Record<string, unknown>>((result, key) => {
    result[key] = preview[key as keyof StorageShape]
    return result
  }, {})
}

async function storageSet(values: StorageShape) {
  if (hasChromeStorage()) {
    await chrome.storage.local.set(values)
    return
  }

  const preview = {
    ...readPreviewStorage(),
    ...values,
  }
  try {
    globalThis.localStorage?.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(preview))
  } catch {
    // Non-extension preview only; failing to persist should not break rendering.
  }
}

export async function getSavedNotes() {
  const storage = await storageGet(NOTES_STORAGE_KEY)
  return (storage[NOTES_STORAGE_KEY] as SavedNoteRecord[] | undefined) ?? []
}

export async function getSavedSnippets() {
  const [storage, colorTagNames] = await Promise.all([
    storageGet(SNIPPETS_STORAGE_KEY),
    getColorTagNames(),
  ])
  const snippets = (storage[SNIPPETS_STORAGE_KEY] as SavedSnippetRecord[] | undefined) ?? []

  return snippets.map((snippet) => {
    const color = snippet.colorValue || ''
    if (!Object.prototype.hasOwnProperty.call(colorTagNames, color)) return snippet
    const globalTagName = colorTagNames[color]

    return {
      ...snippet,
      colorTagName: globalTagName,
    }
  })
}

export async function getFolderTagNames() {
  const storage = await storageGet(FOLDER_TAG_NAMES_STORAGE_KEY)
  return (
    (storage[FOLDER_TAG_NAMES_STORAGE_KEY] as Record<string, Record<string, string>> | undefined) ??
    {}
  )
}

export async function saveFolderTagNames(tagNames: Record<string, Record<string, string>>) {
  await storageSet({
    [FOLDER_TAG_NAMES_STORAGE_KEY]: tagNames,
  })
}

function flattenFolderTagNames(
  folderTagNames: Record<string, Record<string, string>> | undefined,
) {
  const colorTagNames: Record<string, string> = {}

  Object.values(folderTagNames ?? {}).forEach((tagNames) => {
    Object.entries(tagNames ?? {}).forEach(([color, tagName]) => {
      const normalizedTagName = tagName.trim()
      if (!normalizedTagName || colorTagNames[color]) return
      colorTagNames[color] = normalizedTagName
    })
  })

  return colorTagNames
}

function areTagNamesEqual(left: Record<string, string>, right: Record<string, string>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) return false
  }

  return true
}

export async function getColorTagNames() {
  const storage = await storageGet([
    COLOR_TAG_NAMES_STORAGE_KEY,
    FOLDER_TAG_NAMES_STORAGE_KEY,
    SNIPPETS_STORAGE_KEY,
  ])
  const storedColorTagNames =
    (storage[COLOR_TAG_NAMES_STORAGE_KEY] as Record<string, string> | undefined) ?? {}
  const folderTagNames = storage[FOLDER_TAG_NAMES_STORAGE_KEY] as
    | Record<string, Record<string, string>>
    | undefined
  const snippets = (storage[SNIPPETS_STORAGE_KEY] as SavedSnippetRecord[] | undefined) ?? []
  const colorTagNames = {
    ...flattenFolderTagNames(folderTagNames),
    ...storedColorTagNames,
  }

  snippets.forEach((snippet) => {
    const color = snippet.colorValue || ''
    const tagName = snippet.colorTagName.trim()
    if (!color || !tagName || Object.prototype.hasOwnProperty.call(colorTagNames, color)) return
    colorTagNames[color] = tagName
  })

  if (!areTagNamesEqual(storedColorTagNames, colorTagNames)) {
    await storageSet({
      [COLOR_TAG_NAMES_STORAGE_KEY]: colorTagNames,
    })
  }

  return colorTagNames
}

export async function saveColorTagNames(tagNames: Record<string, string>) {
  await storageSet({
    [COLOR_TAG_NAMES_STORAGE_KEY]: tagNames,
  })
}

export async function getPendingSnippetSelection() {
  const storage = await storageGet(PENDING_SNIPPET_SELECTION_KEY)
  return (
    (storage[PENDING_SNIPPET_SELECTION_KEY] as PendingSnippetSelectionRecord | null | undefined) ??
    null
  )
}

export async function savePendingSnippetSelection(selection: PendingSnippetSelectionRecord | null) {
  await storageSet({
    [PENDING_SNIPPET_SELECTION_KEY]: selection,
  })
}

export async function clearPendingSnippetSelection() {
  await savePendingSnippetSelection(null)
}

export async function getSavedFolders() {
  const storage = await storageGet([FOLDERS_STORAGE_KEY, NOTES_STORAGE_KEY])
  const storedFolders =
    (storage[FOLDERS_STORAGE_KEY] as SavedFolderRecord[] | undefined) ?? createDefaultFolders()
  const storedNotes = (storage[NOTES_STORAGE_KEY] as SavedNoteRecord[] | undefined) ?? []

  const normalizedFolders = storedFolders.map((folder) => ({
    ...folder,
    noteCount: storedNotes.filter((note) => note.folderId === folder.id).length,
    updatedAt: folder.updatedAt || new Date().toISOString(),
  }))

  await storageSet({
    [FOLDERS_STORAGE_KEY]: normalizedFolders,
  })

  return normalizedFolders
}

export async function saveFolders(folders: SavedFolderRecord[]) {
  await storageSet({
    [FOLDERS_STORAGE_KEY]: folders,
  })
}

export async function saveNotes(notes: SavedNoteRecord[]) {
  await storageSet({
    [NOTES_STORAGE_KEY]: notes,
  })
}

export async function saveSnippets(snippets: SavedSnippetRecord[]) {
  await storageSet({
    [SNIPPETS_STORAGE_KEY]: snippets,
  })
}

function isTrashItemFresh(item: TrashItem, now = Date.now()) {
  const deletedAt = new Date(item.deletedAt).getTime()
  if (Number.isNaN(deletedAt)) return false
  return now - deletedAt < TRASH_RETENTION_MS
}

function createTrashItemId(type: TrashItem['type'], sourceId: string) {
  return `${type}-${sourceId}-${crypto.randomUUID()}`
}

export async function getTrashItems() {
  const storage = await storageGet(TRASH_STORAGE_KEY)
  const storedItems = (storage[TRASH_STORAGE_KEY] as TrashItem[] | undefined) ?? []
  const freshItems = storedItems.filter((item) => isTrashItemFresh(item))

  if (freshItems.length !== storedItems.length) {
    await storageSet({
      [TRASH_STORAGE_KEY]: freshItems,
    })
  }

  return freshItems
}

export async function saveTrashItems(items: TrashItem[]) {
  await storageSet({
    [TRASH_STORAGE_KEY]: items.filter((item) => isTrashItemFresh(item)),
  })
}

export async function deleteSavedNoteCascade(noteId: string) {
  const [folders, notes, snippets, trashItems] = await Promise.all([
    getSavedFolders(),
    getSavedNotes(),
    getSavedSnippets(),
    getTrashItems(),
  ])
  const targetNote = notes.find((note) => note.id === noteId)
  if (!targetNote) return

  const targetUrl = normalizeNoteUrl(targetNote.sourceUrl)
  const nextNotes = notes.filter((note) => note.id !== noteId)
  const targetSnippets = snippets.filter((snippet) => normalizeNoteUrl(snippet.noteUrl) === targetUrl)
  const nextSnippets = snippets.filter((snippet) => normalizeNoteUrl(snippet.noteUrl) !== targetUrl)
  const targetFolder = folders.find((folder) => folder.id === targetNote.folderId) ?? null
  const trashItem: TrashedNoteItem = {
    id: createTrashItemId('note', targetNote.id),
    type: 'note',
    deletedAt: new Date().toISOString(),
    folder: targetFolder,
    note: targetNote,
    snippets: targetSnippets,
  }

  await storageSet({
    [NOTES_STORAGE_KEY]: nextNotes,
    [SNIPPETS_STORAGE_KEY]: nextSnippets,
    [TRASH_STORAGE_KEY]: [trashItem, ...trashItems],
  })
}

export async function deleteSavedFolderCascade(folderId: string) {
  const [folders, notes, snippets, trashItems] = await Promise.all([
    getSavedFolders(),
    getSavedNotes(),
    getSavedSnippets(),
    getTrashItems(),
  ])

  const targetFolder = folders.find((folder) => folder.id === folderId)
  if (!targetFolder) return

  const folderNotes = notes.filter((note) => note.folderId === folderId)
  const noteUrlSet = new Set(folderNotes.map((note) => normalizeNoteUrl(note.sourceUrl)))
  const folderSnippets = snippets.filter((snippet) =>
    noteUrlSet.has(normalizeNoteUrl(snippet.noteUrl)),
  )

  const nextFolders = folders.filter((folder) => folder.id !== folderId)
  const nextNotes = notes.filter((note) => note.folderId !== folderId)
  const nextSnippets = snippets.filter(
    (snippet) => !noteUrlSet.has(normalizeNoteUrl(snippet.noteUrl)),
  )

  const ensuredFolders = nextFolders.length > 0 ? nextFolders : createDefaultFolders()
  const trashItem: TrashedFolderItem = {
    id: createTrashItemId('folder', folderId),
    type: 'folder',
    deletedAt: new Date().toISOString(),
    folder: targetFolder,
    notes: folderNotes,
    snippets: folderSnippets,
  }

  await storageSet({
    [FOLDERS_STORAGE_KEY]: ensuredFolders,
    [NOTES_STORAGE_KEY]: nextNotes,
    [SNIPPETS_STORAGE_KEY]: nextSnippets,
    [TRASH_STORAGE_KEY]: [trashItem, ...trashItems],
  })
}

export async function restoreTrashItem(itemId: string) {
  const [folders, notes, snippets, trashItems] = await Promise.all([
    getSavedFolders(),
    getSavedNotes(),
    getSavedSnippets(),
    getTrashItems(),
  ])
  const item = trashItems.find((trashItem) => trashItem.id === itemId)
  if (!item) return

  const nextTrashItems = trashItems.filter((trashItem) => trashItem.id !== itemId)
  const nextFolders = [...folders]
  const nextNotes = [...notes]
  const nextSnippets = [...snippets]

  function ensureFolder(folder: SavedFolderRecord | null) {
    if (!folder) return
    if (nextFolders.some((current) => current.id === folder.id)) return
    nextFolders.unshift({
      ...folder,
      updatedAt: new Date().toISOString(),
    })
  }

  function restoreNotes(restoredNotes: SavedNoteRecord[]) {
    restoredNotes.forEach((note) => {
      if (nextNotes.some((current) => normalizeNoteUrl(current.sourceUrl) === normalizeNoteUrl(note.sourceUrl))) {
        return
      }
      nextNotes.unshift(note)
    })
  }

  function restoreSnippets(restoredSnippets: SavedSnippetRecord[]) {
    restoredSnippets.forEach((snippet) => {
      if (nextSnippets.some((current) => current.id === snippet.id)) return
      nextSnippets.unshift(snippet)
    })
  }

  if (item.type === 'folder') {
    ensureFolder(item.folder)
    restoreNotes(item.notes)
    restoreSnippets(item.snippets)
  } else {
    ensureFolder(item.folder)
    restoreNotes([item.note])
    restoreSnippets(item.snippets)
  }

  await storageSet({
    [FOLDERS_STORAGE_KEY]: nextFolders,
    [NOTES_STORAGE_KEY]: nextNotes,
    [SNIPPETS_STORAGE_KEY]: nextSnippets,
    [TRASH_STORAGE_KEY]: nextTrashItems,
  })
}

export async function restoreTrashFolderNote(itemId: string, noteId: string) {
  const [folders, notes, snippets, trashItems] = await Promise.all([
    getSavedFolders(),
    getSavedNotes(),
    getSavedSnippets(),
    getTrashItems(),
  ])
  const item = trashItems.find((trashItem) => trashItem.id === itemId)
  if (!item || item.type !== 'folder') return

  const targetNote = item.notes.find((note) => note.id === noteId)
  if (!targetNote) return

  const now = new Date().toISOString()
  const targetUrl = normalizeNoteUrl(targetNote.sourceUrl)
  const nextFolders = [...folders]
  const nextNotes = [...notes]
  const nextSnippets = [...snippets]
  const restoredFolder = {
    ...item.folder,
    updatedAt: now,
  }

  if (!nextFolders.some((folder) => folder.id === restoredFolder.id)) {
    nextFolders.unshift(restoredFolder)
  }

  if (!nextNotes.some((note) => normalizeNoteUrl(note.sourceUrl) === targetUrl)) {
    nextNotes.unshift({
      ...targetNote,
      folderId: restoredFolder.id,
      folderName: restoredFolder.name,
    })
  }

  item.snippets
    .filter((snippet) => normalizeNoteUrl(snippet.noteUrl) === targetUrl)
    .forEach((snippet) => {
      if (nextSnippets.some((current) => current.id === snippet.id)) return
      nextSnippets.unshift(snippet)
    })

  const remainingNoteItems: TrashedNoteItem[] = item.notes
    .filter((note) => normalizeNoteUrl(note.sourceUrl) !== targetUrl)
    .map((note) => {
      const noteUrl = normalizeNoteUrl(note.sourceUrl)

      return {
        id: createTrashItemId('note', note.id),
        type: 'note',
        deletedAt: item.deletedAt,
        folder: restoredFolder,
        note: {
          ...note,
          folderId: restoredFolder.id,
          folderName: restoredFolder.name,
        },
        snippets: item.snippets.filter(
          (snippet) => normalizeNoteUrl(snippet.noteUrl) === noteUrl,
        ),
      }
    })

  await storageSet({
    [FOLDERS_STORAGE_KEY]: nextFolders,
    [NOTES_STORAGE_KEY]: nextNotes,
    [SNIPPETS_STORAGE_KEY]: nextSnippets,
    [TRASH_STORAGE_KEY]: trashItems.flatMap((trashItem) =>
      trashItem.id === item.id ? remainingNoteItems : [trashItem],
    ),
  })
}

export async function deleteTrashFolderNotePermanently(itemId: string, noteId: string) {
  const trashItems = await getTrashItems()
  const item = trashItems.find((trashItem) => trashItem.id === itemId)
  if (!item || item.type !== 'folder') return

  const targetNote = item.notes.find((note) => note.id === noteId)
  if (!targetNote) return

  const targetUrl = normalizeNoteUrl(targetNote.sourceUrl)
  const nextTrashItems = trashItems.flatMap((trashItem) => {
    if (trashItem.id !== itemId || trashItem.type !== 'folder') return [trashItem]

    return [
      {
        ...trashItem,
        notes: trashItem.notes.filter((note) => normalizeNoteUrl(note.sourceUrl) !== targetUrl),
        snippets: trashItem.snippets.filter(
          (snippet) => normalizeNoteUrl(snippet.noteUrl) !== targetUrl,
        ),
      },
    ]
  })

  await saveTrashItems(nextTrashItems)
}

export async function deleteTrashItemPermanently(itemId: string) {
  const trashItems = await getTrashItems()
  await saveTrashItems(trashItems.filter((item) => item.id !== itemId))
}

export async function emptyTrash() {
  await saveTrashItems([])
}
