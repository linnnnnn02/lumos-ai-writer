import type { User } from '@supabase/supabase-js'
import {
  writingProfileSchema,
  type AiSkillMetadata,
  type BuildWritingProfileRequest,
  type ManageWritingPreferenceAction,
  type ManageWritingPreferenceRequest,
  type WritingProfile,
  type WritingPreference,
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

type PreferenceFeedbackRow = {
  id: string
  project_id: string | null
  type: string
  content: string
  context: unknown
  source: string
}

export type WritingProfileContext = {
  accountProfile: WritingProfileRevisionDto | null
  projectProfile: WritingProfileRevisionDto | null
}

export class WritingProfileVersionConflictError extends Error {
  currentRevision: WritingProfileRevisionDto

  constructor(currentRevision: WritingProfileRevisionDto) {
    super('Writing profile revision changed.')
    this.name = 'WritingProfileVersionConflictError'
    this.currentRevision = currentRevision
  }
}

export class WritingPreferenceNotFoundError extends Error {
  constructor() {
    super('Writing preference not found.')
    this.name = 'WritingPreferenceNotFoundError'
  }
}

export class WritingPreferenceTransitionError extends Error {
  constructor() {
    super('Writing preference action is not valid for its current status.')
    this.name = 'WritingPreferenceTransitionError'
  }
}

export class WritingPreferenceFeedbackError extends Error {
  constructor() {
    super('Writing preference feedback does not match the requested action.')
    this.name = 'WritingPreferenceFeedbackError'
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const validActionsByStatus: Record<
  WritingPreference['status'],
  readonly ManageWritingPreferenceAction[]
> = {
  candidate: ['enable', 'correct'],
  active: ['disable', 'correct'],
  disabled: ['enable', 'delete'],
  rejected: ['enable'],
}

export function applyWritingPreferenceAction(
  profile: WritingProfile,
  input: {
    preferenceId: string
    action: ManageWritingPreferenceAction
    content: string
    feedbackMemoryId: string
  },
) {
  const preferenceIndex = profile.preferences.findIndex(
    (preference) => preference.id === input.preferenceId,
  )
  if (preferenceIndex < 0) throw new WritingPreferenceNotFoundError()

  const current = profile.preferences[preferenceIndex]
  if (!validActionsByStatus[current.status].includes(input.action)) {
    throw new WritingPreferenceTransitionError()
  }

  const explicitEvidenceIds = Array.from(
    new Set([...current.evidenceIds, input.feedbackMemoryId]),
  ).slice(-30)
  let updated: WritingPreference

  if (input.action === 'disable') {
    updated = { ...current, status: 'disabled' }
  } else if (input.action === 'delete') {
    updated = { ...current, status: 'rejected' }
  } else if (input.action === 'correct') {
    const statement = input.content.trim()
    if (!statement || statement.length > 800) throw new WritingPreferenceFeedbackError()
    updated = {
      ...current,
      statement,
      application: '未来写作直接遵循这条用户明确规则，当前任务的事实和明确要求仍然优先。',
      confidence: Math.max(current.confidence, 0.85),
      supportCount: explicitEvidenceIds.length,
      evidenceIds: explicitEvidenceIds,
      sourceCategory: current.scope === 'account' ? 'long_term_habit' : 'pattern_preference',
      status: 'active',
    }
  } else {
    updated = {
      ...current,
      confidence: Math.max(current.confidence, 0.85),
      supportCount: explicitEvidenceIds.length,
      evidenceIds: explicitEvidenceIds,
      sourceCategory: current.scope === 'account' ? 'long_term_habit' : 'pattern_preference',
      status: 'active',
    }
  }

  return writingProfileSchema.parse({
    ...profile,
    evidenceCount: profile.evidenceCount + 1,
    preferences: profile.preferences.map((preference, index) =>
      index === preferenceIndex ? updated : preference,
    ),
  })
}

export function parseStoredWritingProfile(value: unknown): WritingProfile {
  const rawProfile =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const rawPreferences = Array.isArray(rawProfile.preferences) ? rawProfile.preferences : []
  const profile = writingProfileSchema.parse(value)

  return {
    ...profile,
    preferences: profile.preferences.map((preference, index) => {
      const rawPreference = rawPreferences[index]
      const hasPersistedStatus = Boolean(
        rawPreference &&
          typeof rawPreference === 'object' &&
          !Array.isArray(rawPreference) &&
          'status' in rawPreference,
      )
      if (hasPersistedStatus) return preference

      return {
        ...preference,
        status:
          preference.supportCount <= 1 && preference.confidence <= 0.45
            ? ('candidate' as const)
            : ('active' as const),
      }
    }),
  }
}

function toRevisionDto(row: WritingProfileRevisionRow): WritingProfileRevisionDto {
  const profile = parseStoredWritingProfile(row.profile)

  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    version: row.version,
    profile,
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

async function getPreferenceFeedback(
  config: AppConfig,
  user: User,
  input: ManageWritingPreferenceRequest,
) {
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('feedback_memories')
    .select('id,project_id,type,content,context,source')
    .eq('id', input.feedbackMemoryId)
    .eq('user_id', user.id)
    .maybeSingle()
  assertNoDatabaseError(error)

  const feedback = data as PreferenceFeedbackRow | null
  const context = isRecord(feedback?.context) ? feedback.context : null
  const preferenceAction = isRecord(context?.preferenceAction)
    ? context.preferenceAction
    : null
  const expectedProjectId = input.scope === 'project' ? input.projectId ?? null : null
  const matchesAction =
    preferenceAction?.action === input.action &&
    preferenceAction.preferenceId === input.preferenceId

  if (
    !feedback ||
    feedback.type !== 'profile_correction' ||
    feedback.source !== 'profile_preference_management' ||
    feedback.project_id !== expectedProjectId ||
    context?.scope !== input.scope ||
    !matchesAction
  ) {
    throw new WritingPreferenceFeedbackError()
  }

  return feedback
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

export async function createManagedWritingProfileRevision(
  config: AppConfig,
  user: User,
  input: ManageWritingPreferenceRequest,
) {
  const projectId = input.scope === 'project' ? input.projectId ?? null : null
  if (projectId) await assertOwnedProject(config, user, projectId)

  const latest = await getLatestRevision(config, user, input.scope, projectId)
  if (!latest) throw new WritingPreferenceNotFoundError()
  if (latest.id !== input.expectedRevisionId || latest.version !== input.expectedVersion) {
    throw new WritingProfileVersionConflictError(latest)
  }

  const feedback = await getPreferenceFeedback(config, user, input)
  if (latest.evidenceIds.includes(feedback.id)) {
    throw new WritingPreferenceFeedbackError()
  }
  const profile = applyWritingPreferenceAction(latest.profile, {
    preferenceId: input.preferenceId,
    action: input.action,
    content: feedback.content,
    feedbackMemoryId: feedback.id,
  })
  const supabase = getAdminClient(config)
  const { data, error } = await supabase
    .from('writing_profile_revisions')
    .insert({
      user_id: user.id,
      scope: input.scope,
      project_id: projectId,
      version: latest.version + 1,
      profile,
      evidence_ids: Array.from(new Set([...latest.evidenceIds, feedback.id])),
      skill_id: latest.skill.id,
      skill_version: latest.skill.version,
      prompt_hash: latest.skill.promptHash,
    })
    .select(revisionColumns)
    .single()

  if (error?.code === '23505') {
    const currentRevision = await getLatestRevision(config, user, input.scope, projectId)
    throw new WritingProfileVersionConflictError(currentRevision ?? latest)
  }
  assertNoDatabaseError(error)
  return toRevisionDto(data as WritingProfileRevisionRow)
}
