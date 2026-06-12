import { describe, it } from "node:test"
import assert from "node:assert"
import { truncateToolOutput } from "./truncate"

// Mirrors the production constants in truncate.ts. Keep in sync if those change.
const MAX_OUTPUT_BYTES = 10_000
const HEAD_LINES = 100
const TAIL_LINES = 50
const encoder = new TextEncoder()

describe("truncateToolOutput", () => {
  it("returns short text unchanged", () => {
    const text = "Hello, world!"
    assert.equal(truncateToolOutput(text), text)
  })

  it("returns text within byte budget unchanged", () => {
    const text = "A".repeat(MAX_OUTPUT_BYTES)
    assert.equal(truncateToolOutput(text).length, MAX_OUTPUT_BYTES)
  })

  it("truncates text exceeding byte budget and preserves both ends", () => {
    const over = 1_000
    const text = "START" + "A".repeat(MAX_OUTPUT_BYTES + over) + "END"
    const result = truncateToolOutput(text)
    assert.ok(result.startsWith("START"))
    assert.ok(result.endsWith("END"))
    assert.match(result, /\.\.\.\[truncated: \d+ more bytes\]\.\.\./)
    assert.ok(encoder.encode(result).length <= MAX_OUTPUT_BYTES)
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

  it("applies the byte budget to multi-byte CJK output", () => {
    const text = "開始" + "中".repeat(5_000) + "結束"
    const result = truncateToolOutput(text)
    assert.ok(result.startsWith("開始"))
    assert.ok(result.endsWith("結束"))
    assert.match(result, /\.\.\.\[truncated: \d+ more bytes\]\.\.\./)
    assert.ok(encoder.encode(result).length <= MAX_OUTPUT_BYTES)
  })

  it("handles empty string", () => {
    assert.equal(truncateToolOutput(""), "")
  })
})
