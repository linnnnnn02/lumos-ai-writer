import {
  appliedWritingProfileContextSchema,
  draftQualitySnapshotSchema,
  type AppliedWritingProfileContext,
  type DraftQualitySnapshot,
} from '@lumos-ai/shared'

export type DraftCopy = {
  title: string
  body: string[]
}

export type DraftCompletionSnapshot = {
  finalizedAt: string
}

export type DraftVersionRecord = DraftCopy & {
  id: string
  version: number
  source: string
  createdAt: string
  updatedAt: string
  appliedWritingProfile?: AppliedWritingProfileContext
  completionSnapshot?: DraftCompletionSnapshot
  qualitySnapshot?: DraftQualitySnapshot
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

export function isDraftCompletionSnapshot(
  value: unknown,
): value is DraftCompletionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const finalizedAt = (value as Record<string, unknown>).finalizedAt
  return (
    typeof finalizedAt === 'string' &&
    finalizedAt.length > 0 &&
    !Number.isNaN(Date.parse(finalizedAt))
  )
}

export function markDraftVersionFinalized(
  versions: DraftVersionRecord[],
  versionId: string,
  finalizedAt: string,
) {
  if (!versionId || Number.isNaN(Date.parse(finalizedAt))) return versions

  let changed = false
  const nextVersions = versions.map((version) => {
    if (version.id !== versionId) return version
    if (version.completionSnapshot?.finalizedAt === finalizedAt) return version

    changed = true
    return {
      ...version,
      completionSnapshot: { finalizedAt },
    }
  })

  return changed ? nextVersions : versions
}

export function recheckDraftQualitySnapshot(
  snapshot: DraftQualitySnapshot | null | undefined,
  draft: DraftCopy,
  checkedAt = new Date().toISOString(),
): DraftQualitySnapshot | undefined {
  if (!snapshot) return undefined

  const checks: DraftQualitySnapshot['checks'] = snapshot.checks.map((check) => {
    if (check.id === 'length' && check.expected) {
      const bodyCharacters = Array.from(draft.body.join('').replace(/\s/g, '')).length
      const paragraphs = draft.body.length
      const passed =
        bodyCharacters >= check.expected.minBodyCharacters &&
        bodyCharacters <= check.expected.maxBodyCharacters &&
        paragraphs >= check.expected.minParagraphs &&
        paragraphs <= check.expected.maxParagraphs

      return {
        ...check,
        status: passed ? 'passed' : 'failed',
        summary: passed
          ? `正文 ${bodyCharacters} 字、${paragraphs} 段，符合当前篇幅要求。`
          : `正文 ${bodyCharacters} 字、${paragraphs} 段，不符合当前篇幅要求。`,
        details: [],
        actual: { bodyCharacters, paragraphs },
      }
    }

    if (check.status === 'not_applicable') return check

    return {
      ...check,
      status: 'needs_review',
      summary:
        check.id === 'required_facts'
          ? '正文已修改，需要重新确认必含事实是否仍完整。'
          : check.id === 'expression_boundaries'
            ? '正文已修改，需要重新确认是否仍遵守表达边界。'
            : '正文已修改，需要重新确认新增或改写的事实是否有依据。',
      details: [],
    }
  })

  return {
    overallStatus: checks.some((check) => check.status === 'failed')
      ? 'failed'
      : checks.some((check) => check.status === 'needs_review')
        ? 'needs_review'
        : 'passed',
    checkedAt,
    checks,
  }
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
      appliedWritingProfileContextSchema.safeParse(candidate.appliedWritingProfile).success) &&
    (candidate.completionSnapshot === undefined ||
      isDraftCompletionSnapshot(candidate.completionSnapshot)) &&
    (candidate.qualitySnapshot === undefined ||
      draftQualitySnapshotSchema.safeParse(candidate.qualitySnapshot).success)
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
  qualitySnapshot?: DraftQualitySnapshot,
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
    ...(qualitySnapshot ? { qualitySnapshot } : {}),
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
  qualitySnapshot?: DraftQualitySnapshot | null
}) {
  const timestamp = new Date().toISOString()
  let versions = ensureBaseDraftVersion(input.versions, input.baseDraft, timestamp)
  const latest = versions[versions.length - 1]
  const appliedWritingProfile =
    input.appliedWritingProfile === null
      ? undefined
      : input.appliedWritingProfile ?? latest?.appliedWritingProfile
  const qualitySnapshot =
    input.qualitySnapshot === null
      ? undefined
      : input.qualitySnapshot ??
        recheckDraftQualitySnapshot(latest?.qualitySnapshot, input.nextDraft, timestamp)

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
      ...(qualitySnapshot ? { qualitySnapshot } : {}),
    }
    if (!appliedWritingProfile) delete nextLatest.appliedWritingProfile
    delete nextLatest.completionSnapshot
    if (!qualitySnapshot) delete nextLatest.qualitySnapshot
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
      qualitySnapshot,
    ),
  ]
  return versions
}
