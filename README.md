# OpenZeroCode

[繁體中文](./README.zh-TW.md) | [简体中文](./README.zh-CN.md)

> **Terminal-first AI coding agent — inspired by [OpenCode](https://github.com/sst/opencode).**

OpenZeroCode is a local-first, TUI-driven AI coding assistant adapted from the OpenCode direction. It strips away the `zero` cloud dependency and focuses on a self-contained terminal experience with built-in tooling, multi-provider support, and working memory.

![OpenZeroCode preview](./preview01.png)

---

## Inspiration

This project is **heavily inspired by OpenCode**, a terminal-native AI coding agent. OpenZeroCode started as a fork of OpenCode's architecture and has since evolved its own identity:

- **Same foundation**: SolidJS terminal UI (`@opentui`), provider abstraction, tool system, session persistence
- **Different focus**: Local-first, independent of the `zero` ecosystem, extensible for custom workflows
- **Shared lineage**: Provider registry, tool registration, and build pipeline patterns derive from OpenCode

We're grateful for the OpenCode project's design — this project wouldn't exist without it.

---

## Current State

This repo is actively implemented. Current capabilities include:

- **Solid-based terminal UI** in `src/client/tui.tsx` — streaming responses, reasoning display, command palette, queued input, steering, and long-session rendering controls
- **Build / Plan / Compose modes** — direct implementation, read-only inspection/planning, and a skills-driven spec/TDD/verify/review workflow
- **Productive / Lite harness profiles** — the default full agent harness plus a smaller prompt/tool surface for constrained local models
- **Provider switching** — OpenCode Zen, OpenAI, OpenAI Codex, xAI OAuth, OpenRouter, Zero-API, DeepSeek, and native Ollama
- **Model + reasoning switching** — change model at runtime and set supported reasoning effort levels with `/reasoning`
- **Multi-session persistence** under `~/.openzerocode/sessions`
- **Session management** — rename, delete, compact, export, timeline actions (revert/copy/fork), and automatic context compression
- **Autopilot** — `standard` for routine continuation and `goal` for advancing an approved goal across turns
- **Skills** — bundled, project, and user-global `SKILL.md` discovery with optional automatic per-request routing; Compose mode has its own structured skill workflow
- **Headless and server modes** — `--run` for one-shot CLI runs and `serve` for the streaming HTTP API
- **Peer collaboration** — named local OpenZeroCode processes can discover and call one another with bounded hop/round-trip guards
- **MCP tools** — configured MCP servers can be loaded as selectable dynamic tool groups
- **Prompt memory** — only user-global `~/.openzerocode/AGENTS.md` and `~/.openzerocode/CONTEXT.md` are automatically injected when non-empty
- **Learnings** — `/learn` uses `compose:learn` to extract non-obvious project learnings to `docs/compose/learnings/PROJECT.md` or cross-project learnings to `~/.openzerocode/LEARNINGS.md`
- **Session handoff** — project `SESSION_SUMMARY.md` is a manual continuation artifact and is not auto-injected
- **GEASS browser + vision tools** — optional browser navigation/interaction, screenshots, native-model vision, and local-VLM fallback
- **19 built-in tools**:
  | Tool | Description |
  |------|-------------|
  | `read` | Read file contents |
  | `write` | Write / overwrite files |
  | `grep` | Search file contents by pattern |
  | `glob` | Find files by glob pattern |
  | `bash` | Execute shell commands |
  | `edit` | Targeted string replacement edits |
  | `apply_patch` | Apply add/update/delete patches across files |
  | `web_fetch` | Fetch content from URLs |
  | `todowrite` | Maintain a structured task list during multi-step work |
  | `browser_navigate` | Navigate the connected GEASS browser to a URL |
  | `browser_read` | Read structured content from the current GEASS browser page |
  | `browser_click` | Click page elements in the GEASS browser |
  | `browser_type` | Type into inputs in the GEASS browser |
  | `browser_select` | Select dropdown options in the GEASS browser |
  | `browser_scroll` | Scroll the current GEASS browser page |
  | `browser_screenshot` | Capture a browser screenshot |
  | `browser_observe_visual` | Inspect the current browser view visually, optionally through the local VLM |
  | `analyze_image` | Analyze an image through native model vision or local-VLM fallback |
  | `call_peer` | Delegate or send a message to another named local OpenZeroCode peer |

MCP tools are registered dynamically and are not included in the built-in tool count.

![OpenZeroCode TUI session](./docs/assets/openzerocode-demo.gif)

---

## Quick Start

### Prerequisites

For source development, use **bun** ≥ 1.2 and **npm** on your `PATH`.

#### Linux clipboard support

OpenZeroCode uses a system clipboard tool for copy and paste on Linux. Install the package that matches your desktop session:

- **Wayland** (including Kubuntu running a Wayland session): `wl-clipboard`
- **X11/Xorg**: `xclip` or `xsel`

For Debian, Ubuntu, or Kubuntu:

```bash
# Wayland
sudo apt install wl-clipboard

# X11/Xorg (choose either one)
sudo apt install xclip
# or: sudo apt install xsel
```

OpenZeroCode tries Wayland and X11 tools in the order appropriate for the current session. WSL uses the Windows clipboard through `clip.exe` and PowerShell when available.

### Install script

The release installer follows opencode's user-level install style: it installs the binary to `~/.openzerocode/bin` and updates your shell config to add that directory to `PATH` when needed.

```bash
curl -fsSL https://github.com/arborlogic/openzerocode/releases/latest/download/install | bash
```

Use `--no-modify-path` if you want to update `PATH` manually, or set `OPENZEROCODE_INSTALL_DIR` to choose a different writable install directory.

### Install from npm

Supported prebuilt npm targets:

- `darwin-arm64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`

Install with:

```bash
npm install -g openzerocode
```

The root package installs a small Node launcher and resolves the matching optional platform package at runtime.

### Install from source

```bash
git clone https://github.com/arborlogic/openzerocode.git
cd openzerocode
python3 scripts/dev-install.py
```

This remains the supported local development install path. It installs dependencies, rebuilds `dist/openzerocode` with a timestamped `-dev.YYYYMMDDHHMMSS` version suffix, and runs `npm install -g .` so the global `openzerocode` command points at that locally built binary. Built-in skills are included in the installed package and deployed beside that binary.

### Run

```bash
openzerocode
```

### Development mode

```bash
npm run dev
```

### Updating

OpenZeroCode does not currently update itself or download updates in the background. Users must update it manually using the same method they originally used to install it.

**Install script:** rerun the installer to replace the installed binary with the latest GitHub Release:

```bash
curl -fsSL https://github.com/arborlogic/openzerocode/releases/latest/download/install | bash
```

If you originally set `OPENZEROCODE_INSTALL_DIR`, set it to the same directory when updating.

**npm:** install the latest published version globally:

```bash
npm install -g openzerocode@latest
```

**Source checkout:** pull the latest source and rebuild the local development installation:

```bash
git pull
python3 scripts/dev-install.py
```

That refreshes dependencies, rebuilds the binary, and reinstalls the global `openzerocode` command from your local checkout.

After updating, verify the installed version with:

```bash
openzerocode --version
```

### npm packaging workflow

The published npm artifacts use a "root launcher + platform packages" structure:

- Root package `openzerocode` ships only the Node launcher `bin/openzerocode.js`
- Platform binaries live in `@openzerocode/<target>` optional dependencies
- Currently supported targets: `darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`

Typical workflow:

1. **Build the local binary**

   ```bash
   npm run build
   ```

   This runs `scripts/build.sh` and outputs `dist/openzerocode` by default.

2. **Generate the `npm/` publishing staging layout**

   ```bash
   node scripts/create-platform-packages.mjs
   ```

   This creates:

   - `npm/package.json`: root npm package manifest
   - `npm/bin/openzerocode.js`: launcher that dispatches to the matching platform binary
   - `npm/packages/<target>/package.json`: manifest for each platform package
   - `npm/README.md`, `npm/LICENSE`, `npm/bin/package.json`: supporting publish files

3. **Build each platform binary on its native platform**

   ```bash
   scripts/build-platform-package.sh darwin-arm64
   scripts/build-platform-package.sh linux-x64
   scripts/build-platform-package.sh linux-arm64
   scripts/build-platform-package.sh win32-x64
   ```

   `scripts/build-platform-package.sh` must run on the matching host platform. For example, `linux-arm64` must be built on a `linux-arm64` machine. Successful builds output binaries to:

   - `npm/packages/<target>/bin/openzerocode`
   - Windows target: `npm/packages/win32-x64/bin/openzerocode.exe`

4. **Pack / publish the npm packages**

   After staging and building the platform binaries, run `npm pack` or `npm publish` inside `npm/` and each `npm/packages/<target>/` directory.

   Recommended order:

   - Publish platform packages `@openzerocode/<target>` first
   - Publish the root package `openzerocode` second

5. **Release checklist**

   First add a real `CHANGELOG.md` entry for the target version. Then use the release script to prepare the version bump, release commit, and matching git tag:

   ```bash
   npm run release -- patch       # or: minor, major, explicit version such as 0.4.3
   npm run release -- patch --dry-run
   npm run release -- patch --push
   ```

   The script requires no unrelated working-tree changes, validates that `CHANGELOG.md` already contains the target version entry, updates `package.json` and `package-lock.json` if present, stages the changelog entry, runs `npm run typecheck` by default, commits `chore: release v<version>`, and creates the `v<version>` tag. Use `--no-verify` only when you intentionally want to skip typecheck.

   Before and after a release, verify:

   - Confirm the target version changelog entry is complete before running the release script
   - If you did not pass `--push`, push both the release commit and tag: `git push origin HEAD && git push origin v<version>`
   - `.github/workflows/build.yml` always builds and uploads root/platform npm tarballs plus direct binary release archives (`.tar.gz` for Linux/macOS, `.zip` for Windows)
   - Tag pushes create a matching GitHub Release with those artifacts and automatically publish npm packages
   - npm publishing publishes platform packages first and then the root `openzerocode` package, skipping versions that already exist
   - If a workflow failed and only needs a rerun, use `workflow_dispatch` from the Actions page; no version bump or rerun of the release script is needed in that case. Enable `publish_to_npm` to rerun npm publishing, or provide the existing tag and enable the release option to recreate/update the GitHub Release
   - After publishing, verify `openzerocode --version` from the GitHub Release artifacts and verify `npm install -g openzerocode`

This structure keeps `npm install -g openzerocode` lightweight while npm resolves the real executable from the platform-specific optional package.

### Command-line usage

```bash
openzerocode                         # Launch the TUI
openzerocode --version               # Print version
openzerocode --help                  # Print CLI help
openzerocode --run "fix the tests"    # Run one prompt headlessly with auto-approved tools
openzerocode serve --port 4096       # Start the streaming HTTP API server
openzerocode --name backend          # Launch the TUI as a named local peer
```

Environment overrides:

| Variable | Effect |
|----------|--------|
| `OPENZERO_MODEL` | Override the default model used by headless `--run` mode |
| `OPENZEROCODE_PROVIDER_CONFIG` | Override the provider config path (default `~/.openzerocode/providers.json`) |
| `OPENZEROCODE_HARNESS_PROFILE` | `productive` (default) or `lite`; Lite uses a smaller prompt and tool surface for local models |
| `OPENZEROCODE_MAX_STEPS` | Override the maximum model/tool round-trips per run (default 50) |

Useful TUI commands:

| Command | Purpose |
|---------|---------|
| `/mode build\|plan\|compose` | Switch execution mode |
| `/reasoning low\|medium\|high\|xhigh\|max\|off` | Set reasoning effort when supported by the selected model |
| `/autopilot standard\|goal\|off` | Configure automatic continuation |
| `/steer <instruction>` | Guide the currently active run at its next safe model boundary |
| `/skills auto` / `/skills clear` | Enable or disable automatic skill routing |
| `/skill <name>` | Inspect one skill's instructions |
| `/learn` | Extract durable non-obvious learnings through `compose:learn` |
| `/compact` / `/export` | Compress history or export the compact transcript |
| `/peers` / `/call <name> <prompt>` | Inspect/call named local peers |
| `/usage` | Open the token-usage dashboard |

### Alternative entrypoint

```bash
npm run start:tui
```

---

## Provider Configuration

Provider credentials can be set through environment variables or a local config file:

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
      },
      "baseURL": "https://openrouter.ai/api/v1"
    }
  }
}
```

**Supported providers:**

| Provider id | Name | Environment keys |
|-------------|------|------------------|
| `opencode-zen` | OpenCode Zen | `OPENCODE_API`, `OPENCODE_API_KEY` (optional; anonymous free models are available) |
| `openai` | OpenAI | `OPENAI_API_KEY` |
| `openai-codex` | OpenAI Codex | ChatGPT OAuth via `/codex-login` |
| `xai-oauth` | xAI Grok OAuth | SuperGrok / X Premium+ OAuth via `/xai-login` |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` |
| `zero-api` | Zero-API-compatible local endpoint | `ZERO_API_KEY` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY` |
| `ollama` | Native Ollama API | No key required; defaults to `http://localhost:11434` |

**Notes:**

- Each provider can have multiple named keys.
- `activeKey` selects which key the runtime uses for that provider.
- `baseURL` can override a provider's default endpoint for compatible APIs.
- Config file values take precedence over environment variables.
- You can inspect and switch providers, models, and keys inside the TUI with slash commands and the command palette.

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
┌─ TUI client ─────────────────────────────────────┐
│  src/client/tui.tsx                              │
│  - transcript / streaming / queue / steering     │
│  - sessions / compaction / timeline / usage      │
│  - build / plan / compose modes                   │
│  - Autopilot / skills / peers / tool groups       │
└────────┬─────────────────────────────────────────┘
         │
         ├── session runner ────────────────────────┐
         │  src/client/session-runner.ts            │
         │  - context budgeting + provider retries  │
         │  - tool loop + permission callbacks      │
         │  - Build/Plan tool filtering             │
         └──────────────────────────────────────────┘
         │
         ├── provider layer ────────────────────────┐
         │  src/provider/registry.ts                │
         │  - Zen / OpenAI / Codex / xAI            │
         │  - OpenRouter / Zero-API / DeepSeek      │
         │  - native Ollama                          │
         └──────────────────────────────────────────┘
         │
         └── tool layer ────────────────────────────┐
            src/tool/registry.ts                    │
            - 19 built-in tools                     │
            - optional GEASS browser + peer groups  │
            - dynamically loaded MCP tools          │
            └───────────────────────────────────────┘
```

## Prompt Memory Model

OpenZeroCode keeps durable prompt memory user-global and intentionally small:

- `~/.openzerocode/AGENTS.md`: user personal cross-project preferences, language/response style, and general safety rules. Always loaded when non-empty.
- `~/.openzerocode/CONTEXT.md`: user background, common tools, and long-term preferences. Always loaded when non-empty.
- `~/.openzerocode/LEARNINGS.md`: optional cross-project learnings created by the `compose:learn` workflow; it is a knowledge artifact, not part of the normal automatic memory injection path.
- `docs/compose/learnings/*.md`: project learnings used by Compose mode when present. These are separate from the global `AGENTS.md` / `CONTEXT.md` prompt memory.
- `SESSION_SUMMARY.md`: concise project handoff notes for humans/continuation; not auto-injected into the system prompt.

Project `AGENTS.md` / `CONTEXT.md` files are treated as regular repository documentation, not automatic prompt memory. Conditional `memory.d` auto-injection is intentionally not used; project-specific experience is made explicit by extracting it into project docs.

The former `/mode learn` workflow was removed in 0.7.0. Learning is now handled by the bundled `compose:learn` skill. `/learn` sends a learning-extraction request that targets project-specific discoveries at `docs/compose/learnings/PROJECT.md` and cross-project discoveries at `~/.openzerocode/LEARNINGS.md`.

Compose mode also auto-loads project Markdown files from `docs/compose/learnings/` when that directory exists. This Compose-specific learning context is distinct from the normal global prompt-memory files above.


### Key source files

| File | Purpose |
|------|---------|
| `src/client/tui.tsx` | Main TUI entrypoint & UI orchestration |
| `src/client/session-runner.ts` | Streaming agent loop, context budgeting, retries, tool execution, mode-specific tool filtering |
| `src/client/sessions.ts` | Session persistence helpers |
| `src/client/workspace-memory.ts` | Loads user-global `AGENTS.md` / `CONTEXT.md` into the system prompt and reports memory status |
| `src/client/skill-loader.ts` / `skill-routing.ts` | Skill discovery and automatic per-request routing |
| `src/client/autopilot.ts` | Standard/Goal Autopilot continuation decisions and retry policy |
| `SESSION_SUMMARY.md` | Manual session handoff / continuation notes |
| `src/provider/registry.ts` | Provider registration & resolution |
| `src/tool/registry.ts` | Built-in tool registration |
| `src/mcp/` | MCP configuration, process transport, adaptation, and dynamic tool store |
| `src/peer/` | Named local peer registration, bounded collaboration, and local peer server |
| `src/server/index.ts` | Streaming HTTP API server for `openzerocode serve` |

---

## Relationship to OpenCode

| Aspect | OpenCode | OpenZeroCode |
|--------|----------|--------------|
| **Runtime** | Requires `zero` cloud service | Self-contained, local-first |
| **TUI framework** | `@opentui` (SolidJS) | `@opentui` (SolidJS) — same |
| **Provider layer** | OpenRouter, others | OpenCode Zen, OpenAI, OpenAI Codex, xAI OAuth, OpenRouter, Zero-API, DeepSeek, Ollama |
| **Tool system** | Built-in tools | 19 built-ins + selectable GEASS/peer groups + dynamic MCP tools + permission system |
| **Session storage** | Local files | Local files under `~/.openzerocode/` |
| **Prompt memory** | Varies | User-global `AGENTS.md` + `CONTEXT.md` are injected into the local system prompt |
| **Cloud dependency** | Requires `zero` for operation | No `zero` dependency; can use cloud providers or run locally with providers such as Ollama |
| **Binary distribution** | Platform-specific npm packages | Platform-specific npm packages (`darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`) plus source-first local install via `python3 scripts/dev-install.py` |

---

## License

MIT — see [LICENSE](./LICENSE).
