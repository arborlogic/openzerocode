import { describe, it } from "node:test"
import assert from "node:assert"
import { truncateToolOutput } from "./truncate"

// Mirrors the production constants in truncate.ts. Keep in sync if those change.
const MAX_OUTPUT_CHARS = 10_000
const HEAD_LINES = 100
const TAIL_LINES = 50

describe("truncateToolOutput", () => {
  it("returns short text unchanged", () => {
    const text = "Hello, world!"
    assert.equal(truncateToolOutput(text), text)
  })

  it("returns text within char budget unchanged", () => {
    const text = "A".repeat(MAX_OUTPUT_CHARS)
    assert.equal(truncateToolOutput(text).length, MAX_OUTPUT_CHARS)
  })

  it("truncates text exceeding char budget", () => {
    const over = 1_000
    const text = "A".repeat(MAX_OUTPUT_CHARS + over)
    const result = truncateToolOutput(text)
    assert.ok(result.includes(`...[truncated: ${over} more chars]`))
    assert.ok(result.length < MAX_OUTPUT_CHARS + over)
  })

  it("returns text within line budget unchanged", () => {
    // HEAD_LINES + TAIL_LINES lines stay below truncation threshold.
    const total = HEAD_LINES + TAIL_LINES
    const text = Array.from({ length: total }, (_, i) => `line ${i + 1}`).join("\n")
    const result = truncateToolOutput(text)
    assert.equal(result, text)
  })

  it("truncates text exceeding line budget", () => {
    const extra = 50
    const total = HEAD_LINES + TAIL_LINES + extra
    const lines: string[] = []
    for (let i = 0; i < total; i++) lines.push(`line ${i + 1}`)
    const text = lines.join("\n")
    const result = truncateToolOutput(text)

    assert.ok(result.startsWith("line 1"))
    assert.ok(result.includes(`line ${HEAD_LINES}`))
    assert.ok(result.includes(`...[${extra} lines omitted]`))
    assert.ok(result.includes(`line ${HEAD_LINES + extra + 1}`))
    assert.ok(result.endsWith(`line ${total}`))
  })

  it("preserves content on exact boundary", () => {
    const total = HEAD_LINES + TAIL_LINES
    const lines: string[] = []
    for (let i = 0; i < total; i++) lines.push(`line ${i + 1}`)
    const text = lines.join("\n")
    const result = truncateToolOutput(text)
    assert.equal(result.split("\n").length, total)
    assert.ok(!result.includes("omitted"))
  })

  it("handles single long line exceeding char budget", () => {
    const over = 1_000
    const text = "X".repeat(MAX_OUTPUT_CHARS + over)
    const result = truncateToolOutput(text)
    assert.ok(result.includes(`...[truncated: ${over} more chars]`))
    assert.ok(result.length < MAX_OUTPUT_CHARS + over)
  })

  it("handles empty string", () => {
    assert.equal(truncateToolOutput(""), "")
  })
})
