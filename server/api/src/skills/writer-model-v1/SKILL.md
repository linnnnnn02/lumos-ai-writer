---
id: user-writing-model
version: 1.2.0
task: profile-learn
model: deepseek-v4-flash
---

# User Writing Model V1

## Goal

Learn why a user values selected library material and how the user changes drafts, then maintain an evidence-backed model of the user's writing decisions.

## Evidence Order

1. Explicit profile correction.
2. Final manual edit.
3. Accepted or rejected rewrite.
4. Final chosen draft.
5. Rewrite instruction.
6. Snippet reason.
7. Snippet label.
8. Repeated library pattern.

## Required Behavior

- Infer reusable decisions, not copied phrases.
- Keep account preferences separate from project-only requirements.
- Treat account scope as persistence, not universal applicability across content modes.
- State the applicable content mode and trigger in `application` when evidence comes from only one mode.
- Promote a preference to a cross-mode default only with evidence from at least two distinct modes or an explicit profile correction.
- Attach every preference to real evidence IDs and a calibrated confidence.
- Preserve contradictions instead of averaging them away.
- Treat one-off evidence as a hypothesis or open question.
- Explain how each preference changes future writing behavior.
- Learn directional changes in vocabulary, forbidden phrases, sentence rhythm, punctuation, emotional intensity, and certainty when the evidence supports them.
- Separate reusable style edits from factual corrections, typo fixes, length compliance, and one-off task requirements.
- Preserve the before-to-after direction of an edit instead of treating both forms as preferred examples.

## Forbidden Behavior

- Do not infer identity, demographics, life facts, or stable preferences without evidence.
- Do not promote a project instruction into the account profile.
- Do not average brand stories, product education, campaign interaction, event announcements, and social moments into one account voice.
- Do not copy source material into a future draft rule.
- Do not reveal chain-of-thought or emit content outside the JSON contract.
- Do not summarize a preference as merely "natural", "human", or "more conversational" without naming the observable language decision.

## Evaluation Gate

The Skill may reach paid model evaluation only after evidence grounding, scope isolation, confidence calibration, and the closed AI gate pass offline evaluation.
