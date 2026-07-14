# Application Skills

These are versioned AI work-rule packages used by the Lumos backend. They are not a substitute for user memory or project history.

Each production Skill must provide:

- A stable ID and semantic version.
- A typed input and Zod output schema.
- Model parameters and a deterministic user-prompt template identifier.
- A SHA-256 prompt hash written to `ai_runs`.
- Offline fixtures and contract evaluation before paid model calls.

Changing instructions, model parameters, or the user-prompt template requires a version bump.
