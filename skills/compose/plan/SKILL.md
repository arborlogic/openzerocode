---
name: compose:plan
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase. Document everything they need to know: which files to touch for each task, code, testing, how to test it.

## Task Structure

Each task should include:
- **Files:** which files to create or modify
- **Interfaces:** what this task produces for later tasks
- **Steps:** bite-sized steps (2-5 minutes each)
- **Tests:** TDD steps (write test → verify fails → implement → verify passes)

## Plan Document Header

```markdown
# [Feature Name] Implementation Plan

**Goal:** [One sentence describing what this builds]
**Architecture:** [2-3 sentences about approach]
**Tech Stack:** [Key technologies/libraries]

---
```

## Task Format

```markdown
### Task N: [Component Name]

**Files:**
- Create: `path/to/file.ts`
- Modify: `path/to/existing.ts:123-145`

**Steps:**
- [ ] Step 1: Write the failing test
- [ ] Step 2: Run test to verify it fails
- [ ] Step 3: Write minimal implementation
- [ ] Step 4: Run test to verify it passes
- [ ] Step 5: Commit
```

## Save Location

Save plans to `docs/compose/plans/` directory.

## After Writing

Invoke compose:execute or compose:tdd to start implementation.
