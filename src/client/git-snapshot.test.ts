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

  it("splits porcelain rename paths only on arrows outside quotes", () => {
    assert.deepEqual(parseGitPorcelain([
      "R  \"old -> name.ts\" -> \"new -> name.ts\"",
      "R  plain-old.ts -> \"quoted -> new.ts\"",
    ].join("\n")), [
      { path: "new -> name.ts", status: "modified" },
      { path: "quoted -> new.ts", status: "modified" },
    ])
  })

  it("parses numstat paths as-is (git never C-quotes or arrow-normalizes them)", () => {
    // git diff --numstat emits raw paths; renames use `{old => new}` brace
    // notation, not the ` -> ` arrow format used by porcelain.
    assert.deepEqual(parseGitDiffNumstat("1\t2\tnew.ts"), [
      { path: "new.ts", additions: 1, deletions: 2 },
    ])
  })

  it("unquotes C-quoted porcelain paths with spaces", () => {
    // git status --porcelain C-quotes paths containing spaces; git diff
    // --numstat does not. Porcelain must unquote to match the numstat key.
    assert.equal(
      parseGitPorcelain("A  \"My App/google-services.json\"")[0]?.path,
      "My App/google-services.json",
    )
  })

  it("does not unquote numstat paths — git never C-quotes them", () => {
    // A file literally named "foo" (starts and ends with ") must not have its
    // quotes stripped; numstat emits the raw filename without C-quoting.
    assert.equal(
      parseGitDiffNumstat(`8\t0\t"foo"`)[0]?.path,
      '"foo"',
    )
  })

  it("decodes all C-escape sequences in porcelain paths", () => {
    // octal UTF-8 bytes
    assert.equal(
      parseGitPorcelain("A  \"app/\\350\\260\\267-services.json\"")[0]?.path,
      "app/谷-services.json",
    )
    // named escapes including previously-missing \a \b \v \f
    assert.equal(
      parseGitPorcelain("A  \"path/\\a\\b\\t\\n\\v\\f\\r\\\"\\\\.ts\"")?.[0]?.path,
      "path/\x07\x08\x09\x0a\x0b\x0c\x0d\"\\.ts",
    )
  })
})
