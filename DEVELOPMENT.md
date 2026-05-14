# Development Guide

## Overview

OpenZeroCode supports two run modes:

| Mode | Entry | Requires | Use case |
|------|-------|----------|----------|
| **Dev (source)** | `bun run dev` | bun | Active development / iteration |
| **Prod (binary)** | `node bin/openzerocode` | Only Node.js | End-user / release |

The `bin/openzerocode` script automatically detects which mode to use:

1. Looks for a pre-compiled binary in `dist/openzerocode-<os>-<arch>/bin/`
2. If found → spawns it directly (no bun required)
3. If not found → falls back to `bun run --preload ...` (bun required)

---

## Updating

Two workflows depending on how you installed:

| Install method | Update command |
|----------------|----------------|
| npm global (`npm install -g openzerocode`) | `npm install -g openzerocode@latest` |
| Local source (git clone + `npm link`) | `git pull && npm install && npm run build && npm install -g .` |

---

- **bun** ≥ 1.2 — for running source and building the binary
  ```bash
  curl -fsSL https://bun.sh/install | bash
  # or: brew install oven-sh/bun/bun
  ```
- **Node.js** ≥ 20 — needed only if running the pre-built binary

---

## Development (Source)

```bash
# Install dependencies
npm install

# Run with hot-reload (recommended for development)
npm run dev

# Run once
npm run start
```

### Useful flags

| Flag | Effect |
|------|--------|
| `--build` | Start in build mode |
| `--plan` | Start in plan mode |
| `--model <name>` | Override the default model |
| `--provider <name>` | Override the default provider |

> **Note:** `npm run dev` uses `bun --watch --preload @opentui/solid/preload`.  
> The `--preload` flag registers the SolidJS JSX runtime so `.tsx` files in `src/client/` compile correctly at runtime.

---

## Building the Standalone Binary

The build produces a platform-specific binary using `Bun.build()` with its `compile` option.

```bash
# Build for your current platform
npm run build

# Output:
#   dist/openzerocode-<os>-<arch>/bin/openzerocode   (binary)
#   dist/openzerocode-<os>-<arch>/package.json        (for optional dep publishing)
```

### How it works

The build script (`scripts/build.ts`) uses the programmatic Bun API:

```typescript
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const plugin = createSolidTransformPlugin()

await Bun.build({
  entrypoints: ["./src/client/tui.tsx"],
  plugins: [plugin],      // SolidJS JSX transform — no --preload needed at compile time
  format: "esm",
  minify: true,
  target: "bun",
  compile: { outfile: "..." },
})
```

Key points:

- `@opentui/solid/bun-plugin` exports `createSolidTransformPlugin()` — this is the **same plugin** used internally by `--preload`, but passed directly to `Bun.build()`.
- The `compile` option produces a standalone binary that embeds the Bun runtime.
- No JSX runtime shim or postinstall script is needed.

### Cross-platform builds

To build for a different platform:

```bash
bun run scripts/build.ts
# By default builds for current platform
```

The build does **not** cross-compile (Bun's limitation). For releases, each platform builds on its own CI runner.

---

## Running the Binary

Once built, you can run without bun:

```bash
# Via the CLI wrapper (recommended)
node bin/openzerocode

# Or directly
./dist/openzerocode-<os>-<arch>/bin/openzerocode

# Or with a custom binary path
OPENZEROCODE_BIN=/path/to/binary openzerocode
```

---

## Binary Distribution Strategy

The project follows opencode's package layout:

```
dist/
  openzerocode-darwin-arm64/
    package.json    # { name: "openzerocode-darwin-arm64", os: ["darwin"], cpu: ["arm64"] }
    bin/
      openzerocode  # pre-compiled binary
  openzerocode-darwin-x64/
    ...
  openzerocode-linux-arm64/
    ...
  ...
```

Each platform package can be published to npm as an **optional dependency**:

```json
{
  "name": "openzerocode",
  "optionalDependencies": {
    "openzerocode-darwin-arm64": "^1.0.0",
    "openzerocode-darwin-x64": "^1.0.0",
    "openzerocode-linux-arm64": "^1.0.0",
    "openzerocode-linux-x64": "^1.0.0",
    "openzerocode-win32-arm64": "^1.0.0",
    "openzerocode-win32-x64": "^1.0.0"
  }
}
```

The `bin/openzerocode` wrapper resolves the correct platform package on install.

---

## Testing

```bash
# Unit tests
npm run test:unit

# Single test file
npx tsx --test src/client/workspace-memory.test.ts

# Type check
npm run typecheck
```

Provider integration tests require env setup:

```bash
OPENCODE_API=... npx tsx --test src/provider/provider.test.ts
```

---

## Project Structure

```
bin/openzerocode                  # Node.js CLI wrapper (detects binary or falls back to bun)
scripts/
  build.sh                        # Shell wrapper for build
  build.ts                        # Bun.build() + compile build script
src/
  client/
    tui.tsx                       # Main TUI entrypoint
    session.ts                    # Session persistence helpers
    workspace-memory.ts           # Workspace memory injection
    workspace-summary.ts          # Session summary management
  provider/
    registry.ts                   # Provider registry
  tool/
    registry.ts                   # Built-in tool registration
```

---

## FAQ

**Q: Why not use `bun build --compile` CLI command?**  
The programmatic `Bun.build()` API supports the `plugins` option, which is needed for the SolidJS JSX transform. The CLI command doesn't accept custom plugins.

**Q: Why the `@opentui/solid/bun-plugin` module?**  
It exports `createSolidTransformPlugin()`, a `BunPlugin` that transforms JSX at build time. It's the same transform used by `--preload` at runtime.

**Q: Can I skip the binary and always use bun?**  
Yes — if no binary is found, `bin/openzerocode` falls back to `bun run --preload`. Just make sure bun is installed.
