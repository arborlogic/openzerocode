---
name: compose:merge
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work
---

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options.

## The Process

### Step 1: Verify Tests

**Before presenting options, verify tests pass:**

```bash
npm test
```

**If tests fail:** Stop. Don't proceed until tests pass.

### Step 2: Present Options

**Normal repo:**
1. **Merge locally** — Merge back to main
2. **Create PR** — Push branch and open a Pull Request
3. **Keep as-is** — Leave the branch
4. **Discard** — Delete branch and all commits

### Step 3: Execute Choice

#### Option 1: Merge Locally

```bash
git checkout main
git pull
git merge <feature-branch>
git branch -d <feature-branch>
```

#### Option 2: Push and Create PR

```bash
git push -u origin <feature-branch>
gh pr create --title "<title>" --body "Summary of changes"
```

#### Option 3: Keep As-Is

Report: "Keeping branch <name>."

#### Option 4: Discard

**Confirm first:**
```bash
git branch -D <feature-branch>
```
