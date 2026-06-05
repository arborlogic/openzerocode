import assert from "node:assert"
import { describe, it } from "bun:test"
import { parseDiffBlocks } from "./markdown-diff-parser"

describe("parseDiffBlocks", () => {
  it("returns a single markdown segment when there are no diff blocks", () => {
    const result = parseDiffBlocks("Hello world")
    assert.equal(result.length, 1)
    assert.equal(result[0]!.type, "markdown")
    assert.equal(result[0]!.content, "Hello world")
  })

  it("extracts a ```diff block", () => {
    const md = [
      "Before:",
      '```diff',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '```',
      "After:",
    ].join("\n")

    const result = parseDiffBlocks(md)
    assert.equal(result.length, 3)
    assert.equal(result[0]!.type, "markdown")
    assert.ok(result[0]!.content.includes("Before:"))
    assert.equal(result[1]!.type, "diff")
    assert.ok(result[1]!.content.includes("-old"))
    assert.ok(result[1]!.content.includes("+new"))
    assert.equal(result[2]!.type, "markdown")
    assert.ok(result[2]!.content.includes("After:"))
  })

  it("extracts a ```patch block", () => {
    const md = [
      '```patch',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,3 +1,4 @@',
      ' line1',
      '-line2',
      '+line2-modified',
      ' line3',
      '```',
    ].join("\n")

    const result = parseDiffBlocks(md)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.type, "diff")
    assert.ok(result[0]!.content.includes("line2"))
  })

  it("handles multiple diff blocks", () => {
    const md = [
      "First text",
      '```diff',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '```',
      "Middle text",
      '```patch',
      '--- a/c.ts',
      '+++ b/c.ts',
      '@@ -1 +1 @@',
      '-c',
      '+d',
      '```',
      "Last text",
    ].join("\n")

    const result = parseDiffBlocks(md)
    assert.equal(result.length, 5)
    assert.equal(result[0]!.type, "markdown")
    assert.equal(result[1]!.type, "diff")
    assert.equal(result[2]!.type, "markdown")
    assert.equal(result[3]!.type, "diff")
    assert.equal(result[4]!.type, "markdown")
  })

  it("handles empty content", () => {
    const result = parseDiffBlocks("")
    assert.equal(result.length, 0)
  })

  it("handles content with only diff blocks", () => {
    const md = [
      '```diff',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '```',
    ].join("\n")

    const result = parseDiffBlocks(md)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.type, "diff")
  })

  it("extracts filename hint when present", () => {
    const md = [
      '```diff src/hello.ts',
      '--- a/src/hello.ts',
      '+++ b/src/hello.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '```',
    ].join("\n")

    const result = parseDiffBlocks(md)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.type, "diff")
    // file property is only present on diff segments
    const diffSeg = result[0] as { type: "diff"; content: string; file?: string }
    assert.equal(diffSeg.file, "src/hello.ts")
  })

  it("treats an unclosed trailing diff fence as diff while streaming", () => {
    const md = [
      "Before:",
      "```diff src/hello.ts",
      "--- a/src/hello.ts",
      "+++ b/src/hello.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n")

    const result = parseDiffBlocks(md, true)
    assert.equal(result.length, 2)
    assert.equal(result[0]!.type, "markdown")
    assert.equal(result[1]!.type, "diff")
    const diffSeg = result[1] as { type: "diff"; content: string; file?: string }
    assert.equal(diffSeg.file, "src/hello.ts")
    assert.ok(diffSeg.content.includes("+new"))
  })

  it("keeps an unclosed trailing diff fence as markdown when not streaming", () => {
    const md = "```diff\n-old\n+new"
    const result = parseDiffBlocks(md)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.type, "markdown")
  })
})
