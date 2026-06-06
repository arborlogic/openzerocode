#!/usr/bin/env bun

import { $ } from "bun"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { basename } from "node:path"

const HELP = `Usage: bun run scripts/release.ts <patch|minor|major|VERSION> [options]

Prepare a local OpenZeroCode release commit and tag.

Arguments:
  patch|minor|major|VERSION  Version bump type or explicit semver version.

Options:
  --push                     Push the release commit and tag to origin.
  --remote <name>            Git remote to push to (default: origin).
  --no-verify                Skip npm run typecheck.
  --dry-run                  Print planned actions without changing files.
  --help                     Show this help.

Examples:
  npm run release -- patch
  npm run release -- 0.4.3
  npm run release:patch -- --push
`

type BumpKind = "patch" | "minor" | "major"

type CliOptions = {
  bumpOrVersion: string
  push: boolean
  remote: string
  verify: boolean
  dryRun: boolean
}

function usage(message?: string): never {
  if (message) {
    console.error(`Error: ${message}\n`)
  }
  console.error(HELP.trimEnd())
  process.exit(message ? 1 : 0)
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    usage()
  }

  let push = false
  let remote = "origin"
  let verify = true
  let dryRun = false
  const positionals: string[] = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--push") {
      push = true
    } else if (arg === "--remote") {
      const next = argv[i + 1]
      if (!next) usage("--remote requires a value")
      remote = next
      i += 1
    } else if (arg.startsWith("--remote=")) {
      remote = arg.slice("--remote=".length)
      if (!remote) usage("--remote requires a value")
    } else if (arg === "--no-verify") {
      verify = false
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg.startsWith("-")) {
      usage(`unknown option: ${arg}`)
    } else {
      positionals.push(arg)
    }
  }

  if (positionals.length !== 1) {
    usage("provide exactly one bump type or explicit version")
  }

  return { bumpOrVersion: positionals[0]!, push, remote, verify, dryRun }
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) {
    throw new Error(`expected a stable semver version like 1.2.3, got ${version}`)
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function nextVersion(currentVersion: string, bumpOrVersion: string): string {
  if (["patch", "minor", "major"].includes(bumpOrVersion)) {
    const [major, minor, patch] = parseVersion(currentVersion)
    const bump = bumpOrVersion as BumpKind
    if (bump === "patch") return `${major}.${minor}.${patch + 1}`
    if (bump === "minor") return `${major}.${minor + 1}.0`
    return `${major + 1}.0.0`
  }

  parseVersion(bumpOrVersion)
  return bumpOrVersion
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let i = 0; i < left.length; i += 1) {
    const delta = left[i]! - right[i]!
    if (delta !== 0) return delta
  }
  return 0
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, "utf8")
  return JSON.parse(content) as Record<string, unknown>
}

async function writeJson(filePath: string, data: Record<string, unknown>): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

async function updatePackageJson(filePath: string, version: string, dryRun: boolean): Promise<boolean> {
  if (!existsSync(filePath)) return false
  const data = await readJson(filePath)
  data.version = version
  if (!dryRun) await writeJson(filePath, data)
  return true
}

async function updatePackageLock(version: string, dryRun: boolean): Promise<boolean> {
  const filePath = "package-lock.json"
  if (!existsSync(filePath)) return false

  const data = await readJson(filePath)
  data.version = version

  const packages = data.packages
  if (packages && typeof packages === "object") {
    const rootPackage = (packages as Record<string, unknown>)[""]
    if (rootPackage && typeof rootPackage === "object") {
      ;(rootPackage as Record<string, unknown>).version = version
    }
  }

  if (!dryRun) await writeJson(filePath, data)
  return true
}

async function updateChangelog(version: string, dryRun: boolean): Promise<boolean> {
  const filePath = "CHANGELOG.md"
  const today = new Date().toISOString().slice(0, 10)
  const entry = `## ${version} - ${today}\n\n- Release ${version}.\n\n`

  if (!existsSync(filePath)) {
    const content = `# Changelog\n\n${entry}`
    if (!dryRun) await writeFile(filePath, content)
    return true
  }

  const current = await readFile(filePath, "utf8")
  if (current.includes(`## ${version} -`) || current.includes(`## [${version}]`)) {
    return true
  }

  const headingMatch = /^# .*\n+/m.exec(current)
  const content = headingMatch
    ? `${current.slice(0, headingMatch.index + headingMatch[0].length)}${entry}${current.slice(headingMatch.index + headingMatch[0].length)}`
    : `# Changelog\n\n${entry}${current}`

  if (!dryRun) await writeFile(filePath, content)
  return true
}

async function gitOutput(args: string[]): Promise<string> {
  return (await $`git ${args}`.quiet().text()).trim()
}

async function ensureCleanWorktree(options?: { dryRun?: boolean }): Promise<void> {
  const status = await gitOutput(["status", "--porcelain"])
  if (!status) return

  if (options?.dryRun) {
    console.log("[dry-run] working tree is not clean; a real release would stop here")
    return
  }

  throw new Error("working tree is not clean; commit or stash current changes before releasing")
}

async function tagExists(tag: string): Promise<boolean> {
  const output = await gitOutput(["tag", "--list", tag])
  return output === tag
}

async function runCommand(args: string[], dryRun: boolean): Promise<void> {
  console.log(`$ ${args.join(" ")}`)
  if (dryRun) return
  await $`${args}`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const packageJson = await readJson("package.json")
  const currentVersion = String(packageJson.version ?? "")
  const version = nextVersion(currentVersion, options.bumpOrVersion)
  const tag = `v${version}`

  if (compareVersions(version, currentVersion) <= 0) {
    throw new Error(`new version ${version} must be greater than current version ${currentVersion}`)
  }

  if (options.dryRun) {
    console.log(`[dry-run] would prepare release ${tag}`)
  }

  await ensureCleanWorktree({ dryRun: options.dryRun })

  if (await tagExists(tag)) {
    throw new Error(`tag already exists: ${tag}`)
  }

  const changedFiles: string[] = []
  if (await updatePackageJson("package.json", version, options.dryRun)) changedFiles.push("package.json")
  if (await updatePackageLock(version, options.dryRun)) changedFiles.push("package-lock.json")
  if (await updateChangelog(version, options.dryRun)) changedFiles.push("CHANGELOG.md")

  console.log(`Prepared ${tag}`)
  console.log(`Updated: ${changedFiles.map((file) => basename(file)).join(", ")}`)

  if (options.verify) {
    await runCommand(["npm", "run", "typecheck"], options.dryRun)
  } else {
    console.log("Skipping verification (--no-verify)")
  }

  await runCommand(["git", "add", ...changedFiles], options.dryRun)
  await runCommand(["git", "commit", "-m", `chore: release ${tag}`], options.dryRun)
  await runCommand(["git", "tag", tag], options.dryRun)

  if (options.push) {
    await runCommand(["git", "push", options.remote, "HEAD"], options.dryRun)
    await runCommand(["git", "push", options.remote, tag], options.dryRun)
  } else {
    console.log(`Not pushing. To publish, run: git push ${options.remote} HEAD && git push ${options.remote} ${tag}`)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`release failed: ${message}`)
  process.exit(1)
})
