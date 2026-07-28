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
}

export function isSameDraftCopy(first: DraftCopy, second: DraftCopy) {
  return (
    first.title === second.title &&
    first.body.length === second.body.length &&
    first.body.every((paragraph, index) => paragraph === second.body[index])
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
    typeof candidate.updatedAt === 'string'
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
): DraftVersionRecord {
  return {
    id: crypto.randomUUID(),
    version,
    title: draft.title,
    body: [...draft.body],
    source,
    createdAt: timestamp,
    updatedAt: timestamp,
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
}) {
  const timestamp = new Date().toISOString()
  let versions = ensureBaseDraftVersion(input.versions, input.baseDraft, timestamp)
  const latest = versions[versions.length - 1]

  if (!input.force && latest && isSameDraftCopy(latest, input.nextDraft)) {
    return versions
  }

  if (input.coalesce && latest?.source === input.source) {
    const nextLatest: DraftVersionRecord = {
      ...latest,
      title: input.nextDraft.title,
      body: [...input.nextDraft.body],
      updatedAt: timestamp,
    }
    return [...versions.slice(0, -1), nextLatest]
  }

  const nextVersion = Math.max(0, ...versions.map((version) => version.version)) + 1
  versions = [
    ...versions,
    createDraftVersion(input.nextDraft, input.source, nextVersion, timestamp),
  ]
  return versions
}
