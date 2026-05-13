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

Alternative entrypoint:

```bash
npm run start:tui
```

Development watch mode:

```bash
npm run dev
```

Typecheck:

```bash
npm run typecheck
```

Targeted tests:

```bash
npx tsx --test <file>
```

## Provider Keys

Provider credentials can be set in a local config file:

```text
~/.openzerocode/providers.json
```

Shape:

```json
{
  "providers": {
    "openrouter": {
      "activeKey": "default",
      "keys": {
        "default": "sk-or-...",
        "backup": "sk-or-..."
      }
    }
  }
}
```

Notes:

- Each provider can have multiple named keys.
- `activeKey` selects which key the runtime uses for that provider.
- Config file values are used before environment variables.
- You can inspect and switch configured keys in the TUI with:
  - `/provider-key path`
  - `/provider-key list <provider>`
  - `/provider-key use <provider> <key-name>`

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
         │  - openrouter
         │
         └─ tool layer
            - read / write / grep / glob
            - bash / edit / web-fetch
```

## Notes

- Main implementation entry is `src/client/tui.tsx`.
- Provider registry lives in `src/provider/registry.ts`.
- Built-in tool registration lives in `src/tool/registry.ts`.
- Current response redesign notes are in `docs/response-redesign-notes.md`.
