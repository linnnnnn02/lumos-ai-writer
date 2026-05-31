import * as React from 'react'
import type {
  SavedFolderRecord,
  SavedNoteRecord,
  SavedSnippetRecord,
  TrashFolderGroup,
  TrashNoteEntry,
} from '@lumos-ai/shared'
import { normalizeNoteUrl } from '@lumos-ai/shared'
import { pinyin } from 'pinyin-pro'
import {
  ArrowLeft,
  Clock3,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from '@/components/ui/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type LibraryStatus = 'demo' | 'initializing' | 'loading' | 'ready' | 'error'
type SortMode = 'newest' | 'oldest' | 'title'
type AppView = 'library' | 'trash'

type NoteDraft = {
  authorName: string
  contentText: string
  filename: string
  folderId: string
  title: string
}

type SnippetDraft = {
  id: string
  colorTagName: string
  colorValue: string
  reasonText: string
  selectedText: string
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
  | { type: 'folder'; folder: SavedFolderRecord }
  | { type: 'note'; note: SavedNoteRecord }
  | { type: 'trash-folder'; group: TrashFolderGroup }
  | { type: 'trash-note'; entry: TrashNoteEntry }
  | { type: 'empty-trash' }

type TagTab = {
  id: string
  label: string
  colorValue?: string
}

type LibraryManagerProps = {
  error?: string
  folders: SavedFolderRecord[]
  notes: SavedNoteRecord[]
  snippets: SavedSnippetRecord[]
  status: LibraryStatus
  trashGroups: TrashFolderGroup[]
  onBack: () => void
  onCreateFolder: (name: string) => Promise<void>
  onDeleteFolder: (folder: SavedFolderRecord) => Promise<void>
  onDeleteFolderPermanently: (folderId: string) => Promise<void>
  onDeleteNote: (note: SavedNoteRecord) => Promise<void>
  onDeleteNotePermanently: (noteId: string) => Promise<void>
  onEmptyTrash: () => Promise<void>
  onRefresh: () => Promise<void> | void
  onRestoreFolder: (folderId: string) => Promise<void>
  onRestoreNote: (noteId: string) => Promise<void>
  onSaveNote: (note: SavedNoteRecord, draft: NoteDraft) => Promise<void>
  onSaveNoteSnippets: (
    note: SavedNoteRecord,
    drafts: SnippetDraft[],
    existingSnippets: SavedSnippetRecord[],
  ) => Promise<void>
  onUpdateFolder: (folder: SavedFolderRecord, name: string) => Promise<void>
}

const ALL_FOLDERS = 'all'
const NO_FOLDER = '__none__'
const UNTITLED_NOTE_TITLE = '无标题'
const COLOR_PRESETS = ['#64748B', '#4D78F2', '#2A9D8F', '#8B5CF6', '#E9C46A', '#E56B6F']
const SIDEBAR_WIDTH_DEFAULT = 248
const SIDEBAR_WIDTH_MIN = 216
const SIDEBAR_WIDTH_MAX_CAP = 520
const TRASH_RETENTION_DAYS = 7

const colorNameMap: Record<string, string> = {
  '#64748B': '灰色',
  '#DD6C32': '红色',
  '#E56B6F': '红色',
  '#E9C46A': '黄色',
  '#2A9D8F': '绿色',
  '#4D78F2': '蓝色',
  '#8B5CF6': '紫色',
}

function getDisplayTagName(tagName: string | null | undefined, colorValue?: string) {
  const raw = tagName?.trim() || colorNameMap[colorValue || ''] || '未分'
  return Array.from(raw).slice(0, 2).join('')
}

function getReadableTagName(tagName: string | null | undefined) {
  return tagName?.trim() || '未命名'
}

function getDisplayNoteTitle(note: Pick<SavedNoteRecord, 'filename' | 'title'>) {
  return note.filename.trim() || note.title.trim() || UNTITLED_NOTE_TITLE
}

function getDisplayAuthorName(authorName: string | null | undefined) {
  return authorName?.trim() || '作者未知'
}

function normalizeSearchText(text: string | null | undefined) {
  return (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function compactSearchText(text: string | null | undefined) {
  return normalizeSearchText(text).replace(/\s+/g, '')
}

function getPinyinText(text: string, pattern?: 'first') {
  if (!text.trim()) return ''
  try {
    return pinyin(text, { pattern, toneType: 'none' })
  } catch {
    return ''
  }
}

function createSearchIndex(values: Array<string | null | undefined>) {
  const sourceText = values.map((value) => value ?? '').join(' ')
  return [
    normalizeSearchText(sourceText),
    compactSearchText(sourceText),
    compactSearchText(getPinyinText(sourceText)),
    compactSearchText(getPinyinText(sourceText, 'first')),
  ].join(' ')
}

function matchesSearch(values: Array<string | null | undefined>, query: string) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return true

  const compactQuery = compactSearchText(query)
  const searchIndex = createSearchIndex(values)
  return searchIndex.includes(normalizedQuery) || searchIndex.includes(compactQuery)
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

function getTrashRemainingDays(deletedAt: string) {
  const deletedTime = new Date(deletedAt).getTime()
  if (Number.isNaN(deletedTime)) return 0
  const elapsed = Date.now() - deletedTime
  return Math.max(0, TRASH_RETENTION_DAYS - Math.floor(elapsed / (24 * 60 * 60 * 1000)))
}

function getTrashRemainingLabel(deletedAt: string) {
  const remainingDays = getTrashRemainingDays(deletedAt)
  return remainingDays > 0 ? `${remainingDays} 天后彻底删除` : '今天彻底删除'
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

function hideBrokenCoverImage(event: React.SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none'
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

  return keepTopicTagsTogether(
    withoutDuplicateTitle
      .replace(/[ \t\u3000]+/g, ' ')
      .replace(
        /\s+([🫐🍊🍋🍓🍇🍑🍒🍉🍍🥭🍎🍏🍐🍌🥝🍅🥥🥤🧋☕🍵])(?=\S)/gu,
        '\n\n$1',
      )
      .replace(/\n{3,}/g, '\n\n'),
  ).trim()
}

function getNoteSnippets(note: SavedNoteRecord, allSnippets: SavedSnippetRecord[]) {
  const targetUrl = normalizeNoteUrl(note.sourceUrl)
  return allSnippets.filter((snippet) => normalizeNoteUrl(snippet.noteUrl) === targetUrl)
}

function toSavedNoteRecord(note: SavedNoteRecord | TrashNoteEntry['note']): SavedNoteRecord {
  return {
    ...note,
    coverImageUrl: note.coverImageUrl ?? '',
  }
}

function createSnippetDraft(snippet: SavedSnippetRecord): SnippetDraft {
  return {
    id: snippet.id,
    colorTagName: snippet.colorTagName,
    colorValue: snippet.colorValue || COLOR_PRESETS[0],
    reasonText: snippet.reasonText,
    selectedText: snippet.selectedText,
  }
}

function toNoteDraft(note: SavedNoteRecord): NoteDraft {
  return {
    authorName: note.authorName,
    contentText: note.contentText,
    filename: note.filename,
    folderId: note.folderId || NO_FOLDER,
    title: note.title,
  }
}

function getHighlightWash(colorValue: string | undefined) {
  if (colorValue && /^#[0-9a-f]{6}$/i.test(colorValue)) return `${colorValue}26`
  return 'rgba(100, 116, 139, 0.14)'
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

  return { text: normalizedChars.join(''), indexMap }
}

function findTextRange(content: string, selectedText: string) {
  const directStart = content.indexOf(selectedText)
  if (directStart >= 0) return { start: directStart, end: directStart + selectedText.length }

  const normalizedSelectedText = selectedText.replace(/\s+/g, ' ').trim()
  if (!normalizedSelectedText) return null

  const normalizedContent = getWhitespaceInsensitiveTextIndex(content)
  const normalizedStart = normalizedContent.text.indexOf(normalizedSelectedText)
  if (normalizedStart < 0) return null

  const normalizedEnd = normalizedStart + normalizedSelectedText.length
  return {
    start: normalizedContent.indexMap[normalizedStart] ?? 0,
    end:
      (normalizedContent.indexMap[Math.max(normalizedStart, normalizedEnd - 1)] ??
        content.length - 1) + 1,
  }
}

function getVisibleHighlight(highlights: ContentHighlight[], activeSnippetId: string) {
  return highlights.find((highlight) => highlight.snippetId === activeSnippetId) ?? highlights[0] ?? null
}

function getVisibleHighlightKey(highlight: ContentHighlight | null) {
  if (!highlight) return 'none'
  return `${highlight.snippetId || ''}:${highlight.colorValue || ''}`
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

    result.push({ ...segment, visibleHighlight })
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
      return { start: range.start, end: range.end, draft }
    })
    .filter((match): match is { start: number; end: number; draft: SnippetDraft } => Boolean(match))
    .sort((left, right) => left.start - right.start)

  if (matches.length === 0) return [{ text: content, highlights: [] }]

  const boundaries = Array.from(
    new Set([0, content.length, ...matches.flatMap((match) => [match.start, match.end])]),
  ).sort((left, right) => left - right)

  return boundaries
    .slice(0, -1)
    .map((start, index) => {
      const end = boundaries[index + 1]
      return {
        text: content.slice(start, end),
        highlights: matches
          .filter((match) => match.start < end && match.end > start)
          .map((match) => ({
            snippetId: match.draft.id,
            colorValue: match.draft.colorValue,
          })),
      }
    })
    .filter((segment) => segment.text)
}

function getSidebarMaxWidth() {
  if (typeof window === 'undefined') return SIDEBAR_WIDTH_DEFAULT
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX_CAP, Math.floor(window.innerWidth * 0.48)))
}

function clampSidebarWidth(width: number) {
  return Math.min(Math.max(width, SIDEBAR_WIDTH_MIN), getSidebarMaxWidth())
}

export function LibraryManager({
  error = '',
  folders,
  notes,
  snippets,
  status,
  trashGroups,
  onBack,
  onCreateFolder,
  onDeleteFolder,
  onDeleteFolderPermanently,
  onDeleteNote,
  onDeleteNotePermanently,
  onEmptyTrash,
  onRefresh,
  onRestoreFolder,
  onRestoreNote,
  onSaveNote,
  onSaveNoteSnippets,
  onUpdateFolder,
}: LibraryManagerProps) {
  const [activeFolderId, setActiveFolderId] = React.useState(ALL_FOLDERS)
  const [activeTagId, setActiveTagId] = React.useState('all')
  const [activeTrashGroupId, setActiveTrashGroupId] = React.useState('')
  const [appView, setAppView] = React.useState<AppView>('library')
  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction | null>(null)
  const [detailFeedback, setDetailFeedback] = React.useState('')
  const [detailNote, setDetailNote] = React.useState<SavedNoteRecord | null>(null)
  const [detailTrashEntry, setDetailTrashEntry] = React.useState<TrashNoteEntry | null>(null)
  const [editingTagName, setEditingTagName] = React.useState<EditingTagNameDraft | null>(null)
  const [feedback, setFeedback] = React.useState('')
  const [folderDrafts, setFolderDrafts] = React.useState<Record<string, string>>({})
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false)
  const [isMutating, setIsMutating] = React.useState(false)
  const [isResizingSidebar, setIsResizingSidebar] = React.useState(false)
  const [newFolderName, setNewFolderName] = React.useState('')
  const [noteDrafts, setNoteDrafts] = React.useState<Record<string, NoteDraft>>({})
  const [query, setQuery] = React.useState('')
  const [readerSelection, setReaderSelection] = React.useState<ReaderTextSelection | null>(null)
  const [sortMode, setSortMode] = React.useState<SortMode>('newest')
  const [snippetDrafts, setSnippetDrafts] = React.useState<SnippetDraft[]>([])
  const [activeSnippetId, setActiveSnippetId] = React.useState('')
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_WIDTH_DEFAULT
    return clampSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
  })
  const noteContentRef = React.useRef<HTMLDivElement | null>(null)
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)
  const tagNameInputRef = React.useRef<HTMLInputElement | null>(null)

  const canMutate = status === 'ready'
  const isLoading = status === 'initializing' || status === 'loading'
  const trashTotalCount = trashGroups.reduce(
    (count, group) => count + 1 + group.notes.length,
    0,
  )

  const effectiveActiveFolderId =
    activeFolderId === ALL_FOLDERS || folders.some((folder) => folder.id === activeFolderId)
      ? activeFolderId
      : folders[0]?.id ?? ALL_FOLDERS
  const activeFolder = React.useMemo(() => {
    if (effectiveActiveFolderId === ALL_FOLDERS) return null
    return folders.find((folder) => folder.id === effectiveActiveFolderId) ?? null
  }, [effectiveActiveFolderId, folders])
  const activeFolderDraft = activeFolder ? folderDrafts[activeFolder.id] ?? activeFolder.name : ''

  React.useEffect(() => {
    if (!editingTagName) return
    tagNameInputRef.current?.focus()
  }, [editingTagName])

  const snippetsByNoteUrl = React.useMemo(() => {
    const map = new Map<string, SavedSnippetRecord[]>()
    snippets.forEach((snippet) => {
      const key = normalizeNoteUrl(snippet.noteUrl)
      map.set(key, [...(map.get(key) ?? []), snippet])
    })
    return map
  }, [snippets])

  const activeFolderNotes = React.useMemo(
    () =>
      notes.filter(
        (note) =>
          effectiveActiveFolderId === ALL_FOLDERS || note.folderId === effectiveActiveFolderId,
      ),
    [effectiveActiveFolderId, notes],
  )

  const tagNameByColor = React.useMemo(() => {
    const map = new Map<string, string>()
    COLOR_PRESETS.forEach((color) => map.set(color, ''))
    ;[...snippets, ...trashGroups.flatMap((group) => group.notes.flatMap((entry) => entry.snippets))].forEach(
      (snippet) => {
        const color = snippet.colorValue || COLOR_PRESETS[0]
        if (!map.has(color)) map.set(color, '')
        if (map.get(color)) return
        const tagName = snippet.colorTagName.trim()
        if (tagName) map.set(color, tagName)
      },
    )
    snippetDrafts.forEach((draft) => {
      const color = draft.colorValue || COLOR_PRESETS[0]
      if (!map.has(color)) map.set(color, '')
      if (map.get(color)) return
      if (draft.colorTagName.trim()) map.set(color, draft.colorTagName.trim())
    })
    return map
  }, [snippets, snippetDrafts, trashGroups])

  const tagOptions = React.useMemo(
    () => Array.from(tagNameByColor.entries()).map(([color, tagName]) => ({ color, tagName })),
    [tagNameByColor],
  )

  const tabs = React.useMemo<TagTab[]>(() => {
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

  const effectiveActiveTagId =
    activeTagId === 'all' || tabs.some((tab) => tab.id === activeTagId) ? activeTagId : 'all'

  const filteredNotes = React.useMemo(() => {
    return activeFolderNotes
      .filter((note) => {
        if (effectiveActiveTagId === 'all') return true
        const noteSnippets = snippetsByNoteUrl.get(normalizeNoteUrl(note.sourceUrl)) ?? []
        return noteSnippets.some((snippet) => {
          const tagId = snippet.colorTagName?.trim() || snippet.colorValue || 'untagged'
          return tagId === effectiveActiveTagId
        })
      })
      .filter((note) =>
        matchesSearch([note.filename, note.title, note.authorName, note.contentText], query),
      )
      .sort((left, right) => {
        if (sortMode === 'title') return left.filename.localeCompare(right.filename, 'zh-CN')
        const leftTime = new Date(left.savedAt).getTime()
        const rightTime = new Date(right.savedAt).getTime()
        return sortMode === 'oldest' ? leftTime - rightTime : rightTime - leftTime
      })
  }, [activeFolderNotes, effectiveActiveTagId, query, snippetsByNoteUrl, sortMode])

  const filteredTrashGroups = React.useMemo(() => {
    return trashGroups
      .map((group) => ({
        ...group,
        notes: group.notes.filter((entry) => {
          if (!query.trim()) return true
          if (matchesSearch([group.folderName], query)) return true
          return matchesSearch(
            [entry.note.filename, entry.note.title, entry.note.authorName, entry.note.contentText],
            query,
          )
        }),
      }))
      .filter((group) => {
        if (!query.trim()) return group.folderDeleted || group.notes.length > 0
        return matchesSearch([group.folderName], query) || group.notes.length > 0
      })
      .sort((left, right) => {
        if (sortMode === 'title') return left.folderName.localeCompare(right.folderName, 'zh-CN')
        const leftTime = new Date(left.deletedAt).getTime()
        const rightTime = new Date(right.deletedAt).getTime()
        return sortMode === 'oldest' ? leftTime - rightTime : rightTime - leftTime
      })
  }, [query, sortMode, trashGroups])

  const activeTrashGroup = React.useMemo(
    () => filteredTrashGroups.find((group) => group.id === activeTrashGroupId) ?? null,
    [activeTrashGroupId, filteredTrashGroups],
  )

  const selectedDetailNote = detailTrashEntry ? toSavedNoteRecord(detailTrashEntry.note) : detailNote
  const existingDetailSnippets = detailTrashEntry
    ? detailTrashEntry.snippets
    : detailNote
      ? getNoteSnippets(detailNote, snippets)
      : []
  const noteDraft = selectedDetailNote
    ? noteDrafts[selectedDetailNote.id] ?? toNoteDraft(selectedDetailNote)
    : null
  const detailContent = selectedDetailNote
    ? formatContentTextForDisplay(selectedDetailNote.contentText, selectedDetailNote)
    : ''
  const detailContentSegments = React.useMemo(
    () =>
      selectedDetailNote
        ? mergeVisibleContentSegments(
            getHighlightedContentSegments(detailContent, snippetDrafts),
            activeSnippetId,
          )
        : [],
    [activeSnippetId, detailContent, selectedDetailNote, snippetDrafts],
  )

  function resetDetail() {
    setDetailNote(null)
    setDetailTrashEntry(null)
    setSnippetDrafts([])
    setActiveSnippetId('')
    setReaderSelection(null)
    setDetailFeedback('')
    setEditingTagName(null)
  }

  function openNoteDetail(note: SavedNoteRecord) {
    const nextDrafts = getNoteSnippets(note, snippets).map(createSnippetDraft)
    setDetailNote(note)
    setDetailTrashEntry(null)
    setSnippetDrafts(nextDrafts)
    setActiveSnippetId(nextDrafts[0]?.id || '')
    setReaderSelection(null)
    setDetailFeedback('')
    setEditingTagName(null)
  }

  function openTrashNoteDetail(entry: TrashNoteEntry) {
    const nextDrafts = entry.snippets.map(createSnippetDraft)
    setDetailNote(null)
    setDetailTrashEntry(entry)
    setSnippetDrafts(nextDrafts)
    setActiveSnippetId(nextDrafts[0]?.id || '')
    setReaderSelection(null)
    setDetailFeedback('')
    setEditingTagName(null)
  }

  async function runMutation(action: () => Promise<void>, successMessage: string) {
    if (!canMutate) {
      setFeedback('登录后可管理云端文案库。')
      return
    }
    setIsMutating(true)
    setFeedback('')
    try {
      await action()
      setFeedback(successMessage)
    } catch (mutationError) {
      setFeedback(mutationError instanceof Error ? mutationError.message : '操作失败，请稍后重试。')
    } finally {
      setIsMutating(false)
    }
  }

  async function handleCreateFolder(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const name = newFolderName.trim()
    if (!name) return
    await runMutation(async () => {
      await onCreateFolder(name)
      setNewFolderName('')
      setIsCreatingFolder(false)
      setAppView('library')
    }, '文件夹已创建。')
  }

  async function handleUpdateFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeFolder) return
    const name = activeFolderDraft.trim()
    if (!name || name === activeFolder.name) return
    await runMutation(async () => {
      await onUpdateFolder(activeFolder, name)
      setFolderDrafts((current) => {
        const next = { ...current }
        delete next[activeFolder.id]
        return next
      })
    }, '文件夹已重命名。')
  }

  async function handleSaveNote() {
    if (!selectedDetailNote || !noteDraft || detailTrashEntry) return
    await runMutation(() => onSaveNote(selectedDetailNote, noteDraft), '笔记已保存。')
  }

  async function handleSaveDetailSnippets() {
    if (!selectedDetailNote) return
    await runMutation(async () => {
      await onSaveNoteSnippets(selectedDetailNote, snippetDrafts, existingDetailSnippets)
      setDetailFeedback('已保存')
    }, '片段已保存。')
  }

  function updateNoteDraft(noteId: string, nextDraft: NoteDraft) {
    setNoteDrafts((current) => ({ ...current, [noteId]: nextDraft }))
    setDetailFeedback('')
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
        colorTagName: tagNameByColor.get(colorValue) || '',
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
    if (activeSnippetId === id) setActiveSnippetId(nextDrafts[0]?.id || '')
    setEditingTagName((current) => (current?.snippetId === id ? null : current))
    setReaderSelection(null)
    setDetailFeedback('')
  }

  function startTagNameEdit(draft: SnippetDraft) {
    setActiveSnippetId(draft.id)
    setEditingTagName({
      snippetId: draft.id,
      colorValue: draft.colorValue || COLOR_PRESETS[0],
      tagName: tagNameByColor.get(draft.colorValue) || draft.colorTagName,
    })
    setDetailFeedback('')
  }

  function confirmTagNameEdit() {
    if (!editingTagName) return
    const nextTagName = editingTagName.tagName.replace(/\s+/g, ' ').trim()
    const selectedColor = editingTagName.colorValue || COLOR_PRESETS[0]
    setSnippetDrafts((current) =>
      current.map((draft) =>
        (draft.colorValue || COLOR_PRESETS[0]) === selectedColor
          ? { ...draft, colorTagName: nextTagName }
          : draft,
      ),
    )
    setEditingTagName(null)
    setDetailFeedback('标签名已更新，保存后生效')
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

    const text = selection.toString().replace(/\s+/g, ' ').trim()
    if (!text) {
      setReaderSelection(null)
      return
    }

    const rect = range.getBoundingClientRect()
    const left = Math.min(window.innerWidth - 132, Math.max(12, rect.left + rect.width / 2 - 56))
    const top = Math.max(12, rect.top - 44)
    setReaderSelection({ text, top, left })
  }

  function fillActiveSnippetFromReaderSelection() {
    if (!readerSelection || !activeSnippetId) return
    updateSnippetDraft(activeSnippetId, { selectedText: readerSelection.text })
    setReaderSelection(null)
    window.getSelection()?.removeAllRanges()
    const activeIndex = snippetDrafts.findIndex((draft) => draft.id === activeSnippetId)
    setDetailFeedback(activeIndex >= 0 ? `已填入片段 ${activeIndex + 1}` : '已填入片段')
  }

  function handleSidebarResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    const shell = event.currentTarget.closest('[data-library-shell]')
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
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    event.preventDefault()
    setIsResizingSidebar(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    updateWidth(event.clientX)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  function getConfirmTitle(action: ConfirmAction) {
    if (action.type === 'empty-trash') return '是否清空回收站？'
    if (action.type === 'trash-folder') return `是否彻底删除：${action.group.folderName}？`
    if (action.type === 'trash-note') return `是否彻底删除：${getDisplayNoteTitle(action.entry.note)}？`
    if (action.type === 'folder') return `是否删除：${action.folder.name}？`
    return `是否删除：${getDisplayNoteTitle(action.note)}？`
  }

  function getConfirmDescription(action: ConfirmAction) {
    if (action.type === 'folder') return '删除的文件夹、笔记和标注片段将进入回收站。'
    if (action.type === 'note') return '删除的笔记和对应标注片段将进入回收站。'
    if (action.type === 'empty-trash') return '回收站内所有内容将被彻底删除，无法恢复。'
    return '删除后将无法恢复。'
  }

  async function handleConfirmAction() {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmAction(null)

    if (action.type === 'folder') {
      await runMutation(() => onDeleteFolder(action.folder), '文件夹已移入回收站。')
    } else if (action.type === 'note') {
      await runMutation(() => onDeleteNote(action.note), '笔记已移入回收站。')
    } else if (action.type === 'trash-folder') {
      await runMutation(
        () => onDeleteFolderPermanently(action.group.folderId),
        '文件夹已彻底删除。',
      )
    } else if (action.type === 'trash-note') {
      await runMutation(() => onDeleteNotePermanently(action.entry.note.id), '笔记已彻底删除。')
    } else {
      await runMutation(onEmptyTrash, '回收站已清空。')
    }
  }

  async function handleRestoreTrashNote(entry: TrashNoteEntry) {
    await runMutation(async () => {
      if (entry.source === 'folder') {
        await onRestoreNote(entry.note.id)
      } else {
        await onRestoreNote(entry.note.id)
      }
      setActiveTrashGroupId('')
    }, '笔记已恢复。')
  }

  async function handleRestoreTrashFolder(group: TrashFolderGroup) {
    if (!group.folderDeleted) return
    await runMutation(async () => {
      await onRestoreFolder(group.folderId)
      setActiveTrashGroupId('')
    }, '文件夹已恢复。')
  }

  function renderSortControl() {
    return (
      <div className="inline-flex min-h-[var(--ui-control-height-lg)] items-center gap-2 rounded-[var(--ui-field-radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3">
        <span className="text-xs font-bold text-[var(--soft-foreground)]">排序</span>
        <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
          <SelectTrigger className="h-[var(--ui-control-height-sm)] border-0 bg-transparent px-1 text-xs font-bold shadow-none">
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

  function renderNoteCard(
    note: SavedNoteRecord,
    noteSnippets: SavedSnippetRecord[],
    metaText: string,
    onOpen: () => void,
    actions: React.ReactNode,
  ) {
    const coverImageUrl = getDisplayCoverImageUrl(note.coverImageUrl)
    return (
      <article
        key={note.id}
        className="group grid cursor-pointer overflow-hidden rounded-[var(--ui-radius-panel)] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:bg-white"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpen()
        }}
      >
        <div className="relative aspect-[1.22] overflow-hidden bg-[linear-gradient(135deg,rgba(103,199,255,0.16),rgba(238,241,245,0.9))]">
          <div className="absolute inset-0 grid place-items-center text-xs font-bold text-[var(--soft-foreground)]">
            未抓到封面
          </div>
          {coverImageUrl ? (
            <img
              className="absolute inset-0 h-full w-full object-cover"
              src={coverImageUrl}
              alt={getDisplayNoteTitle(note)}
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              onError={hideBrokenCoverImage}
            />
          ) : null}
          <div className="absolute bottom-2 right-2 rounded-full bg-white/86 px-2 py-1 text-xs font-bold text-[var(--foreground)] shadow-sm">
            {noteSnippets.length} 个片段
          </div>
        </div>
        <div className="grid gap-3 p-4">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-sm font-extrabold leading-6 text-[var(--foreground)]">
              {getDisplayNoteTitle(note)}
            </h3>
            <p className="mt-1 text-xs font-bold text-[var(--soft-foreground)]">{metaText}</p>
          </div>
          <div className="flex min-h-7 flex-wrap items-center gap-2">
            {noteSnippets.slice(0, 3).map((snippet) => (
              <span
                key={snippet.id}
                className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--surface-muted)] px-2 text-xs font-bold text-[var(--muted-foreground)]"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: snippet.colorValue || COLOR_PRESETS[0] }}
                />
                {getDisplayTagName(snippet.colorTagName, snippet.colorValue)}
              </span>
            ))}
            <span className="ml-auto truncate text-xs font-bold text-[var(--soft-foreground)]">
              {getDisplayAuthorName(note.authorName)}
            </span>
          </div>
          <div
            className="flex flex-wrap items-center justify-end gap-2 text-xs font-bold"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        </div>
      </article>
    )
  }

  return (
    <main
      data-library-shell
      className={cn(
        'grid min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]',
        isResizingSidebar && 'cursor-col-resize select-none',
      )}
      style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
    >
      <aside className="relative flex h-screen flex-col border-r border-[var(--border)] bg-white/62 px-4 py-6">
        <div className="flex items-center gap-3 px-1 pb-5">
          <Button variant="secondary" size="icon" onClick={onBack} aria-label="返回项目页">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-bold text-[var(--muted-foreground)]">Lumos AI Writer</p>
            <h1 className="mt-0.5 text-2xl font-extrabold tracking-normal">笔记库</h1>
          </div>
        </div>

        <Button
          type="button"
          onClick={() => setIsCreatingFolder((current) => !current)}
          disabled={!canMutate}
        >
          <Plus className="h-4 w-4" />
          新建文件夹
        </Button>

        {isCreatingFolder ? (
          <form
            className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[var(--ui-field-radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-2"
            onSubmit={(event) => void handleCreateFolder(event)}
          >
            <Input
              className="h-[var(--ui-control-height-sm)] border-0 bg-transparent shadow-none"
              value={newFolderName}
              placeholder="输入文件夹名"
              onChange={(event) => setNewFolderName(event.target.value)}
              disabled={!canMutate || isMutating}
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!newFolderName.trim()}>
              创建
            </Button>
          </form>
        ) : null}

        <nav className="mt-5 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1" aria-label="文件夹">
          <button
            type="button"
            className={cn(
              'grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center rounded-[var(--ui-field-radius)] px-3 text-left text-sm transition',
              appView === 'library' && effectiveActiveFolderId === ALL_FOLDERS
                ? 'bg-[rgba(103,199,255,0.1)] font-extrabold text-[var(--foreground)] shadow-[var(--shadow-muted)]'
                : 'text-[var(--muted-foreground)] hover:bg-white/70',
            )}
            onClick={() => {
              setAppView('library')
              setActiveFolderId(ALL_FOLDERS)
            }}
          >
            <span>全部</span>
            <span className="text-xs font-bold text-[var(--soft-foreground)]">{notes.length}</span>
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={cn(
                'grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center rounded-[var(--ui-field-radius)] px-3 text-left text-sm transition',
                appView === 'library' && folder.id === effectiveActiveFolderId
                  ? 'bg-[rgba(103,199,255,0.1)] font-extrabold text-[var(--foreground)] shadow-[var(--shadow-muted)]'
                  : 'text-[var(--muted-foreground)] hover:bg-white/70',
              )}
              onClick={() => {
                setAppView('library')
                setActiveFolderId(folder.id)
              }}
            >
              <span className="truncate">{folder.name}</span>
              <span className="text-xs font-bold text-[var(--soft-foreground)]">{folder.noteCount}</span>
            </button>
          ))}
        </nav>

        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <button
            className={cn(
              'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--ui-field-radius)] px-3 py-2 text-left transition',
              appView === 'trash'
                ? 'bg-white/80 text-[var(--foreground)] shadow-[var(--shadow-muted)]'
                : 'text-[var(--muted-foreground)] hover:bg-white/70',
            )}
            type="button"
            onClick={() => setAppView('trash')}
          >
            <span className="grid h-7 w-7 place-items-center rounded-[var(--ui-radius-item)] bg-[rgba(31,22,17,0.06)]">
              <Trash2 className="h-4 w-4" />
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-sm font-extrabold">回收站</span>
              <span className="truncate text-xs font-bold text-[var(--soft-foreground)]">
                7 天后自动清空
              </span>
            </span>
            <span className="text-xs font-bold text-[var(--soft-foreground)]">{trashTotalCount}</span>
          </button>
        </div>

        <div
          className="absolute bottom-0 right-[-6px] top-0 z-10 w-3 cursor-col-resize"
          role="separator"
          aria-label="调整文件夹侧栏宽度"
          aria-orientation="vertical"
          onPointerDown={handleSidebarResizeStart}
        />
      </aside>

      <section className="min-w-0 overflow-y-auto px-7 pb-16 pt-5">
        <header className="grid min-h-16 grid-cols-[minmax(18rem,40rem)_auto] items-center justify-center gap-4">
          <div className="relative w-full">
            <Input
              ref={searchInputRef}
              className="h-[var(--ui-control-height-lg)] rounded-[var(--ui-field-radius)] border-[var(--border)] bg-[var(--surface-raised)] pr-20"
              value={query}
              placeholder={appView === 'trash' ? '搜索回收站' : '搜索文件名、标题、正文'}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                className="absolute right-12 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-[var(--soft-foreground)] hover:bg-[var(--surface-muted)]"
                type="button"
                aria-label="清空搜索"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery('')
                  searchInputRef.current?.focus()
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={canMutate ? 'accent' : 'outline'}>
              {canMutate ? '云端' : status === 'demo' ? 'Demo' : '连接中'}
            </Badge>
            <Button variant="secondary" size="sm" onClick={onRefresh} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
              刷新
            </Button>
          </div>
        </header>

        {feedback ? (
          <p className="mx-auto mt-1 max-w-7xl text-sm text-[var(--muted-foreground)]" role="status">
            {feedback}
          </p>
        ) : null}

        {appView === 'library' ? (
          <>
            <section className="mx-auto mt-4 grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-b border-[var(--border)] pb-3">
              <div className="min-w-0">
                <span className="text-xs font-extrabold text-[var(--soft-foreground)]">当前文件夹</span>
                <h2 className="mt-1 truncate text-2xl font-extrabold">
                  {effectiveActiveFolderId === ALL_FOLDERS ? '全部' : activeFolder?.name || '未选择文件夹'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {renderSortControl()}
                {activeFolder ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[rgba(214,90,60,0.82)] hover:bg-[rgba(214,90,60,0.08)]"
                    disabled={!canMutate || isMutating}
                    onClick={() => setConfirmAction({ type: 'folder', folder: activeFolder })}
                  >
                    删除文件夹
                  </Button>
                ) : null}
              </div>
            </section>

            {activeFolder ? (
              <form
                className="mx-auto mt-3 grid max-w-7xl grid-cols-[minmax(12rem,20rem)_auto] justify-end gap-2"
                onSubmit={(event) => void handleUpdateFolder(event)}
              >
                <Input
                  value={activeFolderDraft}
                  onChange={(event) =>
                    setFolderDrafts((current) => ({ ...current, [activeFolder.id]: event.target.value }))
                  }
                  disabled={!canMutate || isMutating}
                  aria-label="重命名文件夹"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={
                    !canMutate ||
                    isMutating ||
                    !activeFolderDraft.trim() ||
                    activeFolderDraft.trim() === activeFolder.name
                  }
                >
                  保存名称
                </Button>
              </form>
            ) : null}

            <section className="mx-auto mt-3 grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-3">
              <div className="flex min-w-0 gap-2 overflow-x-auto py-1" role="tablist" aria-label="标签筛选">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === effectiveActiveTagId}
                    className={cn(
                      'inline-flex h-8 flex-none items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition',
                      tab.id === effectiveActiveTagId
                        ? 'border-[var(--border)] bg-white text-[var(--foreground)] shadow-[var(--shadow-muted)]'
                        : 'border-transparent text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)]',
                    )}
                    onClick={() => setActiveTagId(tab.id)}
                  >
                    {tab.colorValue ? (
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tab.colorValue }} />
                    ) : null}
                    {tab.label}
                  </button>
                ))}
              </div>
            </section>

            {filteredNotes.length > 0 ? (
              <section className="mx-auto mt-4 grid max-w-7xl grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-4">
                {filteredNotes.map((note) =>
                  renderNoteCard(
                    note,
                    getNoteSnippets(note, snippets),
                    formatSavedAt(note.savedAt),
                    () => openNoteDetail(note),
                    <>
                      <a className="text-[var(--accent-strong)] hover:underline" href={note.sourceUrl} target="_blank" rel="noreferrer">
                        打开原笔记
                      </a>
                      <button
                        className="text-[rgba(214,90,60,0.82)] hover:underline"
                        type="button"
                        disabled={!canMutate || isMutating}
                        onClick={() => setConfirmAction({ type: 'note', note })}
                      >
                        删除
                      </button>
                    </>,
                  ),
                )}
              </section>
            ) : (
              <section className="mx-auto mt-16 max-w-xl text-center">
                <h2 className="text-lg font-extrabold">{error || '没有匹配到笔记'}</h2>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  {status === 'error' ? '云端文案库读取失败。' : '换个标签或关键词。'}
                </p>
              </section>
            )}
          </>
        ) : (
          <>
            <section className="mx-auto mt-4 grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="m-0 text-2xl font-extrabold">回收站</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[rgba(214,90,60,0.82)] hover:bg-[rgba(214,90,60,0.08)]"
                    disabled={!canMutate || trashGroups.length === 0}
                    onClick={() => setConfirmAction({ type: 'empty-trash' })}
                  >
                    清空回收站
                  </Button>
                </div>
              </div>
              {renderSortControl()}
            </section>

            {filteredTrashGroups.length > 0 ? (
              activeTrashGroup ? (
                <section className="mx-auto mt-4 max-w-7xl overflow-hidden rounded-[var(--ui-radius-panel)] border border-[var(--border)] bg-[var(--surface-muted)]">
                  <header className="flex items-center gap-3 border-b border-[var(--border)] p-4">
                    <Button variant="secondary" size="sm" onClick={() => setActiveTrashGroupId('')}>
                      返回
                    </Button>
                    <h3 className="min-w-0 flex-1 truncate text-lg font-extrabold">
                      {activeTrashGroup.folderName}
                    </h3>
                    {activeTrashGroup.folderDeleted ? (
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!canMutate || isMutating}
                          onClick={() => void handleRestoreTrashFolder(activeTrashGroup)}
                        >
                          恢复文件夹
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[rgba(214,90,60,0.82)] hover:bg-[rgba(214,90,60,0.08)]"
                          disabled={!canMutate || isMutating}
                          onClick={() => setConfirmAction({ type: 'trash-folder', group: activeTrashGroup })}
                        >
                          彻底删除
                        </Button>
                      </div>
                    ) : null}
                  </header>
                  {activeTrashGroup.notes.length > 0 ? (
                    <section className="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-4 p-4">
                      {activeTrashGroup.notes.map((entry) =>
                        renderNoteCard(
                          toSavedNoteRecord(entry.note),
                          entry.snippets,
                          getTrashRemainingLabel(entry.deletedAt),
                          () => openTrashNoteDetail(entry),
                          <TrashNoteMenu
                            entry={entry}
                            disabled={!canMutate || isMutating}
                            onDelete={() => setConfirmAction({ type: 'trash-note', entry })}
                            onRestore={() => void handleRestoreTrashNote(entry)}
                          />,
                        ),
                      )}
                    </section>
                  ) : (
                    <div className="p-8 text-sm font-bold text-[var(--muted-foreground)]">
                      这个文件夹删除时没有笔记。
                    </div>
                  )}
                </section>
              ) : (
                <section className="mx-auto mt-6 grid max-w-7xl grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-5">
                  {filteredTrashGroups.map((group) => (
                    <button
                      key={group.id}
                      className="grid justify-items-center gap-2 rounded-[var(--ui-field-radius)] p-3 text-center transition hover:bg-white/70"
                      type="button"
                      onClick={() => setActiveTrashGroupId(group.id)}
                    >
                      <FolderOpen className="h-10 w-10 text-[var(--muted-foreground)]" />
                      <span className="line-clamp-2 text-sm font-extrabold">{group.folderName}</span>
                      <Badge variant="default">
                        {group.notes.length} 篇 · 还剩 {getTrashRemainingDays(group.deletedAt)} 天
                      </Badge>
                    </button>
                  ))}
                </section>
              )
            ) : (
              <section className="mx-auto mt-16 max-w-xl text-center">
                <h2 className="text-lg font-extrabold">回收站是空的</h2>
              </section>
            )}
          </>
        )}
      </section>

      {selectedDetailNote && noteDraft ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[rgba(15,23,42,0.28)] p-5 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) resetDetail()
          }}
        >
          <section
            className="grid max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[var(--ui-radius-dialog)] border border-white/70 bg-[var(--surface-raised-strong)] shadow-[var(--shadow-elevated)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-detail-title"
          >
            <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <h2 id="note-detail-title" className="truncate text-xl font-extrabold">
                  {getDisplayNoteTitle(selectedDetailNote)}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {detailTrashEntry ? '回收站详情' : getDisplayAuthorName(selectedDetailNote.authorName)}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label="关闭详情" onClick={resetDetail}>
                <X className="h-4 w-4" />
              </Button>
            </header>

            {!detailTrashEntry ? (
              <div className="grid gap-3 border-b border-[var(--border)] px-5 py-4 md:grid-cols-4">
                <label className="grid gap-1.5">
                  <span className="text-xs font-bold text-[var(--muted-foreground)]">标题</span>
                  <Input
                    value={noteDraft.title}
                    onChange={(event) =>
                      updateNoteDraft(selectedDetailNote.id, { ...noteDraft, title: event.target.value })
                    }
                    disabled={!canMutate || isMutating}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-bold text-[var(--muted-foreground)]">文件名</span>
                  <Input
                    value={noteDraft.filename}
                    onChange={(event) =>
                      updateNoteDraft(selectedDetailNote.id, { ...noteDraft, filename: event.target.value })
                    }
                    disabled={!canMutate || isMutating}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-bold text-[var(--muted-foreground)]">作者</span>
                  <Input
                    value={noteDraft.authorName}
                    onChange={(event) =>
                      updateNoteDraft(selectedDetailNote.id, { ...noteDraft, authorName: event.target.value })
                    }
                    disabled={!canMutate || isMutating}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-bold text-[var(--muted-foreground)]">文件夹</span>
                  <Select
                    value={noteDraft.folderId || NO_FOLDER}
                    onValueChange={(value) =>
                      updateNoteDraft(selectedDetailNote.id, { ...noteDraft, folderId: value })
                    }
                    disabled={!canMutate || isMutating}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_FOLDER}>未归档</SelectItem>
                      {folders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
            ) : null}

            <div className="grid min-h-0 gap-4 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
              <Card className="min-h-0 overflow-hidden">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle>正文</CardTitle>
                    <CardDescription>选中文字填入片段</CardDescription>
                  </div>
                  <Badge variant="outline">
                    {detailContent.trim() ? `${detailContent.trim().length} 字` : '未抓到正文'}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div
                    ref={noteContentRef}
                    className="max-h-[46vh] whitespace-pre-wrap overflow-y-auto rounded-[var(--ui-radius-card)] bg-white/72 p-4 text-[15px] leading-8 text-[var(--foreground)]"
                    onMouseUp={() => window.setTimeout(updateReaderSelection, 0)}
                    onKeyUp={updateReaderSelection}
                  >
                    {detailContent.trim() ? (
                      detailContentSegments.map((segment, index) => {
                        const visibleHighlight = segment.visibleHighlight
                        const isActiveHighlight = segment.highlights.some(
                          (highlight) => highlight.snippetId === activeSnippetId,
                        )
                        return visibleHighlight ? (
                          <mark
                            key={`highlight-${index}`}
                            className={cn(
                              'rounded border-b-2 px-0.5 py-0.5 text-inherit transition',
                              isActiveHighlight && 'outline outline-2 outline-offset-2 outline-[rgba(15,23,42,0.16)]',
                            )}
                            style={{
                              backgroundColor: getHighlightWash(visibleHighlight.colorValue),
                              borderColor: visibleHighlight.colorValue || COLOR_PRESETS[0],
                            }}
                          >
                            {segment.text}
                          </mark>
                        ) : (
                          <span key={`text-${index}`}>{segment.text}</span>
                        )
                      })
                    ) : (
                      <p className="text-[var(--muted-foreground)]">未抓到正文</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="min-h-0 overflow-hidden">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle>高亮片段</CardTitle>
                    <CardDescription>{snippetDrafts.length} 个片段</CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!canMutate || isMutating}
                    onClick={addSnippetDraft}
                  >
                    + 新增
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="grid max-h-[52vh] gap-3 overflow-y-auto pr-1">
                    {snippetDrafts.map((draft, index) => {
                      const selectedTagName =
                        tagNameByColor.get(draft.colorValue) || draft.colorTagName
                      return (
                        <article
                          key={draft.id}
                          className={cn(
                            'grid gap-3 rounded-[var(--ui-radius-card)] border bg-[var(--surface-muted)] p-4',
                            draft.id === activeSnippetId ? 'border-[var(--accent-strong)]' : 'border-[var(--border)]',
                          )}
                          style={{ borderLeftColor: draft.colorValue || COLOR_PRESETS[0], borderLeftWidth: 4 }}
                          onClick={() => setActiveSnippetId(draft.id)}
                          onFocusCapture={() => setActiveSnippetId(draft.id)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-extrabold">
                              <Badge>{index + 1}</Badge>
                              <span>片段 {index + 1}</span>
                              {draft.id === activeSnippetId ? <Badge variant="accent">当前</Badge> : null}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!canMutate || isMutating}
                              onClick={(event) => {
                                event.stopPropagation()
                                removeSnippetDraft(draft.id)
                              }}
                            >
                              删除
                            </Button>
                          </div>
                          <div className="grid gap-2">
                            <span className="text-xs font-bold text-[var(--muted-foreground)]">颜色标签</span>
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                              {editingTagName?.snippetId === draft.id ? (
                                <div className="grid h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--ui-field-radius)] border border-[var(--border)] bg-white px-3">
                                  <span
                                    className="h-3 w-3 rounded-full"
                                    style={{ backgroundColor: editingTagName.colorValue || draft.colorValue }}
                                  />
                                  <input
                                    ref={tagNameInputRef}
                                    className="min-w-0 bg-transparent text-sm font-bold outline-none"
                                    value={editingTagName.tagName}
                                    maxLength={8}
                                    placeholder="标签名"
                                    aria-label="标签名"
                                    onChange={(event) =>
                                      setEditingTagName((current) =>
                                        current ? { ...current, tagName: event.target.value } : current,
                                      )
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault()
                                        confirmTagNameEdit()
                                      }
                                      if (event.key === 'Escape') {
                                        event.preventDefault()
                                        setEditingTagName(null)
                                      }
                                    }}
                                  />
                                  <button type="button" onClick={() => setEditingTagName(null)}>
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <Select
                                  value={draft.colorValue}
                                  onValueChange={(value) =>
                                    updateSnippetDraft(draft.id, {
                                      colorValue: value,
                                      colorTagName: tagNameByColor.get(value) || '',
                                    })
                                  }
                                  disabled={!canMutate || isMutating}
                                >
                                  <SelectTrigger>
                                    <span className="inline-flex items-center gap-2">
                                      <span
                                        className="h-3 w-3 rounded-full"
                                        style={{ backgroundColor: draft.colorValue || COLOR_PRESETS[0] }}
                                      />
                                      {getReadableTagName(selectedTagName)}
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent align="start">
                                    {tagOptions.map((option) => (
                                      <SelectItem key={option.color} value={option.color}>
                                        <span className="inline-flex items-center gap-2">
                                          <span
                                            className="h-3 w-3 rounded-full"
                                            style={{ backgroundColor: option.color }}
                                          />
                                          {option.tagName || '未命名'}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={!canMutate || isMutating}
                                onClick={() => {
                                  if (editingTagName?.snippetId === draft.id) {
                                    confirmTagNameEdit()
                                    return
                                  }
                                  startTagNameEdit(draft)
                                }}
                              >
                                {editingTagName?.snippetId === draft.id ? '确认' : '编辑'}
                              </Button>
                            </div>
                          </div>
                          <label className="grid gap-2">
                            <span className="text-xs font-bold text-[var(--muted-foreground)]">高亮原文</span>
                            <Textarea
                              className="min-h-[4.75rem]"
                              value={draft.selectedText}
                              placeholder="输入高亮原文"
                              disabled={!canMutate || isMutating}
                              onFocus={() => setActiveSnippetId(draft.id)}
                              onChange={(event) =>
                                updateSnippetDraft(draft.id, { selectedText: event.target.value })
                              }
                            />
                          </label>
                          <label className="grid gap-2">
                            <span className="text-xs font-bold text-[var(--muted-foreground)]">记录理由</span>
                            <Textarea
                              className="min-h-[4.75rem]"
                              value={draft.reasonText}
                              placeholder="为什么值得参考"
                              disabled={!canMutate || isMutating}
                              onFocus={() => setActiveSnippetId(draft.id)}
                              onChange={(event) =>
                                updateSnippetDraft(draft.id, { reasonText: event.target.value })
                              }
                            />
                          </label>
                        </article>
                      )
                    })}
                    {snippetDrafts.length === 0 ? (
                      <div className="rounded-[var(--ui-radius-card)] border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm font-bold text-[var(--muted-foreground)]">
                        暂无高亮片段
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </div>

            <footer className="flex items-center justify-between gap-4 border-t border-[var(--border)] px-5 py-4">
              <span className="text-sm font-bold text-[var(--muted-foreground)]" role="status">
                {detailFeedback}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={resetDetail}>
                  关闭
                </Button>
                {!detailTrashEntry ? (
                  <Button type="button" variant="secondary" disabled={!canMutate || isMutating} onClick={() => void handleSaveNote()}>
                    保存笔记
                  </Button>
                ) : null}
                <Button type="button" disabled={!canMutate || isMutating} onClick={() => void handleSaveDetailSnippets()}>
                  保存片段
                </Button>
              </div>
            </footer>

            {readerSelection && activeSnippetId ? (
              <button
                className="fixed z-[60] rounded-full bg-[var(--foreground)] px-3 py-2 text-xs font-extrabold text-white shadow-lg"
                type="button"
                style={{ top: readerSelection.top, left: readerSelection.left }}
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
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(15,23,42,0.28)] p-5 backdrop-blur-sm">
          <section
            className="w-full max-w-md rounded-[var(--ui-radius-dialog)] border border-white/70 bg-[var(--surface-raised-strong)] p-5 shadow-[var(--shadow-elevated)]"
            role="alertdialog"
            aria-modal="true"
          >
            <h2 className="text-lg font-extrabold">{getConfirmTitle(confirmAction)}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {getConfirmDescription(confirmAction)}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmAction(null)}>
                取消
              </Button>
              <Button
                type="button"
                className="bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:bg-[#c94e34]"
                onClick={() => void handleConfirmAction()}
              >
                {confirmAction.type === 'empty-trash' ? '清空' : confirmAction.type.startsWith('trash') ? '彻底删除' : '删除'}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function TrashNoteMenu({
  disabled,
  entry,
  onDelete,
  onRestore,
}: {
  disabled: boolean
  entry: TrashNoteEntry
  onDelete: () => void
  onRestore: () => void
}) {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        className="grid h-8 w-8 place-items-center rounded-full hover:bg-[var(--surface-muted)]"
        aria-label="更多操作"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {isOpen ? (
        <div className="absolute right-0 top-9 z-10 grid min-w-28 gap-1 rounded-[var(--ui-radius-card)] border border-[var(--border)] bg-white p-1 text-left shadow-[var(--shadow-card)]">
          <button
            type="button"
            className="rounded-[var(--ui-radius-item)] px-3 py-2 text-left hover:bg-[var(--surface-muted)]"
            onClick={() => {
              setIsOpen(false)
              onRestore()
            }}
          >
            恢复
          </button>
          <button
            type="button"
            className="rounded-[var(--ui-radius-item)] px-3 py-2 text-left text-[rgba(214,90,60,0.88)] hover:bg-[rgba(214,90,60,0.08)]"
            onClick={() => {
              setIsOpen(false)
              onDelete()
            }}
          >
            彻底删除
          </button>
          <a
            className="rounded-[var(--ui-radius-item)] px-3 py-2 text-left hover:bg-[var(--surface-muted)]"
            href={entry.note.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => setIsOpen(false)}
          >
            打开原笔记
          </a>
        </div>
      ) : null}
    </div>
  )
}
