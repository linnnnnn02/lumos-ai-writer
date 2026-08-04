---
id: reference-analysis
version: 1.3.2
task: analyze
model: deepseek-v4-flash
---

# Reference Analysis V1

## Goal

Turn selected reference notes, highlighted snippets, labels, and user reasons into reusable writing decisions for the next draft.

## Evidence Order

1. User reason for saving a snippet.
2. User label or color tag.
3. Exact highlighted text.
4. Full reference note.

## Required Behavior

- Lead with a concrete judgement, not an explanation of the analysis process.
- Classify the target as brand story, product education, campaign interaction, event announcement, social moment, or other before learning style.
- Put every reference into either the compatible set or the excluded set. Topic similarity and shared authorship do not make two content modes compatible.
- Output each reference's own primary mode. Only an exact target/reference mode match may enter the compatible set; cross-mode rhythm or punctuation belongs in stable voice signals only.
- Derive mode-specific structure, interaction, and `surfaceStyle` only from compatible references. Keep an account-level voice signal only when it repeats in at least two references spanning at least two distinct content modes; a single use of “你”, short lines, personification, or interaction is not stable evidence.
- Separate reusable writing mechanisms from facts that must not be copied.
- Keep opening, middle, and ending patterns in that order.
- Quote only snippets that exist in the input and retain their source.
- Keep exact quotes inside `featuredSnippets` for traceability; turn them into mechanisms everywhere else.
- Select one factual spine for the next draft instead of treating every highlight as required content.
- Describe executable moves without supplying a finished sample sentence or lightly altered reference sentence.
- Keep reference facts out of the recommendation when they do not serve the current topic's factual spine.
- Keep missing materials, objects, actions, people, and scene details unknown; do not turn keywords into visible objects without evidence.
- Produce a fact-free `surfaceStyle` capsule covering sentence rhythm, paragraph and soft-line-break shape, punctuation, emotional intensity, and interaction placement.
- Treat weak or single-sample preferences as hypotheses to verify.
- Produce structured JSON that passes `aiAnalysisResultSchema`.

## Forbidden Behavior

- Do not invent quotes, sources, product facts, experiences, or user preferences.
- Do not use generic praise such as “高级”“自然”“有共鸣” without evidence.
- Do not copy a reference note as a new draft.
- Do not average product education, brand narrative, and campaign interaction into one account-wide writing mode.
- Do not reveal chain-of-thought or add text outside the JSON response.

## Evaluation Gate

The Skill may reach paid model evaluation only after the offline contract check passes and its prompt hash is recorded.
