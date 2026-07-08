# OpenZeroCode — Memory Architecture (current)

> **Status: ✅ Current implementation**

This document reflects the memory model implemented in the repo today.

---

## Current Decision

OpenZeroCode currently uses three memory layers:

1. **Base system prompt** from source code
2. **Durable user-global memory** loaded from `~/.openzerocode/AGENTS.md` and `~/.openzerocode/CONTEXT.md`
3. **Per-session conversation state** stored in session JSON, including optional compaction summaries

What it does today:

- ✅ Loads user-global `~/.openzerocode/AGENTS.md` for cross-project personal preferences, response style, and general safety rules
- ✅ Loads user-global `~/.openzerocode/CONTEXT.md` for user background, common tools, and long-term preferences
- ✅ Creates missing empty user-global `AGENTS.md` and `CONTEXT.md` files on Learn-mode entry in the TUI; empty placeholders are ignored by prompt loading
- ✅ Injects global memory files into the system prompt when present and non-empty
- ✅ Treats project `AGENTS.md` / `CONTEXT.md` files as normal repository documentation, not automatic prompt memory
- ✅ Stores session messages and compaction metadata in local session JSON
- ✅ Uses compaction summaries as session-scoped memory when context gets too large
- ✅ Keeps `SESSION_SUMMARY.md` as a manual handoff artifact, not automatic prompt input

What it does not do automatically:

- Auto-update `SESSION_SUMMARY.md`
- Auto-write memory files during normal conversation
- Infer and write cross-session learned memory without explicit user confirmation
- Sync memory to an external service
- Create a dedicated `.zero/` memory hierarchy

---

## Prompt Assembly Model

The system prompt is assembled in `src/client/system-prompt.ts` and consumed from `src/client/tui.tsx`, `src/client/session-runner.ts`, and server/headless entry points.

Current high-level order:

```text
Base system prompt
  ↓
Mode reminder (Build, Plan, or Learn)
  ↓
Task-list instructions (Build mode only)
  ↓
AGENTS.md memory contents (user-global only)
  ↓
CONTEXT.md memory contents (user-global only)

```

At runtime, the conversation payload then adds session-specific content such as:

```text
Previous compaction summary (if present in session state)
  ↓
Recent retained messages
  ↓
Current user message
```

So the important distinction is:

- **Global `~/.openzerocode/AGENTS.md` and `~/.openzerocode/CONTEXT.md` are user-scoped prompt inputs**
- **Project `AGENTS.md` and `CONTEXT.md` files are not automatic prompt inputs**
- **Compaction summaries are session-scoped prompt inputs**
- **`SESSION_SUMMARY.md` is not part of automatic prompt assembly**

---

## Durable Memory Files

OpenZeroCode loads durable memory from exactly these user-global files:

1. `~/.openzerocode/AGENTS.md` — user personal cross-project preferences, response style, general safety rules
2. `~/.openzerocode/CONTEXT.md` — user background, common tools, long-term preferences

When entering Learn mode in the TUI, OpenZeroCode ensures both files exist, creating empty placeholders if needed. Empty files are treated as absent until the user confirms real content.

Project `AGENTS.md`, `CONTEXT.md`, `.openzerocode/AGENTS.md`, and `.openzerocode/CONTEXT.md` are not loaded automatically. They can still be read by the model when relevant, just like any other repository documentation.

## Learn Mode

Learn mode is a constrained workflow for durable memory refinement:

- It can read/search files to understand context.
- It cannot use general source-editing or shell tools.
- It must discuss candidate memory updates first.
- It must show the exact target file and text before applying.
- It may call `learn_memory_apply` only after explicit user confirmation.
- `learn_memory_apply` writes only to global `~/.openzerocode/AGENTS.md` or `~/.openzerocode/CONTEXT.md`.

Confirmed Learn writes are durable and cross-session because they update the global files. There is no automatic inference/writeback during normal conversation.

Recommended split:

- `~/.openzerocode/AGENTS.md`: stable user instructions, language preferences, response style, and broad safety rules
- `~/.openzerocode/CONTEXT.md`: stable user background, common tools, recurring workflow facts, and long-lived preferences

---

## Session State and Compaction

Session state remains separate from durable memory:

- Session messages are stored under `~/.openzerocode/sessions`
- Compaction is triggered when context needs to be reduced
- A structured summary is generated and stored in session JSON
- A recent message tail is retained alongside the summary
- The summary is reused only for that session
- No memory file is written as part of normal compaction flow

This keeps long-running sessions usable without turning session state into durable memory.

---

## `SESSION_SUMMARY.md` Status

`SESSION_SUMMARY.md` exists in the repo as a **manual continuation artifact**.

Current behavior:

- Not automatically injected into prompts
- Not automatically updated by the runtime
- Not the source of truth for stable workspace instructions

Use it for:

- Human handoff notes
- Manual continuation breadcrumbs
- Concise session-specific reminders

Do not rely on it as automatic memory.

---

## Lightweight Introspection Surface

The command layer can expose memory state to the user without changing prompt behavior.

A practical introspection command should answer questions like:

- Is global `AGENTS.md` loaded?
- Is global `CONTEXT.md` loaded?
- What user-global files were discovered?
- Is `SESSION_SUMMARY.md` automatic or manual?

This is useful for debugging memory behavior while keeping the architecture simple.

---

## Source of Truth

Key implementation files:

- `src/client/workspace-memory.ts` — global memory file lookup and loading
- `src/tool/learn-memory.ts` — confirmed Learn-mode memory writes
- `src/client/system-prompt.ts` — base system prompt assembly and memory injection
- `src/client/tui.tsx` — runtime loading of memory and command wiring
- `src/client/sessions.ts` — session persistence
- `src/client/session-compact.ts` — session compaction summary generation
- `src/client/session-runner.ts` — session prompt/runtime flow

---

## Why This Design Exists

| Problem | Current approach |
|---------|------------------|
| Need stable user-wide instructions | Load `~/.openzerocode/AGENTS.md` |
| Need durable background without overloading policy | Load `~/.openzerocode/CONTEXT.md` |
| Need long-session continuity | Store compaction summary in session JSON |
| Avoid noisy repo writes during normal use | Do not auto-write memory files |
| Avoid confusing session handoff with durable memory | Keep `SESSION_SUMMARY.md` manual |
| Avoid duplicating project documentation into prompt memory | Treat project memory-looking files as normal docs |

---

## Possible Future Evolution

Potential future improvements, not required for current behavior:

- Explicit `/memory` inspection UX
- Directory-aware memory visualization
- Optional compatibility with other memory file conventions
- Manual export/import flows for session summaries
- External long-term memory integration
