import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { getGitFileChanges, runGit } from "./process-utils"

const execFileAsync = promisify(execFile)

async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ozc-process-utils-"))
  const original = process.cwd()
  try {
    process.chdir(dir)
    return await fn(dir)
  } finally {
    process.chdir(original)
    await rm(dir, { recursive: true, force: true })
  }
}

async function git(args: string[]) {
  await execFileAsync("git", args, { encoding: "utf-8" })
}

describe("process-utils", () => {
  it("runGit returns trimmed stdout", async () => {
    await inTempDir(async () => {
      await git(["init"])

      assert.equal(await runGit(["rev-parse", "--show-toplevel"]), process.cwd())
    })
  })

  it("runGit returns an empty string on failure", async () => {
    assert.equal(await runGit(["definitely-not-a-git-command"], 1000), "")
  })

  it("classifies tracked modified, added, and deleted git file changes vs HEAD", async () => {
    await inTempDir(async () => {
      await git(["init"])
      await git(["config", "user.email", "test@example.com"])
      await git(["config", "user.name", "Test User"])
      await writeFile("modified.txt", "before\n")
      await writeFile("deleted.txt", "gone\n")
      await git(["add", "."])
      await git(["commit", "-m", "initial"])

      await writeFile("modified.txt", "after\n")
      await rm("deleted.txt")
      await mkdir("nested")
      await writeFile("nested/new.txt", "new\n")
      await writeFile("untracked.txt", "untracked\n")
      await git(["add", "nested/new.txt"])

      assert.deepEqual(await getGitFileChanges(), {
        modified: ["modified.txt"],
        added: ["nested/new.txt"],
        deleted: ["deleted.txt"],
      })
    })
  })
})
