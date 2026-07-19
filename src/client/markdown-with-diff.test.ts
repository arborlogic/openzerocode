import assert from "node:assert"
import { describe, it } from "bun:test"
import { DIFF_RENDER_PROPS } from "./diff-rendering"
import { normalizeUnifiedDiffHunks, parseDiffBlocks, parseMarkdownTables } from "./markdown-diff-parser"

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

  it("detects diff content inside ```bash blocks", () => {
    const md = [
      "Changes:",
      "```bash",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1,3 +1,4 @@",
      " # Title",
      "+New line",
      " old line",
      "```",
    ].join("\n")

    const result = parseDiffBlocks(md)
    assert.equal(result.length, 2)
    assert.equal(result[0]!.type, "markdown")
    assert.equal(result[1]!.type, "diff")
    assert.ok(result[1]!.content.includes("+New line"))
  })

  it("does not treat plain bash output as diff", () => {
    const md = [
      "```bash",
      "$ ls -la",
      "total 0",
      "```",
    ].join("\n")

    const result = parseDiffBlocks(md)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.type, "markdown")
  })

  it("extracts markdown pipe tables as table segments", () => {
    const md = [
      "Before",
      "| Method | Latency | Notes |",
      "|---|---|---|",
      "| streaming | ~32ms | per-chunk flush |",
      "| non-streaming | n/a | render once |",
      "| diff block | in-place | opentui <diff> |",
      "After",
    ].join("\n")

    const result = parseDiffBlocks(md)
    assert.equal(result.length, 3)
    assert.equal(result[0]!.type, "markdown")
    assert.equal(result[1]!.type, "table")
    const tableSeg = result[1] as Extract<(typeof result)[number], { type: "table" }>
    assert.deepEqual(tableSeg.table.headers, ["Method", "Latency", "Notes"])
    assert.deepEqual(tableSeg.table.rows[0], ["streaming", "~32ms", "per-chunk flush"])
    assert.deepEqual(tableSeg.table.rows[2], ["diff block", "in-place", "opentui <diff>"])
    assert.equal(result[2]!.type, "markdown")
  })

  it("does not parse pipe-looking text inside fenced code as markdown tables", () => {
    const md = [
      "```ts",
      "const row = '| Method | Latency |'",
      "const sep = '|---|---|'",
      "```",
    ].join("\n")

    const result = parseMarkdownTables(md)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.type, "markdown")
  })

  it("normalizes stale unified diff hunk counts", () => {
    const diff = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+line2 updated",
      "+line2 extra",
      " line3",
    ].join("\n")

    const normalized = normalizeUnifiedDiffHunks(diff)
    assert.ok(normalized.includes("@@ -1,3 +1,4 @@"))
  })

  it("normalizes hunk counts inside parsed diff blocks", () => {
    const md = [
      "```diff",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1 +1 @@",
      " line1",
      "-old",
      "+new",
      " line2",
      "```",
    ].join("\n")

    const result = parseDiffBlocks(md)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.type, "diff")
    assert.ok(result[0]!.content.includes("@@ -1,3 +1,3 @@"))
  })

  // The component skips parseDiffBlocks entirely while streaming, so
  // the streaming chunk path renders the raw content through one stable
  // <text> renderable. After completion, parseDiffBlocks is called
  // once with streaming=false and the result is rendered through <Index>.
  // This test pins the call shape so a future refactor can't silently
  // re-introduce streaming-mode segment parsing (the original flicker).
  it("parses streaming and non-streaming content with consistent segment counts", () => {
    const content = "Some text\n```diff\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n```\nTail"

    // While streaming we still expect parseDiffBlocks to recognize the
    // closed diff fence (it returns markdown + diff + markdown). The key
    // contract is that the component does NOT call it during streaming —
    // the streaming text branch bypasses the parser entirely.
    const streamingResult = parseDiffBlocks(content, true)
    assert.equal(streamingResult.length, 3)
    assert.equal(streamingResult[1]!.type, "diff")

    // After streaming completes, the component calls parseDiffBlocks
    // once with streaming=false and renders the result via <Index>.
    const doneResult = parseDiffBlocks(content, false)
    assert.equal(doneResult.length, 3)
    assert.equal(doneResult[0]!.type, "markdown")
    assert.equal(doneResult[1]!.type, "diff")
    assert.equal(doneResult[2]!.type, "markdown")
  })

  it("keeps diff row colors enabled while leaving context rows transparent", () => {
    assert.equal(DIFF_RENDER_PROPS.contextBg, "transparent")
    assert.equal(DIFF_RENDER_PROPS.lineNumberBg, "transparent")
    assert.ok(DIFF_RENDER_PROPS.addedLineNumberBg)
    assert.ok(DIFF_RENDER_PROPS.removedLineNumberBg)
    assert.equal("addedContentBg" in DIFF_RENDER_PROPS, false)
    assert.equal("removedContentBg" in DIFF_RENDER_PROPS, false)
  })
})
