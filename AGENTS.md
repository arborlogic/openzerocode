# AGENTS.md

## Working Style
- Keep guidance here high-signal and repo-specific; if a fact is obvious from filenames or standard framework defaults, leave it out.
- Prefer executable truth over prose. If README or docs disagree with scripts or code, follow the code and update docs separately.

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
- Current memory phase is working-memory-first: load `AGENTS.md`, maintain `SESSION_SUMMARY.md`, and support session continuation.
- Do not expand the local runtime into long-term rule promotion in this phase; anything beyond working handoff belongs to future `zero` integration.
- Workspace memory code lives in `src/client/workspace-memory.ts` and `src/client/workspace-summary.ts`.

## Testing Notes
- When changing workspace memory behavior, verify with `src/client/workspace-memory.test.ts` and `src/client/workspace-summary.test.ts`.
- Provider-facing tests are integration-style and should only be run when you intentionally want provider validation and have the required env configured.

## Current Product Boundary
- OpenZeroCode should remain usable without `zero`.
- `AGENTS.md` is treated as a stable instruction source, not an auto-managed long-term memory store.
- `SESSION_SUMMARY.md` is the local handoff artifact and should stay concise, continuation-oriented, and repo-specific.
