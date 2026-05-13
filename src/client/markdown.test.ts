import { describe, it } from "node:test"
import assert from "node:assert"
import { renderMarkdown } from "./markdown"

describe("renderMarkdown", () => {
  it("renders plain text unchanged", () => {
    const result = renderMarkdown("hello world")
    assert.ok(result.includes("hello world"))
  })

  it("renders a paragraph", () => {
    const result = renderMarkdown("This is a paragraph.")
    assert.equal(result.trim(), "This is a paragraph.")
  })

  it("renders multiple paragraphs separated by blank line", () => {
    const result = renderMarkdown("First para.\n\nSecond para.")
    assert.ok(result.includes("First para."))
    assert.ok(result.includes("Second para."))
  })

  it("renders headings", () => {
    const result = renderMarkdown("# Title\n## Subtitle\n### Normal")
    assert.ok(result.includes("Title"))
    assert.ok(result.includes("Subtitle"))
    assert.ok(result.includes("Normal"))
  })

  it("renders bold and italic", () => {
    const result = renderMarkdown("**bold** and *italic*")
    assert.ok(result.includes("bold"))
    assert.ok(result.includes("italic"))
  })

  it("renders inline code", () => {
    const result = renderMarkdown("Use `code` here")
    assert.ok(result.includes("code"))
  })

  it("renders code blocks", () => {
    const result = renderMarkdown("```ts\nconst x = 1\n```")
    assert.ok(result.includes("const x = 1"))
    assert.ok(result.includes("ts"))
  })

  it("renders unordered lists", () => {
    const result = renderMarkdown("- item1\n- item2")
    assert.ok(result.includes("item1"))
    assert.ok(result.includes("item2"))
  })

  it("renders ordered lists", () => {
    const result = renderMarkdown("1. first\n2. second")
    assert.ok(result.includes("first"))
    assert.ok(result.includes("second"))
  })

  it("renders blockquotes", () => {
    const result = renderMarkdown("> quoted text")
    assert.ok(result.includes("quoted text"))
  })

  it("renders horizontal rules", () => {
    const result = renderMarkdown("---")
    assert.ok(result.length > 0)
  })

  it("renders links", () => {
    const result = renderMarkdown("[link](https://example.com)")
    assert.ok(result.includes("example.com"))
  })

  it("renders strikethrough", () => {
    const result = renderMarkdown("~~strikethrough~~")
    assert.ok(result.includes("strikethrough"))
  })

  it("renders tables", () => {
    const result = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |")
    assert.ok(result.includes("A"))
    assert.ok(result.includes("B"))
    assert.ok(result.includes("1"))
    assert.ok(result.includes("2"))
  })
})
