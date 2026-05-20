import { existsSync, readFileSync } from "fs"
import { basename, dirname, resolve } from "path"

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

function loadWorkspaceFile(startDir: string, filename: string): string | undefined {
  const path = findNearestFile(startDir, filename)
  return path ? readTextFile(path) : undefined
}

export type WorkspaceMemoryStatus = {
  cwd: string
  workspaceBoundary: string
  agentsPath?: string
  contextPath?: string
  sessionSummaryPath?: string
  agentsLoaded: boolean
  contextLoaded: boolean
  sessionSummaryPresent: boolean
  sessionSummaryAutomatic: false
}

export function inspectWorkspaceMemory(startDir = process.cwd()): WorkspaceMemoryStatus {
  const cwd = resolve(startDir)
  const workspaceBoundary = findWorkspaceBoundary(cwd)
  const agentsPath = findNearestFile(cwd, "AGENTS.md")
  const contextPath = findNearestFile(cwd, "CONTEXT.md")
  const sessionSummaryCandidate = resolve(workspaceBoundary, "SESSION_SUMMARY.md")
  const sessionSummaryPath = existsSync(sessionSummaryCandidate) ? sessionSummaryCandidate : undefined

  return {
    cwd,
    workspaceBoundary,
    agentsPath,
    contextPath,
    sessionSummaryPath,
    agentsLoaded: !!(agentsPath && readTextFile(agentsPath)),
    contextLoaded: !!(contextPath && readTextFile(contextPath)),
    sessionSummaryPresent: !!sessionSummaryPath,
    sessionSummaryAutomatic: false,
  }
}

/**
 * Load AGENTS.md content from the nearest workspace root.
 * Returns undefined if no AGENTS.md is found.
 */
export function loadAgentsInstruction(startDir = process.cwd()): string | undefined {
  return loadWorkspaceFile(startDir, "AGENTS.md")
}

/**
 * Load CONTEXT.md content from the nearest workspace root.
 * Returns undefined if no CONTEXT.md is found.
 */
export function loadContextInstruction(startDir = process.cwd()): string | undefined {
  return loadWorkspaceFile(startDir, "CONTEXT.md")
}

export function formatWorkspaceMemoryStatus(status: WorkspaceMemoryStatus): string {
  const lines = [
    `Workspace memory status`,
    `- cwd: ${status.cwd}`,
    `- workspace boundary: ${status.workspaceBoundary}`,
    `- AGENTS.md: ${status.agentsLoaded ? `loaded from ${status.agentsPath}` : "not loaded"}`,
    `- CONTEXT.md: ${status.contextLoaded ? `loaded from ${status.contextPath}` : "not loaded"}`,
    `- SESSION_SUMMARY.md: ${status.sessionSummaryPresent ? `present at ${status.sessionSummaryPath} (manual only, not auto-loaded)` : "not present (and never auto-loaded)"}`,
    `- automatic prompt inputs: ${[status.agentsLoaded ? basename(status.agentsPath!) : undefined, status.contextLoaded ? basename(status.contextPath!) : undefined].filter(Boolean).join(", ") || "none"}`,
  ]

  return lines.join("\n")
}
