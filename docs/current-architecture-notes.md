# OpenZeroCode — Current Architecture Notes

> **Status: ✅ Stable — This document records the v1 implemented architecture.**

This document records the currently confirmed architecture state and directions to consider for the future. It does not present speculative proposals as established directions.

---

## Current Stable State

### Core Architecture

- **Active client entry**: `src/client/tui.tsx`
- **Runtime**: Bun with `@opentui/solid/preload`
- **Old readline client**: Removed, no longer an active code path
- **Agent loop**: `src/client/session-runner.ts` (`streamSession`) — see [agent-loop.md](agent-loop.md) for the turn execution model

### Session Persistence

Multi-session JSON structure (stable):

- `~/.openzerocode/sessions/index.json`
- `~/.openzerocode/sessions/<session-id>.json`
- Session JSON stores: messages, model, provider, mode, compaction, permissionRules, autoApprove

### Memory Policy (v1 ✅)

| Item | Status |
|------|--------|
| `AGENTS.md` loaded as workspace instruction | ✅ Implemented (`workspace-memory.ts`) |
| `SESSION_SUMMARY.md` not in automatic loop | ✅ No auto read/write |
| Compaction summary stored in session JSON | ✅ Not written to repo files |
| Context budget auto-triggers compaction | ✅ 60% default threshold (user configurable) |

See [memory-architecture.md](memory-architecture.md) for detailed design.

### Provider Layer

Registry structure (stable):

- `opencode-zen` — OpenCode Zen (Big Pickle); anonymous default model
- `openai` — OpenAI API
- `openai-codex` — OpenAI Codex
- `openrouter` — OpenRouter API
- `zero-api` — Zero-API
- `deepseek` — DeepSeek (V4 Flash / V4 Pro, 1M context)
- Extensible through registry

Implementation: `src/provider/registry.ts` + `src/provider/config.ts`

### Message Model

Part-based messages supported:

- `role`, `content`, `reasoning_content`, `tool_calls`, `parts`

### Permission / Auto-Approve (✅ Implemented)

- **`permission-rules.ts`**: `isSafePermission()`, `shouldAutoApprove()`, `addPermissionRules()`, `isDangerousBashCommand()`
- **Dangerous command detection**: rm, rmdir, mv, truncate, shred, dd, `>` and other destructive patterns
- **Normalization**: Handles env var prefix (`VAR=val rm`) and `sudo` prefix
- **Auto-approve toggle**: Can be switched via `/auto` command or palette in the TUI
- **Session persistence**: autoApprove state stored in session JSON

### Tool Execution

- `abort` is wired into context
- `ask()` permission callback integrated with auto-approve logic
- `metadata()` is available

## Confirmed Runtime Behavior

- Assistant response streams in real-time to transcript
- `reasoning_content` displays in a dedicated `Thinking` block in real-time
- Response is turn-oriented groups
- Plain `user` / `assistant` / `system` text no longer shows redundant headers
- Assistant response footer: provider/model + copy hint
- Selection copy implemented (onMouseUp → renderer selection → clipboard)
- Build / Plan mode implemented (Plan mode sends empty `toolDefs`)
- Command palette / provider / model switching implemented
- Session list / rename / delete / compaction implemented
- Sidebar shows context, token/cost estimate, git diff summary

## Test Coverage

| Module | Test File |
|--------|-----------|
| Workspace memory | `workspace-memory.test.ts` |
| Permission rules | `permission-rules.test.ts` |
| Session persistence | `sessions.test.ts` |
| Session compaction | `session-compact.test.ts` |
| Message sanitization | `message-sanitize.test.ts` |
| System prompt | `system-prompt.test.ts` |
| Stream state | `stream-state.test.ts` |
| Autocomplete | `autocomplete.test.ts` |
| Commands | `commands.test.ts` |
| Errors | `errors.test.ts` |
| Markdown | `markdown.test.ts` |

## Future Considerations (explicitly marked as ideas, not current plans)

### P1 — Coding-Agent Clarity

- Per-message provider/model metadata
- Richer tool-specific rendering
- Response-scoped change summary

### P2 — Interaction Polish

- Smart auto-follow
- Paced streaming
- Diff view

## Notes

- When adding roadmap items, only include items confirmed for implementation.
- If referencing possible directions from opencode, mark them clearly as ideas, not current plans.
