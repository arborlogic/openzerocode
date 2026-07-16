---
name: compose:review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements
---

# Code Review

## When to Review

**Mandatory:**
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- After fixing complex bug

## Review Checklist

1. **Correctness** — Does the code do what it's supposed to?
2. **Edge cases** — Are error conditions handled?
3. **Tests** — Are there adequate tests? Do they test behavior, not implementation?
4. **Readability** — Is the code clear and maintainable?
5. **Security** — Are there any security concerns?

## How to Review

```bash
# Get the diff
git diff main...HEAD

# Or for specific files
git diff HEAD~1
```

Review each change and provide feedback.

## Acting on Feedback

- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning)
