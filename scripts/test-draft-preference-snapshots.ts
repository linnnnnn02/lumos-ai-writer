import assert from 'node:assert/strict'
import type { AppliedWritingProfileContext } from '@lumos-ai/shared'
import {
  evolveDraftVersions,
  getAppliedWritingPreferenceIds,
} from '../web/src/lib/draft-versions.js'

const appliedWritingProfile: AppliedWritingProfileContext = {
  account: {
    revisionId: '11111111-1111-4111-8111-111111111111',
    version: 2,
    scope: 'account',
    preferences: [
      {
        id: 'prefer-concrete-ending',
        scope: 'account',
        dimension: 'ending',
        statement: 'End on a concrete feeling without an extra summary.',
      },
    ],
  },
  project: null,
}

const generated = evolveDraftVersions({
  versions: [],
  nextDraft: { title: 'First', body: ['Generated body.'] },
  source: 'ai_generation',
  force: true,
  appliedWritingProfile,
})
assert.deepEqual(generated[0]?.appliedWritingProfile, appliedWritingProfile)
assert.deepEqual(getAppliedWritingPreferenceIds(appliedWritingProfile), [
  'prefer-concrete-ending',
])

const manuallyEdited = evolveDraftVersions({
  versions: generated,
  nextDraft: { title: 'First', body: ['Edited body.'] },
  source: 'manual_edit',
})
assert.deepEqual(manuallyEdited[1]?.appliedWritingProfile, appliedWritingProfile)

const restoredUnknown = evolveDraftVersions({
  versions: manuallyEdited,
  nextDraft: { title: 'Legacy', body: ['Legacy body.'] },
  source: 'restored',
  force: true,
  appliedWritingProfile: null,
})
assert.equal(restoredUnknown[2]?.appliedWritingProfile, undefined)

const restoredKnown = evolveDraftVersions({
  versions: restoredUnknown,
  nextDraft: { title: 'Known', body: ['Known body.'] },
  source: 'restored',
  force: true,
  appliedWritingProfile,
})
assert.deepEqual(restoredKnown[3]?.appliedWritingProfile, appliedWritingProfile)

console.log('draft preference snapshot lifecycle passed')
