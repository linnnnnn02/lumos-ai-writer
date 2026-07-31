import { z } from 'zod'
import { noteLearningStatuses, noteQualityFlags } from '../library-quality.js'

export const noteLearningStatusSchema = z.enum(noteLearningStatuses)
export const noteQualityFlagSchema = z.enum(noteQualityFlags)

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
  learningStatus: noteLearningStatusSchema.default('ready'),
  qualityFlags: z.array(noteQualityFlagSchema).default([]),
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

export const createFolderRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export const createFolderResponseSchema = z.object({
  ok: z.literal(true),
  folder: folderDtoSchema,
})

export const updateFolderRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export const updateFolderResponseSchema = z.object({
  ok: z.literal(true),
  folder: folderDtoSchema,
})

export const upsertNoteRequestSchema = z.object({
  folderId: z.string().uuid().nullable().optional(),
  filename: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(240),
  authorName: z.string().trim().max(120).optional(),
  sourceUrl: z.string().trim().min(1).max(2048),
  coverImageUrl: z.string().trim().max(2048).optional(),
  contentText: z.string().max(50000).optional(),
  savedAt: z.string().optional(),
})

export const upsertNoteResponseSchema = z.object({
  ok: z.literal(true),
  note: noteDtoSchema,
})

export const updateNoteLearningStatusRequestSchema = z.object({
  status: z.enum(['ready', 'excluded']),
})

export const createSnippetRequestSchema = z.object({
  id: z.string().uuid().optional(),
  noteId: z.string().uuid().optional(),
  noteUrl: z.string().trim().min(1).max(2048).optional(),
  selectedText: z.string().trim().min(1).max(10000),
  reasonText: z.string().trim().max(2000).optional(),
  colorTagName: z.string().trim().max(80).optional(),
  colorValue: z.string().trim().max(40).optional(),
  createdAt: z.string().optional(),
})

export const createSnippetResponseSchema = z.object({
  ok: z.literal(true),
  snippet: snippetDtoSchema,
})

export const syncAnnotationRequestSchema = z.object({
  folderName: z.string().trim().min(1).max(80),
  note: upsertNoteRequestSchema.omit({ folderId: true }),
  snippet: createSnippetRequestSchema
    .omit({ noteId: true, noteUrl: true })
    .extend({ id: z.string().uuid() }),
})

export const syncAnnotationResponseSchema = z.object({
  ok: z.literal(true),
  folder: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
  note: noteDtoSchema,
  snippet: snippetDtoSchema,
})

export const updateSnippetRequestSchema = z.object({
  selectedText: z.string().trim().min(1).max(10000),
  reasonText: z.string().trim().max(2000).optional(),
  colorTagName: z.string().trim().max(80).optional(),
  colorValue: z.string().trim().max(40).optional(),
})

export const updateSnippetResponseSchema = z.object({
  ok: z.literal(true),
  snippet: snippetDtoSchema,
})

export const deleteResourceResponseSchema = z.object({
  ok: z.literal(true),
})

export const trashNoteEntrySchema = z.object({
  id: z.string(),
  trashItemId: z.string(),
  source: z.enum(['note', 'folder']),
  deletedAt: z.string(),
  note: noteDtoSchema,
  snippets: z.array(snippetDtoSchema),
})

export const trashFolderGroupSchema = z.object({
  id: z.string(),
  folderId: z.string(),
  folderName: z.string(),
  deletedAt: z.string(),
  folderDeleted: z.boolean(),
  notes: z.array(trashNoteEntrySchema),
})

export const listTrashResponseSchema = z.object({
  ok: z.literal(true),
  groups: z.array(trashFolderGroupSchema),
})

export type ListFoldersResponse = z.infer<typeof listFoldersResponseSchema>
export type ListNotesResponse = z.infer<typeof listNotesResponseSchema>
export type ListSnippetsResponse = z.infer<typeof listSnippetsResponseSchema>
export type ListTrashResponse = z.infer<typeof listTrashResponseSchema>
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>
export type CreateFolderResponse = z.infer<typeof createFolderResponseSchema>
export type UpdateFolderRequest = z.infer<typeof updateFolderRequestSchema>
export type UpdateFolderResponse = z.infer<typeof updateFolderResponseSchema>
export type UpsertNoteRequest = z.infer<typeof upsertNoteRequestSchema>
export type UpsertNoteResponse = z.infer<typeof upsertNoteResponseSchema>
export type UpdateNoteLearningStatusRequest = z.infer<
  typeof updateNoteLearningStatusRequestSchema
>
export type CreateSnippetRequest = z.infer<typeof createSnippetRequestSchema>
export type CreateSnippetResponse = z.infer<typeof createSnippetResponseSchema>
export type SyncAnnotationRequest = z.infer<typeof syncAnnotationRequestSchema>
export type SyncAnnotationResponse = z.infer<typeof syncAnnotationResponseSchema>
export type UpdateSnippetRequest = z.infer<typeof updateSnippetRequestSchema>
export type UpdateSnippetResponse = z.infer<typeof updateSnippetResponseSchema>
export type DeleteResourceResponse = z.infer<typeof deleteResourceResponseSchema>
export type TrashNoteEntry = z.infer<typeof trashNoteEntrySchema>
export type TrashFolderGroup = z.infer<typeof trashFolderGroupSchema>
