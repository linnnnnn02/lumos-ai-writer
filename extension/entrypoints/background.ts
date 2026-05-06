import { defineBackground } from 'wxt/utils/define-background'

export default defineBackground(() => {
  type RuntimeMessage =
    | {
        type?: string
      }
    | {
        type: 'XHS_OPEN_SIDE_PANEL'
      }
    | {
        type: 'XHS_FETCH_NOTE_COVER'
        sourceUrl?: string
      }

  type FetchNoteCoverResponse =
    | {
        ok: true
        coverImageUrl: string
      }
    | {
        ok: false
        error: string
      }

  function cleanText(text: string | null | undefined) {
    return (text ?? '').replace(/\s+/g, ' ').trim()
  }

  function decodeHtmlText(text: string) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\\u002F/g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/\\u003D/g, '=')
      .replace(/\\\//g, '/')
  }

  function normalizeImageUrl(url: string, baseUrl: string) {
    const trimmed = cleanText(decodeHtmlText(url))
    if (!trimmed || trimmed.startsWith('data:image/svg') || trimmed.startsWith('blob:')) return ''
    if (trimmed.startsWith('//')) return `https:${trimmed}`

    try {
      const parsed = new URL(trimmed, baseUrl)
      if (parsed.protocol === 'http:' && /\.xhscdn\.com$/i.test(parsed.hostname)) {
        parsed.protocol = 'https:'
      }
      return parsed.href
    } catch {
      return ''
    }
  }

  function getHtmlAttribute(tag: string, name: string) {
    const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i')
    return decodeHtmlText(tag.match(pattern)?.[1] || '')
  }

  function extractMetaCoverImage(html: string, baseUrl: string) {
    const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
    for (const tag of metaTags) {
      const name = getHtmlAttribute(tag, 'property') || getHtmlAttribute(tag, 'name')
      if (!/^(og:image|og:image:url|twitter:image)$/i.test(name)) continue

      const coverImageUrl = normalizeImageUrl(getHtmlAttribute(tag, 'content'), baseUrl)
      if (coverImageUrl) return coverImageUrl
    }

    return ''
  }

  function collectImagesFromJsonLd(value: unknown): string[] {
    if (!value) return []
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap((item) => collectImagesFromJsonLd(item))
    if (typeof value !== 'object') return []

    const record = value as Record<string, unknown>
    return [
      ...collectImagesFromJsonLd(record.image),
      ...collectImagesFromJsonLd(record.thumbnailUrl),
      ...collectImagesFromJsonLd(record.url),
      ...collectImagesFromJsonLd(record.contentUrl),
    ]
  }

  function extractJsonLdCoverImage(html: string, baseUrl: string) {
    const scripts = html.match(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
    )

    for (const script of scripts ?? []) {
      const jsonText = decodeHtmlText(script.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, ''))
      try {
        const parsed = JSON.parse(jsonText) as unknown
        for (const candidate of collectImagesFromJsonLd(parsed)) {
          const coverImageUrl = normalizeImageUrl(candidate, baseUrl)
          if (coverImageUrl) return coverImageUrl
        }
      } catch {
        // JSON-LD is optional. If it is malformed, fallback regex extraction can still help.
      }
    }

    return ''
  }

  function extractInlineCoverImage(html: string, baseUrl: string) {
    const decodedHtml = decodeHtmlText(html)
    const candidates = decodedHtml.match(/https?:\/\/[^"'\\<>\s]+/gi) ?? []
    const imageCandidate = candidates.find((candidate) =>
      /(^https?:\/\/[^/]*xhscdn\.com\/|sns-webpic|image|cover|thumbnail|poster)/i.test(candidate),
    )

    return imageCandidate ? normalizeImageUrl(imageCandidate, baseUrl) : ''
  }

  function isSafeXhsSourceUrl(sourceUrl: string) {
    try {
      const parsed = new URL(sourceUrl)
      return parsed.protocol === 'https:' && /\.xiaohongshu\.com$/i.test(parsed.hostname)
    } catch {
      return false
    }
  }

  async function fetchNoteCover(sourceUrl: string): Promise<FetchNoteCoverResponse> {
    if (!isSafeXhsSourceUrl(sourceUrl)) {
      return { ok: false, error: '只支持小红书笔记链接。' }
    }

    try {
      const response = await fetch(sourceUrl, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) return { ok: false, error: `页面请求失败：${response.status}` }

      const html = await response.text()
      const coverImageUrl =
        extractMetaCoverImage(html, sourceUrl) ||
        extractJsonLdCoverImage(html, sourceUrl) ||
        extractInlineCoverImage(html, sourceUrl)

      return coverImageUrl
        ? { ok: true, coverImageUrl }
        : { ok: false, error: '没有从页面里找到封面。' }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '封面请求失败。',
      }
    }
  }

  async function enableSidePanelBehavior() {
    try {
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: true,
      })
    } catch (error) {
      console.warn('Failed to enable side panel behavior', error)
    }
  }

  async function openSidePanel(tabId?: number) {
    const sidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
      open?: (options: { tabId?: number; windowId?: number }) => Promise<void>
    }

    if (!sidePanel.open) return false

    try {
      if (tabId) {
        await sidePanel.open({ tabId })
        return true
      }

      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })

      if (activeTab?.id) {
        await sidePanel.open({ tabId: activeTab.id })
        return true
      }
    } catch (error) {
      console.warn('Failed to open side panel', error)
    }

    return false
  }

  chrome.runtime.onInstalled.addListener(() => {
    console.info('Lumos AI Writer extension installed')
    void enableSidePanelBehavior()
  })

  chrome.runtime.onStartup?.addListener(() => {
    void enableSidePanelBehavior()
  })

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === 'XHS_OPEN_SIDE_PANEL') {
      void openSidePanel(sender.tab?.id).then((ok) => {
        sendResponse({ ok })
      })
      return true
    }

    if (message.type === 'XHS_FETCH_NOTE_COVER') {
      const sourceUrl = 'sourceUrl' in message ? message.sourceUrl : ''
      void fetchNoteCover(sourceUrl || '').then(sendResponse)
      return true
    }
  })
})
