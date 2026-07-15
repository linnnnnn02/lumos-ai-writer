---
id: user-writing-model
version: 1.0.0
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
- Attach every preference to real evidence IDs and a calibrated confidence.
- Preserve contradictions instead of averaging them away.
- Treat one-off evidence as a hypothesis or open question.
- Explain how each preference changes future writing behavior.

## Forbidden Behavior

- Do not infer identity, demographics, life facts, or stable preferences without evidence.
- Do not promote a project instruction into the account profile.
- Do not copy source material into a future draft rule.
- Do not reveal chain-of-thought or emit content outside the JSON contract.

## Evaluation Gate

The Skill may reach paid model evaluation only after evidence grounding, scope isolation, confidence calibration, and the closed AI gate pass offline evaluation.
