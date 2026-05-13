# OpenZeroCode — Memory Architecture (v1)

> **Status: ✅ Stable — This is the design currently implemented and in use.**

This document records the v1 decisions, not a discussion draft.

---

## v1 Decision

**v1 does only three things (all implemented):**

1. ✅ `AGENTS.md` is reliably loaded as a workspace instruction
2. ✅ Session JSON reliably stores messages + compaction summary
3. ✅ Context is compacted only when exceeding the threshold

**v1 does not do (possible future):**

- Auto-update `SESSION_SUMMARY.md`
- Auto-write any repo files
- Cross-session memory evolution
- `.zero/` directory
- `WORKSPACE_MEMORY.md` / `WORKSPACE_PROCEDURES.md`
- zero-api integration

---

## Prompt Assembly Order

```
System Prompt
  ↓
AGENTS.md (if present)
  ↓
Compaction Summary (if this session has been compacted before)
  ↓
Recent Tail Messages
  ↓
Current User Message
```

---

## Component Responsibilities

### AGENTS.md

- The single workspace-level instruction source
- Contains only stable, high-signal facts that must be known before execution
- Maintained by humans, not auto-updated
- Located at workspace root (project root / git root)

Appropriate content:

- Package manager (bun / pnpm / npm)
- Test command
- Generated files that should not be touched
- Known gotchas / constraints
- Repo structure facts

Should not contain:

- Session details
- Temporary work status
- Generic programming advice

### Session JSON

Path: `~/.openzerocode/sessions/<session-id>.json`

Stores:

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

The `compaction` field only exists after compaction has occurred.

### Compaction

- Trigger condition: estimated token count exceeds the model context limit threshold (recommended 80%)
- Manual trigger: `/compact` command
- Output: summary written back to `session.compaction.summary`, no repo files are written
- Retains the most recent N messages as a tail

---

## SESSION_SUMMARY.md Handling

Not part of the automatic flow in v1.

Not automatically read or written.

If supported in the future, it will be a manual command (`/export-summary`) invoked at the user's discretion.

---

## Implementation Verification

Corresponding source files:

- `src/client/workspace-memory.ts` — `loadAgentsInstruction()`: Loads AGENTS.md from workspace root
- `src/client/system-prompt.ts` — Injects AGENTS.md content when assembling the prompt
- `src/client/sessions.ts` — `saveSession()` / `loadSessionState()`: session JSON includes `compaction` field
- `src/client/session-compact.ts` — Generates structured compaction summary
- `src/client/session-runner.ts` — Prompt assembly order: system → AGENTS.md → compaction → tail → user message

## Why These Decisions Were Made

| Problem | Previous Approach | v1 Approach |
|---------|-------------------|-------------|
| Extra LLM call per turn | Called `generateSessionSummary` after each submit | Removed |
| Git diff pollution | `SESSION_SUMMARY.md` changed every turn | Don't write repo files |
| Multi-session summary conflicts | All sessions overwrote the same file | Summary stored in session JSON |
| Session context mistaken for workspace memory | `SESSION_SUMMARY.md` auto-injected | Only inject `AGENTS.md` |

---

## Possible Future Evolution (outside v1 scope)

- Directory-aware AGENTS.md (when reading a path, traverse upward to find a corresponding AGENTS.md)
- CLAUDE.md compatibility layer
- Cross-session memory extraction (zero integration)
- Separate `WORKSPACE_MEMORY.md` / `WORKSPACE_PROCEDURES.md` files
