#!/usr/bin/env bun
// Build script — produces a standalone binary via Bun.build() + compile
//
// The output follows the platform-specific package layout used by opencode:
//
//   dist/openzerocode-<os>-<arch>/bin/openzerocode
//
// This allows the Node.js wrapper in bin/openzerocode to find the binary
// naturally when developing locally.
//
// Usage:
//   bun run scripts/build.ts              → dist/openzerocode-<os>-<arch>/bin/openzerocode
//   bun run scripts/build.ts /custom/path → custom path (flat binary, no structure)

import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { existsSync } from "fs"
import * as path from "path"
import * as os from "os"
import pkg from "../package.json" with { type: "json" }

const PLATFORM_MAP: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
const ARCH_MAP: Record<string, string> = { x64: "x64", arm64: "arm64", arm: "arm" }

const platform = PLATFORM_MAP[os.platform()] ?? os.platform()
const arch = ARCH_MAP[os.arch()] ?? os.arch()
const binaryName = platform === "windows" ? "openzerocode.exe" : "openzerocode"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

// If a custom output path is provided, write the binary directly there.
// Otherwise create the platform-specific package layout.
const customOut = process.argv[2]
const outfile = customOut
  ? path.resolve(customOut)
  : path.resolve(dir, "dist", `openzerocode-${platform}-${arch}`, "bin", binaryName)

console.log("=== OpenZeroCode Build ===")
console.log(`Platform : ${platform}-${arch}`)
console.log(`Output   : ${outfile}`)
console.log()

// Register the SolidJS JSX transform plugin directly (no --preload needed)
const plugin = createSolidTransformPlugin()

const result = await Bun.build({
  entrypoints: ["./src/client/tui.tsx"],
  plugins: [plugin],
  format: "esm",
  minify: true,
  sourcemap: "external",
  target: "bun",
  define: {
    "process.env.__OPENZEROCODE_VERSION__": JSON.stringify(pkg.version),
  },
  compile: {
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    outfile,
  },
})

if (!result.success) {
  console.error("❌ Build failed:")
  for (const log of result.logs) {
    console.error(`  ${log}`)
  }
  process.exit(1)
}

// Make executable
await Bun.spawnSync(["chmod", "+x", outfile])

const stat = await Bun.file(outfile).stat()
const sizeMB = (stat.size / 1024 / 1024).toFixed(1)

console.log("✅ Build successful!")
console.log(`   ${outfile}  (${sizeMB} MB)`)

// Create platform package.json alongside the binary (for optional dep publishing)
if (!customOut) {
  const pkgDir = path.dirname(path.dirname(outfile))
  const pkgJson = {
    name: `openzerocode-${platform}-${arch}`,
    version: pkg.version,
    os: [platform],
    cpu: [arch],
    bin: { openzerocode: `bin/${binaryName}` },
  }
  await Bun.file(path.join(pkgDir, "package.json")).write(JSON.stringify(pkgJson, null, 2) + "\n")
  console.log(`   Created ${path.join(pkgDir, "package.json")}`)
}
