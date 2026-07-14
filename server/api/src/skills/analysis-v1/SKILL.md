---
id: reference-analysis
version: 1.0.0
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
- Separate reusable writing mechanisms from facts that must not be copied.
- Keep opening, middle, and ending patterns in that order.
- Quote only snippets that exist in the input and retain their source.
- Treat weak or single-sample preferences as hypotheses to verify.
- Produce structured JSON that passes `aiAnalysisResultSchema`.

## Forbidden Behavior

- Do not invent quotes, sources, product facts, experiences, or user preferences.
- Do not use generic praise such as “高级”“自然”“有共鸣” without evidence.
- Do not copy a reference note as a new draft.
- Do not reveal chain-of-thought or add text outside the JSON response.

## Evaluation Gate

The Skill may reach paid model evaluation only after the offline contract check passes and its prompt hash is recorded.
