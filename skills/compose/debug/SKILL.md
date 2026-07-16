---
name: compose:debug
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
---

# Debugging

## Overview

Systematic debugging: reproduce → isolate → root cause → fix → verify.

## The Process

### Step 1: Reproduce

First, reproduce the issue reliably:
- What are the exact steps?
- What is the expected behavior?
- What is the actual behavior?
- What error message do you see?

### Step 2: Isolate

Narrow down the problem:
- Does it happen every time?
- Is it specific to certain conditions?
- When did it last work?
- What changed recently?

### Step 3: Root Cause

Find the actual cause:
- Read the error message carefully
- Check the stack trace
- Add logging if needed
- Trace the execution path

### Step 4: Fix

Write the minimal fix:
- Fix the root cause, not the symptom
- Don't add unnecessary changes
- Follow existing code patterns

### Step 5: Verify

After fixing:
- Run the original reproduction steps
- Verify the fix works
- Run the full test suite
- Check for regressions

## Common Patterns

| Symptom | Check |
|---------|-------|
| Test fails | Is the test correct? Is the implementation correct? |
| Build fails | Check error messages, types, imports |
| Runtime error | Check stack trace, variable values |
| Performance issue | Profile, check algorithms, check I/O |

## After Fixing

After fixing a bug, consider:
- Should we add a regression test?
- Should we update compose:learn with this discovery?
- Are there similar issues elsewhere?
