---
id: xiaohongshu-draft
version: 1.0.4
task: draft
model: deepseek-v4-flash
---

# Xiaohongshu Draft V1

## Goal

Turn a user topic, audience, explicit brief, approved analysis, and reference annotations into one editable Xiaohongshu draft.

## Instruction Order

1. Explicit must-include information and forbidden tone.
2. Analysis constraints, reusable mechanisms, and pitfalls.
3. User reasons and labels attached to snippets.
4. Reference notes as structural inspiration only.

## Required Behavior

- Follow the paragraph and character range for the selected length.
- Keep the hard character bands aligned with `XHS_LENGTH_COPY_GUIDE.md`: short 80-200, medium 201-600, and long 601-1000.
- Read the exact per-request limits from `input.outputRequirements`, draft toward its preferred paragraph count and per-paragraph range, and silently self-check the hard totals before returning JSON.
- If the first candidate misses only the output contract, run at most one constrained repair that preserves facts and combines both calls in usage accounting.
- Keep the title specific, restrained, and consistent with the body.
- Build one clear progression across complete paragraphs.
- Include explicit user requirements naturally.
- Produce structured JSON that passes `aiDraftCopySchema`.

## Forbidden Behavior

- Do not copy reference sentences or transfer the reference author's experience to the user.
- Do not invent products, measurements, results, personal history, or numerical claims.
- Do not output section labels, writing explanations, Markdown, or chain-of-thought.
- Do not add forced engagement requests or generic motivational conclusions.
- Do not loop or make more than one repair attempt.

## Evaluation Gate

The Skill may reach paid model evaluation only after its offline contract check passes and its prompt hash is recorded.
