export const projectLengths = ['short', 'medium', 'long'] as const

export * from './schemas/api.js'
export * from './schemas/ai.js'
export * from './schemas/library.js'
export * from './schemas/writing-profile.js'
export * from './schemas/workspace.js'

export type ProjectLength = (typeof projectLengths)[number]

export interface FolderSummary {
  id: string
  name: string
  noteCount: number
  updatedAt: string
}

export interface SavedFolderRecord extends FolderSummary {}

export interface NoteSnippetRecord {
  id: string
  selectedText: string
  reasonText: string
  colorTagName: string
  colorValue?: string
  createdAt?: string
}

export interface NoteRecord {
  id: string
  title: string
  authorName: string
  sourceUrl: string
  coverImageUrl?: string
  contentText: string
  snippets: NoteSnippetRecord[]
}

export interface DraftBlockRecord {
  key: string
  title: string
  toneHint: string
  content: string
  blockColor?: string
}

export interface ExtractedNoteRecord {
  title: string
  authorName: string
  sourceUrl: string
  coverImageUrl: string
  contentText: string
}

export interface SavedNoteRecord extends ExtractedNoteRecord {
  id: string
  folderId: string
  folderName: string
  filename: string
  savedAt: string
}

export interface SavedSnippetRecord extends NoteSnippetRecord {
  noteUrl: string
  noteTitle: string
  noteAuthorName: string
}

export interface PendingSnippetSelectionRecord {
  selectedText: string
  noteUrl: string
  noteTitle: string
  noteAuthorName: string
  createdAt: string
}

export function normalizeNoteUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url
  }
}
