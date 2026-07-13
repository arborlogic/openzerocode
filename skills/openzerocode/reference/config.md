# OpenZeroCode Configuration Reference

## File locations & precedence

Config is JSON or JSONC. OpenZeroCode discovers it by walking up from the cwd to the worktree root, then falls back to global.

- Project: `.openzerocode/config.json` or `.openzerocode/config.jsonc`
- Global: `~/.config/openzerocode/config.json` (XDG config dir)

Project config merges **over** global. Include `"$schema": "https://openzerocode.dev/config.json"` for validation when a schema is available.

## On-disk data layout

Base directories resolve from `OPENZEROCODE_HOME` if set (must be absolute → `<home>/{data,cache,config,state}`), otherwise from XDG:

| Kind | Default location | Holds |
|------|------------------|-------|
| data | `~/.local/share/openzerocode/` | memory, logs, `builtin_skills/<version>/`, bin |
| config | `~/.config/openzerocode/` | global `config.json` |
| cache | `~/.cache/openzerocode/` | caches, downloaded bins |
| state | `~/.local/state/openzerocode/` | runtime state |
| sessions | `~/.openzerocode/sessions/` | session persistence |

Memory files live under `~/.local/share/openzerocode/memory/`:
- `projects/global/MEMORY.md` — project memory
- `sessions/<id>/checkpoint.md`, `notes.md`, `tasks/<id>/progress.md`
- `global/MEMORY.md` — cross-project user preferences

## Environment variables & flags

- `OPENZEROCODE_HOME` — override all base dirs (absolute path).
- `OPENZEROCODE_DISABLE_LOG_ROTATION` — keep a single growing log file instead of rotating.
- `OPENZEROCODE_TEXT_TOOL_CALL_RETRY_LIMIT` — retries when a model emits a tool call as prose markup instead of a structured call (default 2).
- `OPENZEROCODE_DISABLE_BUILTIN_SKILLS`, `_COMPOSE_SKILLS`, `_EXTERNAL_SKILLS` — feature toggles.
- `OPENZERO_MODEL` — override the default model used by headless `--run` mode.
- `OPENZEROCODE_PROVIDER_CONFIG` — override the provider config path (default `~/.openzerocode/providers.json`).

## Top-level config keys

All optional.

### Models & providers
| Key | Purpose |
|-----|---------|
| `model` | Primary model, `provider/model` (e.g. `openai/gpt-4o`) |
| `small_model` | **Legacy / not recommended** — if set, its literal `provider/model` still wins for cheap tasks (title generation, etc.); if unset, cheap tasks route through the `lite` group |
| `model_groups` | Named capability tiers usable anywhere a model string is accepted — see [Model groups](#model-groups) |
| `provider` | Custom provider configs & model overrides |
| `enabled_providers` / `disabled_providers` | Allowlist / blocklist providers |

### Model groups

`model_groups` lets you define named capability tiers and reference them by name (e.g. `"ultra"`) anywhere a `provider/model` string is accepted — the `model` key, an agent's model, the `actor` subagent `model` argument, and workflow model tiers.

Each group maps a name to either a single default model (string shorthand) or an object with a `default` plus optional member `models`:

```jsonc
{
  "$schema": "https://openzerocode.dev/config.json",
  "model_groups": {
    "lite": "openai/gpt-4o-mini",
    "standard": {
      "default": "openai/gpt-4o",
      "models": ["openai/gpt-4o", "openrouter/provider/model"]
    },
    "ultra": "openai/o3"
  },
  "model": "standard"
}
```

**Resolution rules:**
- A ref containing `/` is a literal `provider/model` and is used as-is.
- A ref without `/` is a group name. If configured, OpenZeroCode is **provider-aware**: it prefers a member on the caller's current provider, otherwise falls back to the group's `default`.
- `ultra`, `standard`, `lite` are **built-in tier names**. If you reference one but haven't configured it, it silently falls back to the default model (zero-config never errors).
- Any other unconfigured name errors with fuzzy suggestions of your defined groups.
- Cheap-task (small) model: **configure the `lite` group** — that is the recommended path. The legacy `small_model` literal, if set, still takes precedence for back-compat, but is not recommended for new configs.

Use groups when you want one label (`"standard"`) to map to different concrete models per provider, or to swap tiers globally without editing every agent/model reference.

### Agents
| Key | Purpose |
|-----|---------|
| `default_agent` | Primary agent when none specified (falls back to `build`) |
| `agent` | Per-agent config: `plan`, `build`, `general`, `explore`, `title`, `summary`, `compaction`, plus custom |
| `username` | Display name in conversations |

Prefer a markdown file (`.openzerocode/agent/<name>.md`, body = system prompt) for defining a custom agent/mode — see the "Custom agents & modes" section in @guide.md. Use the `agent` config key for short, inline per-agent overrides.

### Tools, skills, MCP, extensions
| Key | Purpose |
|-----|---------|
| `skills` | `paths[]` extra skill folders + `urls[]` remote skill indexes |
| `mcp` | MCP servers: `local` (command/env) or `remote` (url/headers/oauth); `{ "enabled": false }` disables one |
| `tools` | Record of tool-id → boolean enable/disable |
| `tool.invocation_style` | `json` (default) or `shell`; `tool.invocation_style_by_tool` for per-tool override |
| `command` | Custom slash commands |
| `plugin` | Plugin specs |
| `formatter`, `lsp` | Formatter & language-server config |
| `instructions` | Extra instruction files/globs to include |
| `permission` | Permission rules incl. `external_directory` allowlist |

### Context management
| Key | Purpose |
|-----|---------|
| `compaction.auto` | Auto-compact when context full (default true) |
| `compaction.prune` | Prune old tool outputs (default true) |
| `compaction.tail_turns` | Recent user turns kept verbatim (default 2) |
| `compaction.preserve_recent_tokens` | Max recent tokens kept verbatim |
| `compaction.reserved` | Token buffer to avoid overflow |
| `checkpoint.thresholds` | Context-fill triggers, e.g. `["40%","60%","80%"]` |
| `checkpoint.reserved` | Token buffer for checkpoint ops (default 20000) |
| `checkpoint.max_writer_failures` | Consecutive writer failures before pausing (default 3) |
| `checkpoint.fork` | Fork parent prefix into writer session for cache reuse (default false) |
| `checkpoint.push_caps.*` | Per-section token caps for rebuild context (tasks_ledger, focus_task, checkpoint, memory, notes, global, recent_user, …) |
| `checkpoint.task_archive_days` | Days before done/abandoned tasks filtered out (default 7) |
| `checkpoint.memory_search_score_floor` | BM25 relative floor for memory search (default 0.15) |
| `history` | Conversation-history FTS index config |

### Compose & workflows
| Key | Purpose |
|-----|---------|
| `compose` | Compose mode config (`docs` dir default `docs/compose`, `docs_absolute`) |
| `workflow.maxConcurrentAgents` | Process-wide subagent concurrency ceiling (default min(16, 2×cores)) |
| `workflow.maxDepth` | Max workflow nesting depth (default 8) |

### Misc
| Key | Purpose |
|-----|---------|
| `autoupdate` | `true` / `false` / `"notify"` |
| `share` | `"manual"` / `"auto"` / `"disabled"` |
| `snapshot` | Filesystem snapshot tracking for undo/redo (default true) |
| `logLevel` | Log verbosity |
| `server` | Config for `openzerocode serve` |

## Example: common tweaks

```jsonc
{
  "$schema": "https://openzerocode.dev/config.json",
  "model": "openai/gpt-4o",
  "model_groups": { "lite": "openai/gpt-4o-mini" },
  "compaction": { "tail_turns": 3 },
  "permission": { "external_directory": { "/tmp/**": "allow" } },
  "mcp": {
    "my-server": { "type": "local", "command": ["node", "server.js"] }
  }
}
```
