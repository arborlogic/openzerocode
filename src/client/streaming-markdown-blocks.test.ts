import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { partitionStreamingMarkdown, looksLikeMarkdown } from "./streaming-markdown-blocks"
import type { MarkdownBlock } from "./streaming-markdown-blocks"

function md(content: string): MarkdownBlock {
  return { content, type: "markdown" }
}

function txt(content: string): MarkdownBlock {
  return { content, type: "text" }
}

describe("looksLikeMarkdown", () => {
  it("detects headings", () => {
    assert.equal(looksLikeMarkdown("# Hello"), true)
    assert.equal(looksLikeMarkdown("## World"), true)
    assert.equal(looksLikeMarkdown("###### Deep"), true)
    assert.equal(looksLikeMarkdown("Setext heading\n==="), true)
  })

  it("detects fenced code blocks", () => {
    assert.equal(looksLikeMarkdown("```ts"), true)
    assert.equal(looksLikeMarkdown("```"), true)
    assert.equal(looksLikeMarkdown("~~~python"), true)
    assert.equal(looksLikeMarkdown("    const value = 1"), true)
  })

  it("detects lists", () => {
    assert.equal(looksLikeMarkdown("- item"), true)
    assert.equal(looksLikeMarkdown("* item"), true)
    assert.equal(looksLikeMarkdown("+ item"), true)
    assert.equal(looksLikeMarkdown("1. first"), true)
  })

  it("detects blockquotes", () => {
    assert.equal(looksLikeMarkdown("> quoted"), true)
  })

  it("detects horizontal rules", () => {
    assert.equal(looksLikeMarkdown("---"), true)
    assert.equal(looksLikeMarkdown("***"), true)
    assert.equal(looksLikeMarkdown("___"), true)
  })

  it("detects inline markdown", () => {
    assert.equal(looksLikeMarkdown("**bold**"), true)
    assert.equal(looksLikeMarkdown("__bold__"), true)
    assert.equal(looksLikeMarkdown("`code`"), true)
    assert.equal(looksLikeMarkdown("~~strikethrough~~"), true)
    assert.equal(looksLikeMarkdown("[link](url)"), true)
    assert.equal(looksLikeMarkdown("![alt text](image.png)"), true)
    assert.equal(looksLikeMarkdown("<https://example.com>"), true)
    assert.equal(looksLikeMarkdown("Visit www.example.com"), true)
    assert.equal(looksLikeMarkdown("<kbd>Ctrl</kbd>"), true)
  })

  it("detects reference links", () => {
    assert.equal(looksLikeMarkdown("[text][id]"), true)
    assert.equal(looksLikeMarkdown("[id]: url"), true)
  })

  it("detects tables", () => {
    assert.equal(looksLikeMarkdown("| a | b |\n|---|---|"), true)
  })

  it("returns false for plain text", () => {
    assert.equal(looksLikeMarkdown("Hello world"), false)
    assert.equal(looksLikeMarkdown("Just some text"), false)
    assert.equal(looksLikeMarkdown("3 * 5 = 15"), false)
    assert.equal(looksLikeMarkdown("First paragraph.\n\n"), false)
    assert.equal(looksLikeMarkdown("Intro\n\n"), false)
  })
})

describe("partitionStreamingMarkdown", () => {
  it("keeps only the trailing top-level block pending", () => {
    const result = partitionStreamingMarkdown("First paragraph.\n\nSecond paragraph", true)
    assert.deepEqual(result, {
      completed: [txt("First paragraph.\n\n")],
      pending: txt("Second paragraph"),
    })
  })

  it("does not finalize the sole block even after a blank line", () => {
    const result = partitionStreamingMarkdown("Still growing.\n\n", true)
    assert.deepEqual(result, {
      completed: [],
      pending: txt("Still growing.\n\n"),
    })
  })

  it("preserves fenced code as one block", () => {
    const content = "Intro\n\n```ts\nconst value = 1\n```\n\nTail"
    const result = partitionStreamingMarkdown(content, true)
    assert.deepEqual(result, {
      completed: [txt("Intro\n\n"), md("```ts\nconst value = 1\n```\n\n")],
      pending: txt("Tail"),
    })
  })

  it("keeps a loose list together when later lines extend it", () => {
    const content = "Intro\n\n- first\n\n  continued\n"
    const result = partitionStreamingMarkdown(content, true)
    assert.deepEqual(result, {
      completed: [txt("Intro\n\n")],
      pending: md("- first\n\n  continued\n"),
    })
  })

  it("finalizes every block when streaming completes", () => {
    const result = partitionStreamingMarkdown("First\n\nSecond", false)
    assert.deepEqual(result, {
      completed: [txt("First\n\n"), txt("Second")],
      pending: null,
    })
  })

  it("does not freeze a reference link before its later definition arrives", () => {
    const content = "See [OpenAI][oa].\n\nMore prose.\n\n[oa]: https://openai.com"

    const streaming = partitionStreamingMarkdown(content, true)
    assert.deepEqual(streaming, {
      completed: [],
      pending: md(content),
    })
    const done = partitionStreamingMarkdown(content, false)
    assert.deepEqual(done, {
      completed: [md(content)],
      pending: null,
    })
  })

  it("still stabilizes ordinary inline links block by block", () => {
    const result = partitionStreamingMarkdown(
      "Visit [OpenAI](https://openai.com).\n\nTail",
      true,
    )
    assert.deepEqual(result, {
      completed: [md("Visit [OpenAI](https://openai.com).\n\n")],
      pending: txt("Tail"),
    })
  })

  it("does not mistake task-list checkboxes for shortcut references", () => {
    const result = partitionStreamingMarkdown("- [x] done\n- [ ] todo\n\nTail", true)
    assert.deepEqual(result, {
      completed: [md("- [x] done\n- [ ] todo\n\n")],
      pending: txt("Tail"),
    })
  })

  it("handles empty content", () => {
    assert.deepEqual(partitionStreamingMarkdown("", true), {
      completed: [],
      pending: null,
    })
  })
})
