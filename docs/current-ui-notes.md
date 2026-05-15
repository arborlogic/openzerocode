# OpenZeroCode — Current UI Notes

> **Status: ✅ Stable — This document records the v1 implemented UI.**

This document records the current UI interactions that have been implemented, gaps that remain unimplemented, and recommended next steps.

---

## Implemented Features

### Core UI

- Main entry point is `src/client/tui.tsx`
- Response area uses `scrollbox`
- Response is turn-oriented transcript groups
- Mouse wheel and PgUp/PgDn only affect the response area

### Input & Interaction

- Escape behavior:
  - Clears input when there is a draft
  - Interrupts the current run during execution when draft is empty
- Up / Down input history implemented, up to 100 entries
- Spinner animation during execution implemented
- `/exit` and `Ctrl+C` destroy the renderer before exiting

### Mode Switching

- Build / Plan mode switching implemented
- Provider / model command palette implemented

### Session Management

- Session list / rename / delete / compaction implemented

### Response Display

- Assistant response streams in real-time
- `Thinking` block streams in real-time
- Reasoning / tool / error blocks are collapsible
- Assistant response footer:
  - `provider/model`
  - copy hint
- Selection copy implemented (onMouseUp → renderer selection → clipboard)

#### Entry Left-Border Color Scheme

Each entry type has a dedicated left border color for visual hierarchy.
There is no outer wrapper border — borders are applied per-entry only.

| Entry kind   | Border color       | Hex       |
|--------------|--------------------|-----------|
| `assistant`  | `accentDim`        | `#1f6feb` |
| `reasoning`  | `accent`           | `#58a6ff` |
| `tool-call`  | `tool`             | `#d2a8ff` |
| `tool`       | `tool`             | `#d2a8ff` |
| `error`      | `error`            | `#f85149` |
| `user`       | `user`             | `#7ee787` |
| `system`     | none               | —         |

### Sidebar

- Shows context, estimated cost, git diff summary

### Permission / Auto-Approve

- `/auto` or `/auto-approve` command toggles auto-approve mode
- Palette displays Auto-approve toggle (ON/OFF)
- When auto-approve is ON:
  - Read-only tools (read/grep/glob/web-fetch) auto-approved
  - write/edit auto-approved
  - Non-destructive bash auto-approved
  - Destructive bash still shows approval dialog
- Permission rules accumulate: each allow action auto-adds a rule
- Auto-approve state is persisted to session JSON

## Not Implemented

- Smart auto-follow (`stickyScroll` is a partial solution, not full auto-follow)
- Paced streaming
- Diff view
- Response-scoped diff summary
- Rich tool-specific cards
- Copy affordance button (currently only a hint)
- Reasoning collapse / side panel

## Test Coverage

| Test | File |
|------|------|
| Autocomplete | `autocomplete.test.ts` |
| Commands | `commands.test.ts` |
| Errors | `errors.test.ts` |
| Markdown | `markdown.test.ts` |
| Permission rules | `permission-rules.test.ts` |

## Next Recommended UI Work

### P0 — Stability / Readability

- Tool output truncation
- Smart auto-follow

### P1 — Coding-Agent Clarity

- Response-scoped diff summary
- Rich tool-specific cards
- Per-message provider/model metadata

### P2 — Interaction Polish

- Paced streaming
- Copy affordance button
- Reasoning collapse / side panel
