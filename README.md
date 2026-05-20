# OpenZeroCode

> **Terminal-first AI coding agent — inspired by [OpenCode](https://github.com/sst/opencode).**

OpenZeroCode is a local-first, TUI-driven AI coding assistant adapted from the OpenCode direction. It strips away the `zero` cloud dependency and focuses on a self-contained terminal experience with built-in tooling, multi-provider support, and working memory.

![OpenZeroCode preview](./preview01.png)

---

## Inspiration

This project is **heavily inspired by OpenCode** (by [SST](https://sst.dev)), a terminal-native AI coding agent. OpenZeroCode started as a fork of OpenCode's architecture and has since evolved its own identity:

- **Same foundation**: SolidJS terminal UI (`@opentui`), provider abstraction, tool system, session persistence
- **Different focus**: Local-first, independent of the `zero` ecosystem, extensible for custom workflows
- **Shared lineage**: Provider registry, tool registration, and build pipeline patterns derive from OpenCode

We're grateful for the OpenCode project's design — this project wouldn't exist without it.

---

## Current State

This repo is actively implemented. Current capabilities include:

- **Solid-based terminal UI** in `src/client/tui.tsx` — streaming responses, reasoning display, command palette
- **Build / Plan mode** toggle for structured vs. free-form agent behavior
- **Provider switching** — bring your own API keys (OpenRouter, custom endpoints)
- **Model switching** — switch models on the fly
- **Multi-session persistence** under `~/.openzerocode/sessions`
- **Session management** — rename, delete, compact
- **Sidebar context** — token usage, cost tracking, git diff summary
- **Workspace prompt memory** — `AGENTS.md` instructions + `CONTEXT.md` project context injected into the system prompt
- **Session handoff** — `SESSION_SUMMARY.md` for concise local continuation notes
- **7 built-in tools**:
  | Tool | Description |
  |------|-------------|
  | `read` | Read file contents |
  | `write` | Write / overwrite files |
  | `grep` | Search file contents by pattern |
  | `glob` | Find files by glob pattern |
  | `bash` | Execute shell commands |
  | `edit` | Targeted string replacement edits |
  | `web-fetch` | Fetch content from URLs |

---

## Quick Start

### Prerequisites

- **bun** ≥ 1.2
- **npm** on your `PATH` (used by the dev install flow)

### Install from source

```bash
git clone https://github.com/arborlogic/openzerocode.git
cd openzerocode
python3 scripts/dev-install.py
```

This is the supported install path today. It installs dependencies, rebuilds `dist/openzerocode` with a timestamped `-dev.YYYYMMDDHHMMSS` version suffix, and runs `npm install -g .` so the global `openzerocode` command points at that locally built binary.

### Run

```bash
openzerocode
```

### Development mode

```bash
npm run dev
```

### Updating

```bash
git pull
python3 scripts/dev-install.py
```

That refreshes dependencies, rebuilds the binary, and reinstalls the global `openzerocode` command from your local checkout.

### Command-line flags

| Flag | Effect |
|------|--------|
| `--build` | Start in build mode |
| `--plan` | Start in plan mode |
| `--model <name>` | Override the default model |
| `--provider <name>` | Override the default provider |

### Alternative entrypoint

```bash
npm run start:tui
```

---

## Provider Configuration

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

**Notes:**

- Each provider can have multiple named keys.
- `activeKey` selects which key the runtime uses for that provider.
- Config file values take precedence over environment variables.
- You can inspect and switch keys inside the TUI with these slash commands:
  - `/provider-key path`
  - `/provider-key list <provider>`
  - `/provider-key use <provider> <key-name>`

---

## Development

```bash
# Type check
npm run typecheck

# Run all unit tests (excludes provider-integration tests)
npm run test:unit

# Run a single test file
npx tsx --test src/client/workspace-memory.test.ts
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed guidance on:
- Building standalone binaries
- Cross-platform distribution
- The build system & `Bun.build()` compilation

---

## Architecture

```text
┌─ TUI client ──────────────────────────────────┐
│  src/client/tui.tsx                            │
│  - transcript / response rendering             │
│  - command palette & autocomplete              │
│  - session management (create, rename, delete) │
│  - build / plan mode toggle                    │
│  - sidebar: token usage, cost, git summary     │
│  - working memory injection                    │
└────────┬───────────────────────────────────────┘
         │
         ├── provider layer ─────────────────────┐
         │  src/provider/registry.ts             │
         │  - OpenRouter (openrouter)            │
         │  - Big Pickle (big-pickle)            │
         │  - Extensible via registry            │
         └───────────────────────────────────────┘
         │
         └── tool layer ─────────────────────────┐
            src/tool/registry.ts                 │
            - read / write / grep / glob         │
            - bash / edit / web-fetch            │
            - Permission system                  │
            └────────────────────────────────────┘
```

## Workspace Memory Model

OpenZeroCode separates repo memory into three lightweight artifacts:

- `AGENTS.md`: stable repo-specific instructions, workflows, and guardrails.
- `CONTEXT.md`: background context, shared vocabulary, and known mismatches worth surfacing in prompts.
- `SESSION_SUMMARY.md`: concise handoff notes for humans/continuation; not auto-injected into the system prompt.

The current automatic prompt assembly path loads `AGENTS.md` and `CONTEXT.md` from the nearest workspace via `src/client/workspace-memory.ts`.

### Key source files

| File | Purpose |
|------|---------|
| `src/client/tui.tsx` | Main TUI entrypoint & UI orchestration |
| `src/client/sessions.ts` | Session persistence helpers |
| `src/client/workspace-memory.ts` | Loads `AGENTS.md` and `CONTEXT.md` into the system prompt |
| `SESSION_SUMMARY.md` | Manual session handoff / continuation notes |
| `src/provider/registry.ts` | Provider registration & resolution |
| `src/tool/registry.ts` | Built-in tool registration |

---

## Relationship to OpenCode

| Aspect | OpenCode | OpenZeroCode |
|--------|----------|--------------|
| **Runtime** | Requires `zero` cloud service | Self-contained, local-first |
| **TUI framework** | `@opentui` (SolidJS) | `@opentui` (SolidJS) — same |
| **Provider layer** | OpenRouter, others | OpenRouter, Big Pickle, extensible |
| **Tool system** | Built-in tools | Same 7 tools + permission system |
| **Session storage** | Local files | Local files under `~/.openzerocode/` |
| **Prompt memory** | Varies | `AGENTS.md` + `CONTEXT.md` are injected into the local system prompt |
| **Cloud dependency** | Requires `zero` for operation | None — works entirely offline |
| **Binary distribution** | Platform-specific npm packages | Source-first local install via `python3 scripts/dev-install.py` |

---

## License

MIT — see [LICENSE](./LICENSE).
