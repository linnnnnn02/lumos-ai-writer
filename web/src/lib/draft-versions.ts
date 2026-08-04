import {
  appliedWritingProfileContextSchema,
  type AppliedWritingProfileContext,
} from '@lumos-ai/shared'

export type DraftCopy = {
  title: string
  body: string[]
}

export type DraftVersionRecord = DraftCopy & {
  id: string
  version: number
  source: string
  createdAt: string
  updatedAt: string
  appliedWritingProfile?: AppliedWritingProfileContext
}

export function isSameDraftCopy(first: DraftCopy, second: DraftCopy) {
  return (
    first.title === second.title &&
    first.body.length === second.body.length &&
    first.body.every((paragraph, index) => paragraph === second.body[index])
  )
}

export function getAppliedWritingPreferenceIds(
  context: AppliedWritingProfileContext | null | undefined,
) {
  return Array.from(
    new Set([
      ...(context?.account?.preferences.map((preference) => preference.id) ?? []),
      ...(context?.project?.preferences.map((preference) => preference.id) ?? []),
    ]),
  )
}

export function isDraftVersionRecord(value: unknown): value is DraftVersionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.version === 'number' &&
    Number.isInteger(candidate.version) &&
    candidate.version > 0 &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.body) &&
    candidate.body.every((paragraph) => typeof paragraph === 'string') &&
    typeof candidate.source === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    (candidate.appliedWritingProfile === undefined ||
      appliedWritingProfileContextSchema.safeParse(candidate.appliedWritingProfile).success)
  )
}

export function normalizeDraftVersions(value: unknown): DraftVersionRecord[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isDraftVersionRecord)
    .sort(
      (first, second) =>
        first.version - second.version ||
        Date.parse(first.createdAt) - Date.parse(second.createdAt),
    )
}

function createDraftVersion(
  draft: DraftCopy,
  source: string,
  version: number,
  timestamp = new Date().toISOString(),
  appliedWritingProfile?: AppliedWritingProfileContext,
): DraftVersionRecord {
  return {
    id: crypto.randomUUID(),
    version,
    title: draft.title,
    body: [...draft.body],
    source,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(appliedWritingProfile ? { appliedWritingProfile } : {}),
  }
}

export function ensureBaseDraftVersion(
  versions: DraftVersionRecord[],
  draft: DraftCopy | undefined,
  timestamp?: string,
) {
  if (versions.length > 0 || !draft) return versions
  return [createDraftVersion(draft, 'legacy_import', 1, timestamp)]
}

export function evolveDraftVersions(input: {
  versions: DraftVersionRecord[]
  nextDraft: DraftCopy
  source: string
  baseDraft?: DraftCopy
  coalesce?: boolean
  force?: boolean
  appliedWritingProfile?: AppliedWritingProfileContext | null
}) {
  const timestamp = new Date().toISOString()
  let versions = ensureBaseDraftVersion(input.versions, input.baseDraft, timestamp)
  const latest = versions[versions.length - 1]
  const appliedWritingProfile =
    input.appliedWritingProfile === null
      ? undefined
      : input.appliedWritingProfile ?? latest?.appliedWritingProfile

  if (!input.force && latest && isSameDraftCopy(latest, input.nextDraft)) {
    return versions
  }

  if (input.coalesce && latest?.source === input.source) {
    const nextLatest: DraftVersionRecord = {
      ...latest,
      title: input.nextDraft.title,
      body: [...input.nextDraft.body],
      updatedAt: timestamp,
      ...(appliedWritingProfile ? { appliedWritingProfile } : {}),
    }
    if (!appliedWritingProfile) delete nextLatest.appliedWritingProfile
    return [...versions.slice(0, -1), nextLatest]
  }

  const nextVersion = Math.max(0, ...versions.map((version) => version.version)) + 1
  versions = [
    ...versions,
    createDraftVersion(
      input.nextDraft,
      input.source,
      nextVersion,
      timestamp,
      appliedWritingProfile,
    ),
  ]
  return versions
}
