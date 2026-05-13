import { describe, it } from "node:test"
import assert from "node:assert"
import { truncateToolOutput } from "./truncate"

describe("truncateToolOutput", () => {
  it("returns short text unchanged", () => {
    const text = "Hello, world!"
    assert.equal(truncateToolOutput(text), text)
  })

  it("returns text within char budget unchanged", () => {
    const text = "A".repeat(40_000)
    assert.equal(truncateToolOutput(text).length, 40_000)
  })

  it("truncates text exceeding char budget", () => {
    const text = "A".repeat(50_000)
    const result = truncateToolOutput(text)
    assert.ok(result.includes("[truncated: 10000 more chars]"))
    assert.ok(result.length < 50_000)
  })

  it("returns text within line budget unchanged", () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join("\n")
    // 400 lines exactly at HEAD_LINES, under HEAD_LINES + TAIL_LINES = 450
    const result = truncateToolOutput(text)
    assert.equal(result, text)
  })

  it("truncates text exceeding line budget", () => {
    const lines: string[] = []
    for (let i = 0; i < 500; i++) lines.push(`line ${i + 1}`)
    const text = lines.join("\n")
    const result = truncateToolOutput(text)

    // Should contain head lines
    assert.ok(result.startsWith("line 1"))
    assert.ok(result.includes(`line ${400}`))
    // Should contain truncation marker
    assert.ok(result.includes("[50 lines omitted]"))
    // Should contain tail lines
    assert.ok(result.includes("line 451"))
    assert.ok(result.endsWith("line 500"))
  })

  it("preserves content on exact boundary", () => {
    // Exactly 450 lines = HEAD_LINES + TAIL_LINES (no truncation)
    const lines: string[] = []
    for (let i = 0; i < 450; i++) lines.push(`line ${i + 1}`)
    const text = lines.join("\n")
    const result = truncateToolOutput(text)
    assert.equal(result.split("\n").length, 450)
    assert.ok(!result.includes("omitted"))
  })

  it("handles single long line exceeding char budget", () => {
    const text = "X".repeat(41_000)
    const result = truncateToolOutput(text)
    assert.ok(result.includes("[truncated: 1000 more chars]"))
    assert.ok(result.length < 41_000)
  })

  it("handles empty string", () => {
    assert.equal(truncateToolOutput(""), "")
  })
})
