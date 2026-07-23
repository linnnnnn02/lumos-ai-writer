import { useEffect, useMemo, useRef, useState } from 'react'
import {
  normalizeNoteUrl,
  type ExtractedNoteRecord,
  type PendingSnippetSelectionRecord,
  type SavedFolderRecord,
  type SavedNoteRecord,
  type SavedSnippetRecord,
} from '@lumos-ai/shared'
import {
  clearPendingSnippetSelection,
  COLOR_TAG_NAMES_STORAGE_KEY,
  createDefaultFolders,
  getColorTagNames,
  getPendingSnippetSelection,
  getSavedFolders,
  getSavedNotes,
  getSavedSnippets,
  PENDING_SNIPPET_SELECTION_KEY,
  saveColorTagNames,
  saveFolders,
  saveNotes,
  saveSnippets,
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
import { AiEditing, ArrowUpRight, Library } from '../../components/ui/icon'
import {
  getCloudAuthState,
  getValidCloudAccessToken,
  signInToCloud,
  signOutFromCloud,
  type CloudAuthState,
} from '../../lib/cloud-auth'
import { syncAnnotationToCloud } from '../../lib/cloud-api'

const defaultFolders = createDefaultFolders()
const UNTITLED_NOTE_TITLE = '无标题'
const COLOR_PRESETS = ['#64748B', '#4D78F2', '#2A9D8F', '#8B5CF6', '#E9C46A', '#E56B6F']
const CREATION_PAGE_URL = 'https://lumos-ai-writer.pages.dev/'
const colorNameMap: Record<string, string> = {
  '#64748B': '灰色',
  '#DD6C32': '红色',
  '#E9C46A': '黄色',
  '#2A9D8F': '绿色',
  '#4D78F2': '蓝色',
  '#8B5CF6': '紫色',
  '#E56B6F': '红色',
}

type ExtractState = {
  status: 'idle' | 'loading' | 'success' | 'error'
  note: ExtractedNoteRecord | null
  error: string
}

type PanelView = 'capture' | 'result'

type NoteDraft = {
  title: string
  authorName: string
  sourceUrl: string
  coverImageUrl: string
  contentText: string
}

type RuntimeMessage = {
  type?: string
  url?: string
}

type TabChangeInfo = {
  status?: string
  url?: string
}

function cleanText(text: string | null | undefined) {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function cleanStructuredText(text: string | null | undefined) {
  return (text ?? '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\u3000]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getDisplayNoteTitle(text: string | null | undefined) {
  return cleanText(text) || UNTITLED_NOTE_TITLE
}

function getNoteDraft(note: ExtractedNoteRecord): NoteDraft {
  return {
    title: getDisplayNoteTitle(note.title),
    authorName: note.authorName || '',
    sourceUrl: note.sourceUrl || '',
    coverImageUrl: note.coverImageUrl || '',
    contentText: note.contentText || '',
  }
}

function getResolvedAnnotationTitle(
  note: ExtractedNoteRecord | null,
  selection: PendingSnippetSelectionRecord | null,
) {
  if (note) return getDisplayNoteTitle(note.title)
  return getDisplayNoteTitle(selection?.noteTitle)
}

function getColorFallbackName(color: string) {
  return colorNameMap[color] || '标签'
}

function normalizeTagName(text: string) {
  return cleanText(text)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '未知错误'
}

async function getActiveTab() {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  })

  return tab
}

export function SidepanelApp() {
  const [folders, setFolders] = useState<SavedFolderRecord[]>(defaultFolders)
  const [savedNotes, setSavedNotes] = useState<SavedNoteRecord[]>([])
  const [savedSnippets, setSavedSnippets] = useState<SavedSnippetRecord[]>([])
  const [colorTagNames, setColorTagNames] = useState<Record<string, string>>({})
  const [pendingSelection, setPendingSelection] =
    useState<PendingSnippetSelectionRecord | null>(null)
  const [savedAnnotationSelection, setSavedAnnotationSelection] =
    useState<PendingSnippetSelectionRecord | null>(null)
  const [folderId, setFolderId] = useState(defaultFolders[0].id)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [isFolderSelectOpen, setIsFolderSelectOpen] = useState(false)
  const [filename, setFilename] = useState('')
  const [isFilenameDirty, setIsFilenameDirty] = useState(false)
  const [panelView, setPanelView] = useState<PanelView>('capture')
  const [isEditingResult, setIsEditingResult] = useState(false)
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const [selectedColor, setSelectedColor] = useState(COLOR_PRESETS[0])
  const [tagNameDraft, setTagNameDraft] = useState('')
  const [isEditingTagName, setIsEditingTagName] = useState(true)
  const [reasonText, setReasonText] = useState('')
  const [annotationFeedback, setAnnotationFeedback] = useState('')
  const [cloudAuthState, setCloudAuthState] = useState<CloudAuthState>({
    status: 'unauthenticated',
    user: null,
  })
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudPassword, setCloudPassword] = useState('')
  const [cloudFeedback, setCloudFeedback] = useState('')
  const [isCloudSigningIn, setIsCloudSigningIn] = useState(false)
  const [isCloudSyncing, setIsCloudSyncing] = useState(false)
  const [isAnnotationSaving, setIsAnnotationSaving] = useState(false)
  const [extractState, setExtractState] = useState<ExtractState>({
    status: 'idle',
    note: null,
    error: '',
  })
  const newFolderInputRef = useRef<HTMLInputElement | null>(null)
  const tagNameInputRef = useRef<HTMLInputElement | null>(null)
  const isFilenameDirtyRef = useRef(false)
  const latestExtractRequestRef = useRef(0)
  const lastExtractedNoteUrlRef = useRef('')
  const isSavingAnnotationRef = useRef(false)

  async function loadFolders() {
    const normalizedFolders = await getSavedFolders()

    setFolders(normalizedFolders)
    setFolderId((currentFolderId) => {
      if (normalizedFolders.some((folder) => folder.id === currentFolderId)) {
        return currentFolderId
      }

      return normalizedFolders[0]?.id ?? currentFolderId
    })
  }

  async function loadAnnotationData() {
    const [nextNotes, nextSnippets, nextPendingSelection, nextColorTagNames] = await Promise.all([
      getSavedNotes(),
      getSavedSnippets(),
      getPendingSnippetSelection(),
      getColorTagNames(),
    ])

    setSavedNotes(nextNotes)
    setSavedSnippets(nextSnippets)
    setPendingSelection(nextPendingSelection)
    if (nextPendingSelection) {
      setSavedAnnotationSelection(null)
    }
    setColorTagNames(nextColorTagNames)
  }

  async function handleExtract(options?: { preserveFilename?: boolean }) {
    const requestId = latestExtractRequestRef.current + 1
    latestExtractRequestRef.current = requestId

    setExtractState({
      status: 'loading',
      note: null,
      error: '',
    })

    const activeTab = await getActiveTab()
    const tabId = activeTab?.id

    if (!tabId) {
      setExtractState({
        status: 'error',
        note: null,
        error: '没有找到当前标签页，请重新打开插件再试一次。',
      })
      return
    }

    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'XHS_EXTRACT_NOTE',
      })

      if (!response?.ok) {
        if (requestId !== latestExtractRequestRef.current) return
        setExtractState({
          status: 'error',
          note: null,
          error: response?.error || '抓取失败，请确认当前页面已经完全加载。',
        })
        return
      }

      const nextNote: ExtractedNoteRecord = {
        ...response.data,
        title: getDisplayNoteTitle(response.data.title),
      }
      const nextNoteUrl = normalizeNoteUrl(nextNote.sourceUrl)
      const previousNoteUrl = lastExtractedNoteUrlRef.current
      const isDifferentNote = Boolean(previousNoteUrl && nextNoteUrl !== previousNoteUrl)
      const shouldResetFilename =
        !options?.preserveFilename &&
        (!isFilenameDirtyRef.current || isDifferentNote || !previousNoteUrl)

      if (requestId !== latestExtractRequestRef.current) return

      lastExtractedNoteUrlRef.current = nextNoteUrl

      if (shouldResetFilename) {
        setFilename(nextNote.title)
        setIsFilenameDirty(false)
        isFilenameDirtyRef.current = false
      }

      setExtractState({
        status: 'success',
        note: nextNote,
        error: '',
      })
      setNoteDraft(getNoteDraft(nextNote))
    } catch {
      if (requestId !== latestExtractRequestRef.current) return
      setExtractState({
        status: 'error',
        note: null,
        error: '请打开小红书笔记页，刷新后重试。',
      })
    }
  }

  useEffect(() => {
    void loadFolders()
    void loadAnnotationData()
    void handleExtract()
  }, [])

  useEffect(() => {
    let isMounted = true

    void getCloudAuthState()
      .then((state) => {
        if (!isMounted) return
        setCloudAuthState(state)
        if (state.status === 'authenticated' && state.user.email) {
          setCloudEmail(state.user.email)
        }
      })
      .catch(() => {
        if (!isMounted) return
        setCloudAuthState({ status: 'unauthenticated', user: null })
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    isFilenameDirtyRef.current = isFilenameDirty
  }, [isFilenameDirty])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== 'local') return
      if (changes.savedFolders) {
        void loadFolders()
      }
      if (
        changes.savedNotes ||
        changes.savedSnippets ||
        changes[PENDING_SNIPPET_SELECTION_KEY] ||
        changes[COLOR_TAG_NAMES_STORAGE_KEY]
      ) {
        if (isSavingAnnotationRef.current) return

        const hasNewPendingSelection = Boolean(
          changes[PENDING_SNIPPET_SELECTION_KEY]?.newValue,
        )
        if (hasNewPendingSelection) {
          setPanelView('capture')
        }
        void loadAnnotationData()
        if (hasNewPendingSelection) {
          void handleExtract()
        }
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    if (typeof chrome === 'undefined') return

    let refreshTimer = 0

    function scheduleExtract(delay = 350) {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        void handleExtract()
      }, delay)
    }

    function handleRuntimeMessage(message: RuntimeMessage) {
      if (message.type !== 'XHS_NOTE_ROUTE_CHANGED') return
      scheduleExtract(450)
      window.setTimeout(() => {
        void handleExtract()
      }, 1100)
    }

    function handleTabActivated() {
      scheduleExtract(250)
    }

    function handleTabUpdated(tabId: number, changeInfo: TabChangeInfo) {
      if (!changeInfo.url && changeInfo.status !== 'complete') return

      void getActiveTab().then((activeTab) => {
        if (activeTab?.id !== tabId) return
        scheduleExtract(changeInfo.url ? 450 : 150)
      })
    }

    chrome.runtime?.onMessage?.addListener(handleRuntimeMessage)
    chrome.tabs?.onActivated?.addListener(handleTabActivated)
    chrome.tabs?.onUpdated?.addListener(handleTabUpdated)

    return () => {
      window.clearTimeout(refreshTimer)
      chrome.runtime?.onMessage?.removeListener(handleRuntimeMessage)
      chrome.tabs?.onActivated?.removeListener(handleTabActivated)
      chrome.tabs?.onUpdated?.removeListener(handleTabUpdated)
    }
  }, [])

  useEffect(() => {
    if (!extractState.note) return

    setNoteDraft(getNoteDraft(extractState.note))
  }, [extractState.note])

  const activeAnnotationSelection = pendingSelection ?? savedAnnotationSelection
  const annotationStatus = pendingSelection ? 'pending' : savedAnnotationSelection ? 'saved' : 'empty'

  const tagNameByColor = useMemo(() => {
    const map = new Map<string, string>()
    Object.entries(colorTagNames).forEach(([color, tagName]) => {
      map.set(color, cleanText(tagName))
    })
    savedSnippets.forEach((snippet) => {
      const color = snippet.colorValue || COLOR_PRESETS[0]
      if (map.has(color)) return
      const tagName = cleanText(snippet.colorTagName)
      if (tagName) map.set(color, tagName)
    })
    return map
  }, [colorTagNames, savedSnippets])

  const selectedColorTagName = tagNameByColor.get(selectedColor) || ''
  const tagOptions = useMemo(
    () => COLOR_PRESETS.map((color) => ({ color, tagName: tagNameByColor.get(color) || '' })),
    [tagNameByColor],
  )

  useEffect(() => {
    const existingTagName = tagNameByColor.get(selectedColor) || ''
    setTagNameDraft(existingTagName)
    setIsEditingTagName(false)
  }, [selectedColor, tagNameByColor])

  useEffect(() => {
    if (!pendingSelection) return
    setSavedAnnotationSelection(null)
    setReasonText('')
    setAnnotationFeedback('')
  }, [pendingSelection?.createdAt])

  useEffect(() => {
    if (!isCreatingFolder) return
    newFolderInputRef.current?.focus()
  }, [isCreatingFolder])

  useEffect(() => {
    if (!isEditingTagName) return
    tagNameInputRef.current?.focus()
  }, [isEditingTagName])

  function handleStartCreateFolder() {
    setNewFolderName('')
    setIsFolderSelectOpen(false)
    setIsCreatingFolder(true)
  }

  function handleCancelCreateFolder() {
    setNewFolderName('')
    setIsCreatingFolder(false)
  }

  function handleCancelTagNameEdit() {
    setTagNameDraft(selectedColorTagName)
    setIsEditingTagName(false)
  }

  async function handleCreateFolder() {
    const trimmedName = newFolderName.trim()
    if (!trimmedName) return

    const record: SavedFolderRecord = {
      id: crypto.randomUUID(),
      name: trimmedName,
      noteCount: 0,
      updatedAt: new Date().toISOString(),
    }

    const nextFolders = [record, ...folders]
    await saveFolders(nextFolders)

    setNewFolderName('')
    setFolderId(record.id)
    setIsCreatingFolder(false)
  }

  function handleOpenManager() {
    void chrome.tabs.create({
      url: chrome.runtime.getURL('options.html'),
    })
  }

  function handleOpenCreationPage() {
    void chrome.tabs.create({
      url: CREATION_PAGE_URL,
    })
  }

  async function handleCloudSignIn() {
    const email = cloudEmail.trim()
    const password = cloudPassword

    if (!email || !password) {
      setCloudFeedback('请输入邮箱和密码。')
      return
    }

    setIsCloudSigningIn(true)
    setCloudFeedback('')

    try {
      const nextAuthState = await signInToCloud(email, password)
      setCloudAuthState(nextAuthState)
      setCloudPassword('')
      setCloudFeedback('云端已连接。')
    } catch (error) {
      setCloudFeedback(`登录失败：${getErrorMessage(error)}`)
    } finally {
      setIsCloudSigningIn(false)
    }
  }

  async function handleCloudSignOut() {
    await signOutFromCloud()
    setCloudAuthState({ status: 'unauthenticated', user: null })
    setCloudPassword('')
    setCloudFeedback('已退出云端同步。')
  }

  async function handleSaveTagName() {
    const nextTagName = normalizeTagName(tagNameDraft)
    const nextColorTagNames = {
      ...colorTagNames,
      [selectedColor]: nextTagName,
    }

    const nextSnippets = savedSnippets.map((snippet) => {
      const sameColor = (snippet.colorValue || COLOR_PRESETS[0]) === selectedColor
      if (!sameColor) return snippet

      return {
        ...snippet,
        colorTagName: nextTagName,
      }
    })

    await Promise.all([saveColorTagNames(nextColorTagNames), saveSnippets(nextSnippets)])

    setColorTagNames(nextColorTagNames)
    setSavedSnippets(nextSnippets)
    setTagNameDraft(nextTagName)
    setIsEditingTagName(false)
    setAnnotationFeedback('标签名已更新。')
  }

  async function handleSaveAnnotation() {
    if (isSavingAnnotationRef.current) return

    if (!pendingSelection) {
      const currentFolder = folders.find((folder) => folder.id === folderId)
      setAnnotationFeedback(
        savedAnnotationSelection
          ? `已保存到「${currentFolder?.name || '文案库'}」。`
          : '先在正文里选中一段文字。',
      )
      return
    }

    const savedSelection = pendingSelection
    const targetUrl = normalizeNoteUrl(pendingSelection.noteUrl)
    const activeFolder = folders.find((folder) => folder.id === folderId)
    const existingNote = savedNotes.find((note) => normalizeNoteUrl(note.sourceUrl) === targetUrl)
    const now = new Date().toISOString()
    const extractedNoteForSelection =
      extractState.note && normalizeNoteUrl(extractState.note.sourceUrl) === targetUrl
        ? extractState.note
        : null
    const sourceUrl =
      cleanText(pendingSelection.noteUrl) ||
      cleanText(extractedNoteForSelection?.sourceUrl) ||
      cleanText(existingNote?.sourceUrl) ||
      targetUrl
    const resolvedTitle = getResolvedAnnotationTitle(extractedNoteForSelection, pendingSelection)
    const nextNote: SavedNoteRecord = {
      id: existingNote?.id ?? crypto.randomUUID(),
      folderId,
      folderName: activeFolder?.name ?? '',
      filename: cleanText(filename) || resolvedTitle,
      title: resolvedTitle,
      authorName:
        cleanText(extractedNoteForSelection?.authorName) ||
        cleanText(pendingSelection.noteAuthorName) ||
        existingNote?.authorName ||
        '',
      sourceUrl,
      coverImageUrl:
        cleanText(extractedNoteForSelection?.coverImageUrl) || existingNote?.coverImageUrl || '',
      contentText:
        cleanStructuredText(extractedNoteForSelection?.contentText) ||
        existingNote?.contentText ||
        '',
      savedAt: now,
    }
    const nextNotes = existingNote
      ? savedNotes.map((note) => (normalizeNoteUrl(note.sourceUrl) === targetUrl ? nextNote : note))
      : [nextNote, ...savedNotes]
    const nextTagName = normalizeTagName(
      isEditingTagName ? tagNameDraft : selectedColorTagName,
    )
    const nextColorTagNames = isEditingTagName
      ? {
          ...colorTagNames,
          [selectedColor]: nextTagName,
        }
      : colorTagNames
    const updatedSnippets = savedSnippets.map((snippet) => {
      const sameColor = (snippet.colorValue || COLOR_PRESETS[0]) === selectedColor
      if (!sameColor) return snippet

      return {
        ...snippet,
        colorTagName: nextTagName,
      }
    })
    const record: SavedSnippetRecord = {
      id: crypto.randomUUID(),
      noteUrl: sourceUrl,
      noteTitle: resolvedTitle,
      noteAuthorName: extractedNoteForSelection?.authorName || pendingSelection.noteAuthorName || '',
      selectedText: pendingSelection.selectedText,
      reasonText: cleanText(reasonText),
      colorTagName: nextTagName,
      colorValue: selectedColor,
      createdAt: new Date().toISOString(),
    }
    const nextSnippets = [record, ...updatedSnippets]

    isSavingAnnotationRef.current = true
    setIsAnnotationSaving(true)
    try {
      if (isEditingTagName) {
        await Promise.all([
          saveColorTagNames(nextColorTagNames),
          saveNotes(nextNotes),
          saveSnippets(nextSnippets),
        ])
        setColorTagNames(nextColorTagNames)
      } else {
        await Promise.all([saveNotes(nextNotes), saveSnippets(nextSnippets)])
      }
      await clearPendingSnippetSelection()
      setSavedNotes(nextNotes)
      setSavedSnippets(nextSnippets)
      setSavedAnnotationSelection(savedSelection)
      setPendingSelection(null)
      setTagNameDraft(nextTagName)
      setIsEditingTagName(false)
      const localSavedMessage = `已保存到「${activeFolder?.name || '文案库'}」。`

      if (cloudAuthState.status !== 'authenticated') {
        setAnnotationFeedback(localSavedMessage)
        return
      }

      setIsCloudSyncing(true)
      setAnnotationFeedback(`${localSavedMessage} 正在同步...`)

      try {
        const token = await getValidCloudAccessToken()
        if (!token) {
          setCloudAuthState({ status: 'unauthenticated', user: null })
          setCloudFeedback('云端登录已过期，请重新登录。')
          setAnnotationFeedback(`${localSavedMessage} 云端登录已过期，请重新登录。`)
          return
        }

        await syncAnnotationToCloud(token, {
          folder: activeFolder ?? null,
          note: nextNote,
          snippet: record,
        })
        setCloudFeedback('已同步到云端。')
        setAnnotationFeedback(`${localSavedMessage} 已同步到云端。`)
      } catch (error) {
        const message = getErrorMessage(error)
        setCloudFeedback(`云端同步失败：${message}`)
        setAnnotationFeedback(`${localSavedMessage} 云端同步失败：${message}`)
      } finally {
        setIsCloudSyncing(false)
      }
    } finally {
      setIsAnnotationSaving(false)
      window.setTimeout(() => {
        isSavingAnnotationRef.current = false
      }, 300)
    }
  }

  async function handleCancelAnnotation() {
    await clearPendingSnippetSelection()
    setPendingSelection(null)
    setSavedAnnotationSelection(null)
    setReasonText('')
    setAnnotationFeedback('')
  }

  function handleStartEdit() {
    if (!extractState.note) return
    setNoteDraft(getNoteDraft(extractState.note))
    setIsEditingResult(true)
  }

  function handleCancelEdit() {
    if (!extractState.note) {
      setIsEditingResult(false)
      return
    }

    setNoteDraft(getNoteDraft(extractState.note))
    setIsEditingResult(false)
  }

  function handleSaveEdit() {
    if (!noteDraft) return

    const nextTitle = getDisplayNoteTitle(
      Array.from(noteDraft.title.trim()).slice(0, 20).join(''),
    )
    const nextNote: ExtractedNoteRecord = {
      title: nextTitle,
      authorName: noteDraft.authorName.trim(),
      sourceUrl: noteDraft.sourceUrl.trim(),
      coverImageUrl: noteDraft.coverImageUrl.trim(),
      contentText: noteDraft.contentText.trim(),
    }

    setExtractState((current) => ({
      ...current,
      note: nextNote,
    }))

    if (!isFilenameDirty || filename === getDisplayNoteTitle(extractState.note?.title)) {
      setFilename(nextTitle)
    }

    setIsEditingResult(false)
  }

  function renderPanelTabs() {
    return (
      <div className="sidepanel-header">
        <div className="sidepanel-tabs" role="tablist" aria-label="侧边栏视图">
          <button
            className={panelView === 'capture' ? 'sidepanel-tab active' : 'sidepanel-tab'}
            type="button"
            role="tab"
            aria-selected={panelView === 'capture'}
            onClick={() => setPanelView('capture')}
          >
            采集文案
          </button>
          <button
            className={panelView === 'result' ? 'sidepanel-tab active' : 'sidepanel-tab'}
            type="button"
            role="tab"
            aria-selected={panelView === 'result'}
            onClick={() => setPanelView('result')}
          >
            读取结果
          </button>
        </div>
        <nav className="sidepanel-destination-nav" aria-label="打开 Lumos 网页功能">
          <button
            className="sidepanel-destination-button"
            type="button"
            onClick={handleOpenManager}
          >
            <Library aria-hidden="true" />
            <span>笔记库</span>
          </button>
          <button
            className="sidepanel-destination-button workspace"
            type="button"
            onClick={handleOpenCreationPage}
          >
            <AiEditing aria-hidden="true" />
            <span>AI 写作台</span>
            <ArrowUpRight className="destination-arrow" aria-hidden="true" />
          </button>
        </nav>
      </div>
    )
  }

  function renderCloudSyncPanel() {
    const cloudUserLabel =
      cloudAuthState.status === 'authenticated'
        ? cloudAuthState.user.email || cloudAuthState.user.displayName || '已登录账号'
        : ''
    const cloudFeedbackIsError =
      cloudFeedback.includes('失败') || cloudFeedback.includes('过期')

    return (
      <section className="cloud-sync-panel" aria-label="云端同步">
        {cloudAuthState.status === 'authenticated' ? (
          <div className="cloud-sync-row">
            <div className="cloud-sync-account">
              <span
                className={isCloudSyncing ? 'cloud-sync-avatar syncing' : 'cloud-sync-avatar'}
                aria-hidden="true"
              >
                <img
                  src={cloudAuthState.user.avatarUrl || '/icon.svg'}
                  alt=""
                  referrerPolicy="no-referrer"
                  decoding="async"
                />
              </span>
              <div className="cloud-sync-copy">
                <span className="cloud-sync-title">云端同步</span>
                <span className="cloud-sync-user">{cloudUserLabel}</span>
              </div>
            </div>
            <button
              className="cloud-sync-text-button"
              type="button"
              onClick={() => {
                void handleCloudSignOut()
              }}
            >
              退出
            </button>
          </div>
        ) : (
          <form
            className="cloud-login-form"
            onSubmit={(event) => {
              event.preventDefault()
              void handleCloudSignIn()
            }}
          >
            <div className="cloud-login-title">云端同步</div>
            <Input
              className="cloud-login-input"
              type="email"
              value={cloudEmail}
              placeholder="邮箱"
              autoComplete="email"
              onChange={(event) => setCloudEmail(event.target.value)}
            />
            <Input
              className="cloud-login-input"
              type="password"
              value={cloudPassword}
              placeholder="密码"
              autoComplete="current-password"
              onChange={(event) => setCloudPassword(event.target.value)}
            />
            <button
              className="cloud-login-button"
              type="submit"
              disabled={isCloudSigningIn}
            >
              {isCloudSigningIn ? '登录中...' : '登录同步'}
            </button>
          </form>
        )}
        {cloudFeedback ? (
          <p className={cloudFeedbackIsError ? 'cloud-feedback error' : 'cloud-feedback'}>
            {cloudFeedback}
          </p>
        ) : null}
      </section>
    )
  }

  function renderSaveInfoFields() {
    return (
      <div className="save-info-card">
        <div className="save-info-row">
          <p className="field-label row-label">文件夹</p>
          <div className="save-info-controls">
            {isCreatingFolder ? (
              <div className="folder-create-row">
                <div className="folder-create-input-shell">
                  <Input
                    ref={newFolderInputRef}
                    className="folder-create-input"
                    value={newFolderName}
                    placeholder="输入文件夹名"
                    aria-label="新建文件夹名称"
                    onChange={(event) => setNewFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void handleCreateFolder()
                      }
                      if (event.key === 'Escape') {
                        handleCancelCreateFolder()
                      }
                    }}
                  />
                  <button
                    className="folder-create-cancel"
                    type="button"
                    aria-label="取消新建文件夹"
                    onClick={handleCancelCreateFolder}
                  >
                    ×
                  </button>
                </div>
                <button
                  className="folder-create-confirm"
                  type="button"
                  disabled={!newFolderName.trim()}
                  onClick={() => {
                    void handleCreateFolder()
                  }}
                >
                  确认
                </button>
              </div>
            ) : (
              <Select
                value={folderId}
                open={isFolderSelectOpen}
                onOpenChange={setIsFolderSelectOpen}
                onValueChange={setFolderId}
              >
                <SelectTrigger id="folder" aria-label="选择保存文件夹">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  footer={
                    <button
                      className="shadcn-select-footer-action"
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={handleStartCreateFolder}
                    >
                      + 新建文件夹
                    </button>
                  }
                >
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name} · {folder.noteCount} 篇
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="save-info-row">
          <label className="field-label row-label" htmlFor="filename">
            文件名
          </label>
          <Input
            id="filename"
            value={filename}
            placeholder="默认用笔记标题"
            onChange={(event) => {
              setFilename(event.target.value)
              setIsFilenameDirty(true)
              isFilenameDirtyRef.current = true
            }}
          />
        </div>
      </div>
    )
  }

  if (panelView === 'result') {
    return (
      <main className="sidepanel-shell">
        {renderPanelTabs()}
        {renderCloudSyncPanel()}

        <section className="sidepanel-card result-card">
          {extractState.note ? (
            <>
              <div className="result-card-toolbar">
                <span className="result-card-eyebrow">读取内容</span>
                {isEditingResult ? (
                  <div className="result-edit-actions">
                    <button className="ghost-button" type="button" onClick={handleCancelEdit}>
                      取消
                    </button>
                    <button className="secondary-button inline" type="button" onClick={handleSaveEdit}>
                      完成
                    </button>
                  </div>
                ) : (
                  <button className="ghost-button" type="button" onClick={handleStartEdit}>
                    编辑
                  </button>
                )}
              </div>
              <div className="result-grid">
                <div className="result-item">
                  <p className="result-key">标题</p>
                  {isEditingResult ? (
                    <Input
                      maxLength={20}
                      value={noteDraft?.title ?? ''}
                      onChange={(event) =>
                        setNoteDraft((current) =>
                          current
                            ? {
                                ...current,
                                title: event.target.value,
                              }
                            : current,
                        )
                      }
                    />
                  ) : (
                    <p className="result-value">{getDisplayNoteTitle(extractState.note.title)}</p>
                  )}
                </div>
              <div className="result-item">
                <p className="result-key">正文</p>
                {isEditingResult ? (
                  <Textarea
                    className="result-textarea result-body-editor"
                    value={noteDraft?.contentText ?? ''}
                    onChange={(event) =>
                      setNoteDraft((current) =>
                        current
                          ? {
                              ...current,
                              contentText: event.target.value,
                            }
                          : current,
                      )
                    }
                  />
                ) : (
                  <p className="result-value preserve-breaks">
                    {extractState.note.contentText || '未抓到正文'}
                  </p>
                )}
              </div>
              <div className="result-item">
                <p className="result-key">作者</p>
                {isEditingResult ? (
                  <Input
                    value={noteDraft?.authorName ?? ''}
                    onChange={(event) =>
                      setNoteDraft((current) =>
                        current
                          ? {
                              ...current,
                              authorName: event.target.value,
                            }
                          : current,
                      )
                    }
                  />
                ) : (
                  <p className="result-value">
                    {extractState.note.authorName || '未抓到作者昵称'}
                  </p>
                )}
              </div>
              <div className="result-item">
                <p className="result-key">链接</p>
                {isEditingResult ? (
                  <Textarea
                    className="result-textarea"
                    value={noteDraft?.sourceUrl ?? ''}
                    onChange={(event) =>
                      setNoteDraft((current) =>
                        current
                          ? {
                              ...current,
                              sourceUrl: event.target.value,
                            }
                          : current,
                      )
                    }
                  />
                ) : (
                  <p className="result-value break-anywhere">{extractState.note.sourceUrl}</p>
                )}
              </div>
              <div className="result-item">
                <p className="result-key">封面</p>
                {isEditingResult ? (
                  <Textarea
                    className="result-textarea"
                    value={noteDraft?.coverImageUrl ?? ''}
                    onChange={(event) =>
                      setNoteDraft((current) =>
                        current
                          ? {
                              ...current,
                              coverImageUrl: event.target.value,
                            }
                          : current,
                      )
                    }
                  />
                ) : (
                  <p className="result-value break-anywhere">
                    {extractState.note.coverImageUrl || '未抓到封面'}
                  </p>
                )}
              </div>
              </div>
            </>
          ) : (
            <p className="feedback error">暂无读取结果。</p>
          )}
        </section>
      </main>
    )
  }

  return (
    <main className="sidepanel-shell">
      {renderPanelTabs()}
      {renderCloudSyncPanel()}

      <section
        className={
          activeAnnotationSelection
            ? 'annotation-panel annotation-card active'
            : 'annotation-panel annotation-card'
        }
      >
        <div className="annotation-title-row">
          <div>
            <h2>标注片段</h2>
          </div>
        </div>

        {activeAnnotationSelection ? (
          <>
            <div className="selection-preview">{activeAnnotationSelection.selectedText}</div>

            <p className="field-label annotation-label">颜色标签</p>
            <div className="tag-select-row">
              {isEditingTagName ? (
                <div className="shadcn-select-trigger tag-select-trigger tag-select-trigger-editing">
                  <span className="tag-select-value">
                    <span className="tag-dot-large" style={{ backgroundColor: selectedColor }} />
                    <input
                      ref={tagNameInputRef}
                      type="text"
                      className="tag-name-inline-input"
                      value={tagNameDraft}
                      maxLength={8}
                      placeholder="标签名"
                      aria-label="标签名"
                      onChange={(event) => setTagNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void handleSaveTagName()
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          handleCancelTagNameEdit()
                        }
                      }}
                    />
                  </span>
                  <button
                    className="tag-edit-cancel"
                    type="button"
                    aria-label="取消编辑标签名"
                    onClick={handleCancelTagNameEdit}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <Select value={selectedColor} onValueChange={setSelectedColor}>
                  <SelectTrigger className="tag-select-trigger" aria-label="选择颜色标签">
                    <span className="tag-select-value">
                      <span className="tag-dot-large" style={{ backgroundColor: selectedColor }} />
                      <span className={selectedColorTagName ? 'tag-name-text' : 'tag-name-placeholder'}>
                        {selectedColorTagName || '未命名'}
                      </span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
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
                        <span className="tag-select-option">
                          <span className="tag-dot-large" style={{ backgroundColor: option.color }} />
                          <span className={option.tagName ? 'tag-name-text' : 'tag-name-placeholder'}>
                            {option.tagName || '未命名'}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <button
                className="tag-edit-button"
                type="button"
                onClick={() => {
                  if (isEditingTagName) {
                    void handleSaveTagName()
                    return
                  }

                  setTagNameDraft(selectedColorTagName)
                  setIsEditingTagName(true)
                }}
              >
                {isEditingTagName ? '确认' : '编辑'}
              </button>
            </div>

            <label className="field-label annotation-label" htmlFor="reason">
              记录理由
            </label>
            <Textarea
              className="reason-textarea"
              id="reason"
              value={reasonText}
              placeholder="为什么值得参考"
              onChange={(event) => setReasonText(event.target.value)}
            />

            <div className="annotation-save-info">{renderSaveInfoFields()}</div>

            <div className="annotation-actions">
              <button
                className={
                  annotationStatus === 'saved'
                    ? 'primary-button annotation-save-button saved'
                    : 'primary-button annotation-save-button'
                }
                type="button"
                aria-label={annotationStatus === 'saved' ? '保存标注，已保存' : '保存标注'}
                disabled={isAnnotationSaving}
                onClick={() => {
                  void handleSaveAnnotation()
                }}
              >
                <span className="annotation-save-button-label">
                  {isAnnotationSaving ? (isCloudSyncing ? '同步中...' : '保存中...') : '保存标注'}
                </span>
                {annotationStatus === 'saved' ? (
                  <span className="annotation-save-badge" aria-hidden="true">
                    <span className="annotation-save-badge-check" />
                    已保存
                  </span>
                ) : null}
              </button>
              <span className="annotation-save-status-text" role="status" aria-live="polite">
                {annotationStatus === 'saved' ? '已保存' : ''}
              </span>
            </div>
            {annotationFeedback ? <p className="feedback annotation-feedback">{annotationFeedback}</p> : null}
          </>
        ) : (
          <div className="annotation-empty">
            在小红书正文里选中文字，再保存为片段。
          </div>
        )}

      </section>

      {extractState.error ? <p className="feedback error">{extractState.error}</p> : null}
    </main>
  )
}
