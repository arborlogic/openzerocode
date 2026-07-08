import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { dirname, join, resolve } from "path"

function readTextFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, "utf-8").trim()
  return text || undefined
}

function userOpenZeroCodeDir(): string {
  return join(process.env.HOME ?? homedir(), ".openzerocode")
}

function globalMemoryPath(filename: "AGENTS.md" | "CONTEXT.md"): string {
  return resolve(userOpenZeroCodeDir(), filename)
}

export type GlobalMemoryBootstrapResult = {
  agentsPath: string
  contextPath: string
  created: string[]
}

/**
 * Learn mode needs a stable user-global place where the user can confirm
 * durable memories. On first Learn-mode entry, create empty global memory files
 * if they do not exist yet. Empty files are intentionally ignored by prompt
 * loading until the user confirms real content.
 */
export function ensureGlobalMemoryFiles(): GlobalMemoryBootstrapResult {
  const dir = userOpenZeroCodeDir()
  mkdirSync(dir, { recursive: true })

  const agentsPath = resolve(dir, "AGENTS.md")
  const contextPath = resolve(dir, "CONTEXT.md")
  const created: string[] = []

  for (const path of [agentsPath, contextPath]) {
    if (existsSync(path)) continue
    writeFileSync(path, "")
    created.push(path)
  }

  return { agentsPath, contextPath, created }
}

export function findWorkspaceBoundary(startDir: string): string {
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

function loadGlobalMemoryFile(filename: "AGENTS.md" | "CONTEXT.md"): { path: string, content: string } | undefined {
  const path = globalMemoryPath(filename)
  const content = readTextFile(path)
  return content ? { path, content } : undefined
}

export type WorkspaceMemoryStatus = {
  cwd: string
  workspaceBoundary: string
  agentsPath?: string
  contextPath?: string
  agentsPaths: string[]
  contextPaths: string[]
  sessionSummaryPath?: string
  agentsLoaded: boolean
  contextLoaded: boolean
  sessionSummaryPresent: boolean
  sessionSummaryAutomatic: false
}

export function inspectWorkspaceMemory(startDir = process.cwd()): WorkspaceMemoryStatus {
  const cwd = resolve(startDir)
  const workspaceBoundary = findWorkspaceBoundary(cwd)
  const agentsFile = loadGlobalMemoryFile("AGENTS.md")
  const contextFile = loadGlobalMemoryFile("CONTEXT.md")
  const sessionSummaryCandidate = resolve(workspaceBoundary, "SESSION_SUMMARY.md")
  const sessionSummaryPath = existsSync(sessionSummaryCandidate) ? sessionSummaryCandidate : undefined

  return {
    cwd,
    workspaceBoundary,
    agentsPath: agentsFile?.path,
    contextPath: contextFile?.path,
    agentsPaths: agentsFile ? [agentsFile.path] : [],
    contextPaths: contextFile ? [contextFile.path] : [],
    sessionSummaryPath,
    agentsLoaded: !!agentsFile,
    contextLoaded: !!contextFile,
    sessionSummaryPresent: !!sessionSummaryPath,
    sessionSummaryAutomatic: false,
  }
}

/**
 * Load user-global AGENTS.md memory from ~/.openzerocode/AGENTS.md.
 */
export function loadAgentsInstruction(_startDir = process.cwd()): string | undefined {
  return loadGlobalMemoryFile("AGENTS.md")?.content
}

/**
 * Load user-global CONTEXT.md memory from ~/.openzerocode/CONTEXT.md.
 */
export function loadContextInstruction(_startDir = process.cwd()): string | undefined {
  return loadGlobalMemoryFile("CONTEXT.md")?.content
}

function relativeToWorkspace(status: WorkspaceMemoryStatus, path: string): string {
  return path.startsWith(`${status.workspaceBoundary}/`)
    ? path.replace(`${status.workspaceBoundary}/`, "")
    : path
}

function formatLoaded(paths: string[]): string {
  return paths.length > 0 ? `loaded from ${paths.join(", ")}` : "not loaded"
}

export function formatWorkspaceMemoryStatus(status: WorkspaceMemoryStatus): string {
  const automaticInputs = [...status.agentsPaths, ...status.contextPaths]
    .map((path) => relativeToWorkspace(status, path))

  const lines = [
    `Workspace memory status`,
    `- cwd: ${status.cwd}`,
    `- workspace boundary: ${status.workspaceBoundary}`,
    `- user global AGENTS.md: ${formatLoaded(status.agentsPaths)}`,
    `- user global CONTEXT.md: ${formatLoaded(status.contextPaths)}`,
    `- project memory files: not loaded (project AGENTS.md/CONTEXT.md are treated as regular repository files)`,
    `- SESSION_SUMMARY.md: ${status.sessionSummaryPresent ? `present at ${status.sessionSummaryPath} (manual only, not auto-loaded)` : "not present (and never auto-loaded)"}`,
    `- automatic prompt inputs: ${automaticInputs.join(", ") || "none"}`,
  ]

  return lines.join("\n")
}
