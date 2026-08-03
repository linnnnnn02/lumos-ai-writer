---
id: xiaohongshu-draft
version: 1.9.1
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

- Follow the paragraph and character range for the selected length without padding a finished idea into extra paragraphs.
- Keep the regular character bands aligned with `XHS_LENGTH_COPY_GUIDE.md`: short 40-200, medium 201-600, and long 601-1000. For a short brief with at most two required facts, use the 12-96 character sparse band and prefer one paragraph. When the brief explicitly asks for an ultra-short, single-sentence, or one-line caption, use the 12-72 character ultra-short band and prefer one paragraph.
- Read the exact per-request limits from `input.outputRequirements`, draft toward its preferred paragraph count and per-paragraph range, and silently self-check the hard totals before returning JSON.
- Before model execution, check factual sufficiency for product education, campaign interaction, and event announcements. Return structured missing questions instead of drafting when identity, evidence, rules, time, or participation details are absent.
- Allow bypassing the sufficiency gate only when the user explicitly chooses a conservative draft based on the currently confirmed information.
- If a candidate misses the output contract, leaks writing metadata, reuses reference wording, or fails grounding review, run at most two constrained repairs and combine all calls in usage accounting.
- Keep the title specific, restrained, and consistent with the body.
- Build one clear progression across complete paragraphs.
- Treat highlights as evidence for a mechanism, not a phrase bank. The draft input receives the user's reason and label without repeating the highlighted sentence in the strongest prompt position.
- Reject unrequested continuous reference overlap and exact reuse of short annotated clauses, then repair it before returning a draft.
- Treat explicit must-include text as required information by default, not permission to copy a reference sentence verbatim.
- Keep sentence-like analysis suggestions out of the draft prompt; pass only the learned user preference and explicit pitfalls.
- Consume full reference copy only in the analysis stage. The drafting prompt receives source provenance and annotation reasons, while full notes remain available only for output reuse validation.
- Treat `topic` and `brief` as the complete factual boundary of the new draft; reference-scene facts do not transfer automatically.
- Reduce annotations to evidence count and label names at drafting time; do not pass source sentences, note titles, or annotation reasons back into generation.
- Reintroduce only a structured, fact-free `surfaceStyle` capsule so sentence rhythm, punctuation, interaction placement, and intentional soft line breaks can transfer without reference content.
- Allow a short draft to use one multiline body block when its internal soft line breaks carry the intended display rhythm.
- When same-mode style evidence explicitly prefers line-by-line rhythm, preserve that rhythm with internal soft line breaks instead of flattening every paragraph into prose.
- Accept atomic `brief.facts` with a `required` flag. Required facts must be covered semantically, but they do not each require a separate sentence or explanation; optional facts may support the copy without taking over its main line. Preserve every used fact's subject, relation, sequence, time, and status during drafting and repair.
- When source facts or atomic facts are present, audit every concrete assertion as input-supported, input-contradicted, or input-unknown. Remove or ground contradicted and unknown claims without inventing replacements.
- Treat effect words inside a product name as part of the name only. A combination relationship does not imply usage order, mechanism, multiplied effect, or any additional benefit.
- Preserve temporal wording precisely during grounding and repair; do not interchange morning, afternoon, evening, or early-morning time periods for fluency.
- Keep production metadata such as cover, image, brief, reference, annotation, and fact-list field names out of reader-facing copy unless the topic explicitly discusses them.
- When product facts are sparse, do not replace them with visual composition, occlusion, label readability, static-state descriptions, or generic care language. Omit optional visual facts unless the brief explicitly asks for image-led storytelling and they advance the required line.
- Missing product information is not reader-facing copy. Do not turn it into “unknown benefit”, “hard-to-read label”, “waiting to be explored”, or teaser language unless the brief explicitly requests a reveal; a seasonal condition alone does not prove skin discomfort or a care need.
- If a sparse brief's required facts are already covered by the topic, the body may end after one direct restatement of that known relationship. Repetition is preferable to an invented optional visual, reader state, or product claim.
- Apply evidence-backed vocabulary, sentence rhythm, punctuation, emotional intensity, and forbidden patterns from the writing profile.
- Apply a writing-profile preference only when its stated content-mode and brief conditions match the current resolved mode; account scope alone does not make it universal.
- Resolve the current content mode from the explicit brief first and the analysis classification second. Use only references compatible with that mode.
- In `auto` mode, infer strong campaign, event, product-education, or brand-story signals from the completed brief before falling back to the earlier topic-only analysis.
- When the completed brief changes the target mode after analysis, discard the old target's guidance and `surfaceStyle`, then reselect references whose own primary mode matches the resolved mode. Retain explicit cross-mode voice signals as account-level evidence.
- Treat stable voice signals as account-level wording conventions only. Prefer one natural use of a verified account self-name or reader address, but never import a referenced product, event, scene, or action as a current fact.
- Prefer concrete information and natural stopping points over symmetrical structure, forced colloquialism, or a generic concluding summary.
- Produce structured JSON that passes `aiDraftCopySchema`.

## Forbidden Behavior

- Do not copy reference sentences or transfer the reference author's experience to the user.
- Do not concatenate the most atmospheric sentence from each selected note.
- Do not invent products, measurements, results, personal history, or numerical claims.
- Do not output section labels, writing explanations, Markdown, or chain-of-thought.
- Do not mention the writing input, its cover or image fields, references, annotations, or fact lists in reader-facing copy.
- Do not average brand stories, product education, campaign interaction, event announcements, and social moments into one generic account style.
- Do not import a mode-specific account habit merely because it appears in the long-lived account profile.
- Do not add forced engagement requests or generic motivational conclusions.
- Do not loop or make more than two repair attempts.

## Evaluation Gate

The Skill may reach paid model evaluation only after its offline contract check passes and its prompt hash is recorded.
