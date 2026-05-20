# OpenZeroCode Context

## Ubiquitous Language

- **Build mode**: the agent should inspect the codebase and make requested changes directly instead of only proposing them.
- **Plan mode**: the agent should explain approach and risks only; no tools and no file changes.
- **Workspace memory**: repo-scoped instructions loaded from `AGENTS.md` and injected into the system prompt.
- **Session summary**: a continuation artifact in `SESSION_SUMMARY.md`; useful for handoff, but not part of the stable v1 automatic memory flow.
- **Provider-facing tests**: integration-style tests that may require auth env vars and are not safe as a default smoke test.
- **Targeted verification**: the smallest relevant checks for the touched area, typically `npm run typecheck` and one or more `npx tsx --test <file>` runs.

## Repo-Specific Workflow Heuristics

- Prefer executable truth over prose. If docs disagree with scripts or source, trust code first and then update docs.
- Start TUI/runtime investigations from `src/client/tui.tsx`.
- For workspace memory behavior, inspect `src/client/workspace-memory.ts` and verify with `src/client/workspace-memory.test.ts`.
- Avoid using `npm test` as a default smoke test because some provider tests require environment configuration.
- Keep stable instructions in `AGENTS.md`; keep handoff notes concise in `SESSION_SUMMARY.md`.

## Memory Hygiene

- Keep stable instructions in `AGENTS.md`, not in `SESSION_SUMMARY.md`.
- Keep `CONTEXT.md` concise, factual, and useful for quick project orientation.
- Treat `SESSION_SUMMARY.md` as a continuation aid: recent changes, open follow-ups, and verification notes.
- If docs drift from code, update the docs to match the implemented prompt assembly behavior.

## Current Gaps / Known Mismatches

- Some downstream docs or assumptions may still describe older `SESSION_SUMMARY.md`-driven prompt behavior; the implemented path injects `AGENTS.md` and `CONTEXT.md` instead.
