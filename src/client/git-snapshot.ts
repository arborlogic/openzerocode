import { execFile } from "node:child_process"
import { promisify } from "node:util"

export type GitFileStatus = "modified" | "added" | "deleted"

export type GitFile = {
  path: string
  additions: number
  deletions: number
  status: GitFileStatus
}

export type GitCommit = {
  hash: string
  subject: string
}

export type GitSnapshot = {
  files: GitFile[]
  branch: string | null
  commits: GitCommit[]
}

export const RECENT_COMMIT_LIMIT = 3

const execFileAsync = promisify(execFile)
let pendingGitSnapshot: { cwd: string; promise: Promise<GitSnapshot> } | undefined

export async function runGit(cwd: string, args: string[], timeout = 1000): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim()
  } catch {
    return ""
  }
}

export function parseGitDiffNumstat(out: string): Omit<GitFile, "status">[] {
  if (!out) return []
  return out.split("\n").filter(Boolean).map((line) => {
    const parts = line.split("\t")
    const additions = Number.parseInt(parts[0] ?? "0", 10) || 0
    const deletions = Number.parseInt(parts[1] ?? "0", 10) || 0
    const filePath = normalizePorcelainPath(parts.at(-1)?.trim() ?? "")
    return { path: filePath, additions, deletions }
  }).filter((file) => file.path.length > 0)
}

export function parseRecentCommits(out: string): GitCommit[] {
  if (!out) return []
  return out.split("\n").filter(Boolean).map((line) => {
    const spaceIdx = line.indexOf(" ")
    const hash = spaceIdx >= 0 ? line.slice(0, spaceIdx) : line
    const subject = spaceIdx >= 0 ? line.slice(spaceIdx + 1) : ""
    return { hash, subject }
  })
}

function normalizePorcelainPath(path: string): string {
  // Porcelain v1 renders renames/copies as `old -> new`; show the current path.
  const renameIdx = path.lastIndexOf(" -> ")
  return renameIdx >= 0 ? path.slice(renameIdx + 4).trim() : path
}

export function parseGitPorcelain(out: string): Pick<GitFile, "path" | "status">[] {
  if (!out) return []
  const files: Pick<GitFile, "path" | "status">[] = []
  for (const line of out.split("\n").filter(Boolean)) {
    const statusRaw = line.slice(0, 2)
    const path = normalizePorcelainPath(line.slice(3).trim())
    if (!path) continue

    const [indexStatus = " ", worktreeStatus = " "] = statusRaw
    const statusChars = `${indexStatus}${worktreeStatus}`
    const status: GitFileStatus = statusRaw === "??" || statusChars.includes("A")
      ? "added"
      : statusChars.includes("D")
        ? "deleted"
        : "modified"
    files.push({ path, status })
  }
  return files
}

export async function readGitSnapshot(cwd: string): Promise<GitSnapshot> {
  // Dedup concurrent calls within the same workspace: if a fetch is already
  // in-flight, share its result. Keep cwd in the key so split workspaces don't
  // reuse a snapshot from a different project.
  if (pendingGitSnapshot?.cwd === cwd) return pendingGitSnapshot.promise

  const promise = Promise.all([
    runGit(cwd, ["diff", "--numstat", "HEAD"], 2000),
    runGit(cwd, ["status", "--porcelain"], 2000),
    runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], 1000),
    runGit(cwd, ["log", "--oneline", `-${RECENT_COMMIT_LIMIT}`], 1000),
  ]).then(([diff, porcelain, branch, commits]) => {
    const fileMap = new Map<string, GitFile>()

    // 1) Parse line counts from --numstat for files with textual diffs.
    for (const file of parseGitDiffNumstat(diff)) {
      fileMap.set(file.path, { ...file, status: "modified" })
    }

    // 2) Overlay porcelain status so files without numstat entries still show:
    //    mode-only changes, deleted files, empty staged files, untracked files,
    //    renames/copies, and conflicted files.
    for (const file of parseGitPorcelain(porcelain)) {
      const existing = fileMap.get(file.path)
      if (existing) {
        existing.status = file.status
      } else {
        fileMap.set(file.path, { path: file.path, additions: 0, deletions: 0, status: file.status })
      }
    }

    return {
      files: [...fileMap.values()],
      branch: branch || null,
      commits: parseRecentCommits(commits),
    }
  }).finally(() => {
    if (pendingGitSnapshot?.promise === promise) pendingGitSnapshot = undefined
  })
  pendingGitSnapshot = { cwd, promise }
  return promise
}
