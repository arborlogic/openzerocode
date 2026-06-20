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
    // Only trim trailing line-ending chars. A leading trim would strip the
    // significant first column of `git status --porcelain`: worktree-only
    // changes start with a space (" M path"), and dropping it shifts the path
    // by one character, breaking the slice-based parse below.
    // Use [\r\n] so that CRLF output (Windows / core.autocrlf) is also handled.
    return stdout.replace(/[\r\n]+$/, "")
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
    const filePath = normalizeNumstatPath(parts.at(-1)?.trim() ?? "")
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

// Git C-quotes paths with "unusual" bytes (when core.quotePath is on, the
// default) by wrapping them in double quotes with backslash escapes. Crucially,
// `git status --porcelain` quotes paths containing spaces while
// `git diff --numstat` does NOT, so the same file yields two different raw
// strings. Decoding both back to the real path keeps the merge keyed
// consistently and avoids the file showing up twice. Octal escapes are emitted
// per-byte for UTF-8, so we accumulate bytes before decoding.
function unquoteGitPath(path: string): string {
  if (path.length < 2 || path[0] !== '"' || path.at(-1) !== '"') return path
  const inner = path.slice(1, -1)
  const bytes: number[] = []
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch !== "\\") {
      for (const b of Buffer.from(ch, "utf-8")) bytes.push(b)
      continue
    }
    const next = inner[++i]
    if (next === undefined) break
    if (next >= "0" && next <= "7") {
      let oct = next
      while (oct.length < 3 && inner[i + 1] >= "0" && inner[i + 1] <= "7") oct += inner[++i]
      bytes.push(Number.parseInt(oct, 8))
      continue
    }
    const simple: Record<string, number> = { a: 0x07, b: 0x08, t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d, "\"": 0x22, "\\": 0x5c }
    bytes.push(simple[next] ?? Buffer.from(next, "utf-8")[0])
  }
  return Buffer.from(bytes).toString("utf-8")
}

// Used for porcelain paths: may be C-quoted by git, so unquote after rename split.
// Rename/copy records use `old -> new`, but either side may itself contain the
// literal delimiter when quoted (for example `"old -> name" -> "new -> name"`).
// Split only on delimiters that appear outside C-quoted path segments.
function normalizePorcelainPath(path: string): string {
  let inQuote = false
  let escaped = false
  let renameIdx = -1

  for (let i = 0; i <= path.length - 4; i++) {
    const ch = path[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inQuote && ch === "\\") {
      escaped = true
      continue
    }
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }
    if (!inQuote && path.slice(i, i + 4) === " -> ") renameIdx = i
  }

  const current = renameIdx >= 0 ? path.slice(renameIdx + 4).trim() : path
  return unquoteGitPath(current)
}

// Used for numstat paths: git never C-quotes these, so skip unquoting.
// Rename format in numstat is `{old => new}` or `old => new` (not `old -> new`).
function normalizeNumstatPath(path: string): string {
  return path
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
  // in-flight, chain a fresh snapshot after it rather than returning the existing
  // promise directly. Returning the in-flight promise risks stale data when a file
  // is created *after* that snapshot started but *before* this call arrived.
  if (pendingGitSnapshot?.cwd === cwd) {
    return pendingGitSnapshot.promise.then(() => readGitSnapshot(cwd))
  }

  const promise = Promise.all([
    runGit(cwd, ["diff", "--numstat", "HEAD"], 2000),
    runGit(cwd, ["status", "--porcelain", "-uall"], 2000),
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
