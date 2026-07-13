---
name: compose:execute
description: Use when you have a written implementation plan to execute
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

## The Process

### Step 1: Load and Review Plan
1. Read plan file from docs/compose/plans/
2. Review critically - identify any questions or concerns
3. If concerns: Raise them before starting
4. If no concerns: Create a task per plan task and proceed

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed

### Step 3: Complete Development

After all tasks complete and verified:
- Use compose:verify to confirm completion
- Use compose:review for code review
- Use compose:merge to complete development

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Don't force through blockers** - stop and ask.
