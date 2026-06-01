import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseGitDiffNumstat, parseGitPorcelain, parseRecentCommits, RECENT_COMMIT_LIMIT } from "./git-snapshot"

describe("git snapshot parsing", () => {
  it("keeps the configured number of recent commits", () => {
    const out = [
      "aaaaaaa first",
      "bbbbbbb second",
      "ccccccc third",
    ].join("\n")

    assert.equal(RECENT_COMMIT_LIMIT, 3)
    assert.deepEqual(parseRecentCommits(out), [
      { hash: "aaaaaaa", subject: "first" },
      { hash: "bbbbbbb", subject: "second" },
      { hash: "ccccccc", subject: "third" },
    ])
  })

  it("parses porcelain statuses that have no numstat entry", () => {
    assert.deepEqual(parseGitPorcelain([
      " M modified-only-mode.ts",
      " D deleted.txt",
      "A  staged-empty.txt",
      "?? untracked.md",
      "R  old-name.ts -> new-name.ts",
    ].join("\n")), [
      { path: "modified-only-mode.ts", status: "modified" },
      { path: "deleted.txt", status: "deleted" },
      { path: "staged-empty.txt", status: "added" },
      { path: "untracked.md", status: "added" },
      { path: "new-name.ts", status: "modified" },
    ])
  })

  it("normalizes renamed paths from numstat output", () => {
    assert.deepEqual(parseGitDiffNumstat("1\t2\told.ts -> new.ts"), [
      { path: "new.ts", additions: 1, deletions: 2 },
    ])
  })
})
