# Auto-Approve Permission Design

> **Status: ✅ Implemented — This is a design record, not a TODO list.**

This document records design decisions for the auto-approve mechanism.

---

## Motivation

Currently every write/edit/bash operation requires the user to press `y` in the TUI for approval. This causes significant interruption during intensive development sessions. The goals are:

1. Allow users to enable auto-approve to reduce interaction interruptions
2. Prevent the LLM from arbitrarily executing destructive commands that could delete data

---

## Threat Model

### Which operations can delete data?

| Tool | Can Delete? | Risk Vector |
|------|-------------|-------------|
| `read` | ❌ Read-only | None |
| `grep` | ❌ Read-only | None |
| `glob` | ❌ Read-only | None |
| `web-fetch` | ❌ Read-only | None |
| `write` | ⚠️ Can overwrite | Single file only, risk is manageable |
| `edit` | ⚠️ Can replace strings | Targeted, unlikely to cause mass deletion |
| `bash` | ✅ **Can delete anything** | `rm -rf /`, `rm file/*`, `truncate`, etc. |

**Conclusion: The only path that needs protection is `bash` executing destructive shell commands.**

---

## Design Principles

1. **Defense in depth** — auto-approve should not let destructive bash bypass review
2. **Minimal changes** — do not affect tool layer, provider layer, or core layer
3. **Pattern is allowlist-based** — only block clearly dangerous commands, auto-approve everything else
4. **User always has final say** — blocked commands can still be executed by pressing `y`
5. **False negative over false positive** — missing a block is safer than blocking a safe command, so patterns lean permissive rather than strict

---

## Architecture Changes (✅ Implemented)

### Affected Files

```
src/client/permission-rules.ts   ← Dangerous command detection (isDangerousBashCommand)
src/client/tui.tsx               ← Auto-approve toggle + ask flow integration
src/client/commands.ts           ← /auto and /auto-approve commands
src/client/sessions.ts           ← autoApprove state persisted in session JSON
```

### Unaffected Files

```
src/tool/*                        ← Tool layer unchanged
src/provider/*                    ← Provider layer unchanged
src/core/*                        ← Core layer unchanged
src/client/session-runner.ts      ← Session-runner unchanged
```

---

## Dangerous Command Detection (`permission-rules.ts`)

### Detection Logic

When a bash command is received, check whether it contains destructive patterns:

```typescript
// Only checks the "start" of the command for dangerous patterns
// Does not track variables, parse pipelines, or build syntax trees
// Aim is to block the most common direct deletion calls

DESTRUCTIVE_BASH_PATTERNS = [
  /^rm\s/,           // rm file, rm -rf /
  /^rmdir\s/,        // rmdir directory
  /^mv\s/,           // mv file /dev/null
  /^truncate\s/,     // truncate -s 0 file
  /^shred\s/,        // shred file
  /^dd\s/,           // dd if=/dev/zero of=file
  /^>/,              // > file (shell truncation)
]
```

### Cases Not Handled

- `VAR=val rm file` → has variable assignment prefix, needs normalization
- `sudo rm file` → has sudo prefix, needs normalization
- `find . -exec rm {} \;` → more indirect, pattern can't cover all variations
- `alias rm='rm -i'` → user-defined alias, cannot be statically analyzed

For these cases: **prefer false negatives (missed blocks) over false positives (blocking safe commands)**. If a user enables auto-approve and encounters a missed dangerous command, the LLM will execute it. This is a design tradeoff: auto-approve itself carries risk, and we only provide basic protection, not a sandbox.

---

## Auto-Approve Flow (`tui.tsx`)

### State

```typescript
const [autoApprove, setAutoApprove] = createSignal(false)
```

### Modified Ask Callback

```
ask(req)
    │
    ├── shouldAutoApprove(req, rules)? ──→ YES ──→ resolve()
    │       (safe permissions + user's "always allow" rules)
    │
    └── autoApprove() === true?
            │
            ├── req.permission === "bash"
            │       └── isDangerousCommand(req.patterns)?
            │               ├── YES → showApprovalDialog()
            │               └── NO  → resolve()
            │
            └── req.permission !== "bash"
                    └── resolve()  // write/edit auto-approved
```

### Palette UI

Added in the DISPLAY section of `actionPaletteItems`:

```typescript
{
  label: "Auto-approve",
  hint: autoApprove() ? "ON" : "OFF",
  onSelect: () => { setAutoApprove(c => !c); setShowPalette(false) },
}
```

---

## Security Analysis

### With Auto-Approve Enabled

| Scenario | Result |
|----------|--------|
| LLM runs `read file.ts` | ✅ Auto-approved (safe permission) |
| LLM runs `write file.ts` to write content | ✅ Auto-approved (non-destructive) |
| LLM runs `edit file.ts` to replace strings | ✅ Auto-approved (non-destructive) |
| LLM runs `bash echo hello` | ✅ Auto-approved (non-destructive) |
| LLM runs `bash rm -rf /tmp/cache` | ❌ Approval dialog shown |
| LLM runs `bash truncate -s 0 data.db` | ❌ Approval dialog shown |
| LLM runs `bash VAR=val rm file` | ⚠️ May be missed (needs normalization) |

### Bypass Risks

The following methods may bypass destructive pattern detection:

1. **Through variables**: `CMD=rm; $CMD file` → pattern sees `CMD=rm`, not `rm`
2. **Through `eval`**: `eval "rm file"` → pattern sees `eval`, not `rm`
3. **Through base64**: `echo cm0gZmlsZQ== | base64 -d | sh` → completely undetectable statically
4. **Through `find`**: `find . -name "*.log" -delete` → uses `-delete` not `rm`

These bypass methods would require more complex static analysis (syntax trees, variable tracking) to defend against, which is outside the scope of this design. If users have higher security requirements, they should not enable auto-approve, or pair it with a sandboxed execution environment.

---

## Implementation Status

### Implemented

| Step | Status | File |
|------|--------|------|
| `isDangerousCommand()` | ✅ | `src/client/permission-rules.ts` |
| `normalizeCommand()` — env var + sudo prefix handling | ✅ | `src/client/permission-rules.ts` |
| autoApprove signal + ask callback integration | ✅ | `src/client/tui.tsx` |
| Palette toggle | ✅ | `src/client/tui.tsx` (actionPaletteItems) |
| `/auto` and `/auto-approve` commands | ✅ | `src/client/commands.ts` |
| autoApprove state session persistence | ✅ | `src/client/sessions.ts` |
| Permission rules accumulation mechanism | ✅ | `src/client/permission-rules.ts` (`addPermissionRules`) |
| Unit tests | ✅ | `src/client/permission-rules.test.ts` |

### Design Differences (vs. original design doc)

- The original design only specified `/auto` command; the implementation also added `/auto-approve` as an alias (registered in commands.ts)
- The original design stated auto-approve state would "not be persisted", but the implementation saves it to session JSON (`saveSession()` and `loadSessionState()` both include `autoApprove`)

---

## Excluded From Design

- ✅ **session-level persistence** — original design said no persistence, but implementation stores in session JSON (auto-restores state on restart)
- **Not** doing protected path configuration (e.g., blocking writes to `~/Documents`)
- **Not** doing sandbox / container isolation
- **Not** doing audit log
- **Not** doing per-tool granular control (all-or-nothing)
