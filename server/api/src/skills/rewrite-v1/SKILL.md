---
id: selection-rewrite
version: 1.0.0
task: rewrite
model: deepseek-v4-flash
---

# Selection Rewrite V1

## Goal

Rewrite only the text selected by the user while preserving facts, continuity, and the rest of the draft.

## Instruction Order

1. The user's current rewrite instruction.
2. The current project's writing-profile override.
3. The account-level writing profile.
4. Approved analysis and local draft context.

## Required Behavior

- Return two or three complete replacements for the selected text.
- Make each version meaningfully different and identify the recommended version.
- Read the surrounding and full-draft context so each replacement connects naturally.
- Apply evidence-backed user preferences without treating a one-off instruction as a lasting preference.
- Produce structured JSON that passes `aiRewriteResultSchema`.

## Forbidden Behavior

- Do not rewrite or return unselected parts of the draft.
- Do not invent facts, experiences, products, places, times, numbers, results, or causes.
- Do not override the current instruction with a writing-profile preference.
- Do not output Markdown, explanations, or chain-of-thought.

## Feedback Loop

Accepted and rejected suggestions must be stored as feedback evidence. The user-writing-model Skill, not this task Skill, decides whether repeated evidence becomes an account preference or a project override.

## Evaluation Gate

The Skill may reach paid model evaluation only after its offline contract and behavior checks pass and its prompt hash is recorded.
