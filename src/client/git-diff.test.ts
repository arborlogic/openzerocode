import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { getFileDiff } from "./git-diff"

const execFileAsync = promisify(execFile)

async function inTempDir<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ozc-git-diff-"))
  const original = process.cwd()
  try {
    process.chdir(dir)
    return await fn()
  } finally {
    process.chdir(original)
    await rm(dir, { recursive: true, force: true })
  }
}

async function git(args: string[]) {
  await execFileAsync("git", args, { encoding: "utf-8" })
}

describe("getFileDiff", () => {
  it("returns normalized diffs for tracked file changes", async () => {
    await inTempDir(async () => {
      await git(["init"])
      await git(["config", "user.email", "test@example.com"])
      await git(["config", "user.name", "Test User"])
      await writeFile("file.txt", "one\ntwo\n")
      await git(["add", "file.txt"])
      await git(["commit", "-m", "initial"])

      await writeFile("file.txt", "one\nchanged\n")

      const diff = await getFileDiff("file.txt")
      assert.match(diff, /^diff --git a\/file\.txt b\/file\.txt/m)
      assert.match(diff, /^@@ -1,2 \+1,2 @@$/m)
      assert.match(diff, /^-two$/m)
      assert.match(diff, /^\+changed$/m)
    })
  })

  it("falls back to no-index diff for untracked files", async () => {
    await inTempDir(async () => {
      await git(["init"])
      await writeFile("new.txt", "hello\nworld\n")

      const diff = await getFileDiff("new.txt")
      assert.match(diff, /new file mode|--- \/dev\/null/)
      assert.match(diff, /^@@ -0,0 \+1,2 @@$/m)
      assert.match(diff, /^\+hello$/m)
      assert.match(diff, /^\+world$/m)
    })
  })

  it("returns an empty string when git cannot produce a diff", async () => {
    await inTempDir(async () => {
      assert.equal(await getFileDiff("missing.txt"), "")
    })
  })
})
