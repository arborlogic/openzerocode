#!/usr/bin/env node
/**
 * OpenZeroCode CLI entry point.
 *
 * Detects the current platform and architecture, then locates and runs the
 * pre-compiled standalone binary.
 *
 * Design: modelled after opencode's bin/opencode.
 * - Platform-specific packages (openzerocode-<os>-<arch>) provide the binary.
 * - The binary is looked up in node_modules (installed as optional dependency).
 * - Override with OPENZERCODE_BIN_PATH env var.
 * - Falls back to a local binary adjacent to this script (for development).
 *
 * End users only need Node.js; no bun required at runtime.
 */

const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"]

function run(target) {
  const child = spawn(target, process.argv.slice(2), { stdio: "inherit" })

  child.on("error", (err) => {
    console.error(err.message)
    process.exit(1)
  })

  const forwarders = {}
  for (const sig of FORWARDED_SIGNALS) {
    forwarders[sig] = () => {
      try {
        child.kill(sig)
      } catch {
        // may have already exited
      }
    }
    process.on(sig, forwarders[sig])
  }

  child.on("exit", (code, signal) => {
    for (const sig of FORWARDED_SIGNALS) {
      process.removeListener(sig, forwarders[sig])
    }
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(typeof code === "number" ? code : 0)
  })
}

// ---- platform / arch detection ----

const PLATFORM_MAP = { darwin: "darwin", linux: "linux", win32: "windows" }
const ARCH_MAP = { x64: "x64", arm64: "arm64", arm: "arm" }

const platform = PLATFORM_MAP[os.platform()] ?? os.platform()
const arch = ARCH_MAP[os.arch()] ?? os.arch()
const binaryName = platform === "windows" ? "openzerocode.exe" : "openzerocode"
const base = `openzerocode-${platform}-${arch}`

// ---- binary lookup ----

// 1. Env override
const envPath = process.env.OPENZERCODE_BIN_PATH
if (envPath && fs.existsSync(envPath)) {
  run(envPath)
  process.exit(0)
}

const scriptDir = path.dirname(fs.realpathSync(__filename))

// 2. Cached symlink (like opencode's .opencode)
const cached = path.join(scriptDir, ".openzerocode")
if (fs.existsSync(cached)) {
  run(cached)
  process.exit(0)
}

// 3. Look in node_modules (for platform-specific optional dep)
function findBinary(startDir) {
  let current = startDir
  for (;;) {
    const modules = path.join(current, "node_modules")
    if (fs.existsSync(modules)) {
      const candidate = path.join(modules, base, "bin", binaryName)
      if (fs.existsSync(candidate)) return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

const found = findBinary(scriptDir)
if (found) {
  run(found)
  process.exit(0)
}

// 4. Adjacent binary (development / local build)
const local = path.join(scriptDir, "..", "dist", base, "bin", binaryName)
if (fs.existsSync(local)) {
  run(local)
  process.exit(0)
}

console.error(
  `✖ Could not locate openzerocode binary for ${platform}-${arch}.\n` +
    `  Install the matching platform package or set OPENZERCODE_BIN_PATH.\n` +
    `  Expected package: ${base}`,
)
process.exit(1)
