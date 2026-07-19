import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { partitionStreamingMarkdown } from "./streaming-markdown-blocks"

describe("partitionStreamingMarkdown", () => {
  it("keeps only the trailing top-level block pending", () => {
    assert.deepEqual(
      partitionStreamingMarkdown("First paragraph.\n\nSecond paragraph", true),
      {
        completed: ["First paragraph.\n\n"],
        pending: "Second paragraph",
      },
    )
  })

  it("does not finalize the sole block even after a blank line", () => {
    assert.deepEqual(partitionStreamingMarkdown("Still growing.\n\n", true), {
      completed: [],
      pending: "Still growing.\n\n",
    })
  })

  it("preserves fenced code as one block", () => {
    const content = "Intro\n\n```ts\nconst value = 1\n```\n\nTail"
    assert.deepEqual(partitionStreamingMarkdown(content, true), {
      completed: ["Intro\n\n", "```ts\nconst value = 1\n```\n\n"],
      pending: "Tail",
    })
  })

  it("keeps a loose list together when later lines extend it", () => {
    const content = "Intro\n\n- first\n\n  continued\n"
    assert.deepEqual(partitionStreamingMarkdown(content, true), {
      completed: ["Intro\n\n"],
      pending: "- first\n\n  continued\n",
    })
  })

  it("finalizes every block when streaming completes", () => {
    assert.deepEqual(partitionStreamingMarkdown("First\n\nSecond", false), {
      completed: ["First\n\n", "Second"],
      pending: "",
    })
  })

  it("does not freeze a reference link before its later definition arrives", () => {
    const content = "See [OpenAI][oa].\n\nMore prose.\n\n[oa]: https://openai.com"

    assert.deepEqual(partitionStreamingMarkdown(content, true), {
      completed: [],
      pending: content,
    })
    assert.deepEqual(partitionStreamingMarkdown(content, false), {
      completed: [content],
      pending: "",
    })
  })

  it("still stabilizes ordinary inline links block by block", () => {
    assert.deepEqual(
      partitionStreamingMarkdown("Visit [OpenAI](https://openai.com).\n\nTail", true),
      {
        completed: ["Visit [OpenAI](https://openai.com).\n\n"],
        pending: "Tail",
      },
    )
  })

  it("does not mistake task-list checkboxes for shortcut references", () => {
    assert.deepEqual(
      partitionStreamingMarkdown("- [x] done\n- [ ] todo\n\nTail", true),
      {
        completed: ["- [x] done\n- [ ] todo\n\n"],
        pending: "Tail",
      },
    )
  })

  it("handles empty content", () => {
    assert.deepEqual(partitionStreamingMarkdown("", true), {
      completed: [],
      pending: "",
    })
  })
})
