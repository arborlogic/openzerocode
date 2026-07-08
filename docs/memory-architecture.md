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
- ✅ Loads user-global `~/.openzerocode/CONTEXT.md` for user background, common tools, project-family lessons, and long-term preferences
- ✅ Creates missing empty user-global `AGENTS.md` and `CONTEXT.md` files on Learn-mode entry in the TUI; empty placeholders are ignored by prompt loading
- ✅ Injects global memory files into the system prompt when present and non-empty
- ✅ Treats project `AGENTS.md` / `CONTEXT.md` files as normal repository documentation, not automatic prompt memory
- ✅ Lets Learn mode write confirmed project-local development reference to `<workspace>/DEVELOPMENT.md`
- ✅ Stores session messages and compaction metadata in local session JSON
- ✅ Uses compaction summaries as session-scoped memory when context gets too large
- ✅ Keeps `SESSION_SUMMARY.md` as a manual handoff artifact, not automatic prompt input

What it does not do automatically:

- Auto-update `SESSION_SUMMARY.md`
- Auto-write memory files during normal conversation
- Infer and write cross-session learned memory without explicit user confirmation
- Auto-inject conditional framework/project memories from `memory.d`
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
- **Project `AGENTS.md`, `CONTEXT.md`, and `DEVELOPMENT.md` files are not automatic prompt inputs**
- **Compaction summaries are session-scoped prompt inputs**
- **`SESSION_SUMMARY.md` is not part of automatic prompt assembly**

---

## Durable Memory Files

OpenZeroCode loads durable prompt memory from exactly these user-global files:

1. `~/.openzerocode/AGENTS.md` — user personal cross-project preferences, response style, general safety rules
2. `~/.openzerocode/CONTEXT.md` — user background, common tools, project-family lessons, long-term preferences

When entering Learn mode in the TUI, OpenZeroCode ensures both files exist, creating empty placeholders if needed. Empty files are treated as absent until the user confirms real content.

Project `AGENTS.md`, `CONTEXT.md`, `.openzerocode/AGENTS.md`, `.openzerocode/CONTEXT.md`, and `DEVELOPMENT.md` are not loaded automatically. They can still be read by the model when relevant, just like any other repository documentation.

---

## Project Development Reference

`DEVELOPMENT.md` is the explicit project-local place for guidance extracted from global experience and project discussion history. It is regular repository documentation, suitable for humans and future AI sessions to read when needed.

Examples of good `DEVELOPMENT.md` content:

- Architecture constraints that are specific to this repository
- Preferred verification commands for this project
- Known workflow pitfalls and maintenance rules
- Project-specific conventions learned during development

It is not automatically injected into every prompt because project guidance should be visible, reviewable, and intentionally read when relevant.

---

## Learn Mode

Learn mode is a constrained workflow for durable experience refinement:

- It can read/search files to understand context.
- It cannot use general source-editing or shell tools.
- It must discuss candidate memory updates first.
- It must show the exact target file and text before applying.
- It may call a Learn write tool only after explicit user confirmation.

Learn mode supports two explicit workflows:

1. **Accumulate experience globally**
   - The user asks the AI to distill lessons from the current project state and discussion context.
   - After confirmation, `learn_memory_apply` writes to global `~/.openzerocode/AGENTS.md` or `~/.openzerocode/CONTEXT.md`.
   - These writes are durable and cross-session because they update global memory.

2. **Extract experience into a project**
   - The user asks the AI to read/search the current project plus global memory and select relevant reusable guidance.
   - After confirmation, `learn_project_memory_apply` writes to `<workspace>/DEVELOPMENT.md`.
   - These writes are project-local development reference, not automatic prompt memory.

There is no automatic inference/writeback during normal conversation.

Recommended split:

| Target | Use for |
|--------|---------|
| `~/.openzerocode/AGENTS.md` | User-wide behavior instructions: language, response style, safety preferences |
| `~/.openzerocode/CONTEXT.md` | User background, common tools, reusable lessons, project-family preferences |
| `<workspace>/DEVELOPMENT.md` | Repository-specific architecture, workflow, verification, and maintenance guidance |

---

## Workspace Memory Inspection

The command layer can expose memory state to the user without changing prompt behavior.

A practical introspection command should answer questions like:

- Is global `AGENTS.md` loaded?
- Is global `CONTEXT.md` loaded?
- What user-global files were discovered?
- Is `DEVELOPMENT.md` manual project reference?
- Is `SESSION_SUMMARY.md` automatic or manual?

This is useful for debugging memory behavior while keeping the architecture simple.

---

## Source of Truth

Key implementation files:

- `src/client/workspace-memory.ts` — global memory file lookup/loading and memory status
- `src/tool/learn-memory.ts` — confirmed Learn-mode global memory writes
- `src/tool/learn-project-memory.ts` — confirmed Learn-mode project `DEVELOPMENT.md` writes
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
| Need project-specific learned guidance | Write confirmed reference to `DEVELOPMENT.md` |
| Need long-session continuity | Store compaction summary in session JSON |
| Avoid noisy repo writes during normal use | Do not auto-write memory files |
| Avoid confusing session handoff with durable memory | Keep `SESSION_SUMMARY.md` manual |
| Avoid hidden project-context injection | Treat project memory-looking files as normal docs |

---

## Possible Future Evolution

Potential future improvements, not required for current behavior:

- Explicit `/memory` inspection UX
- Directory-aware memory visualization
- Optional compatibility with other memory file conventions
- Manual export/import flows for session summaries
- External long-term memory integration
