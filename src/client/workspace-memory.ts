import { existsSync, readFileSync } from "fs"
import { dirname, resolve } from "path"

function readTextFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, "utf-8").trim()
  return text || undefined
}

function findWorkspaceBoundary(startDir: string): string {
  let current = resolve(startDir)
  while (true) {
    if (
      existsSync(resolve(current, ".git"))
      || existsSync(resolve(current, "package.json"))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return resolve(startDir)
    current = parent
  }
}

function findNearestFile(startDir: string, filename: string): string | undefined {
  let current = resolve(startDir)
  const boundary = findWorkspaceBoundary(startDir)
  while (true) {
    const candidate = resolve(current, filename)
    if (existsSync(candidate)) return candidate
    if (current === boundary) return undefined
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Load AGENTS.md content from the nearest workspace root.
 * Returns undefined if no AGENTS.md is found.
 */
export function loadAgentsInstruction(startDir = process.cwd()): string | undefined {
  const path = findNearestFile(startDir, "AGENTS.md")
  return path ? readTextFile(path) : undefined
}
