import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react'
import { MoreHorizontal } from 'lucide-react'
import { pinyin } from 'pinyin-pro'
import {
  normalizeNoteUrl,
  type SavedFolderRecord,
  type SavedNoteRecord,
  type SavedSnippetRecord,
} from '@lumos-ai/shared'
import {
  COLOR_TAG_NAMES_STORAGE_KEY,
  deleteSavedFolderCascade,
  deleteSavedNoteCascade,
  deleteTrashFolderNotePermanently,
  deleteTrashItemPermanently,
  emptyTrash,
  getColorTagNames,
  getSavedFolders,
  getSavedNotes,
  getSavedSnippets,
  getTrashItems,
  restoreTrashFolderNote,
  restoreTrashItem,
  saveColorTagNames,
  saveFolders,
  saveNotes,
  saveSnippets,
  saveTrashItems,
  TRASH_STORAGE_KEY,
  type TrashItem,
  type TrashedFolderItem,
} from '../../lib/storage'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { FolderIcon } from '../../components/ui/folder-icon'

type SortMode = 'newest' | 'oldest' | 'title'
type AppView = 'library' | 'trash'

const SIDEBAR_WIDTH_STORAGE_KEY = 'xhsAiManagerSidebarWidth'
const SIDEBAR_WIDTH_DEFAULT = 248
const SIDEBAR_WIDTH_MIN = 216
const SIDEBAR_WIDTH_MAX_CAP = 520

type TagTab = {
  id: string
  label: string
  colorValue?: string
}

type SnippetDraft = {
  id: string
  selectedText: string
  reasonText: string
  colorTagName: string
  colorValue: string
}

type ContentHighlight = {
  snippetId?: string
  colorValue?: string
}

type HighlightedContentSegment = {
  text: string
  highlights: ContentHighlight[]
}

type VisibleContentSegment = HighlightedContentSegment & {
  visibleHighlight: ContentHighlight | null
}

type ReaderTextSelection = {
  text: string
  top: number
  left: number
}

type EditingTagNameDraft = {
  snippetId: string
  colorValue: string
  tagName: string
}

type ConfirmAction =
  | {
      type: 'folder'
      id: string
      name: string
    }
  | {
      type: 'note'
      id: string
      name: string
    }
  | {
      type: 'trash-item'
      id: string
      name: string
    }
  | {
      type: 'trash-folder-note'
      trashItemId: string
      noteId: string
      name: string
    }
  | {
      type: 'empty-trash'
      name: string
    }

type TrashNoteEntry = {
  id: string
  trashItemId: string
  source: 'note' | 'folder'
  deletedAt: string
  note: SavedNoteRecord
  snippets: SavedSnippetRecord[]
}

type TrashFolderGroup = {
  id: string
  folderName: string
  deletedAt: string
  folderItem: TrashedFolderItem | null
  notes: TrashNoteEntry[]
}

type FetchNoteCoverResponse =
  | {
      ok: true
      coverImageUrl: string
    }
  | {
      ok: false
      error?: string
    }

const UNTITLED_NOTE_TITLE = '无标题'
const COLOR_PRESETS = ['#DD6C32', '#E9C46A', '#2A9D8F', '#4D78F2', '#8B5CF6', '#E56B6F']
const TRASH_RETENTION_DAYS = 7

const colorNameMap: Record<string, string> = {
  '#DD6C32': '红色',
  '#E56B6F': '红色',
  '#E9C46A': '黄色',
  '#2A9D8F': '绿色',
  '#4D78F2': '蓝色',
  '#8B5CF6': '紫色',
}

function getDisplayTagName(tagName: string | null | undefined, colorValue?: string) {
  const trimmed = (tagName ?? '').trim()
  const raw = trimmed || colorNameMap[colorValue || ''] || '未分'
  return Array.from(raw).slice(0, 2).join('')
}

function getDisplayNoteTitle(note: Pick<SavedNoteRecord, 'filename' | 'title'>) {
  return note.filename.trim() || note.title.trim() || UNTITLED_NOTE_TITLE
}

function getDisplayAuthorName(authorName: string | null | undefined) {
  return authorName?.trim() || '作者未知'
}

function getReadableTagName(tagName: string | null | undefined) {
  return tagName?.trim() || '未命名'
}

function getColorFallbackName(colorValue: string) {
  return colorNameMap[colorValue] || '标签'
}

function getConfirmDeleteTitle(confirmAction: ConfirmAction) {
  if (confirmAction.type === 'empty-trash') return '是否清空回收站？'
  if (confirmAction.type === 'trash-item') return `是否彻底删除：${confirmAction.name}？`
  if (confirmAction.type === 'trash-folder-note') return `是否彻底删除：${confirmAction.name}？`
  return `是否删除：${confirmAction.name}？`
}

function getConfirmDeleteDescription(confirmAction: ConfirmAction) {
  if (confirmAction.type === 'folder') {
    return '删除的文件夹、笔记和标注片段将进入回收站，7 天后自动彻底删除。'
  }

  if (confirmAction.type === 'note') {
    return '删除的笔记和对应标注片段将进入回收站，7 天后自动彻底删除。'
  }

  if (confirmAction.type === 'trash-item' || confirmAction.type === 'trash-folder-note') {
    return '删除后将无法恢复。'
  }

  return '回收站内所有内容将被彻底删除，无法恢复。'
}

function getConfirmDeleteButtonLabel(confirmAction: ConfirmAction) {
  if (confirmAction.type === 'folder' || confirmAction.type === 'note') return '删除'
  if (confirmAction.type === 'empty-trash') return '清空'
  return '彻底删除'
}

function normalizeSearchText(text: string | null | undefined) {
  return (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function compactSearchText(text: string | null | undefined) {
  return normalizeSearchText(text).replace(/\s+/g, '')
}

function getPinyinText(text: string) {
  if (!text.trim()) return ''

  try {
    return pinyin(text, {
      toneType: 'none',
    })
  } catch {
    return ''
  }
}

function getPinyinInitialText(text: string) {
  if (!text.trim()) return ''

  try {
    return pinyin(text, {
      pattern: 'first',
      toneType: 'none',
    })
  } catch {
    return ''
  }
}

function createSearchIndex(values: Array<string | null | undefined>) {
  const sourceText = values.map((value) => value ?? '').join(' ')
  const pinyinText = getPinyinText(sourceText)
  const pinyinInitialText = getPinyinInitialText(sourceText)

  return [
    normalizeSearchText(sourceText),
    compactSearchText(sourceText),
    compactSearchText(pinyinText),
    compactSearchText(pinyinInitialText),
  ].join(' ')
}

function matchesSearch(values: Array<string | null | undefined>, query: string) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return true

  const compactQuery = compactSearchText(query)
  const searchIndex = createSearchIndex(values)

  return searchIndex.includes(normalizedQuery) || searchIndex.includes(compactQuery)
}

function getSidebarMaxWidth() {
  if (typeof window === 'undefined') return SIDEBAR_WIDTH_DEFAULT
  return Math.max(
    SIDEBAR_WIDTH_MIN,
    Math.min(SIDEBAR_WIDTH_MAX_CAP, Math.floor(window.innerWidth * 0.48)),
  )
}

function clampSidebarWidth(width: number) {
  return Math.min(Math.max(width, SIDEBAR_WIDTH_MIN), getSidebarMaxWidth())
}

function normalizeTagName(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeSelectedText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function stripDuplicateTitlePrefix(text: string, note: Pick<SavedNoteRecord, 'filename' | 'title'>) {
  const candidates = [note.title, note.filename, getDisplayNoteTitle(note)]
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate && candidate !== UNTITLED_NOTE_TITLE)
  let nextText = text.trimStart()

  for (const candidate of candidates) {
    if (!nextText.startsWith(candidate)) continue
    nextText = nextText.slice(candidate.length).trimStart()
    break
  }

  return nextText
}

function keepTopicTagsTogether(text: string) {
  const tagIndex = text.search(/#[^\s#]+/)
  if (tagIndex <= 0) return text

  const beforeTags = text.slice(0, tagIndex).replace(/\s+$/g, '')
  const tags = text.slice(tagIndex).replace(/[ \t\u3000]+/g, ' ').trim()

  return `${beforeTags}\n\n${tags}`
}

function formatContentTextForDisplay(
  text: string,
  note: Pick<SavedNoteRecord, 'filename' | 'title'>,
) {
  const withoutDuplicateTitle = stripDuplicateTitlePrefix(text, note)
  if (!withoutDuplicateTitle.trim()) return ''

  if (withoutDuplicateTitle.includes('\n')) {
    return withoutDuplicateTitle.replace(/\n{3,}/g, '\n\n').trim()
  }

  const paragraphText = withoutDuplicateTitle
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/\s+([🫐🍊🍋🍓🍇🍑🍒🍉🍍🥭🍎🍏🍐🍌🥝🍅🥥🥤🧋☕🍵])(?=\S)/gu, '\n\n$1')
    .replace(/\n{3,}/g, '\n\n')

  return keepTopicTagsTogether(paragraphText).trim()
}

function getTagNameForColor(
  colorValue: string,
  tagOptions: Array<{ color: string; tagName: string }>,
) {
  return tagOptions.find((option) => option.color === colorValue)?.tagName ?? ''
}

function formatSavedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'

  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`
}

function getDisplayCoverImageUrl(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' && /\.xhscdn\.com$/i.test(parsed.hostname)) {
      parsed.protocol = 'https:'
    }
    return parsed.href
  } catch {
    return trimmed
  }
}

function hideBrokenCoverImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none'
}

function canRequestCoverRepair() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage)
}

async function requestCoverRepair(sourceUrl: string) {
  if (!canRequestCoverRepair()) return ''

  return new Promise<string>((resolve) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: 'XHS_FETCH_NOTE_COVER',
          sourceUrl,
        },
        (response: FetchNoteCoverResponse | undefined) => {
          if (chrome.runtime.lastError || !response?.ok) {
            resolve('')
            return
          }

          resolve(getDisplayCoverImageUrl(response.coverImageUrl))
        },
      )
    } catch {
      resolve('')
    }
  })
}

function getTrashRemainingDays(deletedAt: string) {
  const deletedTime = new Date(deletedAt).getTime()
  if (Number.isNaN(deletedTime)) return 0

  const elapsed = Date.now() - deletedTime
  const remaining = TRASH_RETENTION_DAYS - Math.floor(elapsed / (24 * 60 * 60 * 1000))
  return Math.max(0, remaining)
}

function getTrashRemainingLabel(deletedAt: string) {
  const remainingDays = getTrashRemainingDays(deletedAt)
  return remainingDays > 0 ? `${remainingDays} 天后彻底删除` : '今天彻底删除'
}

function getTrashNoteEntryId(item: TrashItem, note: SavedNoteRecord) {
  return item.type === 'folder' ? `${item.id}-${note.id}` : item.id
}

function getTrashNoteTitle(note: SavedNoteRecord) {
  return getDisplayNoteTitle(note)
}

function getNoteSnippets(note: SavedNoteRecord, snippets: SavedSnippetRecord[]) {
  const targetUrl = normalizeNoteUrl(note.sourceUrl)
  return snippets.filter((snippet) => normalizeNoteUrl(snippet.noteUrl) === targetUrl)
}

function createSnippetDraft(snippet: SavedSnippetRecord): SnippetDraft {
  return {
    id: snippet.id,
    selectedText: snippet.selectedText,
    reasonText: snippet.reasonText,
    colorTagName: snippet.colorTagName,
    colorValue: snippet.colorValue || COLOR_PRESETS[0],
  }
}

function getHighlightWash(colorValue: string | undefined) {
  if (colorValue && /^#[0-9a-f]{6}$/i.test(colorValue)) {
    return `${colorValue}26`
  }

  return 'rgba(240, 122, 47, 0.14)'
}

function getContentHighlightStyle(visibleHighlight: ContentHighlight): CSSProperties {
  return {
    backgroundColor: getHighlightWash(visibleHighlight.colorValue),
    borderColor: visibleHighlight.colorValue || '#f07a2f',
  }
}

function getVisibleHighlight(highlights: ContentHighlight[], activeSnippetId: string) {
  return highlights.find((highlight) => highlight.snippetId === activeSnippetId) ?? highlights[0] ?? null
}

function getVisibleHighlightKey(highlight: ContentHighlight | null) {
  if (!highlight) return 'none'
  return `${highlight.snippetId || ''}:${highlight.colorValue || ''}`
}

function getWhitespaceInsensitiveTextIndex(text: string) {
  const normalizedChars: string[] = []
  const indexMap: number[] = []
  let previousWasWhitespace = false
  let sourceIndex = 0

  for (const char of text) {
    if (/\s/.test(char)) {
      const currentIndex = sourceIndex
      sourceIndex += char.length
      if (previousWasWhitespace) continue
      normalizedChars.push(' ')
      indexMap.push(currentIndex)
      previousWasWhitespace = true
      continue
    }

    normalizedChars.push(char)
    indexMap.push(sourceIndex)
    previousWasWhitespace = false
    sourceIndex += char.length
  }

  return {
    text: normalizedChars.join(''),
    indexMap,
  }
}

function findTextRange(content: string, selectedText: string) {
  const directStart = content.indexOf(selectedText)
  if (directStart >= 0) {
    return {
      start: directStart,
      end: directStart + selectedText.length,
    }
  }

  const normalizedSelectedText = normalizeSelectedText(selectedText)
  if (!normalizedSelectedText) return null

  const normalizedContent = getWhitespaceInsensitiveTextIndex(content)
  const normalizedStart = normalizedContent.text.indexOf(normalizedSelectedText)
  if (normalizedStart < 0) return null

  const normalizedEnd = normalizedStart + normalizedSelectedText.length
  return {
    start: normalizedContent.indexMap[normalizedStart] ?? 0,
    end:
      (normalizedContent.indexMap[Math.max(normalizedStart, normalizedEnd - 1)] ?? content.length - 1) +
      1,
  }
}

function mergeVisibleContentSegments(
  segments: HighlightedContentSegment[],
  activeSnippetId: string,
): VisibleContentSegment[] {
  return segments.reduce<VisibleContentSegment[]>((result, segment) => {
    const visibleHighlight = getVisibleHighlight(segment.highlights, activeSnippetId)
    const previous = result[result.length - 1]

    if (
      previous &&
      getVisibleHighlightKey(previous.visibleHighlight) === getVisibleHighlightKey(visibleHighlight)
    ) {
      previous.text += segment.text
      previous.highlights = [...previous.highlights, ...segment.highlights]
      return result
    }

    result.push({
      ...segment,
      visibleHighlight,
    })

    return result
  }, [])
}

function getHighlightedContentSegments(
  content: string,
  drafts: SnippetDraft[],
): HighlightedContentSegment[] {
  if (!content) return []

  const matches = drafts
    .map((draft) => {
      const selectedText = draft.selectedText.trim()
      if (!selectedText) return null

      const range = findTextRange(content, selectedText)
      if (!range) return null

      return {
        start: range.start,
        end: range.end,
        draft,
      }
    })
    .filter((match): match is { start: number; end: number; draft: SnippetDraft } =>
      Boolean(match),
    )
    .sort((left, right) => left.start - right.start)

  if (matches.length === 0) return [{ text: content, highlights: [] }]

  const boundaries = Array.from(
    new Set([0, content.length, ...matches.flatMap((match) => [match.start, match.end])]),
  ).sort((left, right) => left - right)

  return boundaries
    .slice(0, -1)
    .map((start, index) => {
      const end = boundaries[index + 1]
      const highlights = matches
        .filter((match) => match.start < end && match.end > start)
        .map((match) => ({
          snippetId: match.draft.id,
          colorValue: match.draft.colorValue,
        }))

      return {
        text: content.slice(start, end),
        highlights,
      }
    })
    .filter((segment) => segment.text)
}

export function OptionsApp() {
  const [folders, setFolders] = useState<SavedFolderRecord[]>([])
  const [notes, setNotes] = useState<SavedNoteRecord[]>([])
  const [snippets, setSnippets] = useState<SavedSnippetRecord[]>([])
  const [trashItems, setTrashItems] = useState<TrashItem[]>([])
  const [appView, setAppView] = useState<AppView>('library')
  const [activeTrashGroupId, setActiveTrashGroupId] = useState('')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [activeFolderId, setActiveFolderId] = useState('')
  const [activeTagId, setActiveTagId] = useState('all')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [detailNoteId, setDetailNoteId] = useState('')
  const [detailTrashEntryId, setDetailTrashEntryId] = useState('')
  const [activeTrashMenuId, setActiveTrashMenuId] = useState('')
  const [snippetDrafts, setSnippetDrafts] = useState<SnippetDraft[]>([])
  const [activeSnippetId, setActiveSnippetId] = useState('')
  const [readerSelection, setReaderSelection] = useState<ReaderTextSelection | null>(null)
  const [colorTagNames, setColorTagNames] = useState<Record<string, string>>({})
  const [editingTagName, setEditingTagName] = useState<EditingTagNameDraft | null>(null)
  const [detailFeedback, setDetailFeedback] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_WIDTH_DEFAULT

    const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
    return clampSidebarWidth(Number.isFinite(storedWidth) ? storedWidth : SIDEBAR_WIDTH_DEFAULT)
  })
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const noteContentRef = useRef<HTMLDivElement | null>(null)
  const tagNameInputRef = useRef<HTMLInputElement | null>(null)
  const coverRepairInFlightRef = useRef(false)
  const coverRepairAttemptedRef = useRef<Set<string>>(new Set())
  const managerShellStyle = useMemo(
    () =>
      ({
        '--manager-sidebar-width': `${sidebarWidth}px`,
      }) as CSSProperties,
    [sidebarWidth],
  )

  async function loadData() {
    const [nextFolders, nextNotes, nextSnippets, nextColorTagNames, nextTrashItems] =
      await Promise.all([
        getSavedFolders(),
        getSavedNotes(),
        getSavedSnippets(),
        getColorTagNames(),
        getTrashItems(),
      ])

    setFolders(nextFolders)
    setNotes(nextNotes)
    setSnippets(nextSnippets)
    setColorTagNames(nextColorTagNames)
    setTrashItems(nextTrashItems)
    setActiveFolderId((current) => {
      if (current && nextFolders.some((folder) => folder.id === current)) return current
      return nextFolders[0]?.id || ''
    })
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)))
  }, [sidebarWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return

    function handleResize() {
      setSidebarWidth((currentWidth) => clampSidebarWidth(currentWidth))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== 'local') return
      if (
        changes.savedFolders ||
        changes.savedNotes ||
        changes.savedSnippets ||
        changes[COLOR_TAG_NAMES_STORAGE_KEY] ||
        changes[TRASH_STORAGE_KEY]
      ) {
        void loadData()
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  useEffect(() => {
    if (!activeTrashMenuId || typeof document === 'undefined') return

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest('.note-card-menu')) return
      setActiveTrashMenuId('')
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [activeTrashMenuId])

  function handleSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    const shell = event.currentTarget.closest('.manager-shell')
    const shellLeft = shell?.getBoundingClientRect().left ?? 0
    let nextWidth = sidebarWidth

    function updateWidth(clientX: number) {
      nextWidth = clampSidebarWidth(clientX - shellLeft)
      setSidebarWidth(nextWidth)
    }

    function handlePointerMove(pointerEvent: PointerEvent) {
      updateWidth(pointerEvent.clientX)
    }

    function stopResize() {
      setIsResizingSidebar(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(nextWidth)))
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsResizingSidebar(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    updateWidth(event.clientX)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  function handleSidebarResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

    event.preventDefault()
    setSidebarWidth((currentWidth) => {
      if (event.key === 'Home') return SIDEBAR_WIDTH_MIN
      if (event.key === 'End') return getSidebarMaxWidth()

      const step = event.shiftKey ? 32 : 16
      return clampSidebarWidth(
        currentWidth + (event.key === 'ArrowRight' ? step : -step),
      )
    })
  }

  useEffect(() => {
    if (coverRepairInFlightRef.current) return

    const targets = notes
      .filter((note) => {
        if (getDisplayCoverImageUrl(note.coverImageUrl)) return false
        const noteUrl = normalizeNoteUrl(note.sourceUrl)
        return noteUrl && !coverRepairAttemptedRef.current.has(noteUrl)
      })
      .slice(0, 6)

    if (targets.length === 0) return

    targets.forEach((note) => {
      coverRepairAttemptedRef.current.add(normalizeNoteUrl(note.sourceUrl))
    })

    coverRepairInFlightRef.current = true
    void (async () => {
      try {
        const repairedCovers = new Map<string, string>()
        const results = await Promise.all(
          targets.map(async (note) => ({
            noteUrl: normalizeNoteUrl(note.sourceUrl),
            coverImageUrl: await requestCoverRepair(note.sourceUrl),
          })),
        )

        results.forEach((result) => {
          if (result.coverImageUrl) repairedCovers.set(result.noteUrl, result.coverImageUrl)
        })

        if (repairedCovers.size === 0) return

        const latestNotes = await getSavedNotes()
        const nextNotes = latestNotes.map((note) => {
          if (getDisplayCoverImageUrl(note.coverImageUrl)) return note

          const repairedCover = repairedCovers.get(normalizeNoteUrl(note.sourceUrl))
          return repairedCover ? { ...note, coverImageUrl: repairedCover } : note
        })

        await saveNotes(nextNotes)
        setNotes(nextNotes)
      } finally {
        coverRepairInFlightRef.current = false
      }
    })()
  }, [notes])

  const activeFolder = useMemo(
    () => folders.find((folder) => folder.id === activeFolderId) ?? null,
    [activeFolderId, folders],
  )

  const activeFolderNotes = useMemo(
    () => notes.filter((note) => !activeFolderId || note.folderId === activeFolderId),
    [activeFolderId, notes],
  )

  const snippetsByNoteUrl = useMemo(() => {
    const map = new Map<string, SavedSnippetRecord[]>()
    snippets.forEach((snippet) => {
      const key = normalizeNoteUrl(snippet.noteUrl)
      map.set(key, [...(map.get(key) ?? []), snippet])
    })
    return map
  }, [snippets])

  const tabs = useMemo<TagTab[]>(() => {
    const tagMap = new Map<string, TagTab>()

    activeFolderNotes.forEach((note) => {
      const noteSnippets = snippetsByNoteUrl.get(normalizeNoteUrl(note.sourceUrl)) ?? []
      noteSnippets.forEach((snippet) => {
        const id = snippet.colorTagName?.trim() || snippet.colorValue || 'untagged'
        if (tagMap.has(id)) return

        tagMap.set(id, {
          id,
          label: getDisplayTagName(snippet.colorTagName, snippet.colorValue),
          colorValue: snippet.colorValue,
        })
      })
    })

    return [{ id: 'all', label: '全部' }, ...Array.from(tagMap.values())]
  }, [activeFolderNotes, snippetsByNoteUrl])

  useEffect(() => {
    if (activeTagId === 'all') return
    if (!tabs.some((tab) => tab.id === activeTagId)) {
      setActiveTagId('all')
    }
  }, [activeTagId, tabs])

  const filteredNotes = useMemo(() => {
    const filtered = activeFolderNotes
      .filter((note) => {
        if (activeTagId === 'all') return true
        const noteSnippets = snippetsByNoteUrl.get(normalizeNoteUrl(note.sourceUrl)) ?? []
        return noteSnippets.some((snippet) => {
          const tagId = snippet.colorTagName?.trim() || snippet.colorValue || 'untagged'
          return tagId === activeTagId
        })
      })
      .filter((note) => {
        return matchesSearch([note.filename, note.title, note.authorName, note.contentText], search)
      })

    return filtered.sort((left, right) => {
      if (sortMode === 'title') {
        return left.filename.localeCompare(right.filename, 'zh-CN')
      }

      const leftTime = new Date(left.savedAt).getTime()
      const rightTime = new Date(right.savedAt).getTime()
      return sortMode === 'oldest' ? leftTime - rightTime : rightTime - leftTime
    })
  }, [activeFolderNotes, activeTagId, search, snippetsByNoteUrl, sortMode])

  const trashGroups = useMemo<TrashFolderGroup[]>(() => {
    const groupMap = new Map<string, TrashFolderGroup>()

    function getOrCreateNoteGroup(item: TrashItem, note: SavedNoteRecord) {
      const folder = item.folder
      const groupId = `note-folder-${folder?.id || note.folderId || 'unknown'}`
      const existing = groupMap.get(groupId)
      if (existing) return existing

      const group: TrashFolderGroup = {
        id: groupId,
        folderName: folder?.name || note.folderName || '原文件夹未知',
        deletedAt: item.deletedAt,
        folderItem: null,
        notes: [],
      }
      groupMap.set(groupId, group)
      return group
    }

    trashItems.forEach((item) => {
      if (item.type === 'folder') {
        const group: TrashFolderGroup = {
          id: `deleted-folder-${item.id}`,
          folderName: item.folder.name,
          deletedAt: item.deletedAt,
          folderItem: item,
          notes: item.notes.map((note) => ({
            id: getTrashNoteEntryId(item, note),
            trashItemId: item.id,
            source: 'folder',
            deletedAt: item.deletedAt,
            note,
            snippets: item.snippets.filter(
              (snippet) => normalizeNoteUrl(snippet.noteUrl) === normalizeNoteUrl(note.sourceUrl),
            ),
          })),
        }
        groupMap.set(group.id, group)
        return
      }

      const group = getOrCreateNoteGroup(item, item.note)
      group.deletedAt =
        new Date(item.deletedAt).getTime() > new Date(group.deletedAt).getTime()
          ? item.deletedAt
          : group.deletedAt
      group.notes.push({
        id: item.id,
        trashItemId: item.id,
        source: 'note',
        deletedAt: item.deletedAt,
        note: item.note,
        snippets: item.snippets,
      })
    })

    const normalizedSearch = normalizeSearchText(search)
    const groups = Array.from(groupMap.values()).map((group) => ({
      ...group,
      notes: group.notes.filter((entry) => {
        if (!normalizedSearch) return true
        if (matchesSearch([group.folderName], search)) return true
        return matchesSearch(
          [entry.note.filename, entry.note.title, entry.note.authorName, entry.note.contentText],
          search,
        )
      }),
    }))

    return groups
      .filter((group) => {
        if (!normalizedSearch) return group.folderItem || group.notes.length > 0
        return matchesSearch([group.folderName], search) || group.notes.length > 0
      })
      .sort((left, right) => {
        if (sortMode === 'title') {
          return left.folderName.localeCompare(right.folderName, 'zh-CN')
        }

        const leftTime = new Date(left.deletedAt).getTime()
        const rightTime = new Date(right.deletedAt).getTime()
        return sortMode === 'oldest' ? leftTime - rightTime : rightTime - leftTime
      })
  }, [search, sortMode, trashItems])

  const trashNoteCount = useMemo(
    () =>
      trashItems.reduce((count, item) => count + (item.type === 'folder' ? item.notes.length : 1), 0),
    [trashItems],
  )
  const trashFolderCount = useMemo(
    () => trashItems.filter((item) => item.type === 'folder').length,
    [trashItems],
  )
  const trashTotalCount = trashFolderCount + trashNoteCount

  const activeTrashGroup = useMemo(
    () => trashGroups.find((group) => group.id === activeTrashGroupId) ?? null,
    [activeTrashGroupId, trashGroups],
  )

  useEffect(() => {
    if (!activeTrashGroupId) return
    if (trashGroups.some((group) => group.id === activeTrashGroupId)) return
    setActiveTrashGroupId('')
  }, [activeTrashGroupId, trashGroups])

  const detailTrashEntry = useMemo<TrashNoteEntry | null>(() => {
    if (!detailTrashEntryId) return null

    for (const item of trashItems) {
      if (item.type === 'folder') {
        const note = item.notes.find(
          (currentNote) => getTrashNoteEntryId(item, currentNote) === detailTrashEntryId,
        )
        if (!note) continue

        return {
          id: getTrashNoteEntryId(item, note),
          trashItemId: item.id,
          source: 'folder',
          deletedAt: item.deletedAt,
          note,
          snippets: item.snippets.filter(
            (snippet) => normalizeNoteUrl(snippet.noteUrl) === normalizeNoteUrl(note.sourceUrl),
          ),
        }
      }

      if (item.id !== detailTrashEntryId) continue

      return {
        id: item.id,
        trashItemId: item.id,
        source: 'note',
        deletedAt: item.deletedAt,
        note: item.note,
        snippets: item.snippets,
      }
    }

    return null
  }, [detailTrashEntryId, trashItems])

  const detailNote = useMemo(
    () => detailTrashEntry?.note ?? notes.find((note) => note.id === detailNoteId) ?? null,
    [detailNoteId, detailTrashEntry, notes],
  )

  useEffect(() => {
    if (!detailNote && !confirmAction) return

    const html = document.documentElement
    const body = document.body
    const scrollbarWidth = window.innerWidth - html.clientWidth
    const previousHtmlOverflow = html.style.overflow
    const previousHtmlOverscroll = html.style.overscrollBehavior
    const previousBodyOverflow = body.style.overflow
    const previousBodyOverscroll = body.style.overscrollBehavior
    const previousBodyPaddingRight = body.style.paddingRight

    html.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }

    return () => {
      html.style.overflow = previousHtmlOverflow
      html.style.overscrollBehavior = previousHtmlOverscroll
      body.style.overflow = previousBodyOverflow
      body.style.overscrollBehavior = previousBodyOverscroll
      body.style.paddingRight = previousBodyPaddingRight
    }
  }, [confirmAction, detailNote])

  const tagNameByColor = useMemo(() => {
    const map = new Map<string, string>()
    COLOR_PRESETS.forEach((color) => map.set(color, ''))
    Object.entries(colorTagNames).forEach(([color, tagName]) => {
      map.set(color, normalizeTagName(tagName))
    })

    const tagSourceSnippets = [...snippets, ...trashItems.flatMap((item) => item.snippets)]

    tagSourceSnippets.forEach((snippet) => {
      const color = snippet.colorValue || COLOR_PRESETS[0]
      if (!map.has(color)) map.set(color, '')
      if (map.get(color)) return

      const tagName = normalizeTagName(snippet.colorTagName)
      if (tagName) map.set(color, tagName)
    })

    snippetDrafts.forEach((draft) => {
      const color = draft.colorValue || COLOR_PRESETS[0]
      if (!map.has(color)) map.set(color, '')
      if (map.get(color)) return

      const tagName = normalizeTagName(draft.colorTagName)
      if (tagName) map.set(color, tagName)
    })

    return map
  }, [colorTagNames, snippets, snippetDrafts, trashItems])

  const tagOptions = useMemo(
    () => Array.from(tagNameByColor.entries()).map(([color, tagName]) => ({ color, tagName })),
    [tagNameByColor],
  )

  const detailContentSegments = useMemo(
    () =>
      detailNote
        ? mergeVisibleContentSegments(
            getHighlightedContentSegments(
              formatContentTextForDisplay(detailNote.contentText, detailNote),
              snippetDrafts,
            ),
            activeSnippetId,
          )
        : [],
    [activeSnippetId, detailNote, snippetDrafts],
  )

  useEffect(() => {
    if (!detailNoteId && !detailTrashEntryId) return
    if (detailNote) return

    setSnippetDrafts([])
    setActiveSnippetId('')
    setReaderSelection(null)
    setDetailFeedback('')
    setDetailNoteId('')
    setDetailTrashEntryId('')
    setEditingTagName(null)
  }, [detailNote, detailNoteId, detailTrashEntryId])

  useEffect(() => {
    if (!editingTagName) return
    tagNameInputRef.current?.focus()
  }, [editingTagName])

  async function handleCreateFolder() {
    const name = newFolderName.trim()
    if (!name) return

    const nextFolder: SavedFolderRecord = {
      id: crypto.randomUUID(),
      name,
      noteCount: 0,
      updatedAt: new Date().toISOString(),
    }

    await saveFolders([nextFolder, ...folders])
    setNewFolderName('')
    setIsCreatingFolder(false)
    setActiveFolderId(nextFolder.id)
    setAppView('library')
    await loadData()
  }

  function requestDeleteFolder() {
    if (!activeFolderId || !activeFolder) return
    setConfirmAction({
      type: 'folder',
      id: activeFolderId,
      name: activeFolder.name,
    })
  }

  function requestDeleteNote(note: SavedNoteRecord) {
    setConfirmAction({
      type: 'note',
      id: note.id,
      name: getDisplayNoteTitle(note),
    })
  }

  function openNoteDetail(note: SavedNoteRecord) {
    const nextDrafts = getNoteSnippets(note, snippets).map(createSnippetDraft)
    setDetailNoteId(note.id)
    setDetailTrashEntryId('')
    setSnippetDrafts(nextDrafts)
    setActiveSnippetId(nextDrafts[0]?.id || '')
    setReaderSelection(null)
    setDetailFeedback('')
    setEditingTagName(null)
  }

  function openTrashNoteDetail(entry: TrashNoteEntry) {
    const nextDrafts = entry.snippets.map(createSnippetDraft)
    setDetailNoteId('')
    setDetailTrashEntryId(entry.id)
    setSnippetDrafts(nextDrafts)
    setActiveSnippetId(nextDrafts[0]?.id || '')
    setReaderSelection(null)
    setDetailFeedback('')
    setEditingTagName(null)
  }

  function closeNoteDetail() {
    setDetailNoteId('')
    setDetailTrashEntryId('')
    setSnippetDrafts([])
    setActiveSnippetId('')
    setReaderSelection(null)
    setDetailFeedback('')
    setEditingTagName(null)
  }

  function updateSnippetDraft(id: string, patch: Partial<SnippetDraft>) {
    setSnippetDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    )
    setDetailFeedback('')
  }

  function addSnippetDraft() {
    const colorValue = COLOR_PRESETS[0]
    const id = `draft-${crypto.randomUUID()}`
    setSnippetDrafts((current) => [
      ...current,
      {
        id,
        selectedText: '',
        reasonText: '',
        colorTagName: getTagNameForColor(colorValue, tagOptions),
        colorValue,
      },
    ])
    setActiveSnippetId(id)
    setReaderSelection(null)
    setDetailFeedback('')
  }

  function removeSnippetDraft(id: string) {
    const nextDrafts = snippetDrafts.filter((draft) => draft.id !== id)
    setSnippetDrafts(nextDrafts)
    if (activeSnippetId === id) {
      setActiveSnippetId(nextDrafts[0]?.id || '')
      setReaderSelection(null)
    }
    setEditingTagName((current) => (current?.snippetId === id ? null : current))
    setDetailFeedback('')
  }

  function activateSnippetDraft(id: string) {
    setActiveSnippetId(id)
    setDetailFeedback('')
  }

  function getReaderSelectionRect(range: Range) {
    const rect = range.getBoundingClientRect()
    if (rect.width || rect.height) return rect
    return range.getClientRects()[0] ?? rect
  }

  function updateReaderSelection() {
    const contentEl = noteContentRef.current
    const selection = window.getSelection()
    if (!contentEl || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setReaderSelection(null)
      return
    }

    const range = selection.getRangeAt(0)
    if (!contentEl.contains(range.commonAncestorContainer)) {
      setReaderSelection(null)
      return
    }

    const text = normalizeSelectedText(selection.toString())
    if (!text) {
      setReaderSelection(null)
      return
    }

    const rect = getReaderSelectionRect(range)
    const left = Math.min(window.innerWidth - 132, Math.max(12, rect.left + rect.width / 2 - 56))
    const top = Math.max(12, rect.top - 44)

    setReaderSelection({ text, top, left })
  }

  function fillActiveSnippetFromReaderSelection() {
    if (!readerSelection || !activeSnippetId) return

    const activeIndex = snippetDrafts.findIndex((draft) => draft.id === activeSnippetId)
    updateSnippetDraft(activeSnippetId, {
      selectedText: readerSelection.text,
    })
    setReaderSelection(null)
    window.getSelection()?.removeAllRanges()
    setDetailFeedback(activeIndex >= 0 ? `已填入片段 ${activeIndex + 1}` : '已填入片段')
  }

  function startTagNameEdit(draft: SnippetDraft) {
    activateSnippetDraft(draft.id)
    setEditingTagName({
      snippetId: draft.id,
      colorValue: draft.colorValue || COLOR_PRESETS[0],
      tagName: tagNameByColor.get(draft.colorValue) || draft.colorTagName,
    })
    setDetailFeedback('')
  }

  function cancelTagNameEdit() {
    setEditingTagName(null)
  }

  async function confirmTagNameEdit() {
    if (!editingTagName) return

    const nextTagName = normalizeTagName(editingTagName.tagName)
    const selectedColor = editingTagName.colorValue || COLOR_PRESETS[0]
    const nextColorTagNames = {
      ...colorTagNames,
      [selectedColor]: nextTagName,
    }
    const nextSnippets = snippets.map((snippet) => {
      const sameColor = (snippet.colorValue || COLOR_PRESETS[0]) === selectedColor
      if (!sameColor) return snippet

      return {
        ...snippet,
        colorTagName: nextTagName,
      }
    })
    const nextTrashItems = trashItems.map((item) => ({
      ...item,
      snippets: item.snippets.map((snippet) => {
        const sameColor = (snippet.colorValue || COLOR_PRESETS[0]) === selectedColor
        if (!sameColor) return snippet

        return {
          ...snippet,
          colorTagName: nextTagName,
        }
      }),
    }))
    const nextDrafts = snippetDrafts.map((draft) => {
      const sameColor = (draft.colorValue || COLOR_PRESETS[0]) === selectedColor
      if (!sameColor) return draft

      return {
        ...draft,
        colorTagName: nextTagName,
      }
    })

    await Promise.all([
      saveColorTagNames(nextColorTagNames),
      saveSnippets(nextSnippets),
      saveTrashItems(nextTrashItems),
    ])
    setColorTagNames(nextColorTagNames)
    setSnippets(nextSnippets)
    setTrashItems(nextTrashItems)
    setSnippetDrafts(nextDrafts)
    setEditingTagName(null)
    setDetailFeedback('标签名已更新')
  }

  async function handleSaveDetailSnippets() {
    if (!detailNote) return

    const pendingTagEdit = editingTagName
    const nextTagName = pendingTagEdit ? normalizeTagName(pendingTagEdit.tagName) : ''
    const selectedColor = pendingTagEdit?.colorValue || COLOR_PRESETS[0]
    const nextColorTagNames = pendingTagEdit
      ? {
          ...colorTagNames,
          [selectedColor]: nextTagName,
        }
      : colorTagNames
    const snippetsForSave = pendingTagEdit
      ? snippets.map((snippet) => {
          const sameColor = (snippet.colorValue || COLOR_PRESETS[0]) === selectedColor
          if (!sameColor) return snippet

          return {
            ...snippet,
            colorTagName: nextTagName,
          }
        })
      : snippets
    const draftsForSave = pendingTagEdit
      ? snippetDrafts.map((draft) => {
          const sameColor = (draft.colorValue || COLOR_PRESETS[0]) === selectedColor
          if (!sameColor) return draft

          return {
            ...draft,
            colorTagName: nextTagName,
          }
        })
      : snippetDrafts
    const targetUrl = normalizeNoteUrl(detailNote.sourceUrl)
    const existingNoteSnippets = snippetsForSave.filter(
      (snippet) => normalizeNoteUrl(snippet.noteUrl) === targetUrl,
    )
    const existingById = new Map(existingNoteSnippets.map((snippet) => [snippet.id, snippet]))
    const now = new Date().toISOString()
    let nextActiveSnippetId = ''
    const nextNoteSnippets = draftsForSave
      .map((draft): SavedSnippetRecord | null => {
        const existing = existingById.get(draft.id)
        const selectedText = draft.selectedText.trim()
        if (!selectedText) return null

        const colorValue = draft.colorValue || COLOR_PRESETS[0]
        const record = {
          id: existing?.id ?? crypto.randomUUID(),
          noteUrl: detailNote.sourceUrl,
          noteTitle: getDisplayNoteTitle(detailNote),
          noteAuthorName: detailNote.authorName,
          selectedText,
          reasonText: draft.reasonText.trim(),
          colorTagName: draft.colorTagName.trim(),
          colorValue,
          createdAt: existing?.createdAt ?? now,
        }

        if (draft.id === activeSnippetId) {
          nextActiveSnippetId = record.id
        }

        return record
      })
      .filter((snippet): snippet is SavedSnippetRecord => snippet !== null)

    const nextSnippets = [
      ...snippetsForSave.filter((snippet) => normalizeNoteUrl(snippet.noteUrl) !== targetUrl),
      ...nextNoteSnippets,
    ]
    const trashItemsForSave = pendingTagEdit
      ? trashItems.map((item) => ({
          ...item,
          snippets: item.snippets.map((snippet) => {
            const sameColor = (snippet.colorValue || COLOR_PRESETS[0]) === selectedColor
            if (!sameColor) return snippet

            return {
              ...snippet,
              colorTagName: nextTagName,
            }
          }),
        }))
      : trashItems

    if (detailTrashEntry) {
      const nextTrashItems = trashItemsForSave.map((item) => {
        if (item.id !== detailTrashEntry.trashItemId) return item

        if (item.type === 'folder') {
          return {
            ...item,
            snippets: [
              ...item.snippets.filter((snippet) => normalizeNoteUrl(snippet.noteUrl) !== targetUrl),
              ...nextNoteSnippets,
            ],
          }
        }

        return {
          ...item,
          snippets: nextNoteSnippets,
        }
      })

      await Promise.all([
        saveTrashItems(nextTrashItems),
        pendingTagEdit ? saveSnippets(snippetsForSave) : Promise.resolve(),
        pendingTagEdit ? saveColorTagNames(nextColorTagNames) : Promise.resolve(),
      ])
      setTrashItems(nextTrashItems)
      setSnippets(snippetsForSave)
      setColorTagNames(nextColorTagNames)
      setSnippetDrafts(nextNoteSnippets.map(createSnippetDraft))
      setActiveSnippetId(nextActiveSnippetId || nextNoteSnippets[0]?.id || '')
      setReaderSelection(null)
      setEditingTagName(null)
      setDetailFeedback('已保存')
      return
    }

    await Promise.all([
      saveSnippets(nextSnippets),
      pendingTagEdit ? saveColorTagNames(nextColorTagNames) : Promise.resolve(),
      pendingTagEdit ? saveTrashItems(trashItemsForSave) : Promise.resolve(),
    ])
    setColorTagNames(nextColorTagNames)
    setSnippets(nextSnippets)
    if (pendingTagEdit) setTrashItems(trashItemsForSave)
    setSnippetDrafts(nextNoteSnippets.map(createSnippetDraft))
    setActiveSnippetId(nextActiveSnippetId || nextNoteSnippets[0]?.id || '')
    setReaderSelection(null)
    setEditingTagName(null)
    setDetailFeedback('已保存')
  }

  function renderNoteCard({
    keyValue,
    note,
    noteSnippets,
    metaText,
    onOpen,
    actions,
    actionsClassName = '',
  }: {
    keyValue: string
    note: SavedNoteRecord
    noteSnippets: SavedSnippetRecord[]
    metaText: string
    onOpen: () => void
    actions: ReactNode
    actionsClassName?: string
  }) {
    const visibleTags = noteSnippets.slice(0, 3)
    const coverImageUrl = getDisplayCoverImageUrl(note.coverImageUrl)

    return (
      <article
        key={keyValue}
        className="note-card"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpen()
        }}
      >
        <div className="cover-frame">
          <div className="cover-fallback">
            <span>未抓到封面</span>
          </div>
          {coverImageUrl ? (
            <img
              src={coverImageUrl}
              alt={getDisplayNoteTitle(note)}
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              onError={hideBrokenCoverImage}
            />
          ) : null}
          <div className="cover-badge">{noteSnippets.length} 个片段</div>
        </div>

        <div className="note-card-body">
          <h3>{getDisplayNoteTitle(note)}</h3>

          <div className="note-card-meta">
            <span>{metaText}</span>
          </div>

          <div className="note-tag-row">
            {visibleTags.map((snippet) => (
              <span key={snippet.id} className="note-tag">
                <span
                  className="tag-dot"
                  style={{ backgroundColor: snippet.colorValue || '#f07a2f' }}
                />
                {getDisplayTagName(snippet.colorTagName, snippet.colorValue)}
              </span>
            ))}
            <span className="note-author-name">{getDisplayAuthorName(note.authorName)}</span>
          </div>

          <div
            className={['note-card-actions', actionsClassName].filter(Boolean).join(' ')}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        </div>
      </article>
    )
  }

  async function handleRestoreTrashItem(itemId: string) {
    await restoreTrashItem(itemId)
    await loadData()
  }

  async function handleRestoreTrashNote(entry: TrashNoteEntry) {
    if (entry.source === 'note') {
      await handleRestoreTrashItem(entry.trashItemId)
      return
    }

    await restoreTrashFolderNote(entry.trashItemId, entry.note.id)
    setActiveTrashGroupId(`note-folder-${entry.note.folderId || 'unknown'}`)
    await loadData()
  }

  async function handleDeleteTrashItemPermanently(itemId: string) {
    await deleteTrashItemPermanently(itemId)
    await loadData()
  }

  async function handleDeleteTrashFolderNotePermanently(itemId: string, noteId: string) {
    await deleteTrashFolderNotePermanently(itemId, noteId)
    await loadData()
  }

  function requestDeleteTrashNote(entry: TrashNoteEntry) {
    setConfirmAction(
      entry.source === 'note'
        ? {
            type: 'trash-item',
            id: entry.trashItemId,
            name: getTrashNoteTitle(entry.note),
          }
        : {
            type: 'trash-folder-note',
            trashItemId: entry.trashItemId,
            noteId: entry.note.id,
            name: getTrashNoteTitle(entry.note),
          },
    )
  }

  function renderTrashNoteMenu(entry: TrashNoteEntry) {
    const isOpen = activeTrashMenuId === entry.id

    return (
      <div
        className={['note-card-menu', isOpen ? 'is-open' : ''].filter(Boolean).join(' ')}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          setActiveTrashMenuId('')
        }}
      >
        <button
          type="button"
          className="note-card-menu-trigger"
          aria-label="更多操作"
          aria-expanded={isOpen}
          onClick={() => setActiveTrashMenuId((current) => (current === entry.id ? '' : entry.id))}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
        {isOpen ? (
          <div className="note-card-menu-content" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setActiveTrashMenuId('')
                void handleRestoreTrashNote(entry)
              }}
            >
              恢复
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setActiveTrashMenuId('')
                requestDeleteTrashNote(entry)
              }}
            >
              彻底删除
            </button>
            <a
              href={entry.note.sourceUrl}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              onClick={() => setActiveTrashMenuId('')}
            >
              打开原笔记
            </a>
          </div>
        ) : null}
      </div>
    )
  }

  async function handleEmptyTrash() {
    await emptyTrash()
    await loadData()
  }

  async function handleConfirmDelete() {
    if (!confirmAction) return

    if (confirmAction.type === 'folder') {
      await deleteSavedFolderCascade(confirmAction.id)
      setActiveFolderId((current) => {
        const nextFolders = folders.filter((folder) => folder.id !== current)
        return nextFolders[0]?.id || ''
      })
    } else if (confirmAction.type === 'note') {
      await deleteSavedNoteCascade(confirmAction.id)
    } else if (confirmAction.type === 'trash-item') {
      await handleDeleteTrashItemPermanently(confirmAction.id)
    } else if (confirmAction.type === 'trash-folder-note') {
      await handleDeleteTrashFolderNotePermanently(confirmAction.trashItemId, confirmAction.noteId)
    } else {
      await handleEmptyTrash()
    }

    setConfirmAction(null)
    await loadData()
  }

  function renderSortControl() {
    return (
      <div className="sort-shell">
        <label htmlFor="sort-mode">排序</label>
        <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
          <SelectTrigger id="sort-mode" className="sort-select-trigger" aria-label="排序">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="newest">最新保存</SelectItem>
            <SelectItem value="oldest">最早保存</SelectItem>
            <SelectItem value="title">文件名 A-Z</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div
      className={isResizingSidebar ? 'manager-shell sidebar-resizing' : 'manager-shell'}
      style={managerShellStyle}
    >
      <aside className="manager-sidebar" aria-label="笔记库文件夹">
        <div className="brand-block">
          <span className="brand-mark">L</span>
          <div>
            <p className="brand-name">Lumos AI Writer</p>
            <h1>笔记库</h1>
          </div>
        </div>

        <button
          className="new-folder-button"
          type="button"
          onClick={() => setIsCreatingFolder((current) => !current)}
        >
          <span>+</span>
          新建文件夹
        </button>

        {isCreatingFolder ? (
          <div className="new-folder-panel">
            <Input
              className="new-folder-input compact"
              value={newFolderName}
              placeholder="输入文件夹名"
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleCreateFolder()
                }
              }}
            />
            <button type="button" onClick={() => void handleCreateFolder()}>
              创建
            </button>
          </div>
        ) : null}

        <nav className="folder-list" aria-label="文件夹">
          {folders.map((folder) => (
            <button
              key={folder.id}
              className={
                appView === 'library' && folder.id === activeFolderId
                  ? 'folder-row active'
                  : 'folder-row'
              }
              type="button"
              onClick={() => {
                setAppView('library')
                setActiveFolderId(folder.id)
              }}
            >
              <span className="folder-name">{folder.name}</span>
              <span className="folder-count">{folder.noteCount}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-trash-slot">
          <button
            className={appView === 'trash' ? 'trash-entry active' : 'trash-entry'}
            type="button"
            onClick={() => setAppView('trash')}
          >
            <span className="trash-entry-icon" aria-hidden="true">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="trash-entry-copy">
              <span>回收站</span>
              <small>7 天后自动清空</small>
            </span>
            <span className="folder-count">{trashTotalCount}</span>
          </button>
        </div>
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-label="调整文件夹侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuemax={getSidebarMaxWidth()}
          aria-valuenow={Math.round(sidebarWidth)}
          tabIndex={0}
          onPointerDown={handleSidebarResizeStart}
          onKeyDown={handleSidebarResizeKeyDown}
          title="拖动调整侧栏宽度"
        />
      </aside>

      <main className="manager-main">
        <header className="library-header">
          <div className="search-shell">
            <Input
              ref={searchInputRef}
              className="library-search-input"
              value={search}
              placeholder={appView === 'trash' ? '搜索回收站' : '搜索文件名、标题、正文'}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search ? (
              <button
                className="search-clear-button"
                type="button"
                aria-label="清空搜索"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSearch('')
                  searchInputRef.current?.focus()
                }}
              />
            ) : null}
            <span className="search-icon" aria-hidden="true" />
          </div>
        </header>

        {appView === 'library' ? (
          <>
            <section className="library-context" aria-label="当前文件夹">
              <div className="library-context-copy">
                <span>当前文件夹</span>
                <h2 title={activeFolder?.name || '未选择文件夹'}>
                  {activeFolder?.name || '未选择文件夹'}
                </h2>
              </div>
              <div className="library-context-controls">{renderSortControl()}</div>
            </section>

            <section className="library-subbar">
              <div className="tag-tabs" role="tablist" aria-label="标签筛选">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeTagId}
                    className={tab.id === activeTagId ? 'tag-tab active' : 'tag-tab'}
                    onClick={() => setActiveTagId(tab.id)}
                  >
                    {tab.colorValue ? (
                      <span className="tag-dot" style={{ backgroundColor: tab.colorValue }} />
                    ) : null}
                    {tab.label}
                  </button>
                ))}
              </div>

              <button className="danger-folder-button" type="button" onClick={requestDeleteFolder}>
                删除文件夹
              </button>
            </section>

            {filteredNotes.length > 0 ? (
              <section className="note-grid" aria-label="笔记列表">
                {filteredNotes.map((note) => {
                  const noteSnippets = getNoteSnippets(note, snippets)
                  return renderNoteCard({
                    keyValue: note.id,
                    note,
                    noteSnippets,
                    metaText: formatSavedAt(note.savedAt),
                    onOpen: () => openNoteDetail(note),
                    actions: (
                      <>
                        <a
                          href={note.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开原笔记
                        </a>
                        <button
                          type="button"
                          onClick={() => requestDeleteNote(note)}
                        >
                          删除
                        </button>
                      </>
                    ),
                  })
                })}
              </section>
            ) : (
              <section className="empty-state">
                <h2>没有匹配到笔记</h2>
                <p>换一个标签、关键词，或先用插件保存新的小红书笔记。</p>
              </section>
            )}
          </>
        ) : (
          <>
            <section className="trash-subbar">
              <div className="folder-summary trash-summary">
                <div className="trash-title-row">
                  <h2>回收站</h2>
                  <button
                    className="danger-folder-button"
                    type="button"
                    disabled={trashItems.length === 0}
                    onClick={() =>
                      setConfirmAction({
                        type: 'empty-trash',
                        name: '回收站',
                      })
                    }
                  >
                    清空回收站
                  </button>
                </div>
              </div>
              <div className="trash-context-controls">{renderSortControl()}</div>
            </section>

            {trashGroups.length > 0 ? (
              activeTrashGroup ? (
                <section className="trash-group-list" aria-label="回收站文件夹内容">
                  {(() => {
                    const group = activeTrashGroup
                    const folderItem = group.folderItem

                    return (
                      <section className="trash-folder-group">
                        <header className="trash-folder-header">
                          <button
                            className="trash-back-button"
                            type="button"
                            onClick={() => setActiveTrashGroupId('')}
                          >
                            返回
                          </button>
                          <div>
                            <h3>{group.folderName}</h3>
                          </div>
                          {folderItem ? (
                            <div className="trash-folder-actions">
                              <button
                                type="button"
                                onClick={() => void handleRestoreTrashItem(folderItem.id)}
                              >
                                恢复文件夹
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmAction({
                                    type: 'trash-item',
                                    id: folderItem.id,
                                    name: group.folderName,
                                  })
                                }
                              >
                                彻底删除
                              </button>
                            </div>
                          ) : null}
                        </header>

                        {group.notes.length > 0 ? (
                          <section className="note-grid trash-note-library-grid" aria-label="笔记列表">
                            {group.notes.map((entry) =>
                              renderNoteCard({
                                keyValue: entry.id,
                                note: entry.note,
                                noteSnippets: entry.snippets,
                                metaText: getTrashRemainingLabel(entry.deletedAt),
                                onOpen: () => openTrashNoteDetail(entry),
                                actionsClassName: 'trash-note-card-actions',
                                actions: renderTrashNoteMenu(entry),
                              }),
                            )}
                          </section>
                        ) : (
                          <div className="trash-empty-folder">这个文件夹删除时没有笔记。</div>
                        )}
                      </section>
                    )
                  })()}
                </section>
              ) : (
                <section className="trash-folder-icon-grid" aria-label="回收站文件夹">
                  {trashGroups.map((group) => (
                    <Button
                      key={group.id}
                      className="trash-folder-tile"
                      variant="ghost"
                      type="button"
                      onClick={() => setActiveTrashGroupId(group.id)}
                    >
                      <FolderIcon aria-hidden="true" />
                      <span className="trash-folder-tile-name">{group.folderName}</span>
                      <Badge className="trash-folder-tile-meta" variant="soft">
                        {group.notes.length} 篇 · 还剩 {getTrashRemainingDays(group.deletedAt)} 天
                      </Badge>
                    </Button>
                  ))}
                </section>
              )
            ) : (
              <section className="empty-state">
                <h2>回收站是空的</h2>
                <p>删除的文件夹和笔记会暂存在这里，7 天后自动清空。</p>
              </section>
            )}
            <p className="trash-retention-note">已删除内容将在 7 天后自动清空</p>
          </>
        )}
      </main>

      {detailNote ? (
        <div
          className="dialog-backdrop note-detail-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeNoteDetail()
          }}
        >
          <section
            className="note-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-detail-title"
          >
            <header className="note-detail-header">
              <div className="note-detail-heading">
                <h2 id="note-detail-title">{getDisplayNoteTitle(detailNote)}</h2>
              </div>

              <Button
                className="note-detail-close"
                type="button"
                variant="ghost"
                size="icon"
                aria-label="关闭详情"
                onClick={closeNoteDetail}
              >
                ×
              </Button>
            </header>

            <div className="note-detail-body">
              <Card className="note-detail-panel note-detail-reader">
                <CardHeader className="note-detail-section-title">
                  <div>
                    <CardTitle>正文</CardTitle>
                    <CardDescription>选中文字后，可填入右侧当前片段</CardDescription>
                  </div>
                  <Badge variant="outline">
                    {detailNote.contentText.trim()
                      ? `${formatContentTextForDisplay(detailNote.contentText, detailNote).trim().length} 字`
                      : '未抓到正文'}
                  </Badge>
                </CardHeader>
                <CardContent className="note-detail-reader-content">
                  <div
                    ref={noteContentRef}
                    className="note-content-view"
                    onMouseUp={() => window.setTimeout(updateReaderSelection, 0)}
                    onKeyUp={updateReaderSelection}
                  >
                    {formatContentTextForDisplay(detailNote.contentText, detailNote).trim() ? (
                      detailContentSegments.map((segment, index) => {
                        const visibleHighlight = segment.visibleHighlight
                        const isActiveHighlight = segment.highlights.some(
                          (highlight) => highlight.snippetId === activeSnippetId,
                        )

                        return visibleHighlight ? (
                          <mark
                            key={`highlight-${index}`}
                            className={[
                              'note-content-highlight',
                              isActiveHighlight ? 'active' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            style={getContentHighlightStyle(visibleHighlight)}
                          >
                            {segment.text}
                          </mark>
                        ) : (
                          <span key={`text-${index}`}>{segment.text}</span>
                        )
                      })
                    ) : (
                      <p className="note-content-empty">未抓到正文</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="note-detail-panel note-detail-snippets">
                <CardHeader className="snippet-panel-header">
                  <div>
                    <CardTitle>高亮片段</CardTitle>
                    <CardDescription>{snippetDrafts.length} 个片段</CardDescription>
                  </div>
                  <Button
                    className="snippet-add-button"
                    type="button"
                    variant="soft"
                    size="sm"
                    onClick={addSnippetDraft}
                  >
                    + 新增
                  </Button>
                </CardHeader>

                <CardContent className="snippet-panel-content">
                  {snippetDrafts.length > 0 ? (
                    <div className="snippet-editor-list">
                      {snippetDrafts.map((draft, index) => {
                        const selectedTagName =
                          getTagNameForColor(draft.colorValue, tagOptions) || draft.colorTagName

                        return (
                          <article
                            key={draft.id}
                            className={
                              draft.id === activeSnippetId
                                ? 'snippet-editor active'
                                : 'snippet-editor'
                            }
                            style={{ borderLeftColor: draft.colorValue || '#f07a2f' }}
                            onClick={() => activateSnippetDraft(draft.id)}
                            onFocusCapture={() => activateSnippetDraft(draft.id)}
                          >
                            <div className="snippet-editor-header">
                              <div className="snippet-editor-title">
                                <Badge className="snippet-index" variant="default">
                                  {index + 1}
                                </Badge>
                                <span>片段 {index + 1}</span>
                                {draft.id === activeSnippetId ? (
                                  <Badge className="snippet-active-chip" variant="accent">
                                    当前
                                  </Badge>
                                ) : null}
                              </div>
                              <Button
                                className="snippet-delete-button"
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  removeSnippetDraft(draft.id)
                                }}
                              >
                                删除
                              </Button>
                            </div>

                          <div className="snippet-field snippet-tag-field">
                            <span>颜色标签</span>
                            <div className="snippet-tag-row">
                              {editingTagName?.snippetId === draft.id ? (
                                <div className="shadcn-select-trigger snippet-tag-select snippet-tag-select-editing">
                                  <span className="snippet-tag-value">
                                    <span
                                      className="snippet-tag-dot-large"
                                      style={{
                                        backgroundColor:
                                          editingTagName.colorValue || draft.colorValue,
                                      }}
                                    />
                                    <input
                                      ref={tagNameInputRef}
                                      type="text"
                                      className="snippet-tag-name-input"
                                      value={editingTagName.tagName}
                                      maxLength={8}
                                      placeholder="建议两字，如结构、文风等"
                                      aria-label="标签名"
                                      onChange={(event) =>
                                        setEditingTagName((current) =>
                                          current
                                            ? {
                                                ...current,
                                                tagName: event.target.value,
                                              }
                                            : current,
                                        )
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault()
                                          void confirmTagNameEdit()
                                        }
                                        if (event.key === 'Escape') {
                                          event.preventDefault()
                                          cancelTagNameEdit()
                                        }
                                      }}
                                    />
                                  </span>
                                  <button
                                    className="snippet-tag-cancel"
                                    type="button"
                                    aria-label="取消编辑标签名"
                                    onClick={cancelTagNameEdit}
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : (
                                <Select
                                  value={draft.colorValue}
                                  onValueChange={(value) =>
                                    updateSnippetDraft(draft.id, {
                                      colorValue: value,
                                      colorTagName: getTagNameForColor(value, tagOptions),
                                    })
                                  }
                                >
                                  <SelectTrigger
                                    className="snippet-tag-select"
                                    aria-label="选择高亮标签"
                                  >
                                    <span className="snippet-tag-value">
                                      <span
                                        className="snippet-tag-dot-large"
                                        style={{
                                          backgroundColor: draft.colorValue || '#f07a2f',
                                        }}
                                      />
                                      <span
                                        className={
                                          selectedTagName
                                            ? 'snippet-tag-name-text'
                                            : 'snippet-tag-name-placeholder'
                                        }
                                      >
                                        {getReadableTagName(selectedTagName)}
                                      </span>
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent align="start">
                                    {tagOptions.map((option) => (
                                      <SelectItem
                                        key={option.color}
                                        value={option.color}
                                        aria-label={
                                          option.tagName
                                            ? `${getColorFallbackName(option.color)}标签：${option.tagName}`
                                            : `${getColorFallbackName(option.color)}标签未命名`
                                        }
                                      >
                                        <span className="snippet-select-option">
                                          <span
                                            className="snippet-tag-dot-large"
                                            style={{ backgroundColor: option.color }}
                                          />
                                          <span
                                            className={
                                              option.tagName
                                                ? 'snippet-tag-name-text'
                                                : 'snippet-tag-name-placeholder'
                                            }
                                          >
                                            {option.tagName || '未命名'}
                                          </span>
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              <Button
                                className="snippet-tag-edit-button"
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (editingTagName?.snippetId === draft.id) {
                                    void confirmTagNameEdit()
                                    return
                                  }

                                  startTagNameEdit(draft)
                                }}
                              >
                                {editingTagName?.snippetId === draft.id ? '确认' : '编辑'}
                              </Button>
                            </div>
                          </div>

                          <label className="snippet-field">
                            <span>高亮原文</span>
                            <Textarea
                              className="snippet-textarea"
                              value={draft.selectedText}
                              placeholder="输入高亮原文"
                              onFocus={() => activateSnippetDraft(draft.id)}
                              onChange={(event) =>
                                updateSnippetDraft(draft.id, {
                                  selectedText: event.target.value,
                                })
                              }
                            />
                          </label>

                          <label className="snippet-field">
                            <span>记录理由</span>
                            <Textarea
                              className="snippet-textarea snippet-reason-textarea"
                              value={draft.reasonText}
                              placeholder="记录理由有助于 AI 理解你的喜好，提升创作适配度。"
                              onFocus={() => activateSnippetDraft(draft.id)}
                              onChange={(event) =>
                                updateSnippetDraft(draft.id, {
                                  reasonText: event.target.value,
                                })
                              }
                            />
                          </label>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="snippet-editor-empty">
                      <h4>暂无高亮片段</h4>
                      <p>新增后会保存在这篇笔记下。</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <footer className="note-detail-footer">
              <span className="note-detail-feedback" role="status">
                {detailFeedback}
              </span>
              <div className="note-detail-actions">
                <Button
                  type="button"
                  className="secondary-dialog-button"
                  variant="outline"
                  onClick={closeNoteDetail}
                >
                  关闭
                </Button>
                <Button
                  type="button"
                  className="primary-dialog-button"
                  variant="gradient"
                  onClick={() => void handleSaveDetailSnippets()}
                >
                  保存修改
                </Button>
              </div>
            </footer>
            {readerSelection && activeSnippetId ? (
              <button
                className="note-selection-confirm"
                type="button"
                style={{
                  top: readerSelection.top,
                  left: readerSelection.left,
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={fillActiveSnippetFromReaderSelection}
              >
                填入片段{' '}
                {Math.max(1, snippetDrafts.findIndex((draft) => draft.id === activeSnippetId) + 1)}
              </button>
            ) : null}
          </section>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            aria-describedby="confirm-delete-description"
          >
            <h2 id="confirm-delete-title">{getConfirmDeleteTitle(confirmAction)}</h2>
            <p id="confirm-delete-description">{getConfirmDeleteDescription(confirmAction)}</p>
            <div className="dialog-actions">
              <button type="button" className="secondary-dialog-button" onClick={() => setConfirmAction(null)}>
                取消
              </button>
              <button type="button" className="danger-dialog-button" onClick={() => void handleConfirmDelete()}>
                {getConfirmDeleteButtonLabel(confirmAction)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
