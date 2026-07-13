---
name: compose:learn
description: Extract non-obvious learnings from sessions into structured knowledge artifacts
---

# Learning from Sessions

Extract durable, non-obvious knowledge from completed work and persist it as structured artifacts.

**Core principle:** Only extract what a future agent wouldn't know from reading the code or docs.

## When to Use

- After compose:verify fails and you fix the issue
- After compose:debug identifies a root cause
- End of a productive session
- After solving a tricky bug

## What Counts as a Learning

**Include (non-obvious discoveries only):**
- Hidden relationships between files or modules
- Execution paths that differ from how code appears
- Non-obvious configuration, env vars, or flags
- Debugging breakthroughs when error messages were misleading
- API/tool quirks and workarounds
- Build/test commands not in README

**Exclude:**
- Obvious facts from documentation
- Standard language/framework behavior
- Things already recorded in existing learnings

## The Process

### Step 1: Analyze Session

Review the session for:
- Errors that took multiple attempts to fix
- Unexpected connections or behaviors discovered
- Assumptions that proved wrong

### Step 2: Determine Scope

| Scope | Target | When |
|-------|--------|------|
| **Project** | `docs/compose/learnings/PROJECT.md` | Codebase-specific patterns |
| **Global** | `~/.openzerocode/LEARNINGS.md` | Cross-project patterns |

### Step 3: Write Learning Artifact

```markdown
## [YYYY-MM-DD] <short description>

**Scope:** project | global
**Confidence:** low | medium | high

### Observation
<What was discovered>

### Evidence
<How you know this>

### Implication
<What this means for future work>
```

## Confidence Levels

| Level | Meaning |
|-------|---------|
| **low** | First observation, single occurrence |
| **medium** | Multiple occurrences, clear evidence |
| **high** | Consistently observed, well-understood |
