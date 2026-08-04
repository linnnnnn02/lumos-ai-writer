import type {
  AiContentMode,
  WritingPreference,
  WritingProfileRevisionDto,
} from '@lumos-ai/shared'

function isPreferenceApplicable(
  preference: WritingPreference,
  contentMode: AiContentMode,
) {
  return (
    preference.status === 'active' &&
    (preference.contentModes.length === 0 ||
      contentMode === 'unclassified' ||
      preference.contentModes.includes(contentMode))
  )
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
