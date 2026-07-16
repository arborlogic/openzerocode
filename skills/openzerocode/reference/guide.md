# OpenZeroCode Usage Guide

How-to for the features users most often ask about. For config keys see @config.md; for permissions see @permissions.md; for commands see @commands.md.

## Getting started & auth

1. **Sign in** — `/connect` from inside the TUI signs in to a provider (e.g. OpenRouter). Provider API keys are auto-detected from environment variables.
2. **Pick a model** — set `"model": "provider/model"` in config, or switch live in the TUI model dialog.
3. **List what's available** — `openzerocode --help` shows CLI flags; the TUI command palette shows available models.

## Memory: making OpenZeroCode remember

Memory persists across sessions and is auto-injected on resume, so the agent doesn't relearn project context.

- **Project rules / architecture** — edit `MEMORY.md` (project memory). Durable rules go under `## Rules`, design decisions under `## Architecture decisions`. The agent may also write here at checkpoint time.
- **Checkpoints** (`checkpoint.md`) are maintained *only* by the checkpoint-writer subagent — don't hand-edit them.
- **Scratch notes** (`notes.md`) are the agent's free-form scratchpad.
- To make a rule stick immediately without waiting for a checkpoint, just tell the agent — it can edit `MEMORY.md` directly.

Tune memory behavior with `checkpoint.*` and `compaction.*` (see @config.md).

## Custom slash commands

Drop a markdown file at `.openzerocode/command/<name>.md` (or `.openzerocode/commands/`, `.claude/command(s)/` are also read). The frontmatter configures it; the body is the prompt template.

```markdown
---
description: Review the current diff for security issues
agent: build
model: standard
subtask: false
---
Review the staged diff. Focus on: $ARGUMENTS
```

- Invoke with `/name your args here`.
- Placeholders: `$ARGUMENTS` (all args), `$1`, `$2`, … (positional). If none are present, args are appended.
- `agent` picks which agent runs it; `model` accepts a `provider/model` or a group name; `subtask: true` runs it as a subagent.

Commands hot-reload on the next turn.

## Custom agents & modes (file-based system prompts)

A "mode" is just a **primary agent** with its own system prompt. To give OpenZeroCode a custom mode, drop a markdown file — no code, no server changes. The frontmatter is config; the **markdown body becomes the agent's system prompt**.

```markdown
---
description: A friendly general-purpose assistant for everyday chat and Q&A
mode: primary
temperature: 0.7
---
You are "General" — a warm, concise, general-purpose assistant.
Keep replies short unless asked to elaborate; you are not focused on coding.
```

Where to put the file (all hot-reloaded on the next turn; `.claude/agent(s)` are also read):

| Path | Scope |
|------|-------|
| `.openzerocode/agent/<name>.md` (or `agents/`) | project agent — most common |
| `.openzerocode/mode/<name>.md` (or `modes/`) | project mode — same as an agent forced to `mode: primary` |
| `~/.config/openzerocode/agent/<name>.md` | global agent, available in every project |

Frontmatter fields (all optional except that the body should be non-empty):

- `mode` — `primary` (selectable with `Tab`, replaces the base prompt for the session), `subagent` (spawnable by a primary via the `actor`/`task` tools), or `all`. Files under `mode/` are always primary.
- `model` — a `provider/model` or a group name (`ultra`/`standard`/`lite`); `variant`, `temperature`, `top_p` tune generation.
- `description` — when to use it (shown in the `@` autocomplete for subagents).
- `permission`, `tool_allowlist`, `tools`, `steps`, `color`, `hidden` — see @config.md.

**How it reaches the model:** for a primary agent the body is used as the base system prompt in place of the model's default prompt; the usual environment/skills/instructions blocks are still appended. Selecting the mode is session-scoped — the TUI `Tab` picker or, over the SDK, the `agent` field on `session.prompt`.

Verify a file loaded with `openzerocode agent list` — your agent shows up with its `(primary)` / `(subagent)` mode.

Config-file alternative: instead of a `.md` file you can inline an agent under the `agent` config key (`agent.<name>.prompt`, plus `model`, `mode`, …); the markdown form is preferred for anything beyond a couple of lines.

## Keybinds

All TUI keybinds are remappable under the `keybinds` config. The leader key defaults to `ctrl+x`, so `<leader>` in a binding means "press ctrl+x then …".

Common defaults: `Tab` cycle agents · `<leader>n` new session · `<leader>l` list sessions · `<leader>e` open external editor · `<leader>t` themes · `<leader>b` toggle sidebar · `ctrl+r` rename session. Set a binding to `"none"` to disable it.

```jsonc
{ "keybinds": { "session_new": "<leader>c", "sidebar_toggle": "none" } }
```

## MCP servers

Add servers under the `mcp` key. Two kinds:

```jsonc
{
  "mcp": {
    // local: spawn a process over stdio
    "fs": { "type": "local", "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."] },
    // remote: connect to an HTTP endpoint (OAuth auto-detected; set "oauth": false to disable)
    "docs": { "type": "remote", "url": "https://mcp.example.com", "headers": { "Authorization": "Bearer ..." } },
    // disable one without deleting it
    "old": { "enabled": false }
  }
}
```

Inspect/manage with `openzerocode mcp`. Request timeout defaults to 5000ms (`timeout` per server, or `experimental.mcp_timeout` globally).

## Compose mode

Compose is a specs-driven orchestration agent: it coordinates 15 built-in skills (brainstorm, plan, tdd, debug, review, verify, merge, ask, parallel, feedback, report, subagent, worktree, learn, execute) across the full spec→ship lifecycle. Switch to it with `Tab`.

Artifacts land under `docs/compose/` by default (`specs/`, `plans/`, `reports/`). Change the location with `compose.docs`; set `compose.docs_absolute: true` to anchor a relative path to the worktree root.

For well-defined tasks that split into independent subtasks, prefer the deterministic **`compose` workflow** (fire-and-forget, auto-parallelized) over the agent — see @workflows.md.

## Jupyter notebooks

The `notebook-edit` tool edits `.ipynb` cells directly (replace / insert / delete a single cell) while preserving the surrounding JSON, outputs, and metadata — prefer it over raw text edits on notebooks.

## Learn mode

`/mode learn` switches the agent into a two-stage experience-refinement workflow:

1. **Accumulate experience globally** — the user can ask the AI to distill lessons from the current project state and discussion context. After the AI presents the exact target and text, and only after explicit confirmation, it may call `learn_memory_apply` to update global `~/.openzerocode/AGENTS.md` or `~/.openzerocode/CONTEXT.md`.
2. **Extract experience into a project** — later, the user can ask Learn mode to read/search the project plus global memory, select relevant reusable guidance, and write confirmed project-local guidance to `<workspace>/DEVELOPMENT.md` via `learn_project_memory_apply`.

Learn mode does not expose general edit/write/bash tools.

## Extending OpenZeroCode

To add project-local tools, hooks, or skills, follow the project's extension conventions and add the relevant files under `.openzerocode/tools/`, `.openzerocode/hooks/`, or `.openzerocode/skills/<name>/SKILL.md`. These extensions are hot-reloaded on the next turn.
