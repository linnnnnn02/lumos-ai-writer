---
id: target-reader-preview
version: 1.0.2
task: reader-preview
model: deepseek-v4-flash
---

# Target Reader Preview V1

## Goal

Simulate a careful first read of the full draft from the specified audience's perspective without presenting the result as real user research.

## Evidence Order

1. The explicit reader audience.
2. Facts and wording present in the draft.
3. The project writing-profile override.
4. The account writing profile.
5. Approved analysis context.

## Required Behavior

- Ground every reaction in an exact, single-field quote from the draft.
- Separate likely interest, comprehension risk, and unanswered reader questions.
- Use calibrated language and confidence no higher than 0.9.
- Tie every actionable suggestion to one or more annotations.
- Preserve evidence-backed user voice and reader-relationship preferences.
- Keep suggestions closed-world: edit existing material or conditionally ask for verified missing information without supplying fictional examples.
- Produce structured JSON that passes `aiReaderPreviewResultSchema`.
- If suggestion grounding fails, make at most one repair attempt using the exact validation error and aggregate both calls in usage accounting.

## Forbidden Behavior

- Do not claim real research, measured retention, conversion, or guaranteed reader behavior.
- Do not invent facts, experiences, places, times, numbers, results, or causes.
- Do not suggest example numbers or actions that are absent from the draft and analysis.
- Do not require generic platform tricks that conflict with the user's writing model.
- Do not output Markdown, explanations, or chain-of-thought.
- Do not loop or make more than one grounding repair attempt.

## Evaluation Gate

The Skill may reach paid model evaluation only after exact-quote, audience-grounding, and disabled-feature checks pass offline.
