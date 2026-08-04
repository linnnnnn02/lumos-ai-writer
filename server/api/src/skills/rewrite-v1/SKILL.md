---
id: selection-rewrite
version: 1.2.0
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
- Preserve the user's learned vocabulary, sentence rhythm, punctuation, emotional intensity, and forbidden patterns when they do not conflict with the current instruction.
- Remove template-like transitions and repeated conclusions instead of replacing them with different generic language.
- Treat the input as a closed-world fact set; every concrete detail in a suggestion must be traceable to the selection, context, draft, or analysis.
- Produce structured JSON that passes `aiRewriteResultSchema`.
- Keep summaries, labels, replacement text, and rationales within the compact output limits supplied in the request.
- If grounding validation fails, make at most two repair attempts using the exact latest validation error and aggregate all calls in usage accounting.
- Reject unsupported material terms as well as unsupported numeric claims before returning suggestions.

## Forbidden Behavior

- Do not rewrite or return unselected parts of the draft.
- Do not invent facts, experiences, products, places, times, numbers, results, or causes.
- Do not provide fictional examples when the user asks for specificity; ask for missing information or stay within grounded details.
- Do not treat common lifestyle details as harmless implications when the evidence does not contain them.
- Do not override the current instruction with a writing-profile preference.
- Do not output Markdown, explanations, or chain-of-thought.
- Do not loop or make more than two grounding repair attempts.

## Feedback Loop

Accepted and rejected suggestions must be stored as feedback evidence. The user-writing-model Skill, not this task Skill, decides whether repeated evidence becomes an account preference or a project override.

## Evaluation Gate

The Skill may reach paid model evaluation only after its offline contract and behavior checks pass and its prompt hash is recorded.
