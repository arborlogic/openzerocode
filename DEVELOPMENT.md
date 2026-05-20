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


## Release SOP

This section is the release source of truth for npm and GitHub releases.

### Version source of truth

- The canonical release version lives in the root `package.json`.
- `scripts/create-platform-packages.mjs` reads that version and copies it into:
  - `npm/package.json`
  - `npm/packages/<target>/package.json`
- `package-lock.json` should be kept in sync with the root package version.
- The GitHub Actions workflow at `.github/workflows/build.yml` is triggered by git tags matching `v*`.

Because of that, **always bump `package.json` to the intended release version before creating the git tag**.

### Supported npm release targets

Current published platform packages:

- `darwin-arm64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`

### Manual release flow

1. **Prepare the version**

   Update the root version first:

   ```bash
   # edit package.json and package-lock.json
   # this release: v0.3.2
   ```

   For this repository, the git tag and npm version should match:

   - npm version: `0.3.2`
   - git tag: `v0.3.2`

2. **Verify the workspace before packaging**

   ```bash
   npm run typecheck
   ```

3. **Build the local binary output**

   ```bash
   npm run build
   ```

4. **Generate npm staging manifests**

   ```bash
   node scripts/create-platform-packages.mjs
   ```

   This produces the npm staging tree under `npm/`:

   - `npm/package.json`
   - `npm/bin/openzerocode.js`
   - `npm/bin/package.json`
   - `npm/README.md`
   - `npm/LICENSE`
   - `npm/packages/<target>/package.json`

5. **Build each platform package on its native platform**

   ```bash
   scripts/build-platform-package.sh darwin-arm64
   scripts/build-platform-package.sh linux-x64
   scripts/build-platform-package.sh linux-arm64
   scripts/build-platform-package.sh win32-x64
   ```

   Output binaries are written to:

   - `npm/packages/<target>/bin/openzerocode`
   - Windows: `npm/packages/win32-x64/bin/openzerocode.exe`

6. **Pack and publish npm packages**

   Recommended order:

   - publish `@openzerocode/<target>` packages first
   - publish root `openzerocode` package last

   Example checks:

   ```bash
   npm pack ./npm/packages/darwin-arm64
   npm pack ./npm/packages/linux-x64
   npm pack ./npm/packages/linux-arm64
   npm pack ./npm/packages/win32-x64
   npm pack ./npm
   ```

7. **Create and push the release tag**

   After the version bump is committed, create the matching tag:

   ```bash
   git tag v0.3.2
   git push origin main --tags
   ```

### What the GitHub workflow does after tagging

`build.yml` runs automatically on `push` tags that match `v*`.

After `v0.3.2` is pushed, the workflow will:

1. build platform packages on the matrix runners
2. run `npm pack` for each platform package
3. upload each generated `.tgz` as a workflow artifact
4. publish platform packages to npm in the `publish-npm` job
5. create a GitHub Release for the same tag and attach the built `.tgz` files

### Release checklist

- [ ] `package.json` version updated before tagging
- [ ] `package-lock.json` version updated to match
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `node scripts/create-platform-packages.mjs` regenerated `npm/` staging files
- [ ] `scripts/build-platform-package.sh <target>` completed on each target platform
- [ ] `npm pack` succeeded for root and platform packages
- [ ] release commit pushed
- [ ] git tag `vX.Y.Z` pushed
- [ ] GitHub Actions release workflow completed successfully

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
    sessions.ts                   # Session persistence helpers
    workspace-memory.ts           # Workspace prompt memory / AGENTS.md + CONTEXT.md loading
  provider/
    registry.ts                   # Provider registry
  tool/
    registry.ts                   # Built-in tool registration
```

## Shared Language

This repo benefits from a small shared vocabulary for agent-driven work:

- **Build mode**: make the requested change directly in the workspace.
- **Plan mode**: discuss approach only; no edits or tool calls.
- **Workspace memory**: prompt context loaded from `AGENTS.md` and `CONTEXT.md`.
- **Session summary**: concise human handoff notes in `SESSION_SUMMARY.md`, not part of the automatic prompt assembly path.
- **Targeted verification**: run the smallest relevant checks for the area you changed instead of defaulting to the full test suite.

---

## FAQ

**Q: Why not use `bun build --compile` CLI command?**  
The programmatic `Bun.build()` API supports the `plugins` option, which is needed for the SolidJS JSX transform. The CLI command doesn't accept custom plugins.

**Q: Why the `@opentui/solid/bun-plugin` module?**  
It exports `createSolidTransformPlugin()`, a `BunPlugin` that transforms JSX at build time. It's the same transform used by `--preload` at runtime.

**Q: Can I skip the binary and always use bun?**  
Yes — if no binary is found, `bin/openzerocode` falls back to `bun run --preload`. Just make sure bun is installed.
