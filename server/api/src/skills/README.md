# Application Skills

These are versioned AI work-rule packages used by the Lumos backend. They are not a substitute for user memory or project history.

Each production Skill must provide:

- A stable ID and semantic version.
- A typed input and Zod output schema.
- Model parameters and a deterministic user-prompt template identifier.
- A SHA-256 prompt hash written to `ai_runs`.
- Offline fixtures and contract evaluation before paid model calls.

Changing instructions, model parameters, or the user-prompt template requires a version bump.

## Skill hierarchy

`user-writing-model` is the core learning Skill. It turns library reasons, repeated material patterns, rewrite instructions, manual edits, accepted or rejected rewrites, and final choices into an evidence-backed account profile plus optional project overrides.

Task Skills such as `reference-analysis`, `xiaohongshu-draft`, rewrite, and `target-reader-preview` are consumers of that model. They must not independently invent a user style or promote a one-off project instruction into a long-term preference.

Evidence priority is:

1. Explicit profile correction.
2. Manual edit and accepted or rejected rewrite.
3. Final chosen draft.
4. Rewrite instruction.
5. Snippet reason and label.
6. Repeated library pattern.
