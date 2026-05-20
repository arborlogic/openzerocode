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
- **npm** on your `PATH` (used by the dev install flow and npm distribution)

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

This remains the supported local development install path. It installs dependencies, rebuilds `dist/openzerocode` with a timestamped `-dev.YYYYMMDDHHMMSS` version suffix, and runs `npm install -g .` so the global `openzerocode` command points at that locally built binary.

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

### npm / 打包流程

發佈用的 npm 產物採用「root launcher + 平台子套件」結構：

- 根套件 `openzerocode` 只放 Node 啟動器 `bin/openzerocode.js`
- 平台二進位分別放在 `@openzerocode/<target>` optionalDependencies
- 目前支援的 target：`darwin-arm64`、`linux-x64`、`linux-arm64`、`win32-x64`

常用流程如下：

1. **建立一般本機 binary**

   ```bash
   npm run build
   ```

   這會執行 `scripts/build.sh`，預設輸出到 `dist/openzerocode`。

2. **產生 `npm/` 發佈 staging 結構**

   ```bash
   node scripts/create-platform-packages.mjs
   ```

   這會建立：

   - `npm/package.json`：root npm package manifest
   - `npm/bin/openzerocode.js`：依作業系統/架構轉送到對應平台 binary 的 launcher
   - `npm/packages/<target>/package.json`：各平台子套件 manifest
   - `npm/README.md`、`npm/LICENSE`、`npm/bin/package.json`：發佈時需要的附帶檔案

3. **在對應平台上建出平台 binary**

   ```bash
   scripts/build-platform-package.sh darwin-arm64
   scripts/build-platform-package.sh linux-x64
   scripts/build-platform-package.sh linux-arm64
   scripts/build-platform-package.sh win32-x64
   ```

   `scripts/build-platform-package.sh` 必須在目標平台本機執行；例如 `linux-arm64` 只能在 `linux-arm64` host 上建置。成功後 binary 會輸出到：

   - `npm/packages/<target>/bin/openzerocode`
   - Windows target 則是 `npm/packages/win32-x64/bin/openzerocode.exe`

4. **打包 / 發佈 npm 套件**

   完成 staging 與各平台 binary 後，可分別在 `npm/` 與 `npm/packages/<target>/` 內執行 `npm pack` 或 `npm publish`。

   建議順序：

   - 先發佈各平台套件 `@openzerocode/<target>`
   - 再發佈 root 套件 `openzerocode`

5. **CI / release checklist**

   發版前後建議依序確認：

   - 先更新 root `package.json` / `package-lock.json` 版本號，再建立對應 git tag（例如套件版本 `0.3.2` 對應 tag `v0.3.2`）
   - 在乾淨工作樹上確認 changelog 或 release notes 已準備好（如果這次 release 有對外變更）
   - 執行 `npm run typecheck`
   - 重新執行 `node scripts/create-platform-packages.mjs`，確認 `npm/` 與 `npm/packages/<target>/` 的 staged 檔案都是最新內容
   - 合併到 `main` 後，push `v*` tag 來觸發 GitHub Actions 發版流程
   - 目前 `.github/workflows/build.yml` 會在 tag push 時自動建置各平台 package、publish 各個 `@openzerocode/<target>`，並建立同名 GitHub Release
   - 若只是因為 workflow 失敗需要重跑，可用 Actions 頁面的 `workflow_dispatch` 手動觸發；這種情況不需要再 bump 版本號，但若要建立 GitHub Release，請填入既有 tag 並勾選對應選項
   - 注意：目前 workflow 尚未自動 publish root `openzerocode` 套件；若要讓 `npm install -g openzerocode` 可用，仍需另外發佈 `npm/` 內的 root package
   - 發佈完成後，用一個乾淨環境驗證 `npm install -g openzerocode` 與 `openzerocode --version`

這個流程讓 `npm install -g openzerocode` 安裝的是輕量 launcher，而實際執行檔由 npm 自動解析到符合目前平台的 optional package。

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
| **Binary distribution** | Platform-specific npm packages | Platform-specific npm packages (`darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`) plus source-first local install via `python3 scripts/dev-install.py` |

---

## License

MIT — see [LICENSE](./LICENSE).
