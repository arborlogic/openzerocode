# OpenZeroCode

Terminal-first coding agent UI adapted from the `opencode` direction for a local TUI workflow.

## Current State

This repo is actively implemented. Current capabilities include:

- Solid-based terminal UI in `src/client/tui.tsx`
- streaming assistant responses
- reasoning display
- build / plan mode
- provider switching
- model switching
- command palette
- multi-session persistence under `~/.openzerocode/sessions`
- session rename / delete / compaction
- sidebar context, token, cost, and git diff summary
- built-in tools:
  - `read`
  - `write`
  - `grep`
  - `glob`
  - `bash`
  - `edit`
  - `web-fetch`

## Run

```bash
npm run start
```

Development watch mode:

```bash
npm run dev
```

Typecheck:

```bash
npm run typecheck
```

## Architecture

```text
┌─ TUI client ──────────────────────────┐
│  src/client/tui.tsx                   │
│  - transcript / response rendering    │
│  - command palette                    │
│  - session management                 │
│  - build / plan mode                  │
│  - sidebar context + git summary      │
└────────┬──────────────────────────────┘
         │
         ├─ provider layer
         │  - openapi / big-pickle
         │  - cloudflare
         │
         └─ tool layer
            - read / write / grep / glob
            - bash / edit / web-fetch
```

## Notes

- Main implementation entry is `src/client/tui.tsx`.
- Provider registry lives in `src/provider/registry.ts`.
- Built-in tool registration lives in `src/tool/registry.ts`.
- Current response redesign notes are in `docs/response-redesign-roadmap.md`.
