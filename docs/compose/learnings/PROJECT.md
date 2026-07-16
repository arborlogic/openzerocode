# Project Learnings

Non-obvious discoveries about the OpenZeroCode codebase, extracted from sessions.

---

## [2026-07-13] Effect Gen requires explicit type casts for decoded schemas

**Scope:** project
**Confidence:** high
**Tags:** effect, schema, typescript

### Observation
When using `Schema.decodeUnknownEffect` in Effect generators, the decoded value needs an explicit type cast (`as Effect.Effect<T>`) even though the schema defines the type. Without it, TypeScript infers `unknown`.

### Evidence
In `src/tool/learn-memory.ts:38`, `yield* decode(raw)` returns `unknown` without the cast. The pattern `yield* decode(raw) as Effect.Effect<Args>` is required.

### Implication
Always add the type cast after `yield* decode(raw)` in Effect generators. This is a known Effect quirk, not a bug in our code.

## [2026-07-13] Compose mode replaces Learn mode rather than adding another restricted mode

**Scope:** project
**Confidence:** high

### Observation
OpenZeroCode's Compose integration is modeled as a first-class run mode (`build | plan | compose`) that replaces the old `learn` mode. Unlike the removed Learn mode, Compose mode does not restrict the tool list to read/search/memory tools; only Plan mode disables tools entirely.

### Evidence
`src/client/session-runner.ts` changed `RunMode` from `"build" | "plan" | "learn"` to `"build" | "plan" | "compose"` and removed the `learnToolIds` filtering branch. `src/client/session-runner.test.ts` was updated from asserting a Learn-mode restricted tool subset to asserting normal tool exposure outside Plan mode. `/mode learn` was replaced by `/mode compose` in `src/client/commands.ts` and tests.

### Implication
Future mode-related changes must not assume Compose is a read-only learning mode. If a Compose skill needs write/bash/browser tools, they are available unless another layer disables them; safety is governed by the loaded skill instructions and general tool policy, not by session-runner tool filtering.

## [2026-07-13] Compose prompt content is loaded dynamically from workspace files

**Scope:** project
**Confidence:** high

### Observation
The Compose system prompt is not only hard-coded guidance. It dynamically appends skill definitions from `skills/compose/*/SKILL.md` and project learnings from `docs/compose/learnings/*.md` at prompt construction time, stripping YAML frontmatter from skills before injection.

### Evidence
`src/client/system-prompt.ts` added `loadComposeSkills(cwd)`, `splitFrontmatter(raw)`, `buildComposeSkillsSection(cwd)`, and `buildLearningsSection(cwd)`. These functions use the session `cwd`, read `SKILL.md` files under `skills/compose`, parse frontmatter with `yaml`, and concatenate markdown learning files under `docs/compose/learnings` into a `# Project Learnings (auto-loaded)` section.

### Implication
When adding or modifying Compose behavior, update the files under `skills/compose/` and `docs/compose/learnings/` rather than only editing hard-coded prompt text. Tests for prompt behavior should create fixture directories/files or assert dynamic sections using a controlled `cwd`, because the runtime prompt depends on workspace contents.

## [2026-07-13] Compose learnings live under docs/compose rather than legacy memory tools

**Scope:** project
**Confidence:** medium

### Observation
Project learning extraction for Compose is file-based and targets `docs/compose/learnings/PROJECT.md`; the previous `learn_memory_apply` and `learn_project_memory_apply` tool workflow is deprecated in the Compose instructions.

### Evidence
`AGENTS.md` now says Compose mode should load learnings from `docs/compose/learnings/*.md`, trigger `compose:learn` after verify/debug discoveries, and that `learn_memory_apply` / `learn_project_memory_apply` are deprecated. The current project learning artifact exists at `docs/compose/learnings/PROJECT.md` and is auto-loaded by `buildLearningsSection(cwd)` in Compose mode.

### Implication
Future agents should persist project-specific session discoveries by editing `docs/compose/learnings/PROJECT.md` directly in compose:learn format. Do not add new project lessons to `DEVELOPMENT.md` or depend on removed Learn-memory tools unless maintaining legacy behavior explicitly.
