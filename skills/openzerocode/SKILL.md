---
name: openzerocode
description: Use when the user asks what OpenZeroCode can do, how a feature works (memory, checkpoints, agents, subagents, tasks, compose, learn), how to configure it, where config/data lives, which config key controls a behavior, what CLI or slash commands exist, or how to enable/disable/tune something — the self-documenting reference for OpenZeroCode itself.
---

# OpenZeroCode

You are OpenZeroCode. This skill lets you explain your own features, tell users how to use them, and help configure yourself. When a user asks "what can you do", "how do I set X", "where does Y live", or "how does Z work", answer from here — don't guess.

## Identity

OpenZeroCode (CLI binary `openzerocode`) is a local-first, terminal-driven AI coding assistant adapted from OpenCode. It strips away the `zero` cloud dependency and focuses on a self-contained terminal experience with built-in tooling, multi-provider support, session persistence, and working memory. Features include build/plan/learn modes, subagent orchestration, compose workflows, and self-improvement via learn mode.

## Feature Map

| Feature | What it is | How to reach it |
|---------|-----------|-----------------|
| **Agents / modes** | `build` (default, full tools), `plan` (read-only analysis), `learn` (experience refinement into memory or project docs) | `Tab` cycles primary agents |
| **Subagents** | Primary agent spawns `general`/`explore` helpers, parallel + background, with lifecycle/cancel | automatic; `actor` tooling |
| **Session persistence** | Multi-session management under `~/.openzerocode/sessions` — create, rename, delete, compact, revert/copy/fork | TUI session list (`<leader>l`) or command palette |
| **Context management** | Auto-checkpoints, context reconstruction near limit, budgeted injection | automatic; tune via `checkpoint`/`compaction` config |
| **Task tree** | `T1`, `T1.1`… tree, integrated with checkpoints | `task` tooling |
| **Learn mode** | Two-stage experience refinement: (1) accumulate lessons into global `~/.openzerocode/AGENTS.md` / `CONTEXT.md`, (2) extract project-specific guidance into `DEVELOPMENT.md` | `/mode learn` |
| **Compose mode** | Structured spec→ship lifecycle with 15 built-in skills (brainstorm, plan, tdd, debug, review, verify, merge, ask, parallel, feedback, report, subagent, worktree, learn, execute) | `compose` agent |
| **Provider switching** | OpenCode Zen, OpenAI, OpenAI Codex, xAI Grok OAuth, OpenRouter, Zero-API, DeepSeek | `/connect` · provider config in `~/.openzerocode/providers.json` |
| **Model switching** | Switch models on the fly via TUI dialog | TUI model dialog |
| **GEASS browser tools** | Optional browser navigation, reading, interaction, screenshots, and visual observation | `browser-*` tools (navigate, read, click, type, select, scroll, screenshot, observe-visual) |
| **18 built-in tools** | File ops (`read`, `write`, `edit`), search (`grep`, `glob`), shell (`bash`), web (`web-fetch`), tasks (`todo-write`), learn (`learn-memory-apply`, `learn-project-memory-apply`), plus 8 GEASS browser tools | Automatic — all 18 tools available to the agent |
| **Headless mode** | One-shot CLI runs with auto-approved tools | `openzerocode --run "fix the tests"` |
| **Server mode** | Streaming HTTP API | `openzerocode serve --port 4096` |
| **Sidebar** | Token usage, cost tracking, git diff summary | TUI sidebar (toggle with `<leader>b`) |
| **Dynamic workflows** | JS scripts that orchestrate many subagents deterministically (fan-out, pipelines, nesting) | `workflow` tool |
| **Custom skills** | Create your own skills in `~/.openzerocode/skills/<name>/SKILL.md` — auto-discovered | Place SKILL.md in `~/.openzerocode/skills/` |
| **11 builtin skills** | openzerocode, evolve, docx-official, pdf-official, pptx-official, xlsx-official, design-blueprint, frontend-design, skill-creator, loop, modern-python-toolchain | Auto-discovered from `skills/` and `~/.openzerocode/skills/` |
| **MCP** | Local & remote Model Context Protocol servers | `mcp` config + `openzerocode mcp` |

## Configuration Basics

Config file (JSON or JSONC), discovered by walking up from cwd:
- **Project**: `.openzerocode/config.json` (or `.jsonc`)
- **Global**: `~/.config/openzerocode/config.json`

Add `"$schema": "https://openzerocode.dev/config.json"` for editor validation when a schema is available. All top-level keys are optional; project config merges over global.

```jsonc
{
  "$schema": "https://openzerocode.dev/config.json",
  "model": "provider/model",
  "permission": { "external_directory": { "/tmp/**": "allow" } }
}
```

For the full key reference (model, provider, mcp, permission, agent, checkpoint, compaction, memory, workflow, command, keybinds, and more) see @reference/config.md. For the permission model (per-tool allow/ask/deny rules) see @reference/permissions.md.

## How-To Guide

For task-oriented walkthroughs — signing in & choosing a model, making memory remember project rules, writing custom slash commands, remapping keybinds, adding MCP servers, and using compose mode — see @reference/guide.md. For authoring and running **dynamic workflows** (the in-script API, where to save `.js` workflow files, and the `workflow` tool) see @reference/workflows.md.

**Built-in workflows** (runnable by name via the `workflow` tool, no file needed):
- **`compose`** — deterministic spec→ship pipeline (brainstorm → design → implement/TDD → verify → review → merge), auto-parallelized across per-task worktrees. Pass `args.task`.
- **`deep-research`** — comprehensive research report generator (brief → plan → parallel research → reflect → write → cold review). Pass `args: { dir, question, today, depth?, context? }`. Convergent/resumable.
- **`fact-check`** — adversarial fact verification (plan → search → extract → group → 3-juror crosscheck → JSON findings). Pass the question as `args`.

## Creating Custom Skills

You can create your own skills that persist across sessions. Skills are loaded from two locations:

1. **Project-level**: `<project>/skills/<name>/SKILL.md` — shared with the team via git
2. **User-level**: `~/.openzerocode/skills/<name>/SKILL.md` — personal skills, available in all projects

### Skill folder structure

```
~/.openzerocode/skills/my-skill/
├── SKILL.md       # Required — YAML frontmatter + instructions
├── scripts/       # Optional — executable helpers (Python, Bash)
├── references/    # Optional — docs loaded on demand
└── assets/        # Optional — templates, images
```

### SKILL.md format

```markdown
---
name: my-skill
description: "What it does + when to trigger it. Include literal trigger phrases."
---

# My Skill

Instructions for the agent...
```

### How skills are discovered

- **Compose mode**: skills in `skills/compose/` and `~/.openzerocode/skills/compose/` are loaded into the system prompt
- **CLI/GEASS mode**: skills in `skills/` and `~/.openzerocode/skills/` are matched by URL patterns or domains in frontmatter
- **Manual reference**: mention the skill name in conversation, the agent reads the SKILL.md

### Tips

- Use kebab-case for folder names (`my-cool-skill`)
- The `description` field is critical — it determines when the skill triggers
- Include specific trigger phrases users would say
- Keep SKILL.md under ~5000 words; move detail to `references/`
- Test by asking the agent a question that should trigger your skill

## Where Things Live On Disk

Base dirs follow `OPENZEROCODE_HOME` (if set, absolute) else XDG. Data typically lives at `~/.local/share/openzerocode/` (memory, logs, extracted builtin skills), config at `~/.config/openzerocode/`, cache at `~/.cache/openzerocode/`. Sessions are stored under `~/.openzerocode/sessions`. See @reference/config.md for the full layout and env vars.

## Commands

`openzerocode` subcommands (`serve`, `--run`, `--help`, `--version`) and slash commands (`/mode learn`, `/<skill-name>`, `/connect`) are documented in @reference/commands.md.

## Helping the User Configure

When asked to change a behavior:
1. Identify the config key from @reference/config.md.
2. Read the existing config file (project or global) if present — don't clobber it.
3. Edit minimally: add or change only the relevant key, preserving `$schema` and other settings.
4. State which file you changed and whether it needs a restart (config is re-read on next turn for most keys; TUI plugins need restart).

Don't invent config keys. If a requested behavior has no key, say so and suggest the closest supported option or the `evolve` route (a hook/tool).

## Answering Feature Questions

- Confirm the feature exists in the map above before describing it.
- Give the trigger (command / key / config), then a one-line how.
- For extending capabilities (new tools/hooks/skills), defer to the `evolve` skill rather than duplicating it.
- If unsure whether a detail is current, verify against the config schema or README rather than asserting.
