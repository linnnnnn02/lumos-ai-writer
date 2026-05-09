import { z } from 'zod'

export const folderDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  noteCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
})

export type FolderDto = z.infer<typeof folderDtoSchema>

export const noteDtoSchema = z.object({
  id: z.string(),
  folderId: z.string(),
  folderName: z.string(),
  filename: z.string(),
  title: z.string(),
  authorName: z.string(),
  sourceUrl: z.string(),
  coverImageUrl: z.string().optional(),
  contentText: z.string(),
  savedAt: z.string(),
})

export type NoteDto = z.infer<typeof noteDtoSchema>

export const snippetDtoSchema = z.object({
  id: z.string(),
  noteUrl: z.string(),
  noteTitle: z.string(),
  noteAuthorName: z.string(),
  selectedText: z.string(),
  reasonText: z.string(),
  colorTagName: z.string(),
  colorValue: z.string().optional(),
  createdAt: z.string().optional(),
})

export type SnippetDto = z.infer<typeof snippetDtoSchema>

export const listFoldersResponseSchema = z.object({
  ok: z.literal(true),
  folders: z.array(folderDtoSchema),
})

export const listNotesResponseSchema = z.object({
  ok: z.literal(true),
  notes: z.array(noteDtoSchema),
})

export const listSnippetsResponseSchema = z.object({
  ok: z.literal(true),
  snippets: z.array(snippetDtoSchema),
})

export type ListFoldersResponse = z.infer<typeof listFoldersResponseSchema>
export type ListNotesResponse = z.infer<typeof listNotesResponseSchema>
export type ListSnippetsResponse = z.infer<typeof listSnippetsResponseSchema>
