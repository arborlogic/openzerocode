# OpenZeroCode — Response Redesign Notes

> **Status: ✅ Stable — The current phase of response redesign is complete.**

This document records design principles extracted from studying opencode, the response redesign items that have been completed, and directions to consider for the future.

---

## Background

The original problem wasn't missing data, but an overly flat presentation model:

- Everything was flattened into `DisplayBlock[]`
- Most blocks shared the same visual structure
- Assistant response lacked footer / summary / change context
- No visual binding between user prompt, assistant parts, and tool outputs

## Design Principles (adapted from opencode references)

- Use turns, not flat block lists
- Use part-specific UI, not a generic block renderer
- Put assistant metadata back at the end of the response
- Give tool results higher visual weight
- Tie code changes back to the turn's response

---

## Implemented

### Phase 1 — Turn Skeleton ✅

- Response changed from flat block stream to turn-oriented transcript groups
- User prompt becomes the turn start point
- Assistant / tool / streaming parts are rendered within the same turn

### Phase 2 — Basic Block Cleanup ✅

- Plain `user` / `assistant` / `system` text no longer shows redundant headers
- Reasoning / tool / error blocks have basic collapse behavior

### Phase 5 — Per-Entry Border Cleanup ✅

- Removed outer `TurnEntry` wrapper border (was `accentDim` blue wrapping all assistant entries)
- Each entry type now carries its own left border only — no double-border nesting
- `assistant` markdown entries gained their own `accentDim` left border
- Border color scheme: `assistant` → `#1f6feb`, `reasoning` → `#58a6ff`, `tool`/`tool-call` → `#d2a8ff`, `error` → `#f85149`

### Phase 3 — Basic Assistant Footer ✅

- Assistant response has a first-version footer
- Currently displays session-level `provider/model`
- Has a copy hint

### Phase 4 — Permission / Auto-Approve UI ✅

- Auto-approve toggle shows ON/OFF status in the palette
- `/auto` command can toggle it
- Dangerous bash commands trigger an approval dialog (even with auto-approve ON)

---

## Not Implemented (future directions)

### P1 — Coding-Agent Clarity

- Rich tool-specific cards
- Response-scoped diff summary
- Per-message provider/model metadata

### P2 — Interaction Polish

- Working / thinking intermediate state polish
- Paced streaming
- Copy affordance button

### Deferred

- Full opencode-style rich diff viewer
- Overly complex hover / tooltip interactions
- No heavier response chrome until there is clear usage value

---

## Risks And Tradeoffs

### Risk 1 — Current data model lacks per-message metadata

Impact: First version of footer can only show session-level provider/model

### Risk 2 — TUI imitating Web UI becomes too noisy

Impact: Terminal visual density can easily get out of control

### Risk 3 — Response redesign directly affects summary / memory quality

Impact: Future summary quality depends on whether the response structure is clear enough

---

## Next Recommended Work

### P0 — Stability / Readability

- Tool output truncation

### P1 — Coding-Agent Clarity

- Response-scoped diff summary
- Rich tool-specific cards
- Per-message provider/model metadata

### P2 — Interaction Polish

- Smart auto-follow
- Working / thinking polish
- Paced streaming
