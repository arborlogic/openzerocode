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
      || existsSync(resolve(current, "pubspec.yaml"))
      || existsSync(resolve(current, "Cargo.toml"))
      || existsSync(resolve(current, "go.mod"))
      || existsSync(resolve(current, "pyproject.toml"))
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

function joinMemoryContents(files: Array<{ path: string, content: string }>): string | undefined {
  if (files.length === 0) return undefined
  return files.map((file) => file.content).join("\n\n")
}

/**
 * Load only explicit user-global AGENTS.md memory. Project files and conditional
 * files are not auto-injected; Learn mode can help the user extract relevant
 * global experience into a project's DEVELOPMENT.md when requested.
 */
export function loadAgentsInstruction(_startDir = process.cwd()): string | undefined {
  return joinMemoryContents([
    ...[loadGlobalMemoryFile("AGENTS.md")].filter((file): file is { path: string, content: string } => !!file),
  ])
}

/**
 * Load only explicit user-global CONTEXT.md memory. Project files and conditional
 * files are not auto-injected; Learn mode can help the user extract relevant
 * global experience into a project's DEVELOPMENT.md when requested.
 */
export function loadContextInstruction(_startDir = process.cwd()): string | undefined {
  return joinMemoryContents([
    ...[loadGlobalMemoryFile("CONTEXT.md")].filter((file): file is { path: string, content: string } => !!file),
  ])
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
  const agentsPaths = agentsFile ? [agentsFile.path] : []
  const contextPaths = contextFile ? [contextFile.path] : []
  const sessionSummaryCandidate = resolve(workspaceBoundary, "SESSION_SUMMARY.md")
  const sessionSummaryPath = existsSync(sessionSummaryCandidate) ? sessionSummaryCandidate : undefined

  return {
    cwd,
    workspaceBoundary,
    agentsPath: agentsPaths[0],
    contextPath: contextPaths[0],
    agentsPaths,
    contextPaths,
    sessionSummaryPath,
    agentsLoaded: agentsPaths.length > 0,
    contextLoaded: contextPaths.length > 0,
    sessionSummaryPresent: !!sessionSummaryPath,
    sessionSummaryAutomatic: false,
  }
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
    `- project DEVELOPMENT.md: manual Learn-mode extraction target (not auto-loaded)`,
    `- project memory files: not loaded automatically (project AGENTS.md/CONTEXT.md are treated as regular repository files)`,
    `- SESSION_SUMMARY.md: ${status.sessionSummaryPresent ? `present at ${status.sessionSummaryPath} (manual only, not auto-loaded)` : "not present (and never auto-loaded)"}`,
    `- automatic prompt inputs: ${automaticInputs.join(", ") || "none"}`,
  ]

  return lines.join("\n")
}
