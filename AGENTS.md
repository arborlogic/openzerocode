# AGENTS.md

## Working Style
- Keep guidance here high-signal and repo-specific; if a fact is obvious from filenames or standard framework defaults, leave it out.
- Prefer executable truth over prose. If README or docs disagree with scripts or code, follow the code and update docs separately.
- In Build mode, default to inspecting the repo and making the requested change immediately. Bias strongly toward action over discussion.
- Do not ask for confirmation when the user is asking for an implementation, edit, fix, refactor, cleanup, or optimization that can be done safely in-workspace; make the best reasonable repo-local choice and proceed.
- Before changing files, give a brief one-line note about what you are about to do; then do the work.
- If the request is ambiguous but there is a clear best-effort repo-local interpretation, proceed on that interpretation, state the assumption briefly, and avoid blocking on clarification.
- When the next useful step is to inspect code, run a command, edit a file, or verify a change, do it first unless the user explicitly asked only for analysis or a plan.
- After changes, report what was changed, which files were touched, and what verification was run.

## Key Commands
- Run the TUI with `npm run start`.
- Use `npm run dev` for watch-mode TUI development.
- Run typecheck with `npm run typecheck` after code changes.
- Use targeted tests with `npx tsx --test <file>` for local verification.
- `npm test` is not a safe default smoke test here: `src/provider/provider.test.ts` and `src/core/core.test.ts` require provider env such as `OPENCODE_API` or `OPENCODE_API_KEY`.

## Architecture
- Main UI/runtime entrypoint is `src/client/tui.tsx`; start there for transcript rendering, command handling, session orchestration, and workspace memory injection.
- Provider registry lives in `src/provider/registry.ts`; provider implementations are under `src/provider/`.
- Built-in tool registration lives in `src/tool/registry.ts`; tool behavior is organized under `src/tool/`.
- Session persistence is local under `~/.openzerocode/sessions`; session metadata helpers live in `src/client/sessions.ts`.

## Memory Scope
- Current prompt assembly loads both `AGENTS.md` and `CONTEXT.md` via `src/client/workspace-memory.ts` and injects them into the system prompt.
- Use `AGENTS.md` for stable repo-specific instructions and workflow rules; keep it high-signal.
- Use `CONTEXT.md` for project background, vocabulary, workflow heuristics, and known mismatches that help the agent orient quickly.
- `SESSION_SUMMARY.md` is a manual/local handoff artifact for continuation, not part of the automatic prompt assembly path.
- Do not expand the local runtime into long-term rule promotion in this phase; anything beyond working handoff belongs to future `zero` integration.

## Testing Notes
- When changing workspace memory or prompt assembly behavior, verify with `src/client/workspace-memory.test.ts` and the most relevant prompt-related tests.
- Provider-facing tests are integration-style and should only be run when you intentionally want provider validation and have the required env configured.

## Current Product Boundary
- OpenZeroCode should remain usable without `zero`.
- `AGENTS.md` is a stable instruction source, not an auto-managed long-term memory store.
- `CONTEXT.md` is for concise workspace context, not policy that should override executable repo truth.
- `SESSION_SUMMARY.md` should stay concise, continuation-oriented, and repo-specific.

## Compose Integration: Learnings
- When running in Compose mode, load project learnings from `docs/compose/learnings/*.md` during the brainstorm "Explore project context" step.
- After `compose:verify` fails or `compose:debug` finds a root cause, trigger `compose:learn` to extract the discovery.
- Learnings follow the format in `.mimocode/skills/learn/SKILL.md`.
- The old `learn_memory_apply` and `learn_project_memory_apply` tools are deprecated; use `compose:learn` skill instead.
