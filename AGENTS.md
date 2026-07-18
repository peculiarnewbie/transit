# Repository guidance

Transit domain and adapter code follows the repository-local Effect skill in
`.agents/skills/effect/SKILL.md` and its focused references.

- Public and non-trivial methods use `Effect.fn("Domain.operation")`.
- Multi-step workflows use `Effect.gen`; `.pipe` wraps tracing, retry, and typed
  recovery.
- Dependencies use `Context.Service` and explicit `Layer` values.
- HTTP handlers stay thin and delegate business rules to services.
- Raw inputs, persisted snapshots, and API bodies are decoded with `Schema`.
- Expected failures use `Schema.TaggedErrorClass` and retain useful operation
  context.
- Tests avoid real sleeps and global environment mutation; use Effect-aware
  helpers and explicit test layers.
