import { defineContentScript } from 'wxt/utils/define-content-script'
import type { ExtractedNoteRecord, SavedSnippetRecord } from '@lumos-ai/shared'

const UNTITLED_NOTE_TITLE = '无标题'

const NOTE_TITLE_SELECTORS = [
  '#detail-title',
  '[data-testid="note-title"]',
  '[data-testid="detail-title"]',
  '#noteContainer h1',
  '#noteContainer [class~="title"]',
  '#note-container h1',
  '#note-container [class~="title"]',
]

const NOTE_DETAIL_MARKER_SELECTORS = [
  '#detail-desc',
  '#detail-title',
  '#noteContainer',
  '#note-container',
  '[data-testid="note-detail"]',
]

const NOTE_DETAIL_ROOT_SELECTORS = [
  '#noteContainer',
  '#note-container',
  '[data-testid="note-detail"]',
  'article',
]

const NOTE_MEDIA_CONTAINER_SELECTORS = [
  '[class*="swiper"]',
  '[class*="carousel"]',
  '[class*="slider"]',
  '[class*="media"]',
  '[class*="Media"]',
  '[class*="image-list"]',
  '[class*="ImageList"]',
  '[class*="image-container"]',
  '[class*="ImageContainer"]',
  '[class*="note-image"]',
  '[class*="NoteImage"]',
]

const NOTE_CONTENT_SELECTORS = [
  '#detail-desc',
  '#detail-desc span',
  '[data-testid="note-content"]',
  '[data-testid="note-desc"]',
  '[class*="note-content"]',
  '[class*="NoteContent"]',
  '[class*="detail-desc"]',
  '[class*="DetailDesc"]',
  '[class*="desc"]',
]

const CONTENT_SELECTORS = [
  'article',
  '[class*="note-content"]',
  '[class*="desc"]',
  '[class*="content"]',
  '[data-testid*="note"]',
]

const AUTHOR_SELECTORS = [
  '[class*="author"]',
  '[class*="user-name"]',
  '[class*="nickname"]',
  'a[href*="/user/profile"]',
]

const NOTE_AUTHOR_SELECTORS = [
  'a[href*="/user/profile"]',
  '[class*="author"] [class*="name"]',
  '[class*="Author"] [class*="Name"]',
  '[class*="user"] [class*="name"]',
  '[class*="User"] [class*="Name"]',
  '[class*="nickname"]',
]

const COVER_SELECTORS = [
  'meta[property="og:image"]',
  'meta[name="twitter:image"]',
  'img[src*="sns-webpic"]',
  'img[src*="xhscdn"]',
  'img',
]

type ExtractMessageRequest = {
  type: 'XHS_EXTRACT_NOTE'
}

type ShowExtractResultMessageRequest = {
  type: 'XHS_SHOW_EXTRACT_RESULT'
  data: ExtractedNoteRecord
}

type NoteRouteChangedMessage = {
  type: 'XHS_NOTE_ROUTE_CHANGED'
  url: string
}

type ExtractMessageResponse =
  | { ok: true; data: ExtractedNoteRecord }
  | { ok: false; error: string }

const SNIPPET_STORAGE_KEY = 'savedSnippets'
const PENDING_SNIPPET_SELECTION_KEY = 'pendingSnippetSelection'
const COLOR_TAG_NAMES_STORAGE_KEY = 'colorTagNames'
const FLOATING_ROOT_ID = 'xhs-ai-selection-root'
const PANEL_MARGIN = 20
const COLOR_PRESETS = [
  { value: '#64748B' },
  { value: '#4D78F2' },
  { value: '#2A9D8F' },
  { value: '#8B5CF6' },
  { value: '#E9C46A' },
  { value: '#E56B6F' },
]

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

function limitTitleLength(text: string | null | undefined) {
  return Array.from(cleanText(text)).slice(0, 20).join('')
}

function getDisplayNoteTitle(text: string | null | undefined) {
  return limitTitleLength(text) || UNTITLED_NOTE_TITLE
}

function normalizeTitleCandidate(text: string | null | undefined) {
  const title = limitTitleLength(text)
  if (!title || title === UNTITLED_NOTE_TITLE) return ''
  if (/^小红书(?:\s*[-_|].*)?$/.test(title)) return ''
  return title
}

function stripEditedSuffix(text: string | null | undefined) {
  const normalized = cleanStructuredText(text)
  const markerIndex = normalized.lastIndexOf('编辑于')
  if (markerIndex === -1) return normalized
  return cleanStructuredText(normalized.slice(0, markerIndex))
}

function stripTrailingDateLocation(text: string | null | undefined) {
  const normalized = cleanStructuredText(text)
  return cleanStructuredText(
    normalized.replace(
      /(?:\n|[\s\u3000]|^)(?:\d{2}-\d{2}|\d{1,2}\/\d{1,2}|\d+分钟前|\d+小时前|\d+天前|\d+周前|\d+月前|昨天|今天|刚刚)\s+[A-Za-z\u4e00-\u9fa5·]{2,20}$/u,
      '',
    ),
  )
}

function sanitizeContentText(text: string | null | undefined) {
  return stripTrailingDateLocation(stripEditedSuffix(text))
}

function normalizeTagName(text: string | null | undefined) {
  const trimmed = cleanText(text)
  if (!trimmed) return '建议'
  return Array.from(trimmed).slice(0, 2).join('')
}

function normalizeAuthorName(text: string | null | undefined) {
  const lines = cleanStructuredText(text)
    .split('\n')
    .map((line) => cleanText(line.replace(/^(作者|博主)[:：]/, '')))
    .filter(Boolean)
  const candidate =
    lines.find(
      (line) =>
        !/^(关注|已关注|粉丝|获赞|点赞|评论|收藏|分享|展开|收起)$/.test(line) &&
        !/^\d+(?:\.\d+)?[万千kK]?$/.test(line),
    ) || cleanText(text)

  return Array.from(candidate.replace(/^(关注|已关注)\s*/, '')).slice(0, 24).join('').trim()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function rectsOverlap(
  left: number,
  top: number,
  width: number,
  height: number,
  target: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
) {
  const right = left + width
  const bottom = top + height
  return !(
    right <= target.left ||
    left >= target.right ||
    bottom <= target.top ||
    top >= target.bottom
  )
}

function getMetaContent(selector: string) {
  const element = document.querySelector<HTMLMetaElement>(selector)
  return cleanText(element?.content)
}

function normalizeImageUrl(url: string) {
  const trimmed = cleanText(url)
  if (!trimmed || trimmed.startsWith('data:image/svg') || trimmed.startsWith('blob:')) return ''
  if (trimmed.startsWith('//')) return `${window.location.protocol}${trimmed}`

  try {
    const parsed = new URL(trimmed, window.location.href)
    if (parsed.protocol === 'http:' && /\.xhscdn\.com$/i.test(parsed.hostname)) {
      parsed.protocol = 'https:'
    }
    return parsed.href
  } catch {
    return trimmed
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      const normalized = normalizeImageUrl(value)
      if (normalized) return normalized
    }
  }

  return ''
}

function getCleanStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      const normalized = cleanStructuredText(value)
      if (normalized) return normalized
    }
  }

  return ''
}

function getNumberField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }

  return null
}

function getImageOrder(value: unknown, fallback: number) {
  if (!isRecord(value)) return fallback

  return (
    getNumberField(value, [
      'index',
      'imageIndex',
      'image_index',
      'order',
      'sort',
      'position',
      'sequence',
    ]) ?? fallback
  )
}

function getFirstImageRecord(imageList: unknown[]) {
  return imageList
    .map((image, index) => ({
      image,
      order: getImageOrder(image, index),
      index,
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)[0]?.image
}

function getLargestSrcsetCandidate(srcset: string | null | undefined) {
  const candidates = cleanText(srcset)
    .split(',')
    .map((item) => item.trim().split(/\s+/)[0])
    .filter(Boolean)

  return candidates[candidates.length - 1] || ''
}

function getFirstText(selectors: string[]) {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector)
    const text = cleanText(element?.innerText || element?.textContent)
    if (text) return text
  }

  return ''
}

function isVisibleElement(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false

  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function getFirstVisibleText(selectors: string[]) {
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
    for (const element of elements) {
      if (!isVisibleElement(element)) continue

      const text = cleanText(element.innerText || element.textContent)
      if (text) return text
    }
  }

  return ''
}

function hasTrustedNoteDetailDom() {
  return NOTE_DETAIL_MARKER_SELECTORS.some((selector) => document.querySelector(selector))
}

function getNoteTitle(jsonLd: ReturnType<typeof getJsonLdCandidate>) {
  const domTitle = normalizeTitleCandidate(getFirstVisibleText(NOTE_TITLE_SELECTORS))
  if (domTitle) return domTitle

  // Xiaohongshu is an SPA. When a no-title note opens in the detail layer, page-level
  // metadata can still contain the previous/background note title, so do not use it
  // once the real note detail DOM is present.
  if (hasTrustedNoteDetailDom()) return ''

  return normalizeTitleCandidate(jsonLd?.title || getMetaContent('meta[property="og:title"]'))
}

function getFirstVisibleTextWithin(root: HTMLElement, selectors: string[]) {
  for (const selector of selectors) {
    const elements = Array.from(root.querySelectorAll<HTMLElement>(selector))
    for (const element of elements) {
      if (!isVisibleElement(element)) continue

      const text = normalizeAuthorName(element.innerText || element.textContent)
      if (text) return text
    }
  }

  return ''
}

function getFirstImage(selectors: string[]) {
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element instanceof HTMLMetaElement) {
      const content = cleanText(element.content)
      if (content) return content
    }

    if (element instanceof HTMLImageElement) {
      const candidates = [
        element.currentSrc,
        element.src,
        getLargestSrcsetCandidate(element.srcset),
        getLargestSrcsetCandidate(element.getAttribute('data-srcset')),
        element.getAttribute('data-src'),
        element.getAttribute('data-original'),
        element.getAttribute('data-url'),
        element.getAttribute('data-lazy-src'),
      ]

      const src = candidates.map((candidate) => normalizeImageUrl(candidate || '')).find(Boolean)
      if (src) return src
    }
  }

  return ''
}

function getImageUrlFromElement(element: Element) {
  if (element instanceof HTMLImageElement) {
    const candidates = [
      element.currentSrc,
      element.src,
      getLargestSrcsetCandidate(element.srcset),
      getLargestSrcsetCandidate(element.getAttribute('data-srcset')),
      element.getAttribute('data-src'),
      element.getAttribute('data-original'),
      element.getAttribute('data-url'),
      element.getAttribute('data-lazy-src'),
    ]

    return candidates.map((candidate) => normalizeImageUrl(candidate || '')).find(Boolean) || ''
  }

  if (element instanceof HTMLVideoElement) {
    return normalizeImageUrl(element.poster)
  }

  if (element instanceof HTMLElement) {
    const match = window.getComputedStyle(element).backgroundImage.match(/url\(["']?(.+?)["']?\)/)
    return normalizeImageUrl(match?.[1] || '')
  }

  return ''
}

function getNoteDetailRoot() {
  for (const selector of NOTE_DETAIL_ROOT_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) return element
  }

  return null
}

function getCurrentNoteId() {
  const match = window.location.pathname.match(/\/(?:explore|discovery\/item)\/([^/?#]+)/)
  return cleanText(match?.[1])
}

function extractBalancedObjectText(text: string, marker: string) {
  const markerIndex = text.indexOf(marker)
  if (markerIndex === -1) return ''

  const startIndex = text.indexOf('{', markerIndex)
  if (startIndex === -1) return ''

  let depth = 0
  let quote = ''
  let escaped = false

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index]

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) {
        quote = ''
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(startIndex, index + 1)
    }
  }

  return ''
}

function parseXhsInitialState() {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script'))

  for (const script of scripts) {
    const raw = script.textContent || ''
    if (!raw.includes('__INITIAL_STATE__')) continue

    const objectText = extractBalancedObjectText(raw, '__INITIAL_STATE__')
    if (!objectText) continue

    try {
      const parsed = JSON.parse(objectText) as unknown
      if (isRecord(parsed)) return parsed
    } catch {
      // Ignore non-JSON inline state; DOM extraction below is still available.
    }
  }

  return null
}

function getImageUrlFromImageRecord(value: unknown): string {
  if (typeof value === 'string') return normalizeImageUrl(value)
  if (!isRecord(value)) return ''

  const directUrl = getStringField(value, [
    'urlDefault',
    'url_default',
    'urlPre',
    'url_pre',
    'url',
    'src',
    'original',
    'originUrl',
    'origin_url',
    'masterUrl',
    'master_url',
    'coverUrl',
    'cover_url',
    'poster',
  ])
  if (directUrl) return directUrl

  const infoList = value.infoList
  if (Array.isArray(infoList)) {
    const preferred =
      infoList.find((item) => isRecord(item) && item.imageScene === 'WB_DFT') ||
      infoList.find((item) => isRecord(item) && item.imageScene === 'CRD_WM_WEBP') ||
      infoList[0]
    const nestedUrl = getImageUrlFromImageRecord(preferred)
    if (nestedUrl) return nestedUrl
  }

  return ''
}

function getCoverImageUrlFromNoteState(note: unknown) {
  if (!isRecord(note)) return ''

  const imageList = note.imageList
  if (Array.isArray(imageList) && imageList.length > 0) {
    const firstImageUrl = getImageUrlFromImageRecord(getFirstImageRecord(imageList))
    if (firstImageUrl) return firstImageUrl
  }

  for (const key of ['cover', 'coverInfo', 'coverImage', 'image', 'video']) {
    const coverUrl = getImageUrlFromImageRecord(note[key])
    if (coverUrl) return coverUrl
  }

  return ''
}

function getContentTextFromStructuredValue(value: unknown): string {
  if (typeof value === 'string') return cleanStructuredText(value)

  if (Array.isArray(value)) {
    return cleanStructuredText(
      value
        .map((item) => getContentTextFromStructuredValue(item))
        .filter(Boolean)
        .join(''),
    )
  }

  if (!isRecord(value)) return ''

  const directText = getCleanStringField(value, [
    'text',
    'content',
    'desc',
    'description',
    'value',
    'name',
  ])
  if (directText) return directText

  const nestedText =
    getContentTextFromStructuredValue(value.textList) ||
    getContentTextFromStructuredValue(value.richText) ||
    getContentTextFromStructuredValue(value.descV2)
  if (nestedText) return nestedText

  return ''
}

function isInvalidContentText(text: string) {
  if (!text) return true
  if (/ICP备|营业执照|增值电信|经营许可证|违法不良信息|©\s*\d{4}/.test(text)) return true
  if (/说点什么|共\s*\d+\s*条评论|展开\s*\d+\s*条回复/.test(text)) return true
  return false
}

function normalizeContentText(text: string | null | undefined) {
  const normalized = sanitizeContentText(text)
  return isInvalidContentText(normalized) ? '' : normalized
}

function getContentTextFromNoteState(note: unknown) {
  if (!isRecord(note)) return ''

  const directText = getCleanStringField(note, [
    'desc',
    'description',
    'content',
    'contentText',
    'content_text',
    'noteDesc',
    'note_desc',
    'displayText',
    'display_text',
  ])
  if (directText) return normalizeContentText(directText)

  return normalizeContentText(
    getContentTextFromStructuredValue(note.descV2) ||
      getContentTextFromStructuredValue(note.richDesc) ||
      getContentTextFromStructuredValue(note.contentV2),
  )
}

function getNoteFromDetailMap(state: Record<string, unknown>, noteId: string) {
  const noteState = state.note
  if (!isRecord(noteState)) return null

  const noteDetailMap = noteState.noteDetailMap
  if (!isRecord(noteDetailMap)) return null

  const directMatch = noteDetailMap[noteId]
  if (isRecord(directMatch)) {
    return isRecord(directMatch.note) ? directMatch.note : directMatch
  }

  for (const [key, value] of Object.entries(noteDetailMap)) {
    if (!isRecord(value)) continue

    const note = isRecord(value.note) ? value.note : value
    if (key.includes(noteId) || note.noteId === noteId || note.id === noteId) return note
  }

  const notes = Object.values(noteDetailMap)
    .map((value) => (isRecord(value) && isRecord(value.note) ? value.note : value))
    .filter(isRecord)

  return notes.length === 1 ? notes[0] : null
}

function getCoverImageFromInitialState() {
  const noteId = getCurrentNoteId()
  if (!noteId) return ''

  const initialState = parseXhsInitialState()
  if (!initialState) return ''

  const detailNote = getNoteFromDetailMap(initialState, noteId)
  return getCoverImageUrlFromNoteState(detailNote)
}

function getContentTextFromInitialState() {
  const noteId = getCurrentNoteId()
  if (!noteId) return ''

  const initialState = parseXhsInitialState()
  if (!initialState) return ''

  const detailNote = getNoteFromDetailMap(initialState, noteId)
  return getContentTextFromNoteState(detailNote)
}

function getCoverImageFromPageContext() {
  const noteId = getCurrentNoteId()
  if (!noteId) return ''

  const eventName = `xhs-ai-note-cover-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let coverImageUrl = ''

  const handleResponse = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail
    if (typeof detail === 'string') {
      coverImageUrl = normalizeImageUrl(detail)
    }
  }

  document.addEventListener(eventName, handleResponse, { once: true })

  const script = document.createElement('script')
  script.textContent = `
    (() => {
      const eventName = ${JSON.stringify(eventName)};
      const noteId = ${JSON.stringify(noteId)};
      const send = (value) => document.dispatchEvent(new CustomEvent(eventName, { detail: value || '' }));
      const pick = (value) => {
        if (!value) return '';
        if (typeof value === 'string') return value;
        const directKeys = ['urlDefault', 'url_default', 'urlPre', 'url_pre', 'url', 'src', 'original', 'originUrl', 'origin_url', 'masterUrl', 'master_url', 'coverUrl', 'cover_url', 'poster'];
        for (const key of directKeys) {
          if (typeof value[key] === 'string' && value[key]) return value[key];
        }
        if (Array.isArray(value.infoList) && value.infoList.length > 0) {
          const preferred = value.infoList.find((item) => item && item.imageScene === 'WB_DFT') || value.infoList[0];
          return pick(preferred);
        }
        return '';
      };

      try {
        const state = window.__INITIAL_STATE__;
        const map = state && state.note && state.note.noteDetailMap;
        if (!map) {
          send('');
          return;
        }

        let entry = map[noteId];
        if (!entry) {
          entry = Object.entries(map).find(([key, value]) => {
            const note = value && (value.note || value);
            return key.includes(noteId) || (note && (note.noteId === noteId || note.id === noteId));
          })?.[1];
        }

        const note = entry && (entry.note || entry);
        const imageOrder = (value, fallback) => {
          if (!value || typeof value !== 'object') return fallback;
          const keys = ['index', 'imageIndex', 'image_index', 'order', 'sort', 'position', 'sequence'];
          for (const key of keys) {
            const raw = value[key];
            const number = typeof raw === 'number' ? raw : Number(raw);
            if (Number.isFinite(number)) return number;
          }
          return fallback;
        };
        const firstImage = Array.isArray(note?.imageList)
          ? note.imageList
              .map((image, index) => ({ image, order: imageOrder(image, index), index }))
              .sort((left, right) => left.order - right.order || left.index - right.index)[0]?.image
          : null;
        send(pick(firstImage) || pick(note?.cover) || pick(note?.coverInfo) || pick(note?.coverImage) || pick(note?.image) || pick(note?.video));
      } catch {
        send('');
      }
    })();
  `

  document.documentElement.appendChild(script)
  script.remove()
  document.removeEventListener(eventName, handleResponse)

  return coverImageUrl
}

function getContentTextFromPageContext() {
  const noteId = getCurrentNoteId()
  if (!noteId) return ''

  const eventName = `xhs-ai-note-content-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let contentText = ''

  const handleResponse = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail
    if (typeof detail === 'string') {
      contentText = normalizeContentText(detail)
    }
  }

  document.addEventListener(eventName, handleResponse, { once: true })

  const script = document.createElement('script')
  script.textContent = `
    (() => {
      const eventName = ${JSON.stringify(eventName)};
      const noteId = ${JSON.stringify(noteId)};
      const send = (value) => document.dispatchEvent(new CustomEvent(eventName, { detail: value || '' }));
      const clean = (value) => typeof value === 'string'
        ? value
            .replace(/\\r/g, '')
            .replace(/\\u00a0/g, ' ')
            .split('\\n')
            .map((line) => line.replace(/[ \\t\\u3000]+/g, ' ').trim())
            .join('\\n')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim()
        : '';
      const pickText = (value) => {
        if (!value) return '';
        if (typeof value === 'string') return clean(value);
        if (Array.isArray(value)) return clean(value.map(pickText).filter(Boolean).join(''));
        if (typeof value !== 'object') return '';
        const directKeys = ['desc', 'description', 'content', 'contentText', 'content_text', 'noteDesc', 'note_desc', 'displayText', 'display_text', 'text', 'value'];
        for (const key of directKeys) {
          const text = clean(value[key]);
          if (text) return text;
        }
        return pickText(value.descV2) || pickText(value.richDesc) || pickText(value.contentV2) || pickText(value.textList) || pickText(value.richText);
      };

      try {
        const state = window.__INITIAL_STATE__;
        const map = state && state.note && state.note.noteDetailMap;
        if (!map) {
          send('');
          return;
        }

        let entry = map[noteId];
        if (!entry) {
          entry = Object.entries(map).find(([key, value]) => {
            const note = value && (value.note || value);
            return key.includes(noteId) || (note && (note.noteId === noteId || note.id === noteId));
          })?.[1];
        }

        const note = entry && (entry.note || entry);
        send(pickText(note));
      } catch {
        send('');
      }
    })();
  `

  document.documentElement.appendChild(script)
  script.remove()
  document.removeEventListener(eventName, handleResponse)

  return contentText
}

function getMediaElementOrder(element: HTMLElement, fallback: number) {
  const slide = element.closest<HTMLElement>(
    '[data-swiper-slide-index], [aria-label*="/"], [data-index], [data-slide-index]',
  )
  const indexedElement = slide || element
  const explicitOrder = getNumberField(
    {
      dataSwiperSlideIndex: indexedElement.getAttribute('data-swiper-slide-index'),
      dataIndex: indexedElement.getAttribute('data-index'),
      dataSlideIndex: indexedElement.getAttribute('data-slide-index'),
    },
    ['dataSwiperSlideIndex', 'dataIndex', 'dataSlideIndex'],
  )
  if (explicitOrder !== null) return explicitOrder

  const ariaLabel = indexedElement.getAttribute('aria-label') || ''
  const ariaMatch = ariaLabel.match(/(\d+)\s*\/\s*\d+/)
  if (ariaMatch) return Number(ariaMatch[1]) - 1

  return fallback
}

function getFirstLargeImageWithin(root: HTMLElement) {
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>('img, video[poster], [style*="background-image"]'),
  )
  const candidates = elements
    .map((element, index) => {
      if (!isVisibleElement(element)) return null

      const rect = element.getBoundingClientRect()
      if (rect.width < 120 || rect.height < 120) return null

      const url = getImageUrlFromElement(element)
      if (!url) return null

      return {
        url,
        index,
        order: getMediaElementOrder(element, index),
      }
    })
    .filter((candidate): candidate is { url: string; index: number; order: number } =>
      Boolean(candidate),
    )
    .sort((left, right) => left.order - right.order || left.index - right.index)

  return candidates[0]?.url || ''
}

function getFirstNoteImage(root: HTMLElement) {
  const mediaContainers = Array.from(
    root.querySelectorAll<HTMLElement>(NOTE_MEDIA_CONTAINER_SELECTORS.join(',')),
  )
    .filter(isVisibleElement)
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        element,
        area: rect.width * rect.height,
      }
    })
    .filter((item) => item.area >= 120 * 120)
    .sort((left, right) => right.area - left.area)

  for (const container of mediaContainers) {
    const url = getFirstLargeImageWithin(container.element)
    if (url) return url
  }

  return getFirstLargeImageWithin(root)
}

function getNoteCoverImage(jsonLd: ReturnType<typeof getJsonLdCandidate>) {
  const pageStateCoverImageUrl = getCoverImageFromPageContext()
  if (pageStateCoverImageUrl) return pageStateCoverImageUrl

  const stateCoverImageUrl = getCoverImageFromInitialState()
  if (stateCoverImageUrl) return stateCoverImageUrl

  const noteRoot = getNoteDetailRoot()
  if (noteRoot) {
    const coverImageUrl = getFirstNoteImage(noteRoot)
    if (coverImageUrl) return coverImageUrl
  }

  return (
    normalizeImageUrl(jsonLd?.coverImageUrl || '') ||
    normalizeImageUrl(getMetaContent('meta[property="og:image"]')) ||
    normalizeImageUrl(getMetaContent('meta[name="twitter:image"]')) ||
    getFirstImage(COVER_SELECTORS)
  )
}

function getNoteAuthorName(jsonLd: ReturnType<typeof getJsonLdCandidate>) {
  const noteRoot = getNoteDetailRoot()
  if (noteRoot) {
    const authorName = getFirstVisibleTextWithin(noteRoot, NOTE_AUTHOR_SELECTORS)
    if (authorName || hasTrustedNoteDetailDom()) return authorName
  }

  return (
    normalizeAuthorName(jsonLd?.authorName) ||
    normalizeAuthorName(getMetaContent('meta[name="author"]')) ||
    normalizeAuthorName(getFirstText(AUTHOR_SELECTORS))
  )
}

function getJsonLdCandidate() {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  )

  for (const script of scripts) {
    const raw = script.textContent?.trim()
    if (!raw) continue

    try {
      const parsed = JSON.parse(raw)
      const items = Array.isArray(parsed) ? parsed : [parsed]

      for (const item of items) {
        if (!item || typeof item !== 'object') continue

        const title = limitTitleLength(item.headline || item.name)
        const description = cleanStructuredText(item.description)
        const authorName = cleanText(
          typeof item.author === 'string'
            ? item.author
            : item.author?.name || item.publisher?.name,
        )
        const coverImageUrl = cleanText(
          Array.isArray(item.image) ? item.image[0] : item.image?.url || item.image,
        )

        if (title || description || authorName || coverImageUrl) {
          return { title, description, authorName, coverImageUrl }
        }
      }
    } catch {
      // Ignore invalid JSON-LD blocks and continue scanning.
    }
  }

  return null
}

function getEmojiTextFromElement(element: Element) {
  const candidates = [
    element.getAttribute('alt'),
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('data-emoji'),
    element.getAttribute('data-emoji-text'),
    element.getAttribute('data-text'),
    element.getAttribute('data-stringify-text'),
    element.getAttribute('data-name'),
  ]

  return candidates.map((value) => cleanStructuredText(value)).find(Boolean) || ''
}

function extractRichTextFromElement(element: HTMLElement) {
  const clone = element.cloneNode(true) as HTMLElement

  clone.querySelectorAll('br').forEach((lineBreak) => {
    lineBreak.replaceWith(document.createTextNode('\n'))
  })

  clone
    .querySelectorAll('[role="img"], img, svg, [class*="emoji"], [class*="Emoji"]')
    .forEach((node) => {
      const emojiText = getEmojiTextFromElement(node)
      if (!emojiText) return
      node.replaceWith(document.createTextNode(emojiText))
    })

  return cleanStructuredText(clone.innerText || clone.textContent)
}

function collectContentText() {
  const noteRoot = getNoteDetailRoot()
  if (noteRoot) {
    for (const selector of NOTE_CONTENT_SELECTORS) {
      const elements = Array.from(noteRoot.querySelectorAll<HTMLElement>(selector))
      for (const element of elements) {
        if (!isVisibleElement(element)) continue

        const text = normalizeContentText(extractRichTextFromElement(element))
        if (text) return text
      }
    }

    if (hasTrustedNoteDetailDom()) return ''
  }

  const pageStateContentText = getContentTextFromPageContext()
  if (pageStateContentText) return pageStateContentText

  const stateContentText = getContentTextFromInitialState()
  if (stateContentText) return stateContentText

  for (const selector of CONTENT_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector)
    const text = element ? normalizeContentText(extractRichTextFromElement(element)) : ''
    if (text && text.length >= 20) return text
  }

  const paragraphText = Array.from(document.querySelectorAll('p'))
    .map((node) => extractRichTextFromElement(node))
    .filter((text) => text.length >= 8)
    .slice(0, 20)
    .join('\n\n')

  return normalizeContentText(paragraphText)
}

function extractNoteFromPage(): ExtractedNoteRecord {
  const jsonLd = getJsonLdCandidate()
  const contentText = normalizeContentText(
    collectContentText() ||
      getMetaContent('meta[property="og:description"]') ||
      jsonLd?.description ||
      '',
  )
  const title = getNoteTitle(jsonLd)

  const authorName = getNoteAuthorName(jsonLd)
  const coverImageUrl = getNoteCoverImage(jsonLd)

  return {
    title,
    authorName,
    sourceUrl: window.location.href,
    coverImageUrl,
    contentText,
  }
}

function isProbablyNotePage() {
  return /\/(explore|discovery\/item)\//.test(window.location.pathname)
}

function validateExtractedNote(note: ExtractedNoteRecord) {
  if (!isProbablyNotePage()) {
    return '当前页面看起来不是小红书笔记详情页。'
  }

  if (!note.title && !note.contentText) {
    return '没有抓到有效内容，请确认你打开的是具体笔记详情页。'
  }

  return ''
}

function setupNoteRouteChangeNotifier() {
  let currentUrl = window.location.href
  let notifyTimer = 0

  function queueNotifyIfChanged() {
    const nextUrl = window.location.href
    if (nextUrl === currentUrl) return

    currentUrl = nextUrl
    window.clearTimeout(notifyTimer)
    notifyTimer = window.setTimeout(() => {
      if (!isProbablyNotePage()) return

      const message: NoteRouteChangedMessage = {
        type: 'XHS_NOTE_ROUTE_CHANGED',
        url: currentUrl,
      }

      void chrome.runtime.sendMessage(message).catch(() => undefined)
    }, 350)
  }

  const originalPushState = window.history.pushState
  const originalReplaceState = window.history.replaceState

  window.history.pushState = function pushState(...args: Parameters<History['pushState']>) {
    const result = originalPushState.apply(this, args)
    queueNotifyIfChanged()
    return result
  }

  window.history.replaceState = function replaceState(
    ...args: Parameters<History['replaceState']>
  ) {
    const result = originalReplaceState.apply(this, args)
    queueNotifyIfChanged()
    return result
  }

  window.addEventListener('popstate', queueNotifyIfChanged)
  window.addEventListener('hashchange', queueNotifyIfChanged)
  window.setInterval(queueNotifyIfChanged, 500)
}

function getNoteContentRoot() {
  for (const selector of CONTENT_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) return element
  }

  return document.body
}

function isSelectionInsideNote(range: Range) {
  const contentRoot = getNoteContentRoot()
  return contentRoot.contains(range.commonAncestorContainer)
}

function createSelectionUi() {
  const existing = document.getElementById(FLOATING_ROOT_ID)
  if (existing) existing.remove()

  const root = document.createElement('div')
  root.id = FLOATING_ROOT_ID
  root.innerHTML = `
    <style>
      #${FLOATING_ROOT_ID} {
        all: initial;
        --ui-space-1: 4px;
        --ui-space-2: 8px;
        --ui-space-2-5: 10px;
        --ui-space-3: 12px;
        --ui-space-4: 16px;
        --ui-control-sm: 32px;
        --ui-control-md: 40px;
        --ui-control-lg: 44px;
        --ui-control-gap: 8px;
        --ui-control-px-sm: 12px;
        --ui-control-px-md: 14px;
        --ui-control-px-lg: 16px;
        --ui-field-px: 14px;
        --ui-field-py: 9px;
        --ui-radius-item: 8px;
        --ui-radius-control: 10px;
        --ui-radius-card: 12px;
        --ui-radius-panel: 12px;
        --ui-radius-dialog: 14px;
        --ui-field-radius: var(--ui-radius-control);
        --ui-field-gap: 8px;
        --ui-panel-inset: 16px;
        --ui-text-caption: 12px;
        --ui-text-meta: 13px;
        --ui-text-control: 13px;
        --ui-text-body: 14px;
        --ui-text-readable: 16px;
        --ui-text-section: 18px;
        --ui-leading-control: 1.35;
        --ui-leading-body: 1.65;
        --ui-textarea-sm: 64px;
        --ui-textarea-md: 88px;
      }

      #${FLOATING_ROOT_ID} * {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
      }

      .xhs-ai-trigger {
        position: fixed;
        z-index: 2147483647;
        display: none;
        border: 0;
        border-radius: 999px;
        min-height: var(--ui-control-md);
        padding: 0 var(--ui-control-px-lg);
        background: linear-gradient(135deg, #171311 0%, #334155 100%);
        color: #fff;
        font-size: var(--ui-text-body);
        font-weight: 760;
        box-shadow: 0 16px 34px rgba(15, 23, 42, 0.16);
        cursor: pointer;
        pointer-events: auto;
        touch-action: manipulation;
        user-select: none;
        white-space: nowrap;
        min-width: 96px;
      }

      .xhs-ai-panel {
        position: fixed;
        left: 20px;
        top: 20px;
        z-index: 2147483646;
        width: 360px;
        display: none;
        border-radius: var(--ui-radius-panel);
        border: 1px solid rgba(15, 23, 42, 0.12);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.98));
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.14);
        padding: var(--ui-panel-inset);
        color: #1f1712;
      }

      .xhs-ai-panel-head {
        display: flex;
        align-items: start;
        justify-content: flex-start;
        margin-bottom: var(--ui-field-gap);
        cursor: move;
        user-select: none;
      }

      .xhs-ai-panel h3 {
        margin: 0;
        font-size: var(--ui-text-section);
        line-height: 1.2;
      }

      .xhs-ai-help {
        margin: 0 0 14px;
        color: #6b5548;
        font-size: var(--ui-text-caption);
        line-height: 1.5;
      }

      .xhs-ai-preview {
        margin-bottom: var(--ui-space-3);
        border-radius: var(--ui-field-radius);
        background: rgba(255, 255, 255, 0.78);
        padding: var(--ui-space-3);
        font-size: var(--ui-text-control);
        line-height: 1.65;
        color: #2d2019;
        max-height: 100px;
        overflow: auto;
        white-space: pre-wrap;
      }

      .xhs-ai-label {
        display: block;
        margin: 0 0 var(--ui-field-gap);
        color: #7b6150;
        font-size: var(--ui-text-caption);
        font-weight: 600;
      }

      .xhs-ai-shadcn-input,
      .xhs-ai-shadcn-textarea {
        width: 100%;
        border: 1px solid rgba(110, 80, 62, 0.16);
        border-radius: var(--ui-field-radius);
        background: rgba(255, 255, 255, 0.88);
        color: #1f1712;
        padding: var(--ui-field-py) var(--ui-field-px);
        font-size: var(--ui-text-control);
        outline: none;
        box-shadow: 0 10px 24px rgba(48, 34, 22, 0.03);
        transition:
          border-color 180ms ease,
          box-shadow 180ms ease,
          background-color 180ms ease;
      }

      .xhs-ai-shadcn-input::placeholder,
      .xhs-ai-shadcn-textarea::placeholder {
        color: #93877d;
      }

      .xhs-ai-shadcn-input:focus,
      .xhs-ai-shadcn-textarea:focus {
        border-color: rgba(15, 23, 42, 0.18);
        box-shadow: 0 0 0 4px rgba(100, 116, 139, 0.14);
      }

      .xhs-ai-shadcn-textarea {
        min-height: var(--ui-textarea-md);
        resize: vertical;
      }

      .xhs-ai-field {
        margin-bottom: var(--ui-space-3);
      }

      .xhs-ai-color-row {
        display: flex;
        gap: var(--ui-space-2-5);
        flex-wrap: wrap;
      }

      .xhs-ai-color {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        border: 2px solid transparent;
        cursor: pointer;
      }

      .xhs-ai-color[data-active="true"] {
        border-color: #201712;
        box-shadow: 0 0 0 3px rgba(32, 23, 18, 0.08);
      }

      .xhs-ai-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--ui-space-2-5);
        margin-top: 4px;
      }

      .xhs-ai-button {
        border: 0;
        border-radius: var(--ui-field-radius);
        min-height: var(--ui-control-md);
        padding: 0 var(--ui-field-px);
        font-size: var(--ui-text-body);
        font-weight: 700;
        cursor: pointer;
      }

      .xhs-ai-button.secondary {
        background: rgba(255, 255, 255, 0.9);
        color: #6b5548;
        border: 1px solid rgba(110, 80, 62, 0.16);
      }

      .xhs-ai-button.primary {
        background: linear-gradient(135deg, #171311 0%, #334155 100%);
        color: #fff;
        box-shadow: 0 14px 28px rgba(15, 23, 42, 0.16);
      }

      .xhs-ai-toast {
        position: fixed;
        left: 50%;
        bottom: 28px;
        transform: translateX(-50%);
        z-index: 2147483647;
        display: none;
        border-radius: 999px;
        padding: var(--ui-space-2-5) var(--ui-field-px);
        background: rgba(32, 23, 18, 0.92);
        color: #fff;
        font-size: var(--ui-text-caption);
        line-height: 1;
      }

      .xhs-ai-result-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: none;
        background: rgba(20, 14, 10, 0.12);
      }

      .xhs-ai-result-modal {
        position: fixed;
        left: 24px;
        top: 24px;
        width: min(520px, calc(100vw - 40px));
        max-height: calc(100vh - 48px);
        border-radius: var(--ui-radius-dialog);
        border: 1px solid rgba(15, 23, 42, 0.12);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.98));
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.14);
        color: #1f1712;
        overflow: hidden;
      }

      .xhs-ai-result-inner {
        position: relative;
        z-index: 2;
        padding: 18px;
        max-height: calc(100vh - 48px);
        overflow-y: auto;
      }

      .xhs-ai-result-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--ui-space-3);
        margin-bottom: var(--ui-control-px-md);
      }

      .xhs-ai-result-title {
        margin: 0;
        color: #171311;
        font-size: var(--ui-text-readable);
        font-weight: 700;
        line-height: 1.2;
      }

      .xhs-ai-result-close {
        border: 1px solid rgba(110, 80, 62, 0.16);
        border-radius: 999px;
        min-height: var(--ui-control-sm);
        padding: 0 var(--ui-control-px-md);
        background: rgba(255, 255, 255, 0.9);
        color: #6b5548;
        font-size: var(--ui-text-caption);
        font-weight: 700;
        cursor: pointer;
      }

      .xhs-ai-result-grid {
        display: grid;
        gap: var(--ui-space-3);
      }

      .xhs-ai-result-item {
        min-width: 0;
      }

      .xhs-ai-result-key {
        margin: 0 0 4px;
        color: #93877d;
        font-size: var(--ui-text-caption);
      }

      .xhs-ai-result-value {
        margin: 0;
        color: #1f1712;
        font-size: var(--ui-text-control);
        line-height: 1.65;
        word-break: break-word;
      }

      .xhs-ai-result-value.scrollable {
        max-height: 240px;
        overflow-y: auto;
        padding-right: 6px;
        white-space: pre-wrap;
      }

      .xhs-ai-result-edge {
        position: absolute;
        z-index: 3;
        cursor: move;
      }

      .xhs-ai-result-edge.top,
      .xhs-ai-result-edge.bottom {
        left: 12px;
        right: 12px;
        height: 12px;
      }

      .xhs-ai-result-edge.top {
        top: 0;
      }

      .xhs-ai-result-edge.bottom {
        bottom: 0;
      }

      .xhs-ai-result-edge.left,
      .xhs-ai-result-edge.right {
        top: 12px;
        bottom: 12px;
        width: 12px;
      }

      .xhs-ai-result-edge.left {
        left: 0;
      }

      .xhs-ai-result-edge.right {
        right: 0;
      }
    </style>
    <button class="xhs-ai-trigger" type="button">标注片段</button>
    <section class="xhs-ai-panel" role="dialog" aria-label="保存标注片段">
      <div class="xhs-ai-panel-head">
        <h3>标注片段</h3>
      </div>
      <div class="xhs-ai-preview"></div>
      <div class="xhs-ai-field">
        <label class="xhs-ai-label">颜色标签</label>
        <div class="xhs-ai-color-row"></div>
      </div>
      <div class="xhs-ai-field">
        <label class="xhs-ai-label" for="xhs-ai-tag-name">标签备注</label>
        <input id="xhs-ai-tag-name" class="xhs-ai-shadcn-input" maxlength="2" placeholder="建议两个字，例如：语气、结构、整体" />
      </div>
      <div class="xhs-ai-field">
        <label class="xhs-ai-label" for="xhs-ai-reason">记录理由</label>
        <textarea id="xhs-ai-reason" class="xhs-ai-shadcn-textarea" placeholder="记录理由有助于 AI 理解你的喜好，提升创作适配度。"></textarea>
      </div>
      <div class="xhs-ai-actions">
        <button class="xhs-ai-button secondary" data-action="cancel" type="button">取消</button>
        <button class="xhs-ai-button primary" data-action="save" type="button">保存标注</button>
      </div>
    </section>
    <div class="xhs-ai-result-overlay">
      <section class="xhs-ai-result-modal" role="dialog" aria-label="读取结果">
        <div class="xhs-ai-result-edge top"></div>
        <div class="xhs-ai-result-edge bottom"></div>
        <div class="xhs-ai-result-edge left"></div>
        <div class="xhs-ai-result-edge right"></div>
        <div class="xhs-ai-result-inner">
          <div class="xhs-ai-result-head">
            <p class="xhs-ai-result-title">读取结果</p>
            <button class="xhs-ai-result-close" type="button">关闭</button>
          </div>
          <div class="xhs-ai-result-grid">
            <div class="xhs-ai-result-item">
              <p class="xhs-ai-result-key">标题</p>
              <p class="xhs-ai-result-value" data-field="title"></p>
            </div>
            <div class="xhs-ai-result-item">
              <p class="xhs-ai-result-key">作者</p>
              <p class="xhs-ai-result-value" data-field="author"></p>
            </div>
            <div class="xhs-ai-result-item">
              <p class="xhs-ai-result-key">链接</p>
              <p class="xhs-ai-result-value" data-field="sourceUrl"></p>
            </div>
            <div class="xhs-ai-result-item">
              <p class="xhs-ai-result-key">封面</p>
              <p class="xhs-ai-result-value" data-field="coverImageUrl"></p>
            </div>
            <div class="xhs-ai-result-item">
              <p class="xhs-ai-result-key">正文</p>
              <p class="xhs-ai-result-value scrollable" data-field="contentText"></p>
            </div>
          </div>
        </div>
      </section>
    </div>
    <div class="xhs-ai-toast"></div>
  `

  document.documentElement.appendChild(root)
  return root
}

function clearBrowserSelection() {
  window.getSelection()?.removeAllRanges()
}

function showToast(root: HTMLElement, text: string) {
  const toast = root.querySelector<HTMLElement>('.xhs-ai-toast')
  if (!toast) return

  toast.textContent = text
  toast.style.display = 'block'
  window.setTimeout(() => {
    toast.style.display = 'none'
  }, 1800)
}

function setupSelectionAnnotation() {
  const root = createSelectionUi()
  const trigger = root.querySelector<HTMLButtonElement>('.xhs-ai-trigger')
  const panel = root.querySelector<HTMLElement>('.xhs-ai-panel')
  const preview = root.querySelector<HTMLElement>('.xhs-ai-preview')
  const resultOverlay = root.querySelector<HTMLElement>('.xhs-ai-result-overlay')
  const resultModal = root.querySelector<HTMLElement>('.xhs-ai-result-modal')
  const resultClose = root.querySelector<HTMLButtonElement>('.xhs-ai-result-close')
  const resultEdges = Array.from(root.querySelectorAll<HTMLElement>('.xhs-ai-result-edge'))
  const panelHead = root.querySelector<HTMLElement>('.xhs-ai-panel-head')
  const reasonInput = root.querySelector<HTMLTextAreaElement>('#xhs-ai-reason')
  const tagNameInput = root.querySelector<HTMLInputElement>('#xhs-ai-tag-name')
  const colorRow = root.querySelector<HTMLElement>('.xhs-ai-color-row')
  const saveButton = root.querySelector<HTMLButtonElement>('[data-action="save"]')
  const cancelButton = root.querySelector<HTMLButtonElement>('[data-action="cancel"]')

  if (
    !trigger ||
    !panel ||
    !preview ||
    !resultOverlay ||
    !resultModal ||
    !resultClose ||
    !panelHead ||
    !reasonInput ||
    !tagNameInput ||
    !colorRow ||
    !saveButton ||
    !cancelButton
  ) {
    return null
  }

  const triggerEl = trigger
  const panelEl = panel
  const previewEl = preview
  const resultOverlayEl = resultOverlay
  const resultModalEl = resultModal
  const resultCloseEl = resultClose
  const panelHeadEl = panelHead
  const reasonInputEl = reasonInput
  const tagNameInputEl = tagNameInput
  const colorRowEl = colorRow
  const saveButtonEl = saveButton
  const cancelButtonEl = cancelButton

  let selectedText = ''
  let selectedRect: DOMRect | null = null
  let selectedColor = COLOR_PRESETS[0].value
  let isDraggingPanel = false
  let dragOffsetX = 0
  let dragOffsetY = 0
  let hasManualPanelPosition = false
  let isDraggingResult = false
  let resultDragOffsetX = 0
  let resultDragOffsetY = 0
  let suppressResultOverlayClick = false
  let isTriggerActivating = false
  let triggerRepositionFrame = 0

  function syncColorButtons() {
    const buttons = Array.from(colorRowEl.querySelectorAll<HTMLButtonElement>('button'))
    buttons.forEach((button) => {
      button.dataset.active = button.dataset.color === selectedColor ? 'true' : 'false'
    })
  }

  COLOR_PRESETS.forEach((color) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'xhs-ai-color'
    button.dataset.color = color.value
    button.style.background = color.value
    button.addEventListener('click', () => {
      selectedColor = color.value
      syncColorButtons()
    })
    colorRowEl.appendChild(button)
  })
  syncColorButtons()

  function closePanel() {
    panelEl.style.display = 'none'
    reasonInputEl.value = ''
    tagNameInputEl.value = ''
    selectedColor = COLOR_PRESETS[0].value
    selectedRect = null
    hasManualPanelPosition = false
    isDraggingPanel = false
    syncColorButtons()
  }

  function closeTrigger() {
    triggerEl.style.display = 'none'
  }

  function getResultModalSize() {
    const rect = resultModalEl.getBoundingClientRect()
    return {
      width: rect.width || 520,
      height: rect.height || 360,
    }
  }

  function setResultModalPosition(left: number, top: number) {
    resultModalEl.style.left = `${left}px`
    resultModalEl.style.top = `${top}px`
  }

  function getClampedResultPosition(left: number, top: number) {
    const { width, height } = getResultModalSize()
    return {
      left: clamp(left, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN)),
      top: clamp(top, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN)),
    }
  }

  function placeResultModal() {
    const { width, height } = getResultModalSize()
    const next = getClampedResultPosition(
      (window.innerWidth - width) / 2,
      (window.innerHeight - height) / 2,
    )
    setResultModalPosition(next.left, next.top)
  }

  function closeResultModal() {
    resultOverlayEl.style.display = 'none'
    isDraggingResult = false
    suppressResultOverlayClick = false
  }

  function openResultModal(note: ExtractedNoteRecord) {
    const titleEl = root.querySelector<HTMLElement>('[data-field="title"]')
    const authorEl = root.querySelector<HTMLElement>('[data-field="author"]')
    const sourceUrlEl = root.querySelector<HTMLElement>('[data-field="sourceUrl"]')
    const coverImageUrlEl = root.querySelector<HTMLElement>('[data-field="coverImageUrl"]')
    const contentTextEl = root.querySelector<HTMLElement>('[data-field="contentText"]')

    if (!titleEl || !authorEl || !sourceUrlEl || !coverImageUrlEl || !contentTextEl) return

    titleEl.textContent = getDisplayNoteTitle(note.title)
    authorEl.textContent = note.authorName || '未抓到作者昵称'
    sourceUrlEl.textContent = note.sourceUrl || '未抓到链接'
    coverImageUrlEl.textContent = note.coverImageUrl || '未抓到封面'
    contentTextEl.textContent = note.contentText || '未抓到正文'

    resultOverlayEl.style.display = 'block'
    requestAnimationFrame(() => {
      placeResultModal()
    })
  }

  function getPanelSize() {
    const rect = panelEl.getBoundingClientRect()
    return {
      width: rect.width || 360,
      height: rect.height || 420,
    }
  }

  function setPanelPosition(left: number, top: number) {
    panelEl.style.left = `${left}px`
    panelEl.style.top = `${top}px`
  }

  function getClampedPanelPosition(left: number, top: number) {
    const { width, height } = getPanelSize()
    return {
      left: clamp(left, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN)),
      top: clamp(top, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN)),
    }
  }

  function placePanel() {
    const { width, height } = getPanelSize()
    let nextLeft = (window.innerWidth - width) / 2
    let nextTop = (window.innerHeight - height) / 2

    const base = getClampedPanelPosition(nextLeft, nextTop)
    nextLeft = base.left
    nextTop = base.top

    if (selectedRect && rectsOverlap(nextLeft, nextTop, width, height, {
      left: selectedRect.left - 24,
      top: selectedRect.top - 24,
      right: selectedRect.right + 24,
      bottom: selectedRect.bottom + 24,
    })) {
      const below = getClampedPanelPosition(nextLeft, selectedRect.bottom + 20)
      const above = getClampedPanelPosition(nextLeft, selectedRect.top - height - 20)
      const right = getClampedPanelPosition(selectedRect.right + 20, nextTop)
      const left = getClampedPanelPosition(selectedRect.left - width - 20, nextTop)

      const candidates = [below, above, right, left]
      const match = candidates.find(
        (candidate) =>
          !rectsOverlap(candidate.left, candidate.top, width, height, {
            left: selectedRect!.left - 24,
            top: selectedRect!.top - 24,
            right: selectedRect!.right + 24,
            bottom: selectedRect!.bottom + 24,
          }),
      )

      if (match) {
        nextLeft = match.left
        nextTop = match.top
      }
    }

    setPanelPosition(nextLeft, nextTop)
  }

  function canStartPanelDrag(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false
    if (!panelEl.contains(target)) return false

    const interactiveSelector =
      'input, textarea, button, select, option, label, .xhs-ai-color-row, .xhs-ai-actions'

    if (target.closest(interactiveSelector)) {
      return false
    }

    return true
  }

  function openPanel() {
    previewEl.textContent = selectedText
    panelEl.style.display = 'block'
    closeTrigger()
    requestAnimationFrame(() => {
      if (!hasManualPanelPosition) {
        placePanel()
      }
      tagNameInputEl.focus()
    })
  }

  async function sendSelectionToSidePanel() {
    const selectionText = selectedText || cleanText(window.getSelection()?.toString())
    if (!selectionText) return
    selectedText = selectionText

    const openPanelPromise = chrome.runtime
      .sendMessage({
        type: 'XHS_OPEN_SIDE_PANEL',
      })
      .then((response: { ok?: boolean } | undefined) => response?.ok !== false)
      .catch(() => false)
    const note = extractNoteFromPage()
    const pendingSelection = {
      selectedText: selectionText,
      noteUrl: note.sourceUrl,
      noteTitle: getDisplayNoteTitle(note.title),
      noteAuthorName: note.authorName,
      createdAt: new Date().toISOString(),
    }

    await chrome.storage.local.set({
      [PENDING_SNIPPET_SELECTION_KEY]: pendingSelection,
    })

    showToast(root, '已发送到右侧边栏')
    closeTrigger()
    clearBrowserSelection()

    const didRequestPanel = await openPanelPromise
    if (!didRequestPanel) {
      showToast(root, '已保存，手动打开右侧边栏即可查看')
    }
  }

  function positionTrigger(rect: DOMRect) {
    const viewport = window.visualViewport
    const viewportWidth = viewport?.width ?? window.innerWidth
    const viewportHeight = viewport?.height ?? window.innerHeight
    const triggerWidth = Math.max(triggerEl.offsetWidth || 96, 96)
    const triggerHeight = triggerEl.offsetHeight || 46
    const minLeft = 12
    const maxLeft = Math.max(minLeft, viewportWidth - triggerWidth - 12)
    const minTop = 12
    const maxTop = Math.max(minTop, viewportHeight - triggerHeight - 12)
    const preferredTop = rect.top - triggerHeight - 8
    const fallbackTop = rect.bottom + 8
    const nextTop = preferredTop >= minTop ? preferredTop : fallbackTop
    const left = clamp(rect.left + rect.width / 2 - triggerWidth / 2, minLeft, maxLeft)
    const top = clamp(nextTop, minTop, maxTop)
    triggerEl.style.top = `${top}px`
    triggerEl.style.left = `${left}px`
    triggerEl.style.display = 'block'
  }

  function updateVisibleTriggerPosition() {
    if (triggerEl.style.display !== 'block') return

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      closeTrigger()
      return
    }

    const text = cleanText(selection.toString())
    if (text.length < 2) {
      closeTrigger()
      return
    }

    const range = selection.getRangeAt(0)
    if (!isSelectionInsideNote(range)) {
      closeTrigger()
      return
    }

    selectedText = text
    selectedRect = range.getBoundingClientRect()
    positionTrigger(selectedRect)
  }

  function scheduleTriggerPositionUpdate() {
    window.cancelAnimationFrame(triggerRepositionFrame)
    triggerRepositionFrame = window.requestAnimationFrame(updateVisibleTriggerPosition)
  }

  function updateSelectionState() {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      closeTrigger()
      return
    }

    const text = cleanText(selection.toString())
    if (text.length < 2) {
      closeTrigger()
      return
    }

    const range = selection.getRangeAt(0)
    if (!isSelectionInsideNote(range)) {
      closeTrigger()
      return
    }

    selectedText = text
    selectedRect = range.getBoundingClientRect()
    positionTrigger(selectedRect)
  }

  async function saveSnippet() {
    if (!selectedText) return

    const reasonText = cleanText(reasonInputEl.value)
    const note = extractNoteFromPage()
    const storage = await chrome.storage.local.get([SNIPPET_STORAGE_KEY, COLOR_TAG_NAMES_STORAGE_KEY])
    const savedSnippets = (storage[SNIPPET_STORAGE_KEY] as SavedSnippetRecord[] | undefined) ?? []
    const colorTagNames =
      (storage[COLOR_TAG_NAMES_STORAGE_KEY] as Record<string, string> | undefined) ?? {}
    const tagName = normalizeTagName(tagNameInputEl.value) || colorTagNames[selectedColor] || ''
    const nextColorTagNames = {
      ...colorTagNames,
      [selectedColor]: tagName,
    }
    const updatedSnippets = savedSnippets.map((snippet) => {
      const sameColor = (snippet.colorValue || COLOR_PRESETS[0].value) === selectedColor
      if (!sameColor) return snippet

      return {
        ...snippet,
        colorTagName: tagName,
      }
    })
    const record: SavedSnippetRecord = {
      id: crypto.randomUUID(),
      noteUrl: note.sourceUrl,
      noteTitle: getDisplayNoteTitle(note.title),
      noteAuthorName: note.authorName,
      selectedText,
      reasonText,
      colorTagName: tagName,
      colorValue: selectedColor,
      createdAt: new Date().toISOString(),
    }

    await chrome.storage.local.set({
      [COLOR_TAG_NAMES_STORAGE_KEY]: nextColorTagNames,
      [SNIPPET_STORAGE_KEY]: [record, ...updatedSnippets],
    })

    showToast(root, '片段已保存')
    closePanel()
    clearBrowserSelection()
  }

  function activateTrigger(event: Event) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (isTriggerActivating) return

    isTriggerActivating = true
    void sendSelectionToSidePanel().finally(() => {
      window.setTimeout(() => {
        isTriggerActivating = false
      }, 400)
    })
  }

  function isTriggerVisible() {
    return triggerEl.style.display === 'block'
  }

  function isPointerInsideTrigger(event: MouseEvent | PointerEvent) {
    if (!isTriggerVisible()) return false

    const rect = triggerEl.getBoundingClientRect()
    const hitSlop = 10
    return (
      event.clientX >= rect.left - hitSlop &&
      event.clientX <= rect.right + hitSlop &&
      event.clientY >= rect.top - hitSlop &&
      event.clientY <= rect.bottom + hitSlop
    )
  }

  function captureTriggerPointer(event: MouseEvent | PointerEvent) {
    if (!isPointerInsideTrigger(event)) return
    activateTrigger(event)
  }

  window.addEventListener('pointerdown', captureTriggerPointer, true)
  window.addEventListener('mousedown', captureTriggerPointer, true)
  window.addEventListener('mouseup', captureTriggerPointer, true)
  window.addEventListener('click', captureTriggerPointer, true)
  document.addEventListener('pointerdown', captureTriggerPointer, true)
  document.addEventListener('mousedown', captureTriggerPointer, true)
  document.addEventListener('mouseup', captureTriggerPointer, true)
  document.addEventListener('click', captureTriggerPointer, true)

  triggerEl.addEventListener('pointerdown', (event) => {
    activateTrigger(event)
  })
  triggerEl.addEventListener('mousedown', (event) => {
    activateTrigger(event)
  })
  triggerEl.addEventListener('click', (event) => {
    activateTrigger(event)
  })
  cancelButtonEl.addEventListener('click', () => {
    closePanel()
    clearBrowserSelection()
  })
  saveButtonEl.addEventListener('click', () => {
    void saveSnippet()
  })

  resultCloseEl.addEventListener('click', closeResultModal)
  resultOverlayEl.addEventListener('click', (event) => {
    if (suppressResultOverlayClick) {
      suppressResultOverlayClick = false
      return
    }

    if (event.target === resultOverlayEl) {
      closeResultModal()
    }
  })

  resultEdges.forEach((edge) => {
    edge.addEventListener('mousedown', (event) => {
      const rect = resultModalEl.getBoundingClientRect()
      isDraggingResult = true
      suppressResultOverlayClick = false
      resultDragOffsetX = event.clientX - rect.left
      resultDragOffsetY = event.clientY - rect.top
      event.preventDefault()
    })
  })

  function startPanelDrag(event: MouseEvent) {
    const mouseEvent = event as MouseEvent
    const rect = panelEl.getBoundingClientRect()
    isDraggingPanel = true
    hasManualPanelPosition = true
    dragOffsetX = mouseEvent.clientX - rect.left
    dragOffsetY = mouseEvent.clientY - rect.top
    mouseEvent.preventDefault()
  }

  panelHeadEl.addEventListener('mousedown', (event) => {
    startPanelDrag(event)
  })

  panelEl.addEventListener('mousedown', (event) => {
    if (!canStartPanelDrag(event.target)) return
    startPanelDrag(event)
  })

  document.addEventListener('mousemove', (event) => {
    if (isDraggingResult) {
      suppressResultOverlayClick = true
      const next = getClampedResultPosition(
        event.clientX - resultDragOffsetX,
        event.clientY - resultDragOffsetY,
      )
      setResultModalPosition(next.left, next.top)
      return
    }

    if (!isDraggingPanel) return

    const next = getClampedPanelPosition(
      event.clientX - dragOffsetX,
      event.clientY - dragOffsetY,
    )
    setPanelPosition(next.left, next.top)
  })

  document.addEventListener('mouseup', () => {
    isDraggingPanel = false
    isDraggingResult = false
  })

  window.addEventListener('resize', () => {
    if (panelEl.style.display !== 'block') return

    if (hasManualPanelPosition) {
      const rect = panelEl.getBoundingClientRect()
      const next = getClampedPanelPosition(rect.left, rect.top)
      setPanelPosition(next.left, next.top)
      return
    }

    placePanel()
  })

  window.addEventListener('resize', scheduleTriggerPositionUpdate)
  window.addEventListener('scroll', scheduleTriggerPositionUpdate, true)
  window.visualViewport?.addEventListener('resize', scheduleTriggerPositionUpdate)
  window.visualViewport?.addEventListener('scroll', scheduleTriggerPositionUpdate)

  window.addEventListener('resize', () => {
    if (resultOverlayEl.style.display !== 'block') return
    placeResultModal()
  })

  document.addEventListener('selectionchange', () => {
    window.setTimeout(updateSelectionState, 0)
  })

  document.addEventListener('mousedown', (event) => {
    if (isPointerInsideTrigger(event)) return

    const target = event.target as Node
    if (!root.contains(target)) {
      closeTrigger()
    }
  })

  return {
    openResultModal,
  }
}

export default defineContentScript({
  matches: ['https://www.xiaohongshu.com/*'],
  runAt: 'document_start',
  main() {
    console.info('Lumos AI Writer content script ready')
    setupNoteRouteChangeNotifier()
    const selectionUi = setupSelectionAnnotation()

    chrome.runtime.onMessage.addListener(
      (
        message: ExtractMessageRequest | ShowExtractResultMessageRequest,
        _sender,
        sendResponse: (response: ExtractMessageResponse) => void,
      ) => {
        if (message.type === 'XHS_SHOW_EXTRACT_RESULT') {
          selectionUi?.openResultModal(message.data)
          sendResponse({ ok: true, data: message.data })
          return
        }

        if (message.type !== 'XHS_EXTRACT_NOTE') return

        const note = extractNoteFromPage()
        const error = validateExtractedNote(note)

        if (error) {
          sendResponse({ ok: false, error })
          return
        }

        sendResponse({ ok: true, data: note })
      },
    )
  },
})
