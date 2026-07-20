---
name: compose:execute
description: Use when you have a written implementation plan to execute
---

# Executing Plans

## Overview

Load plan, execute all approved tasks continuously, then verify and report when complete.

## The Process

### Step 1: Load and Review Plan
1. Read plan file from docs/compose/plans/
2. Check only for genuine blockers, unsafe instructions, or ambiguity that prevents starting
3. If blocked: Raise the specific blocker before starting
4. Otherwise: Create a task per plan task and proceed; do not request routine approval or re-plan the approved work

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed
5. Immediately begin the next incomplete task in the same response when possible

Do not pause between tasks for status updates, recommendations, generic continuation prompts, broad reviews, formatting-only work, commits, or optional improvements. The written plan is the scope boundary.

### Step 3: Complete Development

After all tasks complete and verified:
- Use compose:verify to confirm completion
- Use compose:review once for an integrated code review of the accumulated change set
- Use compose:merge to complete development

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Don't force through blockers** - stop and ask.
