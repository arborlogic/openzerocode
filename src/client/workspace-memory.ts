import { existsSync, readFileSync } from "fs"
import { dirname, join, resolve } from "path"

export type WorkspaceMemory = {
  agentsPath?: string
  agentsContent?: string
  sessionSummaryPath?: string
  sessionSummaryContent?: string
  contextBlock?: string
}

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

export function findNearestFile(startDir: string, filename: string): string | undefined {
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

function buildContextBlock(memory: WorkspaceMemory): string | undefined {
  const sections: string[] = []

  if (memory.agentsContent) {
    sections.push([
      "## Stable Instructions from AGENTS.md",
      memory.agentsContent,
    ].join("\n"))
  }

  if (memory.sessionSummaryContent) {
    sections.push([
      "## Recent Session Summary from SESSION_SUMMARY.md",
      memory.sessionSummaryContent,
    ].join("\n"))
  }

  if (sections.length === 0) return undefined

  return [
    "# Workspace Context",
    ...sections,
  ].join("\n\n")
}

export function resolveWorkspaceWritePaths(startDir = process.cwd()) {
  const agentsPath = findNearestFile(startDir, "AGENTS.md")
  const sessionSummaryPath = findNearestFile(startDir, "SESSION_SUMMARY.md")
  const workspaceDir = agentsPath
    ? dirname(agentsPath)
    : sessionSummaryPath
      ? dirname(sessionSummaryPath)
      : findWorkspaceBoundary(startDir)

  return {
    workspaceDir,
    agentsPath: agentsPath ?? join(workspaceDir, "AGENTS.md"),
    sessionSummaryPath: sessionSummaryPath ?? join(workspaceDir, "SESSION_SUMMARY.md"),
  }
}

export function loadWorkspaceMemory(startDir = process.cwd()): WorkspaceMemory {
  const agentsPath = findNearestFile(startDir, "AGENTS.md")
  const sessionSummaryPath = findNearestFile(startDir, "SESSION_SUMMARY.md")

  const memory: WorkspaceMemory = {
    agentsPath,
    agentsContent: agentsPath ? readTextFile(agentsPath) : undefined,
    sessionSummaryPath,
    sessionSummaryContent: sessionSummaryPath ? readTextFile(sessionSummaryPath) : undefined,
  }

  memory.contextBlock = buildContextBlock(memory)
  return memory
}
