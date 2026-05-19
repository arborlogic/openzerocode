# OpenZeroCode — Memory Architecture (current)

> **Status: ✅ Current implementation**

This document reflects the memory model implemented in the repo today.

---

## Current Decision

OpenZeroCode currently uses three memory layers:

1. **Base system prompt** from source code
2. **Workspace memory** loaded from `AGENTS.md` and `CONTEXT.md`
3. **Per-session conversation state** stored in session JSON, including optional compaction summaries

What it does today:

- ✅ Loads `AGENTS.md` from the nearest workspace scope
- ✅ Loads `CONTEXT.md` from the nearest workspace scope
- ✅ Injects both files into the system prompt when present
- ✅ Stores session messages and compaction metadata in local session JSON
- ✅ Uses compaction summaries as session-scoped memory when context gets too large
- ✅ Keeps `SESSION_SUMMARY.md` as a manual handoff artifact, not automatic prompt input

What it does not do automatically:

- Auto-update `SESSION_SUMMARY.md`
- Auto-write repo memory files during normal conversation
- Maintain cross-session learned memory
- Sync memory to an external service
- Create a dedicated `.zero/` memory hierarchy

---

## Prompt Assembly Model

The system prompt is assembled in `src/client/system-prompt.ts` and consumed from `src/client/tui.tsx`.

Current high-level order:

```text
Base system prompt
  ↓
Mode reminder (Build or Plan)
  ↓
Task-list instructions (Build mode only)
  ↓
AGENTS.md contents (if present)
  ↓
CONTEXT.md contents (if present)
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

- **`AGENTS.md` and `CONTEXT.md` are workspace-scoped prompt inputs**
- **Compaction summaries are session-scoped prompt inputs**
- **`SESSION_SUMMARY.md` is not part of automatic prompt assembly**

---

## Workspace Memory Files

### `AGENTS.md`

Purpose:

- Stable repo-specific instructions
- Workflow rules and constraints
- High-signal operational guidance

Examples of good content:

- Which commands to use for typecheck, tests, and local runs
- Important architectural entrypoints
- Known repo-specific gotchas
- Boundaries the agent should preserve

Should not contain:

- Temporary task progress
- Per-session notes
- Frequently changing implementation details better represented in source

### `CONTEXT.md`

Purpose:

- Project background and vocabulary
- Repo-specific heuristics that help orientation
- Known mismatches between docs and implementation
- Short-term but reusable local context

Examples of good content:

- Definitions like Build mode / Plan mode
- Product terminology used throughout the repo
- Current known documentation mismatches
- Workflow heuristics that are useful but not strict policy

Should not contain:

- Hard policy that overrides executable code truth
- Long freeform design docs
- Auto-generated session history

---

## Workspace File Discovery

Implemented in `src/client/workspace-memory.ts`.

Current behavior:

- Establish a workspace boundary by walking upward until a directory containing `.git` or `package.json`
- Search upward from the current working directory for the nearest matching file
- Support nearest-file lookup independently for:
  - `AGENTS.md`
  - `CONTEXT.md`
- Return trimmed file contents
- Treat empty files as absent

This means nested workspaces can override parent memory files by placing a closer `AGENTS.md` or `CONTEXT.md` nearer to the current working directory.

---

## Session Memory

Session state is stored locally under:

```text
~/.openzerocode/sessions/<session-id>.json
```

Session JSON contains the conversation transcript and, when compaction has occurred, a compaction payload similar to:

```json
{
  "id": "session-abc",
  "messages": [],
  "model": "...",
  "provider": "...",
  "mode": "build",
  "compaction": {
    "summary": "...",
    "createdAt": "...",
    "sourceMessageCount": 28
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

The `compaction` field is session-scoped. It is not shared across sessions unless exported or copied manually.

---

## Compaction Behavior

Relevant code paths include `src/client/session-compact.ts`, `src/client/session-runner.ts`, and session persistence helpers in `src/client/sessions.ts`.

Current behavior:

- Compaction is triggered when context needs to be reduced
- A structured summary is generated and stored in session JSON
- A recent message tail is retained alongside the summary
- The summary is reused only for that session
- No repo file is written as part of normal compaction flow

This keeps long-running sessions usable without turning session state into workspace memory.

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

- Is `AGENTS.md` loaded?
- Is `CONTEXT.md` loaded?
- What files were discovered from the current working directory?
- Is `SESSION_SUMMARY.md` automatic or manual?

This is useful for debugging memory behavior while keeping the architecture simple.

---

## Source of Truth

Key implementation files:

- `src/client/workspace-memory.ts` — workspace file lookup and loading
- `src/client/system-prompt.ts` — base system prompt assembly and memory injection
- `src/client/tui.tsx` — runtime loading of workspace memory and command wiring
- `src/client/sessions.ts` — session persistence
- `src/client/session-compact.ts` — session compaction summary generation
- `src/client/session-runner.ts` — session prompt/runtime flow

---

## Why This Design Exists

| Problem | Current approach |
|---------|------------------|
| Need stable repo-specific instructions | Load `AGENTS.md` |
| Need orientation/background without overloading policy | Load `CONTEXT.md` |
| Need long-session continuity | Store compaction summary in session JSON |
| Avoid noisy repo writes during normal use | Do not auto-write memory files |
| Avoid confusing session handoff with workspace memory | Keep `SESSION_SUMMARY.md` manual |

---

## Possible Future Evolution

Potential future improvements, not required for current behavior:

- Explicit `/memory` inspection UX
- Directory-aware memory visualization
- Optional compatibility with other memory file conventions
- Manual export/import flows for session summaries
- External long-term memory integration
