import type {
  AiContentMode,
  AppliedWritingProfileContext,
  AppliedWritingProfileRevision,
  WritingPreference,
  WritingProfileRevisionDto,
} from '@lumos-ai/shared'

function isPreferenceApplicable(
  preference: WritingPreference,
  contentMode: AiContentMode,
) {
  if (preference.status !== 'active') return false
  if (preference.contentModes.length === 0) return true
  return preference.contentModes.includes(contentMode)
}

export function getAppliedWritingProfileRevision(
  revision: WritingProfileRevisionDto | null | undefined,
  contentMode: AiContentMode,
): AppliedWritingProfileRevision | null {
  if (!revision) return null

  const preferences = revision.profile.preferences.filter((preference) =>
    isPreferenceApplicable(preference, contentMode),
  )
  if (preferences.length === 0) return null

  return {
    revisionId: revision.id,
    version: revision.version,
    scope: revision.scope,
    preferences: preferences.map((preference) => ({
      id: preference.id,
      scope: preference.scope,
      dimension: preference.dimension,
      statement: preference.statement,
    })),
  }
}

export function getAppliedWritingProfileContext(
  context:
    | {
        accountProfile: WritingProfileRevisionDto | null
        projectProfile: WritingProfileRevisionDto | null
      }
    | null
    | undefined,
  contentMode: AiContentMode,
): AppliedWritingProfileContext {
  return {
    account: getAppliedWritingProfileRevision(context?.accountProfile, contentMode),
    project: getAppliedWritingProfileRevision(context?.projectProfile, contentMode),
  }
}

export function compactActiveWritingProfile(
  revision: WritingProfileRevisionDto | null | undefined,
  contentMode: AiContentMode,
) {
  if (!revision) return null

  const preferences = revision.profile.preferences.filter((preference) =>
    isPreferenceApplicable(preference, contentMode),
  )
  if (preferences.length === 0) return null

  const statements = preferences.map((preference) => preference.statement)
  const applications = preferences.map((preference) => preference.application)
  const avoidRules = preferences
    .map((preference) => preference.avoid.trim())
    .filter(Boolean)

  return {
    version: revision.version,
    summary: statements.join('；'),
    decisionPrinciples: applications,
    mustKeep: statements,
    mustAvoid: avoidRules,
    preferences: preferences.map((preference) => ({
      dimension: preference.dimension,
      statement: preference.statement,
      application: preference.application,
      avoid: preference.avoid,
      confidence: preference.confidence,
      contentModes: preference.contentModes,
    })),
  }
}
