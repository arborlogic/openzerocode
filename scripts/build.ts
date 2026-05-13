#!/usr/bin/env bun
// Build script — produces a standalone binary via Bun.build() + compile
//
// Usage:
//   bun run scripts/build.ts              → ./dist/openzerocode
//   bun run scripts/build.ts /path/to/out → custom path

import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { existsSync } from "fs"
import * as path from "path"
import pkg from "../package.json" with { type: "json" }

const outfile = path.resolve(process.argv[2] || "./dist/openzerocode")
const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

console.log("=== OpenZeroCode Build ===")
console.log(`Output: ${outfile}`)
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

console.log("✅ Build successful!")
console.log()
console.log(`Binary: ${outfile}`)

// Show file size
const fileSize = Bun.spawnSync(["ls", "-lh", outfile])
console.log(fileSize.stdout.toString().trim())
