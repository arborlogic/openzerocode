# OpenZeroCode — Working Memory Test Plan

> **Status: ✅ Test framework stable — baseline tests completed, this serves as a reference for future regression testing.**

This document defines a **real-world usage scenario** test plan to verify whether the current working memory loop is usable enough.

This plan only validates the current phase's responsibilities:

- Read `AGENTS.md`
- Read / write `SESSION_SUMMARY.md`
- Allow the next session to continue the previous session's work

Does not validate:

- Long-term promotion
- Auto-write-back to `AGENTS.md`
- Zero integration
- SQLite

---

## Goal

Confirm whether OpenZeroCode has a usable workspace-level working memory for real tasks.

Specifically, verify:

1. `AGENTS.md` can reliably influence current session behavior ✅ (verified)
2. `SESSION_SUMMARY.md` can produce high-quality handoff ✅ (baseline verified)
3. The next session can effectively continue from the previous state ✅ (baseline verified)
4. Summary content genuinely helps reduce repeated exploration and mistakes ✅ (baseline verified)

---

## Success Criteria

The working memory loop is acceptable if most of the following conditions hold:

- The agent correctly reads repo-specific rules from `AGENTS.md`
- `SESSION_SUMMARY.md` is consistently generated after each task
- `Next Steps` in `SESSION_SUMMARY.md` are actionable, not vague
- `Critical Context` retains truly important repo-specific corrections or constraints
- `Relevant Files` includes specific paths with explanations of why they matter
- When re-entering the same repo, the agent does not need to re-discover known context
- The summary does not degrade into a chat log or verbose transcript

---

## Failure Signals

The following indicate that the current prompt or data flow is not stable:

- `SESSION_SUMMARY.md` heavily restates conversational tone instead of being a work handoff
- `Next Steps` are vague sentences like "continue working"
- `Critical Context` lacks truly critical errors, corrections, or constraints
- `Relevant Files` lacks paths, or doesn't include `path: why it matters`
- The second session re-does exploration already confirmed in the first session
- The summary includes many unimportant details but misses information that blocks future work

---

## Test Setup

Each test round should maintain the same preconditions:

1. Use a real repo, not an overly simplified toy example
2. The repo root contains:
   - `AGENTS.md`
   - `SESSION_SUMMARY.md` may be absent — the system will create it automatically
3. Before each task round, retain the previous round's summary result
4. After each test round, manually inspect the generated `SESSION_SUMMARY.md`

It is recommended to prepare at least two types of repos:

- `TypeScript / frontend or fullstack repo`
- `backend or CLI repo`

This prevents the prompt from being effective only for a single project type.

---

## Test Matrix

### Scenario 1 — Repo Rule Compliance

**Purpose:**

Verify that `AGENTS.md` can genuinely influence current session behavior.

**Prerequisites:**

- Add 3 to 5 high-signal rules in `AGENTS.md`
- Include at least:
  - Package manager
  - Test command
  - Paths or generated file rules that should not be modified

**Steps:**

1. Start a new session
2. Issue a task that requires reading files, modifying files, and running tests
3. Observe whether the agent directly follows `AGENTS.md`

**Acceptance:**

- Does not guess the wrong package manager
- Does not touch paths marked as off-limits
- Uses the correct test command

**Failure examples:**

- Runs `npm` despite `AGENTS.md` specifying `pnpm`
- Modifies generated files despite `AGENTS.md` saying not to

### Scenario 2 — Single-Session Summary Quality

**Purpose:**

Verify that the summary produced after a single task is readable and handoff-ready.

**Steps:**

1. Start a new session
2. Execute a medium-complexity task
   - e.g., add a new API route
   - or fix a bug spanning 2 to 4 files
3. After completion, inspect `SESSION_SUMMARY.md`

**Key checks:**

- Is `Goal` correct?
- Does `Done` include genuinely completed items?
- Are `In Progress` / `Blocked` honest?
- Are `Next Steps` truly actionable?
- Do `Relevant Files` include `path: why it matters`?
- Does `Critical Context` retain information that would genuinely affect the next round?

**Pass criteria:**

- Someone who hasn't seen the conversation can roughly take over just by reading the summary

### Scenario 3 — Multi-Session Continuation

**Purpose:**

Verify that `SESSION_SUMMARY.md` has genuine continuation value.

**Steps:**

1. Stop the first session halfway through
   - e.g., completed route / schema but not tests
2. Confirm `SESSION_SUMMARY.md` has been generated
3. Close the session
4. Open a new session
5. Directly ask to continue the task

**Acceptance:**

- The agent can directly pick up the unfinished work
- The agent does not need to re-discover files and decisions already clarified in the previous round
- `Next Steps` genuinely helps the second round

**Failure examples:**

- The second round re-greps the same set of already-clarified files from scratch
- Completely ignores pending work from the previous round

### Scenario 4 — Correction Retention

**Purpose:**

Verify that important corrections make it into `Critical Context`.

**Steps:**

1. During a session, deliberately let the agent encounter a repo-specific correction
   - e.g., test command is not the default
   - or a generated directory should not be modified
2. Clearly correct the agent
3. After completing the task, inspect `SESSION_SUMMARY.md`
4. In the next session, perform a similar task

**Acceptance:**

- `Critical Context` retains this correction
- The agent no longer makes the same mistake in the next round

### Scenario 5 — Relevant Files Precision

**Purpose:**

Verify that `Relevant Files` is not a random listing but genuinely helpful for continuation.

**Steps:**

1. Execute a task that spans multiple files
2. Inspect `Relevant Files`

**Acceptance:**

- Each entry includes a clear path
- Each entry explains why it matters
- The number of entries is concise — not every touched file is listed

**Ideal format:**

```md
- src/routes/auth.ts: route registration for login flow
- src/handlers/login.ts: login business logic and validation
- src/schemas/auth.ts: request/response schema used by the route
```

### Scenario 6 — Noise Resistance

**Purpose:**

Verify that the summary is not polluted by casual conversation or low-value content.

**Steps:**

1. Add some unimportant conversation during the session
2. Complete an actual task
3. Inspect `SESSION_SUMMARY.md`

**Acceptance:**

- The summary remains handoff-oriented, not a conversation recap
- Unimportant chit-chat does not appear in `Critical Context` or `Relevant Files`

---

## Recommended Test Tasks

It is recommended to run at least 3 types of tasks:

1. **Add a feature**
   - e.g., add an API endpoint, add a field, add a button behavior

2. **Fix a bug**
   - e.g., fix route registration, fix a test failure, fix a data flow issue

3. **Half-completed task handoff**
   - Intentionally stop halfway, test continuation quality

These three types best reveal whether the summary records "completion notes" or functions as a "work handoff."

---

## Review Rubric

After each round, score using the following rubric:

### A. Goal Accuracy

- 0: Task summary is wrong
- 1: Roughly correct but vague
- 2: Concise and accurate

### B. Next Steps Usefulness

- 0: Nearly not actionable
- 1: Has direction but too vague
- 2: Clear and directly actionable

### C. Critical Context Quality

- 0: Misses key constraints or corrections
- 1: Partially retained but incomplete
- 2: Only retains truly important information that affects the next round

### D. Relevant Files Quality

- 0: Not listed, or listed poorly
- 1: Has paths but lacks explanations
- 2: Paths are precise, each entry has continuation value

### E. Continuation Value

- 0: The second round is barely helped
- 1: Somewhat helpful, but still re-does much exploration
- 2: The second round is noticeably faster

**Guidance:**

- Total per round: 10 points maximum
- Average of 7 or above: considered usable
- If two consecutive rounds score below 6, prioritize adjusting the summary prompt

---

## Execution Plan

Recommended execution order:

1. Run Scenario 1
2. Run Scenario 2
3. Run Scenario 3
4. Run Scenario 4
5. Run Scenario 5
6. Run Scenario 6 as needed

This first validates:

- Rule compliance
- Summary quality
- Continuation ability

Then validates:

- Correction retention
- File precision
- Noise resistance

---

## What To Adjust If It Fails

If tests fail, prioritize adjusting:

1. Section rules in `buildSessionSummaryPrompt()`
2. Selection rules for `Critical Context`
3. Output format requirements for `Relevant Files`
4. Whether `Next Steps` is sufficiently action-oriented

Do not immediately introduce:

- SQLite
- Candidate lifecycle
- Long-term memory promotion
- Zero integration

Because these will not solve summary quality problems.

---

## Exit Criteria

Working memory v1 can be considered validated when the following conditions are met:

- At least 3 rounds of real task tests completed
- At least 1 round of multi-session continuation test successful
- Summary rubric average score >= 7/10
- No recurring failures such as:
  - Consistently missing `Next Steps`
  - Consistently listing `Relevant Files` poorly
  - Consistently including chat in the summary

Once these conditions are met, consider next steps:

- Summary rotation / archive strategy
- More granular repo boundary behavior
- Future zero integration contract

---

## Baseline Results

This section records actual test runs, providing baselines for future regression testing.

### Run 1 — README Command / Testing Note Update

**Date:**

- 2026-05-13

**Scenario Coverage:**

- Scenario 1 — Repo Rule Compliance
- Scenario 2 — Single-Session Summary Quality

**Task:**

- Update `README.md` to mention `npm run start:tui` as a valid start command.
- Add a targeted test example using `npx tsx --test <file>`.
- Keep the testing note aligned with `AGENTS.md` so `npm test` is not implied as the default smoke test.

**Observed Behavior:**

- Agent followed `AGENTS.md` guidance and did not treat `npm test` as the default smoke test.
- Agent used `npm run typecheck` for verification.
- `SESSION_SUMMARY.md` was generated with a usable handoff structure.

**Artifacts:**

- [README.md](./README.md:1)
- [AGENTS.md](./AGENTS.md:1)
- [SESSION_SUMMARY.md](./SESSION_SUMMARY.md:1)

**Rubric Score:**

- Goal Accuracy: 2/2
- Next Steps Usefulness: 2/2
- Critical Context Quality: 2/2
- Relevant Files Quality: 2/2
- Continuation Value: 2/2
- Total: 10/10

**Notes:**

- The first provider-backed summary generation was too sparse and placed routine verification into `Critical Context`.

...[9 lines omitted]

**Date:**

- 2026-05-13

**Scenario Coverage:**

- Scenario 3 — Multi-Session Continuation

**Task:**

- Update `README.md` and `docs/current-ui-notes.md` so both mention that targeted local tests can use `npx tsx --test <file>`.
- Keep the guidance aligned with `AGENTS.md` about provider-gated tests.
- Intentionally stop after updating only `README.md`.

**Observed Behavior:**

- `SESSION_SUMMARY.md` correctly preserved the unfinished work.
- `In Progress` explicitly recorded that `docs/current-ui-notes.md` still needed the same testing guidance.
- `Next Steps` correctly pointed to updating `docs/current-ui-notes.md`.
- `Critical Context` preserved the repo-specific fact that `npm test` is not a universal smoke test because provider-facing tests require `OPENCODE_API` / `OPENCODE_API_KEY`.
- `Relevant Files` correctly included the already-changed file, the still-pending file, and the two provider-gated test files that justify the rule.

**Artifacts:**

- [SESSION_SUMMARY.md](./SESSION_SUMMARY.md:1)
- [README.md](./README.md:1)
- [docs/current-ui-notes.md](./docs/current-ui-notes.md:1)
- [AGENTS.md](./AGENTS.md:1)

**Rubric Score:**

- Goal Accuracy: 2/2
- Next Steps Usefulness: 2/2
- Critical Context Quality: 2/2
- Relevant Files Quality: 2/2
- Continuation Value: 2/2 at artifact level
- Total: 10/10 at artifact level

**Notes:**

- The working-memory artifact itself is strong enough to support continuation.
- A provider-backed follow-up prompt asking "what should you do next?" returned an empty continuation response in this synthetic test harness.
- Because of that, this run should be marked:
  - artifact-level continuation: pass
  - agent-response-level continuation: inconclusive

**Follow-up:**

- Validate the same scenario in a real TUI cross-session run instead of only through synthetic provider calls.
