#!/usr/bin/env bun
// Build script — produces a standalone binary via Bun.build() + compile
//
// Default output:
//   dist/openzerocode
//
// This keeps local development, npm global installs, and the wrapper script on a
// single binary path. Optional custom output paths are still supported.
//
// Usage:
//   bun run scripts/build.ts              → dist/openzerocode
//   bun run scripts/build.ts /custom/path → custom output path

import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import * as path from "path"
import * as os from "os"
import pkg from "../package.json" with { type: "json" }
import { resolveBuildVersion } from "./version"

const PLATFORM_MAP: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
const ARCH_MAP: Record<string, string> = { x64: "x64", arm64: "arm64", arm: "arm" }

const platform = PLATFORM_MAP[os.platform()] ?? os.platform()
const arch = ARCH_MAP[os.arch()] ?? os.arch()
const binaryName = platform === "windows" ? "openzerocode.exe" : "openzerocode"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

const buildVersion = resolveBuildVersion({ dev: process.env.OPENZEROCODE_DEV_VERSION === "1" })

const customOut = process.argv[2]
const outfile = customOut ? path.resolve(customOut) : path.resolve(dir, "dist", binaryName)

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
    "process.env.__OPENZEROCODE_VERSION__": JSON.stringify(buildVersion),
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

const outputFile = Bun.file(outfile)
const outputExists = await outputFile.exists()

if (!outputExists) {
  console.error("❌ Build completed without producing the expected output file.")
  console.error(`   Expected: ${outfile}`)
  if (result.outputs.length > 0) {
    console.error("   Bun reported these outputs:")
    for (const output of result.outputs) {
      console.error(`   - ${output.path}`)
    }
  }
  process.exit(1)
}

const chmodResult = Bun.spawnSync(["chmod", "+x", outfile])
if (chmodResult.exitCode !== 0) {
  const stderr = chmodResult.stderr.toString().trim()
  console.error(`❌ Failed to mark build output executable: ${outfile}`)
  if (stderr) console.error(`   ${stderr}`)
  process.exit(chmodResult.exitCode)
}

const stat = await outputFile.stat()
const sizeMB = (stat.size / 1024 / 1024).toFixed(1)

console.log("✅ Build successful!")
console.log(`   ${outfile}  (${sizeMB} MB)`)

