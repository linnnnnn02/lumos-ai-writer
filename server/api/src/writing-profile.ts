import type { User } from '@supabase/supabase-js'
import {
  writingProfileSchema,
  type AiSkillMetadata,
  type BuildWritingProfileRequest,
  type WritingProfile,
  type WritingProfileRevisionDto,
  type WritingProfileScope,
} from '@lumos-ai/shared'
import type { AppConfig } from './env.js'
import { SupabaseSchemaMissingError } from './library.js'
import { createSupabaseAdminClient } from './supabase.js'
import { WorkspaceOwnershipError } from './workspace.js'

type DatabaseError = {
  code?: string
  message?: string
}

type WritingProfileRevisionRow = {
  id: string
  scope: WritingProfileScope
  project_id: string | null
  version: number
  profile: unknown
  evidence_ids: string[] | null
  skill_id: string
  skill_version: string
  prompt_hash: string
  created_at: string
}

export type WritingProfileContext = {
  accountProfile: WritingProfileRevisionDto | null
  projectProfile: WritingProfileRevisionDto | null
}

const revisionColumns =
  'id,scope,project_id,version,profile,evidence_ids,skill_id,skill_version,prompt_hash,created_at'

function assertNoDatabaseError(error: DatabaseError | null) {
  if (!error) return
  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205') {
    throw new SupabaseSchemaMissingError('Writing profile migration is not installed.')
  }
  throw new Error(error.message || 'Supabase writing profile request failed.')
}

function getAdminClient(config: AppConfig) {
  const supabase = createSupabaseAdminClient(config)
  if (!supabase) {
    throw new SupabaseSchemaMissingError('Supabase service role key is not configured.')
  }
  return supabase
}

function toRevisionDto(row: WritingProfileRevisionRow): WritingProfileRevisionDto {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    version: row.version,
    profile: writingProfileSchema.parse(row.profile),
    evidenceIds: row.evidence_ids ?? [],
    skill: {
      id: row.skill_id,
      version: row.skill_version,
      promptHash: row.prompt_hash,
    },
    createdAt: row.created_at,
  }
}

async function assertOwnedProject(
  config: AppConfig,
  user: User,
  projectId: string,
) {
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()
  assertNoDatabaseError(error)
  if (!data) throw new WorkspaceOwnershipError()
}

async function getLatestRevision(
  config: AppConfig,
  user: User,
  scope: WritingProfileScope,
  projectId: string | null,
) {
  const supabase = getAdminClient(config)
  let query = supabase
    .from('writing_profile_revisions')
    .select(revisionColumns)
    .eq('user_id', user.id)
    .eq('scope', scope)

  query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null)
  const { data, error } = await query.order('version', { ascending: false }).limit(1)
  assertNoDatabaseError(error)

  const row = (data?.[0] ?? null) as WritingProfileRevisionRow | null
  return row ? toRevisionDto(row) : null
}

export async function getWritingProfileContext(
  config: AppConfig,
  user: User,
  projectId?: string,
): Promise<WritingProfileContext> {
  if (projectId) await assertOwnedProject(config, user, projectId)

  const [accountProfile, projectProfile] = await Promise.all([
    getLatestRevision(config, user, 'account', null),
    projectId ? getLatestRevision(config, user, 'project', projectId) : null,
  ])

  return { accountProfile, projectProfile }
}

export function collectWritingEvidenceIds(input: BuildWritingProfileRequest) {
  const evidenceIds = Array.from(
    new Set([
      ...input.libraryEvidence.notes.map((item) => item.id),
      ...input.libraryEvidence.snippets.map((item) => item.id),
      ...input.feedbackEvidence.map((item) => item.id),
    ]),
  )

  const fingerprintSource = JSON.stringify({
    notes: input.libraryEvidence.notes,
    snippets: input.libraryEvidence.snippets,
    feedback: input.feedbackEvidence,
  })
  let fingerprint = 2166136261
  for (let index = 0; index < fingerprintSource.length; index += 1) {
    fingerprint ^= fingerprintSource.charCodeAt(index)
    fingerprint = Math.imul(fingerprint, 16777619)
  }

  return [
    ...evidenceIds,
    `__content_fingerprint__:${(fingerprint >>> 0).toString(16).padStart(8, '0')}`,
  ]
}

export function canReuseWritingProfileRevision(
  revision: WritingProfileRevisionDto | null,
  evidenceIds: string[],
  activeSkill: AiSkillMetadata,
) {
  if (!revision) return false

  const revisionEvidenceIds = new Set(revision.evidenceIds)
  const hasSameEvidence =
    revisionEvidenceIds.size === evidenceIds.length &&
    evidenceIds.every((id) => revisionEvidenceIds.has(id))
  const hasSameSkill =
    revision.skill.id === activeSkill.id &&
    revision.skill.version === activeSkill.version &&
    revision.skill.promptHash === activeSkill.promptHash

  return hasSameEvidence && hasSameSkill
}

export async function createWritingProfileRevision(
  config: AppConfig,
  user: User,
  input: BuildWritingProfileRequest,
  profile: WritingProfile,
  skill: AiSkillMetadata,
) {
  const projectId = input.scope === 'project' ? input.projectId ?? null : null
  if (projectId) await assertOwnedProject(config, user, projectId)

  const latest = await getLatestRevision(config, user, input.scope, projectId)
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('writing_profile_revisions')
    .insert({
      user_id: user.id,
      scope: input.scope,
      project_id: projectId,
      version: (latest?.version ?? 0) + 1,
      profile,
      evidence_ids: collectWritingEvidenceIds(input),
      skill_id: skill.id,
      skill_version: skill.version,
      prompt_hash: skill.promptHash,
    })
    .select(revisionColumns)
    .single()
  assertNoDatabaseError(error)

  return toRevisionDto(data as WritingProfileRevisionRow)
}
