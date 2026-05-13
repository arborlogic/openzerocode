# OpenZeroCode — SQLite Adoption Checklist

> **Status: ✅ Current decision unchanged — file-based storage remains the primary approach.**

This document defines:

- Why there is **no rush** to introduce SQLite in OpenZeroCode
- Under what circumstances SQLite would be worth adopting
- Which data should remain file-based even after SQLite adoption
- How the first version should be scoped if SQLite is added in the future

The purpose of this document is to avoid prematurely complicating storage.

---

## Current Decision (still in effect)

The conclusion at this stage is:

> **First, complete the file-based workspace memory implementation. Do not introduce SQLite yet.**

The reason is not that SQLite is bad, but that what needs to be validated now is **memory v1's product behavior**, not storage scalability.

The loops that are already working:

1. ✅ Session start reads `AGENTS.md`
2. ✅ Session JSON saves messages + compaction summary
3. ✅ Auto-compaction when context exceeds threshold
4. ✅ Auto-approve and permission rules persistence

---

## What We Keep File-Based

Even if SQLite is adopted in the future, the following data should remain file-based:

### `AGENTS.md`

Rationale:

- This is a workspace instruction artifact read by both humans and agents
- Needs to be easy to review
- Needs to be easy to edit manually
- Needs to be version-controlled alongside the repo

### `SESSION_SUMMARY.md`

Rationale:

- This is a handoff artifact, not a pure internal cache
- Needs to be directly openable and readable
- Needs to be directly editable
- Serves as the source for local-first continuation

### Why This Matters

In short:

> **Files are the user interface and source of truth; SQLite should only be the internal index and query layer.**

---

## What SQLite Would Be For

If SQLite is adopted in the future, its most reasonable role is not to replace `AGENTS.md` / `SESSION_SUMMARY.md`, but to supplement with these capabilities:

- Local trace index
- Structured candidate store
- Accepted / rejected state tracking
- Local queryable history
- Internal dedupe / merge support
- Response / session / tool metadata indexing

In other words:

> **SQLite should first serve internal retrieval and bookkeeping, not human-facing memory artifacts.**

---

## When To Add SQLite

SQLite adoption is only recommended when the following signals start to appear.

### Signal 1 — Session history starts getting large

Symptoms:

- Want to retain many session summary histories
- Need to query "what was done in a particular session"
- Markdown alone makes it hard to quickly locate information

Judgment:

- If you start needing to search past content by task / file / date / session, SQLite is likely worth adding

### Signal 2 — Zero candidate lifecycle needs state

Symptoms:

- Need to track whether a candidate has been accepted
- Need to record rejected / ignored / edited states
- Need to know how many times a candidate has appeared

Judgment:

- If zero's upstream materials start needing a state machine, SQLite is a good fit

### Signal 3 — Local traces need structured querying

Symptoms:

- Need to query which sessions recently modified a particular file
- Need to find success patterns for certain task types
- Need to correlate tool usage, diffs, and summaries

Judgment:

- If you start needing relational queries across response / session / tool, consider SQLite

### Signal 4 — Accepted memory becomes too rich for plain append

Symptoms:

- `AGENTS.md` has grown beyond instructions into multiple structured categories
- Want to categorize, sort, and trace origins
- Want to maintain both "original artifact" and "internal normalized record" perspectives

Judgment:

- If memory starts growing entities and metadata, SQLite is worth adopting

### Signal 5 — Export to zero needs a stable local staging layer

Symptoms:

- Want to reliably export accepted items, summaries, and traces to zero
- Need retry / version / cursor / sync state

Judgment:

- If OpenZeroCode starts serving as zero's candidate staging source, SQLite becomes very useful

---

## When Not To Add SQLite Yet

The following should not be reasons to introduce SQLite:

- Just feeling that SQLite is more professional than markdown
- Just thinking it might be useful in the future
- Just wanting to design the schema upfront
- Just wanting to mimic opencode's storage shape

If the current goals are only:

- Local-first memory
- Summary handoff
- Human-editable workspace artifacts

Then files are sufficient.

---

## Comparison With Opencode

The `submodules/opencode` approach is:

- Core data primarily goes into SQLite
- Reads query SQLite directly
- Writes often go through event/projector paths
- A small number of local files are kept as supplementary artifacts

This design suits:

- Many sessions / messages / parts
- Sync and projector requirements
- Heavy internal relational queries

But OpenZeroCode's memory v1 has not yet reached this level of complexity.

So the most reasonable lessons to draw are not "use SQLite immediately", but:

- Learn its local instruction mindset
- Learn its anchored summary approach
- Don't yet adopt its full storage complexity

---

## Recommended Path

### Stage 1 — File-based memory only

Retain:

- `AGENTS.md`
- `SESSION_SUMMARY.md`

Complete:

- Loading
- Summary generation

### Stage 2 — Optional lightweight local index

If more querying capability becomes necessary, consider introducing SQLite, but only for:

- Session summary index
- Zero candidate lifecycle
- Trace metadata

At this point:

- `AGENTS.md` remains the human-facing instruction artifact
- `SESSION_SUMMARY.md` remains the human-facing handoff artifact

### Stage 3 — Candidate staging for zero

Once the local memory loop matures, consider:

- Local SQLite record
- Export queue
- Sync state
- Candidate material for zero

At this point, SQLite is truly connected to the zero pipeline.

---

## Minimal Rule

The simplest decision rule is:

> **If a requirement is primarily for humans to read, edit, and continue working locally, use files first.**

> **If a requirement is primarily for the system to query, track state, and make structured associations, consider SQLite.**

---

## Current Recommendation

As of now, the recommendation is to maintain:

- Workspace memory via files
- Summary via files
- No SQLite dependency

Re-evaluate SQLite when at least two of the following signals appear:

1. Need to retain and query many historical summaries
2. Need zero candidate lifecycle state
3. Need relational queries across traces / tools / responses
4. Need a stable export staging layer to zero

Until then:

> **Getting file-based memory right is more important than getting SQLite wired in.**
