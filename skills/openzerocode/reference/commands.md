# OpenZeroCode Commands Reference

## CLI (`openzerocode <command>`)

Invoked from the shell. `openzerocode` with no command opens the TUI.

| Command | Purpose |
|---------|---------|
| `openzerocode` | Launch the interactive TUI |
| `openzerocode --run "<prompt>"` | Headless, non-interactive run with auto-approved tools |
| `openzerocode serve --port <port>` | Start the streaming HTTP API server |
| `openzerocode --version` | Print version |
| `openzerocode --help` | Print CLI help |

Run `openzerocode --help` for flags.

Notable TUI flags: `--run "<prompt>"` (headless mode), `--continue`/`-c` (resume last session), `--session`/`-s`, `--model`/`-m`.

## Slash commands (inside the TUI)

| Command | Purpose |
|---------|---------|
| `/mode learn` | Switch to Learn mode for experience refinement into global memory or project `DEVELOPMENT.md` |
| `/connect` | Sign in to a provider (e.g. OpenRouter) |
| `/<skill-name>` | Invoke any available skill directly by name |

## Keybindings

- `Tab` — cycle primary agents (build → plan → learn).
- Other keybinds are configurable; the keybinds config module governs them.

Common defaults: `<leader>n` new session · `<leader>l` list sessions · `<leader>e` open external editor · `<leader>t` themes · `<leader>b` toggle sidebar · `ctrl+r` rename session. Set a binding to `"none"` to disable it.

## Notes

- The web command is currently disabled; TUI is the supported interface.
