---
name: review-helper
description: "Perform a focused, evidence-based code review. Use when the user asks to review code, a diff, pull request, branch, commit, or implementation before merging."
---

# Code Review Helper

Review changes for defects and regressions. The goal is to report actionable findings, not to summarize or praise the implementation.

## Scope

1. Honor the review target the user provides (files, commit, branch, PR diff, or requirements).
2. If none is specified, inspect the working-tree diff with `git diff`, then staged changes with `git diff --cached`.
3. Establish the baseline before judging a change:
   - `git status --short`
   - `git diff --stat` and the relevant diff
   - Nearby implementations, tests, types, and configuration
   - Applicable project instructions such as `AGENTS.md` or `CONTRIBUTING.md`
4. Do not modify source files while conducting a review unless the user explicitly asks for fixes.

## Review process

### 1. Understand intent

Identify the behavior the change is intended to add, fix, or preserve. Compare the implementation against stated requirements and existing conventions.

### 2. Trace behavior

For each meaningful changed path, trace inputs, state changes, outputs, failures, and cleanup. Inspect callers and consumers when an interface, data shape, or behavior changes.

### 3. Look for concrete problems

Prioritize findings that are introduced by the change and can be demonstrated from the code. Check for:

- Incorrect behavior, regressions, off-by-one errors, and broken control flow
- Missing validation, error handling, cancellation, retries, cleanup, or rollback
- API, schema, serialization, migration, and backward-compatibility breaks
- Race conditions, idempotency failures, resource leaks, and unsafe concurrency
- Authentication, authorization, injection, secret exposure, and data-leak risks
- Incorrect boundary handling: empty values, nullability, limits, time zones, encoding, and partial failures
- Tests that fail to cover changed behavior or encode an incorrect expectation
- Performance issues only when a specific costly path or unbounded operation is evident

Do not report pre-existing issues unless the change worsens them or they prevent assessing the change.

### 4. Verify proportionately

Run the narrowest relevant checks when practical (targeted tests, type checks, linting, or build). Treat a command that cannot run as review context, not as a defect by itself. Do not claim that a check passed unless it was run.

## Finding standards

Every finding must be:

- **Specific:** identify the file and a precise line or a small line range.
- **Correct:** explain the execution path or condition that produces the problem.
- **Actionable:** state the impact and the expected correction direction.
- **Scoped:** report only issues caused by, or materially affected by, the proposed changes.

Use these priorities:

- **P0 — blocker:** data loss, critical security exposure, or a release-blocking outage.
- **P1 — high:** likely production failure, security issue, or major regression.
- **P2 — medium:** meaningful correctness, reliability, or maintainability problem that should be fixed before merge.
- **P3 — low:** limited-impact issue that is worth fixing but is not merge-blocking.

Avoid speculative findings, style-only preferences, and vague statements such as “this could be cleaner.” Report a concern only when you can explain a realistic failing scenario.

## Response format

List findings first, ordered by priority. Use one item per independent issue:

```markdown
## Findings

- [P1] Short title — `path/to/file.ts:42`
  Explain the triggering condition, resulting behavior, and why it is a problem.

## Questions / Assumptions

- Assumption or clarification required to complete the review.

## Verification

- PASS: `command run`
- NOT RUN: `command` — reason

## Conclusion

No blocking findings. / Changes requested.
```

If there are no findings, explicitly say **“No findings.”** Do not invent issues to fill the report. Keep any summary brief and distinguish unverified assumptions from confirmed defects.
