import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { normalizeDiffHunkCounts } from "./format-utils"

const execFileAsync = promisify(execFile)

export async function getFileDiff(path: string): Promise<string> {
  let raw = ""
  try {
    const { stdout } = await execFileAsync("git", ["diff", "HEAD", "--", path], {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    })
    raw = stdout
  } catch {
    raw = ""
  }

  // Untracked / new file: `git diff HEAD` is empty. Fall back to
  // `git diff --no-index /dev/null <file>` which produces a full-file
  // addition diff. That command exits with code 1 when there are
  // differences, so capture stdout from the error path as well.
  if (!raw) {
    try {
      const { stdout } = await execFileAsync("git", ["diff", "--no-index", "--", "/dev/null", path], {
        encoding: "utf-8",
        timeout: 5000,
        maxBuffer: 8 * 1024 * 1024,
      })
      raw = stdout
    } catch (err) {
      const stdout = (err as { stdout?: string })?.stdout
      if (typeof stdout === "string") raw = stdout
    }
  }

  return normalizeDiffHunkCounts(raw)
}
